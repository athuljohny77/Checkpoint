const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const root=path.resolve(__dirname,'../..');

async function launch(directory) {
  const save = path.join(directory, 'tasks.json');
  if (!fs.existsSync(save)) fs.writeFileSync(save, JSON.stringify({version:1,tasks:[],settings:{shortcut:'Control+Alt+Space'}}));
  const env={...process.env,CHECKPOINT_TEST:'1',CHECKPOINT_DATA_DIR:directory};
  delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({args:[root],env});
  let page;
  try {
  await expect.poll(async()=>{page=app.windows().find(p=>p.url().endsWith('/index.html'));return Boolean(page);}).toBe(true);
  await page.waitForSelector('#page-title');
  await expect(page.locator('#shortcut-status')).toContainText('Available while Checkpoint is running');
  return {app,page};
  } catch (error) { await app.close(); throw error; }
}
test('desktop capture, task lifecycle, filters, safe rendering, and restart persistence',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'checkpoint-e2e-'));
  let app;
  const errors=[];
  try {
    let launched=await launch(directory);app=launched.app;let page=launched.page;
    page.on('pageerror',e=>errors.push(e.message));
    const widget=await app.evaluate(({BrowserWindow})=>{
      const main=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Checkpoint');
      return {bounds:main.getBounds(),alwaysOnTop:main.isAlwaysOnTop()};
    });
    expect(widget.bounds.width).toBe(400);
    expect(widget.bounds.height).toBe(620);
    expect(widget.alwaysOnTop).toBe(true);
    await expect(page.locator('#empty-title')).toHaveText('No tasks yet');
    fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});
    await page.screenshot({path:path.join(root,'artifacts','checkpoint-empty.png'),animations:'disabled'});
    await page.locator('#task-input').fill('Sketch the next big idea');
    await page.locator('#task-input').press('Enter');
    await expect(page.locator('.task-row')).toHaveCount(1);
    await page.locator('.task-checkbox').check();
    await expect(page.locator('.task-row')).toHaveClass(/done/);
    await expect(page.locator('.task-text')).toHaveCSS('text-decoration-line','line-through');
    await page.locator('.task-checkbox').uncheck();
    await page.locator('.task-row .priority-select').first().selectOption('high');
    await expect(page.locator('.task-row')).toHaveCount(1);
    await page.getByRole('button',{name:'Edit task',exact:true}).click();
    await page.locator('#edit-input').fill('Make a little room to create');
    await page.getByRole('button',{name:'Save changes'}).click();
    await expect(page.locator('.task-text')).toHaveText('Make a little room to create');
    await page.getByRole('button',{name:'Delete task',exact:true}).click();
    await expect(page.locator('.task-row')).toHaveCount(0);
    await page.getByRole('button',{name:'Undo',exact:true}).click();
    await expect(page.locator('.task-row')).toHaveCount(1);
    await page.locator('[data-filter="all"]').click();
    await page.locator('#search').fill('unmatched');
    await expect(page.locator('#empty-title')).toHaveText('No tasks found');
    await page.locator('#search').fill('create');
    await expect(page.locator('.task-row')).toHaveCount(1);
    await page.locator('#search').fill('');

    // Verify OS registration, then exercise capture while the main window is hidden.
    expect(await app.evaluate(({globalShortcut})=>globalShortcut.isRegistered('Control+Alt+Space'))).toBe(true);
    await page.getByRole('button',{name:'Close to tray',exact:true}).click();
    await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Checkpoint').isVisible())).toBe(false);
    await page.evaluate(()=>window.checkpoint.showCapture());
    await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle().includes('Quick capture')).isVisible())).toBe(true);
    const capture=app.windows().find(p=>p.url().endsWith('/capture.html'));
    capture.on('pageerror',e=>errors.push(e.message));
    await expect(capture.locator('#capture-input')).toBeFocused();
    const geometry=await app.evaluate(({BrowserWindow,screen})=>{
      const bounds=BrowserWindow.getAllWindows().find(w=>w.getTitle().includes('Quick capture')).getBounds();
      return {bounds,area:screen.getDisplayMatching(bounds).workArea};
    });
    expect(Math.abs(geometry.bounds.x+geometry.bounds.width/2-geometry.area.x-geometry.area.width/2)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.bounds.y+geometry.bounds.height/2-geometry.area.y-geometry.area.height/2)).toBeLessThanOrEqual(1);
    await capture.locator('#capture-input').fill('Send the design over for a second look');
    await capture.screenshot({path:path.join(root,'artifacts','checkpoint-capture.png'),animations:'disabled'});
    await capture.locator('#capture-input').press('Enter');
    await expect(capture.locator('.priority-dialog')).toBeVisible();
    await expect(page.locator('.task-row')).toHaveCount(1);
    await capture.keyboard.press('2');
    await expect(page.locator('.task-row')).toHaveCount(2);
    await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle().includes('Quick capture')).isVisible())).toBe(false);
    await app.evaluate(({BrowserWindow})=>{const main=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Checkpoint');main.show();main.focus();});

    for(const title of ['A long walk, without the phone','Pick up a few things for dinner','Read a chapter before bed','<img src=x onerror="alert(1)">']) {
      await page.locator('#task-input').fill(title);await page.locator('#task-input').press('Enter');
      await expect(page.locator('.task-text',{hasText:title})).toHaveCount(1);
    }
    await expect(page.locator('.task-text img')).toHaveCount(0);
    await page.locator('.task-row').filter({hasText:'<img src=x'}).getByRole('button',{name:'Delete task'}).click();
    await page.locator('.task-row').filter({hasText:'Read a chapter'}).locator('.task-checkbox').check();
    await page.locator('#toast-dismiss').click();
    await page.locator('#task-list').evaluate(el=>{el.scrollTop=0;});
    await expect.poll(()=>page.evaluate(()=>gsap.globalTimeline.getChildren().filter(tween=>tween.isActive()).length)).toBe(0);
    await page.screenshot({path:path.join(root,'artifacts','checkpoint-tasks.png'),animations:'disabled'});
    await page.locator('[data-filter="done"]').click();
    await expect(page.locator('.task-row')).toHaveCount(1);
    await page.locator('[data-filter="active"]').click();
    await expect(page.locator('.task-row')).toHaveCount(4);
    await page.locator('[data-filter="done"]').click();
    await expect(page.locator('.task-row')).toHaveCount(1);
    await page.locator('#settings-open').click();
    await page.locator('#shortcut-select').selectOption('Control+Shift+K');
    await expect(page.locator('#shortcut-status')).toContainText('Available while Checkpoint is running');
    expect(await app.evaluate(({globalShortcut})=>globalShortcut.isRegistered('Control+Shift+K'))).toBe(true);
    expect(await app.evaluate(({globalShortcut})=>globalShortcut.isRegistered('Control+Alt+Space'))).toBe(false);
    await page.getByRole('button',{name:'Close settings',exact:true}).click();
    await app.close();app=undefined;
    launched=await launch(directory);app=launched.app;page=launched.page;
    await expect(page.locator('.task-row')).toHaveCount(5);
    await expect(page.locator('.task-row.done')).toHaveCount(1);
    await expect(page.locator('.priority-high')).toHaveCount(1);
    await expect(page.locator('#shortcut-select')).toHaveValue('Control+Shift+K');
    // Check the narrowest supported window for horizontal overflow.
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Checkpoint').setSize(760,600));
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    if(app)await app.close();
    fs.rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
});

