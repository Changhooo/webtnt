'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas } = require('@napi-rs/canvas');
const { BlastEngine, poseAt } = require('../extension/engine.js');

function makeScene() {
  const canvas = createCanvas(1000, 680);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#edf0f5'; ctx.fillRect(0, 0, 1000, 680);
  ctx.fillStyle = '#253054'; ctx.fillRect(0, 0, 1000, 76);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 24px sans-serif'; ctx.fillText('TNT — YOUR LIVE PAGE', 45, 48);
  ctx.fillStyle = '#fff';
  ctx.fillRect(35, 106, 250, 510); ctx.fillRect(315, 106, 650, 160);
  ctx.fillRect(315, 290, 305, 290); ctx.fillRect(645, 290, 320, 290);
  ctx.fillStyle = '#778196'; ctx.font = '18px sans-serif';
  ['Dashboard', 'Projects', 'Messages', 'Analytics', 'Settings', 'Activity', 'Profile', 'Support'].forEach((label, i) => ctx.fillText(label, 65, 160 + i * 52));
  ctx.fillStyle = '#27324c'; ctx.font = 'bold 32px sans-serif'; ctx.fillText('A page that can explode.', 346, 166);
  ctx.fillStyle = '#737e90'; ctx.font = '18px sans-serif'; ctx.fillText('Real text, pictures and buttons become flying fragments.', 346, 207);
  const image = ctx.createLinearGradient(343, 323, 592, 456);
  image.addColorStop(0, '#a6ded5'); image.addColorStop(1, '#5aaa91');
  ctx.fillStyle = image; ctx.fillRect(343, 323, 249, 133);
  ctx.fillStyle = '#314c5d'; ctx.beginPath(); ctx.moveTo(343, 456); ctx.lineTo(440, 356); ctx.lineTo(521, 412); ctx.lineTo(553, 370); ctx.lineTo(592, 456); ctx.fill();
  ctx.fillStyle = '#fff4da'; ctx.beginPath(); ctx.arc(552, 350, 14, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#27324c'; ctx.font = 'bold 23px sans-serif'; ctx.fillText('Latest project', 345, 495);
  ctx.fillStyle = '#768396'; ctx.font = '16px sans-serif'; ctx.fillText('Saved and still running underneath', 345, 526);
  ctx.fillStyle = '#4b6bef'; ctx.fillRect(675, 452, 162, 52);
  ctx.fillStyle = 'white'; ctx.font = 'bold 18px sans-serif'; ctx.fillText('Keep working', 697, 485);
  ctx.fillStyle = '#ed966b'; for (let i = 0; i < 6; i++) ctx.fillRect(675 + i * 38, 420 - 18 * i, 23, 18 * i + 8);
  return canvas;
}

function pixel(data, width, x, y) {
  const offset = (y * width + x) * 4;
  return Array.from(data.subarray(offset, offset + 4));
}

test('native Canvas preserves original image detail, reassembles crop-scaled pixels, and clears cleanly', () => {
  const scene = makeScene();
  const original = scene.toBuffer('image/png');
  const imageRect = { x: 280, y: 60, width: 500, height: 500 };
  const texture = createCanvas(1000, 1000);
  texture.getContext('2d').drawImage(scene, imageRect.x, imageRect.y, imageRect.width, imageRect.height, 0, 0, 1000, 1000);
  const overlay = createCanvas(1000, 680);
  overlay.clientWidth = 1000; overlay.clientHeight = 680;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  const engine = new BlastEngine(overlay);
  engine.start({ texture, imageRect, center: { x: 530, y: 310 }, radius: 250, seed: 513, createCanvas });
  assert.ok(engine.fragments.every((fragment) => fragment.raster), 'all fragments cache their original pixels once');
  assert.ok(engine.fragments.every((fragment) => fragment.shadowRaster && fragment.edgeRaster), 'soft projections and thickness silhouettes are baked once');
  assert.ok(engine.craterRaster, 'the image and broken outline are precomposited once');
  assert.equal(engine.smokeSprites.length, 3, 'smoke uses reusable gradient sprites');
  const sheet = createCanvas(1500, 740);
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#141c2d'; ctx.fillRect(0, 0, 1500, 740);
  const times = [0, 140, 900, 2800, 3675, 3835];
  for (let i = 0; i < times.length; i++) {
    engine.render(times[i]);
    const x = i % 3 * 500; const y = Math.floor(i / 3) * 370;
    ctx.drawImage(scene, x, y + 27, 500, 340); ctx.drawImage(overlay, x, y + 27, 500, 340);
    ctx.fillStyle = 'white'; ctx.font = '15px sans-serif'; ctx.fillText(`${times[i]} ms`, x + 12, y + 20);
  }
  const directory = path.join(__dirname, 'output');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'engine-phases.png'), sheet.toBuffer('image/png'));

  engine.render(2800);
  const holding = overlay.getContext('2d').getImageData(0, 0, 1000, 680).data;
  const crater = pixel(holding, 1000, 530, 310);
  assert.ok(crater[0] < 70 && crater[1] < 70 && crater[2] < 70 && crater[3] === 255, 'blast center conceals the original scene');
  let mountainPixels = 0;
  let nearMountainPixels = 0;
  let buttonPixels = 0;
  for (let i = 0; i < holding.length; i += 4) {
    if (Math.abs(holding[i] - 49) < 3 && Math.abs(holding[i + 1] - 76) < 3 && Math.abs(holding[i + 2] - 93) < 3 && holding[i + 3] > 240) {
      mountainPixels++;
      const x = (i / 4) % 1000;
      const y = Math.floor(i / 4 / 1000);
      if (Math.hypot(x - 530, y - 310) < 175) nearMountainPixels++;
    }
    if (Math.abs(holding[i] - 75) < 7 && Math.abs(holding[i + 1] - 107) < 7 && Math.abs(holding[i + 2] - 239) < 7 && holding[i + 3] > 240) buttonPixels++;
  }
  assert.ok(mountainPixels > 500, 'image fragments retain their actual source image colors');
  assert.ok(nearMountainPixels > 100, 'some original image debris visibly lands inside the crater rather than only on its rim');
  assert.ok(buttonPixels > 200, 'button fragments retain their actual source button colors');

  engine.render(3850);
  const composite = createCanvas(1000, 680);
  const compositeCtx = composite.getContext('2d');
  compositeCtx.drawImage(scene, 0, 0); compositeCtx.drawImage(overlay, 0, 0);
  const expected = scene.getContext('2d').getImageData(0, 0, 1000, 680).data;
  const actual = compositeCtx.getImageData(0, 0, 1000, 680).data;
  let delta = 0;
  for (let i = 0; i < actual.length; i += 4) {
    delta += Math.abs(expected[i] - actual[i]) + Math.abs(expected[i + 1] - actual[i + 1]) + Math.abs(expected[i + 2] - actual[i + 2]);
  }
  assert.ok(delta / (1000 * 680 * 3) < 0.5, 'restored screen matches the capture despite cropping, scaling and irregular boundaries');
  assert.deepEqual(scene.toBuffer('image/png'), original, 'source pixels are never changed');
  const benchmarkStarted = performance.now();
  for (let i = 0; i < 20; i++) engine.render(1000 + i * 73);
  console.log(`Native Canvas average render: ${((performance.now() - benchmarkStarted) / 20).toFixed(2)} ms over 20 hold frames (not browser FPS).`);
  const raster = engine.fragments[0].raster.canvas;
  const edge = engine.fragments[0].edgeRaster.canvas;
  const shadow = engine.fragments[0].shadowRaster.canvas;
  const craterCache = engine.craterRaster.canvas;
  const smoke = engine.smokeSprites[0];
  engine.stop();
  assert.equal(raster.width, 1, 'stop releases cached fragment pixel buffers');
  assert.equal(edge.width, 1, 'stop releases thickness sprites');
  assert.equal(shadow.width, 1, 'stop releases soft shadow sprites');
  assert.equal(craterCache.width, 1, 'stop releases the background and broken rim cache');
  assert.equal(engine.craterRaster, null, 'the cached background reference is discarded');
  assert.equal(engine.craterShape, null, 'stop releases the outline and fracture geometry');
  assert.equal(smoke.width, 1, 'stop releases cached smoke pixel buffers');
  const cleared = overlay.getContext('2d').getImageData(0, 0, 1000, 680).data;
  for (let i = 3; i < cleared.length; i += 4) assert.equal(cleared[i], 0, 'stop clears every overlay pixel');
  delete globalThis.requestAnimationFrame;
  delete globalThis.cancelAnimationFrame;
});

