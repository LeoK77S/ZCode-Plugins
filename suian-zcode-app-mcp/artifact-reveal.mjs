import { spawn } from 'node:child_process';
import { stat as fsStat } from 'node:fs/promises';
import { dirname } from 'node:path';

// explorer.exe 把操作委托给已运行的资源管理器实例后立即退出，退出码 1 是常态而非失败
// （microsoft/WSL#6565 等多方核实）；真实成败无法从退出码区分，可靠性来自执行前的 stat 探测
// （缺失路径已在探测层拒绝），这里只把脱离常规语义的 0/1 视为已启动。open 与 xdg-open
// 是行为正常的控制台程序，仅退出码 0 视为成功。
const ACCEPTED_EXIT = { win32: new Set([0, 1]), darwin: new Set([0]), linux: new Set([0]) };

/**
 * 按平台与条目形态构造文件管理器命令：文件打开所在目录并选中（Linux 无统一选中语法，
 * 尽力打开所在目录），文件夹打开自身。未知平台没有可用命令。
 */
function revealCommand(platform, path, isDirectory) {
  if (platform === 'win32') return { file: 'explorer', args: isDirectory ? [path] : ['/select,' + path] };
  if (platform === 'darwin') return { file: 'open', args: isDirectory ? [path] : ['-R', path] };
  if (platform === 'linux') return { file: 'xdg-open', args: [isDirectory ? path : dirname(path)] };
  throw Object.assign(new Error(`reveal_unsupported: 平台 ${platform} 没有可用的文件管理器打开命令`), { code: 'reveal_unsupported' });
}

/** 真实子进程：退出码 0 resolve；非零退出、启动失败或中止时 reject（附 exitCode）。 */
function runRevealProcess(file, args, { signal }) {
  return new Promise((resolve, reject) => {
    let stderr = '', settled = false;
    let child;
    try { child = spawn(file, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, signal }); }
    catch (error) { reject(error); return; }
    const finish = error => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.on('error', finish);
    child.on('close', code => finish(code === 0 ? undefined
      : Object.assign(new Error(stderr.trim() || `${file} 退出码 ${code}`), { exitCode: code })));
  });
}

/**
 * 面板专用本机定位服务：把已登记的 file 工件路径交给系统文件管理器。执行前自行 stat 探测——
 * 仅 ENOENT 判缺失并拒绝（artifact_missing），权限等其它错误与 probeFileStates 一致按存在降级、
 * 沿用文件语义；命令非零退出（超出平台接受集）、无法启动或超时按 reveal_failed/reveal_timeout 回报。
 * 调用方（artifact-tools）负责权限边界：仅当前会话工件表命中的 file 条目才到达这里。
 */
export function createArtifactRevealService({ platform = process.platform, stat = fsStat, run = runRevealProcess, timeoutMs = 10000 } = {}) {
  return {
    /** 打开 path：文件=所在目录并选中，文件夹=自身。返回探测形态与执行平台。 */
    async reveal(path) {
      let isDirectory = false;
      try { isDirectory = (await stat(path)).isDirectory(); }
      catch (error) {
        if (error.code === 'ENOENT') throw Object.assign(new Error(`artifact_missing: 路径不存在：${path}`), { code: 'artifact_missing' });
        // 非 ENOENT（权限、网络盘等）按存在降级，目录未知沿用文件语义
      }
      const { file, args } = revealCommand(platform, path, isDirectory);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try { await run(file, args, { signal: controller.signal }); }
      catch (error) {
        if (controller.signal.aborted) throw Object.assign(new Error(`reveal_timeout: 打开命令超时（${timeoutMs}ms）`), { code: 'reveal_timeout' });
        if (!ACCEPTED_EXIT[platform]?.has(error.exitCode)) {
          throw Object.assign(new Error(`reveal_failed: ${error.message}`), { code: 'reveal_failed' });
        }
      } finally { clearTimeout(timer); }
      return { is_directory: isDirectory, platform };
    }
  };
}
