import assert from 'node:assert/strict';

// 使用真实浏览器与 MCP 工具连接执行；调用方提供 page 和已注入 window.zcode 的正式 HTML。
export async function verifyArtifactPage(page) {
  await page.locator('#status').filter({ hasText: '已更新' }).waitFor();
  assert.equal(await page.locator('details').count(), 5);
  // 五分组固定顺序：PR、议题、会话、文件、链接；fixture 无议题条目，issue 分组呈现空态
  assert.deepEqual(await page.locator('details').evaluateAll(groups => groups.map(group => group.dataset.kind)),
    ['pr', 'issue', 'session', 'file', 'link']);
  assert.equal(await page.locator('details[data-kind="issue"] .group-empty').textContent(), '暂无议题');
  const pr = page.locator('details[data-kind="pr"]');
  assert.equal(await pr.locator('.count').textContent(), '1');
  await pr.locator('summary').click();
  assert.equal(await pr.getAttribute('open'), null);
  assert.equal(await pr.locator('.count').textContent(), '1');
  await page.getByRole('button', { name: '刷新列表', exact: true }).click();
  await page.locator('#status').filter({ hasText: '已更新' }).waitFor();
  assert.equal(await page.locator('details[data-kind="pr"]').getAttribute('open'), null);
  await page.locator('details[data-kind="pr"] summary').click();
  assert.equal(await page.locator('[data-icon="outgoing"]').count(), 1);
  assert.equal(await page.locator('[data-icon="incoming"]').count(), 1);
  for (const icon of ['outgoing', 'incoming']) {
    const bounds = await page.locator(`[data-icon="${icon}"] path`).boundingBox();
    assert.ok(bounds.width > 0 && bounds.height > 0, icon + ' 必须实际可见');
    assert.ok(await page.locator(`[data-icon="${icon}"]`).evaluate(svg => {
      const style = getComputedStyle(svg);
      return svg.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) > 0;
    }), icon + ' 必须有可绘制的视口');
  }
  for (const icon of ['pr', 'file', 'link']) assert.ok(await page.locator(`[data-icon="${icon}"]`).count() > 0);
  await page.getByRole('button', { name: '查看详情：实现 PR', exact: true }).click();
  await page.locator('#detail-status').filter({ hasText: '已读取' }).waitFor();
  assert.equal(await page.locator('#detail-content a').getAttribute('href'), 'https://example.com/pull/1');
  assert.match(await page.locator('#detail-content').textContent(), /创建时间.*2026/s);
  await page.locator('#detail-content a').click();
  assert.deepEqual(await page.evaluate(() => window.openedLinks), ['https://example.com/pull/1']);
  await page.getByRole('button', { name: '返回列表', exact: true }).click();
  await page.getByRole('button', { name: '查看详情：实现会话', exact: true }).click();
  await page.locator('#detail-status').filter({ hasText: '已读取' }).waitFor();
  assert.match(await page.locator('#detail-content').textContent(), /正在运行.*查询时间/s);
  await page.getByRole('button', { name: '返回列表', exact: true }).click();
  await page.getByRole('button', { name: '查看详情：实现会话', exact: true }).click();
  await page.locator('#detail-status').filter({ hasText: '已读取' }).waitFor();
  assert.match(await page.locator('#detail-content').textContent(), /已完成/);
  await page.getByRole('button', { name: '刷新详情', exact: true }).click();
  await page.locator('#detail-status').filter({ hasText: '已读取' }).waitFor();
  assert.match(await page.locator('#detail-content').textContent(), /查询失败.*gateway_unavailable/s);
  assert.doesNotMatch(await page.locator('#detail-content').textContent(), /已完成/);
  await page.getByRole('button', { name: '返回列表', exact: true }).click();
  assert.equal(await page.locator('#list-view').isVisible(), true);
  // file 详情页的本机定位按钮：存在态可点击，缺失态灰化
  await page.locator('.entry[data-kind="file"]:not(:has(.icon.missing))').first().click();
  await page.locator('#detail-status').filter({ hasText: '已读取' }).waitFor();
  const reveal = page.locator('#detail-content .reveal');
  assert.equal(await reveal.count(), 1, 'file 详情页提供本机定位按钮');
  assert.equal(await reveal.textContent(), '用文件资源管理器打开');
  assert.equal(await reveal.isEnabled(), true, '存在态文件的定位按钮可点击');
  await page.getByRole('button', { name: '返回列表', exact: true }).click();
  await page.locator('.entry:has(.icon.missing)').first().click();
  await page.locator('#detail-status').filter({ hasText: '已读取' }).waitFor();
  const disabledReveal = page.locator('#detail-content .reveal');
  assert.equal(await disabledReveal.count(), 1);
  assert.equal(await disabledReveal.isDisabled(), true, '缺失态条目的定位按钮灰化');
  await page.getByRole('button', { name: '返回列表', exact: true }).click();
  assert.equal(await page.locator('#list-view').isVisible(), true);
  assert.match(await page.locator('#groups').textContent(), /<tag>/);
  assert.equal(await page.locator('#groups tag').count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByRole('button', { name: '查看详情：实现会话', exact: true }).click();
  await page.getByRole('button', { name: '返回列表', exact: true }).click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#list-view').isVisible(), true);
  assert.equal(await page.locator('#detail-view').isVisible(), false);
}