test('the small opening exposes the page outside its boundary and custom images stay bright and proportional', () => {
  const scene = makeScene();
  const overlay = createCanvas(1000, 680);
  overlay.clientWidth = 1000; overlay.clientHeight = 680;
  const engine = new BlastEngine(overlay);
  const config = { texture: scene, imageRect: { x: 0, y: 0, width: 1000, height: 680 }, center: { x: 530, y: 310 }, radius: 250, seed: 513, createCanvas };
  const context = overlay.getContext('2d');
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  engine.start(config);
  context.clearRect(0, 0, 1000, 680);
  engine.drawCrater(2800, 0);
  let pixels = context.getImageData(0, 0, 1000, 680).data;
  assert.equal(pixel(pixels, 1000, 530, 310)[3], 255, 'the smaller default crater still conceals its center');
  assert.equal(pixel(pixels, 1000, 730, 310)[3], 0, 'the old large burn area now reveals the live page outside the small opening');
  assert.equal(pixel(pixels, 1000, 600, 310)[3], 255, 'the protected image core remains solid');
  const expectBrokenEdge = (data) => {
    const reaches = [];
    let hardDirections = 0;
    for (let direction = 0; direction < 36; direction++) {
      const angle = direction / 36 * Math.PI * 2;
      const alphaAt = (distance) => pixel(data, 1000, Math.round(530 + Math.cos(angle) * distance), Math.round(310 + Math.sin(angle) * distance))[3];
      let reach = 0;
      for (let distance = 50; distance <= 170; distance++) if (alphaAt(distance) >= 250) reach = distance;
      reaches.push(reach);
      let translucentOutside = 0;
      for (let distance = reach + 1; distance <= reach + 20; distance++) if (alphaAt(distance) > 0 && alphaAt(distance) < 250) translucentOutside++;
      if (translucentOutside < 6) hardDirections++;
    }
    assert.ok(hardDirections >= 30, 'broken boundary directions have solid cuts with normal pixel antialiasing; only sparse outward crack marks interrupt them');
    assert.ok(Math.max(...reaches) - Math.min(...reaches) > 35, 'different directions have substantially different broken boundary distances');
  };
  expectBrokenEdge(pixels);

  // The wide source has red/blue sides and a circular marker in its green center.
  // Correct cover cropping excludes the sides; a stretched image includes them or distorts the marker.
  const backgroundImage = createCanvas(600, 200);
  const imageContext = backgroundImage.getContext('2d');
  imageContext.fillStyle = '#ff3b45'; imageContext.fillRect(0, 0, 200, 200);
  imageContext.fillStyle = '#5bc99a'; imageContext.fillRect(200, 0, 200, 200);
  imageContext.fillStyle = '#3366ff'; imageContext.fillRect(400, 0, 200, 200);
  imageContext.fillStyle = '#fce86b'; imageContext.beginPath(); imageContext.arc(300, 100, 22, 0, Math.PI * 2); imageContext.fill();
  const originalBackground = backgroundImage.toBuffer('image/png');
  engine.start({ ...config, backgroundImage });
  context.clearRect(0, 0, 1000, 680);
  engine.drawCrater(2800, 0);
  pixels = context.getImageData(0, 0, 1000, 680).data;
  assert.deepEqual(pixel(pixels, 1000, 530, 310), [252, 232, 107, 255], 'custom image center remains at full source brightness');
  assert.deepEqual(pixel(pixels, 1000, 460, 310), [91, 201, 154, 255], 'wide images crop their left side rather than stretching');
  assert.deepEqual(pixel(pixels, 1000, 600, 310), [91, 201, 154, 255], 'wide images crop their right side rather than stretching');
  assert.equal(pixel(pixels, 1000, 730, 310)[3], 0, 'custom image stays confined to the small opening');
  expectBrokenEdge(pixels);
  const isMarker = (color) => color[0] > 240 && color[1] > 220 && color[2] < 120 && color[3] === 255;
  let horizontal = 0;
  let vertical = 0;
  for (let offset = -120; offset <= 120; offset++) {
    if (isMarker(pixel(pixels, 1000, 530 + offset, 310))) horizontal++;
    if (isMarker(pixel(pixels, 1000, 530, 310 + offset))) vertical++;
  }
  assert.ok(horizontal > 65 && Math.abs(horizontal - vertical) <= 2, 'a circular feature remains circular after cover scaling');
  context.clearRect(0, 0, 1000, 680);
  engine.drawCrater(2800, 0.93);
  assert.ok(pixel(context.getImageData(0, 0, 1000, 680).data, 1000, 530, 310)[3] < 255, 'custom images fade naturally during restoration');
  context.clearRect(0, 0, 1000, 680);
  engine.drawCrater(3850, 1);
  assert.equal(pixel(context.getImageData(0, 0, 1000, 680).data, 1000, 530, 310)[3], 0, 'no custom image remains after exact return');
  engine.stop();
  assert.deepEqual(backgroundImage.toBuffer('image/png'), originalBackground, 'background pixels remain reusable after stop');
  delete globalThis.requestAnimationFrame;
  delete globalThis.cancelAnimationFrame;
});

