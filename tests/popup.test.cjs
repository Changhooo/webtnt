'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const extension = path.resolve(__dirname, '../extension');
const popupHTML = fs.readFileSync(path.join(extension, 'popup.html'), 'utf8');
const settingsCode = fs.readFileSync(path.join(extension, 'settings.js'), 'utf8');
const backgroundCode = fs.readFileSync(path.join(extension, 'background-image.js'), 'utf8');
const popupCode = fs.readFileSync(path.join(extension, 'popup.js'), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));

async function loadHappyDOM() {
  try { return await import('happy-dom'); }
  catch (initialError) {
    if (initialError.code !== 'ERR_MODULE_NOT_FOUND') throw initialError;
    const candidates = [
      ...(process.env.TNT_QA_DEPENDENCIES || '').split(path.delimiter),
    ].filter(Boolean);
    for (const candidate of candidates) {
      try {
        const entry = require.resolve('happy-dom', {
          paths: [candidate, path.dirname(candidate)],
        });
        return await import(pathToFileURL(entry).href);
      } catch (error) {
        if (!['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND'].includes(error.code)) throw error;
      }
    }
    throw new Error('Popup tests require happy-dom. Install dev dependencies or set TNT_QA_DEPENDENCIES to their node_modules directory.', { cause: initialError });
  }
}
const happyDOM = loadHappyDOM();

async function flushMicrotasks() {
  for (let index = 0; index < 30; index++) await Promise.resolve();
}

async function fixture(t, options = {}) {
  const { Window } = await happyDOM;
  const window = new Window({
    url: 'https://tnt-popup.test/',
    settings: {
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableIframePageLoading: true,
    },
  });
  t.after(async () => { await window.happyDOM.close(); });
  window.document.write(popupHTML);
  const calls = [];
  const storageListeners = [];
  const timers = new Map();
  let timerSequence = 0;
  let receiving = options.receiving === true;
  let persisted = { tntSettings: copy(options.stored || {}), tntBackground: copy(options.background || null) };
  let resolveInitialization;
  const initialization = options.holdInitialization
    ? new Promise(resolve => { resolveInitialization = resolve; })
    : Promise.resolve(persisted);

  window.setTimeout = callback => {
    const id = ++timerSequence;
    timers.set(id, callback);
    return id;
  };
  window.clearTimeout = id => { timers.delete(id); };
  window.chrome = {
    storage: {
      local: {
        get: async key => {
          calls.push({ api: 'storage.get', key });
          if (options.storageGetError) throw new Error(options.storageGetError);
          return initialization;
        },
        set: async data => {
          const saved = copy(data);
          calls.push({ api: 'storage.set', data: saved });
          persisted = { ...persisted, ...saved };
        },
      },
      onChanged: { addListener: listener => storageListeners.push(listener) },
    },
    tabs: {
      query: async query => {
        calls.push({ api: 'tabs.query', query: copy(query) });
        return [{ id: 17, url: options.url || 'https://example.test/page' }];
      },
      sendMessage: async (tabId, message) => {
        calls.push({ api: 'tabs.sendMessage', tabId, message: copy(message) });
        if (!receiving) throw new Error('Could not establish connection. Receiving end does not exist.');
        return { ok: true };
      },
    },
    scripting: {
      executeScript: async injection => {
        calls.push({ api: 'scripting.executeScript', injection: copy(injection) });
        if (options.injectionError) throw new Error(options.injectionError);
        receiving = true;
        return [{ result: undefined }];
      },
    },
  };
  const createElement = window.document.createElement.bind(window.document);
  window.document.createElement = (tag, ...args) => tag === 'canvas' ? {
    width: 0, height: 0,
    getContext: () => ({ fillRect() {}, drawImage() {} }),
    toBlob(callback, type) { callback(new window.Blob(['image'], { type })); },
  } : createElement(tag, ...args);
  window.createImageBitmap = async file => {
    if (file.name === 'broken.png') throw new Error('Image cannot be decoded');
    return { width: 640, height: 480, close() { calls.push({ api: 'bitmap.close' }); } };
  };
  window.FileReader = class {
    readAsDataURL(blob) { this.result = `data:${blob.type};base64,aW1hZ2U=`; this.onload(); }
  };
  window.eval(settingsCode);
  window.eval(backgroundCode);
  window.eval(popupCode);

  const document = window.document;
  return {
    window, document, calls,
    get persisted() { return persisted.tntSettings; },
    get persistedBackground() { return persisted.tntBackground; },
    get status() { return document.getElementById('status').textContent; },
    resolveInitialization() { resolveInitialization(persisted); },
    async ready() { await flushMicrotasks(); },
    async action(type) {
      document.querySelector(`[data-action="${type}"]`).click();
      await flushMicrotasks();
    },
    input(key, value) {
      const input = document.getElementById(key);
      if (key === 'sound') input.checked = value;
      else input.value = String(value);
      input.dispatchEvent(new window.Event(key === 'sound' ? 'change' : 'input', { bubbles: true }));
    },
    async runTimers() {
      for (const [id, callback] of [...timers]) { timers.delete(id); callback(); }
      await flushMicrotasks();
    },
    changeStorage(settings, area = 'local') {
      for (const listener of storageListeners) listener({ tntSettings: { newValue: settings } }, area);
    },
    changeBackground(value, area = 'local') {
      for (const listener of storageListeners) listener({ tntBackground: { newValue: value } }, area);
    },
    async chooseImage(name = 'custom.png', type = 'image/png') {
      const file = new window.File(['image data'], name, { type });
      const input = document.getElementById('backgroundFile');
      Object.defineProperty(input, 'files', { configurable: true, value: [file] });
      input.dispatchEvent(new window.Event('change', { bubbles: true }));
      await flushMicrotasks();
    },
    callsOf(api) { return calls.filter(call => call.api === api); },
  };
}

