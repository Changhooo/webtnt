'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function dependency(name) {
  try { return require(name); }
  catch (initialError) {
    if (initialError.code !== 'MODULE_NOT_FOUND') throw initialError;
    const candidates = [
      ...(process.env.TNT_QA_DEPENDENCIES || '').split(path.delimiter),
    ].filter(Boolean);
    for (const candidate of candidates) {
      try { return require(require.resolve(name, { paths: [candidate, path.dirname(candidate)] })); }
      catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
    }
    throw new Error(`Background image tests require ${name}; install dev dependencies or set TNT_QA_DEPENDENCIES.`, { cause: initialError });
  }
}
const { createCanvas, loadImage } = dependency('@napi-rs/canvas');
const code = fs.readFileSync(path.resolve(__dirname, '../extension/background-image.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

function fixture(options = {}) {
  const calls = { decode: 0, close: 0, encode: [], readers: 0 };
  const context = {
    console, Blob, Set, FileReader: class {
      readAsDataURL(blob) {
        calls.readers++;
        if (options.oversizedFirst && calls.readers === 1) {
          this.result = `data:image/jpeg;base64,${'A'.repeat(3 * 1024 * 1024 + 4)}`;
          this.onload(); return;
        }
        blob.arrayBuffer().then(bytes => {
          this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`;
          this.onload();
        }).catch(error => { this.error = error; this.onerror(); });
      }
    },
    createImageBitmap: async file => {
      calls.decode++;
      const image = await loadImage(Buffer.from(await file.arrayBuffer()));
      image.close = () => { calls.close++; };
      return image;
    },
    document: {
      createElement(tag) {
        assert.equal(tag, 'canvas');
        const canvas = createCanvas(1, 1);
        if (options.noContext) canvas.getContext = () => null;
        canvas.toBlob = (callback, type, quality) => {
          calls.encode.push({ width: canvas.width, height: canvas.height, type, quality });
          if (options.encodingFailure) { callback(null); return; }
          callback(new Blob([canvas.toBuffer(type, Math.round(quality * 100))], { type }));
        };
        return canvas;
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  return { api: context.TNTBackground, calls };
}
function file(bytes, type = 'image/png', name = 'local.png') {
  const blob = new Blob([bytes], { type });
  Object.defineProperty(blob, 'name', { value: name });
  return blob;
}
function image(width = 32, height = 20, type = 'image/png') {
  const canvas = createCanvas(width, height);
  const drawing = canvas.getContext('2d');
  drawing.fillStyle = '#ef7258'; drawing.fillRect(0, 0, width, height);
  drawing.fillStyle = '#173956'; drawing.fillRect(width / 2, 0, width / 2, height);
  return file(canvas.toBuffer(type), type);
}

test('background sanitation accepts only bounded local raster data and plain names', () => {
  const { api } = fixture();
  const value = { dataURL: 'data:image/png;base64,AQIDBA==', width: 32, height: 20, name: '<b>\u0000portrait.png</b>' };
  const sanitized = plain(api.sanitize(value));
  assert.equal(sanitized.width, 32);
  assert.equal(sanitized.height, 20);
  assert.doesNotMatch(sanitized.name, /[<>\u0000]/);
  assert.equal(api.sanitize({ ...value, name: 'a'.repeat(200) }).name.length, 100);
  assert.equal(api.sanitize({ ...value, name: undefined }).name, '自定义背景');
  for (const bad of [
    null, { ...value, dataURL: 'https://example.com/image.png' },
    { ...value, dataURL: 'data:image/svg+xml;base64,AQIDBA==' },
    { ...value, dataURL: 'data:text/html;base64,AQIDBA==' },
    { ...value, dataURL: 'data:image/png;base64,' },
    { ...value, dataURL: 'data:image/png;base64,QQ===' },
    { ...value, dataURL: 'data:image/png;base64,A QI=' },
    { ...value, dataURL: `data:image/png;base64,${'A'.repeat(3 * 1024 * 1024)}` },
    { ...value, width: 0 }, { ...value, width: 1601 }, { ...value, height: 1.5 },
    { ...value, width: '32' }, { ...value, height: Infinity },
  ]) assert.equal(api.sanitize(bad), null);
});

test('PNG, JPEG and WEBP files become bounded JPEG backgrounds and release decoded bitmaps', async () => {
  for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
    const { api, calls } = fixture();
    const prepared = await api.prepareFile(image(40, 24, type));
    assert.equal(prepared.width, 40); assert.equal(prepared.height, 24);
    assert.match(prepared.dataURL, /^data:image\/jpeg;base64,/);
    assert.equal(prepared.name, 'local.png');
    assert.equal(calls.close, 1);
    assert.equal(calls.encode[0].quality, 0.85);
    assert.equal(calls.encode[0].type, 'image/jpeg');
    const decoded = await loadImage(Buffer.from(prepared.dataURL.split(',')[1], 'base64'));
    assert.equal(decoded.width, 40); assert.equal(decoded.height, 24);
    assert(prepared.dataURL.length <= 3 * 1024 * 1024);
    assert(api.sanitize(prepared));
  }
});

test('large source images preserve aspect ratio with the longest edge at 1600', async () => {
  const { api, calls } = fixture();
  const prepared = await api.prepareFile(image(2400, 1200));
  assert.equal(prepared.width, 1600); assert.equal(prepared.height, 800);
  assert.equal(calls.close, 1);
  const decoded = await loadImage(Buffer.from(prepared.dataURL.split(',')[1], 'base64'));
  assert.equal(decoded.width, 1600); assert.equal(decoded.height, 800);
});

test('an oversized encoded image is scaled again until its stored data is below the limit', async () => {
  const { api, calls } = fixture({ oversizedFirst: true });
  const prepared = await api.prepareFile(image(2000, 1000));
  assert.equal(calls.encode.length, 2);
  assert.equal(prepared.width, 1280); assert.equal(prepared.height, 640);
  assert(prepared.dataURL.length <= 3 * 1024 * 1024);
  assert.equal(calls.close, 1);
});

test('non-images, empty files, files above 20 MB and damaged images give Chinese errors', async () => {
  const { api, calls } = fixture();
  await assert.rejects(api.prepareFile(file('x', 'image/svg+xml')), /JPEG、PNG 或 WEBP/);
  await assert.rejects(api.prepareFile(file('', 'image/png')), /为空/);
  await assert.rejects(api.prepareFile({ type: 'image/png', size: 20 * 1024 * 1024 + 1 }), /不能超过 20 MB/);
  assert.equal(calls.decode, 0);
  await assert.rejects(api.prepareFile(file('not an image', 'image/png')), /图片无法读取/);
  assert.equal(calls.decode, 1); assert.equal(calls.close, 0);
});

test('decoded bitmap resources are released when rendering or encoding fails', async () => {
  for (const options of [{ noContext: true }, { encodingFailure: true }]) {
    const { api, calls } = fixture(options);
    await assert.rejects(api.prepareFile(image()), /当前浏览器无法处理|图片处理失败/);
    assert.equal(calls.close, 1);
  }
});
