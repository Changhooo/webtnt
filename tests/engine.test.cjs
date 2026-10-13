'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFragments, poseAt, BlastEngine, createCraterShape } = require('../extension/engine.js');

const options = {
  center: { x: 350, y: 300 },
  radius: 250,
  imageRect: { x: 100, y: 50, width: 500, height: 500 },
  scatterMs: 1000,
  holdMs: 2500,
  restoreMs: 350,
  seed: 12581
};

function area(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const next = points[(i + 1) % points.length];
    sum += points[i].x * next.y - next.x * points[i].y;
  }
  return Math.abs(sum) / 2;
}

function close(a, b, tolerance = 1e-7) {
  assert.ok(Math.abs(a - b) <= tolerance, `${a} is not within ${tolerance} of ${b}`);
}

test('broken openings are reproducible, asymmetric, concave and confined without changing the image core', () => {
  const center = { x: 350, y: 300 };
  const radius = 162.5;
  const contains = (points, x, y) => {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i], b = points[j];
      if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  };
  for (const seed of [513, 12581, 1, 9281]) {
    const config = { center, radius, seed };
    const shape = createCraterShape(config);
    assert.deepEqual(shape, createCraterShape(config), 'a fixed seed gives the exact same torn outline and fracture marks');
    assert.notDeepEqual(shape, createCraterShape({ ...config, seed: seed + 1 }), 'different seeds vary the missing corners and crack placement');
    const reaches = shape.outline.map((point) => Math.hypot(point.x - center.x, point.y - center.y));
    assert.ok(Math.max(...reaches) <= radius, 'the broken background never exceeds the selected opening size');
    assert.ok(Math.max(...reaches) - Math.min(...reaches) > radius * 0.2, 'the boundary has substantial missing chunks rather than a nearly circular rim');
    let inwardCorners = 0;
    for (let i = 0; i < shape.outline.length; i++) {
      const a = shape.outline[i], b = shape.outline[(i + 1) % shape.outline.length], c = shape.outline[(i + 2) % shape.outline.length];
      if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) < -1) inwardCorners++;
    }
    assert.ok(inwardCorners >= 3, 'the outline includes actual inward dents and torn corners');
    for (let i = 0; i < 72; i++) assert.ok(contains(shape.outline, center.x + Math.cos(i / 72 * Math.PI * 2) * radius * 0.5, center.y + Math.sin(i / 72 * Math.PI * 2) * radius * 0.5), 'the recognizable center of the selected picture remains intact');
    for (const crack of shape.cracks) {
      assert.ok(crack.points.every((point) => Math.hypot(point.x - center.x, point.y - center.y) > radius * 0.5), 'cracks stay near the rim rather than obscuring the image center');
      assert.ok(crack.outer.every((point) => Math.hypot(point.x - center.x, point.y - center.y) <= radius), 'residual page fractures also stay inside the selected size');
    }
  }
});

test('irregular pieces exactly cover the original impact circle with a bounded count', () => {
  const pieces = createFragments(options);
  assert.ok(pieces.length >= 160 && pieces.length <= 260);
  const coveredArea = pieces.reduce((sum, piece) => sum + area(piece.points), 0);
  const discArea = 64 / 2 * options.radius ** 2 * Math.sin(2 * Math.PI / 64);
  close(coveredArea, discArea, 1e-6);
  for (const piece of pieces) {
    assert.ok(piece.points.length >= 3);
    for (const point of piece.points) {
      assert.ok(Math.hypot(point.x - options.center.x, point.y - options.center.y) <= options.radius + 1e-7);
      assert.ok(point.x >= options.imageRect.x - 1e-7 && point.x <= options.imageRect.x + options.imageRect.width + 1e-7);
      assert.ok(point.y >= options.imageRect.y - 1e-7 && point.y <= options.imageRect.y + options.imageRect.height + 1e-7);
    }
  }
});

test('the screen edge and very thin capture crops never exceed the fragment budget', () => {
  for (const rectangle of [
    { x: 350, y: 300, width: 250, height: 250 },
    { x: 100, y: 299.99, width: 500, height: 0.02 },
    { x: 349.99, y: 50, width: 0.02, height: 500 }
  ]) {
    const pieces = createFragments({ ...options, imageRect: rectangle });
    assert.ok(pieces.length > 0 && pieces.length <= 260);
    assert.ok(pieces.every((piece) => Number.isFinite(piece.x) && Number.isFinite(piece.y)));
  }
  assert.deepEqual(createFragments({ ...options, imageRect: { x: 1000, y: 1000, width: 50, height: 50 } }), []);
});

