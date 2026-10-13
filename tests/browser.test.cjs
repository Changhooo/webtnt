/* Optional real-browser QA. Not part of node --test tests/*.test.cjs.
 * Run: node tests/browser.test.cjs
 * Optional test-profile capture permission (temporary manifest): TNT_QA_FIXTURE_PERMISSION=1
 * This never edits the shipping extension manifest. Original activeTab activation
 * still requires a real toolbar gesture if this Chrome cannot open action popups.
 */
'use strict';
const fs=require('node:fs'), path=require('node:path'), os=require('node:os');
const http=require('node:http'), assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'), output=path.join(__dirname,'output');
fs.mkdirSync(output,{recursive:true});
function dependency(name){
  try{return require(name);}catch(error){
    for(const base of (process.env.TNT_QA_DEPENDENCIES||'').split(path.delimiter).filter(Boolean)){
      try{return require(require.resolve(name,{paths:[base,path.dirname(base)]}));}catch{}
    }
    throw error;
  }
}
const report={kind:'real-browser',startedAt:new Date().toISOString(),fixturePermission:process.env.TNT_QA_FIXTURE_PERMISSION==='1',results:[],errors:[]};
let context,server,temporary;
async function check(name,fn){
  const started=Date.now();
  try{await fn();report.results.push({name,status:'passed',ms:Date.now()-started});console.log(`PASS ${name}`);}
  catch(error){report.results.push({name,status:'failed',error:error.message});console.error(`FAIL ${name}: ${error.message}`);}
}
const html=`<!doctype html><meta charset="utf-8"><title>TNT QA fixture</title><style>
html{background:#faf4e0}body{margin:0;font-family:sans-serif;min-height:2100px;color:#20202a}.card{position:absolute;left:100px;top:80px;width:680px;height:320px;background:linear-gradient(90deg,#446bb4 50%,#f5c544 50%);border-radius:16px;padding:30px;box-sizing:border-box}h1{font-size:38px}textarea{position:absolute;left:90px;top:450px;width:350px;height:70px}#counter{position:absolute;left:500px;top:470px;width:150px;height:44px}output{position:absolute;left:675px;top:480px}img{position:absolute;left:700px;top:450px;width:120px;height:90px}iframe{position:absolute;left:100px;top:850px;width:480px;height:180px}</style>
<div class="card"><h1>PAGE CONTENT 123</h1><p>Nearby text, image and button shards.</p></div><textarea id="note">未提交文字</textarea><button id="counter">增加</button><output id="count">0</output><img alt="图片" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='90'%3E%3Crect width='120' height='90' fill='%23278b73'/%3E%3Ccircle cx='60' cy='45' r='28' fill='%23f5c544'/%3E%3C/svg%3E"><iframe src="/embedded"></iframe>
<script>let n=0;document.querySelector('#counter').onclick=()=>document.querySelector('#count').textContent=++n;window.liveTicks=0;setInterval(()=>window.liveTicks++,20)</script>`;

