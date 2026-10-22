# 隔离启动器诊断：K12 与 K13

**验证日期**：2026-10-22。对象为已登记的 Windows 3.16.2.8769 运行包及 v2 补丁副本。本轮修复 lab 启动器，不改补丁字节或网关运行代码。

## 1. K13：无窗口的根因与修复

**根因是 Electron userData 在依赖导入期尚不可用**。只设置 `ZCODE_DESKTOP_USER_DATA_DIR` 不足以覆盖这个阶段：主模块执行 `app.setPath` 前，导入的 ARMS 初始化已读取 Electron 路径。

不带 CDP 的新环境中，真实 stderr 出现：

```text
[arms] electron init failed: Error: Failed to get 'userData' path
unhandledRejection: Error: Failed to get 'userData' path
```

官方 `appARMSBootstrap.ts` 导出初始化 Promise；`index.ts` 在创建主窗口前等待它。该 Promise 拒绝后，进程仍存活，但未执行主窗口创建，远控也未就绪。问题发生在窗口和 provider 门禁之前。

旧启动器仅在启用 CDP 时传入 `--user-data-dir`，因此开启调试会掩盖故障。**修复为每次启动都显式传入隔离 userData**，无需预置“首启完成”标记，也无需先跑普通启动。

另一个独立错误已修复：Desktop 的参数解析只接受 `--open-workspace <path>` 或 `--open-workspace=<path>`；裸位置参数会被忽略。lab 的 `--workspace` 现在渲染为具名参数，并保留含空格路径。

## 2. K12：区分单实例退出与初始化受阻

按恢复的手动脚本构造对照。保留同一份 lab env、非回环网关覆盖和运行包，只改变已存在实例或 userData 参数：

| 条件 | 观察 | 结论 |
| --- | --- | --- |
| 无实例，不传 `--user-data-dir` | 取得单实例锁；主进程存活，ARMS 路径错误，无主窗口 | 与 K13 相同的初始化故障 |
| 无实例，补上 `--user-data-dir` | 主窗口创建，网关 `desktop_connected/desktop_ready=true` | 手动启动可用 |
| 已有实例持锁，再执行原手动脚本 | 锁返回 false，第二进程退出码 0 | 早退来自 `requestSingleInstanceLock` 失败后的 `app.quit()` |
| 强杀持锁实例后，再执行原脚本 | 锁重新返回 true | 本轮没有复现强杀后的残留锁 |

锁返回值通过仅作用于 lab 副本的 `[DEBUG-local-only-lock]` 探针记录；采样后已恢复登记的 v2 补丁字节。原始三次历史运行缺少完整的持锁进程记录，**不能据此逐次追溯旧运行，也不能把“残留锁”当作已证实根因**。

lab 现在在启动前按**副本 exe 的完整路径**枚举进程。即使手动启动没有留下 `run-state.json`，仍会明确列出存活 PID 并拒绝重复启动；枚举失败也明确报错，不删除锁文件或终止已有实例。

## 3. 非回环覆盖的原生观察

给手动脚本设置 `ZCODE_LOCAL_ONLY_GATEWAY=http://192.168.1.5:9999`，补上 userData 参数后启动成功。原生探针记录最终目标为 `ws://127.0.0.1:17331/ws`，真实 lab 网关达到 `desktop_ready=true`。这补齐了 LO-03 的原生观察缺口。

该结论针对 `ZCODE_LOCAL_ONLY_GATEWAY` 的覆盖分支，不扩大为任意环境变量组合的网络约束证明。

## 4. 回归与证据

| 检查 | 结果 | 忽略目录中的日志 |
| --- | --- | --- |
| 指定工作区参数 | 修复前失败；修复后窗口 URL 中的工作区匹配请求 | `workspace-red.log`、`workspace-green.log` |
| 无 CDP 的启动参数契约 | 红转绿；真实 PowerShell 执行生成的启动器，替换进程创建边界 | `userdata-red.log`、`userdata-green.log` |
| 无 CDP、全新数据目录冷启动 | 修复前 ARMS 失败且未就绪；修复后主窗口 dom-ready、远控 paired/ready | `native-nodbg-red.log`、`native-nodbg-green.log`、对应 `desktop-nodbg-*` |
| 已有实例且无运行记录 | 契约红转绿；原生启动明确拒绝并列 PID | `live-instance-red.log`、`live-instance-green.log`、`native-live-guard.log` |
| 原手动脚本与锁对照 | 已有实例时锁 false、退出 0；结束持锁实例后锁 true | `manual-lock-secondary.log`、`held-lock.out.log`、`after-kill.out.log` |
| 非回环覆盖 | 最终回环地址与真实网关就绪同时成立 | `manual-lock-primary.log`、`nonloop-ready.out.log` |
| lab 契约回归 | 17/17 通过 | `lab-tests-final.log`，退出码文件为 0 |
| 恢复正式补丁字节后的最终冷启动 | 无 CDP、全新数据根，主窗口 dom-ready 与网关 ready；启动前进程预检正常 | `native-final.log`，退出码文件为 0 |

日志位于实施工作树的 `.scratch/diagnose-local-only/`。长流程保留原始日志和退出码，不因阶段切换重复全量。本轮仅运行受影响的 lab 测试，没有重跑 common 或根级全量。

## 5. Windows 注册表隔离边界

**独立数据目录不隔离当前用户的 Shell 注册表**。原版 Desktop 副本启动会自动注册 `zcode:` 协议和“在 ZCode 中打开”右键菜单。真实启动日志及注册表回读均观察到副本路径；本轮收尾已将本次副本写入的入口恢复为日常安装路径。

因此不能把“lab 数据路径全部独立”概括成“系统零改动”。要求系统注册也严格隔离时，应在独立 Windows 用户或虚拟环境验证；同一用户下须事先备份相关注册项并核对恢复。该限制不属于 local-only 补丁行为。