test('the crop perimeter remains attached while enough inner scene pieces can scatter', () => {
  for (const radius of [140, 250, 420]) {
    const config = { ...options, radius, center: { x: radius * 2, y: radius * 2 }, imageRect: { x: 0, y: 0, width: radius * 4, height: radius * 4 } };
    const pieces = createFragments(config);
    const attached = pieces.filter((piece) => piece.attached);
    const detached = pieces.filter((piece) => !piece.attached);
    assert.ok(attached.length > 20, 'the exposed outer crop is treated as connected material');
    assert.ok(detached.length >= 150, 'the blast retains a substantial set of moving screenshot fragments');
    assert.ok(pieces.filter((piece) => piece.radial < 0.7).every((piece) => !piece.attached), 'central fragment effects are not disabled to hide the perimeter problem');
    assert.ok(detached.every((piece) => piece.points.every((point) => Math.hypot(point.x - config.center.x, point.y - config.center.y) < radius)), 'no detached piece carries the continuous circle crop arc');
  }
});

test('every piece starts exactly in place and returns to the same pose', () => {
  for (const piece of createFragments(options)) {
    const initial = poseAt(piece, 0, options);
    const restored = poseAt(piece, 3850, options);
    assert.deepEqual(initial, { x: piece.x, y: piece.y, rotation: 0, scale: 1, opacity: 1, movement: 0 });
    assert.deepEqual(restored, initial);
    assert.deepEqual(poseAt(piece, 60000, options), initial);
  }
});

test('scatter, hold and restore transitions are continuous', () => {
  for (const piece of createFragments(options)) {
    for (const boundary of [1000, 3500, 3850]) {
      const before = poseAt(piece, boundary - 1e-5, options);
      const after = poseAt(piece, boundary + 1e-5, options);
      for (const key of ['x', 'y', 'rotation', 'scale', 'opacity', 'movement']) close(before[key], after[key], 1e-4);
    }
    for (const time of [50, 400, 900, 1200, 3500, 3700]) {
      const pose = poseAt(piece, time, options);
      assert.ok(Object.values(pose).every(Number.isFinite));
      assert.ok(pose.scale > 0 && pose.opacity === 1);
    }
  }
});

test('shock propagation reaches outer pieces later than inner pieces', () => {
  const pieces = createFragments(options);
  const inner = pieces.reduce((a, b) => a.radial < b.radial ? a : b);
  const outer = pieces.reduce((a, b) => a.radial > b.radial ? a : b);
  assert.ok(inner.delay < outer.delay);
  assert.equal(poseAt(outer, 50, options).movement, 0);
  assert.ok(poseAt(inner, 50, options).movement > 0);
});

test('outermost fragments get a restrained nudge rather than the central blast strength', () => {
  const pieces = createFragments(options);
  const outer = pieces.filter((piece) => piece.radial > 0.94);
  const inner = pieces.filter((piece) => piece.radial < 0.2);
  assert.ok(outer.length > 0 && inner.length > 0);
  for (const piece of outer) {
    const pose = poseAt(piece, 1000, options);
    assert.ok(Math.hypot(pose.x - piece.x, pose.y - piece.y) < options.radius * 0.11);
    assert.ok(Math.abs(pose.rotation) < 0.17);
  }
  const outerAverage = outer.reduce((sum, piece) => sum + Math.hypot(piece.dx, piece.dy + piece.gravity), 0) / outer.length;
  const innerAverage = inner.reduce((sum, piece) => sum + Math.hypot(piece.dx, piece.dy + piece.gravity), 0) / inner.length;
  assert.ok(innerAverage > outerAverage * 4, 'nearby pieces receive stronger average impact while allowing close-falling fragments');
});

