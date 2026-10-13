import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, lineNumbers, keymap, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';

const host = window.zcode;
const folder = document.getElementById('folder'), files = document.getElementById('files');
const tree = document.getElementById('tree'), status = document.getElementById('status');
const editor = document.getElementById('editor'), empty = document.getElementById('empty');
const tabs = document.getElementById('tabs'), breadcrumb = document.getElementById('breadcrumb');
const save = document.getElementById('save'), statusText = document.getElementById('status-text'), fileInfo = document.getElementById('file-info');
const closeDialog = document.getElementById('close-dialog'), closeSave = document.getElementById('close-save');
const modeButton = document.getElementById('save-mode'), conflictBar = document.getElementById('conflict-bar');
const reloadDialog = document.getElementById('reload-dialog');
let context, view, current;
let saveMode = 'manual', settingsReady = false, settingsBusy = false, settingsError;
const documents = [];
const lineBreaks = { crlf: '\r\n', cr: '\r', lf: '\n', none: '\n' };
function showStatus(text, error = false) { statusText.textContent = text; status.classList.toggle('error', error); }
function isDirty(file) { return file.text !== file.diskText; }
function showFileStatus() {
  conflictBar.hidden = !current?.blocked;
  if (!current) { save.disabled = true; fileInfo.textContent = ''; showStatus(settingsError ?? '选择文件开始编辑', Boolean(settingsError)); return; }
  save.disabled = current.saving || !isDirty(current);
  fileInfo.textContent = `UTF-8${current.encoding.bom ? ' BOM' : ''} · ${current.encoding.newline.toUpperCase()}`;
  showStatus(current.error ?? settingsError ?? (current.saving ? '正在保存…' : isDirty(current) ? '未保存' : current.saved ? '已保存' : '已读取'), Boolean(current.error || settingsError));
}
function theme() { document.documentElement.dataset.theme = host.theme ?? 'light'; }
async function call(name, args) {
  const result = await host.callTool(name, args);
  if (result.isError) throw Object.assign(new Error(result.structuredContent?.error ?? result.content?.[0]?.text ?? '文件操作失败'), { code: result.structuredContent?.code });
  if (!result.structuredContent) throw new Error('工具响应缺少数据');
  return result.structuredContent;
}
function changeMixedText(text, changes, separator) {
  // CodeMirror 把各类换行记作一个文档位置；映射回原正文只替换实际编辑的范围。
  const offsets = [0];
  for (let raw = 0; raw < text.length;) {
    raw += text[raw] === '\r' && text[raw + 1] === '\n' ? 2 : 1;
    offsets.push(raw);
  }
  const edits = [];
  changes.iterChanges((from, to, _fromNew, _toNew, inserted) => {
    edits.push({ from: offsets[from], to: offsets[to], text: inserted.toString().replaceAll('\n', separator) });
  });
  for (const edit of edits.reverse()) text = text.slice(0, edit.from) + edit.text + text.slice(edit.to);
  return text;
}
function renderTabs() {
  for (const file of documents) {
    if (!file.tab) {
      file.tabContainer = document.createElement('div');
      file.tab = document.createElement('button'); file.tab.setAttribute('role', 'tab'); file.tab.setAttribute('aria-label', file.relativePath); file.tab.title = file.relativePath;
      file.tab.className = 'tab-button';
      const icon = document.getElementById('file-icon').content.firstElementChild.cloneNode(true); icon.classList.add('file-icon');
      const title = document.createElement('span'); title.className = 'tab-title'; title.textContent = file.relativePath.split('/').at(-1);
      file.dirtyMark = document.createElement('span'); file.dirtyMark.className = 'dirty-indicator'; file.dirtyMark.textContent = '●'; file.dirtyMark.setAttribute('aria-hidden', 'true');
      file.tab.append(icon, title, file.dirtyMark);
      file.close = document.createElement('button'); file.close.className = 'tab-close'; file.close.textContent = '×'; file.close.setAttribute('aria-label', `关闭 ${file.relativePath}`);
      file.close.addEventListener('click', () => closeFile(file));
      file.tabContainer.append(file.tab, file.close);
      file.tab.addEventListener('click', () => activateFile(file));
      file.tab.addEventListener('dblclick', () => { file.fixed = true; renderTabs(); });
    }
    file.tabContainer.className = `tab${file.fixed ? '' : ' temporary'}${file === current ? ' active' : ''}`;
    file.tab.setAttribute('aria-selected', String(file === current));
    file.dirtyMark.hidden = !isDirty(file);
    file.close.disabled = Boolean(file.saving);
    tabs.append(file.tabContainer);
  }
}
function activateFile(file) {
  if (current !== file && current) { cancelAuto(current); autoSave(current); }
  if (current && view) { current.state = view.state; current.scrollTop = view.scrollDOM.scrollTop; current.scrollLeft = view.scrollDOM.scrollLeft; }
  current = file;
  empty.hidden = true; editor.hidden = false;
  if (view) view.setState(file.state); else view = new EditorView({ state: file.state, parent: editor });
  view.scrollDOM.scrollTop = file.scrollTop; view.scrollDOM.scrollLeft = file.scrollLeft;
  renderTabs();
  breadcrumb.replaceChildren();
  const parts = [context.workspacePath.split(/[\\/]/).at(-1), ...file.relativePath.split('/')];
  for (const [index, part] of parts.entries()) {
    if (index) { const separator = document.createElement('span'); separator.className = 'crumb-separator'; separator.textContent = '›'; breadcrumb.append(separator); }
    const crumb = document.createElement('span'); crumb.className = `crumb${index === parts.length - 1 ? ' current-file' : ''}`; crumb.textContent = part; breadcrumb.append(crumb);
  }
  for (const row of tree.querySelectorAll('.tree-row')) row.classList.toggle('selected', row.dataset.path === file.relativePath);
  showFileStatus();
}
let opening = Promise.resolve();
function openFile(path, fixed = false) {
  opening = opening.then(async () => {
    try {
      const existing = documents.find(file => file.relativePath === path);
      if (existing) { existing.fixed ||= fixed; activateFile(existing); return; }
      showStatus('正在读取…');
      const data = await call('read_editor_text', { path });
      const canonical = documents.find(file => file.relativePath === data.relativePath);
      if (canonical) { canonical.fixed ||= fixed; activateFile(canonical); return; }
      const separator = lineBreaks[data.encoding.newline];
      const file = { ...data, diskText: data.text, mixed: data.encoding.newline === 'mixed',
        insertedSeparator: data.text.match(/\r\n|\r|\n/)?.[0] ?? '\n', fixed, scrollTop: 0, scrollLeft: 0, lineSeparator: new Compartment() };
      file.state = createEditorState(file, separator);
      const temporary = documents.findIndex(item => !item.fixed);
      if (temporary !== -1) { cancelAuto(documents[temporary]); documents[temporary].tabContainer.remove(); documents.splice(temporary, 1, file); }
      else documents.push(file);
      activateFile(file);
    } catch (error) { showStatus(error.message, true); }
  });
  return opening;
}
function createEditorState(file, separator = lineBreaks[file.encoding.newline]) {
  return EditorState.create({ doc: file.text, extensions: [lineNumbers(), drawSelection(), history(), file.lineSeparator.of(separator ? EditorState.lineSeparator.of(separator) : []),
        keymap.of([{ key: 'Mod-s', run: () => { void saveFile(file); return true; } }, ...defaultKeymap, ...historyKeymap]),
        EditorView.clipboardInputFilter.of((text, state) => text.replace(/\r\n|\r|\n/g, state.lineBreak)),
        EditorView.contentAttributes.of({ 'aria-label': '文件正文', spellcheck: 'false' }),
        EditorView.updateListener.of(update => {
          file.state = update.state;
          if (!update.docChanged) return;
          file.text = file.mixed ? changeMixedText(file.text, update.changes, file.insertedSeparator) : update.state.sliceDoc(); file.fixed = true;
          renderTabs(); showFileStatus(); scheduleAuto(file);
        })] });
}
async function saveFile(file) {
  if (file.saving) return false;
  cancelAuto(file);
  const text = file.text;
  file.saving = true; file.error = undefined; renderTabs(); showFileStatus();
  try {
    const result = await call('save_editor_text', { path: file.relativePath, text, baseVersion: file.version });
    file.version = result.version; file.diskText = result.text; file.encoding = result.encoding; file.saved = true; file.blocked = false;
    file.mixed = result.encoding.newline === 'mixed';
    file.insertedSeparator = result.text.match(/\r\n|\r|\n/)?.[0] ?? '\n';
    const separator = lineBreaks[result.encoding.newline];
    // 同步序列化约定，只转换当前正文的分隔符，不用旧响应覆盖保存等待期间的新输入。
    if (separator) file.text = file.text.replace(/\r\n|\r|\n/g, separator);
    const effects = file.lineSeparator.reconfigure(separator ? EditorState.lineSeparator.of(separator) : []);
    if (current === file) view.dispatch({ effects });
    else file.state = file.state.update({ effects }).state;
    return !isDirty(file);
  } catch (error) { blockFile(file, error.message); return false; }
  finally {
    file.saving = false; renderTabs(); showFileStatus();
    if (file.autoAfterSave) { file.autoAfterSave = false; scheduleAuto(file, 0); }
    else if (!file.autoTimer) scheduleAuto(file);
  }
}
function cancelAuto(file) { clearTimeout(file.autoTimer); file.autoTimer = undefined; file.autoAfterSave = false; }
function canAutoSave(file) { return settingsReady && !settingsBusy && saveMode === 'auto' && documents.includes(file) && !file.blocked && !file.reloading && isDirty(file); }
function autoSave(file) {
  if (!canAutoSave(file)) return;
  if (file.saving) { file.autoAfterSave = true; return; }
  void saveFile(file);
}
function scheduleAuto(file, delay = 800) {
  clearTimeout(file.autoTimer); file.autoTimer = undefined;
  if (canAutoSave(file)) file.autoTimer = setTimeout(() => { file.autoTimer = undefined; autoSave(file); }, delay);
}
function renderMode() {
  modeButton.disabled = settingsBusy; modeButton.textContent = settingsReady ? saveMode === 'auto' ? '自动保存' : '手动保存' : '保存方式未确认';
  const error = document.getElementById('settings-error'); error.hidden = !settingsError; error.textContent = settingsError ?? '';
}
async function loadSettings() {
  settingsBusy = true; renderMode();
  try { const data = await call('get_editor_settings', {}); saveMode = data.saveMode; settingsReady = true; settingsError = undefined; }
  catch (error) { settingsError = error.message; }
  finally { settingsBusy = false; renderMode(); showFileStatus(); }
}
modeButton.addEventListener('click', async () => {
  if (!settingsReady) { await loadSettings(); return; }
  settingsBusy = true; for (const file of documents) cancelAuto(file); renderMode();
  try {
    const data = await call('update_editor_settings', { saveMode: saveMode === 'manual' ? 'auto' : 'manual' });
    saveMode = data.saveMode; settingsError = undefined;
  } catch (error) { settingsError = error.message; }
  finally { settingsBusy = false; renderMode(); showFileStatus(); for (const file of documents) autoSave(file); }
});
function blockFile(file, message) { file.blocked = true; file.error = message; cancelAuto(file); showFileStatus(); }
function applyRead(file, data) {
  const scrollTop = current === file ? view.scrollDOM.scrollTop : file.scrollTop;
  const scrollLeft = current === file ? view.scrollDOM.scrollLeft : file.scrollLeft;
  Object.assign(file, { text: data.text, diskText: data.text, version: data.version, encoding: data.encoding,
    mixed: data.encoding.newline === 'mixed', insertedSeparator: data.text.match(/\r\n|\r|\n/)?.[0] ?? '\n', saved: false, error: undefined, blocked: false });
  file.state = createEditorState(file); file.scrollTop = scrollTop; file.scrollLeft = scrollLeft;
  if (current === file) {
    view.setState(file.state);
    const refreshedState = file.state;
    // setState 后先让 CodeMirror 重新测量正文，再在同一新文档上恢复滚动快照。
    view.requestMeasure({ read: () => null, write: () => queueMicrotask(() => {
      if (current !== file || view.state !== refreshedState) return;
      view.scrollDOM.scrollTop = scrollTop; view.scrollDOM.scrollLeft = scrollLeft;
      view.dispatch({ effects: view.scrollSnapshot() });
    }) });
  }
  renderTabs(); showFileStatus();
}
// 按实际内容版本检查已打开文件，不依赖 mtime 或宿主私有通知；逐轮避免堆积请求。
async function checkFiles() {
  for (const file of [...documents]) {
    if (file.saving || file.reloading || file.blocked) continue;
    const version = file.version;
    try {
      const data = await call('read_editor_text', { path: file.relativePath });
      if (!documents.includes(file) || file.saving || file.reloading || file.version !== version) continue;
      if (data.version === version) continue;
      if (isDirty(file)) blockFile(file, '磁盘内容已改变，编辑已保留，自动保存已暂停');
      else applyRead(file, data);
    } catch (error) { if (documents.includes(file) && file.version === version) blockFile(file, error.message); }
  }
  setTimeout(checkFiles, 1000);
}
let reloading;
document.getElementById('keep-edit').addEventListener('click', () => { showFileStatus(); });
document.getElementById('reload-file').addEventListener('click', () => {
  reloading = current;
  document.getElementById('reload-message').textContent = `重新读取 ${current.relativePath} 将放弃当前编辑，并使用磁盘正文。`;
  reloadDialog.showModal();
});
document.getElementById('reload-cancel').addEventListener('click', () => { reloadDialog.close(); reloading = undefined; });
document.getElementById('reload-confirm').addEventListener('click', async () => {
  const file = reloading, text = file.text;
  reloadDialog.close(); reloading = undefined; file.reloading = true; cancelAuto(file);
  try {
    const data = await call('read_editor_text', { path: file.relativePath });
    if (!documents.includes(file)) return;
    if (file.text !== text) { blockFile(file, '重新读取期间有新的编辑，正文已保留，请再次确认重新读取'); return; }
    applyRead(file, data);
  } catch (error) { if (documents.includes(file)) blockFile(file, error.message); }
  finally { file.reloading = false; showFileStatus(); }
});
save.addEventListener('click', () => { void saveFile(current); });
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 's') return;
  event.preventDefault();
  if (current && !closeDialog.open) void saveFile(current);
});
function removeFile(file) {
  cancelAuto(file);
  const index = documents.indexOf(file);
  documents.splice(index, 1); file.tabContainer.remove();
  if (current !== file) { renderTabs(); return; }
  current = undefined;
  if (documents.length) activateFile(documents[Math.min(index, documents.length - 1)]);
  else {
    view.destroy(); view = undefined; editor.hidden = true; empty.hidden = false;
    breadcrumb.textContent = context.workspacePath.split(/[\\/]/).at(-1);
    for (const row of tree.querySelectorAll('.selected')) row.classList.remove('selected');
    showFileStatus();
  }
}
let closing;
function closeFile(file) {
  if (!isDirty(file)) { removeFile(file); return; }
  closing = file;
  document.getElementById('close-message').textContent = `保存 ${file.relativePath} 的更改吗？`;
  document.getElementById('close-error').textContent = '';
  closeDialog.showModal();
}
document.getElementById('close-cancel').addEventListener('click', () => { closeDialog.close(); closing = undefined; });
document.getElementById('close-discard').addEventListener('click', () => { removeFile(closing); closeDialog.close(); closing = undefined; });
closeSave.addEventListener('click', async () => {
  const file = closing;
  closeSave.disabled = true;
  try {
    const saved = await saveFile(file);
    if (closing !== file || !closeDialog.open) return;
    if (saved) { removeFile(file); closeDialog.close(); closing = undefined; }
    else document.getElementById('close-error').textContent = file.error ?? '保存期间还有新的编辑，文件页仍然保留';
  } finally { closeSave.disabled = false; }
});
async function loadDirectory(path, group) {
  const { entries } = await call('list_editor_directory', { path });
  for (const entry of entries) {
    const item = document.createElement('div'), row = document.createElement('button');
    row.className = 'tree-row'; row.dataset.path = entry.path; row.setAttribute('role', 'treeitem'); row.setAttribute('aria-label', entry.name);
    const mark = entry.kind === 'directory' ? document.createElement('span') : document.getElementById('file-icon').content.firstElementChild.cloneNode(true);
    mark.classList.add(entry.kind === 'directory' ? 'tree-arrow' : 'tree-file'); if (entry.kind === 'directory') mark.textContent = '›'; mark.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span'); label.className = 'tree-name'; label.textContent = entry.name; row.append(mark, label); item.append(row); group.append(item);
    if (entry.kind === 'directory') {
      row.setAttribute('aria-expanded', 'false');
      const children = document.createElement('div'); children.className = 'tree-group'; children.setAttribute('role', 'group'); children.hidden = true; item.append(children);
      let loaded = false;
      row.addEventListener('click', async () => {
        const expand = children.hidden; children.hidden = !expand; row.setAttribute('aria-expanded', String(expand));
        if (!expand || loaded) return;
        row.disabled = true;
        try { await loadDirectory(entry.path, children); loaded = true; }
        catch (error) { showStatus(error.message, true); children.hidden = true; row.setAttribute('aria-expanded', 'false'); }
        finally { row.disabled = false; }
      });
    } else if (entry.kind === 'file') {
      row.addEventListener('click', () => openFile(entry.path));
      row.addEventListener('dblclick', () => openFile(entry.path, true));
    }
    else { row.disabled = true; row.title = entry.unavailableReason === 'path_outside_workspace' ? '链接目标位于工作区外，不可访问' : '不是可访问的普通文件或目录'; }
  }
}
let rootLoaded = false;
folder.addEventListener('click', async () => {
  files.hidden = !files.hidden; folder.setAttribute('aria-expanded', String(!files.hidden));
  if (files.hidden || rootLoaded) return;
  folder.disabled = true;
  try { await loadDirectory('.', tree); rootLoaded = true; }
  catch (error) { showStatus(error.message, true); }
  finally { folder.disabled = false; }
});
try {
  if (!host) throw new Error('当前页面没有原生 ZCode 桥接');
  host.subscribe(theme); await host.ready(); theme();
  context = await call('get_editor_context', {});
  document.getElementById('workspace-title').textContent = context.workspacePath.split(/[\\/]/).at(-1);
  folder.disabled = false; await loadSettings(); setTimeout(checkFiles, 1000);
} catch (error) { showStatus(error.message, true); }