test('a moving fragment casts a visible soft projection beyond its shape, which vanishes at rest and return', () => {
  const scene = makeScene();
  const overlay = createCanvas(1000, 680);
  overlay.clientWidth = 1000; overlay.clientHeight = 680;
  const engine = new BlastEngine(overlay);
  const options = { texture: scene, imageRect: { x: 0, y: 0, width: 1000, height: 680 }, center: { x: 530, y: 310 }, radius: 250, seed: 513, createCanvas };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  engine.start(options);
  const fragment = engine.fragments.find((piece) => {
    const pose = poseAt(piece, 1000, options);
    return piece.radial < 0.65 && piece.bounds.width > 25 && pose.x > 120 && pose.x < 800 && pose.y > 100 && pose.y < 530 && Math.hypot(pose.x - piece.x, pose.y - piece.y) > 70;
  });
  assert.ok(fragment, 'the fixture includes a moving piece with a clear cast shadow');
  const context = overlay.getContext('2d');
  const pose = poseAt(fragment, 1000, options);
  context.clearRect(0, 0, 1000, 680);
  engine.drawFragmentShadow(fragment, pose, 1000);
  const shadowPixels = context.getImageData(0, 0, 1000, 680).data;
  const body = createCanvas(1000, 680), bodyContext = body.getContext('2d');
  bodyContext.translate(pose.x, pose.y); bodyContext.rotate(pose.rotation); bodyContext.scale(pose.scale, pose.scale);
  const raster = fragment.raster;
  bodyContext.drawImage(raster.canvas, raster.x - fragment.x, raster.y - fragment.y, raster.width, raster.height);
  const bodyPixels = bodyContext.getImageData(0, 0, 1000, 680).data;
  let visibleOutside = 0;
  let softOutside = 0;
  for (let i = 0; i < shadowPixels.length; i += 4) {
    if (bodyPixels[i + 3] < 5 && shadowPixels[i + 3] > 20 && shadowPixels[i] < 45 && shadowPixels[i + 1] < 45 && shadowPixels[i + 2] < 45) visibleOutside++;
    if (bodyPixels[i + 3] < 5 && shadowPixels[i + 3] > 3 && shadowPixels[i + 3] < 20) softOutside++;
  }
  assert.ok(visibleOutside > 100, 'the cast shadow visibly extends well beyond the fragment instead of hiding entirely under it');
  assert.ok(softOutside > 40, 'the outside projection also contains a soft, translucent fringe');
  for (const elapsed of [0, 3850]) {
    context.clearRect(0, 0, 1000, 680);
    engine.drawFragmentShadow(fragment, poseAt(fragment, elapsed, options), elapsed);
    const pixels = context.getImageData(0, 0, 1000, 680).data;
    assert.ok(pixels.every((value) => value === 0), 'projection is completely absent at rest and precise return');
  }
  engine.stop();
  delete globalThis.requestAnimationFrame;
  delete globalThis.cancelAnimationFrame;
});

