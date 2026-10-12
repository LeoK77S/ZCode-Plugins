import test from 'node:test';
import assert from 'node:assert/strict';
import { artifactSummary } from '../artifact-prompt.mjs';

function summary(items, inheritance) {
  return artifactSummary({ revision: 7, items, inheritance, stats: {
    total: items.length,
    by_kind: Object.fromEntries(['pr', 'session', 'file', 'link'].map(kind => [kind, items.filter(item => item.kind === kind).length]))
  } });
}
const entry = (kind, number, updated_at) => ({ kind, ref: kind === 'file' ? `D:/fixture/file-${number}.md` : `${kind}-${number}`,
  label: `${kind} ${number}`, purpose: '后续使用', updated_at });
function rows(text) {
  return text.split('\n').filter(line => /^\| (pr|session|file|link) \|/.test(line)).map(line => {
    const [kind, ...cells] = line.slice(2, -2).split(' | ');
    const [label, purpose, ref] = cells.map(cell => JSON.parse(cell.slice(1, -1)));
    return { kind, label, purpose, ref };
  });
}

test('工件简表按更新时间降序取最近 20 条，同一类别可以占满时间序席位', () => {
  const items = Array.from({ length: 25 }, (_, i) => entry('session', i, i));
  const text = summary(items), selected = rows(text);
  assert.equal(selected.length, 20);
  assert.equal(selected[0].ref, 'session-24'); assert.equal(selected.at(-1).ref, 'session-5');
  assert.deepEqual(selected.map(item => Number(item.ref.slice(8))), [24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5]);
  assert.match(text, /显示 20\/25 条.*省略 5 条/);
});

test('时间序落败类别最多保底最新 3 条，再按全局时间补齐；总数仍为 20', () => {
  const items = Array.from({ length: 30 }, (_, i) => entry('pr', i, 100 + i));
  for (const kind of ['session', 'file', 'link'])
    items.push(...Array.from({ length: 5 }, (_, i) => entry(kind, i, 10 + i)));
  const selected = rows(summary(items));
  assert.equal(selected.length, 20);
  assert.equal(selected.filter(item => item.kind === 'pr').length, 11);
  for (const kind of ['session', 'file', 'link']) {
    const entries = selected.filter(item => item.kind === kind);
    assert.equal(entries.length, 3);
    assert.deepEqual(entries.map(item => item.label), [`${kind} 4`, `${kind} 3`, `${kind} 2`]);
  }
  assert.equal(selected[0].ref, 'pr-29');
  const times = new Map(items.map(item => [item.ref, item.updated_at]));
  assert.ok(selected.every((item, i) => !i || times.get(selected[i - 1].ref) >= times.get(item.ref)));
});

test('类别不足 3 条全取，未知更新时间排在最后，同时间保留存储顺序', () => {
  const legacy = { ...entry('file', 0, null), created_at: 1000 };
  const items = [legacy, entry('link', 1, 2), entry('session', 2, 2), entry('pr', 3, 1)];
  assert.deepEqual(rows(summary(items)).map(item => item.ref), ['link-1', 'session-2', 'pr-3', legacy.ref]);
  assert.equal(items[0], legacy);
});

test('9000 字符包括提示、统计、表头和缺快照诊断；字数不足先保住每个类别一条', () => {
  const items = Array.from({ length: 30 }, (_, i) => ({ ...entry('pr', i, 100 + i), label: '中'.repeat(1000) + i }));
  for (const kind of ['session', 'file', 'link'])
    items.push(...Array.from({ length: 5 }, (_, i) => entry(kind, i, i)));
  const text = summary(items, { status: 'snapshot_missing' }), selected = rows(text);
  assert.ok(Array.from(text).length <= 9000);
  assert.ok(selected.length < 20);
  assert.equal(selected[0].ref, 'pr-29');
  for (const kind of ['pr', 'session', 'file', 'link']) assert.ok(selected.some(item => item.kind === kind));
  assert.match(text, /snapshot_missing.*仍可独立读写/);
  assert.ok(selected.every(item => !item.label.includes('…')));
  assert.match(text, new RegExp(`显示 ${selected.length}/45 条，省略 ${45 - selected.length} 条`));
});

test('超长保底条目仍保留各类一条，字段明确截短，不拆开单码点 emoji', () => {
  const items = ['pr', 'session', 'file', 'link'].map((kind, i) => ({ ...entry(kind, i, i),
    label: '中'.repeat(2800), purpose: '😀'.repeat(2800), ref: kind + '-' + '长'.repeat(1400) }));
  const before = structuredClone(items), text = summary(items), selected = rows(text);
  assert.equal(selected.length, 4); assert.ok(Array.from(text).length <= 9000);
  for (const kind of ['pr', 'session', 'file', 'link']) assert.ok(selected.some(item => item.kind === kind));
  assert.ok(selected.some(item => item.label.endsWith('…')));
  assert.doesNotMatch(text, /\p{Surrogate}/u);
  assert.match(text, /字段.*截短/); assert.match(text, /不要使用截短引用/);
  assert.deepEqual(items, before);
});

test('短表不截断；引用、管道、引号、换行和反引号仍可按 JSON 还原，不伪造额外表行', () => {
  const item = { ...entry('file', 1, 1), label: '中'.repeat(8500), purpose: '引号" | `\n| pr | 假行 |',
    ref: 'D:\\fixture\\带|符号`的文件.md' };
  const text = summary([item]);
  assert.ok(Array.from(text).length <= 9000);
  assert.deepEqual(rows(text), [{ kind: item.kind, label: item.label, purpose: item.purpose, ref: item.ref }]);
});

test('恰好 9000 码点完整保留，多一个码点才截短；转义展开也计入预算', () => {
  const item = entry('session', 1, 1), base = Array.from(summary([item])).length;
  const exact = { ...item, label: item.label + '中'.repeat(9000 - base) };
  const full = summary([exact]);
  assert.equal(Array.from(full).length, 9000);
  assert.equal(rows(full)[0].label, exact.label); assert.doesNotMatch(full, /字段已截短/);
  const over = summary([{ ...exact, label: exact.label + '中' }]);
  assert.ok(Array.from(over).length <= 9000); assert.match(over, /字段已截短/);
  assert.ok(rows(over)[0].label.endsWith('…'));
  const escaped = summary([{ ...item, label: '|'.repeat(3000), purpose: '`'.repeat(3000) }]);
  assert.ok(Array.from(escaped).length <= 9000);
  assert.equal(rows(escaped).length, 1); assert.match(escaped, /字段已截短/);
});

test('空集合只提供零统计，不增加空简表；选择和裁剪不修改输入顺序或内容', () => {
  const empty = summary([]);
  assert.match(empty, /共 0 条/); assert.doesNotMatch(empty, /\| 类型/);
  const items = Array.from({ length: 25 }, (_, i) => entry('session', i, i));
  const before = structuredClone(items);
  summary(items); assert.deepEqual(items, before);
});
