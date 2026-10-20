#!/usr/bin/env node
// 迁移状态记录与恢复（PKG-08）：从旧源码/旧缓存安装迁移到发布形态的操作链中，
// 负责"先记录开关和路径、迁移后恢复原状态"的数据部分。服务与通知的安全部署由
// PKG-05/06 既有入口（setup.ps1、deployToastRuntime）完成，Hook/MCP 的旧注册迁移由
// 各业务安装器的 --legacy-root 参数完成；本模块不触碰系统对象，只读写 JSON 文件。
// 迁移记录不含凭据：网关 config 只记路径、模式与端口，不复制 control_token。
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

async function readJsonOptional(path) {
  try { return { status: 'ok', value: JSON.parse(await readFile(path, 'utf8')) }; }
  catch (error) { return { status: error.code === 'ENOENT' ? 'missing' : 'bad', value: null }; }
}

// 旧 title 外置配置的 enabled 语义：未写该字段时为旧版默认启用（true）。
function readTitleSwitch(configRead) {
  if (configRead.status !== 'ok' || !configRead.value || typeof configRead.value !== 'object') {
    return { titleEnabled: null, titleEnabledDefined: null, titleModel: null };
  }
  const enabledDefined = Object.prototype.hasOwnProperty.call(configRead.value, 'enabled');
  return {
    titleEnabled: enabledDefined ? (configRead.value.enabled === true) : true,
    titleEnabledDefined: enabledDefined,
    titleModel: typeof configRead.value.model === 'string' ? configRead.value.model : null,
  };
}

function readGatewaySnapshot(configRead) {
  if (configRead.status !== 'ok' || !configRead.value || typeof configRead.value !== 'object') {
    return { configured: false };
  }
  // 只记录模式与端口供迁移后核对；令牌等敏感字段不进入迁移记录。
  return {
    configured: true,
    mode: typeof configRead.value.mode === 'string' ? configRead.value.mode : null,
    port: typeof configRead.value.port === 'number' ? configRead.value.port : null,
  };
}

// 记录旧安装的关键状态。recordPath 建议放在版本缓存之外的私有目录；重复执行幂等覆盖。
export async function captureLegacyState({ legacyRoot, titleConfigPath, gatewayConfigPath, recordPath, now = () => new Date() }) {
  if (!recordPath) throw new Error('captureLegacyState 需要 recordPath');
  const titleRead = titleConfigPath ? await readJsonOptional(resolve(titleConfigPath)) : { status: 'missing', value: null };
  const gatewayRead = gatewayConfigPath ? await readJsonOptional(resolve(gatewayConfigPath)) : { status: 'missing', value: null };
  if (titleConfigPath && titleRead.status === 'bad') throw new Error(`旧命名配置不是合法 JSON：${titleConfigPath}`);
  if (gatewayConfigPath && gatewayRead.status === 'bad') throw new Error(`网关配置不是合法 JSON：${gatewayConfigPath}`);
  const record = {
    formatVersion: 1,
    capturedAt: now().toISOString(),
    paths: {
      legacyRoot: legacyRoot ? resolve(legacyRoot) : null,
      titleConfig: titleConfigPath ? resolve(titleConfigPath) : null,
      gatewayConfig: gatewayConfigPath ? resolve(gatewayConfigPath) : null,
    },
    switches: readTitleSwitch(titleRead),
    gateway: readGatewaySnapshot(gatewayRead),
  };
  await mkdir(dirname(resolve(recordPath)), { recursive: true });
  const staging = `${resolve(recordPath)}.tmp-${randomUUID().slice(0, 8)}`;
  await writeFile(staging, JSON.stringify(record, null, 2) + '\n', 'utf8');
  await rename(staging, resolve(recordPath));
  return record;
}

// 按记录恢复原开关：目标配置缺 enabled 字段时写入记录值；已有字段视为用户显式选择，
// 不覆盖。其余字段一律不触碰（自定义字段保留）。记录缺失时拒绝猜测。
export async function restoreLegacyState({ recordPath, titleConfigPath }) {
  const recordRead = await readJsonOptional(resolve(recordPath));
  if (recordRead.status === 'missing') throw new Error(`迁移记录不存在：${recordPath}；先执行 capture，不凭猜测恢复开关`);
  if (recordRead.status !== 'ok' || recordRead.value?.formatVersion !== 1) throw new Error(`迁移记录不可用：${recordPath}`);
  const record = recordRead.value;
  const result = { titleEnabled: { action: 'not_recorded' } };
  if (record.switches?.titleEnabled === null || record.switches?.titleEnabled === undefined) return result;

  const targetPath = resolve(titleConfigPath);
  const targetRead = await readJsonOptional(targetPath);
  if (targetRead.status === 'bad') throw new Error(`目标命名配置不是合法 JSON：${titleConfigPath}`);
  const target = targetRead.status === 'ok' && targetRead.value && typeof targetRead.value === 'object' ? targetRead.value : {};
  if (Object.prototype.hasOwnProperty.call(target, 'enabled')) {
    result.titleEnabled = { action: 'preserved_existing', enabled: target.enabled === true };
    return result;
  }
  target.enabled = record.switches.titleEnabled === true;
  const staging = `${targetPath}.tmp-${randomUUID().slice(0, 8)}`;
  await writeFile(staging, JSON.stringify(target, null, 2) + '\n', 'utf8');
  await rename(staging, targetPath);
  result.titleEnabled = { action: 'restored', enabled: target.enabled };
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: {
    capture: { type: 'boolean' }, restore: { type: 'boolean' },
    'legacy-root': { type: 'string' }, 'title-config': { type: 'string' }, 'gateway-config': { type: 'string' }, record: { type: 'string' },
  } });
  if (values.capture) {
    const result = await captureLegacyState({
      legacyRoot: values['legacy-root'], titleConfigPath: values['title-config'],
      gatewayConfigPath: values['gateway-config'], recordPath: values.record,
    });
    console.log(JSON.stringify({ ok: true, record: result }, null, 2));
  } else if (values.restore) {
    const result = await restoreLegacyState({ recordPath: values.record, titleConfigPath: values['title-config'] });
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  } else {
    console.error('缺少子命令（--capture / --restore）');
    process.exit(2);
  }
}
