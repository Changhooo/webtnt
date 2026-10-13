/* TNT Blast — platform-independent, dependency-free Canvas 2D renderer. */
(function (scope) {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const mix = (a, b, amount) => a + (b - a) * amount;
  const smooth = (value) => {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  };
  const easeOut = (value) => 1 - Math.pow(1 - clamp(value, 0, 1), 3);
  const easeInOut = (value) => {
    const t = clamp(value, 0, 1);
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  };

  function randomGenerator(seed) {
    let state = seed >>> 0;
    return function () {
      state += 0x6D2B79F5;
      let x = state;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  function finite(value, fallback, min, max) {
    return clamp(Number.isFinite(value) ? value : fallback, min, max);
  }

  function timings(options) {
    return {
      scatterMs: finite(options.scatterMs, 1000, 180, 5000),
      holdMs: finite(options.holdMs, 2500, 0, 15000),
      restoreMs: finite(options.restoreMs, 350, 80, 5000)
    };
  }

  // Shared clipping boundaries keep all pieces a perfect tiling at rest.
  function clipPolygon(polygon, a, b) {
    if (!polygon.length) return polygon;
    const side = (p) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    const result = [];
    let previous = polygon[polygon.length - 1];
    let previousSide = side(previous);
    for (const current of polygon) {
      const currentSide = side(current);
      if ((currentSide >= -1e-7) !== (previousSide >= -1e-7)) {
        const fraction = previousSide / (previousSide - currentSide);
        result.push({ x: mix(previous.x, current.x, fraction), y: mix(previous.y, current.y, fraction) });
      }
      if (currentSide >= -1e-7) result.push(current);
      previous = current;
      previousSide = currentSide;
    }
    return result;
  }

  function discPolygon(center, radius) {
    return Array.from({ length: 64 }, (_, i) => ({
      x: center.x + Math.cos(i / 64 * TAU) * radius,
      y: center.y + Math.sin(i / 64 * TAU) * radius
    }));
  }

  function polygonArea(points) {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      area += a.x * b.y - b.x * a.y;
    }
    return Math.abs(area) / 2;
  }

  function createCraterShape(options) {
    const center = options.center;
    const radius = finite(options.radius, 162.5, 10, 600);
    const random = randomGenerator((options.seed === undefined ? 78231 : options.seed) ^ 0x41F3C927);
    const count = 11 + Math.floor(random() * 5);
    const phase = random() * TAU;
    const weights = Array.from({ length: count }, () => 0.28 + random() * 0.5);
    const sum = weights.reduce((total, value) => total + value, 0);
    let angle = phase;
    const anchors = weights.map((weight) => {
      const reach = radius * (0.76 + random() * 0.22);
      const point = { x: center.x + Math.cos(angle) * reach, y: center.y + Math.sin(angle) * reach };
      angle += weight / sum * TAU;
      return point;
    });
    const inset = (point, amount) => {
      const length = Math.hypot(point.x - center.x, point.y - center.y);
      const reach = Math.max(radius * 0.56, length - amount);
      return { x: center.x + (point.x - center.x) / length * reach, y: center.y + (point.y - center.y) / length * reach };
    };
    const interpolate = (a, b, fraction) => ({ x: mix(a.x, b.x, fraction), y: mix(a.y, b.y, fraction) });
    const outline = [];
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      const b = anchors[(i + 1) % anchors.length];
      outline.push(a);
      // Long intact plate edges alternate with unequal missing chips and torn corners.
      // Nonuniform chord lengths and local notch widths avoid a repeating radial star.
      if (random() < 0.32) continue;
      const entry = 0.13 + random() * 0.34;
      const width = 0.18 + random() * 0.32;
      const depth = radius * (0.055 + random() * 0.22);
      const start = interpolate(a, b, entry);
      const end = interpolate(a, b, entry + width);
      outline.push(start);
      if (random() < 0.24) {
        outline.push(inset(interpolate(start, end, 0.3 + random() * 0.4), depth));
      } else {
        outline.push(inset(start, depth * (0.68 + random() * 0.3)));
        outline.push(inset(end, depth));
      }
      outline.push(end);
      if (random() < 0.22 && entry + width < 0.68) {
        const chip = entry + width + 0.08;
        outline.push(interpolate(a, b, chip));
        outline.push(inset(interpolate(a, b, chip + 0.035), radius * (0.025 + random() * 0.045)));
        outline.push(interpolate(a, b, chip + 0.08));
      }
    }
    const cracks = [];
    for (let i = 0, length = 3 + Math.floor(random() * 3); i < length; i++) {
      const point = anchors[Math.floor(random() * anchors.length)];
      const start = inset(point, radius * 0.012);
      const toward = Math.atan2(center.y - start.y, center.x - start.x) + (random() - 0.5) * 0.9;
      const reach = radius * (0.045 + random() * 0.11);
      const middle = { x: start.x + Math.cos(toward) * reach * 0.57, y: start.y + Math.sin(toward) * reach * 0.57 };
      const kink = toward + (random() - 0.5) * 1.2;
      const end = { x: middle.x + Math.cos(kink) * reach * 0.43, y: middle.y + Math.sin(kink) * reach * 0.43 };
      const outward = toward + Math.PI + (random() - 0.5) * 0.55;
      const outerMiddle = { x: point.x + Math.cos(outward) * reach * 0.45, y: point.y + Math.sin(outward) * reach * 0.45 };
      let outerEnd = { x: outerMiddle.x + Math.cos(outward + (random() - 0.5) * 0.9) * reach * 0.55, y: outerMiddle.y + Math.sin(outward) * reach * 0.55 };
      for (const outerPoint of [outerMiddle, outerEnd]) {
        const distance = Math.hypot(outerPoint.x - center.x, outerPoint.y - center.y);
        if (distance > radius - 1) {
          outerPoint.x = center.x + (outerPoint.x - center.x) / distance * (radius - 1);
          outerPoint.y = center.y + (outerPoint.y - center.y) / distance * (radius - 1);
        }
      }
      cracks.push({ points: [start, middle, end], outer: [point, outerMiddle, outerEnd], width: 0.7 + random() * 0.85 });
    }
    const candidates = [];
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i], b = outline[(i + 1) % outline.length];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length < radius * 0.13) continue;
      const normal = { x: (b.y - a.y) / length, y: -(b.x - a.x) / length };
      const midpoint = interpolate(a, b, 0.5);
      if (normal.x * (midpoint.x - center.x) + normal.y * (midpoint.y - center.y) < radius * 0.3) continue;
      candidates.push({ a, b, normal, score: (midpoint.y < center.y ? 0.7 : 0.1) + random() * 0.6 });
    }
    const bounded = (point) => {
      const distance = Math.hypot(point.x - center.x, point.y - center.y);
      const scale = Math.min(1, (radius - 1) / distance);
      return { x: center.x + (point.x - center.x) * scale, y: center.y + (point.y - center.y) * scale };
    };
    const rims = candidates.sort((a, b) => b.score - a.score).slice(0, 6).map((edge) => {
      const start = interpolate(edge.a, edge.b, 0.12 + random() * 0.1);
      const end = interpolate(edge.a, edge.b, 0.76 + random() * 0.16);
      const depth = radius * (0.019 + random() * 0.021);
      return {
        normal: edge.normal,
        points: [start, end,
          bounded({ x: end.x + edge.normal.x * depth, y: end.y + edge.normal.y * depth }),
          bounded({ x: start.x + edge.normal.x * depth * 0.7, y: start.y + edge.normal.y * depth * 0.7 })]
      };
    });
    return { outline, cracks, rims };
  }

  function createFragments(options) {
    const center = options.center;
    const radius = finite(options.radius, 250, 60, 600);
    const strength = finite(options.strength, 1, 0.25, 2);
    const rectangle = options.imageRect;
    const limit = Math.round(finite(options.maxFragments, 260, 80, 260));
    const random = randomGenerator(options.seed === undefined ? 78231 : options.seed);
    const fieldRandom = randomGenerator((options.seed === undefined ? 78231 : options.seed) ^ 0x73D04A9B);
    const fieldAngle = fieldRandom() * TAU;
    const fieldPhase = fieldRandom() * TAU;
    // Unequal pressure lobes deflect nearby pieces together, leaving gaps between plumes.
    const lobes = [
      { angle: fieldAngle, power: 1.0 },
      { angle: fieldAngle + 1.3 + fieldRandom() * 0.5, power: 0.65 + fieldRandom() * 0.3 },
      { angle: fieldAngle + 3.5 + fieldRandom() * 0.65, power: 0.9 + fieldRandom() * 0.3 }
    ];
    const disc = discPolygon(center, radius);
    const bounds = {
      left: Math.max(rectangle.x, center.x - radius),
      top: Math.max(rectangle.y, center.y - radius),
      right: Math.min(rectangle.x + rectangle.width, center.x + radius),
      bottom: Math.min(rectangle.y + rectangle.height, center.y + radius)
    };
    if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) return [];

    // One grid serves the entire impact area, including circles cut by the screen edge.
    // There can never be more cells than limit, including tiny perimeter pieces.
    const width = bounds.right - bounds.left;
    const height = bounds.bottom - bounds.top;
    const cols = clamp(Math.floor(Math.sqrt(limit * width / height)), 1, limit);
    const rows = Math.max(1, Math.floor(limit / cols));
    const stepX = width / cols;
    const stepY = height / rows;
    const grid = [];
    for (let row = 0; row <= rows; row++) {
      const line = [];
      for (let col = 0; col <= cols; col++) {
        line.push({
          x: bounds.left + stepX * col + (col === 0 || col === cols ? 0 : (random() - 0.5) * stepX * 0.5),
          y: bounds.top + stepY * row + (row === 0 || row === rows ? 0 : (random() - 0.5) * stepY * 0.5)
        });
      }
      grid.push(line);
    }

    const fragments = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        let points = [grid[row][col], grid[row][col + 1], grid[row + 1][col + 1], grid[row + 1][col]];
        for (let i = 0; i < disc.length && points.length; i++) {
          points = clipPolygon(points, disc[i], disc[(i + 1) % disc.length]);
        }
        // Even subpixel boundary slivers belong to the complete tiling.
        if (points.length < 3 || polygonArea(points) < 1e-6) continue;
        const x = points.reduce((sum, point) => sum + point.x, 0) / points.length;
        const y = points.reduce((sum, point) => sum + point.y, 0) / points.length;
        const radial = clamp(Math.hypot(x - center.x, y - center.y) / radius, 0, 1);
        const radialAngle = Math.atan2(y - center.y, x - center.x);
        const impact = Math.pow(1 - radial, 1.05) * mix(0.25, 1, smooth((1 - radial) / 0.16));
        const emphasis = (options.regions || []).some((region) =>
          x >= region.x && x <= region.x + region.width && y >= region.y && y <= region.y + region.height
        ) ? 1.09 : 1;
        let pressure = 0.65;
        let turn = 0;
        for (const lobe of lobes) {
          const difference = Math.atan2(Math.sin(lobe.angle - radialAngle), Math.cos(lobe.angle - radialAngle));
          const influence = Math.exp(-Math.pow(difference / 0.68, 2)) * lobe.power;
          pressure += influence * 0.68;
          turn += difference * influence * 0.85;
        }
        const patch = Math.sin((x - center.x) / radius * 3.7 + fieldPhase) * Math.cos((y - center.y) / radius * 4.3 - fieldPhase);
        const roll = random();
        // Some fragments fall close, some travel ordinarily, and some escape in long plumes.
        // A broad energy distribution prevents source radius + throw distance becoming a ring.
        const energy = roll < 0.38 ? 0.035 + random() * 0.22 : roll < 0.68 ? 0.38 + random() * 0.72 : 1.6 + random() * 1.4;
        const angle = radialAngle + turn + (random() - 0.5) * (0.75 + impact * 1.25);
        const throwDistance = radius * (0.008 + impact * energy * pressure * (0.87 + patch * 0.38)) * strength * emphasis;
        const tangent = radius * impact * (random() - 0.5) * 0.43 * strength;
        const drift = radius * impact * patch * 0.16 * strength;
        const lift = radius * impact * (0.025 + random() * 0.42) * strength;
        const gravity = radius * (0.004 + impact * (0.04 + random() * 0.58)) * strength;
        const minX = Math.min(...points.map((p) => p.x));
        const minY = Math.min(...points.map((p) => p.y));
        const maxX = Math.max(...points.map((p) => p.x));
        const maxY = Math.max(...points.map((p) => p.y));
        const attached = points.some((point) => Math.hypot(point.x - center.x, point.y - center.y) >= radius * 0.9975);
        fragments.push({
          id: fragments.length,
          x, y, radial, points, attached,
          bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
          dx: Math.cos(angle) * throwDistance - Math.sin(radialAngle) * tangent + Math.cos(fieldAngle) * drift,
          dy: Math.sin(angle) * throwDistance + Math.cos(radialAngle) * tangent + Math.sin(fieldAngle) * drift - lift,
          gravity,
          spin: (random() - 0.5) * (0.04 + impact * 4.8) * strength,
          targetScale: 1 - impact * (0.08 + random() * 0.16),
          delay: radial * 0.145,
          wobble: (0.6 + random() * 1.4) * impact,
          wobbleRate: 1.1 + random() * 1.4,
          depth: random(),
          impact
        });
      }
    }
    return fragments;
  }

  function scatterPose(fragment, progress) {
    const u = clamp((progress - fragment.delay) / (1 - fragment.delay), 0, 1);
    if (u === 0) return { x: fragment.x, y: fragment.y, rotation: 0, scale: 1, opacity: 1, movement: 0 };
    const travel = easeOut(u);
    const jitterEnvelope = u < 0.22 ? Math.sin(Math.PI * u / 0.22) : 0;
    const jitter = jitterEnvelope * (0.65 + fragment.impact * 1.75);
    return {
      x: fragment.x + fragment.dx * travel + Math.sin(u * 145 + fragment.id * 1.73) * jitter,
      y: fragment.y + fragment.dy * travel + fragment.gravity * u * u + Math.sin(u * 127 + fragment.id * 0.81) * jitter * 0.72,
      rotation: fragment.spin * travel + Math.sin(u * 110 + fragment.id) * jitterEnvelope * fragment.impact * 0.012,
      scale: mix(1, fragment.targetScale, travel) + Math.sin(Math.PI * u) * fragment.impact * 0.1,
      opacity: 1,
      movement: travel
    };
  }

  function holdPose(fragment, holdElapsed) {
    const pose = scatterPose(fragment, 1);
    const seconds = holdElapsed / 1000;
    const envelope = smooth(seconds * 4);
    pose.x += Math.sin(seconds * fragment.wobbleRate) * fragment.wobble * envelope;
    pose.y += Math.sin(seconds * fragment.wobbleRate * 0.81) * fragment.wobble * 0.65 * envelope;
    pose.rotation += Math.sin(seconds * fragment.wobbleRate * 0.72) * fragment.wobble * 0.015 * envelope;
    return pose;
  }

  // Pure math, useful in a desktop host as well as in the extension.
  function poseAt(fragment, elapsedMs, options) {
    const time = timings(options || {});
    const elapsed = Math.max(0, elapsedMs);
    if (elapsed <= time.scatterMs) return scatterPose(fragment, elapsed / time.scatterMs);
    if (elapsed <= time.scatterMs + time.holdMs) return holdPose(fragment, elapsed - time.scatterMs);
    const restore = clamp((elapsed - time.scatterMs - time.holdMs) / time.restoreMs, 0, 1);
    if (restore === 1) return { x: fragment.x, y: fragment.y, rotation: 0, scale: 1, opacity: 1, movement: 0 };
    const from = holdPose(fragment, time.holdMs);
    const amount = easeInOut(restore);
    return {
      x: mix(from.x, fragment.x, amount),
      y: mix(from.y, fragment.y, amount),
      rotation: mix(from.rotation, 0, amount),
      scale: mix(from.scale, 1, amount),
      opacity: 1,
      movement: 1 - amount
    };
  }

  function trace(context, points, offsetX, offsetY) {
    context.beginPath();
    context.moveTo(points[0].x - offsetX, points[0].y - offsetY);
    for (let i = 1; i < points.length; i++) context.lineTo(points[i].x - offsetX, points[i].y - offsetY);
    context.closePath();
  }

  class BlastEngine {
    constructor(canvas) {
      this.canvas = canvas;
      this.context = canvas.getContext('2d', { alpha: true });
      if (!this.context) throw new Error('Canvas 2D rendering is unavailable.');
      this.running = false;
      this.frameId = 0;
      this.options = null;
      this.fragments = [];
      this.phase = '';
      this.resize();
    }

    resize() {
      this.width = Math.max(1, this.canvas.clientWidth || scope.innerWidth || this.canvas.width || 1);
      this.height = Math.max(1, this.canvas.clientHeight || scope.innerHeight || this.canvas.height || 1);
      this.dpr = clamp(scope.devicePixelRatio || 1, 1, 1.5);
      const width = Math.ceil(this.width * this.dpr);
      const height = Math.ceil(this.height * this.dpr);
      if (this.canvas.width !== width) this.canvas.width = width;
      if (this.canvas.height !== height) this.canvas.height = height;
      this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    start(options) {
      this.stop();
      if (!options || !options.texture || !options.center || !options.imageRect) {
        throw new TypeError('BlastEngine.start requires texture, imageRect and center.');
      }
      const rectangle = options.imageRect;
      if (![rectangle.x, rectangle.y, rectangle.width, rectangle.height, options.center.x, options.center.y].every(Number.isFinite) || rectangle.width <= 0 || rectangle.height <= 0) {
        throw new TypeError('Blast coordinates and imageRect dimensions must be finite and positive.');
      }
      const textureWidth = options.texture.width || options.texture.naturalWidth;
      const textureHeight = options.texture.height || options.texture.naturalHeight;
      if (!textureWidth || !textureHeight) throw new TypeError('Blast texture has no drawable pixels.');
      const background = options.backgroundImage;
      const backgroundWidth = background && (background.width || background.naturalWidth);
      const backgroundHeight = background && (background.height || background.naturalHeight);
      this.options = Object.assign({}, options, timings(options), {
        radius: finite(options.radius, 250, 60, 600),
        craterRatio: finite(options.craterRatio, 0.65, 0.35, 1),
        backgroundImage: backgroundWidth > 0 && backgroundHeight > 0 ? background : null,
        strength: finite(options.strength, 1, 0.25, 2),
        center: { x: options.center.x, y: options.center.y },
        imageRect: { x: rectangle.x, y: rectangle.y, width: rectangle.width, height: rectangle.height }
      });
      this.textureRatioX = textureWidth / rectangle.width;
      this.textureRatioY = textureHeight / rectangle.height;
      this.resize();
      const seed = options.seed === undefined ? (Math.random() * 4294967296) >>> 0 : options.seed;
      this.fragments = createFragments(Object.assign({}, this.options, { seed }));
      this.craterShape = createCraterShape({ center: this.options.center, radius: this.options.radius * this.options.craterRatio, seed });
      this.cacheFragments();
      this.cacheFragmentShadows();
      this.cacheCrater();
      this.cacheSmoke();
      this.makeParticles(randomGenerator(seed ^ 0xB01A57));
      this.running = true;
      this.startedAt = scope.performance.now();
      this.setPhase('scatter');
      if (!this.running) return this;
      this.render(0);
      this.frameId = scope.requestAnimationFrame((now) => this.tick(now));
      return this;
    }

    stop() {
      this.running = false;
      if (this.frameId) scope.cancelAnimationFrame(this.frameId);
      this.frameId = 0;
      if (this.context) {
        this.context.setTransform(1, 0, 0, 1, 0, 0);
        this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.context.setTransform(this.dpr || 1, 0, 0, this.dpr || 1, 0, 0);
      }
      for (const fragment of this.fragments || []) {
        for (const raster of [fragment.raster, fragment.edgeRaster, fragment.shadowRaster]) {
          if (raster) {
            raster.canvas.width = 1;
            raster.canvas.height = 1;
          }
        }
      }
      if (this.craterRaster) {
        this.craterRaster.canvas.width = 1;
        this.craterRaster.canvas.height = 1;
      }
      for (const sprite of this.smokeSprites || []) {
        sprite.width = 1;
        sprite.height = 1;
      }
      this.fragments = [];
      this.sparks = [];
      this.smoke = [];
      this.smokeSprites = [];
      this.craterRaster = null;
      this.craterShape = null;
      this.options = null;
      this.phase = '';
    }

    setPhase(phase) {
      if (phase === this.phase) return;
      this.phase = phase;
      if (this.options && typeof this.options.onPhase === 'function') this.options.onPhase(phase);
    }

    createSurface(width, height) {
      if (typeof this.options.createCanvas === 'function') return this.options.createCanvas(width, height);
      if (typeof scope.OffscreenCanvas === 'function') return new scope.OffscreenCanvas(width, height);
      const document = this.canvas.ownerDocument || scope.document;
      if (!document || typeof document.createElement !== 'function') return null;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }

    cacheFragments() {
      const options = this.options;
      const density = Math.min(2, Math.max(this.dpr, this.textureRatioX, this.textureRatioY));
      for (const fragment of this.fragments) {
        const box = fragment.bounds;
        const padding = 1 / density;
        const canvas = this.createSurface(Math.ceil((box.width + padding * 2) * density), Math.ceil((box.height + padding * 2) * density));
        if (!canvas) return;
        const context = canvas.getContext('2d', { alpha: true });
        context.scale(density, density);
        trace(context, fragment.points, box.x - padding, box.y - padding);
        context.clip();
        context.drawImage(options.texture,
          (box.x - options.imageRect.x) * this.textureRatioX,
          (box.y - options.imageRect.y) * this.textureRatioY,
          box.width * this.textureRatioX, box.height * this.textureRatioY,
          padding, padding, box.width, box.height);
        fragment.raster = {
          canvas,
          x: box.x - padding,
          y: box.y - padding,
          width: canvas.width / density,
          height: canvas.height / density,
          density
        };
      }
    }

    cacheFragmentShadows() {
      for (const fragment of this.fragments) {
        const raster = fragment.raster;
        if (!raster) continue;
        const edge = this.createSurface(raster.canvas.width, raster.canvas.height);
        if (!edge) return;
        const edgeContext = edge.getContext('2d');
        edgeContext.drawImage(raster.canvas, 0, 0);
        edgeContext.globalCompositeOperation = 'source-in';
        edgeContext.fillStyle = 'rgba(32,42,55,0.92)';
        edgeContext.fillRect(0, 0, edge.width, edge.height);
        fragment.edgeRaster = Object.assign({}, raster, { canvas: edge });

        const padding = 9;
        const shadowDensity = Math.min(raster.density, 1.25);
        const shadow = this.createSurface(Math.ceil((raster.width + padding * 2) * shadowDensity), Math.ceil((raster.height + padding * 2) * shadowDensity));
        const shadowContext = shadow.getContext('2d');
        shadowContext.scale(shadowDensity, shadowDensity);
        // Blur is baked once into a small tile, never repeated on the viewport per frame.
        shadowContext.shadowColor = 'rgba(9,14,25,0.66)';
        shadowContext.shadowBlur = 3.8 * shadowDensity;
        shadowContext.drawImage(edge, padding, padding, raster.width, raster.height);
        shadowContext.shadowBlur = 0;
        shadowContext.shadowColor = 'transparent';
        shadowContext.globalCompositeOperation = 'source-in';
        shadowContext.fillStyle = 'rgba(12,18,29,0.8)';
        shadowContext.fillRect(0, 0, shadow.width / shadowDensity, shadow.height / shadowDensity);
        fragment.shadowRaster = {
          canvas: shadow,
          x: raster.x - padding,
          y: raster.y - padding,
          width: shadow.width / shadowDensity,
          height: shadow.height / shadowDensity
        };
      }
    }

    paintCrater(context, center, radius) {
      const offsetX = center.x - this.options.center.x;
      const offsetY = center.y - this.options.center.y;
      const outline = this.craterShape.outline.map((point) => ({ x: point.x + offsetX, y: point.y + offsetY }));
      context.save();
      trace(context, outline, 0, 0);
      context.clip();
      const image = this.options.backgroundImage;
      if (image) {
        const width = image.width || image.naturalWidth;
        const height = image.height || image.naturalHeight;
        const side = Math.min(width, height);
        context.drawImage(image, (width - side) / 2, (height - side) / 2, side, side,
          center.x - radius, center.y - radius, radius * 2, radius * 2);
      } else {
        const gradient = context.createRadialGradient(center.x, center.y, radius * 0.12, center.x, center.y, radius);
        gradient.addColorStop(0, '#121017');
        gradient.addColorStop(0.5, '#201b20');
        gradient.addColorStop(0.86, '#35272a');
        gradient.addColorStop(1, '#49342b');
        context.fillStyle = gradient;
        context.fillRect(center.x - radius, center.y - radius, radius * 2, radius * 2);
      }
      // A narrow dark cut face reinforces hard, broken corners without dimming the image core.
      trace(context, outline, 0, 0);
      context.strokeStyle = image ? 'rgba(16,22,29,0.32)' : 'rgba(15,13,18,0.6)';
      context.lineWidth = 1.4;
      context.stroke();
      context.globalCompositeOperation = 'destination-out';
      context.globalAlpha = 1;
      context.strokeStyle = '#000';
      context.lineJoin = 'miter';
      context.lineCap = 'butt';
      for (const crack of this.craterShape.cracks) {
        context.beginPath();
        context.moveTo(crack.points[0].x + offsetX, crack.points[0].y + offsetY);
        for (let i = 1; i < crack.points.length; i++) context.lineTo(crack.points[i].x + offsetX, crack.points[i].y + offsetY);
        context.lineWidth = crack.width;
        context.stroke();
      }
      context.restore();
      // Sparse folded strips use the actual nearby page texture. Their short cut-face
      // shadows make white image areas read as torn openings against a white page.
      context.save();
      context.beginPath();
      context.arc(center.x, center.y, radius, 0, TAU);
      context.clip();
      for (const rim of this.craterShape.rims) {
        const points = rim.points.map((point) => ({ x: point.x + offsetX, y: point.y + offsetY }));
        const shadow = points.map((point) => ({ x: point.x + rim.normal.x * 1.5 + 0.5, y: point.y + rim.normal.y * 1.5 + 0.8 }));
        trace(context, shadow, 0, 0);
        context.fillStyle = 'rgba(13,20,29,0.34)';
        context.fill();
        context.save();
        trace(context, points, 0, 0);
        context.clip();
        const left = Math.min(...rim.points.map((point) => point.x));
        const top = Math.min(...rim.points.map((point) => point.y));
        const width = Math.max(...rim.points.map((point) => point.x)) - left;
        const height = Math.max(...rim.points.map((point) => point.y)) - top;
        context.drawImage(this.options.texture,
          (left - this.options.imageRect.x) * this.textureRatioX, (top - this.options.imageRect.y) * this.textureRatioY,
          width * this.textureRatioX, height * this.textureRatioY,
          left + offsetX, top + offsetY, width, height);
        context.fillStyle = 'rgba(255,255,255,0.16)';
        context.fillRect(left + offsetX, top + offsetY, width, height);
        context.restore();
        context.beginPath();
        context.moveTo(points[0].x, points[0].y);
        context.lineTo(points[1].x, points[1].y);
        context.strokeStyle = 'rgba(13,20,29,0.62)';
        context.lineWidth = 1.8;
        context.stroke();
      }
      context.restore();
      // Short uneven fracture marks continue into the remaining page along the broken rim.
      context.save();
      context.strokeStyle = 'rgba(20,26,35,0.72)';
      context.lineCap = 'butt';
      for (const crack of this.craterShape.cracks) {
        context.beginPath();
        context.moveTo(crack.outer[0].x + offsetX, crack.outer[0].y + offsetY);
        for (let i = 1; i < crack.outer.length; i++) context.lineTo(crack.outer[i].x + offsetX, crack.outer[i].y + offsetY);
        context.lineWidth = crack.width;
        context.stroke();
      }
      context.restore();
    }

    cacheCrater() {
      const radius = this.options.radius * this.options.craterRatio;
      const density = this.dpr;
      const padding = 1 / density;
      const canvas = this.createSurface(Math.ceil((radius * 2 + padding * 2) * density), Math.ceil((radius * 2 + padding * 2) * density));
      if (!canvas) return;
      const context = canvas.getContext('2d');
      context.scale(density, density);
      this.paintCrater(context, { x: radius + padding, y: radius + padding }, radius);
      this.craterRaster = {
        canvas,
        x: this.options.center.x - radius - padding,
        y: this.options.center.y - radius - padding,
        width: canvas.width / density,
        height: canvas.height / density
      };
    }

    drawFragmentShadow(fragment, pose, elapsed) {
      if (fragment.attached || pose.movement <= 0.001) return;
      const separation = Math.hypot(pose.x - fragment.x, pose.y - fragment.y);
      const lift = clamp((1 - pose.scale) * 3 + Math.sin(clamp(elapsed / this.options.scatterMs, 0, 1) * Math.PI) * fragment.impact * 0.6, 0, 1);
      const edgeShade = smooth((0.9 - fragment.radial) / 0.2);
      const alpha = pose.movement * clamp(separation / 18, 0, 1) * (0.65 - lift * 0.16) * edgeShade;
      if (alpha < 0.005) return;
      const context = this.context;
      context.save();
      context.translate(pose.x + pose.movement * (4 + lift * 11), pose.y + pose.movement * (7 + lift * 17));
      context.rotate(pose.rotation);
      context.scale(pose.scale * (1 + lift * 0.05), pose.scale * (1 - lift * 0.18));
      context.globalAlpha = alpha;
      if (fragment.shadowRaster) {
        const raster = fragment.shadowRaster;
        context.drawImage(raster.canvas, raster.x - fragment.x, raster.y - fragment.y, raster.width, raster.height);
      } else {
        trace(context, fragment.points, fragment.x, fragment.y);
        context.fillStyle = 'rgba(12,18,29,0.6)';
        context.fill();
      }
      context.restore();
    }

    cacheSmoke() {
      this.smokeSprites = [];
      for (const shade of [42, 54, 66]) {
        const canvas = this.createSurface(96, 96);
        if (!canvas) return;
        const context = canvas.getContext('2d');
        const gradient = context.createRadialGradient(48, 48, 0, 48, 48, 48);
        gradient.addColorStop(0, `rgba(${shade},${shade - 3},${shade - 1},1)`);
        gradient.addColorStop(0.55, `rgba(${shade},${shade - 3},${shade - 1},0.6)`);
        gradient.addColorStop(1, `rgba(${shade},${shade - 3},${shade - 1},0)`);
        context.fillStyle = gradient;
        context.fillRect(0, 0, 96, 96);
        this.smokeSprites.push(canvas);
      }
    }

    tick(now) {
      if (!this.running) return;
      const elapsed = Math.max(0, now - this.startedAt);
      const options = this.options;
      const total = options.scatterMs + options.holdMs + options.restoreMs;
      if (elapsed >= total) {
        // Render the exact reassembled pose before revealing the live underlying UI.
        this.render(total);
        const complete = options.onComplete;
        this.stop();
        if (typeof complete === 'function') complete();
        return;
      }
      const phase = elapsed < options.scatterMs ? 'scatter' : elapsed < options.scatterMs + options.holdMs ? 'hold' : 'restore';
      this.setPhase(phase);
      if (!this.running) return;
      this.resize();
      this.render(elapsed);
      this.frameId = scope.requestAnimationFrame((next) => this.tick(next));
    }

    makeParticles(random) {
      const options = this.options;
      this.sparks = Array.from({ length: 96 }, () => {
        const angle = random() * TAU;
        const speed = options.radius * (0.3 + random() * 1.4) * options.strength;
        return {
          dx: Math.cos(angle) * speed, dy: Math.sin(angle) * speed - 30,
          duration: 0.35 + random() * 0.85, delay: random() * 0.08,
          size: 1.5 + random() * 4, spin: (random() - 0.5) * 12,
          color: ['#fff5c4', '#ffcd5c', '#ff9248', '#ff623d'][Math.floor(random() * 4)]
        };
      });
      this.smoke = Array.from({ length: 24 }, () => {
        const angle = random() * TAU;
        return {
          x: Math.cos(angle) * options.radius * random() * 0.56,
          y: Math.sin(angle) * options.radius * random() * 0.56,
          dx: (random() - 0.5) * options.radius * 0.38,
          dy: -options.radius * (0.1 + random() * 0.22),
          size: options.radius * (0.075 + random() * 0.105),
          delay: random() * 0.2, shade: Math.round(38 + random() * 30),
          opacity: 0.1 + random() * 0.12
        };
      });
    }

    render(elapsed) {
      const context = this.context;
      const options = this.options;
      const restoreStart = options.scatterMs + options.holdMs;
      const restore = clamp((elapsed - restoreStart) / options.restoreMs, 0, 1);
      const returning = easeInOut(restore);
      context.clearRect(0, 0, this.width, this.height);
      context.save();
      this.drawCrater(elapsed, returning);
      this.drawShockwave(elapsed);

      // Static order is deliberate: returning pieces cannot flicker across each other.
      for (const fragment of this.fragments) {
        // A crop boundary is not a broken object. Keep those narrow perimeter pieces
        // attached to the live page instead of drawing a floating circular cut seam.
        if (fragment.attached) continue;
        const pose = poseAt(fragment, elapsed, options);
        this.drawFragmentShadow(fragment, pose, elapsed);
        context.save();
        context.translate(pose.x, pose.y);
        context.rotate(pose.rotation);
        context.scale(pose.scale, pose.scale * (1 - Math.sin(pose.movement * Math.PI) * fragment.impact * 0.08));
        const edgeShade = smooth((0.9 - fragment.radial) / 0.2);
        if (pose.movement > 0.001 && edgeShade > 0.005) {
          const depth = pose.movement * (1.3 + fragment.impact * 1.8);
          context.globalAlpha = pose.movement * 0.8 * edgeShade;
          if (fragment.edgeRaster) {
            const edge = fragment.edgeRaster;
            context.drawImage(edge.canvas, edge.x - fragment.x + depth * 0.45, edge.y - fragment.y + depth, edge.width, edge.height);
          } else {
            context.translate(depth * 0.45, depth);
            trace(context, fragment.points, fragment.x, fragment.y);
            context.fillStyle = '#202a37';
            context.fill();
            context.translate(-depth * 0.45, -depth);
          }
          context.globalAlpha = 1;
        }
        const box = fragment.bounds;
        if (fragment.raster) {
          // Pre-clipped transparent sprites avoid clip paths and screenshot sampling every frame.
          const raster = fragment.raster;
          context.drawImage(raster.canvas, raster.x - fragment.x, raster.y - fragment.y, raster.width, raster.height);
        } else {
          trace(context, fragment.points, fragment.x, fragment.y);
          context.clip();
          context.drawImage(options.texture,
            (box.x - options.imageRect.x) * this.textureRatioX,
            (box.y - options.imageRect.y) * this.textureRatioY,
            box.width * this.textureRatioX, box.height * this.textureRatioY,
            box.x - fragment.x, box.y - fragment.y, box.width, box.height);
        }
        const warmth = Math.exp(-elapsed / 220);
        if (pose.movement > 0.001 && warmth > 0.01) {
          context.globalAlpha = pose.movement * fragment.impact * 0.16 * warmth;
          context.fillStyle = '#ffb35b';
          trace(context, fragment.points, fragment.x, fragment.y);
          context.fill();
          context.globalAlpha = 1;
        }
        context.restore();
      }
      this.drawSmoke(elapsed, returning);
      this.drawSparks(elapsed, returning);
      this.drawFlash(elapsed);
      context.restore();
    }

    drawCrater(elapsed, returning) {
      const context = this.context;
      const options = this.options;
      const alpha = smooth(elapsed / 70) * (1 - smooth((returning - 0.86) / 0.14));
      if (alpha <= 0) return;
      context.save();
      context.beginPath();
      context.rect(options.imageRect.x, options.imageRect.y, options.imageRect.width, options.imageRect.height);
      context.clip();
      context.globalAlpha = alpha;
      if (this.craterRaster) {
        const raster = this.craterRaster;
        context.drawImage(raster.canvas, raster.x, raster.y, raster.width, raster.height);
      } else {
        this.paintCrater(context, options.center, options.radius * options.craterRatio);
      }
      context.restore();
    }

    drawShockwave(elapsed) {
      const context = this.context;
      const options = this.options;
      const seconds = elapsed / 1000;
      if (seconds > 0.62) return;
      const progress = seconds / 0.62;
      const r = options.radius * (0.06 + easeOut(progress) * 1.3);
      const alpha = Math.pow(1 - progress, 2);
      context.save();
      context.globalAlpha = alpha;
      context.strokeStyle = '#fff7dd';
      context.lineWidth = 2.5 + (1 - progress) * 8;
      context.beginPath();
      context.arc(options.center.x, options.center.y, r, 0, TAU);
      context.stroke();
      context.globalAlpha = alpha * 0.3;
      context.strokeStyle = '#ffb879';
      context.lineWidth = 12;
      context.beginPath();
      context.arc(options.center.x, options.center.y, r * 0.96, 0, TAU);
      context.stroke();
      context.restore();
    }

    drawSmoke(elapsed, returning) {
      if (returning > 0.98) return;
      const context = this.context;
      const options = this.options;
      const seconds = elapsed / 1000;
      context.save();
      for (const puff of this.smoke) {
        const age = seconds - puff.delay;
        if (age <= 0) continue;
        const fade = smooth(age * 4) * Math.exp(-age * 0.62) * (1 - returning);
        if (fade < 0.002) continue;
        const x = options.center.x + puff.x + puff.dx * Math.min(age, 3);
        const y = options.center.y + puff.y + puff.dy * age;
        const size = puff.size * (1 + age * 0.7);
        if (this.smokeSprites.length) {
          const sprite = this.smokeSprites[Math.min(2, Math.floor((puff.shade - 38) / 10))];
          context.globalAlpha = puff.opacity * fade;
          context.drawImage(sprite, x - size, y - size, size * 2, size * 2);
          context.globalAlpha = 1;
          continue;
        }
        const gradient = context.createRadialGradient(x, y, 0, x, y, size);
        gradient.addColorStop(0, `rgba(${puff.shade},${puff.shade - 3},${puff.shade - 1},${puff.opacity * fade})`);
        gradient.addColorStop(0.55, `rgba(${puff.shade},${puff.shade - 3},${puff.shade - 1},${puff.opacity * fade * 0.6})`);
        gradient.addColorStop(1, `rgba(${puff.shade},${puff.shade - 3},${puff.shade - 1},0)`);
        context.fillStyle = gradient;
        context.fillRect(x - size, y - size, size * 2, size * 2);
      }
      context.restore();
    }

    drawSparks(elapsed, returning) {
      if (returning > 0 || elapsed > 1400) return;
      const context = this.context;
      const options = this.options;
      const seconds = elapsed / 1000;
      context.save();
      for (const spark of this.sparks) {
        const age = seconds - spark.delay;
        if (age < 0 || age > spark.duration) continue;
        const life = age / spark.duration;
        const travel = 1 - Math.exp(-age * 2.4);
        const x = options.center.x + spark.dx * travel;
        const y = options.center.y + spark.dy * travel + age * age * 110;
        context.save();
        context.translate(x, y);
        context.rotate(age * spark.spin);
        context.globalAlpha = Math.pow(1 - life, 0.8);
        context.fillStyle = spark.color;
        context.fillRect(-spark.size / 2, -spark.size / 2, spark.size, spark.size);
        context.restore();
      }
      context.restore();
    }

    drawFlash(elapsed) {
      if (elapsed >= 190) return;
      const context = this.context;
      const options = this.options;
      const fade = Math.pow(1 - elapsed / 190, 2);
      const radius = options.radius * 0.95;
      context.save();
      const gradient = context.createRadialGradient(options.center.x, options.center.y, 0, options.center.x, options.center.y, radius);
      gradient.addColorStop(0, `rgba(255,255,239,${fade * 0.96})`);
      gradient.addColorStop(0.24, `rgba(255,228,162,${fade * 0.86})`);
      gradient.addColorStop(0.65, `rgba(255,136,65,${fade * 0.35})`);
      gradient.addColorStop(1, 'rgba(255,94,28,0)');
      context.fillStyle = gradient;
      context.fillRect(options.center.x - radius, options.center.y - radius, radius * 2, radius * 2);
      context.restore();
    }
  }

  const api = { BlastEngine, createFragments, poseAt, createCraterShape };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (scope) scope.TNTBlast = api;
})(typeof window !== 'undefined' ? window : globalThis);
