// 公共安装期入口（PKG-01）：业务安装/诊断命令使用的支持函数。
// 与 client.mjs 分开，保证运行期入口不携带安装器代码。
export { checkRuntime } from './prerequisites.mjs';
export { fileShell } from './windows.mjs';
export { buildVbsContent, buildProtocolCommand, ensureToastAppId, installToastAssets, removeToastAssets } from './notification-install.mjs';
export { toastRootFor, deployToastRuntime, registerToastIdentity, removeToastIdentity, checkToastRuntime } from './toast-runtime.mjs';
