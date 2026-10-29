const $ = selector => document.querySelector(selector);
const api = window.checkpoint;
let state = { tasks: [], settings: { shortcut: 'Control+Shift+Space' } };
let filter = 'all', query = '', sort = 'newest', editId;
let initialized = false, listMarkup = '';
let toastTimer, undoId;
let adding = false;
const pending = new Set();
const viewCopy = { all: 'All tasks', active: 'Active tasks', done: 'Completed tasks' };
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function notify(message, { error = false, restoreId } = {}) {
  clearTimeout(toastTimer);
  $('#toast-message').textContent = message;
  $('#toast').classList.toggle('error', error);
  $('#toast').hidden = false;
  undoId = restoreId;
  $('#toast-undo').hidden = !restoreId;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, error ? 10000 : restoreId ? 8000 : 3500);
}
async function request(promise) {
  try {
    const result = await promise;
    if (!result.ok) throw new Error(result.error);
    return result.value;
  } catch (error) {
    notify(error.message || 'Something went wrong. Please try again.', { error: true });
    throw error;
  }
}
function acceptState(next) {
  const previous = new Map(state.tasks.map(task => [task.id, task]));
  const added = new Set(initialized ? next.tasks.filter(task => !previous.has(task.id)).map(task => task.id) : []);
  if (initialized) for (const task of next.tasks) {
    if (task.done && previous.has(task.id) && !previous.get(task.id).done) {
      const row = [...document.querySelectorAll('.task-row')].find(row => row.dataset.id === task.id);
      motion.confetti(row?.getBoundingClientRect());
    }
  }
  const wasRolled = state.rolledUp;
  state = next; render(added); initialized = true;
  if (wasRolled && !next.rolledUp) motion.enter($('.widget-main'));
}
function focusInput() {
  if (filter === 'done') { filter = 'all'; render(); }
  $('#task-input').focus();
  $('#task-input').scrollIntoView({ block:'nearest', behavior:'smooth' });
}
function taskDate(task) {
  const date = new Date(task.done ? task.completedAt : task.createdAt);
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate()-1);
  const label = date.toDateString() === today.toDateString() ? 'today' : date.toDateString() === yesterday.toDateString() ? 'yesterday' : date.toLocaleDateString(undefined, { month:'short', day:'numeric', ...(date.getFullYear() !== today.getFullYear() ? {year:'numeric'} : {}) });
  return `${task.done ? 'Completed' : 'Added'} ${label}`;
}
function renderTask(task) {
  return `<article class="task-row ${task.done ? 'done' : ''}" data-id="${escapeHtml(task.id)}"><input class="task-checkbox" type="checkbox" ${task.done ? 'checked' : ''} aria-label="${task.done ? 'Mark incomplete' : 'Complete'}: ${escapeHtml(task.text)}"><div class="task-content"><div class="task-text">${escapeHtml(task.text)}</div><div class="task-date">${taskDate(task)}</div></div><div class="task-actions"><select class="priority-select priority-${task.priority}" data-action="priority" aria-label="Priority: ${escapeHtml(task.text)}" title="Task priority">${['low','medium','high'].map(priority => `<option value="${priority}" ${task.priority === priority ? 'selected' : ''}>${priority[0].toUpperCase()+priority.slice(1)}</option>`).join('')}</select><button class="icon-button secondary-action" data-action="edit" aria-label="Edit task" title="Edit task">${icon('edit')}</button><button class="icon-button secondary-action delete" data-action="delete" aria-label="Delete task" title="Delete task">${icon('trash')}</button></div></article>`;
}
function render(added = new Set()) {
  const activeFocus = document.activeElement;
  const focusedRow = activeFocus?.closest('.task-row');
  const focusMemory = focusedRow ? { id: focusedRow.dataset.id, action: activeFocus.dataset.action || 'checkbox' } : null;
  const total = state.tasks.length, completed = state.tasks.filter(t => t.done).length;
  $('#window-title').textContent = state.rolledUp ? `${total - completed} active task${total - completed === 1 ? '' : 's'}` : 'Checkpoint';
  document.body.classList.toggle('rolled-up', Boolean(state.rolledUp));
  $('.widget-main').inert = Boolean(state.rolledUp);
  if (state.rolledUp) document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  $('#pin-toggle').setAttribute('aria-pressed', String(state.settings.alwaysOnTop));
  $('#pin-toggle').title = state.settings.alwaysOnTop ? 'Always on top: on' : 'Always on top: off';
  $('#page-title').textContent = viewCopy[filter];
  const base = state.tasks;
  $('#filter-all-count').textContent = base.length;
  $('#add-form').hidden = filter === 'done';
  document.querySelectorAll('[data-filter]').forEach(button => {
    button.classList.toggle('active',button.dataset.filter === filter);
    button.setAttribute('aria-pressed',String(button.dataset.filter === filter));
  });
  const visible = base.filter(t => (filter === 'active' ? !t.done : filter === 'done' ? t.done : true) && t.text.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  visible.sort((a,b) => ({low:1,medium:2,high:3}[b.priority] - {low:1,medium:2,high:3}[a.priority]) || (sort === 'az' ? a.text.localeCompare(b.text) : sort === 'oldest' ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt)));
  const undone = visible.filter(t => !t.done), done = visible.filter(t => t.done);
  const markup = undone.map(renderTask).join('') + (done.length && undone.length ? `<div class="section-label">Completed · ${done.length}</div>` : '') + done.map(renderTask).join('');
  if (markup !== listMarkup) {
    const oldRows = [...document.querySelectorAll('.task-row')];
    const positions = new Map(oldRows.map(row => [row.dataset.id, row.getBoundingClientRect().top]));
    gsap.killTweensOf(oldRows);
    $('#task-list').innerHTML = markup; listMarkup = markup;
    for (const row of document.querySelectorAll('.task-row')) {
      if (added.has(row.dataset.id)) motion.enter(row);
      else if (positions.has(row.dataset.id) && !motion.reduced()) {
        const y = positions.get(row.dataset.id) - row.getBoundingClientRect().top;
        if (y) gsap.fromTo(row, { y }, { y: 0, duration: .3, ease: 'power2.out', clearProps: 'transform' });
      }
    }
  }
  if (focusMemory) {
    const row = [...document.querySelectorAll('.task-row')].find(el => el.dataset.id === focusMemory.id);
    row?.querySelector(focusMemory.action === 'checkbox' ? '.task-checkbox' : `[data-action="${focusMemory.action}"]`)?.focus({preventScroll:true});
  }
  for (const row of document.querySelectorAll('.task-row')) {
    row.querySelector('.task-checkbox').checked = state.tasks.find(task => task.id === row.dataset.id).done;
    row.querySelectorAll('button,input,select').forEach(control => { control.disabled = pending.has(row.dataset.id); });
  }
  $('#empty-state').hidden = visible.length > 0;
  $('#list-footer').hidden = visible.length === 0;
  $('#remaining-count').textContent = query ? `${visible.length} matching task${visible.length === 1 ? '' : 's'}` : `${base.filter(t => !t.done).length} left to do`;
  $('#empty-add').hidden = Boolean(query) || filter !== 'all';
  if (!visible.length) {
    const emptyCopy = query ? ['No tasks found', 'Try another search.'] : filter === 'done' ? ['No completed tasks', 'Completed tasks will appear here.'] : filter === 'active' && total ? ['No active tasks', 'All tasks are complete.'] : ['No tasks yet', 'Add a task to get started.'];
    $('#empty-title').textContent = emptyCopy[0];
    $('#empty-description').textContent = emptyCopy[1];
  }
  $('#shortcut-select').value = state.settings.shortcut;
  $('#shortcut-status').textContent = state.shortcutRegistered ? 'Available while Checkpoint is running.' : 'Unavailable. Choose a different shortcut.';
  $('#shortcut-status').classList.toggle('error', !state.shortcutRegistered);
  $('#rollup-shortcut-select').value = state.settings.rollupShortcut;
  $('#rollup-shortcut-status').textContent = state.rollupRegistered ? 'Press once to roll up to the active count; press again to expand.' : 'Unavailable. Choose a different shortcut.';
  $('#rollup-shortcut-status').classList.toggle('error', !state.rollupRegistered);
  $('#startup-toggle').checked = state.settings.launchAtStartup;
  $('#cleanup-toggle').checked = state.settings.autoDeleteDone;
  if (document.activeElement !== $('#retention-days')) $('#retention-days').value = state.settings.retentionDays;
  $('#retention-days').disabled = !state.settings.autoDeleteDone;
  $('#app-version').textContent = `v${state.appVersion}`;
  const notices = [state.recoveryMessage, state.startupError, state.cleanupError, !state.shortcutRegistered ? 'Quick capture shortcut unavailable. Change it in Settings.' : '', !state.rollupRegistered ? 'Roll-up shortcut unavailable. Change it in Settings.' : ''].filter(Boolean);
  $('#system-notice').hidden = !notices.length;
  $('#system-notice').textContent = notices.join(' ');
}