(async()=>{
  const {chromium}=dependency('playwright');
  temporary=fs.mkdtempSync(path.join(os.tmpdir(),'tnt-browser-qa-'));
  let extension=path.join(root,'extension');
  if(report.fixturePermission){
    const copy=path.join(temporary,'extension');fs.cpSync(extension,copy,{recursive:true});
    const manifest=JSON.parse(fs.readFileSync(path.join(copy,'manifest.json'),'utf8'));
    // Chrome captureVisibleTab accepts activeTab or <all_urls>, rather than a
    // single fixture origin. This explicit opt-in grants only this throwaway
    // profile permission; all loaded pages belong to this local test server.
    manifest.host_permissions=['<all_urls>'];fs.writeFileSync(path.join(copy,'manifest.json'),JSON.stringify(manifest,null,2));extension=copy;
  }
  const executable=process.env.TNT_BROWSER_EXECUTABLE||chromium.executablePath();
  report.executable=executable;
  try{
    context=await chromium.launchPersistentContext(path.join(temporary,'profile'),{
      executablePath:executable,headless:process.env.TNT_BROWSER_HEADED!=='1',viewport:{width:1000,height:700},
      ignoreDefaultArgs:['--disable-extensions'],args:['--no-sandbox',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]
    });
  }catch(error){
    const systemReason=error.message.match(/socket\(\) failed:[^\n]*/)?.[0];
    report.status='blocked';report.blocker=`Browser launch unavailable: ${systemReason||error.message.split('\n')[0]}`;throw error;
  }
  report.browserVersion=context.browser()?.version();
  server=http.createServer((request,response)=>{
    response.setHeader('Content-Type','text/html; charset=utf-8');response.end(request.url==='/embedded'?'<p>Embedded live page</p>':html);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const fixtureURL=`http://127.0.0.1:${server.address().port}/`;
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:10000});
  const extensionId=new URL(worker.url()).host;
  const page=context.pages()[0]||await context.newPage();
  page.on('pageerror',error=>report.errors.push(error.message));
  await page.goto(fixtureURL);await page.bringToFront();
  const tabId=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(tab=>tab.url===url).id,fixtureURL);
  const send=message=>worker.evaluate(({id,message})=>chrome.tabs.sendMessage(id,message),{id:tabId,message});
  let popup;
  if(report.fixturePermission){
    await worker.evaluate(id=>chrome.scripting.executeScript({target:{tabId:id},files:['settings.js','background-image.js','engine.js','audio.js','content.js']}),tabId);
    popup=await context.newPage();await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  }else{
    try{
      await worker.evaluate(()=>chrome.action.openPopup());
      popup=context.pages().find(candidate=>candidate.url().endsWith('/popup.html'));
      if(!popup)popup=await context.waitForEvent('page',{predicate:candidate=>candidate.url().includes(extensionId),timeout:5000});
      await popup.waitForLoadState();await popup.locator('#showButton').click();
      await page.waitForSelector('#tnt-blast-root',{timeout:5000});
    }catch(error){report.status='blocked';report.blocker='This browser cannot grant activeTab through an automated action popup. Verify activation with a real toolbar gesture, or use TNT_QA_FIXTURE_PERMISSION=1 for rendering QA in a separate temporary test profile.';throw error;}
  }
  // Persist settings through the actual extension UI. The popup tab need not
  // remain the selected tab while its already-bound target is being operated.
  await check('popup range edits persist through chrome.storage',async()=>{
    await popup.locator('#radius').evaluate(input=>{input.value=280;input.dispatchEvent(new Event('input',{bubbles:true}));});
    await popup.waitForTimeout(220);
    assert.equal(await worker.evaluate(async()=>(await chrome.storage.local.get('tntSettings')).tntSettings.radius),280);
    await popup.locator('#resetButton').click();
    await popup.waitForTimeout(200);
  });
  await page.bringToFront();await send({type:'TNT_SHOW'});
  // The production shadow root is closed. Inspect only the extension's own
  // isolated world, then dispatch genuine browser mouse input at its bounds.
  const inspectUI=(kind,selector)=>worker.evaluate(async({id,kind,selector})=>{
    const [{result}]=await chrome.scripting.executeScript({target:{tabId:id},args:[kind,selector],func:(kind,selector)=>{
      const controller=window.__TNTController;
      if(kind==='center'){const center=controller?.engine.options?.center;return center?{x:center.x,y:center.y}:null;}
      if(kind==='fixed')return {x:controller.x,y:controller.y,left:controller.button.style.left,top:controller.button.style.top};
      if(kind==='hints')return {showHints:controller.settings.showHints,hidden:[...controller.shadow.querySelectorAll('.hint')].every(element=>element.hidden),title:controller.button.title,label:controller.button.getAttribute('aria-label')};
      if(kind==='preview-border')return getComputedStyle(controller.targetPreview,'::before').borderStyle;
      const element=controller?.shadow.querySelector(selector);
      if(!element)return null;
      if(kind==='visible')return !element.hidden&&getComputedStyle(element).display!=='none'&&getComputedStyle(element).visibility!=='hidden';
      const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};
    }});return result;
  },{id:tabId,kind,selector});
  const clickUI=async(selector,button='left')=>{const box=await inspectUI('rect',selector);assert.ok(box,`missing ${selector}`);await page.mouse.click(box.x+box.width/2,box.y+box.height/2,{button});};
  const waitUI=async selector=>{const start=Date.now();while(Date.now()-start<4000){if(await inspectUI('visible',selector))return;await page.waitForTimeout(40);}throw new Error(`${selector} remained hidden`);};
  const tnt={boundingBox:()=>inspectUI('rect','.tnt'),click:options=>clickUI('.tnt',options?.button),waitFor:()=>waitUI('.tnt')};
  const phase=()=>page.locator('#tnt-blast-root').getAttribute('data-phase');
  const idle=()=>page.waitForFunction(()=>document.querySelector('#tnt-blast-root')?.dataset.phase==='idle',null,{timeout:9000});
  const ignite=async()=>{await page.bringToFront();await tnt.click();await page.waitForFunction(()=>document.querySelector('#tnt-blast-root')?.dataset.phase==='scatter',null,{timeout:3000});};
  await check('page scripts cannot access the screenshot shadow canvas',async()=>{
    assert.equal(await page.evaluate(()=>document.querySelector('#tnt-blast-root').shadowRoot),null);
    assert.equal(await page.evaluate(()=>typeof window.__TNTController),'undefined');
  });
  await check('right dragging moves TNT without igniting or leaving its menu open',async()=>{
    const box=await tnt.boundingBox();await page.mouse.move(box.x+39,box.y+42);await page.mouse.down({button:'right'});await page.mouse.move(400,340,{steps:12});await page.mouse.up({button:'right'});
    assert.equal(await phase(),'idle');const moved=await tnt.boundingBox();assert.ok(Math.abs(moved.x+39-400)<2);assert.ok(Math.abs(moved.y+42-340)<2);
    assert.equal(await inspectUI('visible','.dock'),false);
  });
  await check('canvas layer allows click-through and ordinary text input',async()=>{
    await page.locator('#note').fill('保留输入 / KEEP');await page.locator('#counter').click();assert.equal(await page.locator('#count').textContent(),'1');
    assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('#tnt-blast-root')).pointerEvents),'none');
  });
  await worker.evaluate(()=>{
    const native=chrome.tabs.captureVisibleTab.bind(chrome.tabs);globalThis.qaCaptureCount=0;
    chrome.tabs.captureVisibleTab=async(...args)=>{const data=await native(...args);globalThis.qaLastCapture=data;globalThis.qaCaptureCount++;return data;};
  });
  await page.evaluate(()=>{
    window.qaPhases=[];const host=document.querySelector('#tnt-blast-root');
    window.qaObserver=new MutationObserver(()=>{const value=host.dataset.phase;if(window.qaPhases.at(-1)!==value)window.qaPhases.push(value);});
    window.qaObserver.observe(host,{attributes:true,attributeFilter:['data-phase']});
  });
  await check('real screenshot enters scatter, hold, restore and idle',async()=>{
    const before=await page.evaluate(()=>window.liveTicks);await ignite();
    assert.equal(await page.locator('#tnt-blast-root').getAttribute('data-capture'),'ready');
    await page.screenshot({path:path.join(output,'scatter.png')});
    await page.waitForFunction(()=>document.querySelector('#tnt-blast-root')?.dataset.phase==='hold',null,{timeout:3000});
    await page.screenshot({path:path.join(output,'hold.png')});await idle();
    const phases=await page.evaluate(()=>window.qaPhases);for(const expected of ['fuse','capture','scatter','hold','restore','idle'])assert.ok(phases.includes(expected),`missing phase ${expected}`);
    assert.equal(await page.locator('#note').inputValue(),'保留输入 / KEEP');assert.equal(await page.locator('#count').textContent(),'1');assert.ok(await page.evaluate(()=>window.liveTicks)>before);
    assert.equal(await worker.evaluate(()=>globalThis.qaCaptureCount),1);
    const capture=await worker.evaluate(()=>globalThis.qaLastCapture);assert.ok(capture.startsWith('data:image/png;base64,'));
    const {PNG}=dependency('pngjs'),png=PNG.sync.read(Buffer.from(capture.split(',')[1],'base64'));
    const i=(Math.round(340*png.height/700)*png.width+Math.round(400*png.width/1000))*4;
    // TNT occupied this center before capture. Its red icon must be absent from
    // the captured source, which should now contain the underlying blue card.
    assert.deepEqual([...png.data.subarray(i,i+3)],[68,107,180]);
  });
  await check('Escape immediately restores the transparent overlay',async()=>{
    await ignite();await page.keyboard.press('Escape');await idle();assert.equal(await page.locator('#tnt-blast-root').getAttribute('data-capture'),'none');
  });
  await check('left drop uses the edge mouse point and keeps the fixed icon in place through recovery',async()=>{
    const fixed=await inspectUI('fixed','');
    const box=await tnt.boundingBox();await page.mouse.move(box.x+55,box.y+57);await page.mouse.down();await page.mouse.move(2,3,{steps:14});
    assert.equal(await phase(),'idle');assert.deepEqual(await inspectUI('fixed',''),fixed);
    assert.equal(await inspectUI('visible','.target-preview'),true);
    await page.mouse.up();assert.equal(await phase(),'fuse');assert.deepEqual(await inspectUI('fixed',''),fixed);
    await page.waitForFunction(()=>document.querySelector('#tnt-blast-root')?.dataset.phase==='scatter',null,{timeout:3000});
    assert.deepEqual(await inspectUI('center',''),{x:2,y:3});assert.deepEqual(await inspectUI('fixed',''),fixed);
    assert.equal(await inspectUI('visible','.target-preview'),false);
    await page.waitForFunction(()=>document.querySelector('#tnt-blast-root')?.dataset.phase==='hold',null,{timeout:3000});assert.deepEqual(await inspectUI('fixed',''),fixed);
    await page.waitForFunction(()=>document.querySelector('#tnt-blast-root')?.dataset.phase==='restore',null,{timeout:4000});assert.deepEqual(await inspectUI('fixed',''),fixed);
    await idle();assert.deepEqual(await inspectUI('fixed',''),fixed);
  });
  await check('Escape cancels a left drag without relocating the fixed TNT',async()=>{
    const fixed=await inspectUI('fixed',''),box=await tnt.boundingBox();
    await page.mouse.move(box.x+39,box.y+42);await page.mouse.down();await page.mouse.move(620,440,{steps:10});
    await page.keyboard.press('Escape');await page.mouse.up();assert.equal(await phase(),'idle');assert.deepEqual(await inspectUI('fixed',''),fixed);
    assert.equal(await inspectUI('visible','.target-preview'),false);
  });
  await check('hint text can stay hidden through targeting and explosion without a dashed target box',async()=>{
    const fixed=await inspectUI('fixed',''),enabled=await inspectUI('hints','');
    await tnt.click({button:'right'});await clickUI('.dock [data-action=hints]');
    assert.equal((await inspectUI('hints','')).hidden,true);
    assert.equal(await worker.evaluate(async()=>(await chrome.storage.local.get('tntSettings')).tntSettings.showHints),false);
    assert.notEqual(await inspectUI('preview-border',''),'dashed');
    const box=await tnt.boundingBox();await page.mouse.move(box.x+39,box.y+42);await page.mouse.down();await page.mouse.move(620,430,{steps:10});
    assert.equal((await inspectUI('hints','')).hidden,true);await page.mouse.up();assert.equal(await phase(),'fuse');assert.equal((await inspectUI('hints','')).hidden,true);
    await page.waitForFunction(()=>document.querySelector('#tnt-blast-root')?.dataset.phase==='hold',null,{timeout:4000});assert.equal((await inspectUI('hints','')).hidden,true);
    await idle();assert.equal((await inspectUI('hints','')).hidden,true);assert.deepEqual(await inspectUI('fixed',''),fixed);
    const after=await inspectUI('hints','');assert.equal(after.title,enabled.title);assert.equal(after.label,enabled.label);
    await tnt.click({button:'right'});await clickUI('.dock [data-action=hints]');assert.equal((await inspectUI('hints','')).showHints,true);
  });
  await check('resize and scroll during explosion cancel and preserve latest page',async()=>{
    await ignite();await page.setViewportSize({width:980,height:680});await idle();await page.setViewportSize({width:1000,height:700});
    await ignite();await page.evaluate(()=>scrollTo(0,260));await idle();assert.equal(await page.evaluate(()=>scrollY),260);assert.equal(await page.locator('#note').inputValue(),'保留输入 / KEEP');await page.evaluate(()=>scrollTo(0,0));
  });
  await check('switching tabs cancels before capture; no wrong tab screenshot',async()=>{
    const other=await context.newPage();await other.goto(`${fixtureURL}other`);await page.bringToFront();
    const count=await worker.evaluate(()=>globalThis.qaCaptureCount);await tnt.click();await other.bringToFront();await page.waitForTimeout(1100);await page.bringToFront();await idle();
    assert.equal(await worker.evaluate(()=>globalThis.qaCaptureCount),count);await other.close();
  });
  await check('three repeated explosions return to idle without residual nodes',async()=>{
    for(let i=0;i<3;i++){await ignite();await idle();assert.equal(await page.locator('#tnt-blast-root').getAttribute('data-capture'),'none');}
    assert.equal(await page.locator('#tnt-blast-root').count(),1);
  });
  await check('right-click menu, panel, hide, show and close',async()=>{
    await tnt.click({button:'right'});await clickUI('.dock [data-action=settings]');await waitUI('.panel');
    await page.keyboard.press('Escape');await tnt.click({button:'right'});await clickUI('.dock [data-action=hide]');assert.equal((await send({type:'TNT_STATUS'})).shown,false);
    await send({type:'TNT_SHOW'});await tnt.waitFor({state:'visible'});await send({type:'TNT_DESTROY'});assert.equal(await page.locator('#tnt-blast-root').count(),0);
  });
  report.status=report.results.some(result=>result.status==='failed')?'failed':'passed';
})().catch(error=>{
  if(!report.status)report.status='failed';report.error=error.message.split('\n').slice(0,4).join('\n');console.error(`${report.status.toUpperCase()}: ${report.blocker||report.error}`);
}).finally(async()=>{
  try{await context?.close();}catch{}if(server)await new Promise(resolve=>server.close(resolve));
  if(temporary)fs.rmSync(temporary,{recursive:true,force:true});report.finishedAt=new Date().toISOString();
  fs.writeFileSync(path.join(output,'browser-results.json'),JSON.stringify(report,null,2));process.exitCode=report.status==='passed'?0:report.status==='blocked'?2:1;
});
