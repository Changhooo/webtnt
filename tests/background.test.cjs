'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../extension/background.js'),'utf8');

function harness(overrides={}) {
  let listener, captures=0;
  const chrome={
    runtime:{onMessage:{addListener:fn=>{listener=fn;}}},
    tabs:{get:async()=>({id:7,windowId:2,active:true}),query:async()=>[{id:7}],captureVisibleTab:async()=>{captures++;return 'data:image/png;base64,fixture';}},
    windows:{get:async()=>({focused:true})}
  };
  Object.assign(chrome.tabs,overrides.tabs);
  Object.assign(chrome.windows,overrides.windows);
  const context=vm.createContext({chrome,Date});vm.runInContext(source,context);
  const invoke=(sender={tab:{id:7},frameId:0})=>new Promise(resolve=>{
    assert.equal(listener({type:'TNT_CAPTURE'},sender,resolve),true);
  });
  return {invoke,get captures(){return captures;}};
}

test('capture is limited to an active, focused sender tab',async()=>{
  const inactive=harness({tabs:{get:async()=>({id:7,windowId:2,active:false})}});
  assert.equal((await inactive.invoke()).ok,false);assert.equal(inactive.captures,0);
  const unfocused=harness({windows:{get:async()=>({focused:false})}});
  assert.equal((await unfocused.invoke()).ok,false);assert.equal(unfocused.captures,0);
});
test('capture rejects extension pages and embedded frames as request sources',async()=>{
  const h=harness();assert.equal((await h.invoke({})).ok,false);
  assert.equal((await h.invoke({tab:{id:7},frameId:3})).ok,false);assert.equal(h.captures,0);
});
test('a successful capture returns only to the caller and is throttled',async()=>{
  const h=harness();const result=await h.invoke();
  assert.equal(result.ok,true);assert.match(result.dataURL,/^data:image\/png/);assert.equal(h.captures,1);
  assert.equal((await h.invoke()).ok,false);assert.equal(h.captures,1);
});
test('switching tab while capture is pending discards the image',async()=>{
  const h=harness({tabs:{query:async()=>[{id:99}]}});
  const result=await h.invoke();assert.equal(result.ok,false);assert.equal(result.dataURL,undefined);
});
test('losing window focus during capture discards the image',async()=>{
  let queries=0;
  const h=harness({windows:{get:async()=>({focused:++queries===1})}});
  const result=await h.invoke();assert.equal(result.ok,false);assert.equal(result.dataURL,undefined);
});
test('overlapping requests do not capture a second tab',async()=>{
  let finish;
  const h=harness({tabs:{captureVisibleTab:()=>new Promise(resolve=>{finish=resolve;})}});
  const first=h.invoke();await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await h.invoke()).ok,false);
  finish('data:image/png;base64,fixture');assert.equal((await first).ok,true);
});
