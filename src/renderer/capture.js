const input = document.querySelector('#capture-input');
const form = document.querySelector('#capture-form');
const error = document.querySelector('#capture-error');
const submit = document.querySelector('#capture-submit');
let saving = false;
let picking = false;
function hide() { if (!saving) void window.checkpoint.hideCapture(); }
window.checkpoint.onCaptureFocus(() => {
  if (priorityDialog.open) finishPriority();
  error.hidden = true;
  document.querySelector('#capture-hint').textContent = 'Add to your tasks';
  motion.enter(document.querySelector('.capture-input-wrap'));
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
});
document.querySelector('#capture-close').addEventListener('click', hide);
document.addEventListener('keydown', event => { if(event.key === 'Escape' && !priorityDialog.open && !picking) hide(); });
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (saving || picking || !input.value.trim()) { if (!picking) input.focus(); return; }
  picking = true;
  const priority = await choosePriority();
  picking = false;
  if (!priority) { input.focus(); return; }
  saving = true; submit.disabled = true; input.readOnly = true; error.hidden = true;
  try {
    const result = await window.checkpoint.addTask(input.value, priority);
    if (!result.ok) throw new Error(result.error);
    input.value = '';
    document.querySelector('#capture-hint').textContent = 'Task added ✓';
    if (!motion.reduced()) await gsap.fromTo(submit, { scale: .8 }, { scale: 1, duration: .35, ease: 'back.out(3)', clearProps: 'transform' });
    await window.checkpoint.hideCapture();
  } catch (failure) { error.textContent = failure.message || 'Could not save your task. Please try again.'; error.hidden = false; }
  finally { saving = false; submit.disabled = false; input.readOnly = false; input.focus(); }
});
