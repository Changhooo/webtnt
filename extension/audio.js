/* Local sound effects only. The animation owns phase timing; audio never delays it. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TNTAudio = api;
})(globalThis, function () {
  'use strict';
  const FILES = Object.freeze({ ignite: 'ignite.wav', fuse: 'fuse.wav', explosion: 'blast.wav', restore: 'restore.wav' });
  const clamp = (value, minimum, maximum, fallback) => Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback;
  const defaultContext = () => {
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    return typeof Context === 'function' ? new Context() : null;
  };

  class Player {
    constructor(options = {}) {
      this.resolveURL = options.resolveURL || (filename => globalThis.chrome?.runtime?.getURL(`assets/audio/${filename}`));
      this.createContext = options.createContext || defaultContext;
      this.fetchResource = options.fetchResource || ((url, init) => globalThis.fetch(url, init));
      this.timeoutMs = clamp(options.timeoutMs, 10, 10000, 3000);
      this.context = null;
      this.closed = false;
      this.unavailable = false;
      this.buffers = new Map();
      this.loading = new Map();
      this.nodes = new Set();
      this.sources = new Set();
      this.pending = new Set();
      this.generation = 0;
      this.preparation = null;
      this.closing = null;
    }

    _context() {
      if (this.closed || this.unavailable) return null;
      if (this.context) return this.context;
      try {
        this.context = this.createContext();
        if (!this.context || typeof this.context.decodeAudioData !== 'function' || this.context.state === 'closed') {
          this.unavailable = true;
          return null;
        }
        return this.context;
      } catch (_) {
        this.unavailable = true;
        return null;
      }
    }

    // Decode, network and autoplay failures resolve to null. A suspended context
    // that never settles cannot keep an optional cue or close() pending forever.
    _bounded(operation, abort) {
      if (this.closed) { abort?.(); return Promise.resolve(null); }
      return new Promise(resolve => {
        let finished = false;
        let timer;
        const finish = value => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          this.pending.delete(cancel);
          resolve(value);
        };
        const cancel = () => { try { abort?.(); } catch (_) {} finish(null); };
        this.pending.add(cancel);
        timer = setTimeout(cancel, this.timeoutMs);
        Promise.resolve(operation).then(finish, () => finish(null));
      });
    }

    async _load(kind, context) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const operation = (async () => {
        const url = this.resolveURL(FILES[kind]);
        if (typeof url !== 'string' || !url) return null;
        const response = await this.fetchResource(url, controller ? { signal: controller.signal } : {});
        if (this.closed || !response || !response.ok || typeof response.arrayBuffer !== 'function') return null;
        const bytes = await response.arrayBuffer();
        // The bundled WAVs are small. Bound bad or replaced resources as well.
        if (this.closed || !bytes || !bytes.byteLength || bytes.byteLength > 2 * 1024 * 1024) return null;
        const buffer = await context.decodeAudioData(bytes);
        return buffer && Number.isFinite(buffer.duration) && buffer.duration > 0 && buffer.duration <= 10 ? buffer : null;
      })();
      const buffer = await this._bounded(operation, () => controller?.abort());
      if (buffer && !this.closed && this.context === context) this.buffers.set(kind, buffer);
      return !!buffer && !this.closed;
    }

    prepare() {
      const context = this._context();
      if (!context) return Promise.resolve(false);
      if (!this.preparation) {
        this.preparation = Promise.all(Object.keys(FILES).map(kind => {
          const loading = this._load(kind, context);
          this.loading.set(kind, loading);
          return loading;
        }))
          .then(results => !this.closed && results.every(Boolean), () => false);
      }
      return this.preparation;
    }

    _disconnect(node) {
      if (!node) return;
      try { node.disconnect(); } catch (_) {}
      this.nodes.delete(node);
    }

    _route(context, options) {
      const gain = context.createGain();
      this.nodes.add(gain);
      // Leave room for the ignite + fuse overlap and the low-frequency blast.
      gain.gain.setValueAtTime(0.5 * Math.sqrt(clamp(options.strength, 0.5, 1.8, 1)), context.currentTime);
      let panner = null;
      if (typeof context.createStereoPanner === 'function') {
        panner = context.createStereoPanner();
        this.nodes.add(panner);
        panner.pan.setValueAtTime(clamp(options.pan, -1, 1, 0), context.currentTime);
        gain.connect(panner);
        panner.connect(context.destination);
      } else gain.connect(context.destination);
      return { gain, panner, remaining: 0 };
    }

    _source(context, kind, route, options = {}) {
      const buffer = this.buffers.get(kind);
      if (!buffer) return false;
      const source = context.createBufferSource();
      const gain = context.createGain();
      this.nodes.add(source);
      this.nodes.add(gain);
      this.sources.add(source);
      route.remaining++;
      source.buffer = buffer;
      source.loop = !!options.loop;
      source.playbackRate.setValueAtTime(options.rate || 1, context.currentTime);
      gain.gain.setValueAtTime(options.volume ?? 1, context.currentTime);
      source.connect(gain);
      gain.connect(route.gain);
      let ended = false;
      source.onended = () => {
        if (ended) return;
        ended = true;
        source.onended = null;
        this.sources.delete(source);
        this._disconnect(source);
        this._disconnect(gain);
        route.remaining--;
        if (!route.remaining) { this._disconnect(route.gain); this._disconnect(route.panner); }
      };
      source.start(options.when ?? context.currentTime);
      return true;
    }

    async play(kind, options = {}) {
      if (this.closed || !['fuse', 'explosion', 'restore'].includes(kind)) return false;
      this.stopAll();
      const generation = this.generation;
      const context = this._context();
      if (!context) return false;
      let resumed;
      try {
        // Call resume before the first await, while still in the pointer gesture.
        resumed = context.state === 'running' ? Promise.resolve(true) : Promise.resolve(context.resume()).then(() => true);
      } catch (_) { return false; }
      const required = kind === 'fuse' ? ['ignite', 'fuse'] : [kind];
      this.prepare();
      // A missing, slow optional cue must not delay a different phase whose
      // samples are ready. Preloading still shares the same per-asset promises.
      const [ready, prepared] = await Promise.all([
        this._bounded(resumed),
        Promise.all(required.map(name => this.loading.get(name) || false)).then(results => results.every(Boolean)),
      ]);
      if (!ready || !prepared || this.closed || generation !== this.generation || context.state !== 'running') return false;
      if (!required.every(name => this.buffers.has(name))) return false;
      try {
        const route = this._route(context, options);
        if (kind === 'fuse') {
          this._source(context, 'ignite', route, { volume: 0.8 });
          this._source(context, 'fuse', route, { loop: true, volume: 0.5, when: context.currentTime + 0.04 });
        } else if (kind === 'restore') {
          // Retiming the whole sample keeps its final assembly transient; slicing
          // it at restoreMs would remove that finish, especially at 200 ms.
          const seconds = clamp(options.restoreMs, 200, 800, 350) / 1000;
          this._source(context, kind, route, { rate: this.buffers.get(kind).duration / seconds });
        } else this._source(context, kind, route);
        return true;
      } catch (_) { this.stopAll(); return false; }
    }

    stopAll() {
      ++this.generation;
      for (const source of this.sources) {
        source.onended = null;
        try { source.stop(); } catch (_) {}
      }
      this.sources.clear();
      for (const node of this.nodes) { try { node.disconnect(); } catch (_) {} }
      this.nodes.clear();
    }

    close() {
      if (this.closing) return this.closing;
      if (this.closed) return Promise.resolve(true);
      this.closed = true;
      this.stopAll();
      for (const cancel of [...this.pending]) cancel();
      this.buffers.clear();
      this.loading.clear();
      this.preparation = null;
      const context = this.context;
      this.context = null;
      try {
        // close() can be idempotent even if the browser rejects or never settles.
        this.closing = context && context.state !== 'closed' && typeof context.close === 'function'
          ? new Promise(resolve => {
            let finished = false;
            const finish = value => {
              if (finished) return;
              finished = true;
              clearTimeout(timer);
              resolve(value);
            };
            const timer = setTimeout(() => finish(false), this.timeoutMs);
            try { Promise.resolve(context.close()).then(() => finish(true), () => finish(false)); }
            catch (_) { finish(false); }
          })
          : Promise.resolve(true);
      } catch (_) { this.closing = Promise.resolve(false); }
      return this.closing;
    }
  }
  return Object.freeze({ Player });
});
