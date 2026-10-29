const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {UpdateManager,isNewer,releaseAsset,trustedUrl,githubFetch} = require('../src/updater.cjs');

const executable = Buffer.from('MZ-test-windows-executable');
const checksum = crypto.createHash('sha256').update(executable).digest('hex');
function release(version='1.4.0',mode='portable') {
  const name=`Checkpoint-${version}-${mode==='portable'?'Windows':'Setup'}.exe`;
  const prefix=`https://github.com/athuljohny77/Checkpoint/releases/download/v${version}/`;
  return {tag_name:`v${version}`,draft:false,prerelease:false,body:'Update notes <script>never execute</script>',assets:[
    {name,size:executable.length,browser_download_url:prefix+name},
    {name:'SHA256SUMS.txt',browser_download_url:prefix+'SHA256SUMS.txt'}
  ]};
}
function fixture(t,options={}) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'checkpoint-update-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const metadata=release(); const events=[],notifications=[];
  const fetchImpl=async url => new Response(url.endsWith('/latest')?JSON.stringify(metadata):url.endsWith('SHA256SUMS.txt')?`${checksum}  ${metadata.assets[0].name}\n`:executable,{status:200});
  const manager=new UpdateManager({currentVersion:'1.3.0',directory,fetchImpl,onChange:s=>events.push(s),onAvailable:r=>notifications.push(r),...options});
  return {directory,manager,metadata,events,notifications};
}
test('version comparison avoids downgrade, prerelease and malformed versions',()=>{
  assert.equal(isNewer('v1.10.0','1.9.9'),true);
  for(const v of ['1.3.0','1.2.99','1.4.0-beta.1','1.04.0','garbage']) assert.equal(isNewer(v,'1.3.0'),false);
  assert.equal(isNewer('2.0.0','1.99.99'),true);
});
test('release assets must belong to this repository and match version and distribution',()=>{
  assert.match(releaseAsset(release(),'portable').filename,/Windows.exe$/);
  assert.match(releaseAsset(release('1.4.0','installer'),'installer').filename,/Setup.exe$/);
  const data=release(); data.assets[0].browser_download_url='https://evil.example/update.exe';
  assert.throws(()=>releaseAsset(data,'portable'),/complete Windows update/);
  assert.throws(()=>releaseAsset({...release(),assets:[]},'portable'));
  assert.equal(releaseAsset({...release(),prerelease:true},'portable'),null);
  assert.equal(trustedUrl('http://github.com/file'),false);
  assert.equal(trustedUrl('https://github.com.evil.example/file'),false);
});
test('checks notify once per version and never download automatically',async t=>{
  const {manager,notifications,directory}=fixture(t);
  assert.equal((await manager.check()).phase,'available');
  assert.equal((await manager.check()).version,'1.4.0');
  assert.equal(notifications.length,1);
  assert.deepEqual(fs.readdirSync(directory),[]);
});
test('verified downloads produce exact bytes and progress; checksum mismatch cannot install',async t=>{
  const {manager,events}=fixture(t);
  await manager.check();const downloaded=await manager.download();
  assert.deepEqual(fs.readFileSync(downloaded.file),executable);
  assert.equal(downloaded.sha256,checksum);
  assert.ok(events.some(s=>s.phase==='downloading'));
  assert.equal(manager.status.phase,'ready');
  manager.fetchImpl=async url=>new Response(url.endsWith('SHA256SUMS.txt')?`${'0'.repeat(64)}  ${manager.release.filename}`:executable);
  await assert.rejects(manager.download(),/verification failed/);
  assert.equal(manager.status.phase,'error');
  assert.equal(fs.existsSync(downloaded.file+'.part'),false);
});
test('network, rate limits, no releases and invalid metadata have clear states',async t=>{
  const {manager}=fixture(t);
  manager.fetchImpl=async()=>new Response('',{status:404});
  assert.equal((await manager.check()).phase,'current');
  manager.fetchImpl=async()=>new Response('',{status:403});
  assert.match((await manager.check()).error,/limiting/);
  manager.fetchImpl=async()=>{throw new Error('Network offline');};
  assert.match((await manager.check()).error,/offline/);
  manager.fetchImpl=async()=>new Response('{}');
  assert.equal((await manager.check()).phase,'error');
});
test('redirects cannot send update downloads to arbitrary hosts',async()=>{
  let calls=0;
  await assert.rejects(githubFetch('https://github.com/file',async()=>{calls++;return new Response('',{status:302,headers:{location:'https://evil.example/payload'}});}),/not trusted/);
  assert.equal(calls,1);
});
test('download rejects truncated files, non-executables and parallel starts',async t=>{
  const {manager}=fixture(t);
  await manager.check();
  manager.fetchImpl=async url=>new Response(url.endsWith('SHA256SUMS.txt')?`${checksum}  ${manager.release.filename}`:executable.subarray(0,5));
  await assert.rejects(manager.download(),/verification failed/);
  manager.status.phase='downloading';
  await assert.rejects(manager.download(),/Check for an available update first/);
});
