// 发布布局解析（PKG-02）：同一份源码服务两种运行形态——
// 源码模式（命令入口与资源同在插件根）与发布模式（命令入口 bundle 位于发布根的 dist/，
// 提示词、技能、Hook 清单与插件清单留在发布根）。发布根的判定依据是上级目录存在
// release.json，不依赖环境变量或硬编码层级，也不能用 bundle 所在目录解释旧源码相对路径。
import {statSync} from "node:fs";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";

export function resolvePluginLayout(entryUrl=import.meta.url) {
  const entryDir=dirname(fileURLToPath(entryUrl));
  const parent=resolve(entryDir,"..");
  let bundled=false;
  try {bundled=statSync(join(parent,"release.json")).isFile();}catch {}
  return bundled
    ?{root:parent,entryDir,bundled:true,entrySubdir:"dist"}
    :{root:entryDir,entryDir,bundled:false,entrySubdir:""};
}

// 用户级 Stop Hook 命令指向的入口：源码模式在插件根，发布模式在发布根的 dist/。
export const hookEntryPath=layout=>join(layout.root,layout.entrySubdir,"hook.mjs");
