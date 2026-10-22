// 通用补丁文件约定；既有导入入口继续转出首个已验证包的注入接口。
export * from './profiles/windows-3.16.2.8769.mjs';

// 备份与状态文件（位于安装目录 resources/ 内，与 app.asar 同目录）。
export const BACKUP_SUFFIX = '.lo02bak';
export const STATE_SUFFIX = '.lo02state.json';

// ---- 失败退出码（票面要求的明确分类；status 输出与 apply/restore 失败一一对应） ----
export const EXIT_CODES = Object.freeze({
  ok: 0,
  internal: 1,
  usage: 2,
  unsupported_package: 10,
  digest_mismatch: 11,
  running_instance: 12,
  backup_missing: 13,
  write_failed: 14,
  fuse_validation_enabled: 15,
  anchor_mismatch: 16,
  invalid_metadata: 17,
});