test('popup disables actions until persisted settings and the active tab are available', async t => {
  const ui = await fixture(t, { holdInitialization: true, stored: { radius: 320, sound: true, showHints: false } });
  for (const button of ui.document.querySelectorAll('[data-action]')) assert.equal(button.disabled, true);
  assert.equal(ui.document.getElementById('resetButton').disabled, true);
  assert.equal(ui.document.getElementById('showHints').disabled, true);
  ui.document.getElementById('showHints').click();
  assert.equal(ui.callsOf('storage.set').length, 0, 'an early click must not overwrite the saved visibility preference');
  ui.document.querySelector('#showButton').click();
  assert.equal(ui.callsOf('tabs.sendMessage').length, 0);
  ui.resolveInitialization();
  await ui.ready();
  for (const button of ui.document.querySelectorAll('[data-action]')) assert.equal(button.disabled, false);
  assert.equal(ui.document.getElementById('radius').value, '320');
  assert.equal(ui.document.getElementById('sound').checked, true);
  assert.equal(ui.document.getElementById('showHints').disabled, false);
  assert.equal(ui.document.getElementById('showHints').textContent, '显示图标下方文字');
  assert.equal(ui.document.getElementById('showHints').getAttribute('aria-pressed'), 'true');
  assert.equal(ui.document.getElementById('totalTime').textContent, '4.65 秒');
});

test('SHOW installs scripts once when the content receiver is missing and actions use the same tab', async t => {
  const ui = await fixture(t);
  await ui.ready();
  await ui.action('TNT_SHOW');
  assert.equal(ui.callsOf('scripting.executeScript').length, 1);
  assert.deepEqual(ui.callsOf('scripting.executeScript')[0].injection, {
    target: { tabId: 17 }, files: ['settings.js', 'background-image.js', 'engine.js', 'content.js'],
  });
  assert.match(ui.status, /TNT 已显示/);
  await ui.action('TNT_SHOW');
  assert.equal(ui.callsOf('scripting.executeScript').length, 1);
  for (const [action, status] of [
    ['TNT_HIDE', /已隐藏/], ['TNT_RESTORE', /已还原/], ['TNT_DESTROY', /已关闭/],
  ]) {
    await ui.action(action);
    assert.match(ui.status, status);
    assert.deepEqual(ui.callsOf('tabs.sendMessage').at(-1), {
      api: 'tabs.sendMessage', tabId: 17, message: { type: action },
    });
  }
});

test('slider and sound changes persist immediately before deferred content synchronization', async t => {
  const ui = await fixture(t, { receiving: true });
  await ui.ready();
  ui.input('radius', 350);
  assert.equal(ui.persisted.radius, 350, 'closing the popup before its timer runs must not lose a setting');
  assert.equal(ui.callsOf('tabs.sendMessage').length, 0);
  await ui.runTimers();
  assert.equal(ui.callsOf('tabs.sendMessage').at(-1).message.type, 'TNT_SETTINGS');
  assert.equal(ui.callsOf('tabs.sendMessage').at(-1).message.settings.radius, 350);
  ui.input('sound', true);
  assert.equal(ui.persisted.sound, true);
  await ui.runTimers();
  assert.equal(ui.callsOf('tabs.sendMessage').at(-1).message.settings.sound, true);
  ui.input('craterRatio', 0.4);
  assert.equal(ui.persisted.craterRatio, 0.4);
  assert.equal(ui.document.getElementById('craterRatioValue').textContent, '40 %');
  await ui.runTimers();
  assert.equal(ui.callsOf('tabs.sendMessage').at(-1).message.settings.craterRatio, 0.4);
  ui.document.getElementById('resetButton').click();
  await ui.ready();
  assert.deepEqual(ui.persisted, {
    radius: 250, strength: 1, craterRatio: 0.65, fuseMs: 800, scatterMs: 1000,
    holdMs: 2500, restoreMs: 350, sound: false, showHints: true,
  });
  assert.match(ui.status, /恢复默认/);
});

