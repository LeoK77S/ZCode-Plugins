import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileShell } from './windows.mjs';
import { buildForwardVbs, deployToastRuntime, readExecutorText, registerToastIdentity, removeToastIdentity, toastRootFor } from './toast-runtime.mjs';

// 调用方数据目录中的 vbs 只转发到缓存外稳定启动器，不再嵌入版本缓存内的命令入口；
// URI 在转发层与本协议 fix 常量精确比对，运行参数不会成为命令行拼接输入。
export function buildVbsContent({ protocol, launcherPath }) {
  return buildForwardVbs({ protocol, launcherPath });
}

export function buildProtocolCommand({ vbsPath }) {
  return `wscript.exe "${vbsPath}" "%1"`;
}

// 宿主数据路径是 <storageRoot>/data/<plugin-id>。仅保存明确安装上下文，不猜用户默认存储根。
export function resolveToastPluginsFile(pluginsFile, env = process.env) {
  if (pluginsFile) return resolve(pluginsFile);
  return env.ZCODE_PLUGIN_DATA ? join(dirname(dirname(resolve(env.ZCODE_PLUGIN_DATA))), 'installed_plugins.json') : null;
}

// 创建调用方自己的 Toast 身份；协议和通知标识由调用方提供。
// 快捷方式工作目录指向调用方数据目录（缓存外），不指向版本缓存。
const shortcutScript = ({ nodeExe, dataDir, shortcutName, description, appId }) => [
  "$ErrorActionPreference='Stop'",
  `$lnkPath=Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\${shortcutName.replace(/'/g, "''")}'`,
  "$ws=New-Object -ComObject WScript.Shell",
  "$s=$ws.CreateShortcut($lnkPath)",
  `$s.TargetPath='${nodeExe.replace(/'/g, "''")}'`,
  "$s.Arguments=''",
  `$s.WorkingDirectory='${dataDir.replace(/'/g, "''")}'`,
  `$s.Description='${description.replace(/'/g, "''")}'`,
  "$s.Save()",
  "[System.Runtime.InteropServices.Marshal]::ReleaseComObject($s)|Out-Null",
  "[System.Runtime.InteropServices.Marshal]::ReleaseComObject($ws)|Out-Null",
  "Start-Sleep -Milliseconds 500",
  "Add-Type -TypeDefinition @'",
  "using System;",
  "using System.Runtime.InteropServices;",
  "public static class AppUserModelId {",
  "  [StructLayout(LayoutKind.Sequential)] struct PROPERTYKEY { public Guid fmtid; public int pid; }",
  "  [StructLayout(LayoutKind.Explicit)] struct PROPVARIANT { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr pointer; }",
  "  [ComImport, Guid(\"886d8eeb-8cf2-4446-8d02-cdba1dbdcf99\"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]",
  "  interface IPropertyStore {",
  "    [PreserveSig] int GetCount(out uint count);",
  "    [PreserveSig] int GetAt(uint index, out PROPERTYKEY key);",
  "    [PreserveSig] int GetValue(ref PROPERTYKEY key, out PROPVARIANT value);",
  "    [PreserveSig] int SetValue(ref PROPERTYKEY key, ref PROPVARIANT value);",
  "    [PreserveSig] int Commit();",
  "  }",
  "  [DllImport(\"shell32.dll\", CharSet=CharSet.Unicode, PreserveSig=true)] static extern int SHGetPropertyStoreFromParsingName(string path, IntPtr bindContext, uint flags, ref Guid iid, out IPropertyStore store);",
  "  [DllImport(\"ole32.dll\")] static extern int PropVariantClear(ref PROPVARIANT variant);",
  "  static readonly Guid IID_IPropertyStore = new Guid(\"886d8eeb-8cf2-4446-8d02-cdba1dbdcf99\");",
  "  static readonly PROPERTYKEY PKEY_AppUserModel_ID = new PROPERTYKEY { fmtid = new Guid(\"9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3\"), pid = 5 };",
  "  public static void Set(string shortcutPath, string appId) {",
  "    IPropertyStore store;",
  "    Guid iid = IID_IPropertyStore;",
  "    int hr = SHGetPropertyStoreFromParsingName(shortcutPath, IntPtr.Zero, 2 /* GPS_READWRITE */, ref iid, out store);",
  "    if (hr != 0) Marshal.ThrowExceptionForHR(hr);",
  "    PROPERTYKEY key = PKEY_AppUserModel_ID;",
  "    PROPVARIANT value = new PROPVARIANT();",
  "    value.vt = 31;",
  "    value.pointer = Marshal.StringToCoTaskMemUni(appId);",
  "    try {",
  "      hr = store.SetValue(ref key, ref value);",
  "      if (hr != 0) Marshal.ThrowExceptionForHR(hr);",
  "      store.Commit();",
  "    } finally {",
  "      PropVariantClear(ref value);",
  "      Marshal.ReleaseComObject(store);",
  "    }",
  "  }",
  "}",
  "'@",
  `[AppUserModelId]::Set($lnkPath,'${appId.replace(/'/g, "''")}')`,
  "Write-Output AUMID_SET_OK"
].join("\n");

