# 工件面板增强：新增议题分类

本地标识：AP-01。GitHub Issue：[#67](https://github.com/ONEGAYI/ZCode-Plugins/issues/67)。

## 问题与交付

任务关联的 GitHub 议题目前无处登记：pr/link/session/file 四类没有议题的位置，Agent 只能把议题塞进 link，面板上与普通链接混排，注入摘要也不为它保留保底名额。

交付后，`set_artifacts` 接受 `kind: issue`（ref 为 HTTP(S) URL，校验同 pr/link）；`get_artifacts` 列表、统计与详情识别该类，详情超链接行为与 pr/link 一致；注入摘要的统计行与分类统计包含 issue，且按现有 by_kind 机制自动获得每类 3 条保底名额；面板出现"议题"分组（含空态文案）与专属默认 logo，分组位置紧随 PR 之后（分组顺序：PR、议题、会话、文件、链接）；工具描述、skills/artifacts 技能与 artifact-zone-design 的 kind 契约同步提及议题。

## 负责范围

工件校验与统计、set/get 工具枚举与描述、注入提示文案、面板分组与默认图标、相关文档契约同步。

## 验收条件

- [ ] `set_artifacts` upsert `kind: issue` 且 ref 为 HTTP(S) URL 成功；非 HTTP(S) ref 整批拒绝，报错文案与 pr/link 一致。
- [ ] `get_artifacts` 列表与 `by_kind` 统计含 issue；详情返回超链接（同 pr/link 语义）。
- [ ] UserPromptSubmit 注入的工件统计行含 `issue N`；议题条目数不少于 4 时保底注入最新 3 条，与其它分类并存时总额/字符预算行为不回退（沿用现有 20 条与 9000 字符约束）。
- [ ] 面板渲染"议题"分组：空态文案、条目默认 logo 与 pr/link/file/session 视觉可区分；分组顺序为 PR、议题、会话、文件、链接（议题紧随 PR）。
- [ ] `set_artifacts` 工具描述、skills/artifacts/SKILL.md、docs/artifact-zone-design.md 的 kind 枚举与示例同步更新，不再写"四类"。

## Blocked by

无，可立即开始。

## 设计要点

不新增注入逻辑：保底名额由 `by_kind` 键驱动，issue 进入枚举后自动生效。本票只交付分类与默认图标，实时状态与评论数由 [#70](https://github.com/ONEGAYI/ZCode-Plugins/issues/70) 在其上叠加。