test('debris occupies a broad landing field with near falls, long throws and plume gaps', () => {
  for (const seed of [513, 12581, 1, 9281, 381234]) {
    const config = { ...options, seed };
    const pieces = createFragments(config).filter((piece) => piece.radial < 0.9);
    const landings = pieces.map((piece) => poseAt(piece, 1600, config));
    const distances = landings.map((pose) => Math.hypot(pose.x - config.center.x, pose.y - config.center.y) / config.radius).sort((a, b) => a - b);
    assert.ok(distances[Math.floor(distances.length * 0.9)] - distances[Math.floor(distances.length * 0.1)] > 0.6, 'landing distances must span much more than a thin circular rim');
    let peakBand = 0;
    for (const start of distances) peakBand = Math.max(peakBand, distances.filter((distance) => distance >= start && distance < start + 0.3).length / distances.length);
    assert.ok(peakBand < 0.6, `seed ${seed}: ${peakBand} of the debris concentrated in a thin radial band`);
    assert.ok(distances.filter((distance) => distance < 0.7).length / distances.length > 0.1, 'some fragments land well inside the impact area');
    assert.ok(distances.filter((distance) => distance > 1.3).length / distances.length > 0.08, 'some fragments land beyond the impact rim');
    const quadrants = [0, 0, 0, 0];
    const outerSectors = [0, 0, 0, 0, 0, 0, 0, 0];
    for (const pose of landings) {
      const angle = (Math.atan2(pose.y - config.center.y, pose.x - config.center.x) + Math.PI * 2) % (Math.PI * 2);
      quadrants[Math.floor(angle / (Math.PI * 2) * 4)]++;
      if (Math.hypot(pose.x - config.center.x, pose.y - config.center.y) > config.radius * 1.1) outerSectors[Math.floor(angle / (Math.PI * 2) * 8)]++;
    }
    assert.ok(quadrants.every((count) => count > pieces.length * 0.08), 'the blast must still reach all directions');
    assert.ok(Math.max(...outerSectors) > Math.min(...outerSectors) * 1.8 + 1, 'long throws form uneven plumes and directional gaps');
    assert.deepEqual(createFragments(config), createFragments(config), 'a seed reproduces the complete fracture and flight field');
  }
});

function fakeCanvas() {
  const gradient = { addColorStop() {} };
  const context = new Proxy({}, {
    get(target, key) {
      if (key === 'createRadialGradient') return () => gradient;
      if (!Reflect.has(target, key)) target[key] = () => {};
      return target[key];
    }
  });
  return { width: 1, height: 1, clientWidth: 800, clientHeight: 600, getContext: () => context };
}

test('crater size and user images leave fragment trajectories unchanged and preserve image ownership', () => {
  globalThis.requestAnimationFrame = () => 12;
  globalThis.cancelAnimationFrame = () => {};
  let imageClosed = 0;
  const backgroundImage = { width: 900, height: 300, close: () => imageClosed++ };
  const engine = new BlastEngine(fakeCanvas());
  const config = { ...options, texture: { width: 1000, height: 1000 } };
  const baseline = createFragments(config);
  for (const [requested, expected] of [[undefined, 0.65], [-1, 0.35], [0.5, 0.5], [3, 1], [NaN, 0.65]]) {
    engine.start({ ...config, craterRatio: requested, backgroundImage });
    assert.equal(engine.options.craterRatio, expected);
    assert.equal(engine.options.backgroundImage, backgroundImage);
    assert.deepEqual(engine.fragments, baseline, 'a smaller opening never weakens or retargets the blast');
    engine.stop();
    assert.equal(engine.options, null, 'the engine releases its image reference after use');
    assert.equal(imageClosed, 0, 'the engine never closes the controller-owned reusable image');
  }
  delete globalThis.requestAnimationFrame;
  delete globalThis.cancelAnimationFrame;
});

test('completion clears the overlay once; manual stop never calls onComplete', () => {
  globalThis.requestAnimationFrame = () => 12;
  globalThis.cancelAnimationFrame = () => {};
  const phases = [];
  let completed = 0;
  const engine = new BlastEngine(fakeCanvas());
  const config = { ...options, texture: { width: 1000, height: 1000 }, onPhase: (phase) => phases.push(phase), onComplete: () => completed++ };
  engine.start(config);
  assert.equal(engine.running, true);
  engine.tick(engine.startedAt + 1001);
  engine.tick(engine.startedAt + 3501);
  engine.tick(engine.startedAt + 3851);
  assert.deepEqual(phases, ['scatter', 'hold', 'restore']);
  assert.equal(engine.running, false);
  assert.equal(completed, 1);
  assert.equal(engine.fragments.length, 0);
  engine.start(config);
  engine.stop();
  assert.equal(completed, 1);
  assert.equal(engine.options, null);
  engine.tick(engine.startedAt + 4000);
  assert.equal(completed, 1);
  delete globalThis.requestAnimationFrame;
  delete globalThis.cancelAnimationFrame;
});
