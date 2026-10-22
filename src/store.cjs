const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const SHORTCUTS = ['Control+Shift+Space', 'Control+Alt+Space', 'Control+Shift+K'];
const DEFAULT_SETTINGS = { shortcut: SHORTCUTS[0] };

function taskText(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Give your task a name first.');
  if (value.trim().length > 500) throw new Error('Keep your task under 500 characters.');
  return value.trim();
}

class TaskStore {
  constructor(directory) {
    this.file = path.join(directory, 'tasks.json');
    this.state = { version: 1, tasks: [], settings: { ...DEFAULT_SETTINGS } };
    this.recoveryMessage = '';
    fs.mkdirSync(directory, { recursive: true });
    if (fs.existsSync(this.file)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (parsed.version !== 1 || !Array.isArray(parsed.tasks)) throw new Error('Invalid data format');
        const ids = new Set();
        for (const task of parsed.tasks) {
          if (!task || typeof task.id !== 'string' || ids.has(task.id) || typeof task.done !== 'boolean' ||
              typeof task.starred !== 'boolean' || !Number.isFinite(Date.parse(task.createdAt)) ||
              (task.completedAt !== null && !Number.isFinite(Date.parse(task.completedAt)))) throw new Error('Invalid task');
          taskText(task.text);
          ids.add(task.id);
        }
        this.state = { version: 1, tasks: parsed.tasks, settings: {
          shortcut: SHORTCUTS.includes(parsed.settings?.shortcut) ? parsed.settings.shortcut : SHORTCUTS[0]
        } };
      } catch (error) {
        // Preserve the original file before starting a recovered list. Never overwrite unreadable data.
        const backup = `${this.file}.recovered-${Date.now()}`;
        fs.copyFileSync(this.file, backup, fs.constants.COPYFILE_EXCL);
        this.recoveryMessage = `Your previous task file could not be read. A backup was kept at ${backup}.`;
      }
    }
    this.deleted = new Map();
  }

  snapshot() { return structuredClone(this.state); }

  commit(next) {
    const temporary = `${this.file}.tmp`;
    // A successful save replaces the old file atomically; in-memory state changes only after saving.
    const fd = fs.openSync(temporary, 'w');
    try {
      fs.writeFileSync(fd, JSON.stringify(next, null, 2), 'utf8');
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, this.file);
    this.state = next;
    return this.snapshot();
  }

  add(text, starred = false) {
    const next = this.snapshot();
    next.tasks.unshift({ id: randomUUID(), text: taskText(text), done: false,
      starred: Boolean(starred), createdAt: new Date().toISOString(), completedAt: null });
    return this.commit(next);
  }

  update(id, changes) {
    const next = this.snapshot();
    const task = next.tasks.find(t => t.id === id);
    if (!task) throw new Error('This task no longer exists.');
    if (Object.hasOwn(changes, 'text')) task.text = taskText(changes.text);
    if (typeof changes.done === 'boolean') {
      task.done = changes.done;
      task.completedAt = task.done ? new Date().toISOString() : null;
    }
    if (typeof changes.starred === 'boolean') task.starred = changes.starred;
    return this.commit(next);
  }

  remove(id) {
    const next = this.snapshot();
    const index = next.tasks.findIndex(t => t.id === id);
    if (index === -1) throw new Error('This task no longer exists.');
    const [task] = next.tasks.splice(index, 1);
    const state = this.commit(next);
    this.deleted.set(id, { task, index });
    if (this.deleted.size > 50) this.deleted.delete(this.deleted.keys().next().value);
    return state;
  }

  restore(id) {
    const removed = this.deleted.get(id);
    if (!removed) throw new Error('This task can no longer be restored.');
    const next = this.snapshot();
    next.tasks.splice(Math.min(removed.index, next.tasks.length), 0, removed.task);
    const state = this.commit(next);
    this.deleted.delete(id);
    return state;
  }

  setShortcut(shortcut) {
    if (!SHORTCUTS.includes(shortcut)) throw new Error('Choose one of the available shortcuts.');
    const next = this.snapshot();
    next.settings.shortcut = shortcut;
    return this.commit(next);
  }
}

module.exports = { TaskStore, SHORTCUTS };