export async function ensureToastAppId({ dataDir, appId, shell = fileShell }) {
  const cachePath = join(dataDir, 'toast-appid.txt');
  try {
    const cached = (await shell.readText(cachePath)).trim();
    if (cached === appId) return cached;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await shell.writeText(cachePath, appId);
  return appId;
}

// 安装调用方通知资产：先部署共享 Toast 运行时（暂存校验后切换活动记录），再登记外置身份，
// 然后写调用方转发 vbs、注册协议与快捷方式。重复安装幂等；更新执行器不触碰网关。
export async function installToastAssets({ dataDir, protocol, appId, shortcutName, description, templateFile = null, pluginsFile, nodeExe = process.execPath, homeDir = homedir(), shell = fileShell }) {
  if (!dataDir || !protocol || !appId || !shortcutName) throw new Error('installToastAssets 需要 dataDir/protocol/appId/shortcutName');
  await shell.mkdir(dataDir);
  const toastRoot = toastRootFor(homeDir);
  const runtime = await deployToastRuntime({ homeDir, nodeExe, executorText: await readExecutorText(), shell });
  const identity = await registerToastIdentity({ homeDir, protocol, appId, dataDir, pluginsFile: resolveToastPluginsFile(pluginsFile), description, templateFile, shell });
  const vbsPath = join(dataDir, 'toast-launch.vbs');
  const desired = buildVbsContent({ protocol, launcherPath: join(toastRoot, 'launch.vbs') });
  let current = null;
  try { current = await shell.readText(vbsPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let vbsAction;
  if (current === desired) vbsAction = 'unchanged';
  else { await shell.writeText(vbsPath, desired); vbsAction = 'written'; }
  const command = buildProtocolCommand({ vbsPath });
  await shell.run('reg.exe', ['add', `HKCU\\Software\\Classes\\${protocol}`, '/ve', '/d', 'URL:' + description, '/f']);
  await shell.run('reg.exe', ['add', `HKCU\\Software\\Classes\\${protocol}`, '/v', 'URL Protocol', '/d', '', '/f']);
  await shell.run('reg.exe', ['add', `HKCU\\Software\\Classes\\${protocol}\\shell\\open\\command`, '/ve', '/d', command, '/f']);
  await shell.ps(shortcutScript({ nodeExe, dataDir, shortcutName, description, appId }));
  await ensureToastAppId({ dataDir, appId, shell });
  return { ok: true, appId, actions: { vbs: vbsAction, protocol: 'ensured', shortcut: 'ensured', appId: 'cached', runtime: runtime.action, identity: identity.action } };
}

// 卸载只清理归属匹配的自身协议、快捷方式、vbs、AppID 缓存与外置身份描述；
// 共享运行目录（执行器/启动器/活动记录）、另一调用方身份与网关不受影响。
export async function removeToastAssets({ dataDir, protocol, shortcutName, homeDir = homedir(), shell = fileShell }) {
  await shell.run('reg.exe', ['delete', `HKCU\\Software\\Classes\\${protocol}`, '/f']);
  await shell.ps(['$ErrorActionPreference=\'Stop\'', `Remove-Item -LiteralPath (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\${shortcutName.replace(/'/g, "''")}') -ErrorAction SilentlyContinue`].join("\n"));
  await shell.remove(join(dataDir, 'toast-launch.vbs'));
  await shell.remove(join(dataDir, 'toast-appid.txt'));
  if (protocol) await removeToastIdentity({ homeDir, protocol, shell });
  return { ok: true };
}
