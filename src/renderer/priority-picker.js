const priorityDialog = document.createElement('dialog');
priorityDialog.className = 'priority-dialog';
priorityDialog.setAttribute('aria-labelledby', 'priority-title');
priorityDialog.innerHTML = `<div class="dialog-content">
  <div class="dialog-heading"><h2 id="priority-title">Choose priority</h2><button type="button" class="icon-button" aria-label="Cancel priority selection">${icon('x')}</button></div>
  <p class="priority-prompt">Press a number to save your task.</p>
  <div class="priority-options"><button type="button" data-priority="low"><kbd>1</kbd>Low</button><button type="button" data-priority="medium"><kbd>2</kbd>Medium</button><button type="button" data-priority="high"><kbd>3</kbd>High</button></div>
</div>`;
document.body.append(priorityDialog);
let priorityResolve;
function finishPriority(priority = null) {
  if (!priorityResolve) return;
  const resolve = priorityResolve; priorityResolve = null;
  priorityDialog.close();
  resolve(priority);
}
priorityDialog.querySelector('.icon-button').addEventListener('click', () => finishPriority());
priorityDialog.querySelectorAll('[data-priority]').forEach(button => button.addEventListener('click', () => finishPriority(button.dataset.priority)));
priorityDialog.addEventListener('keydown', event => {
  const priority = { '1': 'low', '2': 'medium', '3': 'high' }[event.key];
  if (!priority || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
  event.preventDefault(); event.stopPropagation(); finishPriority(priority);
});
priorityDialog.addEventListener('cancel', event => { event.preventDefault(); finishPriority(); });
function choosePriority() {
  priorityDialog.returnValue = '';
  return new Promise(resolve => {
    priorityResolve = resolve;
    motion.dialog(priorityDialog);
    priorityDialog.querySelector('[data-priority="medium"]').focus();
  });
}
