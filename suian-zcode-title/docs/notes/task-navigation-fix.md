# 未登记工作区会话的附着失败与 web 端打开超时：排查与修复

排查日期：2026-10-21。工单 #132。修复分支 `fix/rpc-task-navigation`。

## 现象与根因链

两个症状同源。无项目 draft 会话（归属目录 `~/.zcode/workspace/draft-<uuid>`）从未在 Desktop 窗口登记为工作区，而上游远控 bootstrap 的工作区列表只含窗口登记项；我方网关 `rpc-broker.mjs` 又把这个列表当作 attach 与手机建桥的唯一准入边界，且 `ensureHost` 发起的 `workspace-bridge-open` 只透传 `project`、丢弃任务字段。由此：

- **自动更名失败**：Stop worker 经 `/rpc` attach，列表未命中即被拒（`Requested local workspace is not open in the Desktop window`，约 140ms 快速失败）。属结构性拒绝而非瞬态——除非该 draft 目录曾被窗口登记（实测列表可含已登记 draft，这也是个别 draft 会话曾更名成功的原因）。
- **web 端打开超时**：web 远控页面点击会话发出带 `taskId`/`taskHostId` 的 `workspace-bridge-open`，网关 `phoneOpen` 直接拒绝且不转发宿主（宿主日志零 bridge 记录佐证）；宿主侧会话控制面却经既有桥的任务读取通道被拉起，事件无消费者全部丢弃，页面每 10 秒超时重试，循环拉起控制面并连带触发 Stop 钩子产生成批更名失败记录。

关键上游事实（`sources/official-zcode` 3.16.2 快照）：`buildWorkspaceBridge` 对带 `taskHostId + taskId` 的建桥请求走 `prepareProjectWorkspace` 任务导航，不查窗口列表；`createProjectWorkspaceNavigation` 的 local 分支按 taskId+workspaceKey 匹配任务并解析归属目录。即上游本可打开此类会话，是我方网关挡得更死。

## 红绿探针

- 生产网关 attach 红绿：未登记 draft 拒绝 / 窗口工作区附着成功；附着回包直接观测列表实况（含已登记 draft、不含目标 draft）。
- 离线 `createRpcBroker.phoneOpen` 红绿（部署版字节）：web 真实帧形态（含 `taskHostId: 'local'`）被拒且从不向 Desktop 转发；列表内工作区放行转发。

## 修复与验证

透传而非自研导航：`ensureHost` 建桥时透传 `{ taskId, taskHostId }`；local `attach` 在列表未命中且带会话身份时改走任务导航并经 `getTaskMeta` 复核归属；`phoneOpen` 对 local 任务主机的未登记请求进入导航分支（新桥由宿主导航解析目录，桥复用时复核任务归属后才放行）。无任务身份、或非 local 任务主机的未登记请求维持拒绝。

验证：`gateway-rpc.test.mjs` 新增 7 条契约用例（导航附着、手机新桥导航、桥复用归属复核、无身份双路径拒绝、非 local 拒绝、复核不符拒绝、导航失败错误回传）；common 全量 256/256 通过；title 回归 101/102（唯一失败为基线既有的环境耦合用例，与本改动无关）。

## 残留事项

- web 端收到网关 `workspace-bridge-error` 后表现为持续加载而非错误提示，属 web 前端行为，未逐帧闭环；修复上线后建议在 web 端实测一次未登记会话的打开与自动更名。
- 非 local 任务主机（SSH/远程 host）的未登记会话打开暂维持拒绝，如需支持须先设计 passthrough 与远端桥的交互。
