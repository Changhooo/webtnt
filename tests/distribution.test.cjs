'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFragments, poseAt } = require('../extension/engine.js');

function largestRadialBand(radii, width) {
  const sorted = [...radii].sort((a, b) => a - b);
  let maximum = 0;
  for (let left = 0, right = 0; left < sorted.length; left++) {
    while (right < sorted.length && sorted[right] - sorted[left] <= width) right++;
    maximum = Math.max(maximum, right - left);
  }
  return maximum / sorted.length;
}

test('detached scene pieces occupy varied distances and directions during the hold', () => {
  // Test the visible outcome through the public trajectory API. Do not require
  // a particular random generator, impulse formula, scatter band, or exact pose.
  // Crop-boundary pieces remain part of the live page rather than detached objects.
  // Evaluate the visible detached set inside the quiet outer border.
  for (const radius of [140, 250, 420]) {
    for (const seed of [7, 12581, 2026]) {
      const center = { x: radius * 2, y: radius * 2 };
      const options = {
        center, radius, seed,
        imageRect: { x: 0, y: 0, width: radius * 4, height: radius * 4 },
        scatterMs: 1000, holdMs: 2500, restoreMs: 350
      };
      const pieces = createFragments(options).filter(piece =>
        !piece.attached && Math.hypot(piece.x - center.x, piece.y - center.y) < radius * 0.9
      );
      assert.ok(pieces.length > 60, 'enough detached pieces to assess a scene');
      const positions = pieces.map(piece => poseAt(piece, 1600, options));
      assert.ok(positions.every(pose => Number.isFinite(pose.x) && Number.isFinite(pose.y)));
      const radii = positions.map(pose => Math.hypot(pose.x - center.x, pose.y - center.y) / radius);
      const sorted = [...radii].sort((a, b) => a - b);
      const span = sorted[Math.floor((sorted.length - 1) * 0.9)] - sorted[Math.floor((sorted.length - 1) * 0.1)];
      const label = `radius ${radius}, seed ${seed}`;
      assert.ok(span > 0.35, `${label}: most pieces need visibly different distances; central 80% span ${span.toFixed(3)} R`);
      const band = largestRadialBand(radii, 0.3);
      assert.ok(band < 0.78, `${label}: ${Math.round(band * 100)}% of pieces form one thin ring`);
      const quadrants = [0, 0, 0, 0];
      for (const pose of positions) {
        const x = pose.x - center.x, y = pose.y - center.y;
        quadrants[(x >= 0 ? 1 : 0) + (y >= 0 ? 2 : 0)]++;
      }
      assert.ok(quadrants.filter(count => count >= pieces.length * 0.05).length >= 3,
        `${label}: spread should occupy several directions without demanding perfect symmetry`);
    }
  }
});
