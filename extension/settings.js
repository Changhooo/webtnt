/* Shared by the extension UI and the render host. No page state is stored here. */
(() => {
  'use strict';
  const defaults = Object.freeze({
    radius: 250,
    strength: 1,
    craterRatio: 0.65,
    fuseMs: 800,
    scatterMs: 1000,
    holdMs: 2500,
    restoreMs: 350,
    sound: false,
    showHints: true,
  });
  const limits = Object.freeze({
    radius: [100, 450],
    strength: [0.5, 1.8],
    craterRatio: [0.35, 1],
    fuseMs: [200, 2000],
    scatterMs: [500, 1800],
    holdMs: [500, 6000],
    restoreMs: [200, 800],
  });
  function sanitize(value) {
    const source = value && typeof value === 'object' ? value : {};
    const result = {};
    for (const [key, fallback] of Object.entries(defaults)) {
      if (typeof fallback === 'boolean') {
        result[key] = typeof source[key] === 'boolean' ? source[key] : fallback;
        continue;
      }
      const candidate = typeof source[key] === 'number' ? source[key] : fallback;
      const [min, max] = limits[key];
      const bounded = Number.isFinite(candidate) ? Math.max(min, Math.min(max, candidate)) : fallback;
      result[key] = key === 'strength' || key === 'craterRatio' ? Math.round(bounded * 100) / 100 : Math.round(bounded);
    }
    return result;
  }
  globalThis.TNTSettings = Object.freeze({ defaults, sanitize });
})();
