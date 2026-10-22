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
  store.add('  Plan tomorrow 🌱  ',true);
  const id=store.snapshot().tasks[0].id;
  store.update(id,{done:true,text:'A clearer plan 🌱'});
  store.setShortcut('Control+Shift+K');
  const reopened=new TaskStore(directory).snapshot();
  assert.equal(reopened.tasks.length,1);
  assert.equal(reopened.tasks[0].text,'A clearer plan 🌱');
  assert.equal(reopened.tasks[0].done,true);
  assert.equal(reopened.tasks[0].starred,true);
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
