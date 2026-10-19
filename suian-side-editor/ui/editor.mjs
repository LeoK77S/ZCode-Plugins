import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, lineNumbers, keymap, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';

const host = window.zcode;
const commentButton = document.getElementById('comment-selection'), commentDialog = document.getElementById('comment-dialog');
const commentBody = document.getElementById('comment-body'), commentSubmit = document.getElementById('comment-submit');
const commentStatus = document.getElementById('comment-status'), commentError = document.getElementById('comment-error');
let commentDraft, commentBusy = false;
let comments = [];
let commentSession = { state: 'unknown', reason: '正在确认主对话状态…' }, commentResource, commentReading = false, commentPending = false;
let commentRetryTimer;
const publishedBatches = new Map(), acceptedComments = new Set();
function applyCommentSession(data) {
  commentSession = data;
  for (const accepted of data.acceptedBatches ?? []) {
    const batch = publishedBatches.get(accepted.batchId);
    if (!batch || accepted.serialized !== batch.serialized) continue;
    for (const id of batch.ids) acceptedComments.add(id);
  }
  comments = comments.filter(comment => !acceptedComments.has(comment.commentId));
}
function commentId() {
  // 部分公开资源页面没有 secure-context randomUUID；getRandomValues 仍提供随机身份。
  const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = bytes[6] & 15 | 64; bytes[8] = bytes[8] & 63 | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function renderComments() {
  const selected = Boolean(view && !view.state.selection.main.empty);
  const reason = current && !current.sourcePath ? '未取得文件的可信完整路径，暂时不能添加评论；恢复正文已保留，请确认重新读取文件' :
    !host?.updateModelContext ? '当前宿主不支持主对话上下文' : commentSession.state !== 'idle' ? commentSession.reason : commentBusy ? '正在加入主对话…' : '';
  commentButton.disabled = !selected || Boolean(reason);
  commentButton.title = reason || (!selected ? '先选择文件正文' : '为当前选区填写评论');
  commentSubmit.disabled = Boolean(reason) || !commentBody.value.trim(); commentSubmit.title = reason || '将快照加入当前主对话';
  commentStatus.textContent = `待发送评论 ${comments.length} 条${reason ? ` · ${reason}` : ''}`;
}
async function refreshCommentState() {
  if (disposed || !commentResource) return;
  if (commentReading) { commentPending = true; return; }
  commentReading = true; commentPending = false;
  try { const result = await host.readResource(commentResource); if (!disposed) applyCommentSession(JSON.parse(result.contents[0].text)); }
  catch (error) { commentSession = { state: 'unknown', reason: `评论状态同步失败：${error.message}` }; }
  finally {
    commentReading = false; clearTimeout(commentRetryTimer); renderComments();
    if (commentPending && !disposed) void refreshCommentState();
    else if (!disposed && commentSession.state === 'unknown') commentRetryTimer = setTimeout(() => { void refreshCommentState(); }, 1500);
  }
}
async function loadComments() {
  try {
    if (!host.updateModelContext) throw new Error('当前宿主不支持主对话上下文');
    const data = await call('get_editor_comment_state', {}); applyCommentSession(data); commentResource = data.resourceUri;
    await host.subscribeResource(commentResource);
    if (disposed) { await unsubscribeCommentResource(commentResource); return; }
    await refreshCommentState();
  } catch (error) { commentSession = { state: 'unknown', reason: `评论不可用：${error.message}` }; }
  renderComments();
}
function unsubscribeCommentResource(uri) {
  return host.unsubscribeResource(uri).catch(error => console.error(`评论状态退订失败：${error.message}`));
}
commentBody.addEventListener('input', renderComments);
commentButton.addEventListener('click', () => {
  if (commentButton.disabled || !current) return;
  const { from, to } = view.state.selection.main;
  commentDraft = { commentId: commentId(), sessionId: context.sessionId, workspacePath: context.sessionWorkspacePath ?? context.workspacePath,
    path: current.sourcePath, title: current.relativePath.split('/').at(-1), startLine: view.state.doc.lineAt(from).number,
    endLine: view.state.doc.lineAt(to - 1).number, selectedText: view.state.sliceDoc(from, to), unsaved: isDirty(current) };
  document.getElementById('comment-location').textContent = `${commentDraft.path} · ${commentDraft.startLine}–${commentDraft.endLine} 行${commentDraft.unsaved ? ' · 包含未保存编辑' : ''}`;
  document.getElementById('comment-selection-text').textContent = commentDraft.selectedText;
  commentError.textContent = ''; renderComments(); commentDialog.showModal(); commentBody.focus();
});
document.getElementById('comment-cancel').addEventListener('click', () => commentDialog.close());
commentSubmit.addEventListener('click', async () => {
  if (commentSubmit.disabled || !commentDraft) return;
  commentBusy = true; renderComments();
  const next = [...comments, { ...commentDraft, comment: commentBody.value }];
  const data = { schemaVersion: 1, batchId: commentId(), comments: next };
  publishedBatches.set(data.batchId, { serialized: JSON.stringify(data), ids: next.map(comment => comment.commentId) });
  try {
    await host.updateModelContext({ content: [{ type: 'text', text: `文本编辑器选区评论（${next.length} 条；快照创建后不随正文变化）\n${JSON.stringify(data)}` }], structuredContent: data });
    comments = next.filter(comment => !acceptedComments.has(comment.commentId)); commentDraft = undefined; commentBody.value = ''; commentError.textContent = ''; commentDialog.close();
  } catch (error) { commentError.textContent = `加入主对话失败，评论已保留：${error.message}`; }
  finally { commentBusy = false; renderComments(); }
});
const folder = document.getElementById('folder'), files = document.getElementById('files');
const tree = document.getElementById('tree'), status = document.getElementById('status');
const editor = document.getElementById('editor'), empty = document.getElementById('empty');
const tabs = document.getElementById('tabs'), breadcrumb = document.getElementById('breadcrumb');
const save = document.getElementById('save'), statusText = document.getElementById('status-text'), fileInfo = document.getElementById('file-info');
const closeDialog = document.getElementById('close-dialog'), closeSave = document.getElementById('close-save');
const modeButton = document.getElementById('save-mode'), conflictBar = document.getElementById('conflict-bar');
const reloadDialog = document.getElementById('reload-dialog');
let context, view, current;
const workspaceSelect = document.getElementById('workspace-select'), workspacePathLabel = document.getElementById('workspace-path');
let switchingRoot = false, rootGeneration = 0, openingCount = 0;
let saveMode = 'manual', settingsReady = false, settingsBusy = false, settingsError;
const documents = [];
let disposed = false, cancelResourceEvents;
let recoveryReady = false, restoring = false, recoveryBusy = false, recoveryRevision = 0, recoveryAck = 0, recoveryTimer, recoveryError;
const recoveryStatus = document.getElementById('recovery-status'), recoveryRetry = document.getElementById('recovery-retry');
function renderRecovery() {
  recoveryStatus.textContent = recoveryError ? `恢复副本失败：${recoveryError}` : !recoveryReady ? '正在读取恢复副本…' : recoveryRevision === recoveryAck ? '恢复副本已同步' : '恢复副本待同步…';
  recoveryRetry.hidden = !recoveryError;
  updateWorkspaceSelection();
}
function recoveryChanged() {
  if (!recoveryReady || restoring || disposed) return;
  recoveryRevision++; recoveryError = undefined; renderRecovery();
  clearTimeout(recoveryTimer); recoveryTimer = setTimeout(() => { void persistRecovery(); }, 200);
}
function recoverySnapshot() {
  if (current && view) { current.scrollTop = view.scrollDOM.scrollTop; current.scrollLeft = view.scrollDOM.scrollLeft; }
  return { files: documents.map(file => ({ path: file.relativePath, fixed: file.fixed, scrollTop: file.scrollTop, scrollLeft: file.scrollLeft,
    ...(isDirty(file) ? { draft: { text: file.text, diskText: file.diskText, baseVersion: file.version, encoding: file.encoding } } : {}) })), currentPath: current?.relativePath ?? null };
}
async function persistRecovery() {
  if (!recoveryReady || recoveryBusy || disposed || recoveryRevision === recoveryAck) return;
  clearTimeout(recoveryTimer); recoveryBusy = true;
  renderRecovery();
  const revision = recoveryRevision, state = recoverySnapshot();
  try { await call('update_editor_state', { state }); recoveryAck = revision; recoveryError = undefined; }
  catch (error) { recoveryError = error.message; }
  finally {
    recoveryBusy = false; renderRecovery();
    if (recoveryRevision !== revision) { clearTimeout(recoveryTimer); recoveryTimer = setTimeout(() => { void persistRecovery(); }, 200); }
  }
}
async function loadRecovery() {
  if (restoring) return;
  restoring = true;
  document.body.inert = true;
  recoveryRetry.disabled = true;
  let normalized = false;
  try {
    const { state } = await call('get_editor_state', {});
    const restored = new Map();
    for (const saved of state.files) {
      let data, readError;
      try { data = await call('read_editor_text', { path: saved.path }); }
      catch (error) { readError = error.message; }
      const draft = saved.draft;
      // 改指后旧脏副本仍属于原身份；不把它绑定到新目标或静默覆盖另一份脏正文。
      const pathChanged = Boolean(draft && data && data.relativePath !== saved.path);
      if (pathChanged) { data = undefined; readError = '文件路径已改变，恢复正文已保留，请确认重新读取'; }
      const path = data?.relativePath ?? saved.path;
      const existing = documents.find(file => file.relativePath === path);
      const file = existing ?? { lineSeparator: new Compartment() };
      if (data) file.readRevision = (file.readRevision ?? 0) + 1;
      if (!existing || draft || !isDirty(existing)) {
        Object.assign(file, { ...data, relativePath: path, fixed: file.fixed || saved.fixed, scrollTop: saved.scrollTop, scrollLeft: saved.scrollLeft, pathChanged,
          text: draft?.text ?? data?.text ?? '', diskText: draft?.diskText ?? data?.text ?? '', version: draft?.baseVersion ?? data?.version,
          encoding: draft?.encoding ?? data?.encoding ?? { name: 'utf-8', bom: false, newline: 'none' },
          blocked: Boolean(readError || draft && draft.baseVersion !== data.version), error: readError ?? (draft && draft.baseVersion !== data.version ? '磁盘内容已改变，恢复正文已保留，自动保存已暂停' : undefined) });
        file.mixed = file.encoding.newline === 'mixed'; file.insertedSeparator = file.text.match(/\r\n|\r|\n/)?.[0] ?? '\n';
        file.state = createEditorState(file);
      }
      file.fixed ||= saved.fixed;
      if (saved.path === state.currentPath) { file.scrollTop = saved.scrollTop; file.scrollLeft = saved.scrollLeft; }
      restored.set(saved.path, file); normalized ||= path !== saved.path || Boolean(existing);
      if (!existing) { documents.push(file); if (data) await subscribeFile(file); }
    }
    if (documents.length) activateFile(restored.get(state.currentPath));
    recoveryReady = true; recoveryError = undefined;
  } catch (error) { recoveryError = error.message; }
  finally { restoring = false; document.body.inert = switchingRoot; recoveryRetry.disabled = false; if (recoveryReady && normalized) recoveryChanged(); renderRecovery(); }
}
recoveryRetry.addEventListener('click', async () => {
  if (recoveryReady) { recoveryError = undefined; renderRecovery(); await persistRecovery(); }
  else { await loadRecovery(); folder.disabled = !recoveryReady; }
});
const lineBreaks = { crlf: '\r\n', cr: '\r', lf: '\n', none: '\n' };
function showStatus(text, error = false) { statusText.textContent = text; status.classList.toggle('error', error); }
function isDirty(file) { return file.text !== file.diskText; }
function showFileStatus() {
  updateWorkspaceSelection();
  renderComments();
  conflictBar.hidden = !(current?.blocked || current?.syncError);
  const busy = Boolean(current?.saving || current?.reloading);
  document.getElementById('reload-file').disabled = busy;
  document.getElementById('reload-confirm').disabled = busy;
  if (!current) { save.disabled = true; fileInfo.textContent = ''; showStatus(settingsError ?? '选择文件开始编辑', Boolean(settingsError)); return; }
  save.disabled = current.saving || current.reloading || current.pathChanged || !isDirty(current);
  fileInfo.textContent = `UTF-8${current.encoding.bom ? ' BOM' : ''} · ${current.encoding.newline.toUpperCase()}`;
  const phase = current.saving ? '正在保存…' : isDirty(current) ? '未保存' : current.saved ? '已保存' : '已读取';
  showStatus(current.reloading ? '正在重新读取…' : current.error ?? settingsError ?? (current.syncError ? `${phase} · ${current.syncError}` : phase), Boolean(current.error || current.syncError || settingsError));
}
function theme() { document.documentElement.dataset.theme = host.theme ?? 'light'; }
async function call(name, args) {
  if (context && name !== 'get_editor_comment_state') args = { workspace_root: context.workspaceRoot ?? context.workspacePath, ...args };
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
      file.tab.addEventListener('dblclick', () => { file.fixed = true; renderTabs(); recoveryChanged(); });
    }
    file.tabContainer.className = `tab${file.fixed ? '' : ' temporary'}${file === current ? ' active' : ''}`;
    file.tab.setAttribute('aria-label', file.relativePath); file.tab.title = file.relativePath;
    file.tab.querySelector('.tab-title').textContent = file.relativePath.split('/').at(-1);
    file.close.setAttribute('aria-label', `关闭 ${file.relativePath}`);
    file.tab.setAttribute('aria-selected', String(file === current));
    file.dirtyMark.hidden = !isDirty(file);
    file.close.disabled = Boolean(file.saving);
    tabs.append(file.tabContainer);
  }
  updateWorkspaceSelection();
}
function activateFile(file) {
  const previous = current;
  if (current !== file && current) { cancelAuto(current); autoSave(current); }
  if (current && view) { current.state = view.state; current.scrollTop = view.scrollDOM.scrollTop; current.scrollLeft = view.scrollDOM.scrollLeft; }
  current = file;
  empty.hidden = true; editor.hidden = false;
  if (view) view.setState(file.state); else view = new EditorView({ state: file.state, parent: editor });
  view.scrollDOM.scrollTop = file.scrollTop; view.scrollDOM.scrollLeft = file.scrollLeft;
  if (!previous || previous !== file) {
    const activeState = file.state;
    view.requestMeasure({ read: () => null, write: () => queueMicrotask(() => {
      if (current !== file || view.state !== activeState) return;
      view.scrollDOM.scrollTop = file.scrollTop; view.scrollDOM.scrollLeft = file.scrollLeft;
      view.dispatch({ effects: view.scrollSnapshot() });
    }) });
    recoveryChanged();
  }
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
  openingCount++; updateWorkspaceSelection();
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
      if (temporary !== -1) { stopResource(documents[temporary]); cancelAuto(documents[temporary]); documents[temporary].tabContainer.remove(); documents.splice(temporary, 1, file); }
      else documents.push(file);
      activateFile(file);
      await subscribeFile(file);
    } catch (error) { showStatus(error.message, true); }
  }).finally(() => { openingCount--; updateWorkspaceSelection(); });
  return opening;
}
function createEditorState(file, separator = lineBreaks[file.encoding.newline]) {
  return EditorState.create({ doc: file.text, extensions: [lineNumbers(), drawSelection(), history(), file.lineSeparator.of(separator ? EditorState.lineSeparator.of(separator) : []),
        keymap.of([{ key: 'Mod-s', run: () => { void saveFile(file); return true; } }, ...defaultKeymap, ...historyKeymap]),
        EditorView.clipboardInputFilter.of((text, state) => text.replace(/\r\n|\r|\n/g, state.lineBreak)),
        EditorView.contentAttributes.of({ 'aria-label': '文件正文', spellcheck: 'false' }),
        EditorState.readOnly.of(!file.version),
        EditorView.domEventHandlers({ scroll: (_event, editorView) => {
          if (current === file && !restoring) { file.scrollTop = editorView.scrollDOM.scrollTop; file.scrollLeft = editorView.scrollDOM.scrollLeft; recoveryChanged(); }
        } }),
        EditorView.updateListener.of(update => {
          file.state = update.state;
          if (update.selectionSet) renderComments();
          if (!update.docChanged) return;
          file.text = file.mixed ? changeMixedText(file.text, update.changes, file.insertedSeparator) : update.state.sliceDoc(); file.fixed = true;
          file.lastEditAt = performance.now();
          renderTabs(); showFileStatus(); scheduleAuto(file); recoveryChanged();
        })] });
}
async function saveFile(file) {
  if (file.saving || file.reloading || file.pathChanged) return false;
  cancelAuto(file);
  const text = file.text;
  file.saving = true; file.error = undefined; renderTabs(); showFileStatus();
  try {
    const result = await call('save_editor_text', { path: file.relativePath, text, baseVersion: file.version });
    file.readRevision = (file.readRevision ?? 0) + 1;
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
    file.saving = false; renderTabs(); showFileStatus(); recoveryChanged();
    if (file.resourcePending) void refreshFile(file);
    if (file.autoAfterSave) { file.autoAfterSave = false; scheduleAuto(file, 0); }
    else if (!file.autoTimer) scheduleAuto(file);
  }
}
function cancelAuto(file) { clearTimeout(file.autoTimer); file.autoTimer = undefined; file.autoAfterSave = false; }
function canAutoSave(file) { return !switchingRoot && settingsReady && !settingsBusy && saveMode === 'auto' && documents.includes(file) && file.subscribed && !file.syncError && !file.blocked && !file.reloading && isDirty(file); }
function autoSave(file) {
  if (!canAutoSave(file)) return;
  if (file.saving) { file.autoAfterSave = true; return; }
  void saveFile(file);
}
function scheduleAuto(file, delay = 800) {
  clearTimeout(file.autoTimer); file.autoTimer = undefined; file.autoAfterSave = false;
  if (canAutoSave(file)) file.autoTimer = setTimeout(() => { file.autoTimer = undefined; autoSave(file); }, delay);
}
function renderMode() {
  updateWorkspaceSelection();
  modeButton.disabled = settingsBusy; modeButton.textContent = settingsReady ? saveMode === 'auto' ? '自动保存' : '手动保存' : '保存方式未确认';
  const error = document.getElementById('settings-error'); error.hidden = !settingsError; error.textContent = settingsError ?? '';
}
async function loadSettings() {
  settingsBusy = true; renderMode();
  try { const data = await call('get_editor_settings', {}); saveMode = data.saveMode; settingsReady = true; settingsError = undefined; }
  catch (error) { settingsError = error.message; }
  finally {
    settingsBusy = false; renderMode(); showFileStatus();
    for (const file of documents) scheduleAuto(file, Math.max(0, 800 - (performance.now() - (file.lastEditAt ?? performance.now()))));
  }
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
function failSync(file, message) { file.syncError = message; cancelAuto(file); showFileStatus(); }
function applyRead(file, data) {
  const scrollTop = current === file ? view.scrollDOM.scrollTop : file.scrollTop;
  const scrollLeft = current === file ? view.scrollDOM.scrollLeft : file.scrollLeft;
  Object.assign(file, { text: data.text, diskText: data.text, version: data.version, encoding: data.encoding,
    mixed: data.encoding.newline === 'mixed', insertedSeparator: data.text.match(/\r\n|\r|\n/)?.[0] ?? '\n', saved: false, error: undefined, blocked: false, pathChanged: false });
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
  renderTabs(); showFileStatus(); recoveryChanged();
}
// 只读取受审工具已登记的资源；保存/重读等待期间的通知留到其回执后核对。
async function refreshFile(file) {
  if (disposed || !documents.includes(file)) return;
  if (file.saving || file.reloading || file.resourceReading) { file.resourcePending = true; return; }
  if (file.blocked) return;
  file.resourcePending = false; file.resourceReading = true;
  const version = file.version, revision = file.readRevision, uri = file.resourceUri;
  const superseded = () => file.saving || file.reloading || file.version !== version || file.readRevision !== revision || file.resourceUri !== uri;
  try {
    const result = await host.readResource(uri);
    const data = JSON.parse(result.contents[0].text);
    if (disposed || !documents.includes(file)) return;
    if (superseded()) { file.resourcePending = true; return; }
    if (data.error) { failSync(file, `外部同步不可用：${data.error}`); blockFile(file, data.error); return; }
    if (file.subscribed) { file.syncError = undefined; showFileStatus(); }
    if (data.version === version) return;
    if (isDirty(file)) blockFile(file, '磁盘内容已改变，编辑已保留，自动保存已暂停');
    else applyRead(file, data);
  } catch (error) {
    if (!disposed && documents.includes(file)) {
      if (superseded()) file.resourcePending = true;
      else failSync(file, `外部同步读取失败：${error.message}`);
    }
  } finally {
    file.resourceReading = false;
    if (file.resourcePending && !file.saving && !file.reloading && !file.blocked) void refreshFile(file);
    else if (!file.syncError && !file.autoTimer) scheduleAuto(file, Math.max(0, 800 - (performance.now() - (file.lastEditAt ?? performance.now()))));
  }
}
async function subscribeFile(file) {
  try {
    await host.subscribeResource(file.resourceUri); file.subscribed = true;
    if (disposed || !documents.includes(file)) { stopResource(file); return; }
    await refreshFile(file);
  } catch (error) { if (documents.includes(file)) failSync(file, `外部同步订阅失败：${error.message}`); else showStatus(error.message, true); }
}
function stopResource(file) {
  if (!file.subscribed) return;
  file.subscribed = false;
  void host.unsubscribeResource(file.resourceUri).catch(error => showStatus(`文件退订失败：${error.message}`, true));
}
window.addEventListener('pagehide', () => { disposed = true; clearTimeout(recoveryTimer); clearTimeout(commentRetryTimer); cancelResourceEvents?.(); for (const file of documents) stopResource(file); if (commentResource) void unsubscribeCommentResource(commentResource); });
let reloading;
document.getElementById('keep-edit').addEventListener('click', () => { showFileStatus(); });
document.getElementById('reload-file').addEventListener('click', () => {
  if (current.saving || current.reloading) return;
  reloading = current;
  document.getElementById('reload-message').textContent = `重新读取 ${current.relativePath} 将放弃当前编辑，并使用磁盘正文。`;
  reloadDialog.showModal();
});
document.getElementById('reload-cancel').addEventListener('click', () => { reloadDialog.close(); reloading = undefined; });
document.getElementById('reload-confirm').addEventListener('click', async () => {
  const file = reloading;
  if (!file || file.saving || file.reloading) return;
  const text = file.text;
  reloadDialog.close(); reloading = undefined; file.reloading = true; cancelAuto(file); showFileStatus();
  try {
    const data = await call('read_editor_text', { path: file.relativePath });
    if (!documents.includes(file)) return;
    if (file.text !== text) { blockFile(file, '重新读取期间有新的编辑，正文已保留，请再次确认重新读取'); return; }
    const canonical = documents.find(item => item !== file && item.relativePath === data.relativePath);
    if (canonical) {
      canonical.fixed ||= file.fixed;
      removeFile(file, canonical);
      return;
    }
    file.readRevision = (file.readRevision ?? 0) + 1;
    if (file.resourceUri !== data.resourceUri) stopResource(file);
    Object.assign(file, { relativePath: data.relativePath, sourcePath: data.sourcePath, resourceUri: data.resourceUri });
    applyRead(file, data);
    if (current === file) activateFile(file);
    if (!file.subscribed) await subscribeFile(file);
    else await refreshFile(file);
  } catch (error) { if (documents.includes(file)) blockFile(file, error.message); }
  finally { file.reloading = false; showFileStatus(); if (file.resourcePending) void refreshFile(file); }
});
save.addEventListener('click', () => { void saveFile(current); });
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 's') return;
  event.preventDefault();
  if (current && !closeDialog.open) void saveFile(current);
});
function removeFile(file, nextFile) {
  stopResource(file);
  cancelAuto(file);
  const index = documents.indexOf(file);
  documents.splice(index, 1); file.tabContainer.remove();
  if (current !== file) { renderTabs(); recoveryChanged(); return; }
  current = undefined;
  if (documents.length) activateFile(nextFile ?? documents[Math.min(index, documents.length - 1)]);
  else {
    view.destroy(); view = undefined; editor.hidden = true; empty.hidden = false;
    breadcrumb.textContent = context.workspacePath.split(/[\\/]/).at(-1);
    for (const row of tree.querySelectorAll('.selected')) row.classList.remove('selected');
    showFileStatus();
  }
  recoveryChanged();
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
  const generation = rootGeneration;
  const { entries } = await call('list_editor_directory', { path });
  if (generation !== rootGeneration) return;
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
function updateWorkspaceSelection() {
  workspaceSelect.disabled = !context || switchingRoot || !recoveryReady || restoring || recoveryBusy || settingsBusy || openingCount > 0 || documents.some(file => file.saving || file.reloading);
}
function renderWorkspace() {
  const roots = context.workspaceRoots ?? [context.workspacePath];
  workspaceSelect.replaceChildren(...roots.map(path => {
    const option = document.createElement('option'); option.value = path;
    const name = path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
    option.textContent = roots.filter(root => root.split(/[\\/]/).filter(Boolean).at(-1) === name).length > 1 ? path : name;
    option.title = path; return option;
  }));
  workspaceSelect.value = context.workspaceRoot ?? context.workspacePath;
  workspaceSelect.title = context.workspacePath;
  workspacePathLabel.textContent = context.workspacePath; workspacePathLabel.title = context.workspacePath;
  breadcrumb.textContent = context.workspacePath;
  updateWorkspaceSelection();
}
async function switchWorkspace(root) {
  if (root === (context.workspaceRoot ?? context.workspacePath)) return;
  if (workspaceSelect.disabled) { workspaceSelect.value = context.workspaceRoot ?? context.workspacePath; return; }
  switchingRoot = true; document.body.inert = true; updateWorkspaceSelection();
  for (const file of documents) cancelAuto(file);
  try {
    await persistRecovery();
    if (recoveryError) throw new Error('当前目录的恢复副本未保存，暂不能切换：' + recoveryError);
    const next = await call('get_editor_context', { workspace_root: root });
    for (const file of documents) stopResource(file);
    documents.splice(0); tabs.replaceChildren(); view?.destroy(); view = undefined; current = undefined;
    editor.hidden = true; empty.hidden = false; fileInfo.textContent = '';
    context = next; rootGeneration++; tree.replaceChildren(); rootLoaded = false;
    recoveryReady = false; recoveryRevision = 0; recoveryAck = 0; recoveryError = undefined; settingsReady = false;
    renderWorkspace(); renderRecovery();
    await loadRecovery(); await loadSettings();
    folder.disabled = !recoveryReady;
    if (!files.hidden && recoveryReady) { await loadDirectory('.', tree); rootLoaded = true; }
  } catch (error) { workspaceSelect.value = context.workspaceRoot ?? context.workspacePath; showStatus(error.message, true); }
  finally {
    switchingRoot = false; document.body.inert = false; updateWorkspaceSelection();
    for (const file of documents) scheduleAuto(file);
  }
}
workspaceSelect.addEventListener('change', () => { void switchWorkspace(workspaceSelect.value); });
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
  if (!host.hostCapabilities?.experimental?.['zcode/resourceSubscribe']) throw new Error('当前宿主不支持资源订阅，外部文件同步不可用');
  cancelResourceEvents = host.onResourceUpdated(uri => { if (uri === commentResource) void refreshCommentState(); const file = documents.find(item => item.resourceUri === uri); if (file) void refreshFile(file); });
  renderWorkspace();
  await loadRecovery(); folder.disabled = !recoveryReady; await loadSettings();
  void loadComments();
} catch (error) { showStatus(error.message, true); }
