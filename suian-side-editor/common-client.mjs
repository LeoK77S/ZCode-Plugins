// 业务薄适配模块（PKG-01 契约）：本插件对公共 common 的导入统一经此加载已安装的
// 公共客户端入口。locate.mjs 是构建时从 ../suian-zcode-common/locate.mjs 复制的副本
//（单一源码，构建前逐字节校验），只依赖 Node 内置模块。
// 导入本模块不触发定位或任何公共副作用；首次调用 commonClient() 时按定位契约加载，
// 成功后冻结本进程的 common 根与 buildId，之后注册表变化不热换，升级经新进程生效。
import { loadCommonModule } from './locate.mjs';

// 第一代公共 API 为 1；与本包兼容的公共客户端声明同一代际。
// client 双入口自 common 0.4.2（PKG-01）起提供，低于该版本拒绝加载。
export const EXPECTED_COMMON_API_VERSION = 1;
export const MINIMUM_COMMON_VERSION = '0.4.2';

let ready;
let frozenModule;

export function commonClient(options = {}) {
  // 展开为“公共导出 + 加载元信息”单个对象：调用点直接使用 readProjectContext 等成员，
  // commonRoot/commonBuildId 保留定位证据；后续入口沿用首次冻结结果。
  ready ??= loadCommonModule('client', { expectedCommonApiVersion: EXPECTED_COMMON_API_VERSION, minimumCommonVersion: MINIMUM_COMMON_VERSION, ...options })
    .then(({ module, root, buildId, pluginVersion, commonApiVersion }) => {
      frozenModule = module;
      return { ...module, commonRoot: root, commonBuildId: buildId, commonPluginVersion: pluginVersion, commonApiVersion };
    });
  return ready;
}

// 供同步初始化路径（工具与资源注册、宿主能力判定）使用；入口进程必须先 await
// commonClient() 再创建服务，否则此处为 null 并显式失败，不静默降级。
export function commonClientSync() {
  return frozenModule;
}
