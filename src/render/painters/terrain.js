// Terrain painters: the soil, strata, pebbles and turf (or snow) of one terrain tile, the
// half-buried stones and the sandstone cliffs at the world's edges. buildTerrain() derives the
// fixed decoration lists from world.terrain once; paintTile() draws a tile from them per season.
(function (Evo) {
  'use strict';
  const { TAU, clamp, hash2, mulberry32: rng } = Evo.util;
  const { rgb, rgba, mix, scale } = Evo.color;
  const { GROUND, DETAIL, SNOW, ROCK_TONES, circle, flower } = Evo.Paint;
  const { WINTER } = Evo.SEASON;
  const CLIFF_REACH = 110;  // px an edge cliff's art reaches in from its side of the world
  const TILE_MARGIN = 24;   // px of ground a tile paints past its sides (and the view scans for its top)

  const SOIL = {
    grad: [[118, 80, 52], [96, 64, 43], [70, 47, 32], [50, 34, 25]],
    bands: [[134, 94, 62], [80, 54, 37], [146, 108, 74], [70, 48, 34], [120, 86, 60]],
    pebbles: [[160, 148, 134], [128, 118, 106], [178, 168, 152], [108, 100, 92]],
    sand: [196, 172, 124], sandDark: [150, 128, 90],
  };

  // ---------------------------------------------------------------------------------------------
  // Terrain data derived from world.terrain: extents and fixed decoration lists
  function buildTerrain(world) {
    const T = world.terrain, W = world.width, H = world.height;
    const hs = T.heights, n = hs.length, spacing = T.spacing;
    let minS = Infinity, sum = 0;
    for (let i = 0; i < n; i++) {
      const y = hs[i];
      if (y < minS) minS = y;
      sum += y;
    }
    const surf = x => T.groundY(x), waterAt = x => T.waterLevelAt(x); // the world's own queries
    const wet = x => { const l = waterAt(x); return l !== null && surf(x) > l + 0.5; };
    const R = rng(9001 + n);
    const info = { W, H, spacing, minS, meanS: sum / n, surf, waterAt, wet };
    info.cliffTop = Math.max(-240, minS - 360);

    const pebbles = [];
    for (let x = 0; x < W; x += 9 + R() * 12) {
      const depth = H - surf(x);
      const d = 10 + Math.pow(R(), 1.6) * depth;
      const big = R() < 0.08;
      const r = big ? 4 + R() * 5 : 1.2 + R() * 2.6;
      pebbles.push({ x, y: surf(x) + d, rx: r * (1 + R() * 0.5), ry: r, rot: (R() - 0.5) * 0.8, c: (R() * 4) | 0 });
    }
    const tufts = [];
    for (let x = 2; x < W; x += 3 + R() * 6) tufts.push({ x, h: 3 + R() * 6.5, lean: (R() - 0.5) * 0.9, n: 2 + ((R() * 3) | 0), c: (R() * 3) | 0 });
    const flowers = [];
    for (let x = 30; x < W; x += 16 + R() * 64) flowers.push({ x, h: 4 + R() * 7, c: (R() * 4) | 0, r: 1.3 + R() * 0.9 });
    const litter = [];
    for (let x = 4; x < W; x += 5 + R() * 14) litter.push({ x, rot: (R() - 0.5) * 1.2, c: (R() * 4) | 0 });
    const stones = [];
    for (let x = world.terrain.cliffs.width; x < W - world.terrain.cliffs.width; x += 110 + R() * 260) stones.push({ x, r: 4 + R() * 7, tone: (R() * 3) | 0 });
    const roots = [];
    for (let x = 20; x < W; x += 30 + R() * 80) roots.push({ x, len: 8 + R() * 18, curl: (R() - 0.5) * 12 });
    const pockets = [];
    for (let k = 0; k < W / 160; k++) {
      const x = R() * W;
      pockets.push({ x, y: surf(x) + 40 + R() * (H - surf(x) - 40), rx: 10 + R() * 22, ry: 4 + R() * 7 });
    }
    const weeds = [];
    for (let x = 0; x < W; x += 14 + R() * 20) if (wet(x) && surf(x) - waterAt(x) > 10) weeds.push({ x, h: 8 + R() * Math.min(34, surf(x) - waterAt(x) - 4), lean: (R() - 0.5) * 0.6 });
    const fossils = [{ x: W * (0.2 + R() * 0.2), d: 110 + R() * 60, r: 7 }, { x: W * (0.62 + R() * 0.2), d: 150 + R() * 60, r: 5 }];
    const worms = [{ x: W * (0.1 + R() * 0.3), d: 34 + R() * 20 }, { x: W * (0.5 + R() * 0.4), d: 40 + R() * 30 }];
    const bands = [];
    const depths = [26, 58, 104, 164, 236];
    for (let b = 0; b < depths.length; b++) bands.push({ d: depths[b], th: 5 + b * 3.5, c: b % SOIL.bands.length, f1: 0.01 + R() * 0.02, f2: 0.04 + R() * 0.03, p: R() * TAU });

    // Edge cliffs: stacked blocks with ledges, from below the ground up to cliffTop
    const cliffs = [0, 1].map(side => {
      const blocks = [];
      let y = H + 30, d = 70 + R() * 14;
      const top = info.cliffTop;
      while (y > top) {
        const bh = 36 + R() * 44;
        d = clamp(d + (R() - 0.55) * 26, 40, 92);
        blocks.push({ y0: y, y1: Math.max(top, y - bh), d0: d, d1: d - 2 - R() * 7, moss: R() < 0.7, fern: R() < 0.35, vine: R() < 0.25 });
        y -= bh;
      }
      const talus = [];
      const xs = side ? W - 40 : 40;
      for (let k = 0; k < 4; k++) talus.push({ dx: 20 + k * 16 + R() * 12, r: 5 + R() * 8, tone: (R() * 3) | 0 });
      return { side, blocks, talus, base: surf(xs) };
    });

    Object.assign(info, { pebbles, tufts, flowers, litter, stones, roots, pockets, weeds, fossils, worms, bands, cliffs });
    return info;
  }

  // ---------------------------------------------------------------------------------------------
  // Terrain tile painter (world coordinates; the tile's canvas clips to its own rectangle)
  function paintTile(g, info, x0, y0, x1, y1, si) {
    const { surf, wet, W } = info;
    const pal = GROUND[si];
    const xa = Math.max(-2, x0 - TILE_MARGIN), xb = Math.min(W + 2, x1 + TILE_MARGIN);
    const spacing = info.spacing;
    // Soil body
    const soil = new Path2D();
    soil.moveTo(xa, y1 + 4);
    soil.lineTo(xa, surf(xa));
    for (let x = Math.ceil(xa / spacing) * spacing; x < xb; x += spacing) soil.lineTo(x, surf(x));
    soil.lineTo(xb, surf(xb));
    soil.lineTo(xb, y1 + 4);
    soil.closePath();
    const grad = g.createLinearGradient(0, info.minS, 0, info.H);
    grad.addColorStop(0, rgb(SOIL.grad[0]));
    grad.addColorStop(0.25, rgb(SOIL.grad[1]));
    grad.addColorStop(0.65, rgb(SOIL.grad[2]));
    grad.addColorStop(1, rgb(SOIL.grad[3]));
    g.fillStyle = grad;
    g.fill(soil);

    g.save();
    g.clip(soil);
    // Strata: wavy bands that loosely follow the surface
    for (const b of info.bands) {
      g.beginPath();
      const yAt = x => surf(x) * 0.45 + info.meanS * 0.55 + b.d + Math.sin(x * b.f1 + b.p) * 5 + Math.sin(x * b.f2 + b.p * 2) * 2;
      g.moveTo(xa, yAt(xa));
      for (let x = xa; x <= xb; x += 6) g.lineTo(x, yAt(x));
      for (let x = xb; x >= xa; x -= 6) g.lineTo(x, yAt(x) + b.th * (0.75 + 0.25 * Math.sin(x * 0.05 + b.p)));
      g.closePath();
      g.fillStyle = rgba(SOIL.bands[b.c], 0.5);
      g.fill();
      g.strokeStyle = rgba(scale(SOIL.bands[b.c], 0.7), 0.35);
      g.lineWidth = 1;
      g.stroke();
    }
    // Clay pockets
    g.fillStyle = 'rgba(160,118,80,0.32)';
    g.beginPath();
    for (const p of info.pockets) if (p.x > xa - 40 && p.x < xb + 40) { g.moveTo(p.x + p.rx, p.y); g.ellipse(p.x, p.y, p.rx, p.ry, 0, 0, TAU); }
    g.fill();
    // Specks of grit
    const cs = 11;
    const ci0 = Math.floor(x0 / cs), ci1 = Math.ceil(x1 / cs), cj0 = Math.floor(y0 / cs), cj1 = Math.ceil(y1 / cs);
    for (let pass = 0; pass < 2; pass++) {
      g.fillStyle = pass ? 'rgba(210,180,140,0.28)' : 'rgba(30,18,10,0.28)';
      g.beginPath();
      for (let cj = cj0; cj < cj1; cj++) {
        for (let ci = ci0; ci < ci1; ci++) {
          const h = hash2(ci * 3 + pass, cj);
          if (h > 0.5) continue;
          const x = (ci + hash2(ci, cj + 999)) * cs, y = (cj + hash2(ci + 777, cj)) * cs;
          if (y < surf(x) + 6) continue;
          circle(g, x, y, 0.5 + h * 1.6);
        }
      }
      g.fill();
    }
    // Pebbles
    for (const p of info.pebbles) {
      if (p.x < xa - 10 || p.x > xb + 10 || p.y < y0 - 12 || p.y > y1 + 12) continue;
      const col = SOIL.pebbles[p.c];
      g.fillStyle = rgb(scale(col, 0.72));
      g.beginPath(); g.ellipse(p.x + 0.6, p.y + 0.8, p.rx, p.ry, p.rot, 0, TAU); g.fill();
      g.fillStyle = rgb(col);
      g.beginPath(); g.ellipse(p.x, p.y, p.rx, p.ry, p.rot, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.beginPath(); g.ellipse(p.x - p.rx * 0.3, p.y - p.ry * 0.35, p.rx * 0.35, p.ry * 0.3, p.rot, 0, TAU); g.fill();
    }
    // Fossils and worms, for whoever digs with their eyes
    for (const f of info.fossils) {
      if (f.x < xa - 20 || f.x > xb + 20) continue;
      const fy = surf(f.x) + f.d;
      g.strokeStyle = 'rgba(214,196,160,0.8)';
      g.lineWidth = 1.3;
      g.beginPath();
      for (let a = 0; a < TAU * 2.6; a += 0.2) {
        const rr = f.r * (0.15 + a / (TAU * 2.6) * 0.85);
        const x = f.x + Math.cos(a) * rr, y = fy + Math.sin(a) * rr;
        a ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    }
    for (const w of info.worms) {
      if (w.x < xa - 30 || w.x > xb + 30) continue;
      const wy = surf(w.x) + w.d;
      g.lineCap = 'round';
      g.strokeStyle = '#c98a86';
      g.lineWidth = 3.2;
      g.beginPath();
      for (let u = 0; u <= 1.001; u += 0.1) {
        const x = w.x - 12 + u * 24, y = wy + Math.sin(u * 7) * 3;
        u ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
      g.strokeStyle = 'rgba(255,220,214,0.6)';
      g.lineWidth = 1;
      g.stroke();
    }
    // Darker, rooty topsoil under the turf
    g.strokeStyle = 'rgba(38,22,12,0.22)';
    g.lineWidth = 20;
    g.beginPath();
    for (let x = xa; x <= xb; x += 4) (x === xa ? g.moveTo(x, surf(x)) : g.lineTo(x, surf(x)));
    g.stroke();
    g.strokeStyle = 'rgba(58,36,22,0.55)';
    g.lineWidth = 0.9;
    g.beginPath();
    for (const r of info.roots) {
      if (r.x < xa || r.x > xb || wet(r.x)) continue;
      const y = surf(r.x);
      g.moveTo(r.x, y + 2);
      g.quadraticCurveTo(r.x + r.curl, y + r.len * 0.5, r.x + r.curl * 0.3, y + r.len);
      g.moveTo(r.x + r.curl * 0.5, y + r.len * 0.55);
      g.lineTo(r.x + r.curl * 1.1, y + r.len * 0.8);
    }
    g.stroke();
    g.restore();

    // Pond bed: sand and weed instead of turf
    g.lineCap = 'round';
    g.lineJoin = 'round';
    let run = false;
    g.strokeStyle = rgb(SOIL.sand);
    g.lineWidth = 5;
    g.beginPath();
    for (let x = xa; x <= xb; x += 3) {
      const w = wet(x);
      if (w && !run) { g.moveTo(x, surf(x) + 1.5); run = true; } else if (w) g.lineTo(x, surf(x) + 1.5); else run = false;
    }
    g.stroke();
    g.strokeStyle = rgba(SOIL.sandDark, 0.6);
    g.lineWidth = 1.2;
    g.stroke();
    if (si !== WINTER) {
      g.strokeStyle = DETAIL.pondWeed[si];
      g.lineWidth = 1.4;
      g.beginPath();
      for (const wd of info.weeds) {
        if (wd.x < xa || wd.x > xb) continue;
        const y = surf(wd.x);
        for (let k = -1; k <= 1; k++) {
          g.moveTo(wd.x + k * 2, y);
          g.bezierCurveTo(wd.x + k * 2 + 4, y - wd.h * 0.3, wd.x + k * 3 - 4, y - wd.h * 0.6, wd.x + k * 2 + wd.lean * wd.h, y - wd.h * (0.8 + 0.1 * k));
        }
      }
      g.stroke();
    }

    // Turf (or snow) along the dry surface
    const runs = [];
    let cur = null;
    for (let x = xa; x <= xb + 0.01; x += 3) {
      if (!wet(x)) { if (!cur) runs.push(cur = []); cur.push(x); } else cur = null;
    }
    if (si === WINTER) {
      for (const xs of runs) {
        // Soft drifts: thicker in hollows, lumpy on top, a blue shade where they meet the soil
        const topY = x => surf(x) - 5.5 - 2.2 * Math.sin(x * 0.061) - 1.3 * Math.sin(x * 0.23 + 1) - 0.8 * Math.sin(x * 0.53);
        const botY = x => surf(x) + 5 + 1.2 * Math.sin(x * 0.17);
        g.beginPath();
        g.moveTo(xs[0], topY(xs[0]));
        for (const x of xs) g.lineTo(x, topY(x));
        for (let k = xs.length - 1; k >= 0; k--) g.lineTo(xs[k], botY(xs[k]));
        g.closePath();
        g.fillStyle = SNOW.body;
        g.fill();
        g.strokeStyle = SNOW.shade;
        g.lineWidth = 2;
        g.beginPath();
        for (const x of xs) (x === xs[0] ? g.moveTo(x, botY(x) - 0.8) : g.lineTo(x, botY(x) - 0.8));
        g.stroke();
        g.strokeStyle = SNOW.top;
        g.lineWidth = 2.2;
        g.beginPath();
        for (const x of xs) (x === xs[0] ? g.moveTo(x, topY(x) + 1) : g.lineTo(x, topY(x) + 1));
        g.stroke();
        // Glints
        g.fillStyle = 'rgba(190,220,255,0.9)';
        g.beginPath();
        for (let k = 0; k < xs.length; k += 5) {
          const x = xs[k];
          if (hash2(x | 0, 77) > 0.3) continue;
          circle(g, x, topY(x) + 2.5, 0.7);
        }
        g.fill();
      }
    } else {
      // The turf's ragged underside, filled to and then outlined
      const edgeY = x => surf(x) + 5 + 1.4 * Math.sin(x * 0.31) + 0.8 * Math.sin(x * 0.9);
      for (const xs of runs) {
        g.beginPath();
        g.moveTo(xs[0], surf(xs[0]) - 1);
        for (const x of xs) g.lineTo(x, surf(x) - 1);
        for (let k = xs.length - 1; k >= 0; k--) g.lineTo(xs[k], edgeY(xs[k]));
        g.closePath();
        g.fillStyle = rgb(pal.grass);
        g.fill();
        g.strokeStyle = rgba(pal.dark, 0.8);
        g.lineWidth = 1.2;
        g.beginPath();
        for (const x of xs) x === xs[0] ? g.moveTo(x, edgeY(x)) : g.lineTo(x, edgeY(x));
        g.stroke();
        g.strokeStyle = rgb(pal.light);
        g.lineWidth = 1.5;
        g.beginPath();
        for (const x of xs) (x === xs[0] ? g.moveTo(x, surf(x) - 0.6) : g.lineTo(x, surf(x) - 0.6));
        g.stroke();
      }
    }
    // Tufts (dry straw poking through snow in winter)
    for (let c = 0; c < pal.tufts.length; c++) {
      g.strokeStyle = pal.tufts[c];
      g.lineWidth = si === WINTER ? 0.9 : 1.15;
      g.beginPath();
      for (let k = 0; k < info.tufts.length; k++) {
        const t = info.tufts[k];
        if (t.c % pal.tufts.length !== c || t.x < xa || t.x > xb || wet(t.x)) continue;
        if (si === WINTER && k % 3) continue;
        const y = surf(t.x) + 1 - (si === WINTER ? 3 : 0);
        const h = t.h * (si === WINTER ? 0.8 : 1);
        for (let b = 0; b < t.n; b++) {
          const bx = t.x + (b - t.n / 2) * 1.5;
          const tx = bx + t.lean * h + (b - t.n / 2) * 1.1;
          g.moveTo(bx, y);
          g.quadraticCurveTo(bx + t.lean * h * 0.2, y - h * 0.6, tx, y - h);
        }
      }
      g.stroke();
    }
    // Flowers (spring, summer) or fallen leaves (autumn)
    if (pal.flowers) {
      for (const f of info.flowers) {
        if (f.x < xa || f.x > xb || wet(f.x)) continue;
        const y = surf(f.x);
        g.strokeStyle = rgb(pal.dark);
        g.lineWidth = 0.9;
        g.beginPath(); g.moveTo(f.x, y + 1); g.quadraticCurveTo(f.x - 1, y - f.h * 0.5, f.x + 0.5, y - f.h); g.stroke();
        g.fillStyle = pal.flowers[f.c];
        g.beginPath(); flower(g, f.x + 0.5, y - f.h, f.r, f.r * 0.75); g.fill();
        g.fillStyle = f.c === 1 ? '#f59e0b' : '#ffd24a';
        g.beginPath(); circle(g, f.x + 0.5, y - f.h, f.r * 0.6); g.fill();
      }
    }
    if (pal.litter) {
      for (let c = 0; c < 4; c++) {
        g.fillStyle = pal.litter[c];
        g.beginPath();
        for (const l of info.litter) {
          if (l.c !== c || l.x < xa || l.x > xb || wet(l.x)) continue;
          const y = surf(l.x);
          g.moveTo(l.x + 2.4, y - 0.3);
          g.ellipse(l.x, y - 0.3, 2.4, 1.1, l.rot, 0, TAU);
        }
        g.fill();
      }
    }
    // Half-buried stones
    for (const s of info.stones) {
      if (s.x < xa - 12 || s.x > xb + 12 || wet(s.x)) continue;
      const y = surf(s.x) + s.r * 0.35;
      paintStone(g, s.x, y, s.r * 1.3, s.r, ROCK_TONES[s.tone], si);
    }
    // Edge cliffs
    for (const c of info.cliffs) {
      const cx0 = c.side ? W - CLIFF_REACH : -10, cx1 = c.side ? W + 10 : CLIFF_REACH;
      if (cx1 < x0 || cx0 > x1) continue;
      paintCliff(g, info, c, si);
    }
  }

  function paintStone(g, x, y, rx, ry, tone, si) {
    g.fillStyle = rgb(scale(tone, 0.7));
    g.beginPath(); g.ellipse(x + 0.8, y + 0.6, rx, ry, 0, Math.PI, TAU); g.closePath(); g.fill();
    g.fillStyle = rgb(tone);
    g.beginPath(); g.ellipse(x, y, rx * 0.94, ry * 0.94, 0, Math.PI, TAU); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.3)';
    g.beginPath(); g.ellipse(x - rx * 0.3, y - ry * 0.55, rx * 0.35, ry * 0.2, -0.2, 0, TAU); g.fill();
    if (si === WINTER) {
      g.fillStyle = SNOW.body;
      g.beginPath(); g.ellipse(x, y - ry * 0.82, rx * 0.72, ry * 0.26, 0, 0, TAU); g.fill();
    }
  }

  // A cliff face of stacked sandstone blocks at the world edge
  function paintCliff(g, info, c, si) {
    const W = info.W, side = c.side;
    const X = d => (side ? W - d : d);
    const top = info.cliffTop;
    const blocks = c.blocks;
    const out = side ? W + 80 : -80;
    const face = new Path2D();
    face.moveTo(out, info.H + 40);
    face.lineTo(X(blocks[0].d0), info.H + 40);
    for (const b of blocks) {
      face.lineTo(X(b.d0), b.y0);
      face.lineTo(X(b.d1), b.y1 + 3);
      face.quadraticCurveTo(X(b.d1), b.y1, X(b.d1 - 3), b.y1);
    }
    const last = blocks[blocks.length - 1];
    face.quadraticCurveTo(X(last.d1 * 0.5), top - 14, X(-20), top - 10);
    face.lineTo(out, top - 10);
    face.closePath();
    // Dark joints behind everything, then each block as its own rounded stone
    const stone = DETAIL.cliffStone[si];
    g.fillStyle = rgb(scale(stone, 0.38));
    g.fill(face);
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const tone = scale(stone, 0.9 + hash2(i, side + 3) * 0.2);
      const y0 = b.y1 + 1.2, y1 = b.y0 - 1.2, r = Math.min(9, (y1 - y0) * 0.3);
      const inTop = b.d1 - 1.2, inBot = b.d0 - 1.2;
      // A stone between depth dOut (from the world edge) and its face (dTop at the top, dBot below)
      const stonePath = (dOut, dTop, dBot, roundOut) => {
        g.beginPath();
        if (roundOut) { g.moveTo(X(dOut), y0 + r); g.quadraticCurveTo(X(dOut), y0, X(dOut + r), y0); } else g.moveTo(X(dOut), y0);
        g.lineTo(X(dTop - r), y0);
        g.quadraticCurveTo(X(dTop), y0, X(dTop - 0.5), y0 + r);
        g.lineTo(X(dBot), y1 - r);
        g.quadraticCurveTo(X(dBot + 0.5), y1, X(dBot - r), y1);
        if (roundOut) { g.lineTo(X(dOut + r), y1); g.quadraticCurveTo(X(dOut), y1, X(dOut), y1 - r); } else g.lineTo(X(dOut), y1);
        g.closePath();
      };
      // A vertical joint splits some blocks into two stones
      const split = hash2(i, side + 9) < 0.55 ? inBot * (0.35 + hash2(i, 4) * 0.3) : -1;
      for (let part = 0; part < (split > 0 ? 2 : 1); part++) {
        if (split < 0) stonePath(-80, inTop, inBot, false);
        else if (part === 0) stonePath(split + 1.2, inTop, inBot, true);
        else stonePath(-80, split - 1.2, split - 1.2, false);
        const sg = g.createLinearGradient(X(inBot), y0, X(inBot - 60), y1);
        sg.addColorStop(0, rgb(mix(tone, [255, 240, 214], 0.28)));
        sg.addColorStop(0.4, rgb(tone));
        sg.addColorStop(1, rgb(scale(tone, 0.72)));
        g.fillStyle = sg;
        g.fill();
        g.save();
        g.clip();
        g.fillStyle = 'rgba(50,34,26,0.26)'; // shaded underside
        g.fillRect(Math.min(X(-80), X(inBot + 4)), y1 - 6, Math.abs(X(inBot + 4) - X(-80)), 6);
        g.fillStyle = 'rgba(255,244,220,0.4)'; // lit top edge
        g.fillRect(Math.min(X(-80), X(inTop + 4)), y0, Math.abs(X(inTop + 4) - X(-80)), 2);
        g.strokeStyle = 'rgba(70,50,38,0.3)'; // faint bedding lines
        g.lineWidth = 1;
        g.beginPath();
        for (let y = y0 + 8 + hash2(i, part) * 6; y < y1 - 6; y += 10 + hash2(i, y | 0) * 6) { g.moveTo(X(-80), y + 1.5); g.lineTo(X(inBot + 4), y); }
        g.stroke();
        g.restore();
      }
      // A crack
      const cx = X(b.d1 * (0.3 + hash2(i, side) * 0.4));
      g.strokeStyle = 'rgba(58,40,30,0.4)';
      g.lineWidth = 1.1;
      g.beginPath();
      g.moveTo(cx, b.y1 + 4);
      g.lineTo(cx + 3, b.y1 + (b.y0 - b.y1) * 0.4);
      g.lineTo(cx - 2, b.y1 + (b.y0 - b.y1) * 0.7);
      g.stroke();
    }
    // Ledges: moss, ferns and vines, or snow
    const pal = GROUND[si];
    for (let i = 0; i < blocks.length - 1; i++) {
      const b = blocks[i], up = blocks[i + 1];
      const lip = b.d1 - up.d0; // how far the ledge sticks out
      const lx0 = X(up.d0), lx1 = X(b.d1), y = b.y1;
      if (si === WINTER) {
        g.fillStyle = SNOW.body;
        g.beginPath(); g.ellipse((lx0 + lx1) / 2, y, Math.abs(lx1 - lx0) / 2 + 3, 3.2, 0, Math.PI, TAU); g.fill();
      } else if (b.moss && lip > 2) {
        g.fillStyle = rgb(pal.grass);
        g.beginPath(); g.ellipse((lx0 + lx1) / 2, y + 0.5, Math.abs(lx1 - lx0) / 2 + 2, 2.6, 0, Math.PI, TAU); g.fill();
        g.strokeStyle = pal.tufts[0];
        g.lineWidth = 1;
        g.beginPath();
        for (let k = 0; k < 4; k++) {
          const x = lx0 + (lx1 - lx0) * (0.2 + k * 0.2);
          g.moveTo(x, y); g.lineTo(x + (k - 1.5) * 1.2, y - 4 - (k % 2) * 2);
        }
        g.stroke();
      }
      if (b.vine && si !== WINTER) {
        g.strokeStyle = DETAIL.cliffVine[si];
        g.lineWidth = 1.2;
        g.beginPath();
        const vx = X(b.d1 - 2);
        g.moveTo(vx, y);
        for (let k = 1; k <= 6; k++) g.lineTo(vx + Math.sin(k * 1.3) * 2, y + k * 6);
        g.stroke();
        g.fillStyle = DETAIL.cliffVineLeaf[si];
        g.beginPath();
        for (let k = 1; k <= 6; k++) { const lx = vx + Math.sin(k * 1.3) * 2 + (k % 2 ? 2 : -2); g.moveTo(lx, y + k * 6); g.ellipse(lx, y + k * 6, 2, 1.1, k, 0, TAU); }
        g.fill();
      }
      if (b.fern && si !== WINTER && lip > 3) {
        g.strokeStyle = DETAIL.cliffFern[si];
        g.lineWidth = 1;
        g.beginPath();
        const fx = (lx0 + lx1) / 2;
        for (let k = -2; k <= 2; k++) { g.moveTo(fx, y); g.quadraticCurveTo(fx + k * 3, y - 6, fx + k * 5, y - 3 - Math.abs(k)); }
        g.stroke();
      }
    }
    // The top: turf or snow
    const tx0 = X(last.d1 + 2), tx1 = X(-80);
    g.fillStyle = si === WINTER ? SNOW.body : rgb(pal.grass);
    g.beginPath();
    g.moveTo(tx0, last.y1 + 2);
    g.quadraticCurveTo(X(last.d1 * 0.5), top - 18, X(-20), top - 13);
    g.lineTo(tx1, top - 13);
    g.lineTo(tx1, top - 6);
    g.lineTo(X(-20), top - 6);
    g.quadraticCurveTo(X(last.d1 * 0.5), top - 9, tx0, last.y1 + 6);
    g.closePath();
    g.fill();
    // A bush on the brink
    const bx = X(last.d1 * 0.45), by = top - 12;
    const bush = DETAIL.cliffBush[si];
    for (let k = 0; k < 2; k++) {
      g.fillStyle = rgb(bush[k]);
      g.beginPath();
      circle(g, bx - 9 + k * 1.5, by - 2 - k * 2, 9 - k * 2);
      circle(g, bx + 3 + k, by - 7 - k * 2, 11 - k * 3);
      circle(g, bx + 13, by - 1 - k * 2, 8 - k * 2);
      g.fill();
    }
    if (si === WINTER) { g.fillStyle = SNOW.body; g.beginPath(); g.ellipse(bx + 2, by - 15, 12, 4, 0, Math.PI, TAU); g.fill(); }
    // Fallen stones at the foot
    for (const t of c.talus) {
      const x = X(c.blocks[0].d0 + t.dx - 20);
      paintStone(g, x, info.surf(x) + t.r * 0.3, t.r * 1.25, t.r, ROCK_TONES[t.tone], si);
    }
  }

  Object.assign(Evo.Paint, { buildTerrain, paintTile, paintStone, CLIFF_REACH, TILE_MARGIN });
})(globalThis.Evo);
