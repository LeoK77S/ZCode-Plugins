# PKG-07 发布操作手册（ZIP、Release 与市场清单）

本手册描述 PKG-07 交付的仓库级发布操作链。工具位于仓库根：`release-orchestrate.mjs`（编排与 CLI）、`release-zip.mjs`（确定性 ZIP）、`release-verify.mjs`（组装产物契约校验）、`release-marketplace.mjs`（市场候选与版本统一检查）、`release-github.mjs`（Release 流水线编排）。契约测试位于仓库根 `tests/release-*.test.mjs`。

所有构建输出（staging、ZIP、记录、候选清单）落在 `.scratch/release/`，已被仓库 `.gitignore` 挡住，不入源码 Git。

## 前置

```bash
cd <仓库根>
for p in suian-zcode-common suian-zcode-app-mcp suian-side-editor; do (cd $p && npm ci); done
```

title 无 npm 依赖，构建工具按公共层锁文件解析（common 的 esbuild）。

## 1. 构建、打包与发布记录

```bash
node release-orchestrate.mjs build \
  --tag <release-tag> \
  --base-url https://github.com/<owner>/<repo>/releases/download \
  --out .scratch/release
```

一次执行完成：

1. 子进程调用四包既有 `build-release.mjs`（PKG-02~04 契约，含公共代码不内联的构建期断言）。
2. 组装目录契约校验：插件身份与版本三方一致、隐藏 `.zcode-plugin/plugin.json`、入口与必备资源、无 node_modules/测试/文档/锁文件、无敏感文件与敏感内容（本机路径、凭据模式）、`release.json` 文件摘要逐项核对、业务包不携带 common 实现的逐字节副本（白名单：`locate.mjs` 薄定位器、`LICENSE`）。
3. 确定性 ZIP：条目按 posix 路径排序、时间戳固定（2026-01-01 00:00:00 DOS 纪元）、deflate 由 Node 内置 zlib 锁定；插件根直接位于压缩包根（`stripRoot:false` 前提）。同一输入重复打包字节一致。
4. ZIP 解压复验：实际解压到临时目录后重跑全部契约校验。
5. 发布记录 `release-record.json`：绑定提交（HEAD）、每包源码输入摘要与构建输入摘要（真实构建取自各包 `build-inputs.json`）、工具链（Node 版本/平台）与正式 ZIP 摘要。ZIP 内不含提交自引用。
6. 市场候选 `marketplace.candidate.json` 与版本统一检查报告。

**幂等复用**：再次执行 `build` 时，源码输入未变的包直接复用原 ZIP 字节与证据，不重跑构建器（规格 9.2：只改变提交身份不重建）；输入漂移只重建受影响包。`--plugins a,b` 可限定范围。

**不代选**：tag、插件版本由发布人决定，工具只校验一致性并报告，不自动升版。

## 2. 门禁核对（合并/推送阶段复用）

```bash
node release-orchestrate.mjs gate --out .scratch/release
```

核对当前源码输入与 ZIP 记录一致（漂移逐文件定位）、ZIP 文件仍在且摘要匹配。直接复用已有 ZIP，不重新构建、不追加全量。

## 3. 市场候选

`build` 已生成候选；也可单独重新生成：

```bash
node release-orchestrate.mjs marketplace --tag <tag> --base-url <base-url> --out .scratch/release
```

候选条目形状（对齐官方 CDN Zip Plugin Source 规范与规格 9.1）：`source = {source:"url", type:"zip", url:<固定 HTTPS Release 下载地址>, sha256:<64 位小写>, stripRoot:false}`；业务条目保留 `dependencies:["suian-zcode-common"]`。

根 `marketplace.json` 是手工维护的单一数据源：**候选文件仅供人工核对后采纳**（将受影响条目手工替换进根 marketplace.json），工具不整体重写正式清单。未变插件保留已发布 URL 与摘要——候选生成以传入的当前清单为基线，只改本轮更新的条目。

## 4. Release 流水线（须另行授权）

`release-github.mjs` 的 `runReleasePipeline` 按规格 9.3 顺序编排：读取同名 tag/Release 现状 -> 不存在才建草稿 -> 逐资产核对/上传（已传且摘要匹配跳过；无摘要的现有内容拒绝覆盖；上传结果未知先读现状再续作，不盲重传）-> 匿名公开下载核验（失败或摘要不符禁止公开，无先暴露 404 的路径）-> 授权后公开（先标预发布）-> 市场就绪核对（候选 URL/摘要与资产一致，仅报告）。

真实 GitHub 操作使用 `createGithubRestApi({owner, repo, token})`；**创建/发布 Release、推送 tag、切换正式市场清单均须另行发布授权**，本票交付仅在外部边界桩（内存 GitHub API + 本地 loopback HTTP fixture）中验证。仓库 Release 不可变性设置须在实际发布前人工读取确认，脚本不擅自修改仓库设置。已发布资产不删除重传：字节需变更时使用新版本与新 tag。

市场切换时机：资产公开且匿名下载核验通过、正式集成获授权后，候选清单随 dev 已验证内容合入 master（推送与合并遵循仓库授权边界）。在此之前清单保持原正式版本，状态为"资产已备/待集成"。

## 5. 回退

清单回退：`generateRollbackCandidate({current, previous, names})` 生成引用旧已发布 URL、旧摘要与配套版本集合的候选；旧资产不动。

**首次源码分发回退的限制**：旧版本（Git 源码分发）没有 Release ZIP，回退需把根 `marketplace.json` 对应条目恢复为 `source:"./<插件目录>"` 形态，并按旧流程恢复 npm 依赖安装与 `suian-zcode-common/link.mjs` 的 Node 包链接。首次迁移不承诺"无 setup 回退"；公共数据（网关数据目录等）默认不回滚。

## 6. 已知边界与遗留

- **common 发布目录覆盖面**（评审后收紧）：除 dist 双入口、vendor 许可与 skills 外，发布根现在完整携带网关运行闭包（gateway/terminal 源、vendor 运行件、`node_modules/ws` 运行库，按 `gateway-deploy.mjs` 清单 from 原位落位，可直接作为部署 sourceRoot）与宿主管理链（depcheck 三件、`hooks/hooks.json`、`setup.ps1`/`run.ps1`/`run.vbs`/`gateway-launcher.ps1`、`SKILL.md`）；`release-verify` 的 common profile 逐项强制。`node_modules` 仅对 common 的 ws 运行库豁免，业务包零豁免。
- **正式公开下载与目标宿主验证**：由已授权的 PKG-09 执行；本票脚本全部通过不代表发行已完成。
- **side-editor 的 `locate.mjs`**：与 common 单一源码逐字节一致（PKG-04 契约），内联检测白名单放行；title/app-mcp 不携带独立定位器（经 bundle 内薄适配）。

## 7. 验证证据（2026-10-20）

- 契约红绿：先红（47 用例 46 失败，"尚未实现"）后绿（47/47 通过，EXIT=0），日志 `.scratch/pkg07-red.log`、`.scratch/pkg07-green.log`。
- 真实四包构建：`.scratch/pkg07-real-build.log`（EXIT=0，problems 空，版本统一检查通过）；复跑复用 ZIP（`.scratch/pkg07-reuse-check.log`，四包摘要不变）；门禁 `.scratch/pkg07-gate.log`（绑定提交 62b59a2，无漂移）。
