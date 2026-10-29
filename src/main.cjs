const { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, nativeImage, screen, dialog } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { TaskStore, SHORTCUTS, ROLLUP_SHORTCUTS } = require('./store.cjs');
const { gsap } = require('gsap/dist/gsap');
const { fitBounds } = require('./window-bounds.cjs');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { UpdateManager } = require('./updater.cjs');

const isTest = !app.isPackaged && process.env.CHECKPOINT_TEST === '1';
if (isTest && process.env.CHECKPOINT_DATA_DIR) app.setPath('userData', process.env.CHECKPOINT_DATA_DIR);
let mainWindow, captureWindow, tray, store;
let quitting = false;
let shortcutRegistered = false;
let captureReady;
let openingCapture = false;
let rolledUp = false, expandedHeight = 620, rollupRegistered = false, rollTween, cleanupTimer;
let startupError = '', cleanupError = '';
let boundsTimer;
let updater, updateTimer, initialUpdateTimer;
let updateInstallPending = false;
const updateMode = process.env.PORTABLE_EXECUTABLE_FILE ? 'portable' : 'installer';
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
  return { ...store.snapshot(), shortcutRegistered, rollupRegistered, rolledUp, appVersion: app.getVersion(), startupError, cleanupError, recoveryMessage: store.recoveryMessage,
    update: updater?.snapshot(), canInstallUpdates: app.isPackaged && process.platform === 'win32' };
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
function showUpdateSettings() {
  if (rolledUp) toggleRollup();
  showMain();
  mainWindow.webContents.send('update:open-settings');
}
async function installUpdate() {
  if (updateInstallPending) return updater.snapshot();
  updateInstallPending = true;
  try { return await performInstallUpdate(); }
  finally { updateInstallPending = false; }
}
async function performInstallUpdate() {
  if (!app.isPackaged || isTest) throw new Error('Install updates from the packaged Windows app.');
  if (!updater.release || !['available', 'error', 'ready'].includes(updater.status.phase)) throw new Error('Check for an available update first.');
  // Only a native confirmation permits downloading and executing a release.
  const confirmedRelease = updater.release;
  const { response } = await dialog.showMessageBox(mainWindow, { type: 'question',
    title: 'Install Checkpoint update?', message: `Install Checkpoint ${confirmedRelease.version}?`,
    detail: 'The update will be downloaded and verified. Checkpoint will then close, install the update, and reopen. Your tasks and settings will be kept.',
    buttons: ['Download and install', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true });
  if (response !== 0) return updater.snapshot();
  if (updater.release !== confirmedRelease) throw new Error('The release information changed. Please review the update and confirm again.');
  try {
    const download = await updater.download();
    const directory = updater.directory;
    const helper = path.join(directory, 'install-update.ps1');
    const configPath = path.join(directory, 'install-config.json');
    const ready = path.join(directory, 'installer-ready');
    fs.rmSync(ready, { force: true });
    fs.copyFileSync(path.join(__dirname, 'install-update.ps1'), helper);
    fs.writeFileSync(configPath, JSON.stringify({ download: download.file, sha256: download.sha256, version: download.version,
      pid: process.pid, mode: updateMode, target: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath, ready }));
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const child = spawn(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-Config', configPath], {
      detached: true, stdio: 'ignore', windowsHide: true
    });
    await new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (fs.existsSync(ready)) { clearInterval(timer); resolve(); }
        else if (Date.now() - started > 15000) { clearInterval(timer); child.kill(); reject(new Error('The update installer could not start. Checkpoint is still running; please retry.')); }
      }, 100);
      child.once('error', error => { clearInterval(timer); reject(error); });
      child.once('exit', code => { if (!fs.existsSync(ready)) { clearInterval(timer); reject(new Error(`The update installer exited before starting (${code}).`)); } });
    });
    child.unref();
    updater.change({ phase: 'installing' });
    app.quit();
    return updater.snapshot();
  } catch (error) { updater.change({ phase: 'error', error: error.message }); throw error; }
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
function saveWindowBounds() {
  clearTimeout(boundsTimer);
  if (!store || !mainWindow || mainWindow.isDestroyed()) return;
  const bounds = mainWindow.isMinimized() ? mainWindow.getNormalBounds() : mainWindow.getBounds();
  if (rolledUp || rollTween?.isActive()) bounds.height = expandedHeight;
  try { store.setWindowBounds(bounds); }
  catch (error) { console.error('Could not save window position:', error); }
}
function queueWindowBounds() {
  clearTimeout(boundsTimer);
  boundsTimer = setTimeout(saveWindowBounds, 200);
}
function toggleRollup() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  const bounds = mainWindow.getBounds();
  if (!rolledUp && !rollTween?.isActive()) expandedHeight = Math.max(460, bounds.height);
  rollTween?.kill();
  rolledUp = !rolledUp;
  mainWindow.setMinimumSize(340, 42);
  mainWindow.setResizable(false);
  const area = screen.getDisplayMatching(bounds).workArea;
  const target = rolledUp ? 42 : Math.min(expandedHeight, area.height);
  const height = { value: bounds.height };
  broadcast();
  rollTween = gsap.to(height, { value: target, duration: .26, ease: 'power2.inOut', onUpdate: () => {
    if (!mainWindow.isDestroyed()) mainWindow.setBounds({ height: Math.round(height.value) });
  }, onComplete: () => {
    if (mainWindow.isDestroyed()) return;
    if (!rolledUp) {
      const current = mainWindow.getBounds();
      mainWindow.setBounds({ y: Math.max(area.y, Math.min(current.y, area.y + area.height - target)) });
      mainWindow.setMinimumSize(340, Math.min(460, area.height));
      mainWindow.setResizable(true);
    }
  } });
  showMain();
}
function applyStartup(enabled) {
  // Tests never change the host account's login settings. Portable launches must
  // point at the permanent launcher, not Electron's temporary extraction folder.
  if (isTest) return;
  app.setLoginItemSettings({ openAtLogin: enabled, enabled,
    path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath,
    args: app.isPackaged ? [] : [`"${app.getAppPath()}"`], name: 'Checkpoint' });
}
function pruneCompleted() {
  try {
    const changed = store.pruneCompleted();
    const hadError = Boolean(cleanupError);
    cleanupError = '';
    if (changed || hadError) broadcast();
  } catch {
    cleanupError = 'Completed task cleanup could not be saved. Check disk space and folder permissions.';
    broadcast();
  }
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
    { label: updater?.status.version ? `Update available: v${updater.status.version}` : 'Check for updates', click: () => { showUpdateSettings(); if (!updater.status.version) void updater.check(); } },
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
  updater = new UpdateManager({ currentVersion: app.getVersion(), mode: updateMode,
    directory: path.join(app.getPath('userData'), 'updates'),
    ...(isTest && process.env.CHECKPOINT_UPDATE_FIXTURE ? { fetchImpl: async () => new Response(fs.readFileSync(process.env.CHECKPOINT_UPDATE_FIXTURE), {status:200}) } : {}),
    onChange: status => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:changed', status);
      updateTray();
    },
    onAvailable: release => {
      if (!isTest && tray) tray.displayBalloon({ title: 'Checkpoint update available', content: `Version ${release.version} is ready. Click to review and install.`, iconType: 'info', respectQuietTime: true });
    }
  });
  const installResult = path.join(updater.directory, 'install-result.json');
  if (fs.existsSync(installResult)) {
    try {
      const result = JSON.parse(fs.readFileSync(installResult, 'utf8').replace(/^\uFEFF/, ''));
      if (!result.ok) updater.change({phase:'error',error:result.error || 'The previous update could not be installed. Please retry.'});
      fs.unlinkSync(installResult);
    } catch (error) { console.error('Could not read update result:', error); }
  }
  try { applyStartup(store.state.settings.launchAtStartup); }
  catch { startupError = 'Windows startup could not be updated. Try changing it in Settings.'; }
  const icon = path.join(__dirname, '..', 'assets', 'checkpoint.png');
  const webPreferences = { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true };
  const saved = store.state.windowBounds;
  const restored = saved ? fitBounds(saved, screen.getDisplayMatching(saved).workArea) : { width: 400, height: 620 };
  expandedHeight = restored.height;
  mainWindow = new BrowserWindow({ width: 400, height: 620, minWidth: 340, minHeight: 460,
    ...restored,
    show: false, frame: false, resizable: true, maximizable: false, alwaysOnTop: store.state.settings.alwaysOnTop,
    backgroundColor: '#111413', title: 'Checkpoint', icon, webPreferences });
  captureWindow = new BrowserWindow({ width: 660, height: 248, show: false, frame: false,
    resizable: false, minimizable: false, maximizable: false, skipTaskbar: true,
    alwaysOnTop: true, backgroundColor: '#171b18', title: 'Quick capture · Checkpoint', icon, webPreferences });
  secureWindow(mainWindow);
  secureWindow(captureWindow);
  mainWindow.on('move', queueWindowBounds);
  mainWindow.on('resize', queueWindowBounds);
  mainWindow.on('session-end', saveWindowBounds);
  mainWindow.on('query-session-end', saveWindowBounds);
  mainWindow.on('close', event => {
    saveWindowBounds();
    if (!quitting) { event.preventDefault(); mainWindow.hide(); }
  });
  captureWindow.on('close', event => {
    if (!quitting) { event.preventDefault(); captureWindow.hide(); }
  });
  captureWindow.on('blur', () => { if (!isTest) captureWindow.hide(); });

  handle('state:get', () => state());
  handle('update:check', event => {
    if (event.sender !== mainWindow.webContents) throw new Error('Open Settings to check for updates.');
    return updater.check();
  });
  handle('update:install', event => {
    if (event.sender !== mainWindow.webContents) throw new Error('Open Settings to install updates.');
    return installUpdate();
  });
  handle('task:add', (_, text, priority) => { store.add(text, priority); broadcast(); return state(); });
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
  handle('settings:rollup-shortcut', (_, shortcut) => {
    if (!ROLLUP_SHORTCUTS.includes(shortcut)) throw new Error('Choose one of the available shortcuts.');
    const previous = store.state.settings.rollupShortcut;
    if (shortcut === previous && rollupRegistered) return state();
    if (!globalShortcut.register(shortcut, toggleRollup)) throw new Error('That shortcut is used by another app. Try a different one.');
    try { store.setSettings({ rollupShortcut: shortcut }); }
    catch (error) { if (shortcut !== previous) globalShortcut.unregister(shortcut); throw error; }
    if (shortcut !== previous) globalShortcut.unregister(previous);
    rollupRegistered = true; broadcast(); return state();
  });
  handle('settings:update', (_, changes) => {
    if (!changes || typeof changes !== 'object' || Object.keys(changes).some(key => !['launchAtStartup', 'autoDeleteDone', 'retentionDays'].includes(key))) throw new Error('Invalid settings.');
    const previous = store.snapshot().settings;
    store.setSettings(changes);
    try { if (Object.hasOwn(changes, 'launchAtStartup')) applyStartup(changes.launchAtStartup); }
    catch (error) { store.setSettings(previous); throw error; }
    startupError = ''; pruneCompleted(); broadcast(); return state();
  });
  handle('capture:hide', () => captureWindow.hide());
  handle('window:action', (event, action) => {
    if (event.sender !== mainWindow.webContents) return;
    if (action === 'minimize') mainWindow.minimize();
    if (action === 'close') mainWindow.close();
    if (action === 'quit') app.quit();
    if (action === 'rollup') toggleRollup();
    if (action === 'pin') {
      store.setSettings({ alwaysOnTop: !store.state.settings.alwaysOnTop });
      mainWindow.setAlwaysOnTop(store.state.settings.alwaysOnTop); broadcast();
    }
  });

  shortcutRegistered = globalShortcut.register(store.state.settings.shortcut, toggleCapture);
  rollupRegistered = globalShortcut.register(store.state.settings.rollupShortcut, toggleRollup);
  cleanupTimer = setInterval(pruneCompleted, 60000);
  tray = new Tray(nativeImage.createFromPath(icon).resize({ width: 32, height: 32 }));
  tray.on('double-click', showMain);
  tray.on('balloon-click', showUpdateSettings);
  updateTray();
  captureReady = captureWindow.loadFile(path.join(rendererPath, 'capture.html'));
  await mainWindow.loadFile(path.join(rendererPath, 'index.html'));
  mainWindow.show();
  if (!isTest && app.isPackaged) {
    initialUpdateTimer = setTimeout(() => void updater.check(), 15000);
    updateTimer = setInterval(() => void updater.check(), 6 * 60 * 60 * 1000);
  }
}
app.on('before-quit', () => { saveWindowBounds(); quitting = true; });
app.on('will-quit', () => { clearTimeout(initialUpdateTimer); clearInterval(updateTimer); clearInterval(cleanupTimer); rollTween?.kill(); globalShortcut.unregisterAll(); tray?.destroy(); });
app.on('window-all-closed', () => { if (quitting) app.quit(); });
app.on('activate', showMain);
