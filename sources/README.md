# sources — 上游源码引用（submodule）

研究用的第三方仓库，以 git submodule 引用固定提交，**不入库源码、只读、不 fork、不修改**。

| 路径 | 上游 | 钉定提交 | 用途 |
|------|------|----------|------|
| `official-zcode/` | [zai-org/ZCode](https://github.com/zai-org/ZCode) | `0a1fc56d`（2026-10-19 公开快照，包含 Relay V2） | ZCode 官方源码：hooks、协议、Runtime、app-server、插件 UI（MCP Apps） |
| `zcode-open-bridge/` | [tizerluo/zcode-open-bridge](https://github.com/tizerluo/zcode-open-bridge) | `e8bd9bc` | 社区 MCP/ACP 桥接参考：它启动自己的 app-server，不接管桌面已有会话 |

克隆主仓库后按需获取：

```bash
git submodule update --init sources/official-zcode
git submodule update --init sources/zcode-open-bridge
```

上游于 2026-10-19 更新主分支，最新快照为 [`0a1fc56d`](https://github.com/zai-org/ZCode/commit/0a1fc56d279fd1001f78387bd81aec1c26767411)，公开 tag 仍为 v3.15.1。快照已包含 Relay V2；不能将主分支快照直接等同于 3.16.1 发布 tag。NOTICE 对公开范围有限制。

本机既有安装保持 3.15；3.16.1 便携运行包采用独立数据目录验证。新协议、网关实验和验证范围见[3.16 网关验证记录](../suian-zcode-app-mcp/docs/zcode-3.16-gateway-validation.md)。历史源码依据见 `suian-zcode-app-mcp/docs/research-findings.md`。
