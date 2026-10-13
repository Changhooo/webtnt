'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Player } = require('../extension/audio.js');

const names = ['ignite.wav', 'fuse.wav', 'blast.wav', 'restore.wav'];
const durations = [0.26, 0.18, 1.3, 0.62];
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function fixture(options = {}) {
  const calls = { create: 0, fetch: [], decode: [], resume: 0, close: 0, nodes: [], sources: [] };
  const resume = deferred(), decode = deferred(), fetch = deferred();
  const parameter = () => ({ value: 1, events: [], setValueAtTime(value, time) { this.value = value; this.events.push([value, time]); } });
  const node = type => {
    const result = { type, connections: [], disconnects: 0, connect(destination) { this.connections.push(destination); }, disconnect() { this.disconnects++; this.connections = []; } };
    calls.nodes.push(result);
    return result;
  };
  const context = {
    state: 'suspended', currentTime: 12.5, destination: { type: 'destination' },
    resume() {
      calls.resume++;
      if (options.resumeThrow) throw new Error('Autoplay unavailable');
      if (options.resumeFailure) return Promise.reject(new Error('Autoplay blocked'));
      const promise = options.resumeDeferred ? resume.promise : Promise.resolve();
      return promise.then(() => { if (this.state !== 'closed') this.state = 'running'; });
    },
    decodeAudioData(bytes) {
      const index = new Uint8Array(bytes)[0];
      calls.decode.push(names[index]);
      if (options.decodeFailure === names[index]) return Promise.reject(new Error('Bad WAV'));
      const buffer = { name: names[index], duration: durations[index] };
      return options.decodeDeferred ? decode.promise.then(() => buffer) : Promise.resolve(buffer);
    },
    createGain() { const gain = node('gain'); gain.gain = parameter(); return gain; },
    createStereoPanner() { const panner = node('panner'); panner.pan = parameter(); return panner; },
    createBufferSource() {
      const source = node('source');
      Object.assign(source, {
        playbackRate: parameter(), loop: false, starts: [], stops: 0,
        start(time) { if (options.startFailure) throw new Error('Cannot start'); this.starts.push(time); },
        stop() { this.stops++; },
        end() { this.onended?.(); },
      });
      calls.sources.push(source);
      return source;
    },
    close() { calls.close++; this.state = 'closed'; return options.closeDeferred ? new Promise(() => {}) : options.closeFailure ? Promise.reject(new Error('Closed')) : Promise.resolve(); },
  };
  if (options.noPanner) delete context.createStereoPanner;
  const player = new Player({
    timeoutMs: options.timeoutMs || 100,
    createContext() {
      calls.create++;
      if (options.contextThrow) throw new Error('No device');
      return options.noContext ? null : context;
    },
    resolveURL: filename => `chrome-extension://fixture/assets/audio/${filename}`,
    async fetchResource(url, init) {
      const name = url.slice(url.lastIndexOf('/') + 1);
      calls.fetch.push({ url, signal: init.signal });
      if (options.fetchFailure === name) throw new Error('Missing asset');
      if (options.fetchDeferred || options.fetchDeferredName === name) await fetch.promise;
      return { ok: options.httpFailure !== name, arrayBuffer: async () => options.emptyAsset === name ? new ArrayBuffer(0) : new Uint8Array([names.indexOf(name)]).buffer };
    },
  });
  return { player, calls, context, resume, decode, fetch };
}

test('constructor does not initialize audio; concurrent prepare decodes once without resuming', async () => {
  const f = fixture();
  assert.equal(f.calls.create, 0);
  assert.equal(f.calls.fetch.length, 0);
  const first = f.player.prepare(), second = f.player.prepare();
  assert.equal(first, second);
  assert.equal(await first, true);
  assert.equal(f.calls.create, 1);
  assert.equal(f.calls.resume, 0);
  assert.equal(f.calls.fetch.length, 4);
  assert.deepEqual(f.calls.decode.sort(), [...names].sort());
  assert.equal(f.player.buffers.size, 4);
  await f.player.close();
});