test('pin, roll-up, priority ordering, GSAP effects and settings persist', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'checkpoint-settings-'));
  let app;
  try {
    let launched = await launch(directory); app = launched.app; let page = launched.page;
    const errors=[]; page.on('pageerror', e=>errors.push(e.message));
    await expect(page.locator('[data-view]')).toHaveCount(0);
    await expect(page.locator('#tip-capture')).toHaveCount(0);
    await expect(page.locator('[data-filter]')).toHaveCount(3);
    await expect(page.locator('#rollup-toggle')).toHaveCount(0);
    await expect(page.locator('.settings-note')).toHaveCount(0);
    expect(await page.evaluate(()=>gsap.version)).toMatch(/^3\./);
    await page.locator('#pin-toggle').click();
    await expect(page.locator('#pin-toggle')).toHaveAttribute('aria-pressed','false');
    expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Checkpoint').isAlwaysOnTop())).toBe(false);
    await page.locator('#task-input').fill('Z high priority task'); await page.locator('#task-input').press('Enter');
    await page.locator('.task-row .priority-select').first().selectOption('high');
    await page.locator('#task-input').fill('A newer task'); await page.locator('#task-input').press('Enter');
    await expect.poll(()=>page.evaluate(()=>gsap.getTweensOf([...document.querySelectorAll('.task-row')]).length)).toBeGreaterThan(0);
    await expect(page.locator('.task-text').first()).toHaveText('Z high priority task');
    await page.locator('#sort').selectOption('az');
    await expect(page.locator('.task-text').first()).toHaveText('Z high priority task');
    await page.locator('.task-row').last().locator('.task-checkbox').check();
    await expect(page.locator('.confetti-piece')).toHaveCount(18);
    await expect(page.locator('.confetti-layer')).toHaveCount(0);
    await page.evaluate(()=>window.checkpoint.windowAction('rollup'));
    await expect(page.locator('#window-title')).toHaveText('1 active task');
    await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Checkpoint').getBounds().height)).toBe(42);
    await page.screenshot({path:path.join(root,'artifacts','checkpoint-rolled-up.png')});
    await page.evaluate(()=>window.checkpoint.windowAction('rollup'));
    await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Checkpoint').getBounds().height)).toBe(620);
    await expect(page.locator('#task-input')).toBeVisible();
    await page.locator('#settings-open').click();
    await expect(page.locator('.dev-credit')).toHaveText('by Athul Johny © 2026');
    await expect(page.locator('#app-version')).toHaveText('v1.2.0');
    await expect(page.locator('#startup-toggle')).toBeChecked();
    await expect(page.locator('#cleanup-toggle')).toBeChecked();
    await expect(page.locator('#retention-days')).toHaveValue('1');
    // Reserve a shortcut in the OS and verify a failed change preserves the old one.
    await app.evaluate(({globalShortcut})=>globalShortcut.register('Control+Alt+M',()=>{}));
    await page.locator('#rollup-shortcut-select').selectOption('Control+Alt+M');
    await expect(page.locator('#rollup-shortcut-select')).toHaveValue('Control+Shift+M');
    await app.evaluate(({globalShortcut})=>globalShortcut.unregister('Control+Alt+M'));
    await page.locator('#rollup-shortcut-select').selectOption('Control+Alt+M');
    expect(await app.evaluate(({globalShortcut})=>globalShortcut.isRegistered('Control+Alt+M'))).toBe(true);
    expect(await app.evaluate(({globalShortcut})=>globalShortcut.isRegistered('Control+Shift+M'))).toBe(false);
    await page.locator('#startup-toggle').uncheck();
    await page.locator('#retention-days').fill('7'); await page.locator('#retention-days').press('Tab');
    await page.locator('#cleanup-toggle').uncheck();
    await expect(page.locator('#retention-days')).toBeDisabled();
    await page.screenshot({path:path.join(root,'artifacts','checkpoint-settings.png')});
    await page.locator('#settings-dialog').evaluate(dialog=>{dialog.scrollTop=0;});
    await page.screenshot({path:path.join(root,'artifacts','checkpoint-settings-top.png')});
    await app.close(); app=undefined;
    launched=await launch(directory); app=launched.app; page=launched.page;
    await expect(page.locator('#pin-toggle')).toHaveAttribute('aria-pressed','false');
    await expect(page.locator('#rollup-shortcut-select')).toHaveValue('Control+Alt+M');
    await expect(page.locator('#startup-toggle')).not.toBeChecked();
    await expect(page.locator('#cleanup-toggle')).not.toBeChecked();
    await expect(page.locator('#retention-days')).toHaveValue('7');
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.locator('.task-row').first().locator('.task-checkbox').click();
    await expect(page.locator('.task-row.done')).toHaveCount(2);
    await expect(page.locator('.confetti-piece')).toHaveCount(0);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Checkpoint').setSize(340,460));
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path:path.join(root,'artifacts','checkpoint-narrow.png')});
    expect(errors).toEqual([]);
  } finally { if(app) await app.close(); fs.rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100}); }
});

