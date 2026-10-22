const $ = selector => document.querySelector(selector);
const api = window.checkpoint;
let state = { tasks: [], settings: { shortcut: 'Control+Shift+Space' } };
let view = 'all', filter = 'all', query = '', sort = 'newest', editId;
let toastTimer, undoId;
let adding = false;
const pending = new Set();
const viewCopy = { all: 'All tasks', starred: 'Starred', completed: 'Completed' };
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
function acceptState(next) { state = next; render(); }
function focusInput() {
  if (view === 'completed') switchView('all');
  $('#task-input').focus();
  $('#task-input').scrollIntoView({ block:'nearest', behavior:'smooth' });
}
function switchView(next) {
  view = next; filter = 'all'; query = ''; $('#search').value = ''; render();
}
function taskDate(task) {
  const date = new Date(task.done ? task.completedAt : task.createdAt);
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate()-1);
  const label = date.toDateString() === today.toDateString() ? 'today' : date.toDateString() === yesterday.toDateString() ? 'yesterday' : date.toLocaleDateString(undefined, { month:'short', day:'numeric', ...(date.getFullYear() !== today.getFullYear() ? {year:'numeric'} : {}) });
  return `${task.done ? 'Completed' : 'Added'} ${label}`;
}
function renderTask(task) {
  return `<article class="task-row ${task.done ? 'done' : ''}" data-id="${escapeHtml(task.id)}"><input class="task-checkbox" type="checkbox" ${task.done ? 'checked' : ''} aria-label="${task.done ? 'Mark incomplete' : 'Complete'}: ${escapeHtml(task.text)}"><div class="task-content"><div class="task-text">${escapeHtml(task.text)}</div><div class="task-date">${taskDate(task)}</div></div><div class="task-actions"><button class="icon-button ${task.starred ? 'starred' : ''}" data-action="star" aria-label="${task.starred ? 'Unstar' : 'Star'} task" aria-pressed="${task.starred}" title="${task.starred ? 'Unstar' : 'Star'} task">${icon('star')}</button><button class="icon-button secondary-action" data-action="edit" aria-label="Edit task" title="Edit task">${icon('edit')}</button><button class="icon-button secondary-action delete" data-action="delete" aria-label="Delete task" title="Delete task">${icon('trash')}</button></div></article>`;
}
function render() {
  const activeFocus = document.activeElement;
  const focusedRow = activeFocus?.closest('.task-row');
  const focusMemory = focusedRow ? { id: focusedRow.dataset.id, action: activeFocus.dataset.action || 'checkbox' } : null;
  const total = state.tasks.length, completed = state.tasks.filter(t => t.done).length;
  $('#all-count').textContent = total - completed;
  $('#starred-count').textContent = state.tasks.filter(t => t.starred && !t.done).length;
  $('#completed-count').textContent = completed;
  document.querySelectorAll('[data-view]').forEach(button => {
    button.classList.toggle('selected',button.dataset.view === view);
    if(button.dataset.view === view) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');
  });
  $('#page-title').textContent = viewCopy[view];
  const base = state.tasks.filter(t => view === 'starred' ? t.starred : view === 'completed' ? t.done : true);
  $('#filter-all-count').textContent = base.length;
  $('.task-tabs').hidden = view === 'completed';
  $('#add-form').hidden = view === 'completed';
  document.querySelectorAll('[data-filter]').forEach(button => {
    button.classList.toggle('active',button.dataset.filter === filter);
    button.setAttribute('aria-pressed',String(button.dataset.filter === filter));
  });
  const visible = base.filter(t => (filter === 'active' ? !t.done : filter === 'done' ? t.done : true) && t.text.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  visible.sort((a,b) => sort === 'az' ? a.text.localeCompare(b.text) : sort === 'oldest' ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt));
  const undone = visible.filter(t => !t.done), done = visible.filter(t => t.done);
  $('#task-list').innerHTML = undone.map(renderTask).join('') + (done.length && undone.length ? `<div class="section-label">Completed · ${done.length}</div>` : '') + done.map(renderTask).join('');
  if (focusMemory) {
    const row = [...document.querySelectorAll('.task-row')].find(el => el.dataset.id === focusMemory.id);
    row?.querySelector(focusMemory.action === 'checkbox' ? '.task-checkbox' : `[data-action="${focusMemory.action}"]`)?.focus({preventScroll:true});
  }
  $('#empty-state').hidden = visible.length > 0;
  $('#list-footer').hidden = visible.length === 0;
  $('#remaining-count').textContent = query ? `${visible.length} matching task${visible.length === 1 ? '' : 's'}` : `${base.filter(t => !t.done).length} left to do`;
  $('#empty-add').hidden = Boolean(query) || view !== 'all' || filter !== 'all';
  if (!visible.length) {
    const emptyCopy = query ? ['No tasks found', 'Try another search.'] : view === 'starred' ? ['No starred tasks', 'Star a task to find it here.'] : view === 'completed' || filter === 'done' ? ['No completed tasks', 'Completed tasks will appear here.'] : filter === 'active' && total ? ['No active tasks', 'All tasks are complete.'] : ['No tasks yet', 'Add a task to get started.'];
    $('#empty-title').textContent = emptyCopy[0];
    $('#empty-description').textContent = emptyCopy[1];
  }
  $('#shortcut-select').value = state.settings.shortcut;
  $('#shortcut-status').textContent = state.shortcutRegistered ? 'Available while Checkpoint is running.' : 'Unavailable. Choose a different shortcut.';
  $('#shortcut-status').classList.toggle('error', !state.shortcutRegistered);
  const notices = [state.recoveryMessage, !state.shortcutRegistered ? 'Quick capture shortcut unavailable. Change it in Settings.' : ''].filter(Boolean);
  $('#system-notice').hidden = !notices.length;
  $('#system-notice').textContent = notices.join(' ');
}