test('first cue resumes synchronously in the gesture; fuse overlaps ignition and loops until the next phase', async () => {
  const f = fixture();
  const cue = f.player.play('fuse', { pan: 7, strength: 9 });
  assert.equal(f.calls.resume, 1, 'resume must happen before play yields');
  assert.equal(await cue, true);
  const [ignite, fuse] = f.calls.sources;
  assert.equal(ignite.buffer.name, 'ignite.wav');
  assert.equal(ignite.loop, false);
  assert.equal(fuse.buffer.name, 'fuse.wav');
  assert.equal(fuse.loop, true);
  assert.equal(fuse.starts[0], f.context.currentTime + 0.04);
  assert.equal(f.calls.nodes.find(n => n.type === 'panner').pan.value, 1);
  assert.ok(f.calls.nodes.find(n => n.type === 'gain').gain.value < 0.7);
  assert.equal(await f.player.play('explosion', { pan: -9 }), true);
  assert.equal(ignite.stops, 1);
  assert.equal(fuse.stops, 1);
  assert.ok(ignite.disconnects && fuse.disconnects);
  assert.equal(f.calls.sources[2].buffer.name, 'blast.wav');
  assert.equal(f.calls.sources[2].loop, false);
  assert.equal(f.calls.fetch.length, 4, 'reuse decoded assets across phases');
  assert.equal(f.calls.decode.length, 4);
  assert.equal(f.calls.nodes.filter(n => n.type === 'panner').at(-1).pan.value, -1);
  await f.player.close();
});

test('the full restore sample aligns its final assembly sound with every supported restore duration', async () => {
  const f = fixture();
  await f.player.prepare();
  for (const restoreMs of [200, 350, 800]) {
    assert.equal(await f.player.play('restore', { restoreMs }), true);
    const source = f.calls.sources.at(-1);
    assert.equal(source.buffer.name, 'restore.wav');
    assert.equal(source.buffer.duration / source.playbackRate.value, restoreMs / 1000);
    assert.deepEqual(source.starts, [f.context.currentTime], 'start at the current visual phase, not a fixed future timer');
    source.end();
    assert.equal(f.player.sources.size, 0);
    assert.equal(f.player.nodes.size, 0);
  }
  assert.equal(f.calls.decode.length, 4);
  await f.player.close();
});

test('stopAll cuts and disconnects every active node and remains safe on repeated calls', async () => {
  const f = fixture();
  await f.player.play('fuse');
  const nodes = [...f.calls.nodes];
  f.player.stopAll();
  f.player.stopAll();
  assert.equal(f.player.nodes.size, 0);
  assert.equal(f.player.sources.size, 0);
  for (const source of f.calls.sources) { assert.equal(source.stops, 1); assert.equal(source.onended, null); }
  for (const node of nodes) assert.equal(node.disconnects, 1);
  await f.player.close();
});

test('cancelling a pending resume cannot start a late cue, while cached buffers remain reusable', async () => {
  const f = fixture({ resumeDeferred: true });
  const cue = f.player.play('fuse');
  await settle();
  f.player.stopAll();
  f.resume.resolve();
  assert.equal(await cue, false);
  assert.equal(f.calls.sources.length, 0);
  assert.equal(await f.player.play('explosion'), true);
  assert.equal(f.calls.sources.length, 1);
  assert.equal(f.calls.fetch.length, 4);
  await f.player.close();
});

test('phase replacement during slow decoding starts only the newest phase', async () => {
  const f = fixture({ decodeDeferred: true });
  const fuse = f.player.play('fuse');
  await settle();
  const explosion = f.player.play('explosion');
  f.decode.resolve();
  assert.equal(await fuse, false);
  assert.equal(await explosion, true);
  assert.deepEqual(f.calls.sources.map(s => s.buffer.name), ['blast.wav']);
  assert.equal(f.calls.decode.length, 4);
  await f.player.close();
});

test('cancelling pending fetching or decoding never resurrects sound', async () => {
  for (const delay of ['fetchDeferred', 'decodeDeferred']) {
    const f = fixture({ [delay]: true });
    const cue = f.player.play('fuse');
    await settle();
    f.player.stopAll();
    f.fetch.resolve();
    f.decode.resolve();
    assert.equal(await cue, false);
    assert.equal(f.calls.sources.length, 0);
    await f.player.close();
  }
});

