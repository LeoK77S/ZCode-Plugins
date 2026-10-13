import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

for (const [mode, name] of [['reject', '后台资源通知发送失败明确报告，不泄露未处理拒绝'], ['close', '连接关闭与在途资源通知拒绝交错时不泄露未处理拒绝']]) {
  test(name, { timeout: 4000 }, async () => {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('./resource-send-failure-fixture.mjs', import.meta.url)), mode], { windowsHide: true, timeout: 3500 });
    const report = JSON.parse(stdout.trim());
    assert.deepEqual(report.unhandled, [], '公开 transport.send 拒绝必须由通知任务处理');
    assert.equal(report.reports.length, 1, '发送失败须有一次明确的服务端报告');
    assert.equal(report.attempts, 1, '失败或关闭后结束监测，不隐式重试或保留后续监测');
    assert.match(stderr, /资源通知.*发送失败/);
  });
}
