const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {execFileSync,spawn}=require('node:child_process');

test('portable helper waits, replaces the launcher, keeps a backup and starts the new executable', {skip:process.platform!=='win32'}, async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"checkpoint-install-test-"));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
  // A harmless test executable records that it ran and immediately exits.
  const executable=path.join(directory,'new.exe');
  const buildScript=path.join(directory,'compile.ps1');
  fs.writeFileSync(buildScript,`param([string]$Output)\nAdd-Type -OutputAssembly $Output -OutputType ConsoleApplication -TypeDefinition 'public class Stub { public static void Main() { System.IO.File.WriteAllText(System.Environment.GetEnvironmentVariable("CHECKPOINT_UPDATE_MARKER"), "launched"); } }'`);
  execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',buildScript,'-Output',executable],{windowsHide:true});
  const target=path.join(directory,'Checkpoint with spaces.exe');
  const previous=Buffer.from('original portable launcher');fs.writeFileSync(target,previous);
  const marker=path.join(directory,'launched.txt');
  const parent=spawn(process.execPath,['-e','setTimeout(()=>{},1500)'],{windowsHide:true,stdio:'ignore'});
  t.after(()=>{if(parent.exitCode===null)parent.kill();});
  const config=path.join(directory,'config.json');
  const ready=path.join(directory,'ready');
  fs.writeFileSync(config,JSON.stringify({download:executable,sha256:crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex'),
    version:'9.0.0',pid:parent.pid,mode:'portable',target,ready}));
  const helper=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.resolve('src/install-update.ps1'),'-Config',config],
    {windowsHide:true,stdio:'ignore',env:{...process.env,CHECKPOINT_UPDATE_MARKER:marker}});
  const exit=await new Promise((resolve,reject)=>{helper.once('error',reject);helper.once('exit',resolve);});
  assert.equal(exit,0);
  assert.ok(fs.existsSync(ready));
  assert.deepEqual(fs.readFileSync(target),fs.readFileSync(executable));
  assert.deepEqual(fs.readFileSync(target+'.previous'),previous);
  for(let attempt=0;attempt<50&&!fs.existsSync(marker);attempt++)await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(fs.readFileSync(marker,'utf8'),'launched');
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'install-result.json'),'utf8').replace(/^\uFEFF/, '')).ok,true);
});
