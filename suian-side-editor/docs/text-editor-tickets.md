# suian-side-editor 开票索引

日期：2026-10-12，当前状态更新至2026-10-14。已创建原11票及新[SE-11／#57](https://github.com/ONEGAYI/ZCode-Plugins/issues/57)；#42／46／47／48与#57保持open，文本功能SE-00／01／03／04／05已满足各自本地限定条件。当前side-editor 0.2.0／common 0.1.2准备集成，f6评论代码的SDK55／浏览器65和common98已有限定通过证据，两项可修P2闭合；最终新缓存／guest尚未执行。未观察受理后取消导致A+B复活是原#47缺口，未豁免或自动归入#57；用户接受的是发送边界尽力禁用风险。当前分层事实见[评论验证](comment-guard-verification.md)和[实施总记录](development-verification.md)，旧记录保留其时点。

实施启动：用户已要求在规格工作树按 implement-spec 执行。统一集成分支为 codex/side-editor-plan，实际基线已核对到 dev 的 b48e8a4；该提交与规划起点 403f877 的文件树一致。单票使用独立子工作树，合并由专门代理串行验证；当前实施不自动包含后续 SE-09／10 或完整 SE-11；SE-11 能力调查可独立推进，实际完整实现另按届时授权。

需求共识与 [首版规格](text-editor-spec.md) 已由用户整体确认，见 [设计澄清](design-discussion.md)。完整规格与公开索引附于 [#40](https://github.com/ONEGAYI/ZCode-Plugins/issues/40)，SE 标识继续用于本地规划，实际编号如下。

## 票与依赖

当前交付共 9 票，其中一张必要准备重构、一张公开接口与临时方案调查票；另有 2 张原有后续特性及 1 张新拆出的完整原生并发特性。

| 本地标识 | GitHub | 交付行为 | Blocked by | 当前状态 |
| --- | --- | --- | --- | --- |
| [SE-00](issues/00-shared-ui-capability.md) | [#40](https://github.com/ONEGAYI/ZCode-Plugins/issues/40) | 提取现有原生 UI 能力判定，保持工件插件行为 | 无 | 本地实现、集成与两轴审查通过 |
| [SE-01](issues/01-sidebar-context-and-read.md) | [#41](https://github.com/ONEGAYI/ZCode-Plugins/issues/41) | 从独立侧栏冷启动，可信绑定当前工作区并读取文本 | #40 | 本地实现、H1/H2 实测与两轴复核通过 |
| [SE-02](issues/02-main-composer-capability.md) | [#42](https://github.com/ONEGAYI/ZCode-Plugins/issues/42) | 核实公开状态、尽力禁用及已接受风险 | #41 | 公开V4 A普通/B排队全文JSON与API审批probe通过，最终guest未验；完整同步保证未满足，保持open |
| [SE-03](issues/03-tree-tabs-and-manual-save.md) | [#43](https://github.com/ONEGAYI/ZCode-Plugins/issues/43) | 浏览目录、打开临时或固定文件页并手动编辑保存 | #41 | 本地代码、整合、限定 Native 烟测与两轴复核通过 |
| [SE-04](issues/04-save-mode-and-conflicts.md) | [#44](https://github.com/ONEGAYI/ZCode-Plugins/issues/44) | 持久化会话保存模式，自动保存并处理外部修改 | #43 | 本地限定条件、代码／文档两轴、Native 分层证据及整合通过；视觉与用户验收未过 |
| [SE-05](issues/05-durable-editor-recovery.md) | [#45](https://github.com/ONEGAYI/ZCode-Plugins/issues/45) | 恢复打开页、未保存正文、焦点页面与阅读位置 | #44 | 代码／文档两轴、SDK37／浏览器55和H4通过，本地限定条件已满足；不等于用户验收 |
| [SE-06](issues/06-selection-comment-context.md) | [#46](https://github.com/ONEGAYI/ZCode-Plugins/issues/46) | 将完整的选区评论快照加入当前主对话胶囊 | #42、#43 | 快照、胶囊及全部入口尽力禁用已实现，复用f6 SDK55／浏览器65限定证据；最终缓存／guest未验，open |
| [SE-07](issues/07-send-cleanup-and-concurrent-comments.md) | [#47](https://github.com/ONEGAYI/ZCode-Plugins/issues/47) | 正常／失败／排队及缓存清理，公开状态尽力禁用评论 | #46，#42 调整条件 | 已观测证明保留／订阅释放两项P2闭合；未观察受理后取消case仍首红，原条件未满足、未豁免，open |
| [SE-08](issues/08-package-and-end-to-end-acceptance.md) | [#48](https://github.com/ONEGAYI/ZCode-Plugins/issues/48) | 安装包与调整范围后的端到端验收 | #45、#47，#42 调整条件 | 评论闭环与正式安装未验；H4 已有限定证据；不等待完整 SE-11 |
| [SE-09](issues/09-future-remote-workspace.md) | [#49](https://github.com/ONEGAYI/ZCode-Plugins/issues/49) | 后续特性：远程工作区文本编辑 | #48 | 后续待做 |
| [SE-10](issues/10-future-file-management.md) | [#50](https://github.com/ONEGAYI/ZCode-Plugins/issues/50) | 后续特性：新建、重命名与删除文件 | #48 | 后续待做 |
| [SE-11](issues/11-native-concurrent-comment-feature.md) | [#57](https://github.com/ONEGAYI/ZCode-Plugins/issues/57) | 完整原生并发：在途追加、精确批次清理、移除临时禁用 | 实际集成依赖 #46、#47；公开能力调查可独立推进 | 用户要求拆出的完整特性，尚未实现／验收，当前尽力路径通过不代表完成 |

SE-00 是与功能分开的必要小重构。SE-01 建立原生入口和可信文件读取；SE-03／04／05 提供可独立验证的编辑、保存及恢复路径，不被评论能力调查阻断。

**当前按最新风险授权推进**：用户已接受发送边界残余风险，SE-02 核实实际公开状态和尽力禁用限制，SE-06／07／08 不再等待原 H3 完整并发或同步／原子状态接口。状态可能迟到、受理后恢复可能早于 Renderer 清理；若用 running 保守代理，可能整个回复期间锁定，必须明示。

实际完整字段、可信归属、全部入口禁用／tooltip／草稿保留和已观测受理路径已有本地契约，最终缓存／guest与完整闭环仍待；未观察受理后取消不是风险授权的豁免项。SE-11保留完整同步pending／消费批次和原生在途追加，当前调整不等于完整能力或用户验收。

## 依赖图

```mermaid
flowchart TD
  S00["SE-00 公共能力判定"] --> S01["SE-01 侧栏入口与可信读取"]
  S01 --> S02["SE-02 公开状态与尽力禁用核实"]
  S01 --> S03["SE-03 目录、页签与手动保存"]
  S03 --> S04["SE-04 保存模式与外部冲突"]
  S04 --> S05["SE-05 重启恢复"]
  S02 -->|"当前公开接口与调整条件"| S06["SE-06 评论快照与主对话胶囊"]
  S03 --> S06
  S06 --> S07["SE-07 清理与尽力禁用"]
  S05 --> S08["SE-08 安装包与当前交付验收"]
  S07 --> S08
  S08 --> S09["SE-09 后续远程编辑"]
  S08 --> S10["SE-10 后续文件管理"]
  S06 --> S11["SE-11 完整原生并发与移除临时禁用"]
  S07 --> S11
```

一种有效顺序为 SE-00 → SE-01 → SE-02／SE-03 → SE-04 → SE-05 → SE-06 → SE-07 → SE-08。此处两条分支独立仅表示依赖关系，不自动授权多个 Agent、修改主工作树或运行宿主写探针。

## 发布与实施约定

2026-10-12 已核对现有标签。既有 11 票均使用 enhancement，能力调查 #42 另加 question；保留现有标签与 open 状态。2026-10-13 根创建 #57 时使用 enhancement／wait-for-upstreaming，完整宿主能力未满足；文档拆分不擅自增删旧票标签或关票。

- 发布票前读取现有 GitHub 标签，不自动创建标签体系。依赖未满足不标 ready-for-agent。
- GitHub 票附可访问的完整规格或实际规格票引用；不能只链接尚未推送的本地文档，不猜实际 Issue 编号。
- 首张 #40 已附完整规格，其余票引用该实际编号；原轮未额外创建规格父票，共发布 11 票；本次另建 SE-11，实际新票为 #57，并为新票及旧 #42／46／47／48 提供本次完整独立正文。
- 发布按拓扑顺序进行；保留父票，不关闭或改写已有工件区票。
- SE-09／10 保留后续待做；SE-11 是独立完整特性，不列入当前尽力禁用交付验收，不默认开始完整实现。
- 创建票不等于实施、推送、建 PR、正式合入 master 或发布版本的授权。
- 代码开发在独立工作树基于开发分支推进；不切换用户主工作树。正式集成时按实际影响同步版本。
- 具体流程见 [开票约定](agents/issue-tracker.md)。

## 已批准的工程选型

CodeMirror 6 用于浏览器文本编辑；插件自有 SQLite 保存模式与恢复状态，见 [ADR 0004](adr/0004-editor-owned-sqlite-state.md)。公共层只提取已存在且确实重复的能力判定；原 Host 订阅扩展须由 SE-02 核实的实际接口需要决定。当前评论范围调整见 [ADR 0005](adr/0005-temporary-comment-send-guard.md)。

本索引不宣称接口缺口已解决，也不把技术验证表述为用户验收。