document.querySelectorAll('[data-window]').forEach(button => button.addEventListener('click', () => { void request(api.windowAction(button.dataset.window)).catch(()=>{}); }));
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {filter=button.dataset.filter;render();}));
$('#empty-add').addEventListener('click',focusInput);
$('#tip-capture').addEventListener('click',()=>{ void request(api.showCapture()).catch(()=>{}); });
$('#search').addEventListener('input',event=>{query=event.target.value;render();});
$('#sort').addEventListener('change',event=>{sort=event.target.value;render();});
$('#add-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const input = $('#task-input'), text = input.value.trim();
  if(!text || adding) {input.focus();return;}
  adding=true;
  $('#add-form button').disabled=true;
  try {
    await request(api.addTask(text, view === 'starred'));
    input.value=''; query=''; $('#search').value=''; filter='all'; render();
    notify('Task added.');
  } catch {} finally {adding=false;$('#add-form button').disabled=false;input.focus();}
});
$('#task-list').addEventListener('change',async event=>{
  if(!event.target.matches('.task-checkbox'))return;
  const id=event.target.closest('.task-row').dataset.id, done=event.target.checked;
  if(pending.has(id))return;
  pending.add(id); event.target.disabled=true;
  try {await request(api.updateTask(id,{done}));} catch {render();} finally {pending.delete(id);}
});
$('#task-list').addEventListener('click',async event=>{
  const button=event.target.closest('button[data-action]');if(!button)return;
  const id=button.closest('.task-row').dataset.id;
  const task=state.tasks.find(t=>t.id===id);if(!task)return;
  if(button.dataset.action==='edit') {
    editId=id;$('#edit-input').value=task.text;$('#edit-dialog').showModal();$('#edit-input').focus();return;
  }
  if(pending.has(id))return;
  pending.add(id);button.disabled=true;
  try {
    if(button.dataset.action==='star')await request(api.updateTask(id,{starred:!task.starred}));
    if(button.dataset.action==='delete'){await request(api.removeTask(id));notify('Task deleted.',{restoreId:id});}
  } catch {render();} finally {pending.delete(id);}
});
$('#edit-form').addEventListener('submit',async event=>{
  event.preventDefault();const button=$('#edit-form [type="submit"]');button.disabled=true;
  try{await request(api.updateTask(editId,{text:$('#edit-input').value}));$('#edit-dialog').close();notify('Task updated.');}
  catch{}finally{button.disabled=false;}
});
for(const id of ['#edit-close','#edit-cancel'])$(id).addEventListener('click',()=>$('#edit-dialog').close());
$('#settings-open').addEventListener('click',()=>$('#settings-dialog').showModal());
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
