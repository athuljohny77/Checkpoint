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
