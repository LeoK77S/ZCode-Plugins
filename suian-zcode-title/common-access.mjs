// title 的 common 薄适配层（PKG-02）：业务公共导入统一经 locate.mjs 定位安装记录中的
// common 发布目录后动态加载，源码不再出现 suian-zcode-common/* 裸导入（构建产物因此
// 不需要 node_modules 查找）。运行期（client）与安装期（client-install）入口分离；
// 首次成功加载冻结本进程的 common 根与 buildId，失败不缓存、可在下一入口重试。
// locate.mjs 是 common 提供的薄定位器单一源码，构建时作为唯一允许的 common 输入分发进产物。
import {dirname,join,resolve} from "node:path";
import {loadCommonModule} from "../suian-zcode-common/locate.mjs";

export const EXPECTED_COMMON_API_VERSION=1;
// client / client-install 双入口随 common 0.5.0 正式分发，低于配套发布版本拒绝加载。
export const MINIMUM_COMMON_VERSION="0.5.0";

let runtimePromise,installerPromise;

const compat=options=>({
  expectedCommonApiVersion:EXPECTED_COMMON_API_VERSION,
  minimumCommonVersion:MINIMUM_COMMON_VERSION,
  ...options
});

// 入口加载返回 common 模块本身（root/buildId 等定位信息在首次加载时已校验并冻结）。
export function commonRuntime(options={}) {
  runtimePromise??=loadCommonModule("client",compat(options)).then(loaded=>loaded.module,error=>{runtimePromise=undefined;throw error;});
  return runtimePromise;
}

export function commonInstaller(options={}) {
  installerPromise??=loadCommonModule("client-install",compat(options)).then(loaded=>loaded.module,error=>{installerPromise=undefined;throw error;});
  return installerPromise;
}

// 无宿主注入（ZCODE_PLUGIN_DATA）的入口（技能命令、独立 CLI）按以下优先级显式提供位置：
// commonRoot（源码调试）> ZCODE_PLUGIN_DATA（定位器按宿主锚点推导）> installedPlugins >
// 配置文件的 installedPluginsPath。都不存在时交回定位器报 anchor_missing，不拼默认用户目录。
export function commonAnchorOptions({commonRoot,installedPlugins,env=process.env,config={}}={}) {
  if(commonRoot)return{commonRoot:resolve(commonRoot)};
  if(env.ZCODE_PLUGIN_DATA)return{};
  const installed=installedPlugins??config.installedPluginsPath;
  return installed?{installedPluginsPath:resolve(installed)}:{};
}

// 官方数据目录布局：<storageRoot>/data/<sanitized-plugin-id>，上两级即存储根。
// 安装器据此把宿主注入换算成安装记录路径写进外置配置，供无注入的后续 CLI 使用。
export const registryPathFromDataPath=dataPath=>join(dirname(dirname(dataPath)),"installed_plugins.json");