document.querySelectorAll('[data-window]').forEach(button => button.addEventListener('click', () => { void request(api.windowAction(button.dataset.window)).catch(()=>{}); }));
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {filter=button.dataset.filter;render();}));
$('#empty-add').addEventListener('click',focusInput);
$('#search').addEventListener('input',event=>{query=event.target.value;render();});
$('#sort').addEventListener('change',event=>{sort=event.target.value;render();});
$('#add-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const input = $('#task-input'), text = input.value.trim();
  if(!text || adding) {input.focus();return;}
  adding=true;
  $('#add-form button').disabled=true;
  try {
    await request(api.addTask(text, $('#new-priority').value));
    input.value=''; query=''; $('#search').value=''; render();
    notify('Task added.');
  } catch {} finally {adding=false;$('#add-form button').disabled=false;input.focus();}
});
$('#task-list').addEventListener('change',async event=>{
  if(event.target.matches('.priority-select')) {
    const select = event.target, id = select.closest('.task-row').dataset.id;
    if(pending.has(id)) return;
    pending.add(id); select.disabled = true;
    try { await request(api.updateTask(id, {priority: select.value})); }
    catch { select.value = state.tasks.find(task => task.id === id).priority; }
    finally { pending.delete(id); render(); }
    return;
  }
  if(!event.target.matches('.task-checkbox'))return;
  const id=event.target.closest('.task-row').dataset.id, done=event.target.checked;
  if(pending.has(id))return;
  pending.add(id); event.target.disabled=true;
  try {await request(api.updateTask(id,{done}));} catch {render();} finally {pending.delete(id);render();}
});
$('#task-list').addEventListener('click',async event=>{
  const button=event.target.closest('button[data-action]');if(!button)return;
  const id=button.closest('.task-row').dataset.id;
  const task=state.tasks.find(t=>t.id===id);if(!task)return;
  if(button.dataset.action==='edit') {
    editId=id;$('#edit-input').value=task.text;motion.dialog($('#edit-dialog'));$('#edit-input').focus();return;
  }
  if(pending.has(id))return;
  pending.add(id);button.disabled=true;
  try {
    if(button.dataset.action==='delete'){await request(api.removeTask(id));notify('Task deleted.',{restoreId:id});}
  } catch {render();} finally {pending.delete(id);render();}
});
$('#edit-form').addEventListener('submit',async event=>{
  event.preventDefault();const button=$('#edit-form [type="submit"]');button.disabled=true;
  try{await request(api.updateTask(editId,{text:$('#edit-input').value}));$('#edit-dialog').close();notify('Task updated.');}
  catch{}finally{button.disabled=false;}
});
for(const id of ['#edit-close','#edit-cancel'])$(id).addEventListener('click',()=>$('#edit-dialog').close());
$('#settings-open').addEventListener('click',()=>motion.dialog($('#settings-dialog')));
$('#rollup-shortcut-select').addEventListener('change', async event => {
  const select = event.target; select.disabled = true;
  try { await request(api.setRollupShortcut(select.value)); notify('Roll-up shortcut updated.'); }
  catch { select.value = state.settings.rollupShortcut; }
  finally { select.disabled = false; }
});
for (const [selector, key] of [['#startup-toggle', 'launchAtStartup'], ['#cleanup-toggle', 'autoDeleteDone'], ['#retention-days', 'retentionDays']]) {
  $(selector).addEventListener('change', async event => {
    const input = event.target;
    if (!input.checkValidity()) { input.reportValidity(); input.value = state.settings.retentionDays; return; }
    input.disabled = true;
    try { await request(api.updateSettings({ [key]: input.type === 'checkbox' ? input.checked : Number(input.value) })); notify('Settings saved.'); }
    catch { input.value = state.settings.retentionDays; }
    finally { input.disabled = false; render(); }
  });
}
$('#shortcut-select').addEventListener('change',async event=>{
  const select=event.target;select.disabled=true;
  try{await request(api.setShortcut(select.value));notify('Quick capture shortcut updated.');}
  catch{select.value=state.settings.shortcut;}
  finally{select.disabled=false;}
});
$('#quit-app').addEventListener('click',()=>{void request(api.windowAction('quit')).catch(()=>{});});
$('#toast-dismiss').addEventListener('click',()=>{$('#toast').hidden=true;});
$('#toast-undo').addEventListener('click',async()=>{
  const id=undoId;$('#toast-undo').disabled=true;
  try{await request(api.restoreTask(id));notify('Task restored.');}
  catch{}finally{$('#toast-undo').disabled=false;}
});
document.addEventListener('keydown',event=>{
  if($('dialog[open]'))return;
  const typing=['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName);
  if(event.ctrlKey && event.key.toLowerCase()==='n'){event.preventDefault();focusInput();}
  if(event.key==='/' && !typing){event.preventDefault();$('#search').focus();}
  if(event.key==='Escape' && document.activeElement===$('#search')){query='';$('#search').value='';render();$('#search').blur();}
});
api.onState(acceptState);
request(api.getState()).then(acceptState).catch(()=>{$('#save-status').textContent='Could not load tasks';});