test('close cancels outstanding work, clears cache and does not allow late decode or repeated play to reopen audio', async () => {
  const f = fixture({ decodeDeferred: true });
  const cue = f.player.play('fuse');
  await settle();
  const close = f.player.close();
  assert.equal(close, f.player.close());
  assert.equal(await close, true);
  assert.equal(await cue, false);
  f.decode.resolve();
  await settle();
  assert.equal(f.player.buffers.size, 0);
  assert.equal(f.calls.sources.length, 0);
  assert.equal(await f.player.prepare(), false);
  assert.equal(await f.player.play('explosion'), false);
  assert.equal(f.calls.create, 1);
  assert.equal(f.calls.close, 1);
  assert.equal(f.player.pending.size, 0);
});

test('close aborts a hanging asset request instead of waiting for its timeout', async () => {
  const f = fixture({ fetchDeferred: true });
  const preparation = f.player.prepare();
  assert.equal(f.calls.fetch.length, 4);
  await f.player.close();
  assert.equal(await preparation, false);
  assert.ok(f.calls.fetch.every(call => call.signal.aborted));
  f.fetch.resolve();
  await settle();
  assert.equal(f.calls.decode.length, 0);
});

test('resume refusal, unavailable devices and missing assets fail safely without animation dependencies', async () => {
  for (const failure of ['resumeThrow', 'resumeFailure', 'contextThrow', 'noContext', 'startFailure']) {
    const f = fixture({ [failure]: true });
    assert.equal(await f.player.play('fuse'), false, failure);
    assert.equal(f.player.nodes.size, 0);
    assert.equal(f.player.sources.size, 0);
    await f.player.close();
  }
  for (const failure of ['fetchFailure', 'httpFailure', 'decodeFailure', 'emptyAsset']) {
    const f = fixture({ [failure]: 'blast.wav' });
    assert.equal(await f.player.prepare(), false);
    assert.equal(await f.player.play('explosion'), false);
    assert.equal(await f.player.play('restore'), true, 'a damaged optional cue does not silence other phases');
    assert.equal(f.calls.fetch.length, 4, 'failed resources are not retried continuously');
    await f.player.close();
  }
});

test('optional audio has bounded waits for hung resume, resource and close promises', async () => {
  const f = fixture({ resumeDeferred: true, timeoutMs: 15 });
  assert.equal(await f.player.play('fuse'), false);
  assert.equal(f.calls.sources.length, 0);
  await f.player.close();
  const g = fixture({ fetchDeferred: true, timeoutMs: 15 });
  assert.equal(await g.player.play('explosion'), false);
  assert.equal(await g.player.prepare(), false);
  assert.ok(g.calls.fetch.every(call => call.signal.aborted));
  g.fetch.resolve();
  await settle();
  assert.equal(g.player.buffers.size, 0, 'timed-out decode cannot populate the cache late');
  await g.player.close();
  const h = fixture({ closeDeferred: true, timeoutMs: 15 });
  await h.player.prepare();
  assert.equal(await h.player.close(), false);
  assert.equal(h.player.buffers.size, 0);
});

test('an unrelated slow sample does not delay a phase with decoded audio', async () => {
  const f = fixture({ fetchDeferredName: 'fuse.wav' });
  const preparation = f.player.prepare();
  assert.equal(await f.player.play('explosion'), true);
  assert.equal(f.player.buffers.has('fuse'), false);
  assert.equal(f.calls.sources[0].buffer.name, 'blast.wav');
  await f.player.close();
  assert.equal(await preparation, false);
  f.fetch.resolve();
});

test('fallback without stereo panner still cleans up and ignores unsupported cue kinds', async () => {
  const f = fixture({ noPanner: true });
  assert.equal(await f.player.play('music'), false);
  assert.equal(f.calls.create, 0);
  assert.equal(await f.player.play('explosion', { pan: NaN, strength: NaN }), true);
  const source = f.calls.sources[0];
  source.end();
  assert.equal(f.player.nodes.size, 0);
  assert.equal(f.calls.nodes.find(n => n.type === 'gain').gain.value, 0.5);
  await f.player.close();
});
