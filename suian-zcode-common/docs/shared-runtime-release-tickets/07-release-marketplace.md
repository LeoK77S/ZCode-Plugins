# PKG-07：生成可追溯 ZIP 并贯通 Release 与市场清单发布

**状态**：用户已确认；已发布为 [#119](https://github.com/ONEGAYI/ZCode-Plugins/issues/119)，等待 [PKG-02（#114）](https://github.com/ONEGAYI/ZCode-Plugins/issues/114)、[PKG-03（#115）](https://github.com/ONEGAYI/ZCode-Plugins/issues/115)、[PKG-04（#116）](https://github.com/ONEGAYI/ZCode-Plugins/issues/116)、[PKG-05（#117）](https://github.com/ONEGAYI/ZCode-Plugins/issues/117)、[PKG-06（#118）](https://github.com/ONEGAYI/ZCode-Plugins/issues/118)；尚未实施。

## 问题与交付行为

源码 Git 市场不会安装依赖。需要一条可复用同一 ZIP、先公开资产后切市场、失败可续作的发布操作链；不把发布阶段变成再次构建或覆盖资产的理由。

本票交付本地组装/压缩、摘要与版本检查、候选清单生成和显式发布入口。对真实 GitHub 的写操作须另有发布授权，本票验收可先在本地和外部边界桩中完成。

## 负责模块

仓库级构建/发布脚本及锁定工具、四插件发布文件允许清单、根 marketplace.json 生成与校验、构建证据、Release 操作和对应文档。构建输出、ZIP 与运行数据不入源码 Git。

## Blocked by

- [PKG-02（#114）](https://github.com/ONEGAYI/ZCode-Plugins/issues/114)、[PKG-03（#115）](https://github.com/ONEGAYI/ZCode-Plugins/issues/115)、[PKG-04（#116）](https://github.com/ONEGAYI/ZCode-Plugins/issues/116)、[PKG-05（#117）](https://github.com/ONEGAYI/ZCode-Plugins/issues/117)、[PKG-06（#118）](https://github.com/ONEGAYI/ZCode-Plugins/issues/118)。

## 接口与约束

- 每插件一个 ZIP，根包含实际插件清单；市场 source=url、type=zip、固定 HTTPS URL、sha256、stripRoot=false，业务保留 common 依赖。
- 版本统一检查插件清单、已有 package/lock 根、自报版本与市场；不代选插件版本或 tag。
- ZIP 不包含提交 C 的自引用信息；ZIP 外的发布记录绑定 C、构建输入、工具和正式 ZIP 摘要。
- 只在显式授权后创建/发布 Release、推送 tag 或切换正式清单；仓库不可变性设置不由脚本擅自修改。
- 已发布资产不删除重传；超时先读取现状。公开下载核验前禁止切换正式市场。

## 验收条件

- [ ] 先添加错误版本、缺隐藏清单/资源、公共代码重复内联、敏感文件混入和摘要错误的失败契约。
- [ ] 正式组装目录实际解压后，清单身份、入口、资源和许可齐全；无 node_modules、源码逃逸、数据、凭据或本机路径。
- [ ] 相同输入的排序/路径/时间处理确定；一轮正式发布只生成一次 ZIP，上传/PR/合并收尾复用原字节。
- [ ] 最终提交 C 的构建输入摘要与已生成 ZIP 记录一致，门禁绑定 C 并使用该 ZIP；不要求把 C 再写入 ZIP。
- [ ] 根市场只修改受影响条目，URL/版本/摘要匹配，未变插件保留已发布 URL 与摘要。
- [ ] fixture 测试覆盖新建、同名草稿、同名已发布资产、请求结果未知、中断续作、匿名下载失败和摘要不匹配；不能覆盖现有未知内容。
- [ ] 流程先完成草稿全部资产，再公开并下载验证，最后在正式合并授权下切 master 市场；无先暴露 404 的路径。
- [ ] 安装 fixture 验证 ZIP 原生来源形状、解包根及 common 依赖集合；敏感 headers、latest URL 和私有 token 不进入市场。
- [ ] 回退使用已有旧资产和对应摘要；首次源码分发回退的 npm/link 限制写清楚。

## 验证与完成边界

使用正式候选 ZIP、临时 HTTP fixture 与 GitHub 外部边界桩，不创建真实 Release。正式公开下载和目标宿主验证由已授权的 PKG-09 执行；本票脚本通过不代表发行已完成。

首次长命令落日志，后续阶段复用同一提交/输入/工具/ZIP 的有效结果。输入发生变化才说明原因并缩小重跑范围。

## 依据

- [主规格第 6、9、12 节](../shared-runtime-release-spec.md)。
- [官方 ZIP 来源](https://github.com/zai-org/ZCode/blob/0a1fc56d279fd1001f78387bd81aec1c26767411/docs/plugin-cdn-zip-source.md)。
- [GitHub 不可变 Release](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)。