test('native global shortcut opens capture with the main window hidden',async()=>{
  const helper=path.join(root,'tests','send-hotkey.ps1');
  try {execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',helper,'-CheckDesktop'],{windowsHide:true});}
  catch(error){if(error.status===2)test.skip(true,'This automation session cannot access the Windows input desktop.');else throw error;}
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'checkpoint-hotkey-'));
  let app;
  try {
    const launched=await launch(directory);app=launched.app;
    await launched.page.getByRole('button',{name:'Close to tray',exact:true}).click();
    try {execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',helper,'-Keys','^% '],{windowsHide:true});}
    catch(error){if(error.status===2)test.skip(true,'Windows denied synthetic keyboard input in this session.');else throw error;}
    await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle().includes('Quick capture')).isVisible())).toBe(true);
    await launched.page.evaluate(()=>window.checkpoint.hideCapture());
    execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',helper,'-Keys','^+m'],{windowsHide:true});
    await expect(launched.page.locator('body')).toHaveClass(/rolled-up/);
    execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',helper,'-Keys','^+m'],{windowsHide:true});
    await expect(launched.page.locator('body')).not.toHaveClass(/rolled-up/);
  } finally {if(app)await app.close();fs.rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

test('quick capture chooses priorities with 1/2/3, cancels safely, and retries failed saves',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'checkpoint-priority-'));
  let app;
  try {
    const launched=await launch(directory); app=launched.app; const page=launched.page;
    const capture=app.windows().find(p=>p.url().endsWith('/capture.html'));
    const errors=[]; capture.on('pageerror',error=>errors.push(error.message));
    for (const [key,priority] of [['1','low'],['2','medium'],['3','high']]) {
      await page.evaluate(()=>window.checkpoint.showCapture());
      await capture.locator('#capture-input').fill(`${priority} capture`);
      await capture.locator('#capture-input').press('Enter');
      await expect(capture.locator('.priority-dialog')).toBeVisible();
      if (key==='1') {
        await capture.keyboard.press('4');
        await expect(page.locator('.task-row')).toHaveCount(0);
        await capture.keyboard.press('Escape');
        await expect(capture.locator('.priority-dialog')).not.toBeVisible();
        await expect(capture.locator('#capture-input')).toHaveValue('low capture');
        await capture.locator('#capture-input').press('Enter');
        await capture.screenshot({path:path.join(root,'artifacts','checkpoint-priority-picker.png')});
      }
      await capture.keyboard.press(key);
      await expect(page.locator('.task-row').filter({hasText:`${priority} capture`}).locator('.priority-select')).toHaveValue(priority);
      await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle().includes('Quick capture')).isVisible())).toBe(false);
    }
    await expect(page.locator('.task-text')).toHaveText(['high capture','medium capture','low capture']);
    await page.locator('#sort').selectOption('az');
    await expect(page.locator('.task-text')).toHaveText(['high capture','medium capture','low capture']);
    await page.evaluate(()=>window.checkpoint.showCapture());
    await capture.locator('#capture-input').fill('Keep draft on failure');
    fs.mkdirSync(path.join(directory,'tasks.json.tmp'));
    await capture.locator('#capture-input').press('Enter'); await capture.keyboard.press('3');
    await expect(capture.locator('#capture-error')).toBeVisible();
    await expect(capture.locator('#capture-input')).toHaveValue('Keep draft on failure');
    await expect(page.locator('.task-row')).toHaveCount(3);
    fs.rmdirSync(path.join(directory,'tasks.json.tmp'));
    await capture.locator('#capture-input').press('Enter');
    await capture.locator('[data-priority="low"]').click();
    await expect(page.locator('.task-row').filter({hasText:'Keep draft on failure'}).locator('.priority-select')).toHaveValue('low');
    await expect(page.locator('.task-row')).toHaveCount(4);
    expect(errors).toEqual([]);
  } finally {if(app)await app.close();fs.rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

test('window location persists while rolled up and is restored within the current display',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'checkpoint-position-'));
  let app;
  try {
    let launched=await launch(directory);app=launched.app;
    const moved=await app.evaluate(({BrowserWindow,screen})=>{
      const main=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Checkpoint');
      const area=screen.getDisplayMatching(main.getBounds()).workArea;
      main.setBounds({x:area.x+80,y:area.y+50,width:420,height:560});
      return main.getBounds();
    });
    const readBounds=()=>JSON.parse(fs.readFileSync(path.join(directory,'tasks.json'),'utf8')).windowBounds;
    await expect.poll(readBounds).toEqual(moved);
    await launched.page.evaluate(()=>window.checkpoint.windowAction('rollup'));
    await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Checkpoint').getBounds().height)).toBe(42);
    await app.evaluate(({BrowserWindow})=>{
      const main=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Checkpoint');
      const b=main.getBounds();main.setPosition(b.x+25,b.y+25);
    });
    const expected={...moved,x:moved.x+25,y:moved.y+25};
    await expect.poll(readBounds).toEqual(expected);
    await app.close();app=undefined;
    launched=await launch(directory);app=launched.app;
    expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Checkpoint').getBounds())).toEqual(expected);
    await app.close();app=undefined;
    const saved=JSON.parse(fs.readFileSync(path.join(directory,'tasks.json'),'utf8'));
    saved.windowBounds={...expected,x:100000,y:100000};
    fs.writeFileSync(path.join(directory,'tasks.json'),JSON.stringify(saved));
    launched=await launch(directory);app=launched.app;
    const result=await app.evaluate(({BrowserWindow,screen})=>{
      const bounds=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Checkpoint').getBounds();
      return {bounds,area:screen.getDisplayMatching(bounds).workArea};
    });
    expect(result.bounds.x).toBeGreaterThanOrEqual(result.area.x);
    expect(result.bounds.y).toBeGreaterThanOrEqual(result.area.y);
    expect(result.bounds.x+result.bounds.width).toBeLessThanOrEqual(result.area.x+result.area.width);
    expect(result.bounds.y+result.bounds.height).toBeLessThanOrEqual(result.area.y+result.area.height);
  } finally {if(app)await app.close();fs.rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