test('hint button saves immediately, synchronizes without waiting for a slider timer, and retains the choice on reopen', async t => {
  const ui = await fixture(t, { receiving: true });
  await ui.ready();
  const button = ui.document.getElementById('showHints');
  assert.equal(button.textContent, '隐藏图标下方文字');
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  button.click();
  assert.equal(ui.persisted.showHints, false, 'visibility is durable as soon as the button is clicked');
  assert.equal(button.textContent, '显示图标下方文字');
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  await ui.ready();
  assert.equal(ui.callsOf('tabs.sendMessage').at(-1).message.type, 'TNT_SETTINGS');
  assert.equal(ui.callsOf('tabs.sendMessage').at(-1).message.settings.showHints, false);
  const reopened = await fixture(t, { receiving: true, stored: copy(ui.persisted) });
  await reopened.ready();
  const reopenedButton = reopened.document.getElementById('showHints');
  assert.equal(reopenedButton.textContent, '显示图标下方文字');
  assert.equal(reopenedButton.getAttribute('aria-pressed'), 'true');
  reopenedButton.click();
  assert.equal(reopened.persisted.showHints, true);
  await reopened.ready();
  assert.equal(reopened.callsOf('tabs.sendMessage').at(-1).message.settings.showHints, true);
  reopenedButton.click();
  assert.equal(reopened.persisted.showHints, false);
  reopened.document.getElementById('resetButton').click();
  await reopened.ready();
  assert.equal(reopened.persisted.showHints, true);
  assert.equal(reopenedButton.textContent, '隐藏图标下方文字');
  assert.equal(reopenedButton.getAttribute('aria-pressed'), 'false');
});

test('hint button follows local storage updates and is disabled while a page action is preparing', async t => {
  const ui = await fixture(t, { receiving: true });
  await ui.ready();
  const button = ui.document.getElementById('showHints');
  ui.changeStorage({ radius: 320, showHints: false });
  assert.equal(button.textContent, '显示图标下方文字');
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  ui.changeStorage({ showHints: true }, 'sync');
  assert.equal(button.textContent, '显示图标下方文字');
  ui.document.getElementById('showButton').click();
  assert.equal(button.disabled, true);
  button.click();
  assert.equal(ui.persisted.showHints, false);
  await ui.ready();
  assert.equal(button.disabled, false);
  button.click();
  assert.equal(ui.persisted.showHints, true);
  assert.equal(ui.persisted.radius, 320, 'toggling text preserves other settings received from another page');
  await ui.ready();
});

test('hint button remains disabled if saved settings cannot be read', async t => {
  const ui = await fixture(t, { storageGetError: 'Storage unavailable' });
  await ui.ready();
  const button = ui.document.getElementById('showHints');
  assert.equal(button.disabled, true);
  button.click();
  assert.equal(ui.callsOf('storage.set').length, 0);
  assert.match(ui.status, /初始化失败/);
});

test('local background selection is prepared, saved independently, previewed and removed', async t => {
  const ui = await fixture(t, { receiving: true });
  await ui.ready();
  assert.equal(ui.document.getElementById('backgroundImage').hidden, true);
  await ui.chooseImage('custom.png');
  assert.equal(ui.persistedBackground.name, 'custom.png');
  assert.equal(ui.persistedBackground.width, 640);
  assert.match(ui.persistedBackground.dataURL, /^data:image\/jpeg;base64,/);
  assert.deepEqual(ui.callsOf('tabs.sendMessage').at(-1).message, { type: 'TNT_BACKGROUND', background: ui.persistedBackground });
  assert.equal(ui.document.getElementById('backgroundImage').hidden, false);
  assert.equal(ui.document.getElementById('backgroundName').textContent, 'custom.png');
  assert.equal(ui.document.getElementById('backgroundRemove').hidden, false);
  assert.match(ui.document.getElementById('backgroundStatus').textContent, /保存在本机/);
  assert.equal(ui.callsOf('bitmap.close').length, 1);
  assert.equal(Object.hasOwn(ui.persisted, 'dataURL'), false);
  ui.document.getElementById('backgroundRemove').click();
  await ui.ready();
  assert.equal(ui.persistedBackground, null);
  assert.equal(ui.document.getElementById('backgroundImage').hasAttribute('src'), false);
  assert.equal(ui.document.getElementById('backgroundName').textContent, '默认深色背景');
  assert.deepEqual(ui.callsOf('tabs.sendMessage').at(-1).message, { type: 'TNT_BACKGROUND', background: null });
});

