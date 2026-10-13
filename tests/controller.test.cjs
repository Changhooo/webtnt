/* Real content/settings/renderer integration in a simulated DOM + native Canvas.
 * This verifies controller behavior, never Chrome permissions or screen capture.
 * npm i -D happy-dom @napi-rs/canvas
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { setTimeout: wait } = require('node:timers/promises');
const extension = path.resolve(__dirname, '../extension');

function dependency(name) {
  for (const base of ['', ...(process.env.TNT_QA_DEPENDENCIES||'').split(path.delimiter).filter(Boolean)]) {
    try { return require.resolve(base ? path.join(base, name) : name); } catch {}
  }
  throw new Error(`Missing test dependency: ${name}; install happy-dom and @napi-rs/canvas.`);
}
function backgroundRecord(name='custom.png',color='#df33a0'){
  const {createCanvas}=require(dependency('@napi-rs/canvas'));
  const canvas=createCanvas(32,24),context=canvas.getContext('2d');
  context.fillStyle=color;context.fillRect(0,0,32,24);context.fillStyle='#0ed5b9';context.fillRect(0,0,16,12);
  return {dataURL:canvas.toDataURL('image/png'),width:32,height:24,name};
}
async function setup(configuration = {}) {
  const { Window } = await import(pathToFileURL(dependency('happy-dom')).href);
  const { createCanvas, loadImage } = require(dependency('@napi-rs/canvas'));
  const window = new Window({url:'https://fixture.test/', width:1000, height:700, settings:{disableCSSFileLoading:true, disableJavaScriptFileLoading:true}});
  const document = window.document;
  document.body.innerHTML = '<h1>真实页面文字</h1><p>文字、图片和按钮继续工作。</p><textarea id="note">未提交文字</textarea><button id="counter">增加</button><output id="count">0</output>';
  let count = 0;
  document.querySelector('#counter').addEventListener('click', () => { document.querySelector('#count').textContent = String(++count); });
  const fixture = createCanvas(1000, 700);
  const f = fixture.getContext('2d');
  f.fillStyle = '#f6f0dd'; f.fillRect(0,0,1000,700);
  f.fillStyle = '#446bb4'; f.fillRect(100,80,380,230);
  f.fillStyle = '#f5c544'; f.fillRect(480,80,360,230);
  f.fillStyle = '#20202a'; f.font = '32px sans-serif'; f.fillText('PAGE CONTENT 123',150,200);
  const captureURL = fixture.toDataURL('image/png');
  let captureMode = 'success', captureResolver, captureCalls = 0, bitmapClosed = 0;
  let backgroundDecodeMode=configuration.backgroundDecode||'success';
  const captureDecodeWaiters=[];
  const backgroundBitmaps=[],backgroundWaiters=[];
  const captureBytes=Buffer.from(captureURL.split(',')[1],'base64');
  const runtimeListeners = new Set(), storageListeners = configuration.sharedStorage?.listeners||new Set();
  const storage = configuration.sharedStorage?.values||{tntSettings:configuration.settings,tntBackground:configuration.background};
  const event = listeners => ({addListener:fn=>listeners.add(fn), removeListener:fn=>listeners.delete(fn)});
  window.chrome = {
    runtime:{getURL:x=>`https://fixture.test/${x}`, onMessage:event(runtimeListeners), sendMessage:async message=>{
      assert.equal(message.type,'TNT_CAPTURE');
      assert.equal(document.querySelector('#tnt-blast-root').style.visibility,'hidden','the capture must exclude every TNT overlay element');
      assert.equal(document.querySelector('#tnt-blast-root').style.opacity,'0','a child visibility declaration must not leak the fixed TNT into the screenshot');
      captureCalls++;
      if (captureMode === 'failure') return {ok:false,error:'测试截图失败'};
      if (captureMode === 'deferred') return new Promise(resolve=>{captureResolver=resolve;});
      return {ok:true,dataURL:captureURL};
    }},
    storage:{local:{get:async()=>({...storage}),set:async data=>{
      const changes={};for(const [key,value] of Object.entries(data)){changes[key]={oldValue:storage[key],newValue:value};storage[key]=value;}
      for(const fn of storageListeners) fn(changes,'local');
    },remove:async key=>{
      const changes={[key]:{oldValue:storage[key]}};delete storage[key];for(const fn of storageListeners)fn(changes,'local');
    }},onChanged:event(storageListeners)}
  };
  let time=0, id=0;
  const audioCalls=[],audioPlayers=[];
  // Real controller phase transitions are exercised below. The separate audio
  // suite verifies decoding and Web Audio nodes; this spy records their handoff.
  class AudioPlayerSpy {
    constructor(options){this.options=options;audioPlayers.push(this);}
    record(type,kind,options){audioCalls.push({type,kind,options:options&&{...options},time,phase:window.__TNTController?.phase});}
    prepare(){this.record('prepare');return Promise.resolve();}
    play(kind,options){this.record('play',kind,options);return Promise.resolve();}
    stopAll(){this.record('stopAll');}
    close(){this.record('close');return Promise.resolve();}
  }
  const timers=new Map(), frames=new Map();
  Object.defineProperty(window.performance,'now',{value:()=>time,configurable:true});
  window.setTimeout=(fn,ms=0)=>{const key=++id;timers.set(key,{fn,at:time+ms});return key;};
  window.clearTimeout=key=>timers.delete(key);
  window.requestAnimationFrame=fn=>{const key=++id;frames.set(key,fn);return key;};
  window.cancelAnimationFrame=key=>frames.delete(key);
  window.OffscreenCanvas=class{constructor(width,height){const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;return canvas;}};
  window.fetch=globalThis.fetch;
  window.createImageBitmap=async blob=>{
    const bytes=Buffer.from(await blob.arrayBuffer()),img=await loadImage(bytes);
    if(bytes.equals(captureBytes)){
      img.close=()=>bitmapClosed++;
      if(configuration.captureDecode==='deferred')return new Promise(resolve=>captureDecodeWaiters.push(()=>resolve(img)));
      return img;
    }
    const record={image:img,closeCalls:0};backgroundBitmaps.push(record);img.close=()=>record.closeCalls++;
    if(backgroundDecodeMode==='failure')throw new Error('测试背景解码失败');
    if(backgroundDecodeMode==='deferred')return new Promise(resolve=>backgroundWaiters.push(()=>resolve(img)));
    return img;
  };
  const nativeFor=canvas=>{
    if(!canvas.__native) canvas.__native=createCanvas(Number(canvas.getAttribute('width'))||300,Number(canvas.getAttribute('height'))||150);
    return canvas.__native;
  };
  Object.defineProperties(window.HTMLCanvasElement.prototype,{
    width:{configurable:true,get(){return nativeFor(this).width;},set(v){nativeFor(this).width=v;}},
    height:{configurable:true,get(){return nativeFor(this).height;},set(v){nativeFor(this).height=v;}}
  });
  window.HTMLCanvasElement.prototype.getContext=function(type){
    if(type!=='2d') return null;
    const native=nativeFor(this), context=native.getContext('2d');
    return new Proxy(context,{
      get(target,key){
        if(key==='drawImage') return (image,...args)=>target.drawImage(image.__native||image,...args);
        const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
      },
      set(target,key,value){Reflect.set(target,key,value,target);return true;}
    });
  };
  window.HTMLElement.prototype.setPointerCapture=function(key){this.__pointer=key;};
  window.HTMLElement.prototype.hasPointerCapture=function(key){return this.__pointer===key;};
  window.HTMLElement.prototype.releasePointerCapture=function(){delete this.__pointer;};
  const flush=async()=>{for(let i=0;i<8;i++) await new Promise(resolve=>setImmediate(resolve));};
  const until=async predicate=>{for(let i=0;i<120;i++){if(predicate())return;if(frames.size)await advance(16);await wait(5);await flush();}assert.fail('simulated native async operation did not settle');};
  const advance=async(ms)=>{
    const target=time+ms;
    while(true){
      const due=[...timers].filter(([,value])=>value.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];
      if(!due) break;
      time=due[1].at;timers.delete(due[0]);due[1].fn();await flush();
    }
    time=target;
    const active=[...frames];frames.clear();for(const [,fn] of active) fn(time);
    await flush();
  };
  for(const file of ['settings.js','background-image.js','engine.js','audio.js']) window.eval(fs.readFileSync(path.join(extension,file),'utf8'));
  window.TNTAudio={...window.TNTAudio,Player:AudioPlayerSpy};
  window.eval(fs.readFileSync(path.join(extension,'content.js'),'utf8'));
  await flush();
  const controller=window.__TNTController;
  const message=payload=>new Promise(resolve=>{
    let replied=false;
    for(const fn of runtimeListeners) fn(payload,{},response=>{replied=true;resolve(response);});
    if(!replied) resolve(undefined);
  });
  const pointer=(type,x,y,button=0)=>controller.button.dispatchEvent(new window.PointerEvent(type,{pointerId:1,clientX:x,clientY:y,button,buttons:type==='pointerup'?0:button===2?2:1,bubbles:true}));
  const click=()=>{pointer('pointerdown',controller.x,controller.y);pointer('pointerup',controller.x,controller.y);};
  const finishFuse=async()=>{await advance(controller.settings.fuseMs);await advance(16);await advance(16);await until(()=>controller.phase!=='capture');assert.equal(controller.phase,'scatter',controller.shadow.querySelector('.toast').textContent);};
  const igniteToScatter=async()=>{click();assert.equal(controller.phase,'fuse');await finishFuse();};
  const alphaSum=()=>{const data=nativeFor(controller.canvas).getContext('2d').getImageData(0,0,1000,700).data;let total=0;for(let i=3;i<data.length;i+=4)total+=data[i];return total;};
  return {window,document,controller,message,pointer,click,advance,flush,until,finishFuse,igniteToScatter,alphaSum,timers,frames,runtimeListeners,storageListeners,storage,backgroundBitmaps,backgroundWaiters,captureDecodeWaiters,audioCalls,audioPlayers,
    get captureCalls(){return captureCalls;},get bitmapClosed(){return bitmapClosed;},set captureMode(mode){captureMode=mode;},resolveCapture:()=>captureResolver({ok:true,dataURL:captureURL}),
    set backgroundDecodeMode(mode){backgroundDecodeMode=mode;},resolveBackground:async index=>{backgroundWaiters[index||0]();await flush();},
    resolveCaptureDecode:async()=>{captureDecodeWaiters.shift()();await flush();},
    updateBackground:async value=>{await window.chrome.storage.local.set({tntBackground:value});await flush();},
    close:async()=>{controller.destroy();await window.happyDOM.close();}};
}

test('right drag only moves with its grab offset; left pointerup ignites',async()=>{
  const q=await setup();try{
    const {controller:c}=q;
    q.pointer('pointerdown',c.x+18,c.y+20,2);q.pointer('pointermove',400,300,2);q.pointer('pointerup',400,300,2);
    assert.equal(c.phase,'idle');assert.equal(q.captureCalls,0);assert.equal(c.x,382);assert.equal(c.y,280);
    assert.equal(c.targetPreview.hidden,true,'right dragging must not leave a targeting ghost');
    q.click();assert.equal(c.phase,'fuse');
    q.window.document.dispatchEvent(new q.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    assert.equal(c.phase,'idle');await q.advance(900);assert.equal(q.captureCalls,0);
  }finally{await q.close();}
});
test('left drop explodes at the mouse point while the fixed TNT position survives every phase',async()=>{
  const q=await setup();try{
    const c=q.controller;
    const position=()=>({x:c.x,y:c.y,left:c.button.style.left,top:c.button.style.top});
    const targets=[{x:400,y:280},{x:2,y:3},{x:998,y:697}];
    for(const [index,target] of targets.entries()){
      if(index===1){
        const previous=position();q.pointer('pointerdown',c.x+11,c.y+13,2);q.pointer('pointermove',720,260,2);q.pointer('pointerup',720,260,2);
        assert.notDeepEqual(position(),previous,'right dragging changes the fixed position');assert.equal(c.phase,'idle');
      }
      const fixed=position();
      q.pointer('pointerdown',c.x+17,c.y+12);q.pointer('pointermove',target.x,target.y);
      assert.equal(c.phase,'idle','left dragging must not ignite before release');
      assert.deepEqual(position(),fixed,'left dragging must not move the actual TNT icon');
      assert.equal(c.targetPreview.hidden,false,'left dragging shows a separate target preview');
      assert.deepEqual({x:c.drag.preview.x,y:c.drag.preview.y},target);
      q.pointer('pointerup',target.x,target.y);assert.equal(c.phase,'fuse');
      assert.deepEqual(position(),fixed,'left release must preserve the fixed position');
      assert.equal(c.targetPreview.hidden,false,'the remote target remains visible during its fuse');
      await q.advance(799);assert.equal(c.phase,'fuse');assert.equal(c.engine.running,false);
      assert.deepEqual(position(),fixed,'the fixed icon coordinates stay unchanged during the target fuse');
      await q.advance(1);await q.advance(16);await q.advance(16);await q.until(()=>c.phase!=='capture');
      assert.equal(c.phase,'scatter',c.shadow.querySelector('.toast').textContent);
      assert.deepEqual({x:c.engine.options.center.x,y:c.engine.options.center.y},target,'visible TNT clamping must not move the blast center');
      assert.deepEqual(position(),fixed,'the blast must not relocate the fixed icon');
      assert.equal(c.button.style.visibility,'visible','the fixed icon remains present during the remote explosion');
      assert.equal(c.targetPreview.hidden,true,'the target preview disappears before the blast');
      await q.advance(1000);assert.equal(c.phase,'hold');assert.deepEqual(position(),fixed);
      await q.advance(2500);assert.equal(c.phase,'restore');assert.deepEqual(position(),fixed);
      await q.advance(350);assert.equal(c.phase,'idle');assert.deepEqual(position(),fixed,'the original fixed position survives restoration');
    }
  }finally{await q.close();}
});
test('right-drag contextmenu stays closed; a fresh right click opens the menu',async()=>{
  const q=await setup();try{
    const c=q.controller;
    q.pointer('pointerdown',c.x,c.y,2);q.pointer('pointermove',420,310,2);q.pointer('pointerup',420,310,2);
    c.button.dispatchEvent(new q.window.MouseEvent('contextmenu',{button:2,bubbles:true}));
    assert.equal(c.dock.hidden,true);assert.equal(c.phase,'idle');
    q.pointer('pointerdown',c.x,c.y,2);q.pointer('pointerup',c.x,c.y,2);
    c.button.dispatchEvent(new q.window.MouseEvent('contextmenu',{button:2,bubbles:true}));
    assert.equal(c.dock.hidden,false);assert.equal(c.phase,'idle');assert.equal(q.captureCalls,0);
  }finally{await q.close();}
});
test('cancel, lost capture and Escape preserve fixed TNT and never ignite',async()=>{
  for(const event of ['pointercancel','lostpointercapture','Escape']){
    const q=await setup();try{
      const c=q.controller,fixed={x:c.x,y:c.y,left:c.button.style.left,top:c.button.style.top};
      q.pointer('pointerdown',c.x,c.y);q.pointer('pointermove',400,280);
      if(event==='Escape')q.document.dispatchEvent(new q.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      else c.button.dispatchEvent(new q.window.PointerEvent(event,{pointerId:1,bubbles:true}));
      q.pointer('pointerup',400,280);
      await q.advance(1000);assert.equal(c.phase,'idle');assert.equal(q.captureCalls,0);
      assert.deepEqual({x:c.x,y:c.y,left:c.button.style.left,top:c.button.style.top},fixed);
      assert.equal(c.drag,null);
      assert.equal(c.targetPreview.hidden,true);assert.equal(c.targetPreview.classList.contains('fuse'),false);
    }finally{await q.close();}
  }
});
test('real controller, texture crop and native renderer complete every phase and clear',async()=>{
  const q=await setup();try{
    await q.igniteToScatter();const c=q.controller;
    assert.equal(c.host.dataset.capture,'ready');assert.ok(c.engine.fragments.length>50);assert.ok(q.alphaSum()>0);assert.equal(q.bitmapClosed,1);
    assert.equal(c.host.style.visibility,'');assert.equal(c.host.style.opacity,'');await q.advance(1000);assert.equal(c.phase,'hold');
    await q.advance(2500);assert.equal(c.phase,'restore');await q.advance(350);assert.equal(c.phase,'idle');
    assert.equal(c.engine.running,false);assert.equal(c.engine.fragments.length,0);assert.equal(c.engine.smokeSprites.length,0);assert.equal(q.alphaSum(),0);assert.equal(c.host.dataset.capture,'none');
    assert.equal(q.document.querySelector('#note').value,'未提交文字');q.document.querySelector('#counter').click();assert.equal(q.document.querySelector('#count').textContent,'1');
  }finally{await q.close();}
});
test('failed capture returns to idle and displays the failure without leftover texture',async()=>{
  const q=await setup();try{
    assert.equal(q.controller.host.shadowRoot,null,'the page must not expose screenshot pixels through an open shadow root');
    q.captureMode='failure';q.click();await q.advance(800);await q.advance(16);await q.advance(16);
    assert.equal(q.controller.phase,'idle');assert.equal(q.controller.host.style.visibility,'');assert.equal(q.controller.host.style.opacity,'');assert.equal(q.alphaSum(),0);
    assert.equal(q.controller.shadow.querySelector('.toast').textContent,'测试截图失败');
  }finally{await q.close();}
});
test('a slow screenshot decode keeps the primed drop target until the first blast frame',async()=>{
  for(const showHints of [true,false]){
    const q=await setup({settings:{showHints},captureDecode:'deferred'});try{
      const c=q.controller,fixed={x:c.x,y:c.y,left:c.button.style.left,top:c.button.style.top};
      q.pointer('pointerdown',c.x,c.y);q.pointer('pointermove',400,280);q.pointer('pointerup',400,280);
      assert.equal(c.phase,'fuse');assert.equal(c.targetPreview.hidden,false);
      await q.advance(800);await q.advance(16);await q.advance(16);
      assert.equal(c.phase,'capture');assert.equal(c.targetPreview.hidden,false,'capture state must not clear the target');
      assert.equal(c.host.style.opacity,'','the overlay is restored as soon as the screenshot returns');
      await q.until(()=>q.captureDecodeWaiters.length===1);await q.advance(1000);
      assert.equal(c.phase,'capture');assert.equal(c.host.style.visibility,'');assert.equal(c.host.style.opacity,'');
      assert.equal(c.targetPreview.hidden,false,'a one-second decoder delay leaves the target visible');
      assert.equal(c.targetPreview.classList.contains('fuse'),true,'the target continues burning during preparation');
      assert.equal(c.targetPreview.querySelector('.hint').hidden,!showHints);
      assert.deepEqual({x:c.x,y:c.y,left:c.button.style.left,top:c.button.style.top},fixed);
      const start=c.engine.start.bind(c.engine);
      c.engine.start=options=>{
        assert.equal(c.phase,'capture');assert.equal(c.targetPreview.hidden,false,'the target stays present before cache preparation');
        const result=start(options);
        assert.equal(c.phase,'scatter');assert.equal(c.targetPreview.hidden,true);
        assert.ok(q.alphaSum()>0,'a painted explosion replaces the target in the same first-frame handoff');
        return result;
      };
      await q.resolveCaptureDecode();await q.until(()=>c.phase==='scatter');
      assert.equal(q.bitmapClosed,1);await q.advance(3850);assert.equal(c.phase,'idle');assert.equal(q.alphaSum(),0);
    }finally{await q.close();}
  }
});
test('cancel during decoded-image preparation clears the target and discards the late result',async()=>{
  const q=await setup({captureDecode:'deferred'});try{
    const c=q.controller;
    q.pointer('pointerdown',c.x,c.y);q.pointer('pointermove',400,280);q.pointer('pointerup',400,280);
    await q.advance(800);await q.advance(16);await q.advance(16);await q.until(()=>q.captureDecodeWaiters.length===1);
    assert.equal(c.targetPreview.hidden,false);assert.equal(c.host.style.opacity,'');
    c.restore();await q.resolveCaptureDecode();await q.until(()=>q.bitmapClosed===1);
    assert.equal(c.phase,'idle');assert.equal(c.targetPreview.hidden,true);assert.equal(c.engine.running,false);
    assert.equal(c.host.style.visibility,'');assert.equal(c.host.style.opacity,'');assert.equal(q.alphaSum(),0);
  }finally{await q.close();}
});
test('scroll or resize cancels pending screenshot and late response never resurrects it',async()=>{
  for(const name of ['scroll','resize']){
    const q=await setup();try{
      q.captureMode='deferred';q.click();await q.advance(800);await q.advance(16);await q.advance(16);assert.equal(q.controller.phase,'capture');
      q.window.dispatchEvent(new q.window.Event(name));assert.equal(q.controller.phase,'idle');assert.equal(q.controller.host.style.visibility,'');assert.equal(q.controller.host.style.opacity,'');
      q.resolveCapture();await q.flush();assert.equal(q.controller.phase,'idle');assert.equal(q.alphaSum(),0);assert.equal(q.controller.engine.running,false);
    }finally{await q.close();}
  }
});
test('blur cancels running fragments; repeated explosions clean up and keep page state',async()=>{
  const q=await setup();try{
    await q.igniteToScatter();q.window.dispatchEvent(new q.window.Event('blur'));assert.equal(q.controller.phase,'idle');assert.equal(q.alphaSum(),0);
    for(let i=0;i<3;i++){await q.igniteToScatter();await q.advance(3850);assert.equal(q.controller.phase,'idle');assert.equal(q.alphaSum(),0);}
    assert.equal(q.captureCalls,4);assert.equal(q.frames.size,0);assert.equal(q.document.querySelector('#note').value,'未提交文字');
  }finally{await q.close();}
});
test('show, hide, settings, destroy and reinjection keep a single controller',async()=>{
  const q=await setup();try{
    await q.message({type:'TNT_SETTINGS',settings:{radius:9999,strength:0,fuseMs:NaN,sound:true}});
    let status=await q.message({type:'TNT_STATUS'});assert.equal(status.settings.radius,450);assert.equal(status.settings.strength,.5);assert.equal(status.settings.fuseMs,800);
    await q.message({type:'TNT_HIDE'});assert.equal(q.controller.host.style.display,'none');q.click();assert.equal(q.controller.phase,'idle');
    await q.message({type:'TNT_SHOW'});assert.equal(q.controller.host.style.display,'block');
    q.window.eval(fs.readFileSync(path.join(extension,'content.js'),'utf8'));assert.equal(q.document.querySelectorAll('#tnt-blast-root').length,1);
    await q.message({type:'TNT_DESTROY'});assert.equal(q.document.querySelector('#tnt-blast-root'),null);assert.equal(q.runtimeListeners.size,0);assert.equal(q.storageListeners.size,0);
    assert.equal(q.frames.size,0);assert.equal(q.timers.size,0);
  }finally{await q.close();}
});
test('stored custom background is reused across shots, then removal returns to the default hole',async()=>{
  const q=await setup({background:backgroundRecord()});try{
    await q.until(()=>q.backgroundBitmaps.length===1);await q.flush();
    const bitmap=q.backgroundBitmaps[0];
    for(let shot=0;shot<2;shot++){
      await q.igniteToScatter();assert.equal(q.controller.engine.options.backgroundImage,bitmap.image);
      assert.equal(q.controller.engine.options.craterRatio,.65);assert.equal(bitmap.closeCalls,0);
      await q.advance(3850);assert.equal(q.controller.phase,'idle');assert.equal(bitmap.closeCalls,0);
    }
    assert.equal(q.backgroundBitmaps.length,1,'an unchanged image should not be decoded for every shot');
    await q.updateBackground(null);await q.igniteToScatter();
    assert.ok(!q.controller.engine.options.backgroundImage);assert.equal(bitmap.closeCalls,1);
    q.window.dispatchEvent(new q.window.Event('resize'));assert.equal(q.controller.phase,'idle');assert.equal(q.alphaSum(),0);
  }finally{await q.close();}
});
test('clearing a background while it decodes discards the late image and cannot resurrect it',async()=>{
  const q=await setup({background:backgroundRecord(),backgroundDecode:'deferred'});try{
    await q.until(()=>q.backgroundWaiters.length===1);
    await q.updateBackground(null);await q.resolveBackground();await q.flush();
    assert.equal(q.backgroundBitmaps[0].closeCalls,1,'discarded decoded images must be released');
    await q.igniteToScatter();assert.ok(!q.controller.engine.options.backgroundImage);
    assert.equal(q.controller.phase,'scatter');assert.equal(q.backgroundBitmaps.length,1);
  }finally{await q.close();}
});
test('disabled hints stay hidden during targeting, fuse, capture, hold and restore',async()=>{
  const q=await setup({settings:{showHints:false}});try{
    const c=q.controller,position={x:c.x,y:c.y,left:c.button.style.left,top:c.button.style.top};
    const hidden=()=>assert.ok([...c.shadow.querySelectorAll('.hint')].every(element=>element.hidden),'all fixed and target hint spans must stay hidden');
    const title=c.button.title,label=c.button.getAttribute('aria-label');
    hidden();q.pointer('pointerdown',c.x,c.y);q.pointer('pointermove',440,330);assert.equal(c.targetPreview.hidden,false);hidden();
    q.captureMode='deferred';q.pointer('pointerup',440,330);assert.equal(c.phase,'fuse');hidden();
    await q.advance(800);await q.advance(16);await q.advance(16);assert.equal(c.phase,'capture');hidden();
    q.resolveCapture();await q.until(()=>c.phase!=='capture');assert.equal(c.phase,'scatter');hidden();
    await q.advance(1000);assert.equal(c.phase,'hold');hidden();await q.advance(2500);assert.equal(c.phase,'restore');hidden();
    await q.advance(350);assert.equal(c.phase,'idle');hidden();
    assert.deepEqual({x:c.x,y:c.y,left:c.button.style.left,top:c.button.style.top},position);
    assert.equal(c.button.title,title);assert.equal(c.button.getAttribute('aria-label'),label);
    await q.message({type:'TNT_SETTINGS',settings:{...c.settings,showHints:true}});
    assert.ok([...c.shadow.querySelectorAll('.hint')].every(element=>!element.hidden));
  }finally{await q.close();}
});
test('dock and panel hint controls persist and synchronize controllers without interrupting an explosion',async()=>{
  const sharedStorage={values:{},listeners:new Set()};
  const q=await setup({sharedStorage}),other=await setup({sharedStorage});try{
    const c=q.controller,button=c.shadow.querySelector('.dock [data-action="hints"]');
    const assertVisibility=(controller,shown)=>{
      assert.equal(controller.settings.showHints,shown);
      assert.ok([...controller.shadow.querySelectorAll('.hint')].every(element=>element.hidden===!shown));
      assert.equal(controller.shadow.querySelector('[data-setting="showHints"]').checked,shown);
    };
    assert.equal(button.title,'隐藏提示文字');assert.equal(button.getAttribute('aria-pressed'),'false');
    await q.igniteToScatter();const epoch=c.epoch,engineStarted=c.engine.startedAt,position={x:c.x,y:c.y};
    button.click();await q.flush();
    assert.equal(sharedStorage.values.tntSettings.showHints,false,'dock toggle must be saved immediately');
    assertVisibility(c,false);assertVisibility(other.controller,false);
    assert.equal(button.title,'显示提示文字');assert.equal(button.getAttribute('aria-pressed'),'true');
    assert.equal(c.phase,'scatter');assert.equal(c.epoch,epoch);assert.equal(c.engine.startedAt,engineStarted);assert.equal(c.engine.running,true);
    assert.deepEqual({x:c.x,y:c.y},position);
    const checkbox=other.controller.shadow.querySelector('[data-setting="showHints"]');checkbox.checked=true;
    checkbox.dispatchEvent(new other.window.Event('input',{bubbles:true}));await other.advance(150);await q.flush();
    assertVisibility(c,true);assertVisibility(other.controller,true);assert.equal(c.phase,'scatter');assert.equal(c.epoch,epoch);
    c.restore();await q.message({type:'TNT_SETTINGS',settings:{...c.settings,showHints:false}});
    // Persist externally as another popup/tab would, then reinstall on this page.
    await q.window.chrome.storage.local.set({tntSettings:{...c.settings,showHints:false}});
    c.destroy();q.window.eval(fs.readFileSync(path.join(extension,'content.js'),'utf8'));await q.flush();
    const reinstalled=q.window.__TNTController;assertVisibility(reinstalled,false);
    await q.window.chrome.storage.local.set({tntSettings:{...q.window.TNTSettings.defaults}});await q.flush();
    assertVisibility(reinstalled,true);assertVisibility(other.controller,true);
    reinstalled.destroy();
  }finally{await q.close();await other.close();}
});

test('sound remains opt-in and a muted complete shot never starts an audio cue',async()=>{
  const q=await setup();try{
    assert.equal(q.controller.settings.sound,false);
    await q.igniteToScatter();await q.advance(1000);await q.advance(2500);await q.advance(350);
    assert.equal(q.controller.phase,'idle');
    assert.deepEqual(q.audioCalls.filter(call=>call.type==='play'),[],'default settings must remain silent through every animation phase');
  }finally{await q.close();}
});

test('enabled sound follows the actual fuse, scatter and restore phases with custom timings',async()=>{
  for(const settings of [
    {sound:true},
    {sound:true,fuseMs:1700,scatterMs:1300,holdMs:900,restoreMs:700,strength:1.6},
  ]){
    const q=await setup({settings});try{
      const c=q.controller,fixed={x:c.x,y:c.y,left:c.button.style.left,top:c.button.style.top};
      const plays=()=>q.audioCalls.filter(call=>call.type==='play');
      assert.equal(q.audioPlayers.length,1);
      assert.equal(q.audioPlayers[0].options.resolveURL('fuse.wav'),'https://fixture.test/assets/audio/fuse.wav','bundled cues resolve through the extension runtime');
      assert.ok(q.audioCalls.some(call=>call.type==='prepare'),'enabling the setting prepares the local audio assets');
      q.pointer('pointerdown',c.x,c.y);q.pointer('pointermove',820,320);
      assert.equal(plays().length,0,'dragging alone never plays the ignition cue');
      q.pointer('pointerup',820,320);
      assert.deepEqual(plays().map(call=>[call.kind,call.phase]),[['fuse','fuse']]);
      assert.equal(plays()[0].options.fuseMs,c.settings.fuseMs);
      assert.equal(plays()[0].options.restoreMs,c.settings.restoreMs);
      assert.equal(plays()[0].options.strength,c.settings.strength);
      assert.ok(plays()[0].options.pan>0,'audio follows the actual right-side drop point');
      await q.advance(c.settings.fuseMs-1);assert.equal(c.phase,'fuse');assert.equal(plays().length,1);
      await q.advance(1);await q.advance(16);await q.advance(16);await q.until(()=>c.phase==='scatter');
      assert.deepEqual(plays().map(call=>[call.kind,call.phase]),[['fuse','fuse'],['explosion','scatter']]);
      assert.deepEqual({x:c.engine.options.center.x,y:c.engine.options.center.y},{x:820,y:320},'the sound source and visual blast retain the drop coordinates');
      const started=c.engine.startedAt;
      await q.advance(c.settings.scatterMs);assert.equal(c.phase,'hold');assert.equal(plays().length,2,'the lingering destruction has no extra cue');
      await q.advance(c.settings.holdMs-1);assert.equal(c.phase,'hold');assert.equal(plays().length,2,'restore audio cannot use a fixed elapsed-second timer');
      await q.advance(1);assert.equal(c.phase,'restore');
      assert.deepEqual(plays().map(call=>[call.kind,call.phase]),[['fuse','fuse'],['explosion','scatter'],['restore','restore']]);
      assert.equal(plays()[2].time,started+c.settings.scatterMs+c.settings.holdMs);
      await q.advance(50);assert.equal(c.phase,'restore');assert.equal(plays().length,3,'subsequent restore frames do not restart its cue');
      const stopped=q.audioCalls.filter(call=>call.type==='stopAll').length;
      await q.advance(c.settings.restoreMs-50);assert.equal(c.phase,'idle');
      assert.ok(q.audioCalls.filter(call=>call.type==='stopAll').length>stopped,'natural completion stops all remaining audio');
      assert.deepEqual({x:c.x,y:c.y,left:c.button.style.left,top:c.button.style.top},fixed,'audio integration preserves the fixed TNT position');
    }finally{await q.close();}
  }
});

test('delayed capture and decoding cannot play the explosion before the first scatter frame',async()=>{
  const q=await setup({settings:{sound:true},captureDecode:'deferred'});try{
    const c=q.controller,plays=()=>q.audioCalls.filter(call=>call.type==='play');
    q.captureMode='deferred';q.click();await q.advance(800);await q.advance(16);await q.advance(16);
    assert.equal(c.phase,'capture');assert.deepEqual(plays().map(call=>call.kind),['fuse']);
    await q.advance(1100);assert.equal(c.phase,'capture');assert.equal(plays().length,1,'a slow capture does not trigger a wall-clock explosion');
    q.resolveCapture();await q.until(()=>q.captureDecodeWaiters.length===1);
    await q.advance(1300);assert.equal(c.phase,'capture');assert.equal(plays().length,1,'a slow decoder does not play the explosion early');
    await q.resolveCaptureDecode();await q.until(()=>c.phase==='scatter');
    assert.deepEqual(plays().map(call=>[call.kind,call.phase]),[['fuse','fuse'],['explosion','scatter']]);
    c.restore();assert.equal(c.phase,'idle');assert.ok(q.audioCalls.at(-1).type==='stopAll');
  }finally{await q.close();}
});

test('turning sound off stops immediately and suppresses later cues without stopping the visual shot',async()=>{
  for(const phase of ['fuse','scatter','restore']){
    const q=await setup({settings:{sound:true}});try{
      const c=q.controller;q.click();
      if(phase!=='fuse')await q.finishFuse();
      if(phase==='restore'){await q.advance(1000);await q.advance(2500);}
      assert.equal(c.phase,phase);
      const played=q.audioCalls.filter(call=>call.type==='play').length;
      await q.message({type:'TNT_SETTINGS',settings:{...c.settings,sound:false}});
      assert.equal(c.phase,phase,'changing audio preference does not cancel the visual effect');
      assert.equal(q.audioCalls.at(-1).type,'stopAll','the audio switch must stop the current sound immediately');
      if(phase==='fuse')await q.finishFuse();
      await q.advance(5000);assert.equal(c.phase,'idle');
      assert.equal(q.audioCalls.filter(call=>call.type==='play').length,played,'a snapshot of the original settings cannot revive later audio');
    }finally{await q.close();}
  }
});

test('cancel, hide and destroy stop current audio and discard later pending capture work',async()=>{
  for(const action of ['cancel','hide','destroy']){
    const q=await setup({settings:{sound:true},captureDecode:'deferred'});try{
      const c=q.controller;q.click();await q.advance(800);await q.advance(16);await q.advance(16);
      await q.until(()=>q.captureDecodeWaiters.length===1);assert.equal(c.phase,'capture');
      const played=q.audioCalls.filter(call=>call.type==='play').length;
      const stopped=q.audioCalls.filter(call=>call.type==='stopAll').length;
      if(action==='cancel')q.document.dispatchEvent(new q.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      else if(action==='hide')c.hide();
      else c.destroy();
      assert.ok(q.audioCalls.filter(call=>call.type==='stopAll').length>stopped,`${action} stops audio synchronously`);
      if(action==='destroy')assert.equal(q.audioCalls.at(-1).type,'close','destroy releases the audio player');
      await q.resolveCaptureDecode();await q.until(()=>q.bitmapClosed===1);await q.advance(5000);
      assert.equal(c.phase,'idle');assert.equal(c.engine.running,false);
      assert.equal(q.audioCalls.filter(call=>call.type==='play').length,played,'a cancelled decode cannot start explosion or restore audio');
    }finally{await q.close();}
  }
});
