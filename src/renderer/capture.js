const input = document.querySelector('#capture-input');
const form = document.querySelector('#capture-form');
const error = document.querySelector('#capture-error');
const submit = document.querySelector('#capture-submit');
let saving = false;
function hide() { if (!saving) void window.checkpoint.hideCapture(); }
window.checkpoint.onCaptureFocus(() => {
  error.hidden = true;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
});
document.querySelector('#capture-close').addEventListener('click', hide);
document.addEventListener('keydown', event => { if(event.key === 'Escape') hide(); });
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (saving || !input.value.trim()) { input.focus(); return; }
  saving = true; submit.disabled = true; input.readOnly = true; error.hidden = true;
  try {
    const result = await window.checkpoint.addTask(input.value);
    if (!result.ok) throw new Error(result.error);
    input.value = '';
    await window.checkpoint.hideCapture();
  } catch (failure) { error.textContent = failure.message || 'Could not save your task. Please try again.'; error.hidden = false; }
  finally { saving = false; submit.disabled = false; input.readOnly = false; input.focus(); }
});