test('a flat page does not acquire a static circular shadow seam around the impact perimeter', () => {
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  for (const seed of [513, 12581, 1]) {
    const scene = createCanvas(1000, 760), sceneContext = scene.getContext('2d');
    sceneContext.fillStyle = '#fff'; sceneContext.fillRect(0, 0, 1000, 760);
    const overlay = createCanvas(1000, 760);
    overlay.clientWidth = 1000; overlay.clientHeight = 760;
    const engine = new BlastEngine(overlay);
    const config = { texture: scene, imageRect: { x: 0, y: 0, width: 1000, height: 760 }, center: { x: 500, y: 380 }, radius: 250, seed, createCanvas };
    engine.start(config);
    engine.render(2800);
    const composite = createCanvas(1000, 760), context = composite.getContext('2d');
    context.drawImage(scene, 0, 0); context.drawImage(overlay, 0, 0);
    const pixels = context.getImageData(0, 0, 1000, 760).data;
    let coveredAngles = 0;
    for (let direction = 0; direction < 360; direction++) {
      const angle = direction / 180 * Math.PI;
      let dark = false;
      for (let distance = 244; distance <= 259; distance++) {
        const color = pixel(pixels, 1000, Math.round(500 + Math.cos(angle) * distance), Math.round(380 + Math.sin(angle) * distance));
        if (color[0] < 235 && color[1] < 235 && color[2] < 235) dark = true;
      }
      if (dark) coveredAngles++;
    }
    assert.ok(coveredAngles / 360 < 0.55, `seed ${seed}: isolated flying pieces may cross the perimeter, but their shadows must not outline a persistent ring (${coveredAngles}/360 directions)`);
    overlay.getContext('2d').clearRect(0, 0, 1000, 760);
    const connected = engine.fragments.find((piece) => piece.attached);
    engine.drawFragmentShadow(connected, poseAt(connected, 2800, config), 2800);
    assert.ok(overlay.getContext('2d').getImageData(0, 0, 1000, 760).data.every((value) => value === 0), 'an attached crop edge never casts an independent floating-object shadow');
    engine.render(3850);
    context.clearRect(0, 0, 1000, 760); context.drawImage(scene, 0, 0); context.drawImage(overlay, 0, 0);
    const restored = context.getImageData(0, 0, 1000, 760).data;
    assert.ok(restored.every((value) => value === 255), 'return exactly restores a flat original page with no circular seam or shadow residue');
    engine.stop();
  }
  delete globalThis.requestAnimationFrame;
  delete globalThis.cancelAnimationFrame;
});
