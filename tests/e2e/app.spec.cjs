const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const root=path.resolve(__dirname,'../..');

async function launch(directory) {
  const env={...process.env,CHECKPOINT_TEST:'1',CHECKPOINT_DATA_DIR:directory};
  delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({args:[root],env});
  let page;
  await expect.poll(async()=>{page=app.windows().find(p=>p.url().endsWith('/index.html'));return Boolean(page);}).toBe(true);
  await page.waitForSelector('#page-title');
  await expect(page.locator('#shortcut-status')).toContainText('Available while Checkpoint is running');
  return {app,page};
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
    await page.getByRole('button',{name:'Star task',exact:true}).click();
    await page.locator('[data-view="starred"]').click();
    await expect(page.locator('.task-row')).toHaveCount(1);
    await page.getByRole('button',{name:'Edit task',exact:true}).click();
    await page.locator('#edit-input').fill('Make a little room to create');
    await page.getByRole('button',{name:'Save changes'}).click();
    await expect(page.locator('.task-text')).toHaveText('Make a little room to create');
    await page.getByRole('button',{name:'Delete task',exact:true}).click();
    await expect(page.locator('.task-row')).toHaveCount(0);
    await page.getByRole('button',{name:'Undo',exact:true}).click();
    await expect(page.locator('.task-row')).toHaveCount(1);
    await page.locator('[data-view="all"]').click();
    await page.locator('#search').fill('unmatched');
    await expect(page.locator('#empty-title')).toHaveText('No tasks found');
    await page.locator('#search').fill('create');
    await expect(page.locator('.task-row')).toHaveCount(1);
    await page.locator('#search').fill('');

    // Verify OS registration, then exercise capture while the main window is hidden.
    expect(await app.evaluate(({globalShortcut})=>globalShortcut.isRegistered('Control+Shift+Space'))).toBe(true);
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
    await page.screenshot({path:path.join(root,'artifacts','checkpoint-tasks.png'),animations:'disabled'});
    await page.locator('[data-filter="done"]').click();
    await expect(page.locator('.task-row')).toHaveCount(1);
    await page.locator('[data-filter="active"]').click();
    await expect(page.locator('.task-row')).toHaveCount(4);
    await page.locator('[data-view="completed"]').click();
    await expect(page.locator('.task-row')).toHaveCount(1);
    await page.locator('#settings-open').click();
    await page.locator('#shortcut-select').selectOption('Control+Shift+K');
    await expect(page.locator('#shortcut-status')).toContainText('Available while Checkpoint is running');
    expect(await app.evaluate(({globalShortcut})=>globalShortcut.isRegistered('Control+Shift+K'))).toBe(true);
    expect(await app.evaluate(({globalShortcut})=>globalShortcut.isRegistered('Control+Shift+Space'))).toBe(false);
    await page.getByRole('button',{name:'Close settings',exact:true}).click();
    await app.close();app=undefined;
    launched=await launch(directory);app=launched.app;page=launched.page;
    await expect(page.locator('.task-row')).toHaveCount(5);
    await expect(page.locator('.task-row.done')).toHaveCount(1);
    await expect(page.locator('.icon-button.starred')).toHaveCount(1);
    await expect(page.locator('#shortcut-select')).toHaveValue('Control+Shift+K');
    // Check the narrowest supported window for horizontal overflow.
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Checkpoint').setSize(760,600));
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    if(app)await app.close();
    fs.rmSync(directory,{recursive:true,force:true});
  }
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
    try {execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',helper],{windowsHide:true});}
    catch(error){if(error.status===2)test.skip(true,'Windows denied synthetic keyboard input in this session.');else throw error;}
    await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle().includes('Quick capture')).isVisible())).toBe(true);
  } finally {if(app)await app.close();fs.rmSync(directory,{recursive:true,force:true});}
});
