const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {execFileSync,spawn}=require('node:child_process');
const {startUpdateInstaller}=require('../src/update-installer.cjs');

function fixture(t,mode='portable',exitCode=0) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'checkpoint install test '));
  t.after(async()=>fs.promises.rm(directory,{recursive:true,force:true,maxRetries:20,retryDelay:100}));
  const executable=path.join(directory,'new update.exe');
  const buildScript=path.join(directory,'compile.ps1');
  fs.writeFileSync(buildScript,`param([string]$Output)
Add-Type -OutputAssembly $Output -OutputType ConsoleApplication -TypeDefinition 'public class Stub { public static void Main(string[] args) { System.IO.File.WriteAllText(System.Diagnostics.Process.GetCurrentProcess().MainModule.FileName + ".launched", string.Join(" ", args)); System.Environment.ExitCode = ${exitCode}; } }'`);
  execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',buildScript,'-Output',executable],{windowsHide:true});
  const target=path.join(directory,'Checkpoint with spaces.exe');
  const previous=Buffer.from('original portable launcher');fs.writeFileSync(target,previous);
  const configPath=path.join(directory,'config.json');
  const ready=path.join(directory,'ready');
  const config={download:executable,sha256:crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex'),
    version:'9.0.0',pid:0,mode,target,ready};
  fs.writeFileSync(configPath,JSON.stringify(config));
  return {directory,executable,target,previous,configPath,ready,config,helper:path.resolve('src/install-update.ps1')};
}
async function waitForResult(directory) {
  const resultFile=path.join(directory,'install-result.json');
  for(let attempt=0;attempt<150;attempt++) {
    if(fs.existsSync(resultFile)) {
      try{return JSON.parse(fs.readFileSync(resultFile,'utf8').replace(/^\uFEFF/,''));}catch{}
    }
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('Installer helper did not finish.');
}

test('production launcher acknowledges, waits, replaces the portable app and preserves a backup', {skip:process.platform!=='win32'}, async t=>{
  const data=fixture(t);
  const parent=spawn(process.execPath,['-e','setTimeout(()=>{},30000)'],{windowsHide:true,stdio:'ignore'});
  t.after(()=>{if(parent.exitCode===null)parent.kill();});
  fs.writeFileSync(data.configPath,JSON.stringify({...data.config,pid:parent.pid}));
  await startUpdateInstaller(data);
  assert.ok(fs.existsSync(data.ready));
  assert.deepEqual(fs.readFileSync(data.target),data.previous,'Replacement must wait for Checkpoint to quit');
  parent.kill();
  assert.equal((await waitForResult(data.directory)).ok,true);
  assert.deepEqual(fs.readFileSync(data.target),fs.readFileSync(data.executable));
  assert.deepEqual(fs.readFileSync(data.target+'.previous'),data.previous);
  for(let attempt=0;attempt<50&&!fs.existsSync(data.target+'.launched');attempt++)await new Promise(resolve=>setTimeout(resolve,100));
  assert.ok(fs.existsSync(data.target+'.launched'));
});

test('production helper survives the launching Electron app exiting for portable and installer updates', {skip:process.platform!=='win32'}, async t=>{
  for(const mode of ['portable','installer']) {
    const data=fixture(t,mode);
    const parentScript=path.join(data.directory,'parent.cjs');
    fs.writeFileSync(parentScript,`const fs=require('node:fs');
const {app}=require('electron');
const {startUpdateInstaller}=require(${JSON.stringify(path.resolve('src/update-installer.cjs'))});
const data=${JSON.stringify(data)};
app.setPath('userData',require('node:path').join(data.directory,'electron-data'));
fs.writeFileSync(data.configPath,JSON.stringify({...data.config,pid:process.pid}));
app.whenReady().then(()=>startUpdateInstaller(data)).then(()=>app.quit()).catch(error=>{console.error(error);app.exit(1);});`);
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
    const parent=spawn(require('electron'),[parentScript],{env,windowsHide:true,stdio:['ignore','ignore','pipe']});
    t.after(()=>{if(parent.exitCode===null)parent.kill();});
    let stderr='';parent.stderr.on('data',chunk=>stderr+=chunk);
    const exit=await new Promise((resolve,reject)=>{parent.once('error',reject);parent.once('exit',resolve);});
    assert.equal(exit,0,stderr);
    const result=await waitForResult(data.directory);
    assert.equal(result.ok,true,JSON.stringify({mode,...result}));
    const marker=(mode==='portable'?data.target:data.executable)+'.launched';
    for(let attempt=0;attempt<50&&!fs.existsSync(marker);attempt++)await new Promise(resolve=>setTimeout(resolve,100));
    assert.ok(fs.existsSync(marker),mode+' update did not launch after its parent quit');
    if(mode==='installer')assert.equal(fs.readFileSync(marker,'utf8'),'/S --force-run');
  }
});

test('production launcher reports verification failure and leaves the original app intact', {skip:process.platform!=='win32'}, async t=>{
  const data=fixture(t);
  fs.writeFileSync(data.configPath,JSON.stringify({...data.config,sha256:'0'.repeat(64),target:null}));
  await assert.rejects(startUpdateInstaller(data),/Update verification failed before installation/);
  assert.equal(fs.existsSync(data.ready),false);
  assert.deepEqual(fs.readFileSync(data.target),data.previous);
});

test('a failed Windows installer reports its actual exit code', {skip:process.platform!=='win32'}, async t=>{
  const data=fixture(t,'installer',23);
  const parent=spawn(process.execPath,['-e','setTimeout(()=>{},30000)'],{windowsHide:true,stdio:'ignore'});
  t.after(()=>{if(parent.exitCode===null)parent.kill();});
  fs.writeFileSync(data.configPath,JSON.stringify({...data.config,pid:parent.pid,target:null}));
  await startUpdateInstaller(data);
  parent.kill();
  const result=await waitForResult(data.directory);
  assert.equal(result.ok,false);
  assert.equal(result.error,'The installer exited with code 23.');
});
