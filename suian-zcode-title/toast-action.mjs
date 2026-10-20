#!/usr/bin/env node
// suian-zcode-title://fix 协议入口（PKG-06 稳定化后的缓存内调试入口）：
// 部署链已改走缓存外公共执行器（共享 Toast 运行时），本文件保留供手动排障直调。
// 动作语义与公共执行器一致：读外置模板与当前安装条目根，缺失时明确说明，不输出旧根。
import { appendFile, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { TOAST_TEMPLATE_FILE, renderFixPrompt, resolveTitleInstallRoot } from "./toast.mjs";
import { commonRuntime } from "./common-access.mjs";

export function parseActionUri(uri) {
  const match=/^suian-zcode-title:\/\/([a-z]+)$/i.exec(String(uri??""));
  return match?{action:match[1].toLowerCase()}:null;
}

export async function runAction({uri,dataDir,pluginsFile,homeDir,setClipboard,openWorkspace}) {
  const parsed=parseActionUri(uri);
  if(!parsed)return{ok:false,reason:"invalid_uri"};
  if(parsed.action!=="fix")return{ok:false,reason:"unknown_action"};
  let template;
  try {
    template=await readFile(join(dataDir,TOAST_TEMPLATE_FILE),"utf8");
  } catch(error) {
    if(error.code==="ENOENT")return{ok:false,reason:"template_missing"};
    throw error;
  }
  const installRoot=await resolveTitleInstallRoot({pluginsFile,homeDir});
  const prompt=renderFixPrompt({template,installRoot,dataDir});
  const {copyPromptAndOpenWorkspace}=await commonRuntime();
  await copyPromptAndOpenWorkspace({prompt,dataDir,setClipboard,openWorkspace});
  return{ok:true,action:"fix"};
}

const isMain=process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href;
if(isMain) {
  const dataDir=process.argv[3]??process.env.OIL_ZCODE_TITLE_DATA??join(homedir(),".zcode","suian-zcode-title");
  const logAction=entry=>appendFile(join(dataDir,"toast-action-log.jsonl"),JSON.stringify({at:new Date().toISOString(),...entry})+"\n","utf8").catch(()=>{});
  runAction({uri:process.argv[2],dataDir})
    .then(async result=>{
      console.log(JSON.stringify(result));
      await logAction({uri:process.argv[2],ok:result.ok,reason:result.reason??null});
      process.exit(result.ok?0:1);
    })
    .catch(async error=>{
      console.log(JSON.stringify({ok:false,reason:"error",detail:error.message}));
      await logAction({uri:process.argv[2],ok:false,reason:"error",detail:String(error.message).slice(0,200)});
      process.exit(1);
    });
}