test('stored backgrounds initialize and synchronize, while failed replacement preserves the previous image', async t => {
  const background = { dataURL: 'data:image/png;base64,AQIDBA==', width: 50, height: 30, name: 'old.png' };
  const ui = await fixture(t, { background });
  await ui.ready();
  assert.equal(ui.document.getElementById('backgroundName').textContent, 'old.png');
  await ui.chooseImage('broken.png');
  assert.deepEqual(ui.persistedBackground, background);
  assert.equal(ui.document.getElementById('backgroundName').textContent, 'old.png');
  assert.match(ui.document.getElementById('backgroundStatus').textContent, /已保留原背景/);
  assert.equal(ui.callsOf('storage.set').length, 0);
  await ui.chooseImage('script.svg', 'image/svg+xml');
  assert.deepEqual(ui.persistedBackground, background);
  assert.match(ui.document.getElementById('backgroundStatus').textContent, /JPEG、PNG 或 WEBP/);
  ui.changeBackground({ ...background, name: 'external.png' });
  assert.equal(ui.document.getElementById('backgroundName').textContent, 'external.png');
  ui.changeBackground(null, 'sync');
  assert.equal(ui.document.getElementById('backgroundName').textContent, 'external.png');
  ui.changeBackground(null);
  assert.equal(ui.document.getElementById('backgroundImage').hidden, true);
  assert.equal(ui.document.getElementById('backgroundRemove').hidden, true);
});

test('external local storage changes update an open popup and other storage areas are ignored', async t => {
  const ui = await fixture(t);
  await ui.ready();
  ui.changeStorage({ radius: 180, strength: 0.65, holdMs: 6000, sound: true });
  assert.equal(ui.document.getElementById('radius').value, '180');
  assert.equal(ui.document.getElementById('strength').value, '0.65');
  assert.equal(ui.document.getElementById('holdMsValue').textContent, '6.00 s');
  assert.equal(ui.document.getElementById('sound').checked, true);
  assert.equal(ui.document.getElementById('totalTime').textContent, '8.15 秒');
  ui.changeStorage({ radius: 450 }, 'sync');
  assert.equal(ui.document.getElementById('radius').value, '180');
});

test('hide, restore and destroy do not inject into a page where the tool is not running', async t => {
  const ui = await fixture(t);
  await ui.ready();
  for (const action of ['TNT_HIDE', 'TNT_RESTORE', 'TNT_DESTROY']) {
    await ui.action(action);
    assert.match(ui.status, /尚未启用/);
  }
  assert.equal(ui.callsOf('scripting.executeScript').length, 0);
});

test('restricted browser pages give a clear message without messaging or script injection', async t => {
  for (const url of ['chrome://extensions/', 'edge://settings/', 'about:blank']) {
    const ui = await fixture(t, { url });
    await ui.ready();
    assert.equal(ui.document.getElementById('status').dataset.kind, 'error');
    await ui.action('TNT_SHOW');
    assert.match(ui.status, /当前页无法启用/);
    assert.equal(ui.callsOf('tabs.sendMessage').length, 0);
    assert.equal(ui.callsOf('scripting.executeScript').length, 0);
  }
});

test('local file pages are supported and a missing file access permission is explained', async t => {
  const allowed = await fixture(t, { url: 'file:///C:/demo/index.html' });
  await allowed.ready();
  await allowed.action('TNT_SHOW');
  assert.match(allowed.status, /TNT 已显示/);
  assert.equal(allowed.callsOf('scripting.executeScript').length, 1);
  const denied = await fixture(t, {
    url: 'file:///C:/demo/index.html', injectionError: 'Cannot access contents of url: file:///. Extension manifest must request permission.',
  });
  await denied.ready();
  await denied.action('TNT_SHOW');
  assert.match(denied.status, /允许访问文件网址/);
  assert.equal(denied.document.getElementById('status').dataset.kind, 'error');
});
