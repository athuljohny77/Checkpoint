const { _electron: electron, expect } = require('@playwright/test');
const path = require('node:path');
(async () => {
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const executable=process.argv[2] || 'dist/win-unpacked/Checkpoint.exe';
  const app=await electron.launch({executablePath:path.resolve(executable),env});
  try {
    let page;
    await expect.poll(()=>{page=app.windows().find(p=>p.url().endsWith('/index.html'));return Boolean(page);}).toBe(true);
    await expect(page.locator('#page-title')).toContainText('Your tasks');
    const result=await page.evaluate(()=>window.checkpoint.getState());
    if(!result.ok)throw new Error(result.error);
    await page.locator('#tip-capture').click();
    const capture=app.windows().find(p=>p.url().endsWith('/capture.html'));
    await expect(capture.locator('#capture-input')).toBeFocused();
    await capture.locator('#capture-input').press('Escape');
    await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle().includes('Quick capture')).isVisible())).toBe(false);
    const info=await app.evaluate(({app})=>({packaged:app.isPackaged,name:app.getName(),version:app.getVersion(),data:app.getPath('userData')}));
    if(!info.packaged)throw new Error('Expected a packaged app.');
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Checkpoint').setSize(760,600));
    await page.screenshot({path:path.resolve('artifacts/checkpoint-compact.png'),animations:'disabled'});
    console.log(JSON.stringify({...info,shortcutRegistered:result.value.shortcutRegistered,smoke:'passed'}));
  } finally {await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
