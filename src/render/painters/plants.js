// Plant painters: fruit and mimic trees, grass clumps, reeds and the thornbush, in each season.
// A *Structure(f) function fixes a plant's shape once (seeded by its id); the painter then draws
// it for a season (the thornbush has none: paintThorn draws it directly). Local coordinates: origin
// at the plant's base (f.x, f.y), y up is negative.
(function (Evo) {
  'use strict';
  const { TAU, clamp01, mulberry32: rng } = Evo.util;
  const { rgb, rgba, mix, scale } = Evo.color;
  const { GROUND, DETAIL, SNOW, circle, isWarm, flower } = Evo.Paint;
  const { SPRING, AUTUMN, WINTER } = Evo.SEASON;

  const CANOPY = { // [base, dark, light] per season; autumn picks per clump
    fruit: [
      [[110, 188, 84], [66, 138, 62], [176, 224, 120]],
      [[70, 152, 64], [40, 104, 50], [122, 194, 96]],
      null,
      null,
    ],
    mimic: [
      [[96, 170, 104], [56, 118, 86], [160, 212, 150]],
      [[62, 136, 92], [36, 90, 72], [112, 180, 128]],
      null,
      null,
    ],
  };
  const AUTUMN_LEAVES = { fruit: [[226, 128, 52], [234, 176, 64], [196, 78, 46], [206, 150, 60]], mimic: [[168, 72, 104], [136, 64, 120], [204, 96, 84], [182, 110, 70]] };
  const BLOSSOM = { fruit: ['#ffd3e3', '#fff1f6', '#f5a8c6'], mimic: ['#eadcff', '#f8f2ff', '#cdb4ef'] };

  function treeStructure(f) {
    const R = rng(1000 + (f.id | 0) * 31);
    const H = f.height, cr = f.canopy;
    const cy = -H + cr * 0.86; // the crown's top reaches about f.height
    const branches = [];
    const grow = (x, y, a, len, w, depth) => {
      let ex = x + Math.sin(a) * len, ey = y - Math.cos(a) * len;
      // Keep the tips inside the crown
      const ox = ex / (cr * 1.18), oy = (ey - cy) / (cr * 0.95);
      const d = Math.hypot(ox, oy);
      if (d > 1) { ex = ex / d; ey = cy + (ey - cy) / d; }
      branches.push({ x0: x, y0: y, x1: ex, y1: ey, w, depth });
      if (depth < 3) {
        const n = depth < 1 ? 3 : 2;
        for (let k = 0; k < n; k++) grow(ex, ey, a + (k - (n - 1) / 2) * (0.62 + R() * 0.3) + (R() - 0.5) * 0.3, len * (0.55 + R() * 0.15), w * 0.62, depth + 1);
      }
    };
    const trunkTop = cy + cr * 0.3;
    const mains = 4 + ((R() * 2) | 0);
    for (let k = 0; k < mains; k++) {
      const a = (k / (mains - 1) - 0.5) * 2.1 + (R() - 0.5) * 0.25;
      grow(0, trunkTop + Math.abs(a) * 10, a, cr * (0.5 + R() * 0.2), Math.max(3, cr * 0.075), 0);
    }
    // Leaf clumps: a big core, a ring around it, and a few on top for a rounded crown
    const clumps = [{ x: 0, y: cy, r: cr * 0.55, c: 1 }];
    const ring = 13;
    for (let k = 0; k < ring; k++) {
      const a = (k / ring) * TAU + (R() - 0.5) * 0.35;
      const d = cr * (0.55 + R() * 0.18);
      clumps.push({ x: Math.cos(a) * d * 1.08, y: cy + Math.sin(a) * d * 0.7, r: cr * (0.28 + R() * 0.12), c: (R() * 4) | 0 });
    }
    for (let k = 0; k < 7; k++) {
      const a = R() * TAU, d = cr * R() * 0.45;
      clumps.push({ x: Math.cos(a) * d, y: cy + Math.sin(a) * d * 0.7 - cr * 0.1, r: cr * (0.26 + R() * 0.1), c: (R() * 4) | 0 });
    }
    for (let k = 0; k < 4; k++) clumps.push({ x: (k - 1.5) * cr * 0.34, y: cy - cr * 0.52 + Math.abs(k - 1.5) * cr * 0.08, r: cr * 0.27, c: (R() * 4) | 0 });
    clumps.sort((a, b) => a.y - b.y);
    const dots = [];
    for (let k = 0; k < 200; k++) {
      const c = clumps[(R() * clumps.length) | 0];
      const a = R() * TAU, d = Math.sqrt(R()) * c.r * 0.92;
      dots.push({ x: c.x + Math.cos(a) * d, y: c.y + Math.sin(a) * d, r: 1.1 + R() * 1.5, k: R(), a: R() * TAU });
    }
    const fruit = [];
    for (let k = 0; k < 11; k++) {
      const c = clumps[1 + ((R() * (clumps.length - 1)) | 0)];
      const a = 0.3 + R() * 2.5;
      fruit.push({ x: c.x + Math.cos(a) * c.r * 0.62, y: c.y + Math.sin(a) * c.r * 0.55 + 2 });
    }
    fruit.sort((a, b) => a.y - b.y);
    return { H, cr, cy, trunkTop, branches, clumps, dots, fruit };
  }

  function paintTree(g, f, si, rec) {
    const s = rec.data, mimic = f.species === 'mimic';
    const { cr, cy, trunkTop } = s;
    const R = rng(2000 + (f.id | 0) * 13 + si);
    const bark = mimic ? [104, 78, 80] : [124, 86, 56];
    const barkDark = scale(bark, 0.62), barkLight = mix(bark, [255, 232, 200], 0.22);
    // Trunk with flared roots
    const tw = Math.max(9, cr * 0.2);
    const tg = g.createLinearGradient(-tw, 0, tw, 0);
    tg.addColorStop(0, rgb(barkLight));
    tg.addColorStop(0.45, rgb(bark));
    tg.addColorStop(1, rgb(barkDark));
    g.fillStyle = tg;
    g.beginPath();
    g.moveTo(-tw * 1.6, 3);
    g.quadraticCurveTo(-tw * 0.62, 0, -tw * 0.55, -tw * 1.3);
    g.bezierCurveTo(-tw * 0.45, (trunkTop - tw) * 0.5, -tw * 0.42, trunkTop + 20, -tw * 0.3, trunkTop);
    g.lineTo(tw * 0.3, trunkTop);
    g.bezierCurveTo(tw * 0.42, trunkTop + 20, tw * 0.45, (trunkTop - tw) * 0.5, tw * 0.55, -tw * 1.3);
    g.quadraticCurveTo(tw * 0.62, 0, tw * 1.6, 3);
    g.closePath();
    g.fill();
    g.strokeStyle = rgba(barkDark, 0.85);
    g.lineWidth = 1.2;
    g.stroke();
    // Bark grain
    g.strokeStyle = rgba(barkDark, 0.6);
    g.lineWidth = 1;
    g.beginPath();
    for (let k = 0; k < 5; k++) {
      const x = -tw * 0.3 + k * tw * 0.15;
      g.moveTo(x, -4 - R() * 6);
      g.bezierCurveTo(x + 2, trunkTop * 0.3, x - 2, trunkTop * 0.6, x + (R() - 0.5) * 3, trunkTop * (0.7 + R() * 0.2));
    }
    g.stroke();
    // A knot hole
    g.fillStyle = rgb(scale(bark, 0.35));
    g.beginPath(); g.ellipse(tw * 0.08, trunkTop * 0.42, tw * 0.13, tw * 0.2, 0, 0, TAU); g.fill();
    // Branches
    const winter = si === WINTER;
    const autumn = si === AUTUMN;
    g.lineCap = 'round';
    for (const b of s.branches) {
      if (!winter && b.depth > 1) continue;
      g.strokeStyle = rgb(b.depth ? bark : barkLight);
      g.lineWidth = b.w;
      g.beginPath(); g.moveTo(b.x0, b.y0); g.lineTo(b.x1, b.y1); g.stroke();
    }
    if (winter) {
      // Snow along the upper side of the branches, a mound at the foot
      g.strokeStyle = 'rgba(248,251,255,0.95)';
      for (const b of s.branches) {
        if (Math.abs(b.x1 - b.x0) < Math.abs(b.y1 - b.y0) * 0.35) continue;
        g.lineWidth = Math.max(1, b.w * 0.55);
        g.beginPath(); g.moveTo(b.x0, b.y0 - b.w * 0.45); g.lineTo(b.x1, b.y1 - b.w * 0.45); g.stroke();
      }
      g.fillStyle = SNOW.body;
      g.beginPath(); g.ellipse(0, 2, tw * 2.2, 6, 0, Math.PI, TAU); g.fill();
      // A few last leaves
      g.fillStyle = mimic ? '#8a5a7a' : '#a0643a';
      for (let k = 0; k < 4; k++) {
        const b = s.branches[(R() * s.branches.length) | 0];
        g.beginPath(); g.ellipse(b.x1, b.y1 + 2, 2.4, 1.3, R() * 3, 0, TAU); g.fill();
      }
      return;
    }
    // Canopy: clumps shaded dark → base → highlight, then leaf texture
    const kind = mimic ? 'mimic' : 'fruit';
    const cols = CANOPY[kind][si];
    const autumnCols = AUTUMN_LEAVES[kind];
    // Autumn thins the crown and turns it: warmer and lighter towards the top
    const clumps = autumn ? s.clumps.filter((c, i) => i === 0 || (i * 7 + (f.id | 0)) % 6 !== 0) : s.clumps;
    const tone = c => {
      if (!autumn) return cols[0];
      const u = clamp01((c.y - (cy - cr)) / (cr * 1.7)); // 0 top .. 1 bottom
      const a = autumnCols[c.c % 2], b = autumnCols[2 + (c.c >> 1) % 2];
      return mix(mix(a, b, u * 0.8), [255, 230, 160], 0.08 * (c.c % 3));
    };
    // The crown as one mass: a dark underlayer for depth, the clumps in their own colours,
    // then one sweep of light from the upper left and shade to the lower right across it all.
    const crown = new Path2D();
    for (const c of clumps) circle(crown, c.x, c.y, c.r);
    g.fillStyle = rgb(autumn ? scale(autumnCols[2], 0.45) : scale(cols[1], 0.7));
    g.save();
    g.translate(1.5, 3);
    g.fill(crown);
    g.restore();
    // Each clump in turn (top to bottom) with a lit upper rim and a shaded lower rim; the clumps in
    // front cover the rims behind them, so the crown reads as bunches of leaves
    const lit = autumn ? [255, 236, 170] : cols[2], shade = autumn ? scale(autumnCols[2], 0.45) : cols[1];
    const litRim = rgba(lit, 0.5), shadeRim = rgba(shade, 0.5);
    g.lineWidth = Math.max(1.4, cr * 0.03);
    for (const c of clumps) {
      g.fillStyle = rgb(tone(c));
      g.beginPath(); circle(g, c.x, c.y, c.r); g.fill();
      g.strokeStyle = shadeRim;
      g.beginPath(); g.arc(c.x, c.y, c.r * 0.9, 0.35, 2.3); g.stroke();
      g.strokeStyle = litRim;
      g.beginPath(); g.arc(c.x, c.y, c.r * 0.84, 3.75, 4.75); g.stroke();
    }
    g.save();
    g.clip(crown);
    const lg = g.createLinearGradient(-cr * 0.9, cy - cr * 0.9, cr * 0.8, cy + cr * 0.8);
    lg.addColorStop(0, rgba(lit, 0.45));
    lg.addColorStop(0.42, rgba(lit, 0));
    lg.addColorStop(0.58, rgba(shade, 0));
    lg.addColorStop(1, rgba(shade, 0.62));
    g.fillStyle = lg;
    g.fillRect(-cr * 1.5, cy - cr * 1.5, cr * 3, cr * 3);
    g.restore();
    // Leaf texture: small leaves, dark in the shade, bright in the light
    const leafDark = mimic ? 'rgba(60,24,80,0.22)' : autumn ? 'rgba(110,40,20,0.24)' : 'rgba(18,48,22,0.2)';
    const leafLight = autumn ? 'rgba(255,236,170,0.3)' : 'rgba(240,255,210,0.24)';
    for (let pass = 0; pass < 2; pass++) {
      g.fillStyle = pass ? leafLight : leafDark;
      g.beginPath();
      for (const d of s.dots) {
        const up = d.y < cy - cr * 0.1 + d.k * cr * 0.4;
        if (up !== !!pass) continue;
        g.moveTo(d.x + d.r * 1.3, d.y);
        g.ellipse(d.x, d.y, d.r * 1.3, d.r * 0.6, d.a, 0, TAU);
      }
      g.fill();
    }
    if (si === SPRING) { // Blossom: small five-petalled flowers, thicker towards the sunny top
      const bl = BLOSSOM[kind], low = cy + cr * 0.3; // none below low
      const open = []; // indices of the dots in flower; dot k takes colour k % 3
      for (let k = 0; k < s.dots.length; k++) {
        const d = s.dots[k];
        if (d.y <= low && d.k <= 0.35 + (low - d.y) / (cr * 2.2)) open.push(k);
      }
      for (let c = 0; c < 3; c++) {
        g.fillStyle = bl[c];
        g.beginPath();
        for (const k of open) {
          if (k % 3 !== c) continue;
          const d = s.dots[k], pr = 0.75 + d.r * 0.28;
          flower(g, d.x, d.y - 1, pr, pr * 0.8, d.a);
        }
        g.fill();
      }
      g.fillStyle = '#f7c948';
      g.beginPath();
      for (const k of open) circle(g, s.dots[k].x, s.dots[k].y - 1, 0.55);
      g.fill();
    }
    // Tufts where the trunk meets the ground
    g.strokeStyle = GROUND[si].tufts[0];
    g.lineWidth = 1.1;
    g.beginPath();
    for (let k = 0; k < 9; k++) {
      const x = (k - 4) * tw * 0.4;
      g.moveTo(x, 3); g.quadraticCurveTo(x + (k - 4) * 0.3, -2, x + (k - 4) * 0.8, -5 - (k % 3) * 1.5);
    }
    g.stroke();
  }

  function grassStructure(f) {
    const R = rng(3000 + (f.id | 0) * 17);
    const w = f.width, h = f.height;
    const blades = [];
    const n = Math.round(w / 2);
    for (let k = 0; k < n; k++) {
      const x = (R() - 0.5) * w;
      const env = 1 - Math.pow((2 * x) / w, 2);
      blades.push({ x, h: h * (0.35 + 0.65 * env) * (0.7 + R() * 0.45), lean: (R() - 0.5) * 0.5 + (x / w) * 0.6, bw: 1.2 + R() * 1.1, layer: (R() * 3) | 0 });
    }
    const heads = [];
    const m = Math.max(3, Math.round(w / 13));
    for (let k = 0; k < m; k++) {
      const x = ((k + 0.5) / m - 0.5) * w * 0.85 + (R() - 0.5) * 6;
      const env = 1 - Math.pow((2 * x) / w, 2);
      heads.push({ x, h: h * (0.85 + 0.35 * env) + R() * 6, lean: (R() - 0.5) * 0.35 + (x / w) * 0.4 });
    }
    // Show heads in a scattered order as `seeding` rises
    for (let k = heads.length - 1; k > 0; k--) { const j = (R() * (k + 1)) | 0; const t = heads[k]; heads[k] = heads[j]; heads[j] = t; }
    return { w, h, blades, heads };
  }

  const GRASS_COLS = [
    ['#4f9a3c', '#6cb84a', '#8fd062'],
    ['#3f8634', '#579f40', '#77bb52'],
    ['#9c8a44', '#b9a254', '#d4bc6c'],
    ['#9d9170', '#b5a882', '#cdc09a'],
  ];
  function paintGrass(g, f, si, rec) {
    const s = rec.data;
    const cols = GRASS_COLS[si];
    for (let layer = 0; layer < 3; layer++) {
      g.fillStyle = cols[layer];
      g.beginPath();
      for (const b of s.blades) {
        if (b.layer !== layer) continue;
        const tx = b.x + b.lean * b.h, ty = -b.h;
        g.moveTo(b.x - b.bw, 2);
        g.quadraticCurveTo(b.x - b.bw * 0.2 + b.lean * b.h * 0.3, -b.h * 0.55, tx, ty);
        g.quadraticCurveTo(b.x + b.bw * 0.4 + b.lean * b.h * 0.3, -b.h * 0.5, b.x + b.bw, 2);
      }
      g.fill();
    }
    if (si === WINTER) {
      g.fillStyle = SNOW.body;
      g.beginPath(); g.ellipse(0, 2, s.w * 0.55, 6, 0, Math.PI, TAU); g.fill();
      g.fillStyle = SNOW.top;
      g.beginPath();
      for (let k = 0; k < s.blades.length; k += 4) { const b = s.blades[k]; circle(g, b.x + b.lean * b.h * 0.8, -b.h * 0.8, 1.4); }
      g.fill();
    }
  }

  function reedStructure(f) {
    const R = rng(6000 + (f.id | 0) * 19);
    const w = f.width;
    const leaves = [], stems = [];
    const n = Math.round(w / 3.5) + 5;
    for (let k = 0; k < n; k++) leaves.push({ x: (R() - 0.5) * w, h: 34 + R() * 42, lean: (R() - 0.5) * 0.7 });
    const m = Math.round(w / 9) + 2;
    for (let k = 0; k < m; k++) stems.push({ x: (R() - 0.5) * w * 0.8, h: 52 + R() * 38, lean: (R() - 0.5) * 0.25 });
    return { w, leaves, stems };
  }

  const REED_COLS = [['#5e9e48', '#7cba58'], ['#4a8a3c', '#66a64c'], ['#a89048', '#c4aa5c'], ['#b8a67c', '#d2c296']];
  function paintReeds(g, f, si, rec) {
    const s = rec.data;
    const cols = REED_COLS[si];
    for (let pass = 0; pass < 2; pass++) {
      g.fillStyle = cols[pass];
      g.beginPath();
      for (let k = pass; k < s.leaves.length; k += 2) {
        const l = s.leaves[k];
        const tx = l.x + l.lean * l.h, ty = -l.h;
        g.moveTo(l.x - 1.4, 3);
        g.quadraticCurveTo(l.x + l.lean * l.h * 0.15, -l.h * 0.6, tx, ty);
        g.quadraticCurveTo(l.x + l.lean * l.h * 0.15 + 1.6, -l.h * 0.55, l.x + 1.4, 3);
      }
      g.fill();
    }
    for (const st of s.stems) {
      const tx = st.x + st.lean * st.h;
      g.strokeStyle = cols[0];
      g.lineWidth = 1.3;
      g.beginPath(); g.moveTo(st.x, 3); g.quadraticCurveTo(st.x, -st.h * 0.5, tx, -st.h - 7); g.stroke();
      // Cattail head
      const hx = st.x + (tx - st.x) * 0.85, hy = -st.h * 0.86;
      g.fillStyle = DETAIL.cattail[si];
      g.beginPath(); g.ellipse(hx, hy, 2.6, 7.5, st.lean * 0.8, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,230,200,0.25)';
      g.beginPath(); g.ellipse(hx - 0.8, hy - 1.5, 0.9, 4.5, st.lean * 0.8, 0, TAU); g.fill();
      if (si === WINTER) { g.fillStyle = SNOW.top; g.beginPath(); g.ellipse(hx, hy - 6.5, 2.4, 1.3, 0, 0, TAU); g.fill(); }
    }
  }

  // A bramble: a low, leafy mound in dark plum with thorny canes arching out of it. Purple and
  // spiky so it reads as "don't touch" at any size; in winter only the tangle of canes is left.
  function paintThorn(g, f, si) {
    const R = rng(7000 + (f.id | 0) * 23);
    const r = f.radius;
    const winter = si === WINTER;
    const leaf = DETAIL.thornLeaf[si];
    const mr = r * 1.05; // the mound's radius
    // Canes rise from the base, arch over and come down beside the mound
    const canes = [];
    const n = winter ? 11 : 8;
    for (let k = 0; k < n; k++) {
      const side = k % 2 ? 1 : -1;
      const sx = (R() - 0.5) * mr * 1.1, sy = -mr * (winter ? R() * 0.2 : 0.2 + R() * 0.3);
      const ex = side * mr * (0.85 + R() * 0.55), ey = -mr * (0.08 + R() * 0.4);
      canes.push({ sx, sy, cx: (sx + ex) / 2 + side * mr * 0.15, cy: -mr * (1.1 + R() * 0.45), ex, ey, back: k % 3 === 0, w: 1.5 + R() * 0.8 });
    }
    const P = [0, 0, 0];
    const caneAt = (c, u) => {
      const v = 1 - u;
      P[0] = v * v * c.sx + 2 * v * u * c.cx + u * u * c.ex;
      P[1] = v * v * c.sy + 2 * v * u * c.cy + u * u * c.ey;
      P[2] = Math.atan2(2 * v * (c.cy - c.sy) + 2 * u * (c.ey - c.cy), 2 * v * (c.cx - c.sx) + 2 * u * (c.ex - c.cx));
      return P;
    };
    const drawCanes = back => {
      g.lineCap = 'round';
      for (const c of canes) {
        if (c.back !== back) continue;
        g.strokeStyle = back ? '#4a2446' : '#7a3f70';
        g.lineWidth = c.w;
        g.beginPath(); g.moveTo(c.sx, c.sy); g.quadraticCurveTo(c.cx, c.cy, c.ex, c.ey); g.stroke();
      }
      // Thorns: pale, sharp, alternating along the outer half of each cane
      g.beginPath();
      for (const c of canes) {
        if (c.back !== back) continue;
        for (let u = 0.25, k = 0; u < 1.001; u += 0.105, k++) {
          caneAt(c, Math.min(1, u));
          const a = P[2] + (k % 2 ? -1.1 : 1.1), len = r * 0.15 + (k % 3) * 0.5;
          g.moveTo(P[0] + Math.cos(a + 1.57) * 1.1, P[1] + Math.sin(a + 1.57) * 1.1);
          g.lineTo(P[0] + Math.cos(a) * len, P[1] + Math.sin(a) * len);
          g.lineTo(P[0] + Math.cos(a - 1.57) * 1.1, P[1] + Math.sin(a - 1.57) * 1.1);
          g.closePath();
        }
        caneAt(c, 1);
        g.moveTo(P[0] + Math.cos(P[2] + 1.57) * 1, P[1] + Math.sin(P[2] + 1.57) * 1);
        g.lineTo(P[0] + Math.cos(P[2]) * 4, P[1] + Math.sin(P[2]) * 4);
        g.lineTo(P[0] + Math.cos(P[2] - 1.57) * 1, P[1] + Math.sin(P[2] - 1.57) * 1);
        g.closePath();
      }
      g.fillStyle = back ? '#c7afd0' : '#f6eafc';
      g.fill();
      g.strokeStyle = 'rgba(56,22,62,0.8)';
      g.lineWidth = 0.6;
      g.stroke();
    };
    drawCanes(true);
    if (winter) {
      // Dry leaves at the foot, the bare tangle, snow caught on top
      g.fillStyle = '#6a4a5e';
      g.beginPath(); g.ellipse(0, 2, mr * 0.75, mr * 0.3, 0, Math.PI, TAU); g.fill();
      drawCanes(false);
      g.fillStyle = SNOW.body;
      g.beginPath();
      g.ellipse(0, 1, mr * 0.72, mr * 0.2, 0, Math.PI, TAU);
      for (const c of canes) { caneAt(c, 0.45); g.moveTo(P[0] + 4.5, P[1] - 0.5); g.ellipse(P[0], P[1] - 0.5, 4.5, 2, 0, Math.PI, TAU); }
      g.fill();
      return;
    }
    // The mound: an outline of pointed leaf lobes
    const mound = new Path2D();
    const N = 24;
    let prev = null;
    for (let k = 0; k <= N; k++) {
      const a = Math.PI + (k / N) * Math.PI, tip = k % 2 === 1;
      const rr = (tip ? 1.06 : 0.9) + (R() - 0.5) * 0.08;
      const x = Math.cos(a) * mr * rr, y = Math.min(2, Math.sin(a) * mr * rr);
      if (!prev) mound.moveTo(x, 2);
      else {
        const mx = (prev[0] + x) / 2, my = (prev[1] + y) / 2;
        const ox = Math.cos(a - Math.PI / N) * 3.2, oy = Math.sin(a - Math.PI / N) * 3.2;
        mound.quadraticCurveTo(mx + ox, my + oy, x, y);
      }
      prev = [x, y];
    }
    mound.closePath();
    const mg = g.createLinearGradient(0, -mr, 0, 2);
    mg.addColorStop(0, rgb(leaf[1]));
    mg.addColorStop(1, rgb(scale(leaf[0], 0.8)));
    g.fillStyle = mg;
    g.fill(mound);
    g.strokeStyle = rgba(scale(leaf[0], 0.6), 0.9);
    g.lineWidth = 1;
    g.stroke(mound);
    // Leaves on the mound: almond shapes pointing outward, lighter towards the top
    for (let k = 0; k < 16; k++) {
      const u = R(), a = Math.PI * (1.1 + u * 0.8);
      const d = 0.35 + R() * 0.5;
      const x = Math.cos(a) * mr * d, y = Math.sin(a) * mr * d - 2;
      const b = a + (R() - 0.5) * 0.8, L = r * (0.22 + R() * 0.08), W = L * 0.42;
      const top = clamp01(-y / mr);
      g.fillStyle = rgb(mix(leaf[1], leaf[2], top * 0.8));
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + Math.cos(b) * L * 0.5 - Math.sin(b) * W, y + Math.sin(b) * L * 0.5 + Math.cos(b) * W, x + Math.cos(b) * L, y + Math.sin(b) * L);
      g.quadraticCurveTo(x + Math.cos(b) * L * 0.5 + Math.sin(b) * W, y + Math.sin(b) * L * 0.5 - Math.cos(b) * W, x, y);
      g.fill();
      g.strokeStyle = rgba(leaf[0], 0.7);
      g.lineWidth = 0.6;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(b) * L * 0.8, y + Math.sin(b) * L * 0.8); g.stroke();
    }
    if (isWarm(si)) { // a few pale violet flowers
      g.fillStyle = '#eadbf8';
      g.beginPath();
      for (let k = 0; k < 4; k++) {
        const a = Math.PI * (1.2 + k * 0.2), x = Math.cos(a) * mr * 0.6, y = Math.sin(a) * mr * 0.72;
        flower(g, x, y, 1.4, 1.1);
      }
      g.fill();
      g.fillStyle = '#f7c948';
      g.beginPath();
      for (let k = 0; k < 4; k++) { const a = Math.PI * (1.2 + k * 0.2); circle(g, Math.cos(a) * mr * 0.6, Math.sin(a) * mr * 0.72, 0.6); }
      g.fill();
    }
    drawCanes(false);
  }

  Object.assign(Evo.Paint, { treeStructure, paintTree, grassStructure, paintGrass, reedStructure, paintReeds, paintThorn });
})(globalThis.Evo);
