// The sky and the far scenery. The gradient, sun, moon, stars and clouds follow world.clock; three
// parallax layers (mountains, hills, a forest edge) follow world.season. Also computes the light
// palette the WorldView uses to tint the scene. Reads world.clock and world.season only.
(function (Evo) {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const smooth = (a, b, v) => { const x = clamp01((v - a) / (b - a)); return x * x * (3 - 2 * x); };
  const SEASON_KEYS = ['SPRING', 'SUMMER', 'AUTUMN', 'WINTER'];

  // Scenery uses its own seeded streams (Evo.util.mulberry32), never Evo.random: drawing must not
  // consume the simulation's random numbers.
  const rng = Evo.util.mulberry32;

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  }

  // Colours are [r, g, b] arrays; the per-frame helpers write into `out` to avoid allocation
  function mixInto(out, a, b, t) {
    out[0] = a[0] + (b[0] - a[0]) * t;
    out[1] = a[1] + (b[1] - a[1]) * t;
    out[2] = a[2] + (b[2] - a[2]) * t;
    return out;
  }
  const rgb = c => 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')';
  const rgba = (c, a) => 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')';
  const mix = (a, b, t) => mixInto([0, 0, 0], a, b, t);
  const scale = (c, k) => [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];

  // Which season, and how far the fade into the next one has got (the last tenth of a season)
  function seasonState(season, out) {
    let i = 0, progress = 0;
    if (season) {
      const k = SEASON_KEYS.indexOf(season.key);
      i = k >= 0 ? k : (season.index | 0);
      progress = season.progress || 0;
    }
    i = ((i % 4) + 4) % 4;
    out.cur = i;
    out.next = (i + 1) % 4;
    out.blend = smooth(0.9, 1, progress);
    out.prefetch = progress > 0.8;
    return out;
  }

  // ---- Sky colour keyframes along the sun's elevation (-1 midnight .. 1 noon) ----
  // top/mid/hor: sky gradient; amb/ambA: the tint laid over the scene; lit/shd: cloud colours;
  // sun: the sun disc.
  const K = (top, mid, hor, amb, ambA, lit, shd, sun) => ({ top, mid, hor, amb, ambA, lit, shd, sun });
  const DAY = [
    K([96, 170, 230], [160, 210, 238], [226, 242, 236], [255, 250, 240], 0.02, [255, 255, 255], [206, 222, 238], [255, 250, 232]),
    K([58, 142, 226], [128, 192, 240], [212, 236, 246], [255, 244, 220], 0.04, [255, 255, 255], [200, 220, 240], [255, 252, 236]),
    K([98, 146, 204], [170, 198, 222], [242, 228, 204], [255, 226, 190], 0.07, [255, 250, 242], [214, 208, 212], [255, 244, 220]),
    K([128, 164, 204], [180, 204, 226], [230, 238, 244], [226, 236, 255], 0.06, [248, 250, 255], [190, 202, 220], [255, 250, 240]),
  ];
  const NIGHT = [
    K([7, 11, 32], [15, 23, 56], [30, 42, 84], [18, 26, 66], 0.5, [64, 76, 118], [30, 38, 72], [255, 170, 100]),
    K([6, 10, 30], [14, 22, 54], [30, 40, 82], [18, 26, 64], 0.48, [64, 76, 118], [30, 38, 72], [255, 170, 100]),
    K([8, 11, 30], [17, 22, 52], [34, 40, 78], [20, 24, 60], 0.5, [66, 74, 112], [32, 36, 68], [255, 170, 100]),
    K([12, 18, 42], [24, 34, 68], [44, 58, 98], [30, 42, 86], 0.44, [84, 96, 136], [42, 50, 88], [255, 170, 100]),
  ];
  const TWILIGHT = [ // [deep, horizon, golden] for morning then evening
    [K([20, 26, 64], [60, 56, 108], [128, 94, 132], [52, 46, 104], 0.38, [120, 104, 150], [58, 52, 96], [255, 170, 110]),
      K([54, 76, 136], [198, 138, 158], [255, 190, 136], [236, 150, 128], 0.2, [255, 200, 186], [186, 120, 150], [255, 176, 110]),
      K([90, 142, 206], [222, 198, 196], [255, 224, 176], [255, 212, 160], 0.1, [255, 240, 224], [222, 176, 176], [255, 222, 170])],
    [K([18, 22, 58], [64, 46, 98], [140, 80, 112], [60, 40, 96], 0.4, [124, 92, 136], [60, 44, 90], [255, 160, 96]),
      K([48, 58, 118], [206, 112, 124], [255, 150, 88], [236, 122, 80], 0.26, [255, 184, 150], [176, 96, 124], [255, 150, 84]),
      K([84, 128, 198], [232, 178, 156], [255, 198, 132], [255, 176, 110], 0.15, [255, 226, 200], [214, 150, 150], [255, 206, 140])],
  ];
  const STOP_E = [-1, -0.3, -0.13, -0.01, 0.12, 0.34, 1];
  // STOPS[season][0 morning | 1 evening] = keyframes at STOP_E
  const STOPS = [0, 1, 2, 3].map(si => [0, 1].map(m => {
    const tw = TWILIGHT[m];
    return [NIGHT[si], NIGHT[si], tw[0], tw[1], tw[2], DAY[si], DAY[si]];
  }));

  function makePalette() {
    const c3 = () => [0, 0, 0];
    return {
      top: c3(), mid: c3(), hor: c3(), amb: c3(), lit: c3(), shd: c3(), sun: c3(), haze: c3(),
      ambA: 0, night: 0, day: 1, twilight: 0, stars: 0, elevation: 1, morning: true,
      topCss: '', midCss: '', horCss: '', ambCss: '', hazeCss: '', sunCss: '',
    };
  }

  function evalStops(pal, si, morning, e) {
    const stops = STOPS[si][morning ? 0 : 1];
    let k = 0;
    while (k < STOP_E.length - 2 && e > STOP_E[k + 1]) k++;
    let u = clamp01((e - STOP_E[k]) / (STOP_E[k + 1] - STOP_E[k]));
    u = u * u * (3 - 2 * u);
    const a = stops[k], b = stops[k + 1];
    mixInto(pal.top, a.top, b.top, u);
    mixInto(pal.mid, a.mid, b.mid, u);
    mixInto(pal.hor, a.hor, b.hor, u);
    mixInto(pal.amb, a.amb, b.amb, u);
    mixInto(pal.lit, a.lit, b.lit, u);
    mixInto(pal.shd, a.shd, b.shd, u);
    mixInto(pal.sun, a.sun, b.sun, u);
    pal.ambA = a.ambA + (b.ambA - a.ambA) * u;
  }

  // ---- Seasonal colours of the far scenery ----
  const MOUNTAINS = [
    { back: [160, 178, 206], backShade: [132, 148, 184], front: [128, 150, 184], frontShade: [104, 122, 162], snow: [246, 248, 255], snowShade: [196, 208, 232], snowLine: 0.3 },
    { back: [150, 172, 204], backShade: [122, 142, 182], front: [116, 142, 178], frontShade: [92, 114, 154], snow: [246, 248, 255], snowShade: [196, 208, 232], snowLine: 0.15 },
    { back: [168, 166, 196], backShade: [138, 134, 172], front: [138, 136, 172], frontShade: [112, 108, 150], snow: [246, 246, 252], snowShade: [200, 200, 226], snowLine: 0.22 },
    { back: [190, 204, 224], backShade: [150, 166, 196], front: [160, 178, 206], frontShade: [124, 142, 176], snow: [250, 252, 255], snowShade: [204, 216, 236], snowLine: 0.6 },
  ];
  const HILLS = [
    { back: [150, 202, 128], front: [116, 182, 98], shadeK: 0.86, trees: [[80, 150, 84], [98, 168, 90], [244, 196, 214]], rim: [206, 238, 176] },
    { back: [112, 170, 100], front: [80, 146, 76], shadeK: 0.84, trees: [[48, 110, 62], [60, 124, 66], [72, 132, 70]], rim: [170, 216, 140] },
    { back: [206, 168, 104], front: [184, 130, 74], shadeK: 0.84, trees: [[204, 100, 50], [222, 164, 60], [160, 74, 44]], rim: [240, 212, 150] },
    { back: [228, 236, 244], front: [206, 220, 234], shadeK: 0.9, trees: [[70, 92, 96], [96, 104, 112], [84, 98, 104]], rim: [255, 255, 255] },
  ];
  const FOREST = [
    { conifer: [60, 116, 84], round: [[104, 176, 90], [124, 188, 100], [236, 186, 206]], ground: [104, 160, 80], trunk: [96, 70, 52] },
    { conifer: [36, 90, 62], round: [[54, 126, 62], [66, 138, 66], [46, 112, 58]], ground: [66, 124, 60], trunk: [84, 60, 44] },
    { conifer: [50, 94, 66], round: [[218, 120, 50], [230, 178, 64], [182, 72, 44], [204, 146, 60]], ground: [160, 124, 68], trunk: [92, 66, 48] },
    { conifer: [52, 84, 72], round: [[120, 106, 100], [130, 116, 108]], ground: [226, 234, 242], trunk: [104, 90, 84] },
  ];

  // Layers, back to front. f: parallax factor (0 = at infinity, 1 = moves with the world);
  // base: where the layer's foot sits, relative to the mean ground height (world px).
  const LAYERS = [
    { name: 'mountains', f: 0.1, period: 1600, height: 340, base: -24, haze: 0.3 },
    { name: 'hills', f: 0.26, period: 1400, height: 230, base: -6, haze: 0.2 },
    { name: 'forest', f: 0.5, period: 1200, height: 190, base: 18, haze: 0.1 },
  ];

  // A sum of sines whose frequencies fit the period exactly, so the layer tiles seamlessly
  function periodicNoise(R, period, terms) {
    const parts = terms.map(([k, amp]) => ({ w: TAU * k / period, a: amp * (0.7 + R() * 0.6), p: R() * TAU }));
    return x => {
      let v = 0;
      for (const q of parts) v += Math.sin(x * q.w + q.p) * q.a;
      return v;
    };
  }

  // Draw fn at x and at its wrapped copies near the seams
  function wrapped(P, x, reach, fn) {
    fn(x);
    if (x < reach) fn(x + P);
    if (x > P - reach) fn(x - P);
  }

  function paintMountains(g, P, H, si) {
    const pal = MOUNTAINS[si];
    for (let range = 0; range < 2; range++) {
      const R = rng(101 + range * 17); // same shapes in every season
      const count = range ? 6 : 8;
      const peaks = [];
      for (let i = 0; i < count; i++) {
        peaks.push({
          x: (i + 0.15 + R() * 0.7) * P / count,
          h: H * (range ? 0.36 + R() * 0.3 : 0.52 + R() * 0.4),
          w: range ? 170 + R() * 140 : 130 + R() * 150,
        });
      }
      const jag = periodicNoise(R, P, [[23, 5], [57, 2.6], [131, 1.3]]);
      const floor = range ? 36 : 70;
      const topAt = x => {
        let m = 0;
        for (const p of peaks) {
          let dx = x - p.x;
          dx -= Math.round(dx / P) * P;
          const u = Math.abs(dx) / p.w;
          if (u < 1) {
            const v = p.h * Math.pow(1 - u, 1.35);
            if (v > m) m = v;
          }
        }
        return H - Math.max(m + jag(x), floor);
      };
      const sil = new Path2D();
      sil.moveTo(0, H + 2);
      for (let x = 0; x < P; x += 4) sil.lineTo(x, topAt(x));
      sil.lineTo(P, topAt(P));
      sil.lineTo(P, H + 2);
      sil.closePath();
      const body = g.createLinearGradient(0, H * 0.1, 0, H);
      body.addColorStop(0, rgb(range ? pal.front : pal.back));
      body.addColorStop(1, rgb(mix(range ? pal.front : pal.back, [255, 255, 255], 0.18)));
      g.fillStyle = body;
      g.fill(sil);
      g.save();
      g.clip(sil);
      // Each peak's true apex (the jagged noise moves it a little)
      for (const p of peaks) {
        let bx = p.x, by = topAt(p.x);
        for (let x = p.x - 24; x <= p.x + 24; x += 1) { const y = topAt(((x % P) + P) % P); if (y < by) { by = y; bx = x; } }
        p.ax = bx; p.ay = by;
      }
      // The ridge line runs from the apex down and a little to the right; beyond it the face is in shade
      const ridge = (ax, ay, p) => {
        g.lineTo(ax + p.w * 0.12, ay + p.h * 0.28);
        g.lineTo(ax + p.w * 0.04, ay + p.h * 0.52);
        g.lineTo(ax + p.w * 0.2, H + 4);
      };
      g.fillStyle = rgb(range ? pal.frontShade : pal.backShade);
      for (const p of peaks) {
        wrapped(P, p.x, p.w * 1.2, x => {
          const ax = p.ax + (x - p.x), ay = p.ay;
          g.beginPath();
          g.moveTo(ax + p.w * 0.2, H + 4);
          g.lineTo(ax + p.w * 1.2, H + 4);
          g.lineTo(ax + p.w * 1.2, ay - 30);
          g.lineTo(ax + 0.5, ay - 30);
          g.lineTo(ax + 0.5, ay);
          ridge(ax, ay, p);
          g.closePath();
          g.fill();
        });
      }
      // Gullies on the sunlit faces
      g.strokeStyle = rgba(range ? pal.frontShade : pal.backShade, 0.55);
      g.lineWidth = 1.5;
      for (const p of peaks) {
        wrapped(P, p.x, p.w * 1.2, x => {
          const ax = p.ax + (x - p.x), ay = p.ay;
          g.beginPath();
          for (let k = 1; k <= 3; k++) {
            const x0 = ax - p.w * 0.12 * k, y0 = ay + p.h * (0.18 + 0.1 * k);
            g.moveTo(x0, y0);
            g.lineTo(x0 - p.w * 0.05, y0 + p.h * 0.18);
            g.lineTo(x0 - p.w * 0.02, y0 + p.h * 0.3);
          }
          g.stroke();
        });
      }
      // Snow caps with a jagged snow line; the shaded side of the snow is bluer
      const line = pal.snowLine * (range ? 0.85 : 1);
      for (const p of peaks) {
        if (p.h < H * 0.42 && si !== 3) continue;
        const depth = p.h * line + 10;
        const zig = [];
        for (let k = 0; k <= 12; k++) zig.push((k % 2 ? 7 : -3) * (0.6 + R() * 0.6)); // same for wrapped copies
        wrapped(P, p.x, p.w, x => {
          const ax = p.ax + (x - p.x), ay = p.ay;
          const cap = new Path2D();
          cap.moveTo(ax - p.w, ay - 40);
          cap.lineTo(ax + p.w, ay - 40);
          const n = 12;
          for (let k = 0; k <= n; k++) {
            const u = 1 - k / n;
            const xx = ax - p.w * 0.9 + u * p.w * 1.8;
            const dip = Math.abs(u - 0.5) * 2; // snow reaches lower near the ridge
            cap.lineTo(xx, ay + depth * (1.05 - dip * 0.55) + zig[k]);
          }
          cap.closePath();
          g.fillStyle = rgb(pal.snow);
          g.fill(cap);
          g.save();
          g.beginPath();
          g.moveTo(ax + p.w * 0.2, H + 4);
          g.lineTo(ax + p.w * 1.2, H + 4);
          g.lineTo(ax + p.w * 1.2, ay - 40);
          g.lineTo(ax + 0.5, ay - 40);
          g.lineTo(ax + 0.5, ay);
          ridge(ax, ay, p);
          g.closePath();
          g.clip();
          g.fillStyle = rgb(pal.snowShade);
          g.fill(cap);
          g.restore();
        });
      }
      g.restore();
    }
  }

  // A small tree for the hills and the forest edge
  function paintSmallTree(g, x, y, h, conifer, col, si, R, trunkCol) {
    const dark = rgb(scale(col, 0.78));
    if (conifer) {
      const tiers = 4, w = h * 0.42;
      for (let k = 0; k < tiers; k++) {
        const ty = y - h + k * h * 0.2, by = ty + h * 0.34, tw = w * (0.45 + k * 0.2);
        g.fillStyle = rgb(col);
        g.beginPath(); g.moveTo(x, ty); g.lineTo(x + tw, by); g.lineTo(x - tw, by); g.closePath(); g.fill();
        g.fillStyle = dark;
        g.beginPath(); g.moveTo(x, ty); g.lineTo(x + tw, by); g.lineTo(x + tw * 0.1, by); g.closePath(); g.fill();
        if (si === 3) { // snow on each tier
          g.fillStyle = 'rgba(248,251,255,0.95)';
          g.beginPath(); g.moveTo(x, ty); g.lineTo(x + tw * 0.55, ty + h * 0.2); g.lineTo(x - tw * 0.6, ty + h * 0.2); g.closePath(); g.fill();
        }
      }
      g.fillStyle = rgb(trunkCol);
      g.fillRect(x - h * 0.03, y - h * 0.08, h * 0.06, h * 0.1);
      return;
    }
    // Deciduous: a trunk and a crown of overlapping circles (bare branches in winter)
    g.strokeStyle = rgb(trunkCol);
    g.lineCap = 'round';
    g.lineWidth = Math.max(1, h * 0.06);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - h * 0.55); g.stroke();
    if (si === 3) {
      g.lineWidth = Math.max(0.7, h * 0.025);
      const branch = (bx, by, a, len, depth) => {
        const ex = bx + Math.sin(a) * len, ey = by - Math.cos(a) * len;
        g.beginPath(); g.moveTo(bx, by); g.lineTo(ex, ey); g.stroke();
        if (depth > 0) {
          branch(ex, ey, a - 0.45 - R() * 0.2, len * 0.66, depth - 1);
          branch(ex, ey, a + 0.45 + R() * 0.2, len * 0.66, depth - 1);
        }
      };
      branch(x, y - h * 0.4, -0.3, h * 0.3, 2);
      branch(x, y - h * 0.45, 0.35, h * 0.32, 2);
      branch(x, y - h * 0.5, 0, h * 0.28, 2);
      return;
    }
    const cr = h * 0.3, cy = y - h * 0.62;
    const n = 5;
    const pts = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + R();
      pts.push([x + Math.cos(a) * cr * 0.55, cy + Math.sin(a) * cr * 0.45, cr * (0.55 + R() * 0.25)]);
    }
    g.fillStyle = dark;
    for (const [px, py, pr] of pts) { g.beginPath(); g.arc(px + pr * 0.18, py + pr * 0.2, pr, 0, TAU); g.fill(); }
    g.fillStyle = rgb(col);
    for (const [px, py, pr] of pts) { g.beginPath(); g.arc(px - pr * 0.08, py - pr * 0.08, pr * 0.88, 0, TAU); g.fill(); }
    // A soft sunlit side, clipped to the crown
    g.save();
    g.beginPath();
    for (const [px, py, pr] of pts) { g.moveTo(px - pr * 0.08 + pr * 0.88, py - pr * 0.08); g.arc(px - pr * 0.08, py - pr * 0.08, pr * 0.88, 0, TAU); }
    g.clip();
    g.fillStyle = rgba(mix(col, [255, 250, 225], 0.3), 0.55);
    g.beginPath(); g.ellipse(x - cr * 0.55, cy - cr * 0.5, cr * 0.75, cr * 0.6, -0.4, 0, TAU); g.fill();
    g.restore();
  }

  function paintHills(g, P, H, si) {
    const pal = HILLS[si];
    const R = rng(202);
    const ridges = [
      { base: H * 0.46, n: periodicNoise(R, P, [[2, 36], [5, 16], [11, 6]]), col: pal.back },
      { base: H * 0.26, n: periodicNoise(R, P, [[3, 28], [7, 12], [13, 5]]), col: pal.front },
    ];
    ridges.forEach((rd, ri) => {
      const yAt = x => H - rd.base - rd.n(x);
      const sil = new Path2D();
      sil.moveTo(0, H + 2);
      for (let x = 0; x <= P; x += 4) sil.lineTo(x, yAt(x));
      sil.lineTo(P, H + 2);
      sil.closePath();
      const grd = g.createLinearGradient(0, H - rd.base - 60, 0, H);
      grd.addColorStop(0, rgb(mix(rd.col, [255, 255, 255], si === 3 ? 0.4 : 0.14)));
      grd.addColorStop(0.5, rgb(rd.col));
      grd.addColorStop(1, rgb(scale(rd.col, pal.shadeK)));
      g.fillStyle = grd;
      g.fill(sil);
      // Sunlit rim along the crest
      g.strokeStyle = rgba(pal.rim, 0.55);
      g.lineWidth = 2;
      g.beginPath();
      for (let x = 0; x <= P; x += 4) (x ? g.lineTo(x, yAt(x) + 1) : g.moveTo(x, yAt(x) + 1));
      g.stroke();
      // Little trees dotted along the slopes
      const trees = ri ? 34 : 22;
      for (let k = 0; k < trees; k++) {
        const x = R() * P;
        const conifer = R() < (si === 3 ? 0.7 : 0.35);
        const h = (ri ? 16 : 11) + R() * (ri ? 16 : 10);
        const col = pal.trees[(R() * pal.trees.length) | 0];
        const dy = 3 + R() * (ri ? 26 : 16);
        wrapped(P, x, 20, xx => paintSmallTree(g, xx, yAt(xx) + dy, h, conifer, col, si, R, [96, 76, 62]));
      }
    });
  }

  function paintForest(g, P, H, si) {
    const pal = FOREST[si];
    const R = rng(303);
    for (let row = 0; row < 2; row++) {
      let x = R() * 20;
      while (x < P) {
        const conifer = R() < (si === 3 ? 0.55 : 0.42);
        const h = (row ? 88 : 64) + R() * (row ? 76 : 50);
        const y = H - (row ? 14 : 24) + R() * 4;
        const col0 = conifer ? pal.conifer : pal.round[(R() * pal.round.length) | 0];
        const col = row ? col0 : mix(col0, [200, 220, 230], 0.2);
        wrapped(P, x, 60, xx => paintSmallTree(g, xx, y, h, conifer, col, si, R, pal.trunk));
        x += (row ? 24 : 18) + R() * (row ? 28 : 20);
      }
    }
    // The ground the forest stands on, with a soft wavy top
    const wave = periodicNoise(R, P, [[9, 3], [23, 1.5]]);
    g.fillStyle = rgb(pal.ground);
    g.beginPath();
    g.moveTo(0, H + 2);
    for (let x = 0; x <= P; x += 6) g.lineTo(x, H - 16 + wave(x));
    g.lineTo(P, H + 2);
    g.closePath();
    g.fill();
  }

  const PAINTERS = [paintMountains, paintHills, paintForest];
  const SKIRT = [si => MOUNTAINS[si].front, si => HILLS[si].front, si => FOREST[si].ground];

  // ---- Clouds: shapes are fixed; sprites are re-tinted when the light changes ----
  function makeCloudShape(R) {
    const w = 130 + R() * 190, h = w * (0.26 + R() * 0.1);
    const n = 5 + ((w / 45) | 0);
    const puffs = [];
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const r = h * (0.32 + 0.6 * Math.sin(Math.PI * (0.12 + u * 0.76))) * (0.78 + R() * 0.4);
      puffs.push({ x: (u - 0.5) * w * 0.86, y: -r * 0.55 - R() * 4, r });
    }
    return { w, h, puffs };
  }

  // A cumulus: puffs lit from above fading to a shaded, nearly flat base, with a soft rim
  function paintCloud(shape, lit, shd, res) {
    const pad = 12;
    const top = Math.max(...shape.puffs.map(p => p.r - p.y)) + pad;
    const W = shape.w + shape.h * 1.4 + pad * 2, Hh = top + pad;
    const c = makeCanvas(W * res, Hh * res);
    const g = c.getContext('2d');
    g.setTransform(res, 0, 0, res, (W / 2) * res, top * res);
    const union = (k, dy) => {
      g.beginPath();
      for (const p of shape.puffs) {
        const r = p.r * k;
        g.moveTo(p.x + r, p.y + dy);
        g.ellipse(p.x, p.y + dy, r, r * 0.9, 0, 0, TAU);
      }
    };
    g.save();
    g.beginPath();
    g.rect(-W, -top - 10, W * 2, top + 13); // the flattened base
    g.clip();
    const grd = g.createLinearGradient(0, -top + pad, 0, 3);
    grd.addColorStop(0, rgb(mix(lit, [255, 255, 255], 0.4)));
    grd.addColorStop(0.5, rgb(lit));
    grd.addColorStop(1, rgb(shd));
    g.fillStyle = grd;
    union(1, 0);
    g.fill();
    // Sunlit crowns on the biggest puffs
    g.fillStyle = rgba(mix(lit, [255, 255, 255], 0.7), 0.5);
    g.beginPath();
    for (const p of shape.puffs) {
      if (p.r < shape.h * 0.5) continue;
      g.moveTo(p.x - p.r * 0.2 + p.r * 0.5, p.y - p.r * 0.35);
      g.ellipse(p.x - p.r * 0.2, p.y - p.r * 0.35, p.r * 0.5, p.r * 0.38, 0, 0, TAU);
    }
    g.fill();
    g.restore();
    return { canvas: c, w: W, h: Hh, top };
  }

  // The moon's disc for a phase (0 new, 0.5 full); the dark part keeps a faint earthshine
  function paintMoon(phase, r, res) {
    const s = (r + 2) * 2;
    const c = makeCanvas(s * res, s * res);
    const g = c.getContext('2d');
    g.setTransform(res, 0, 0, res, (s / 2) * res, (s / 2) * res);
    g.fillStyle = '#eef0fa';
    g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
    g.fillStyle = 'rgba(190,198,222,0.55)'; // maria
    g.beginPath(); g.arc(-r * 0.3, -r * 0.2, r * 0.3, 0, TAU); g.fill();
    g.beginPath(); g.arc(r * 0.25, r * 0.28, r * 0.22, 0, TAU); g.fill();
    g.beginPath(); g.arc(r * 0.35, -r * 0.35, r * 0.13, 0, TAU); g.fill();
    const p = phase % 1;
    if (Math.abs(p - 0.5) > 0.02) {
      g.save();
      if (p > 0.5) g.scale(-1, 1); // waning: lit on the left
      const rx = r * Math.cos(p * TAU);
      g.beginPath();
      g.moveTo(0, -r);
      g.arc(0, 0, r + 0.5, -Math.PI / 2, Math.PI / 2, true);
      g.ellipse(0, 0, Math.abs(rx) + 0.01, r + 0.5, 0, Math.PI / 2, -Math.PI / 2, rx > 0);
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = 'rgba(0,0,0,0.88)';
      g.fill();
      g.restore();
    }
    return c;
  }

  class Sky {
    constructor() {
      this.pal = makePalette();
      this.tmp = makePalette();
      this.ss = { cur: 0, next: 1, blend: 0, prefetch: false };
      this.layerSprites = new Map(); // `${layer}|${season}` -> { canvas, res }
      this.layerRes = 1;
      const R = rng(404);
      this.cloudShapes = [];
      for (let i = 0; i < 10; i++) this.cloudShapes.push(makeCloudShape(R));
      this.clouds = this.cloudShapes.map((s, i) => ({ shape: i, x: (i + R() * 0.8) / 10, y: 0.05 + ((i * 7) % 10) / 10 * 0.3, speed: 3 + R() * 6, scale: 0.45 + R() * 0.4 }));
      this.cloudSprites = [];
      this.cloudKey = '';
      // Stars: position in [0,1]², size, brightness, twinkle
      this.stars = new Float32Array(170 * 5);
      for (let i = 0; i < 170; i++) {
        const o = i * 5;
        this.stars[o] = R();
        this.stars[o + 1] = Math.pow(R(), 1.3) * 0.95;
        this.stars[o + 2] = R() < 0.08 ? 2 : R() < 0.35 ? 1.4 : 1;
        this.stars[o + 3] = 0.35 + R() * 0.65;
        this.stars[o + 4] = R() * TAU;
      }
      this.moonSprite = null;
      this.moonKey = -1;
      this.shooting = { t0: -100, x: 0, y: 0, dx: 0, dy: 0 };
      this.nextShoot = 6;
    }

    // Compute the light palette for this frame from the clock and season
    update(world, t) {
      const clock = world.clock || {};
      const e = typeof clock.sunElevation === 'number' ? clock.sunElevation : Math.sin(((clock.phase || 0.5) - 0.25) * TAU);
      const morning = (clock.phase || 0) < 0.5;
      const ss = seasonState(world.season, this.ss);
      const pal = this.pal;
      evalStops(pal, ss.cur, morning, e);
      if (ss.blend > 0) {
        const tmp = this.tmp;
        evalStops(tmp, ss.next, morning, e);
        for (const k of ['top', 'mid', 'hor', 'amb', 'lit', 'shd', 'sun']) mixInto(pal[k], pal[k], tmp[k], ss.blend);
        pal.ambA += (tmp.ambA - pal.ambA) * ss.blend;
      }
      mixInto(pal.haze, pal.hor, pal.mid, 0.3);
      pal.elevation = e;
      pal.morning = morning;
      pal.night = smooth(-0.04, -0.28, e);
      pal.day = smooth(0.02, 0.3, e);
      pal.twilight = clamp01(1 - pal.night - pal.day);
      pal.stars = smooth(-0.03, -0.24, e);
      pal.moonPhase = (((clock.day || 0) + (clock.phase || 0)) / 8 + 0.42) % 1;
      pal.topCss = rgb(pal.top);
      pal.midCss = rgb(pal.mid);
      pal.horCss = rgb(pal.hor);
      pal.ambCss = rgb(pal.amb);
      pal.hazeCss = rgb(pal.haze);
      this.t = t;
      return pal;
    }

    // Screen scale of a layer: far layers grow less than the world when zooming
    layerScale(v, f) { return v.fit.zoom * Math.pow(v.cam.zoom / v.fit.zoom, f); }

    // Screen y (CSS px) of a layer's foot
    layerBaseY(v, L) {
      const s = this.layerScale(v, L.f);
      return v.h / 2 + (v.fit.horizonY + L.base - v.fit.centerY - (v.cam.y - v.fit.centerY) * L.f) * s;
    }

    horizonY(v) { return this.layerBaseY(v, LAYERS[0]) - 20 * this.layerScale(v, LAYERS[0].f); }

    _layerSprite(li, si, force) {
      const key = li * 4 + si;
      let sp = this.layerSprites.get(key);
      if (sp && sp.res === this.layerRes) return sp;
      if (!force && this.builtThisFrame) return sp || null;
      this.builtThisFrame = true;
      const L = LAYERS[li], res = this.layerRes;
      const canvas = makeCanvas(L.period * res, L.height * res);
      const g = canvas.getContext('2d');
      g.setTransform(res, 0, 0, res, 0, 0);
      PAINTERS[li](g, L.period, L.height, si);
      sp = { canvas, res, skirt: rgb(SKIRT[li](si)) };
      this.layerSprites.set(key, sp);
      return sp;
    }

    // Parallax scenery, drawn into the scene (it gets the scene's lighting). v is the WorldView.
    drawBackdrop(g, v) {
      const ss = this.ss, pal = this.pal, dpr = v.dpr;
      const res = Math.min(2, Math.max(1, Math.round(v.fit.zoom * dpr * 4) / 4));
      if (res !== this.layerRes) this.layerRes = res;
      this.builtThisFrame = false;
      // Drop sprites of seasons no longer needed
      if (this.layerSprites.size > 6) {
        for (const key of [...this.layerSprites.keys()]) {
          const si = key % 4;
          if (si !== ss.cur && si !== ss.next) this.layerSprites.delete(key);
        }
      }
      g.setTransform(1, 0, 0, 1, 0, 0);
      const W = v.canvas.width, Hd = v.canvas.height;
      for (let li = 0; li < LAYERS.length; li++) {
        const L = LAYERS[li];
        const s = this.layerScale(v, L.f);
        const baseY = this.layerBaseY(v, L);
        const topY = baseY - L.height * s;
        if (topY * dpr > Hd) continue;
        this._drawLayer(g, v, li, ss.cur, 1, s, baseY, true);
        if (ss.blend > 0.001) this._drawLayer(g, v, li, ss.next, ss.blend, s, baseY, false);
        else if (ss.prefetch) this._layerSprite(li, ss.next, false);
        // Aerial perspective: tint everything drawn so far towards the horizon colour. The whole
        // canvas is filled (source-atop touches only existing pixels), so farther layers collect
        // more haze without seams.
        g.globalCompositeOperation = 'source-atop';
        g.globalAlpha = L.haze * (0.85 + pal.night * 0.3);
        g.fillStyle = pal.hazeCss;
        g.fillRect(0, 0, W, Hd);
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = 1;
      }
    }

    // One layer as a horizontally repeating pattern (seamless at any scale)
    _drawLayer(g, v, li, si, alpha, s, baseY, force) {
      const sp = this._layerSprite(li, si, force);
      if (!sp) return;
      const L = LAYERS[li], dpr = v.dpr;
      const W = v.canvas.width, Hd = v.canvas.height;
      if (!sp.pattern) sp.pattern = g.createPattern(sp.canvas, 'repeat-x');
      const lx0 = v.cam.x * L.f - v.w / 2 / s + li * 377; // layer x at the screen's left edge
      const y0 = (baseY - L.height * s) * dpr, y1 = Math.round(baseY * dpr);
      const k = (s * dpr) / sp.res;
      const m = this.matrix || (this.matrix = new DOMMatrix());
      m.a = k; m.b = 0; m.c = 0; m.d = k; m.e = -lx0 * s * dpr; m.f = y0;
      sp.pattern.setTransform(m);
      g.globalAlpha = alpha;
      g.fillStyle = sp.pattern;
      g.fillRect(0, Math.max(0, Math.floor(y0)), W, y1 - Math.max(0, Math.floor(y0)));
      // A skirt below the sprite so the layer never leaves a gap above low ground
      if (y1 < Hd) {
        g.fillStyle = sp.skirt;
        g.fillRect(0, y1 - 1, W, Hd - y1 + 1);
      }
      g.globalAlpha = 1;
    }

    _cloudSprites(res) {
      const pal = this.pal;
      // Re-tint only when the colours have visibly changed
      const q = c => ((c[0] >> 3) << 10) | ((c[1] >> 3) << 5) | (c[2] >> 3);
      const key = q(pal.lit) + ':' + q(pal.shd) + ':' + res;
      if (key !== this.cloudKey) {
        this.cloudKey = key;
        this.cloudSprites = this.cloudShapes.map(sh => paintCloud(sh, pal.lit, pal.shd, res));
      }
      return this.cloudSprites;
    }

    // Everything above the scenery, painted *behind* what is already on the canvas
    // ('destination-over'), front to back: clouds, moon, sun, stars, then the gradient.
    drawSky(g, v, t) {
      const pal = this.pal, dpr = v.dpr, w = v.w, h = v.h;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.globalCompositeOperation = 'destination-over';
      const hy = this.horizonY(v);
      const arc = Math.max(120, hy - h * 0.1);
      const sc = Math.min(1.4, Math.max(0.8, Math.sqrt(v.cam.zoom)));

      // Clouds drift with the wind and barely move with the camera
      const ss = this.ss;
      const count = [7, 5, 9, 9][ss.cur];
      const res = Math.min(2, dpr);
      const sprites = this._cloudSprites(res);
      const span = w + 700;
      g.globalAlpha = 0.9 - pal.night * 0.25;
      for (let i = 0; i < count; i++) {
        const c = this.clouds[i], sp = sprites[c.shape];
        const cs = c.scale * sc;
        let x = (c.x * span + t * c.speed - v.cam.x * 0.04 * v.cam.zoom) % span;
        if (x < 0) x += span;
        x -= 350;
        const y = hy * c.y + (1 - c.y) * 20 - (v.cam.y - v.fit.centerY) * 0.04 * v.cam.zoom;
        g.drawImage(sp.canvas, x - sp.w / 2 * cs, y - sp.top * cs, sp.w * cs, sp.h * cs);
      }
      g.globalAlpha = 1;

      // Moon: opposite the sun, with its phase
      const th = ((v.world.clock && v.world.clock.phase) || 0.5) - 0.25;
      const mr = 13 * sc;
      const mx = w / 2 + Math.cos(th * TAU) * w * 0.42;
      const my = hy + pal.elevation * arc * 0.92;
      if (pal.elevation > -0.95 && my < hy + mr * 2) {
        const key = Math.round(pal.moonPhase * 48) + mr * 1000 + dpr * 1e6;
        if (key !== this.moonKey) { this.moonKey = key; this.moonSprite = paintMoon(Math.round(pal.moonPhase * 48) / 48, mr, dpr); }
        const ms = this.moonSprite.width / dpr;
        g.globalAlpha = 0.35 + pal.night * 0.65;
        g.drawImage(this.moonSprite, mx - ms / 2, my - ms / 2, ms, ms);
        g.globalAlpha = 1;
        const halo = g.createRadialGradient(mx, my, mr, mx, my, mr * 5);
        halo.addColorStop(0, 'rgba(210,222,255,' + (0.22 * pal.night).toFixed(3) + ')');
        halo.addColorStop(1, 'rgba(210,222,255,0)');
        g.fillStyle = halo;
        g.fillRect(mx - mr * 5, my - mr * 5, mr * 10, mr * 10);
      }

      // Sun: x follows the time of day, height follows the clock's sun elevation
      const sr = 17 * sc;
      const sx = w / 2 - Math.cos(th * TAU) * w * 0.42;
      const sy = hy - pal.elevation * arc;
      if (sy < hy + sr * 3) {
        const sun = pal.sun;
        g.fillStyle = rgba(mix(sun, [255, 255, 255], 0.5), 1);
        g.beginPath(); g.arc(sx, sy, sr * 0.72, 0, TAU); g.fill();
        g.fillStyle = rgb(sun);
        g.beginPath(); g.arc(sx, sy, sr, 0, TAU); g.fill();
        const low = 1 - pal.day * 0.5;
        const glow = g.createRadialGradient(sx, sy, sr, sx, sy, sr * (6 + low * 5));
        glow.addColorStop(0, rgba(sun, 0.5));
        glow.addColorStop(0.35, rgba(sun, 0.16 * low + 0.06));
        glow.addColorStop(1, rgba(sun, 0));
        g.fillStyle = glow;
        const gr = sr * (6 + low * 5);
        g.fillRect(sx - gr, sy - gr, gr * 2, gr * 2);
      }

      // Stars twinkle at night, fading towards the horizon; now and then one shoots
      if (pal.stars > 0.01) {
        const st = this.stars, span2 = w + 200, drift = t * 0.6 - v.cam.x * 0.01;
        g.fillStyle = '#f4f6ff';
        for (let i = 0; i < st.length; i += 5) {
          const v01 = st[i + 1];
          const sy2 = v01 * hy;
          let x = (st[i] * span2 + drift) % span2;
          if (x < 0) x += span2;
          x -= 100;
          const a = pal.stars * st[i + 3] * (0.62 + 0.38 * Math.sin(t * (1.3 + st[i + 3] * 2) + st[i + 4])) * (1 - v01 * v01 * 0.7);
          if (a < 0.03) continue;
          const s = st[i + 2];
          g.globalAlpha = a;
          g.fillRect(x, sy2, s, s);
          if (s > 1.5) { g.globalAlpha = a * 0.5; g.fillRect(x - 2, sy2 + 0.5, 6, 1); g.fillRect(x + 0.5, sy2 - 2, 1, 6); }
        }
        this._shootingStar(g, t, w, hy, pal.stars);
        g.globalAlpha = 1;
      }

      // The gradient itself
      const top = Math.min(0, hy - Math.max(h, 400));
      const grd = g.createLinearGradient(0, top, 0, hy);
      grd.addColorStop(0, pal.topCss);
      grd.addColorStop(0.62, pal.midCss);
      grd.addColorStop(1, pal.horCss);
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'source-over';
    }

    _shootingStar(g, t, w, hy, a) {
      const s = this.shooting;
      if (t > this.nextShoot) {
        const R = Math.random;
        s.t0 = t; s.x = w * (0.1 + R() * 0.7); s.y = hy * (0.08 + R() * 0.3);
        s.dx = (R() < 0.5 ? -1 : 1) * (260 + R() * 160); s.dy = 90 + R() * 60;
        this.nextShoot = t + 7 + R() * 16;
      }
      const u = (t - s.t0) / 0.9;
      if (u < 0 || u > 1) return;
      const x = s.x + s.dx * u, y = s.y + s.dy * u;
      const grad = g.createLinearGradient(x, y, x - s.dx * 0.25, y - s.dy * 0.25);
      grad.addColorStop(0, 'rgba(255,255,255,' + (a * (1 - u)).toFixed(3) + ')');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.globalAlpha = 1;
      g.strokeStyle = grad;
      g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x - s.dx * 0.25, y - s.dy * 0.25); g.stroke();
    }
  }

  Evo.Sky = Sky;
  Evo.Sky.seasonState = seasonState;
  Evo.Sky.SEASON_KEYS = SEASON_KEYS;
  Evo.Sky.LAYERS = LAYERS;
  // Shared by the renderers (not part of the simulation)
  Evo.Sky.util = { rng, makeCanvas, mixInto, rgb, rgba, mix, scale, smooth, clamp01 };
})(globalThis.Evo);
