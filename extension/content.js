(() => {
  'use strict';
  if (window.__TNTController) return;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const TWO_FRAMES = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const CSS = `
    :host{all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;display:block!important;color-scheme:dark!important}
    *{box-sizing:border-box}button,input{font:inherit}button{cursor:pointer}button:focus-visible,input:focus-visible{outline:2px solid #ffcc70;outline-offset:3px}
    .scene{position:absolute;inset:0;pointer-events:none;overflow:hidden;font:12px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;color:#f3ece7}
    canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
    .tnt{position:absolute;display:block;width:78px;height:84px;border:0;background:none;padding:0;pointer-events:auto;touch-action:none;user-select:none;cursor:grab;filter:drop-shadow(0 9px 8px #0005);transition:filter .18s;will-change:left,top}
    .tnt:hover{filter:drop-shadow(0 11px 10px #0007) brightness(1.08)}.tnt:active{cursor:grabbing}.tnt img{width:100%;height:100%;pointer-events:none;image-rendering:pixelated}.tnt.fuse img{animation:fuse .16s steps(2) infinite}.tnt.fuse{animation:puff .8s linear both;cursor:wait}
    .tnt.busy{cursor:wait}.tnt.busy:not(.fuse)>img{opacity:.62}
    .target-preview{position:absolute;width:78px;height:84px;pointer-events:none;opacity:.72;filter:drop-shadow(0 7px 6px #0006)}.target-preview[hidden]{display:none!important}.target-preview>img{width:100%;height:100%;image-rendering:pixelated}.target-preview.fuse{opacity:1;animation:puff .8s linear both}.target-preview.fuse>img{animation:fuse .16s steps(2) infinite}
    @keyframes fuse{50%{filter:brightness(2.9) saturate(.25)}}@keyframes puff{to{transform:scale(1.16)}}
    .ember{position:absolute;width:5px;height:5px;background:#fff3ac;left:52%;top:2px;box-shadow:0 0 12px #ff9d31;animation:ember .18s alternate infinite}.ember[hidden]{display:none}@keyframes ember{to{transform:translate(4px,-7px);opacity:.35}}
    .hint{position:absolute;bottom:-20px;left:50%;transform:translateX(-50%);white-space:nowrap;color:#fff;background:#18171ddd;padding:3px 8px;border:1px solid #ffffff24;border-radius:6px;font-size:10px;pointer-events:none}
    .hint[hidden]{display:none!important}
    .dock{position:absolute;display:flex;gap:2px;padding:4px;border:1px solid #ffffff24;background:#17151deb;border-radius:10px;box-shadow:0 6px 20px #0003;pointer-events:auto}
    .dock[hidden],.panel[hidden],.toast[hidden]{display:none!important}.dock button{border:0;background:none;border-radius:6px;color:#f5ece7;font-size:12px;width:29px;height:27px;padding:0}.dock button:hover{background:#ffffff1b}.dock button.danger:hover{background:#c94c4538;color:#ffb8b4}
    .panel{position:absolute;width:284px;max-height:calc(100vh - 16px);overflow:auto;pointer-events:auto;background:#1e1b24f7;border:1px solid #ffffff24;border-radius:14px;padding:16px;box-shadow:0 20px 60px #0005;backdrop-filter:blur(12px)}.panel header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;font-size:14px;font-weight:700}.panel header button{color:#ccc;background:transparent;border:0;font-size:18px}.panel label{display:block;margin-top:10px;color:#e0d8d5}.panel .row{display:flex;justify-content:space-between;align-items:center}.panel output{color:#ffc486;font-variant-numeric:tabular-nums}.panel input[type=range]{display:block;width:100%;margin:8px 0;accent-color:#ec7658;cursor:pointer}.panel input[type=checkbox]{accent-color:#ec7658}.panel small{display:block;margin-top:12px;color:#aaa1a9;font-size:10px}
    .toast{position:absolute;left:50%;bottom:24px;transform:translateX(-50%);background:#17151deb;border:1px solid #ffffff24;border-radius:10px;padding:10px 16px;color:#f5ece7;max-width:min(480px,90vw);text-align:center;pointer-events:none;box-shadow:0 8px 30px #0004}
  `;

  class TNTController {
    constructor() {
      this.settings = {...TNTSettings.defaults};
      this.phase = 'idle'; this.shown = true; this.destroyed = false; this.epoch = 0;
      this.x = Math.max(50, innerWidth - 96); this.y = Math.max(55, Math.min(innerHeight - 110, 160));
      this.events = new AbortController();
      this.soundPlayer = new TNTAudio.Player({resolveURL: filename => chrome.runtime.getURL('assets/audio/'+filename)});
      this.backgroundAsset=null; this.backgroundBitmap=null; this.backgroundEpoch=0; this.backgroundReady=Promise.resolve();
      this.suppressContextMenuUntil=0;
      this.host = document.createElement('div');
      this.host.id = 'tnt-blast-root';
      this.host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;display:block!important';
      // Screenshot pixels may contain cross-origin frames: keep the render surface
      // inaccessible to the host page while the isolated extension world owns it.
      this.shadow = this.host.attachShadow({mode:'closed'});
      this.shadow.innerHTML = `<style>${CSS}</style><div class="scene"><canvas aria-hidden="true"></canvas><button class="tnt" title="右键拖动移动 · 左键拖动选择爆点，图标保持原位 · 单独右击菜单" aria-label="TNT：右键拖动移动，左键拖动松开引爆，原图标位置不变"><img alt="" draggable="false"><span class="ember" hidden></span><span class="hint">右键移动 · 左键选择爆点</span></button><div class="target-preview" aria-hidden="true" hidden><img alt="" draggable="false"><span class="ember" hidden></span><span class="hint">松开在此引爆</span></div><nav class="dock" aria-label="TNT 工具" hidden><button data-action="restore" title="立即还原（Esc）" aria-label="立即还原">↶</button><button data-action="settings" title="设置" aria-label="设置">⚙</button><button data-action="hints" title="隐藏提示文字" aria-label="隐藏提示文字" aria-pressed="false">文</button><button data-action="hide" title="隐藏 TNT" aria-label="隐藏 TNT">−</button><button data-action="close" class="danger" title="关闭工具" aria-label="关闭工具">×</button></nav><section class="panel" aria-label="爆炸设置" hidden><header>爆炸设置<button data-action="settings" aria-label="关闭设置">×</button></header><div class="controls"></div><label class="row"><span>点燃、爆炸与回吸音效</span><input type="checkbox" data-setting="sound"></label><label class="row"><span>显示 TNT 下方提示文字</span><input type="checkbox" data-setting="showHints"></label><small>点击工具栏 TNT 图标选择自定义背景图片<br>按 Esc 立即还原</small></section><div class="toast" role="status" hidden></div></div>`;
      this.button = this.shadow.querySelector('.tnt'); this.canvas = this.shadow.querySelector('canvas');
      this.dock = this.shadow.querySelector('.dock'); this.panel = this.shadow.querySelector('.panel');
      this.targetPreview=this.shadow.querySelector('.target-preview');
      this.button.querySelector('img').src = chrome.runtime.getURL('assets/tnt.svg');
      this.targetPreview.querySelector('img').src = chrome.runtime.getURL('assets/tnt.svg');
      document.documentElement.appendChild(this.host);
      this.engine = new TNTBlast.BlastEngine(this.canvas);
      this.createSettings(); this.setPhase('idle'); this.position(); this.bind();
      chrome.storage.local.get(['tntSettings','tntBackground']).then(({tntSettings,tntBackground}) => {
        if (!this.destroyed) { this.settings = TNTSettings.sanitize(tntSettings); this.syncSettings(); this.setBackground(tntBackground); }
      }).catch(() => this.syncSettings());
    }
    setPhase(phase) {
      const previous=this.phase;
      this.phase = phase; this.host.dataset.phase = phase;
      const remote=this.detonationCenter && Math.hypot(this.detonationCenter.x-this.x,this.detonationCenter.y-this.y)>8;
      const preparing=phase==='fuse' || phase==='capture';
      this.button.classList.toggle('fuse', preparing && !remote);
      this.button.classList.toggle('busy',phase!=='idle');
      this.button.querySelector('.ember').hidden = !preparing || remote;
      this.button.querySelector('.hint').textContent = ({idle:'右键移动 · 左键选择爆点',fuse:'引线燃烧中',capture:'准备画面…',scatter:'爆炸',blast:'爆炸',hold:'短暂停留',restore:'快速复原'})[phase] || '左键选择爆点';
      this.button.style.visibility = this.shown ? 'visible' : 'hidden';
      if (preparing && remote) {
        this.showTarget(this.detonationCenter);this.targetPreview.classList.add('fuse');
        this.targetPreview.querySelector('.ember').hidden=false;
        this.targetPreview.querySelector('.hint').textContent=phase==='fuse'?'引线燃烧中':'准备画面…';
      } else if (phase!=='idle' || !this.drag) this.clearTarget();
      if (phase!==previous) {
        const cue=({fuse:'fuse',scatter:'explosion',restore:'restore'})[phase];
        if(cue) this.startSound(cue,this.runSettings || this.settings);
      }
    }
    showTarget(center) {
      this.targetPreview.style.left=`${center.x-39}px`;this.targetPreview.style.top=`${center.y-42}px`;
      this.targetPreview.hidden=false;
    }
    clearTarget() {
      this.targetPreview.hidden=true;this.targetPreview.classList.remove('fuse');
      this.targetPreview.querySelector('.ember').hidden=true;
      this.targetPreview.querySelector('.hint').textContent='松开在此引爆';
    }
    position(allowEdge=false) {
      this.x = allowEdge ? clamp(this.x,0,innerWidth) : clamp(this.x,40,Math.max(40,innerWidth-40));
      this.y = allowEdge ? clamp(this.y,0,innerHeight) : clamp(this.y,44,Math.max(44,innerHeight-44));
      this.button.style.left = `${this.x - 39}px`; this.button.style.top = `${this.y - 42}px`;
      const dockY = this.y + 64 + 35 < innerHeight ? this.y + 64 : this.y - 92;
      const dockWidth=this.dock.getBoundingClientRect().width || 163;
      this.dock.style.left = `${clamp(this.x - dockWidth/2, 4, Math.max(4,innerWidth - dockWidth - 4))}px`; this.dock.style.top = `${Math.max(4,dockY)}px`;
      this.panel.style.left = `${clamp(this.x - 142, 8, Math.max(8,innerWidth - 292))}px`;
      const panelHeight=this.panel.getBoundingClientRect().height || Math.min(535,innerHeight-16);
      this.panel.style.top = `${clamp(this.y + 90,8,Math.max(8,innerHeight-panelHeight-8))}px`;
    }
    bind() {
      const signal = this.events.signal;
      this.button.addEventListener('pointerdown', e => {
        if (![0,2].includes(e.button) || this.phase !== 'idle' || this.drag) return;
        e.preventDefault(); e.stopPropagation();
        this.drag = {id:e.pointerId,button:e.button,startX:e.clientX,startY:e.clientY,x:this.x,y:this.y,moved:false};
        this.button.setPointerCapture(e.pointerId); this.dock.hidden = true; this.panel.hidden = true;
      }, {signal});
      this.button.addEventListener('pointermove', e => {
        if (!this.drag || e.pointerId !== this.drag.id) return;
        const dx = e.clientX - this.drag.startX, dy = e.clientY - this.drag.startY;
        if (Math.hypot(dx,dy) > 6) this.drag.moved = true;
        if (this.drag.moved) {
          if (this.drag.button===2) {this.x=this.drag.x+dx;this.y=this.drag.y+dy;this.position();}
          else {this.drag.preview={x:clamp(e.clientX,0,innerWidth),y:clamp(e.clientY,0,innerHeight)};this.showTarget(this.drag.preview);}
        }
      }, {signal});
      this.button.addEventListener('pointerup', e => {
        if (!this.drag || e.pointerId !== this.drag.id) return;
        e.preventDefault(); e.stopPropagation();
        const {moved,button}=this.drag; this.drag = null;this.clearTarget();
        if (this.button.hasPointerCapture(e.pointerId)) this.button.releasePointerCapture(e.pointerId);
        if (e.button!==button) return;
        if (button===0) {
          this.ignite({x:clamp(e.clientX,0,innerWidth),y:clamp(e.clientY,0,innerHeight)});
        } else {
          this.suppressContextMenuUntil=performance.now()+1200;
          if (!moved) {this.dock.hidden=!this.dock.hidden;this.position();}
        }
      }, {signal});
      const cancelDrag=e=>{if(this.drag && e.pointerId===this.drag.id) {this.drag=null;this.clearTarget();}};
      this.button.addEventListener('pointercancel',cancelDrag,{signal});
      this.button.addEventListener('lostpointercapture',cancelDrag,{signal});
      this.button.addEventListener('click', e => {e.preventDefault();e.stopPropagation();if (e.detail === 0 && this.phase === 'idle') this.ignite();}, {signal});
      this.button.addEventListener('contextmenu', e => {
        e.preventDefault();e.stopPropagation();
        if(this.drag || performance.now()<this.suppressContextMenuUntil) return;
        this.dock.hidden=!this.dock.hidden;this.position();
      }, {signal});
      this.shadow.addEventListener('click', e => {
        const action = e.target.closest?.('[data-action]')?.dataset.action;
        if (!action) return;
        e.preventDefault(); e.stopPropagation();
        if (action === 'restore') this.restore();
        if (action === 'hide') this.hide();
        if (action === 'close') this.destroy();
        if (action === 'hints') {
          this.settings=TNTSettings.sanitize({...this.settings,showHints:!this.settings.showHints});
          this.syncSettings();clearTimeout(this.saveTimer);
          void chrome.storage.local.set({tntSettings:{...this.settings}}).catch(()=>this.toast('提示文字设置保存失败，请重试。'));
        }
        if (action === 'settings') {this.panel.hidden=!this.panel.hidden;this.position();}
      }, {signal});
      this.shadow.addEventListener('input', e => {
        const key = e.target.dataset.setting;
        if (!key) return;
        this.settings = TNTSettings.sanitize({...this.settings,[key]:typeof TNTSettings.defaults[key]==='boolean'?e.target.checked:Number(e.target.value)});
        this.syncSettings(); clearTimeout(this.saveTimer);
        // Boolean toggles should survive immediately hiding or closing the tool.
        if(typeof TNTSettings.defaults[key]==='boolean') void chrome.storage.local.set({tntSettings:{...this.settings}}).catch(()=>{});
        else this.saveTimer = setTimeout(() => chrome.storage.local.set({tntSettings:this.settings}).catch(() => {}), 120);
      }, {signal});
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && (this.phase !== 'idle' || this.drag)) {this.restore();return;}
        if (e.key === 'Escape') {this.panel.hidden=true;this.dock.hidden=true;}
      }, {signal,capture:true});
      const invalidateView = () => {if (this.phase !== 'idle' || this.drag) this.restore();this.position();};
      window.addEventListener('resize', invalidateView, {signal});
      window.addEventListener('scroll', invalidateView, {signal,passive:true,capture:true});
      window.visualViewport?.addEventListener('resize', invalidateView, {signal});
      window.visualViewport?.addEventListener('scroll', invalidateView, {signal});
      document.addEventListener('visibilitychange', () => {if(document.hidden) this.restore();}, {signal});
      window.addEventListener('blur', () => {if (this.phase !== 'idle' || this.drag) this.restore();}, {signal});
      document.addEventListener('fullscreenchange', () => {
        this.restore();
        if (document.fullscreenElement) {this.hide();this.toast('已隐藏 TNT；退出全屏后可从插件重新显示。');}
      }, {signal});
      window.addEventListener('pagehide', () => this.destroy(), {signal});
      this.messageListener = (msg, _sender, reply) => {
        if (!msg?.type?.startsWith('TNT_')) return;
        if (msg.type === 'TNT_SHOW') this.show();
        else if (msg.type === 'TNT_HIDE') this.hide();
        else if (msg.type === 'TNT_RESTORE') this.restore();
        else if (msg.type === 'TNT_DESTROY') {this.destroy();reply({ok:true,shown:false,phase:'idle'});return;}
        else if (msg.type === 'TNT_SETTINGS') {this.settings=TNTSettings.sanitize(msg.settings);this.syncSettings();}
        else if (msg.type === 'TNT_BACKGROUND') this.setBackground(msg.background);
        else if (msg.type !== 'TNT_STATUS') return;
        reply({ok:true,shown:this.shown,phase:this.phase,settings:this.settings});
      };
      chrome.runtime.onMessage.addListener(this.messageListener);
      this.storageListener = (changes, area) => {
        if (area === 'local' && changes.tntSettings) {this.settings=TNTSettings.sanitize(changes.tntSettings.newValue);this.syncSettings();}
        if (area === 'local' && changes.tntBackground) this.setBackground(changes.tntBackground.newValue);
      };
      chrome.storage.onChanged.addListener(this.storageListener);
    }
    createSettings() {
      const controls = this.shadow.querySelector('.controls');
      for (const [key,label,min,max,step] of [
        ['radius','爆炸范围',100,450,10],['strength','效果强度',.5,1.8,.1],['craterRatio','缺口大小',.35,1,.05],['fuseMs','点燃时间',200,2000,100],
        ['scatterMs','爆炸与散落',500,1800,100],['holdMs','停留时间',500,6000,100],['restoreMs','复原速度',200,800,50]
      ]) {
        const labelEl=document.createElement('label');
        labelEl.innerHTML=`<span class="row"><span>${label}</span><output data-value="${key}"></output></span><input type="range" data-setting="${key}" min="${min}" max="${max}" step="${step}">`;
        controls.appendChild(labelEl);
      }
      this.syncSettings();
    }
    syncSettings() {
      this.shadow.querySelectorAll('[data-setting]').forEach(el => {
        const key=el.dataset.setting;
        if (typeof TNTSettings.defaults[key]==='boolean') el.checked=this.settings[key];
        else {
          el.value=this.settings[key];
          this.shadow.querySelector(`[data-value="${key}"]`).value=key==='radius'?`${this.settings[key]} px`:key==='strength'?`${this.settings[key].toFixed(1)}×`:key==='craterRatio'?`${Math.round(this.settings[key]*100)}%`:`${(this.settings[key]/1000).toFixed(2)} 秒`;
        }
      });
      this.syncHints();
      if (this.settings.sound && this.shown && !this.destroyed) void this.soundPlayer.prepare().catch(()=>{});
      else this.soundPlayer.stopAll();
    }
    syncHints() {
      const shown=this.settings.showHints;
      this.shadow.querySelectorAll('.hint').forEach(el=>{el.hidden=!shown;});
      const button=this.dock.querySelector('[data-action="hints"]');
      const label=shown?'隐藏提示文字':'显示提示文字';
      button.title=label;button.setAttribute('aria-label',label);button.setAttribute('aria-pressed',String(!shown));
    }
    async setBackground(value) {
      const asset=TNTBackground.sanitize(value);
      if ((asset?.dataURL || null)===(this.backgroundAsset?.dataURL || null)) return this.backgroundReady;
      this.restore();
      const revision=++this.backgroundEpoch;this.backgroundAsset=asset;
      if(!asset) {this.backgroundBitmap?.close();this.backgroundBitmap=null;this.backgroundReady=Promise.resolve();return;}
      this.backgroundReady=(async()=>{
        const bitmap=await this.decodeBitmap(asset.dataURL);
        if(this.destroyed || revision!==this.backgroundEpoch) {bitmap.close();return;}
        this.backgroundBitmap?.close();this.backgroundBitmap=bitmap;
      })().catch(()=>{
        if(!this.destroyed && revision===this.backgroundEpoch) {
          this.backgroundBitmap?.close();this.backgroundBitmap=null;this.backgroundAsset=null;
          this.toast('背景图片无法加载，请从工具栏重新选择。');
        }
      });
      return this.backgroundReady;
    }
    async decodeBitmap(dataURL) {
      const match=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataURL);
      if(!match) throw new Error('图片格式无效。');
      const decoded=atob(match[2]),bytes=new Uint8Array(decoded.length);
      for(let i=0;i<decoded.length;i++) bytes[i]=decoded.charCodeAt(i);
      return createImageBitmap(new Blob([bytes],{type:match[1]}));
    }
    async ignite(center={x:this.x,y:this.y}) {
      if (this.phase !== 'idle' || !this.shown || document.hidden) return;
      const epoch = ++this.epoch, settings = {...this.settings};
      this.detonationCenter={x:center.x,y:center.y};
      this.dock.hidden=true;this.panel.hidden=true;this.runSettings=settings;this.setPhase('fuse');
      this.fuseTimer = setTimeout(() => this.explode(epoch,settings),settings.fuseMs);
    }
    collectRegions(radius) {
      const regions=[]; let scanned=0;
      const center=this.detonationCenter || {x:this.x,y:this.y};
      const left=center.x-radius,right=center.x+radius,top=center.y-radius,bottom=center.y+radius;
      for (const el of document.querySelectorAll('img,button,input,textarea,select,video,canvas,iframe,p,h1,h2,h3,a,li')) {
        if (regions.length>=100 || ++scanned>5000) break;
        if (el===this.host || this.host.contains(el)) continue;
        const r=el.getBoundingClientRect();
        if (r.width>8 && r.height>8 && r.left<right && r.right>left && r.top<bottom && r.bottom>top) regions.push({x:r.x,y:r.y,width:r.width,height:r.height});
      }
      return regions;
    }
    async explode(epoch,settings) {
      let image=null;
      try {
        if (epoch!==this.epoch || this.destroyed) return;
        await this.backgroundReady;
        if (epoch!==this.epoch || this.destroyed) return;
        this.setPhase('capture'); this.host.style.setProperty('visibility','hidden','important');
        // Child visibility:visible can override inherited visibility:hidden.
        // Parent opacity applies to the complete overlay, including the fixed icon.
        this.host.style.setProperty('opacity','0','important');
        const viewport={width:innerWidth,height:innerHeight,scrollX,scrollY};
        const center={...this.detonationCenter};
        await TWO_FRAMES();
        if (epoch!==this.epoch || this.destroyed) return;
        const result=await chrome.runtime.sendMessage({type:'TNT_CAPTURE'});
        if (epoch!==this.epoch || this.destroyed) return;
        // Only the actual screenshot needs isolation. Decoding and fragment caches
        // can take much longer, and the primed target must stay visible meanwhile.
        this.host.style.removeProperty('visibility');this.host.style.removeProperty('opacity');
        if (!result?.ok) throw new Error(result?.error || '截取画面失败，请重新打开插件启用当前网页。');
        await TWO_FRAMES();
        if (epoch!==this.epoch || this.destroyed) return;
        const encoded=result.dataURL.split(',')[1];
        if (!result.dataURL.startsWith('data:image/png;base64,') || !encoded) throw new Error('截取画面格式无效。');
        const decoded=atob(encoded), bytes=new Uint8Array(decoded.length);
        for(let i=0;i<decoded.length;i++) bytes[i]=decoded.charCodeAt(i);
        image=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
        if (epoch!==this.epoch || this.destroyed) return;
        if (innerWidth!==viewport.width || innerHeight!==viewport.height || scrollX!==viewport.scrollX || scrollY!==viewport.scrollY || document.hidden) throw new Error('页面位置已变化，本次爆炸已取消。');
        const padding=settings.radius*1.22;
        const imageRect={x:Math.max(0,Math.floor(center.x-padding)),y:Math.max(0,Math.floor(center.y-padding))};
        imageRect.width=Math.min(viewport.width,Math.ceil(center.x+padding))-imageRect.x;
        imageRect.height=Math.min(viewport.height,Math.ceil(center.y+padding))-imageRect.y;
        const texture=document.createElement('canvas');
        const resolution=Math.min(1.5,image.width/viewport.width);
        texture.width=Math.max(1,Math.round(imageRect.width*resolution));texture.height=Math.max(1,Math.round(imageRect.height*resolution));
        const sx=image.width/viewport.width,sy=image.height/viewport.height;
        texture.getContext('2d').drawImage(image,imageRect.x*sx,imageRect.y*sy,imageRect.width*sx,imageRect.height*sy,0,0,texture.width,texture.height);
        image.close();image=null;
        this.host.dataset.capture='ready';
        this.engine.start({texture,imageRect,center,radius:settings.radius,strength:settings.strength,craterRatio:settings.craterRatio,backgroundImage:this.backgroundBitmap,scatterMs:settings.scatterMs,holdMs:settings.holdMs,restoreMs:settings.restoreMs,regions:this.collectRegions(settings.radius),
          onPhase:phase=>{if(epoch===this.epoch&&!this.destroyed) this.setPhase(phase);},
          onComplete:()=>{if(epoch===this.epoch&&!this.destroyed) this.restore();}
        });
        // Phase callbacks trigger the blast/return cues after caches are ready.
        // Audio never uses a wall-clock timer to guess when the screenshot is ready.
      } catch(error) {
        if (epoch===this.epoch && !this.destroyed) {this.restore();this.toast(error.message || '无法播放爆炸，请重新启用插件。');}
      } finally {
        image?.close();
        if (!this.destroyed && epoch===this.epoch) {this.host.style.removeProperty('visibility');this.host.style.removeProperty('opacity');}
      }
    }
    startSound(kind,settings) {
      if (!this.settings.sound || this.destroyed || !this.shown) return;
      const center=this.detonationCenter || {x:this.x,y:this.y};
      try {
        void this.soundPlayer.play(kind,{
          fuseMs:settings.fuseMs,restoreMs:settings.restoreMs,strength:settings.strength,
          pan:clamp((center.x/Math.max(1,innerWidth)*2-1)*.55,-.55,.55)
        }).catch(()=>{});
      } catch { /* Audio failure must never interrupt the visual effect. */ }
    }
    restore() {
      ++this.epoch;clearTimeout(this.fuseTimer);
      const drag=this.drag;this.drag=null;this.detonationCenter=null;this.clearTarget();
      if(drag && this.button.hasPointerCapture(drag.id)) this.button.releasePointerCapture(drag.id);
      this.engine.stop();this.soundPlayer.stopAll();this.runSettings=null;
      this.host.style.removeProperty('visibility');this.host.style.removeProperty('opacity');this.host.dataset.capture='none';this.setPhase('idle');
      this.host.style.setProperty('display',this.shown?'block':'none','important');
      this.position();
    }
    show() {this.shown=true;this.restore();this.position();}
    hide() {this.restore();this.shown=false;this.host.style.setProperty('display','none','important');this.dock.hidden=true;this.panel.hidden=true;}
    toast(text) {
      const el=this.shadow.querySelector('.toast');el.textContent=text;el.hidden=false;
      clearTimeout(this.toastTimer);this.toastTimer=setTimeout(()=>{el.hidden=true;},4200);
    }
    destroy() {
      if(this.destroyed)return;
      this.restore();this.destroyed=true;this.events.abort();
      ++this.backgroundEpoch;this.backgroundBitmap?.close();this.backgroundBitmap=null;this.backgroundAsset=null;
      clearTimeout(this.toastTimer);clearTimeout(this.saveTimer);
      chrome.runtime.onMessage.removeListener(this.messageListener);chrome.storage.onChanged.removeListener(this.storageListener);
      void this.soundPlayer.close().catch(()=>{});this.host.remove();delete window.__TNTController;
    }
  }
  window.__TNTController=new TNTController();
})();
