const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TaskStore } = require('../src/store.cjs');

function fixture(t) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'checkpoint-store-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  return {directory,store:new TaskStore(directory)};
}
test('tasks, Unicode text, completion, and shortcut survive reopening',t=>{
  const {directory,store}=fixture(t);
  store.add('  Plan tomorrow 🌱  ','high');
  const id=store.snapshot().tasks[0].id;
  store.update(id,{done:true,text:'A clearer plan 🌱'});
  store.setShortcut('Control+Shift+K');
  const reopened=new TaskStore(directory).snapshot();
  assert.equal(reopened.tasks.length,1);
  assert.equal(reopened.tasks[0].text,'A clearer plan 🌱');
  assert.equal(reopened.tasks[0].done,true);
  assert.equal(reopened.tasks[0].priority,'high');
  assert.ok(Date.parse(reopened.tasks[0].completedAt));
  assert.equal(reopened.settings.shortcut,'Control+Shift+K');
  store.update(id,{done:false});
  assert.equal(store.snapshot().tasks[0].completedAt,null);
});
test('deletion can be undone without duplicates',t=>{
  const {store}=fixture(t);store.add('First');store.add('Second');
  const id=store.snapshot().tasks[1].id;
  store.remove(id);assert.equal(store.snapshot().tasks.length,1);
  store.restore(id);assert.equal(store.snapshot().tasks[1].text,'First');
  assert.throws(()=>store.restore(id),/no longer/);
  assert.equal(store.snapshot().tasks.length,2);
});
test('invalid input cannot change saved data',t=>{
  const {store}=fixture(t);store.add('Keep this');const before=store.snapshot();
  for(const value of ['', '  ', null, 'x'.repeat(501)])assert.throws(()=>store.add(value));
  assert.throws(()=>store.update(before.tasks[0].id,{text:''}));
  assert.throws(()=>store.setShortcut('Alt+F4'));
  assert.throws(()=>store.update('missing',{done:true}));
  assert.deepEqual(store.snapshot(),before);
});
test('a failed write preserves the prior in-memory and on-disk state',t=>{
  const {store}=fixture(t);store.add('Keep this');const before=store.snapshot();
  const original=fs.readFileSync(store.file,'utf8');
  fs.mkdirSync(`${store.file}.tmp`);
  assert.throws(()=>store.add('Cannot save'));
  assert.deepEqual(store.snapshot(),before);
  assert.equal(fs.readFileSync(store.file,'utf8'),original);
});
test('corrupt task data is backed up before recovery',t=>{
  const {directory,store}=fixture(t);
  const damaged='{broken tasks data';fs.writeFileSync(store.file,damaged);
  const reopened=new TaskStore(directory);
  assert.match(reopened.recoveryMessage,/backup/);
  const backup=fs.readdirSync(directory).find(name=>name.includes('.recovered-'));
  assert.equal(fs.readFileSync(path.join(directory,backup),'utf8'),damaged);
  reopened.add('Recovered task');
  assert.equal(new TaskStore(directory).snapshot().tasks[0].text,'Recovered task');
});

test('legacy settings migrate and new preferences survive reopening', t => {
  const {directory, store} = fixture(t);
  fs.writeFileSync(store.file, JSON.stringify({version:1,tasks:[],settings:{shortcut:'Control+Shift+K'}}));
  const migrated = new TaskStore(directory);
  assert.equal(migrated.state.settings.retentionDays, 1);
  assert.equal(migrated.state.settings.autoDeleteDone, true);
  assert.equal(migrated.state.settings.launchAtStartup, true);
  assert.equal(migrated.state.settings.shortcut, 'Control+Shift+K');
  migrated.setSettings({rollupShortcut:'Control+Alt+M',alwaysOnTop:false,launchAtStartup:false,retentionDays:7,autoDeleteDone:false});
  assert.deepEqual(new TaskStore(directory).state.settings, migrated.state.settings);
  for (const changes of [{retentionDays:0},{retentionDays:1.5},{retentionDays:366},{autoDeleteDone:'yes'},{rollupShortcut:'Alt+F4'},{unknown:true}]) {
    const before = migrated.snapshot();
    assert.throws(() => migrated.setSettings(changes));
    assert.deepEqual(migrated.snapshot(), before);
  }
});

