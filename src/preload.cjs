const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('checkpoint', {
  getState: () => ipcRenderer.invoke('state:get'),
  addTask: (text, priority) => ipcRenderer.invoke('task:add', text, priority),
  updateTask: (id, changes) => ipcRenderer.invoke('task:update', id, changes),
  removeTask: id => ipcRenderer.invoke('task:remove', id),
  restoreTask: id => ipcRenderer.invoke('task:restore', id),
  setShortcut: shortcut => ipcRenderer.invoke('settings:shortcut', shortcut),
  setRollupShortcut: shortcut => ipcRenderer.invoke('settings:rollup-shortcut', shortcut),
  updateSettings: changes => ipcRenderer.invoke('settings:update', changes),
  checkUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdate: callback => {
    const listener = (_, status) => callback(status);
    ipcRenderer.on('update:changed', listener);
    return () => ipcRenderer.removeListener('update:changed', listener);
  },
  onUpdateSettings: callback => {
    const listener = () => callback();
    ipcRenderer.on('update:open-settings', listener);
    return () => ipcRenderer.removeListener('update:open-settings', listener);
  },
  showCapture: () => ipcRenderer.invoke('capture:show'),
  hideCapture: () => ipcRenderer.invoke('capture:hide'),
  windowAction: action => ipcRenderer.invoke('window:action', action),
  onState: callback => {
    const listener = (_, state) => callback(state);
    ipcRenderer.on('state:changed', listener);
    return () => ipcRenderer.removeListener('state:changed', listener);
  },
  onCaptureFocus: callback => {
    const listener = () => callback();
    ipcRenderer.on('capture:focus', listener);
    return () => ipcRenderer.removeListener('capture:focus', listener);
  }
});
