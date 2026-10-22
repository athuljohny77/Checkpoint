const { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, nativeImage, screen, dialog } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { TaskStore, SHORTCUTS } = require('./store.cjs');

const isTest = !app.isPackaged && process.env.CHECKPOINT_TEST === '1';
if (isTest && process.env.CHECKPOINT_DATA_DIR) app.setPath('userData', process.env.CHECKPOINT_DATA_DIR);
let mainWindow, captureWindow, tray, store;
let quitting = false;
let shortcutRegistered = false;
let captureReady;
let openingCapture = false;
const rendererPath = path.join(__dirname, 'renderer');
const pages = ['index.html', 'capture.html'].map(name => pathToFileURL(path.join(rendererPath, name)).href);

if (!isTest && !app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => showMain());
  app.whenReady().then(start).catch(error => {
    dialog.showErrorBox('Checkpoint could not start', error.message);
    app.quit();
  });
}

function state() {
  return { ...store.snapshot(), shortcutRegistered, recoveryMessage: store.recoveryMessage };
}
function broadcast() {
  for (const win of [mainWindow, captureWindow]) {
    if (win && !win.isDestroyed()) win.webContents.send('state:changed', state());
  }
  updateTray();
}
function showMain() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}
async function showCapture() {
  if (openingCapture) return;
  openingCapture = true;
  try {
    await captureReady;
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const width = Math.min(660, workArea.width - 32);
    const height = 248;
    captureWindow.setBounds({ width, height,
      x: Math.round(workArea.x + (workArea.width - width) / 2),
      y: Math.round(workArea.y + (workArea.height - height) / 2) });
    captureWindow.show();
    captureWindow.focus();
    captureWindow.webContents.send('capture:focus');
  } finally { openingCapture = false; }
}
function toggleCapture() {
  if (captureWindow?.isVisible()) captureWindow.hide();
  else void showCapture();
}
function secureWindow(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
}
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    const sender = event.senderFrame;
    if (!sender || !pages.includes(sender.url) || ![mainWindow?.webContents, captureWindow?.webContents].includes(event.sender)) {
      return { ok: false, error: 'Untrusted request.' };
    }
    try { return { ok: true, value: await fn(event, ...args) }; }
    catch (error) {
      console.error(`[${channel}]`, error);
      return { ok: false, error: error.code ? 'Could not save your changes. Check available disk space and folder permissions, then try again.' : error.message };
    }
  });
}
function updateTray() {
  if (!tray) return;
  const count = store.state.tasks.filter(t => !t.done).length;
  tray.setToolTip(`Checkpoint · ${count} task${count === 1 ? '' : 's'} left`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Checkpoint', click: showMain },
    { label: 'Quick capture', accelerator: store.state.settings.shortcut, click: () => void showCapture() },
    { type: 'separator' },
    { label: `${count} task${count === 1 ? '' : 's'} left`, enabled: false },
    { type: 'separator' },
    { label: 'Quit Checkpoint', click: () => app.quit() }
  ]));
}
async function start() {
  // Use the same data folder for development, the portable app, and the installer.
  if (!isTest) app.setPath('userData', path.join(app.getPath('appData'), 'Checkpoint'));
  app.setAppUserModelId('com.checkpoint.desktop');
  Menu.setApplicationMenu(null);
  store = new TaskStore(app.getPath('userData'));
  const icon = path.join(__dirname, '..', 'assets', 'checkpoint.png');
  const webPreferences = { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true };
  mainWindow = new BrowserWindow({ width: 400, height: 620, minWidth: 340, minHeight: 460,
    show: false, frame: false, resizable: true, maximizable: false, alwaysOnTop: true,
    backgroundColor: '#111413', title: 'Checkpoint', icon, webPreferences });
  captureWindow = new BrowserWindow({ width: 660, height: 248, show: false, frame: false,
    resizable: false, minimizable: false, maximizable: false, skipTaskbar: true,
    alwaysOnTop: true, backgroundColor: '#171b18', title: 'Quick capture · Checkpoint', icon, webPreferences });
  secureWindow(mainWindow);
  secureWindow(captureWindow);
  mainWindow.on('close', event => {
    if (!quitting) { event.preventDefault(); mainWindow.hide(); }
  });
  captureWindow.on('close', event => {
    if (!quitting) { event.preventDefault(); captureWindow.hide(); }
  });
  captureWindow.on('blur', () => { if (!isTest) captureWindow.hide(); });

  handle('state:get', () => state());
  handle('task:add', (_, text, starred) => { store.add(text, starred); broadcast(); return state(); });
  handle('task:update', (_, id, changes) => {
    if (!changes || typeof changes !== 'object') throw new Error('Invalid task changes.');
    store.update(id, changes); broadcast(); return state();
  });
  handle('task:remove', (_, id) => { store.remove(id); broadcast(); return state(); });
  handle('task:restore', (_, id) => { store.restore(id); broadcast(); return state(); });
  handle('settings:shortcut', (_, shortcut) => {
    if (!SHORTCUTS.includes(shortcut)) throw new Error('Choose one of the available shortcuts.');
    const previous = store.state.settings.shortcut;
    if (shortcut === previous && shortcutRegistered) return state();
    if (!globalShortcut.register(shortcut, toggleCapture)) throw new Error('That shortcut is used by another app. Try a different one.');
    try { store.setShortcut(shortcut); }
    catch (error) { if (shortcut !== previous) globalShortcut.unregister(shortcut); throw error; }
    if (shortcut !== previous) globalShortcut.unregister(previous);
    shortcutRegistered = true;
    broadcast();
    return state();
  });
  handle('capture:show', () => showCapture());
  handle('capture:hide', () => captureWindow.hide());
  handle('window:action', (event, action) => {
    if (event.sender !== mainWindow.webContents) return;
    if (action === 'minimize') mainWindow.minimize();
    if (action === 'close') mainWindow.close();
    if (action === 'quit') app.quit();
  });

  shortcutRegistered = globalShortcut.register(store.state.settings.shortcut, toggleCapture);
  tray = new Tray(nativeImage.createFromPath(icon).resize({ width: 32, height: 32 }));
  tray.on('double-click', showMain);
  updateTray();
  captureReady = captureWindow.loadFile(path.join(rendererPath, 'capture.html'));
  await mainWindow.loadFile(path.join(rendererPath, 'index.html'));
  mainWindow.show();
}
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => { globalShortcut.unregisterAll(); tray?.destroy(); });
app.on('window-all-closed', () => { if (quitting) app.quit(); });
app.on('activate', showMain);
