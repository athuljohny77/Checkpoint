// Verify a portable build launched with --remote-debugging-port=0.
const {chromium,expect}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
(async()=>{
  const port=process.argv[2] || fs.readFileSync(path.join(process.env.APPDATA,'Checkpoint','DevToolsActivePort'),'utf8').split(/\r?\n/)[0];
  const browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const pages=browser.contexts()[0].pages();
  const main=pages.find(p=>p.url().endsWith('/index.html'));
  if(!main)throw new Error('Checkpoint main window not found.');
  try {
    await expect(main.locator('#page-title')).toContainText('Your tasks');
    const result=await main.evaluate(()=>window.checkpoint.getState());
    if(!result.ok)throw new Error(result.error);
    await main.locator('#tip-capture').click();
    const capture=pages.find(p=>p.url().endsWith('/capture.html'));
    await expect(capture.locator('#capture-input')).toBeFocused();
    await capture.locator('#capture-input').press('Escape');
    console.log('Portable executable: launch, UI, storage bridge, and capture passed.');
  } finally {
    await main.evaluate(()=>window.checkpoint.windowAction('quit')).catch(()=>{});
    await browser.close().catch(()=>{});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
