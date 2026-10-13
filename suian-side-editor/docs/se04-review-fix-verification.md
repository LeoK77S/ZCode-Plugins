# SE-04 规格轴时序修复

2026-10-13。基线 `9045197a618abbfa4fabac2e06ba18332ca87a6c`。独立规格轴提出的三个候选均用实际返回的构建 HTML、真实 SDK 服务、临时工作区与插件数据库确认。延迟只施加在公开 Host 工具回执边界；计时采用浏览器 Clock，没有调用页面内部函数。

**当前结论**：三项问题已在本地修复，新增 6 项契约及原有 20 组浏览器行为通过。固定修复提交的独立两轴、本票 Native 与用户验收尚待执行。本轮未改 SDK／SQLite／common／app-mcp／sources，未操作 Native 权限或模型端点。

## 三项红灯与最小修复

| 问题 | 真实红灯 | 修复 |
| --- | --- | --- |
| 到期的旧输入标记提前写回最近输入 | 保存 A 挂起；B 输入后 800 ms 到期；继续输入 C；100 ms 后释放旧回执。C 后 101 ms 已有第二次保存请求，预期仍为一次 | 每次重新安排输入计时清除旧 autoAfterSave 标记，保留 C 的当前 800 ms 计时 |
| 继承 Auto 初始化期间的正文漏调度 | get_editor_settings 实际读取继承 Auto 后挂起；正常 UI 打开文件并输入；800 ms 后释放模式回执。没有保存请求，预期一次 | 记录最后编辑的单调时间；初始化回执后按剩余 800 ms 安排脏正文，已到期则立即尝试。Manual 对照不自动保存 |
| 旧重新读取回执回退新保存 | 真实临时文件 ACL 拒写，磁盘版本未变；恢复权限，确认重读并挂起 D/V1 回执，再成功保存 L/V2。save-first 使页面第二行从 local 退为空；read-first 使 Auto 真正把磁盘从 original+local 写回 original | 重新读取期间保存按钮禁用，保存公共入口拒绝；保存中不启动或确认重新读取。显示重新读取进度，操作结束后正常编辑与保存仍可用 |

`fix-order-red.log` 为第一、二项的初始红灯：三项断言失败、Manual 对照通过。第三项两种回执顺序的实际正文与磁盘断言见 `fix-reload-red-2.log`。初次第三项的 read-first 夹具曾等待“已读取”，但当时仍在保存；修正为通过公开 CodeMirror 行文本确认读取应用，再等待“未保存”并推进 Auto 时钟，初次失败也保留在 `fix-reload-red.log`。

互斥修复之后，夹具中为潜在并发保存预留的 hold 没有被触发，随后正常保存被该未用 hold 拦住；已在禁止分支取消未用 hold。这个夹具收尾错误记录在 `fix-order-green-2.log`，不是产品保存失败。最终六项通过见 `fix-order-green-3.log` 与完整回归。

## 受影响验证与历史证据

新入口 `tests/browser-autosave-order.mjs` 已加入 `npm run test:browser`。原有目录／页签／手动保存 12 组、模式／冲突 8 组，以及新增 6 项均通过，日志 `fix-browser-final.log`／`.exit=0`。语法检查 `fix-check-final.log`／`.exit=0`。服务端、SQLite、文件写回与工具 schema 未变，复用 904 的 SDK 25/25；未重跑 common／app-mcp。

完整回归的截图通过测试专用 `SUIAN_SIDE_EDITOR_SCREENSHOT_DIR` 写入 `.scratch/se04/fix-screenshots/`，不覆盖初次截图。原 `.scratch/se04/transfer-manifest.json` 的 61 项记录和清单本身没有修改；回归前后重新按字节和 SHA-256 验证。新增命令、退出码和证据都以 fix-* 保存。

新 HTML 的工作树构建字节为 317169，SHA-256 `a54ba28d93f071d03092b224726de661a9dc1be9dd72fea796230f48d34d986f`，构建记录 `fix-build-2.log`／`.exit=0`。第三方依赖与许可范围不变，完整许可仍在返回 HTML 中。检出行尾可能改变字节，整合及 Native 必须固定实际返回资源。

JSON 汇总见 [修复证据](se04-review-fix-evidence.json)。首次模式实现、数据库竞争与初次日志继续见 [原验证记录](se04-verification.md)，不把原通过记录改写成新的结果。

## Native 补充交接，尚未执行

工具 schema、ZCODE_PLUGIN_DATA 路径规则、打开文件的外部检测频率与全部按钮 selector 均不变。新增的 UI 约束：重新读取时 #save 禁用，Ctrl+S 不发保存请求；保存中 #reload-file 和 #reload-confirm 禁用，保存结束后恢复可操作。

后续由 Native 负责人在正常持久任务、公开 callTool 与人类授权下验证：

1. 保存等待时，B 的输入计时到期后再输入 C；旧保存回执不提前 C 的最新计时。浏览器契约负责精确毫秒，Native 核对可观察保存与磁盘结果。
2. 首开继承 Auto 的模式读取等待期间，允许打开与编辑；读取回执后仍能保存已有编辑，未满 800 ms 不提前。Manual 保持手动。
3. 冲突或写入失败后确认重新读取，等待时按钮和两种 Ctrl+S 焦点路径均不保存；读取完成后正常编辑／手动保存。保存在途时不能开始或确认重读。

以上没有原生通过结果，不能据此宣布 #44 或首版完成。
