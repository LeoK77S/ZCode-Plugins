# sources — 上游源码引用（submodule）

研究用的第三方仓库，以 git submodule 引用固定提交，**不入库源码、只读、不 fork、不修改**。

| 路径 | 上游 | 钉定提交 | 用途 |
|------|------|----------|------|
| `official-zcode/` | [zai-org/ZCode](https://github.com/zai-org/ZCode) | `3c5b2276`（2026-10-20 公开快照，package.json 自报 v3.16.2，包含 Relay V2） | ZCode 官方源码：hooks、协议、Runtime、app-server、插件 UI（MCP Apps） |
| `zcode-open-bridge/` | [tizerluo/zcode-open-bridge](https://github.com/tizerluo/zcode-open-bridge) | `e8bd9bc` | 社区 MCP/ACP 桥接参考：它启动自己的 app-server，不接管桌面已有会话 |

克隆主仓库后按需获取：

```bash
git submodule update --init sources/official-zcode
git submodule update --init sources/zcode-open-bridge
```

上游于 2026-10-20 更新主分支，最新快照为 [`3c5b2276`](https://github.com/zai-org/ZCode/commit/3c5b227649371507ddc4eb46ac5133afe6db1cab)（package.json 自报 3.16.2），公开 tag 仍为 v3.15.1。快照包含 Relay V2、侧栏完整视图，以及插件页面收起滞留的修复（本仓库 #73：`PluginUiCard` 收起时同步解绑锚点，`pluginUiPagePlane` 候选过滤强化）；不能将主分支快照直接等同于 3.16.2 发布 tag。NOTICE 对公开范围有限制。

本机安装已升级至 3.16.2（#73 滞留缺陷已随 3.16 修复并验收关闭）；3.16.1 便携运行包采用独立数据目录验证。新协议、网关实验和验证范围见[3.16 网关验证记录](../suian-zcode-app-mcp/docs/zcode-3.16-gateway-validation.md)。历史源码依据见 `suian-zcode-app-mcp/docs/research-findings.md`。
