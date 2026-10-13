(() => {
  'use strict';
  const { defaults, sanitize } = TNTSettings;
  const settingKeys = Object.keys(defaults);
  const status = document.getElementById('status');
  const readyDot = document.getElementById('readyDot');
  const readyText = document.getElementById('readyText');
  const backgroundFile = document.getElementById('backgroundFile');
  const backgroundStatus = document.getElementById('backgroundStatus');
  let settings = sanitize(defaults);
  let background = null;
  let backgroundBusy = false;
  let tab = null;
  let saveTimer = null;
  let busy = false;
  let settingsLoaded = false;

  function setStatus(message, kind = 'info') {
    status.textContent = message;
    status.dataset.kind = kind;
    readyDot.dataset.state = kind === 'error' ? 'error' : busy ? 'loading' : 'idle';
    readyText.textContent = kind === 'error' ? '需要处理' : busy ? '正在准备' : '准备就绪';
  }
  function setBusy(value) {
    busy = value;
    for (const button of document.querySelectorAll('[data-action]')) button.disabled = value;
    document.getElementById('resetButton').disabled = value;
    document.getElementById('showHints').disabled = value || !settingsLoaded;
    updateBackgroundControls();
    readyDot.dataset.state = value ? 'loading' : 'idle';
    readyText.textContent = value ? '正在准备' : '准备就绪';
  }
  function renderSettings() {
    for (const key of settingKeys) {
      const input = document.getElementById(key);
      if (key === 'sound') {
        input.checked = settings.sound;
        continue;
      }
      if (key === 'showHints') {
        input.textContent = settings.showHints ? '隐藏图标下方文字' : '显示图标下方文字';
        input.setAttribute('aria-pressed', String(!settings.showHints));
        continue;
      }
      input.value = settings[key];
      input.style.setProperty('--fill', `${(settings[key] - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100}%`);
      const output = document.getElementById(`${key}Value`);
      if (key === 'radius') {
        output.replaceChildren(document.createTextNode(`${settings[key]} `));
        const unit = document.createElement('small'); unit.textContent = 'px'; output.append(unit);
      } else if (key === 'strength') {
        output.replaceChildren(document.createTextNode(`${settings[key].toFixed(2)} `));
        const unit = document.createElement('small'); unit.textContent = '×'; output.append(unit);
      } else if (key === 'craterRatio') {
        output.replaceChildren(document.createTextNode(`${Math.round(settings[key] * 100)} `));
        const unit = document.createElement('small'); unit.textContent = '%'; output.append(unit);
      } else output.textContent = `${(settings[key] / 1000).toFixed(2)} s`;
    }
    const durationKeys = ['fuseMs', 'scatterMs', 'holdMs', 'restoreMs'];
    document.getElementById('totalTime').textContent = `${(durationKeys.reduce((sum, key) => sum + settings[key], 0) / 1000).toFixed(2)} 秒`;
    const segments = document.querySelectorAll('.timeline i');
    durationKeys.forEach((key, index) => { segments[index].style.flex = settings[key]; });
  }
  function updateBackgroundControls() {
    backgroundFile.disabled = busy || backgroundBusy;
    document.getElementById('backgroundRemove').disabled = busy || backgroundBusy;
    document.getElementById('backgroundChoose').setAttribute('aria-disabled', String(busy || backgroundBusy));
  }
  function renderBackground() {
    const image = document.getElementById('backgroundImage');
    const placeholder = document.getElementById('backgroundPlaceholder');
    const remove = document.getElementById('backgroundRemove');
    image.hidden = !background; placeholder.hidden = Boolean(background); remove.hidden = !background;
    if (background) image.src = background.dataURL;
    else image.removeAttribute('src');
    document.getElementById('backgroundName').textContent = background ? background.name : '默认深色背景';
    document.getElementById('backgroundMeta').textContent = background ? `${background.width} × ${background.height} · 本机保存` : '选择图片替换爆炸后的黑色缺口';
    updateBackgroundControls();
  }
  function setBackgroundStatus(message, kind = 'info') {
    backgroundStatus.textContent = message;
    backgroundStatus.dataset.kind = kind;
  }
  async function storeBackground(value) {
    await chrome.storage.local.set({ tntBackground: value });
    background = value;
    renderBackground();
    if (isOrdinaryPage()) {
      try { await send('TNT_BACKGROUND', { background: value }); }
      catch (_) { /* The next SHOW also reads the local image; a page receiver is optional. */ }
    }
  }
  function isOrdinaryPage() {
    return tab && Number.isInteger(tab.id) && /^(https?:\/\/|file:\/\/)/i.test(tab.url || '');
  }
  function connectionMissing(error) {
    return /receiving end does not exist|could not establish connection|message port closed/i.test(error?.message || String(error));
  }
  async function send(type, extra = {}) {
    if (!isOrdinaryPage()) throw new Error('当前页无法启用。请切换到普通 HTTP／HTTPS 网页。');
    return chrome.tabs.sendMessage(tab.id, { type, ...extra });
  }
  async function saveSettings() {
    settings = sanitize(settings);
    try {
      await chrome.storage.local.set({ tntSettings: settings });
      if (isOrdinaryPage()) {
        try { await send('TNT_SETTINGS', { settings }); }
        catch (error) { if (!connectionMissing(error)) throw error; }
      }
    } catch (error) { setStatus(`保存失败：${error.message || error}`, 'error'); }
  }
  async function performAction(type) {
    if (busy) return;
    setBusy(true);
    try {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      await chrome.storage.local.set({ tntSettings: settings });
      let response;
      try { response = await send(type); }
      catch (error) {
        if (!connectionMissing(error)) throw error;
        if (type !== 'TNT_SHOW') {
          setStatus('当前页面尚未启用。点击「显示 TNT」开始。');
          return;
        }
        setStatus('正在为当前网页准备 TNT…');
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['settings.js', 'background-image.js', 'engine.js', 'audio.js', 'content.js'] });
        response = await send(type);
      }
      if (response && response.ok === false) throw new Error(response.error || response.message || '操作未完成，请稍后再试。');
      const messages = {
        TNT_SHOW: 'TNT 已显示。仅右键拖动可移动 TNT；左键拖动松开，在释放点爆炸，TNT 图标留在原位；单独右击打开菜单。',
        TNT_HIDE: 'TNT 已隐藏。点击「显示 TNT」可以再次显示。',
        TNT_RESTORE: '网页已还原，可以继续放置和引爆。',
        TNT_DESTROY: '当前页面的 TNT 工具已关闭。',
      };
      setStatus(messages[type]);
    } catch (error) {
      const message = error.message || String(error);
      if ((tab?.url || '').startsWith('file:') && /cannot access|permission|cannot be scripted/i.test(message)) {
        setStatus('请在扩展详情中开启「允许访问文件网址」，再打开本地网页。', 'error');
      } else if (/cannot access|extensions gallery|chrome:\/\/|edge:\/\/|web store|cannot be scripted/i.test(message)) {
        setStatus('当前页无法启用。请切换到普通 HTTP／HTTPS 网页。', 'error');
      } else setStatus(message, 'error');
    } finally {
      setBusy(false);
      if (status.dataset.kind === 'error') { readyDot.dataset.state = 'error'; readyText.textContent = '需要处理'; }
    }
  }
  for (const key of settingKeys) {
    const input = document.getElementById(key);
    input.addEventListener(key === 'showHints' ? 'click' : key === 'sound' ? 'change' : 'input', () => {
      if (key === 'showHints' && (busy || !settingsLoaded)) return;
      const value = key === 'showHints' ? !settings.showHints : key === 'sound' ? input.checked : Number(input.value);
      settings = sanitize({ ...settings, [key]: value });
      renderSettings();
      clearTimeout(saveTimer);
      if (key === 'showHints') {
        saveTimer = null;
        void saveSettings();
        return;
      }
      // Queue the durable write immediately: closing a popup cancels its timers.
      void chrome.storage.local.set({ tntSettings: settings }).catch(error => {
        setStatus(`保存失败：${error.message || error}`, 'error');
      });
      saveTimer = setTimeout(() => { saveTimer = null; void saveSettings(); }, 150);
    });
  }
  for (const button of document.querySelectorAll('[data-action]')) {
    button.addEventListener('click', () => { void performAction(button.dataset.action); });
  }
  document.getElementById('resetButton').addEventListener('click', () => {
    clearTimeout(saveTimer); saveTimer = null;
    settings = sanitize(defaults); renderSettings();
    void saveSettings(); setStatus('已恢复默认参数。');
  });
  backgroundFile.addEventListener('change', async () => {
    const file = backgroundFile.files && backgroundFile.files[0];
    if (!file || busy || backgroundBusy) return;
    backgroundBusy = true; updateBackgroundControls();
    setBackgroundStatus('正在处理图片，请保持面板开启…');
    try {
      const prepared = await TNTBackground.prepareFile(file);
      await storeBackground(prepared);
      setBackgroundStatus('图片已保存在本机，下次爆炸将显示在缺口内。');
    } catch (error) {
      setBackgroundStatus(`${error.message || '图片处理失败。'} 已保留原背景。`, 'error');
    } finally {
      backgroundBusy = false; backgroundFile.value = ''; updateBackgroundControls();
    }
  });
  document.getElementById('backgroundRemove').addEventListener('click', async () => {
    if (!background || busy || backgroundBusy) return;
    backgroundBusy = true; updateBackgroundControls();
    try {
      await storeBackground(null);
      setBackgroundStatus('已移除图片，恢复默认深色背景。');
    } catch (error) {
      setBackgroundStatus(`移除失败：${error.message || error}`, 'error');
    } finally { backgroundBusy = false; updateBackgroundControls(); }
  });
  async function initialize() {
    setBusy(true);
    try {
      const [stored, tabs] = await Promise.all([
        chrome.storage.local.get(['tntSettings', 'tntBackground']),
        chrome.tabs.query({ active: true, currentWindow: true }),
      ]);
      settings = sanitize(stored.tntSettings); tab = tabs[0] || null;
      settingsLoaded = true;
      background = TNTBackground.sanitize(stored.tntBackground);
      renderSettings();
      renderBackground();
      if (!isOrdinaryPage()) setStatus('当前页无法启用。请切换到普通 HTTP／HTTPS 网页。', 'error');
    } catch (error) { setStatus(`初始化失败：${error.message || error}`, 'error'); }
    finally {
      setBusy(false);
      if (status.dataset.kind === 'error') { readyDot.dataset.state = 'error'; readyText.textContent = '需要处理'; }
    }
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.tntSettings) { settings = sanitize(changes.tntSettings.newValue); renderSettings(); }
    if (changes.tntBackground) { background = TNTBackground.sanitize(changes.tntBackground.newValue); renderBackground(); }
  });
  renderSettings();
  renderBackground();
  void initialize();
})();