test('cleanup uses completion time, respects retention and disabled state, and runs on reopening', t => {
  const {directory,store} = fixture(t);
  store.add('Active'); store.add('Complete');
  const id = store.state.tasks[0].id;
  store.update(id,{done:true});
  const completed = Date.parse(store.state.tasks[0].completedAt);
  store.update(id,{done:true});
  assert.equal(Date.parse(store.state.tasks[0].completedAt), completed);
  assert.equal(store.pruneCompleted(completed + 86400000 - 1), false);
  store.setSettings({autoDeleteDone:false});
  assert.equal(store.pruneCompleted(completed + 86400000 * 10), false);
  store.setSettings({autoDeleteDone:true,retentionDays:7});
  assert.equal(store.pruneCompleted(completed + 86400000), false);
  assert.equal(store.pruneCompleted(completed + 86400000 * 7), true);
  assert.deepEqual(store.state.tasks.map(t=>t.text), ['Active']);
  store.add('Expired while closed'); store.update(store.state.tasks[0].id,{done:true});
  const saved = store.snapshot(); saved.tasks[0].completedAt = new Date(Date.now() - 86400000 * 8).toISOString();
  store.commit(saved);
  assert.deepEqual(new TaskStore(directory).state.tasks.map(t=>t.text), ['Active']);
});

test('reopening a completed task resets its expiry and cleanup cannot partially delete on a failed save', t => {
  const {store} = fixture(t);
  store.add('Keep'); const id=store.state.tasks[0].id;
  store.update(id,{done:true}); store.update(id,{done:false});
  assert.equal(store.pruneCompleted(Date.now()+86400000*2),false);
  store.update(id,{done:true}); const before=store.snapshot();
  fs.mkdirSync(`${store.file}.tmp`);
  assert.throws(()=>store.pruneCompleted(Date.now()+86400000*2));
  assert.deepEqual(store.snapshot(),before);
});

test('old stars migrate to priorities, with task data and completion preserved', t => {
  const {directory,store} = fixture(t);
  store.add('Important'); store.add('Normal');
  const legacy = store.snapshot();
  legacy.tasks.forEach((task,index) => { delete task.priority; task.starred = index === 1; });
  fs.writeFileSync(store.file,JSON.stringify(legacy));
  const migrated = new TaskStore(directory);
  assert.deepEqual(migrated.state.tasks.map(task=>task.priority),['medium','high']);
  assert.ok(migrated.state.tasks.every(task=>!Object.hasOwn(task,'starred')));
  migrated.update(migrated.state.tasks[0].id,{priority:'low'});
  assert.equal(new TaskStore(directory).state.tasks[0].priority,'low');
  const before = migrated.snapshot();
  for (const priority of ['',null,true,'urgent',4]) {
    assert.throws(()=>migrated.add('Invalid',priority));
    assert.throws(()=>migrated.update(before.tasks[0].id,{priority}));
  }
  assert.deepEqual(migrated.snapshot(),before);
});

test('window position persists, including negative monitor coordinates, and invalid positions are rejected', t => {
  const {directory,store} = fixture(t);
  const bounds = {x:-1500,y:100,width:400,height:620};
  store.setWindowBounds(bounds);
  assert.deepEqual(new TaskStore(directory).state.windowBounds,bounds);
  for (const invalid of [null,{}, {...bounds,x:NaN},{...bounds,width:0}]) assert.throws(()=>store.setWindowBounds(invalid));
  assert.deepEqual(store.state.windowBounds,bounds);
  const {fitBounds}=require('../src/window-bounds.cjs');
  assert.deepEqual(fitBounds(bounds,{x:-1920,y:0,width:1920,height:1080}),bounds);
  assert.deepEqual(fitBounds({x:5000,y:-2000,width:400,height:620},{x:0,y:0,width:1920,height:1080}),{x:1520,y:0,width:400,height:620});
  assert.deepEqual(fitBounds({x:0,y:0,width:2500,height:1500},{x:0,y:0,width:1280,height:720}),{x:0,y:0,width:1280,height:720});
});
