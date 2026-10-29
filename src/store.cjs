const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const SHORTCUTS = ['Control+Shift+Space', 'Control+Alt+Space', 'Control+Shift+K'];
const ROLLUP_SHORTCUTS = ['Control+Shift+M', 'Control+Alt+M', 'Control+Shift+Up'];
const PRIORITIES = ['low', 'medium', 'high'];
function taskPriority(value) {
  if (!PRIORITIES.includes(value)) throw new Error('Choose low, medium, or high priority.');
  return value;
}
function validBounds(value) {
  return value && ['x', 'y', 'width', 'height'].every(key => Number.isSafeInteger(value[key])) && value.width >= 1 && value.height >= 1;
}
const DEFAULT_SETTINGS = { shortcut: SHORTCUTS[0], rollupShortcut: ROLLUP_SHORTCUTS[0], alwaysOnTop: true, launchAtStartup: true, autoDeleteDone: true, retentionDays: 1 };

function validatedSettings(changes, current = DEFAULT_SETTINGS) {
  const next = { ...current };
  for (const [key, value] of Object.entries(changes)) {
    if (key === 'shortcut' && SHORTCUTS.includes(value) || key === 'rollupShortcut' && ROLLUP_SHORTCUTS.includes(value) ||
        ['alwaysOnTop', 'launchAtStartup', 'autoDeleteDone'].includes(key) && typeof value === 'boolean' ||
        key === 'retentionDays' && Number.isInteger(value) && value >= 1 && value <= 365) next[key] = value;
    else throw new Error('Choose a valid setting (cleanup must be between 1 and 365 days).');
  }
  return next;
}

function taskText(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Give your task a name first.');
  if (value.trim().length > 500) throw new Error('Keep your task under 500 characters.');
  return value.trim();
}

class TaskStore {
  constructor(directory) {
    this.file = path.join(directory, 'tasks.json');
    this.state = { version: 1, tasks: [], settings: { ...DEFAULT_SETTINGS }, windowBounds: null };
    this.recoveryMessage = '';
    fs.mkdirSync(directory, { recursive: true });
    if (fs.existsSync(this.file)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (parsed.version !== 1 || !Array.isArray(parsed.tasks)) throw new Error('Invalid data format');
        const ids = new Set();
        for (const task of parsed.tasks) {
          if (!task || typeof task.id !== 'string' || ids.has(task.id) || typeof task.done !== 'boolean' ||
              !Number.isFinite(Date.parse(task.createdAt)) ||
              (task.completedAt !== null && !Number.isFinite(Date.parse(task.completedAt)))) throw new Error('Invalid task');
          taskText(task.text);
          // Preserve the intent of existing stars when upgrading old saves.
          task.priority = Object.hasOwn(task, 'priority') ? taskPriority(task.priority) : task.starred ? 'high' : 'medium';
          delete task.starred;
          ids.add(task.id);
        }
        const settings = { ...DEFAULT_SETTINGS };
        for (const key of Object.keys(DEFAULT_SETTINGS)) {
          try { settings[key] = validatedSettings({ [key]: parsed.settings?.[key] })[key]; } catch { settings[key] = DEFAULT_SETTINGS[key]; }
        }
        this.state = { version: 1, tasks: parsed.tasks, settings, windowBounds: validBounds(parsed.windowBounds) ? parsed.windowBounds : null };
      } catch (error) {
        // Preserve the original file before starting a recovered list. Never overwrite unreadable data.
        const backup = `${this.file}.recovered-${Date.now()}`;
        fs.copyFileSync(this.file, backup, fs.constants.COPYFILE_EXCL);
        this.recoveryMessage = `Your previous task file could not be read. A backup was kept at ${backup}.`;
      }
    }
    this.deleted = new Map();
    this.pruneCompleted();
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

  add(text, priority = 'medium') {
    const next = this.snapshot();
    next.tasks.unshift({ id: randomUUID(), text: taskText(text), done: false,
      priority: taskPriority(priority), createdAt: new Date().toISOString(), completedAt: null });
    return this.commit(next);
  }

  update(id, changes) {
    const next = this.snapshot();
    const task = next.tasks.find(t => t.id === id);
    if (!task) throw new Error('This task no longer exists.');
    if (Object.hasOwn(changes, 'text')) task.text = taskText(changes.text);
    if (typeof changes.done === 'boolean' && task.done !== changes.done) {
      task.done = changes.done;
      task.completedAt = task.done ? new Date().toISOString() : null;
    }
    if (Object.hasOwn(changes, 'priority')) task.priority = taskPriority(changes.priority);
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
    return this.setSettings({ shortcut });
  }

  setSettings(changes) {
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new Error('Invalid settings.');
    const next = this.snapshot();
    next.settings = validatedSettings(changes, next.settings);
    return this.commit(next);
  }

  setWindowBounds(bounds) {
    if (!validBounds(bounds)) throw new Error('Invalid window bounds.');
    const next = this.snapshot();
    next.windowBounds = Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, bounds[key]]));
    if (JSON.stringify(next.windowBounds) !== JSON.stringify(this.state.windowBounds)) this.commit(next);
  }

  pruneCompleted(now = Date.now()) {
    if (!this.state.settings.autoDeleteDone) return false;
    const cutoff = now - this.state.settings.retentionDays * 86400000;
    const expired = task => task.done && task.completedAt !== null && Date.parse(task.completedAt) <= cutoff;
    const next = this.snapshot();
    next.tasks = next.tasks.filter(task => !expired(task));
    const changed = next.tasks.length !== this.state.tasks.length;
    if (changed) this.commit(next);
    for (const [id, entry] of this.deleted) if (expired(entry.task)) this.deleted.delete(id);
    return changed;
  }
}

module.exports = { TaskStore, SHORTCUTS, ROLLUP_SHORTCUTS };
