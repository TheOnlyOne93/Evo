// The side-view world: sky and parallax scenery (sky.js), terrain, the pond, plants and rocks,
// items (item-art.js), creatures (Evo.CreatureArt), weather, day/night light, overlays and the
// player's hand. Reads the world through the contract in DESIGN.md §6 and never changes it.
//
// Static art (terrain tiles, plants, rocks, platforms) is painted once into offscreen sprites at a
// resolution matched to the zoom, per season, and blitted each frame. Only water, items,
// creatures, particles and overlays are drawn as paths every frame.
(function (Evo) {
  'use strict';
  const { TAU, clamp, clamp01 } = Evo.util;
  const { rng, makeCanvas, rgb, rgba, mix, scale, smooth } = Evo.Sky.util;

  const ZOOM_MIN = 0.5, ZOOM_MAX = 2.5;
  const GROUND_AT = 0.72;               // where the ground line sits on screen (fraction of height)
  const SKY_ROOM = 420;                 // world px of scenery kept visible above the ground by default
  const LEVELS = [1, 1.5, 2, 3];        // sprite resolutions, in device px per world px
  const NL = LEVELS.length;
  const TILE = 256;                     // terrain tile size (world px)
  const SPRITE_BUDGET = 24e6;           // cached sprite pixels before old ones are dropped
  const BUILDS_PER_FRAME = 3;           // sprite upgrades per frame (missing ones are always built)
  const SOUND_LIFE = 90;                // ticks a call stays visible (world.sounds[].age is in ticks)
  const MAX_PARTICLES = 360;
  const KIND = { TILE: 0, TREE: 1, GRASS: 2, LOG: 3, ROCK: 4, REEDS: 5, THORN: 6, PLAT_LOG: 7, PLAT_ROCK: 8 };
  const FEATURE_KIND = { tree: KIND.TREE, grass: KIND.GRASS, log: KIND.LOG, rock: KIND.ROCK, reeds: KIND.REEDS, thornbush: KIND.THORN };
  // Back-to-front passes over world.features; reeds stand in front of the water
  const BACK_PASSES = [[KIND.TREE], null /* platforms */, [KIND.LOG, KIND.ROCK], [KIND.THORN], [KIND.GRASS]];
  const FRONT_PASSES = [[KIND.REEDS]];

  const { hash2 } = Evo.util;
  const { GROUND, SNOW, ROCK_TONES, circle } = Evo.Paint;
  const { treeStructure, paintTree, grassStructure, paintGrass, reedStructure, paintReeds, paintThorn } = Evo.Paint;
  const { buildTerrain, paintTile, paintStone } = Evo.Paint;

  // ---------------------------------------------------------------------------------------------
  const LEAF_COLORS = ['#d8742e', '#c2452d', '#e2a93b', '#a8552a', '#f2c9dc', '#ffffff']; // falling leaves + petals

  function paintLog(g, f, si, rec) {
    const R = rng(4000 + (f.id | 0) * 7);
    const L = f.length || 110, d = rec.data.d;
    const x0 = -L / 2, x1 = L / 2, yT = 3 - d, yM = 3 - d / 2;
    const bark = [118, 84, 56];
    for (const p of rec.data.props) {
      const ry = p.gap + 5;
      paintStone(g, p.x, p.gap + 3, Math.max(10, ry * 0.8 + 5), ry, ROCK_TONES[(f.id | 0) % 3], si);
    }
    const bg = g.createLinearGradient(0, yT, 0, 3);
    bg.addColorStop(0, rgb(mix(bark, [255, 230, 190], 0.25)));
    bg.addColorStop(0.5, rgb(bark));
    bg.addColorStop(1, rgb(scale(bark, 0.55)));
    g.fillStyle = bg;
    g.beginPath();
    g.moveTo(x0, yT);
    g.lineTo(x1, yT);
    g.ellipse(x1, yM, d * 0.26, d / 2, 0, -Math.PI / 2, Math.PI / 2);
    g.lineTo(x0, 3);
    g.ellipse(x0, yM, d * 0.26, d / 2, 0, Math.PI / 2, Math.PI * 1.5);
    g.closePath();
    g.fill();
    g.strokeStyle = rgba(scale(bark, 0.45), 0.9);
    g.lineWidth = 1.2;
    g.stroke();
    // Bark furrows
    g.strokeStyle = rgba(scale(bark, 0.5), 0.7);
    g.lineWidth = 1;
    g.beginPath();
    for (let k = 1; k < 6; k++) {
      const y = yT + (d * k) / 6;
      let x = x0 + 4 + R() * 10;
      while (x < x1 - 8) {
        const len = 10 + R() * 26;
        g.moveTo(x, y + (R() - 0.5) * 2);
        g.quadraticCurveTo(x + len / 2, y + (R() - 0.5) * 3, Math.min(x1 - 6, x + len), y + (R() - 0.5) * 2);
        x += len + 6 + R() * 10;
      }
    }
    g.stroke();
    // Grub holes
    g.fillStyle = '#2e1e14';
    for (let k = 0; k < 4; k++) { g.beginPath(); g.ellipse(x0 + L * (0.25 + k * 0.17), yM + (R() - 0.3) * d * 0.4, 1.8, 1.3, 0, 0, TAU); g.fill(); }
    // The hollow end
    g.fillStyle = rgb(scale(bark, 0.7));
    g.beginPath(); g.ellipse(x0, yM, d * 0.26, d / 2, 0, 0, TAU); g.fill();
    const hg = g.createRadialGradient(x0 + 1, yM, 1, x0, yM, d * 0.42);
    hg.addColorStop(0, '#120a06');
    hg.addColorStop(1, '#3a2618');
    g.fillStyle = hg;
    g.beginPath(); g.ellipse(x0 + 1, yM, d * 0.18, d * 0.38, 0, 0, TAU); g.fill();
    // The cut end with rings
    g.fillStyle = '#d6b082';
    g.beginPath(); g.ellipse(x1, yM, d * 0.26, d / 2 - 1, 0, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(150,108,70,0.8)';
    g.lineWidth = 0.9;
    for (let k = 1; k <= 3; k++) { g.beginPath(); g.ellipse(x1, yM, d * 0.26 * k / 4, (d / 2 - 1) * k / 4, 0, 0, TAU); g.stroke(); }
    // Moss, fungi or snow on top
    if (si === 3) {
      g.fillStyle = SNOW.body;
      g.beginPath();
      g.moveTo(x0 - 2, yT + 3);
      for (let x = x0; x <= x1 + 1; x += 6) g.lineTo(x, yT - 2.5 - Math.sin(x * 0.3) * 1.2);
      g.lineTo(x1 + 3, yT + 3);
      g.closePath();
      g.fill();
    } else {
      g.fillStyle = si === 2 ? '#8f8a3c' : si === 0 ? '#79b04a' : '#5f9a3e';
      g.beginPath();
      for (let x = x0 + 6; x < x1 - 4; x += 5 + R() * 6) circle(g, x, yT + 1, 2 + R() * 2.8);
      g.fill();
      const caps = si === 2 ? 4 : 2;
      for (let k = 0; k < caps; k++) {
        const fx = x0 + L * (0.2 + R() * 0.6), fy = yM + (R() - 0.2) * d * 0.3;
        g.fillStyle = '#e6cfa2';
        g.beginPath(); g.ellipse(fx, fy, 5, 2.4, 0, Math.PI, TAU); g.fill();
        g.fillStyle = '#b8966a';
        g.beginPath(); g.ellipse(fx, fy, 5, 1, 0, 0, Math.PI); g.fill();
      }
      if (si === 2) {
        for (let k = 0; k < 2; k++) {
          const mx = x0 + L * (0.35 + k * 0.3);
          g.fillStyle = '#efe2c8';
          g.fillRect(mx - 1, yT - 5, 2, 5);
          g.fillStyle = '#a8663a';
          g.beginPath(); g.ellipse(mx, yT - 5, 4, 2.6, 0, Math.PI, TAU); g.fill();
        }
      }
    }
  }

  // A boulder's outline. With `top` (a platform lies on it, that far above the base) the boulder
  // is flat-topped at that height, so whoever stands on it stands on the stone.
  function rockShape(f, top) {
    const R = rng(5000 + (f.id | 0) * 11);
    const w = f.w || 70, h = top || f.h || 40;
    const pts = [];
    const n = top ? 12 : 9;
    for (let k = 0; k <= n; k++) {
      const a = Math.PI - (k / n) * Math.PI;
      if (top) {
        const u = Math.cos(a), e = Math.abs(u);
        const lift = Math.pow(1 - Math.pow(e, 7), 1 / 7); // a squarish superellipse
        pts.push([u * w / 2 * (0.97 + R() * 0.05), -h * lift * (e > 0.8 ? 0.95 + R() * 0.07 : 1 + R() * 0.02)]);
      } else {
        const flat = Math.pow(Math.sin(a), 0.55);
        pts.push([Math.cos(a) * w / 2 * (0.92 + R() * 0.1), -h * flat * (0.9 + R() * 0.12)]);
      }
    }
    return { w, h, pts, tone: ROCK_TONES[(f.id | 0) % ROCK_TONES.length], R: R() };
  }

  function rockPath(s) {
    const p = new Path2D();
    const pts = s.pts;
    p.moveTo(pts[0][0], 4);
    p.lineTo(pts[0][0], pts[0][1]);
    for (let k = 1; k < pts.length; k++) {
      const [x0, y0] = pts[k - 1], [x1, y1] = pts[k];
      p.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
    }
    const lastPt = pts[pts.length - 1];
    p.quadraticCurveTo(lastPt[0], lastPt[1], lastPt[0], 4);
    p.closePath();
    return p;
  }

  function paintRock(g, f, si, rec) {
    const s = rec.data;
    const R = rng(5100 + (f.id | 0) * 5);
    const path = rockPath(s);
    const { w, h, tone } = s;
    const grd = g.createLinearGradient(-w / 2, -h, w / 2, 4);
    grd.addColorStop(0, rgb(mix(tone, [255, 250, 240], 0.3)));
    grd.addColorStop(0.5, rgb(tone));
    grd.addColorStop(1, rgb(scale(tone, 0.6)));
    g.fillStyle = grd;
    g.fill(path);
    g.save();
    g.clip(path);
    // Facets
    g.fillStyle = 'rgba(255,255,255,0.14)';
    g.beginPath(); g.moveTo(-w * 0.5, -h * 0.2); g.lineTo(-w * 0.15, -h * 1.1); g.lineTo(w * 0.05, -h * 1.1); g.lineTo(-w * 0.25, 4); g.closePath(); g.fill();
    g.fillStyle = 'rgba(30,20,30,0.16)';
    g.beginPath(); g.moveTo(w * 0.2, -h * 1.1); g.lineTo(w * 0.6, -h); g.lineTo(w * 0.6, 4); g.lineTo(w * 0.1, 4); g.closePath(); g.fill();
    // Cracks
    g.strokeStyle = rgba(scale(tone, 0.45), 0.7);
    g.lineWidth = 1.1;
    g.beginPath();
    g.moveTo(w * 0.1, -h * 0.9); g.lineTo(w * 0.16, -h * 0.55); g.lineTo(w * 0.08, -h * 0.3);
    g.moveTo(-w * 0.3, -h * 0.35); g.lineTo(-w * 0.2, -h * 0.15);
    g.stroke();
    // Lichen
    g.fillStyle = 'rgba(214,196,96,0.5)';
    g.beginPath();
    for (let k = 0; k < 6; k++) circle(g, (R() - 0.5) * w * 0.7, -h * (0.2 + R() * 0.5), 1 + R() * 1.6);
    g.fill();
    // Moss on the top (snow in winter)
    if (si === 3) {
      g.fillStyle = SNOW.body;
      g.beginPath();
      g.moveTo(-w * 0.6, -h * 0.72);
      for (let k = 0; k <= 10; k++) g.lineTo(-w * 0.6 + k * w * 0.12, -h * 0.66 - Math.sin(k * 1.7) * 2);
      g.lineTo(w * 0.6, -h * 1.3);
      g.lineTo(-w * 0.6, -h * 1.3);
      g.closePath();
      g.fill();
      g.strokeStyle = SNOW.shade;
      g.lineWidth = 1;
      g.stroke();
    } else {
      g.fillStyle = si === 2 ? 'rgba(150,140,60,0.75)' : 'rgba(96,150,62,0.8)';
      g.beginPath();
      for (let k = 0; k < 7; k++) circle(g, -w * 0.3 + k * w * 0.07 + (R() - 0.5) * 4, -h * (0.9 + R() * 0.12), 2.5 + R() * 3);
      g.fill();
    }
    g.restore();
    g.strokeStyle = rgba(scale(tone, 0.45), 0.9);
    g.lineWidth = 1.3;
    g.stroke(path);
    // Grass at the foot
    const gp = GROUND[si];
    g.strokeStyle = gp.tufts[1 % gp.tufts.length];
    g.lineWidth = 1.1;
    g.beginPath();
    for (let k = 0; k < 10; k++) {
      const x = -w * 0.55 + k * w * 0.12;
      g.moveTo(x, 4); g.quadraticCurveTo(x + 1, 0, x + (k % 2 ? 2 : -1.5), -3 - (k % 3) * 1.4);
    }
    g.stroke();
  }

  // Platforms: origin at (x0, y) where y is the walking surface
  function paintPlatformLog(g, p, si) {
    const R = rng(8000 + Math.round(p.x0));
    const L = p.x1 - p.x0, d = 18;
    const bark = [112, 80, 54];
    const bg = g.createLinearGradient(0, -1, 0, d);
    bg.addColorStop(0, rgb(mix(bark, [255, 230, 190], 0.28)));
    bg.addColorStop(0.45, rgb(bark));
    bg.addColorStop(1, rgb(scale(bark, 0.5)));
    g.fillStyle = bg;
    g.beginPath();
    g.moveTo(0, -1);
    g.lineTo(L, -1);
    g.ellipse(L, d / 2 - 1, d * 0.25, d / 2, 0, -Math.PI / 2, Math.PI / 2);
    g.lineTo(0, d - 1);
    g.ellipse(0, d / 2 - 1, d * 0.25, d / 2, 0, Math.PI / 2, Math.PI * 1.5);
    g.closePath();
    g.fill();
    g.strokeStyle = rgba(scale(bark, 0.4), 0.9);
    g.lineWidth = 1.1;
    g.stroke();
    g.strokeStyle = rgba(scale(bark, 0.5), 0.6);
    g.lineWidth = 0.9;
    g.beginPath();
    for (let k = 1; k < 4; k++) {
      let x = 4 + R() * 8;
      while (x < L - 8) { const len = 12 + R() * 24; g.moveTo(x, k * d / 4); g.lineTo(Math.min(L - 5, x + len), k * d / 4 + (R() - 0.5) * 2); x += len + 8; }
    }
    g.stroke();
    for (const ex of [0, L]) {
      g.fillStyle = '#d6b082';
      g.beginPath(); g.ellipse(ex, d / 2 - 1, d * 0.25, d / 2 - 1, 0, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(150,108,70,0.8)';
      g.beginPath(); g.ellipse(ex, d / 2 - 1, d * 0.12, d / 4, 0, 0, TAU); g.stroke();
    }
    if (si === 3) {
      g.fillStyle = SNOW.body;
      g.beginPath(); g.moveTo(-2, 1); for (let x = 0; x <= L; x += 5) g.lineTo(x, -3.5 - Math.sin(x * 0.4) * 1); g.lineTo(L + 2, 1); g.closePath(); g.fill();
    } else {
      g.fillStyle = si === 2 ? '#8f8a3c' : '#6aa446';
      g.beginPath();
      for (let x = 6; x < L - 4; x += 7 + R() * 9) circle(g, x, -0.5, 1.5 + R() * 2);
      g.fill();
      if (si < 2) { // A sprout
        const sx = L * 0.62;
        g.strokeStyle = '#5a9a40';
        g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(sx, 0); g.quadraticCurveTo(sx + 1, -5, sx - 1, -9); g.stroke();
        g.fillStyle = '#7cc05a';
        g.beginPath(); g.ellipse(sx - 3, -8, 3, 1.4, -0.5, 0, TAU); g.ellipse(sx + 2, -9, 3, 1.4, 0.5, 0, TAU); g.fill();
      }
    }
  }

  // A rock outcrop: a layered sandstone mass rising from the ground, its flat top the ledge
  function paintPlatformRock(g, p, si, rec) {
    const R = rng(8100 + Math.round(p.x0));
    const L = p.x1 - p.x0, gap = rec.data.gap;
    const tone = ROCK_TONES[1];
    const grounded = gap > 8 && gap < 260;
    // Silhouette: a flat top, flanks that bulge and tuck in, and a flared foot on the ground
    const body = new Path2D();
    body.moveTo(2, -2);
    body.lineTo(L - 2, -2);
    if (grounded) {
      const G = gap + 8;
      body.bezierCurveTo(L + 9, -2, L + 12, G * 0.2, L + 6, G * 0.38);
      body.bezierCurveTo(L + 1, G * 0.52, L - 4, G * 0.62, L + 2, G * 0.78);
      body.bezierCurveTo(L + 8, G * 0.9, L + 20, G * 0.96, L + 22, G);
      body.lineTo(-22, G);
      body.bezierCurveTo(-18, G * 0.94, -8, G * 0.88, -3, G * 0.74);
      body.bezierCurveTo(2, G * 0.6, -4, G * 0.5, -8, G * 0.36);
      body.bezierCurveTo(-12, G * 0.2, -9, -2, 2, -2);
    } else {
      body.quadraticCurveTo(L + 7, -1, L + 3, 9);
      for (let x = L; x >= 0; x -= L / 6) body.lineTo(x, 13 + R() * 9);
      body.quadraticCurveTo(-8, 8, 2, -2);
    }
    body.closePath();
    const sg = g.createLinearGradient(-14, -2, L + 14, gap);
    sg.addColorStop(0, rgb(mix(tone, [255, 242, 222], 0.28)));
    sg.addColorStop(0.5, rgb(tone));
    sg.addColorStop(1, rgb(scale(tone, 0.58)));
    g.fillStyle = sg;
    g.fill(body);
    g.save();
    g.clip(body);
    // Layered sandstone: soft strata, a shaded underside to each band, a darker foot
    g.lineWidth = 1;
    for (let y = 9, k = 0; y < gap + 6; y += 9 + R() * 6, k++) {
      g.strokeStyle = 'rgba(88,62,44,0.3)';
      g.beginPath(); g.moveTo(-30, y); g.bezierCurveTo(L * 0.3, y + 3, L * 0.7, y - 2, L + 30, y + 1); g.stroke();
      g.strokeStyle = 'rgba(255,240,215,0.25)';
      g.beginPath(); g.moveTo(-30, y + 1.5); g.bezierCurveTo(L * 0.3, y + 4.5, L * 0.7, y - 0.5, L + 30, y + 2.5); g.stroke();
    }
    const ao = g.createLinearGradient(0, gap * 0.4, 0, gap + 8);
    ao.addColorStop(0, 'rgba(40,26,20,0)');
    ao.addColorStop(1, 'rgba(40,26,20,0.3)');
    g.fillStyle = ao;
    g.fillRect(-30, gap * 0.4, L + 60, gap);
    g.fillStyle = 'rgba(40,26,20,0.2)';
    g.beginPath(); g.ellipse(L * 0.5, 6, L * 0.62, 5, 0, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,245,225,0.4)';
    g.fillRect(-30, -2, L + 60, 2.5);
    g.strokeStyle = 'rgba(60,40,30,0.45)';
    g.lineWidth = 1.1;
    g.beginPath();
    g.moveTo(L * 0.3, 1); g.lineTo(L * 0.34, 12); g.lineTo(L * 0.28, 24);
    g.moveTo(L * 0.72, 2); g.lineTo(L * 0.66, 16);
    if (grounded) { g.moveTo(L * 0.55, gap * 0.5); g.lineTo(L * 0.6, gap * 0.7); g.lineTo(L * 0.52, gap * 0.9); }
    g.stroke();
    // Moss clinging to the flanks
    if (si !== 3 && grounded) {
      g.fillStyle = si === 2 ? 'rgba(150,140,60,0.6)' : 'rgba(96,150,62,0.6)';
      g.beginPath();
      for (let k = 0; k < 6; k++) circle(g, -6 + R() * 10, gap * (0.3 + R() * 0.6), 2 + R() * 3);
      g.fill();
    }
    g.restore();
    g.strokeStyle = rgba(scale(tone, 0.45), 0.9);
    g.lineWidth = 1.2;
    g.stroke(body);
    const gp = GROUND[si];
    if (si === 3) {
      g.fillStyle = SNOW.body;
      g.beginPath(); g.moveTo(-5, 1); for (let x = -4; x <= L + 4; x += 5) g.lineTo(x, -4.5 - Math.sin(x * 0.3) * 1); g.lineTo(L + 5, 1); g.closePath(); g.fill();
    } else {
      g.fillStyle = rgb(gp.grass);
      g.fillRect(-2, -2.5, L + 4, 3);
      g.strokeStyle = gp.tufts[0];
      g.lineWidth = 1;
      g.beginPath();
      for (let x = 0; x < L; x += 3 + R() * 4) { g.moveTo(x, -1); g.lineTo(x + (R() - 0.5) * 3, -3 - R() * 4); }
      g.stroke();
    }
  }

  // ---------------------------------------------------------------------------------------------
  // The hand: a friendly cartoon hand in screen space. Origin = the pointer.
  const SKIN = '#f6d6b6', SKIN_SHADE = '#e2b48f', INK = '#6e4535', CUFF = '#9be3c8', CUFF_DARK = '#4fa586';

  function handOutlineAndFill(g, parts, palm) {
    // parts: [x0, y0, x1, y1, width] capsules; palm: [x, y, w, h, r]
    g.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
      g.strokeStyle = pass ? SKIN : INK;
      for (let i = 0; i < parts.length; i += 5) {
        g.lineWidth = parts[i + 4] + (pass ? 0 : 2.6);
        g.beginPath(); g.moveTo(parts[i], parts[i + 1]); g.lineTo(parts[i + 2], parts[i + 3]); g.stroke();
      }
      if (palm) {
        g.fillStyle = pass ? SKIN : INK;
        const e = pass ? 0 : 1.3;
        g.beginPath();
        g.roundRect(palm[0] - e, palm[1] - e, palm[2] + e * 2, palm[3] + e * 2, palm[4] + e);
        g.fill();
      }
    }
  }

  function drawCuff(g, x, y, w, h, rot) {
    g.save();
    g.translate(x, y);
    if (rot) g.rotate(rot);
    g.fillStyle = CUFF;
    g.strokeStyle = INK;
    g.lineWidth = 1.3;
    g.beginPath(); g.roundRect(-w / 2, -h / 2, w, h, 3); g.fill(); g.stroke();
    g.strokeStyle = CUFF_DARK;
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(-w / 2 + 2, h / 2 - 2.2); g.lineTo(w / 2 - 2, h / 2 - 2.2); g.stroke();
    g.restore();
  }

  const OPEN_HAND = [-6.4, -4, -7.8, -16.5, 4.6, -2.1, -5, -2.3, -19.5, 4.8, 2.2, -5, 3.1, -18, 4.6, 6.3, -3.8, 8.4, -13.8, 4.1, -8.2, 3, -14.4, -4.2, 5.2];
  const FIST_THUMB = [-8.6, 1.5, -1.5, -1.8, 5];
  const SLAP_HAND = [-4.6, -4, -5.4, -18, 4.7, -0.8, -5, -1, -20, 4.9, 3, -5, 3.4, -18.6, 4.7, 6.6, -3.6, 7.6, -14.8, 4.2, -8.6, 2, -14.6, -3, 5];

  function drawHandShape(g, mode, holding, t) {
    if (mode === 'pat') {
      // Palm down, fingers to the left; bobs as if patting
      g.translate(0, -2.5 - Math.abs(Math.sin(t * 5)) * 3);
      drawCuff(g, 14.5, -6, 7, 13, 0);
      handOutlineAndFill(g, [-2, -11.2, 3.5, -11.5, 5.2], [-19, -9, 28, 9, 4.5]);
      g.strokeStyle = SKIN_SHADE;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(-17, -3); g.lineTo(-8, -3);
      g.moveTo(-17.5, -5.5); g.lineTo(-10, -5.5);
      g.stroke();
      g.fillStyle = 'rgba(226,180,143,0.6)';
      g.beginPath(); g.ellipse(-1, -1.8, 9, 1.6, 0, 0, TAU); g.fill();
      return;
    }
    if (mode === 'slap') {
      g.rotate(-0.42);
      drawCuff(g, 0, 16, 18, 7, 0);
      handOutlineAndFill(g, SLAP_HAND, [-9.5, -6.5, 19, 16, 6]);
      g.strokeStyle = SKIN_SHADE;
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(-3, -1); g.quadraticCurveTo(1, 3, 5, 0); g.stroke();
      g.rotate(0.42);
      // Motion lines
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.lineWidth = 2;
      g.lineCap = 'round';
      const k = 0.6 + 0.4 * Math.sin(t * 9);
      g.beginPath();
      g.moveTo(14, -18); g.lineTo(14 + 7 * k, -22);
      g.moveTo(17, -10); g.lineTo(17 + 8 * k, -12);
      g.moveTo(17, -2); g.lineTo(17 + 7 * k, -2);
      g.stroke();
      return;
    }
    drawCuff(g, 0, 16, 18, 7, 0);
    if (holding) {
      handOutlineAndFill(g, FIST_THUMB, [-9.5, -9.5, 19, 19, 7]);
      // Folded fingers
      g.strokeStyle = SKIN_SHADE;
      g.lineWidth = 1.1;
      g.beginPath();
      for (let k = -1; k <= 1; k++) { g.moveTo(k * 4.4, -9); g.lineTo(k * 4.4, -3.5); }
      g.moveTo(-8.5, -3); g.quadraticCurveTo(0, -1.5, 8.5, -3.2);
      g.stroke();
      g.strokeStyle = SKIN;
      g.lineWidth = 5;
      g.beginPath(); g.moveTo(FIST_THUMB[0], FIST_THUMB[1]); g.lineTo(FIST_THUMB[2], FIST_THUMB[3]); g.stroke();
      return;
    }
    handOutlineAndFill(g, OPEN_HAND, [-9.5, -6.5, 19, 16, 6]);
    g.strokeStyle = SKIN_SHADE;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(-3.5, 0); g.quadraticCurveTo(0.5, 3.5, 5.5, 0.5);
    g.moveTo(-4.3, -6.5); g.lineTo(-4.2, -8.5);
    g.moveTo(0.1, -6.8); g.lineTo(0.2, -9);
    g.moveTo(4.4, -6.3); g.lineTo(4.6, -8.3);
    g.stroke();
  }

  // ---------------------------------------------------------------------------------------------
  // Glow sprites for the emissive pass (white core fading to a tint)
  function glowSprite(col, size) {
    const c = makeCanvas(size, size);
    const g = c.getContext('2d');
    const r = size / 2;
    const grd = g.createRadialGradient(r, r, 0, r, r, r);
    grd.addColorStop(0, rgba(col, 1));
    grd.addColorStop(0.25, rgba(col, 0.55));
    grd.addColorStop(1, rgba(col, 0));
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);
    return c;
  }

  // ---------------------------------------------------------------------------------------------
  class WorldView {
    constructor(world, canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.options = { showScent: false, showSenses: false, focused: null, hand: null };
      this.cam = { x: 0, y: 0, zoom: 1 };
      this.fit = { zoom: 1, top: 0, bottom: 900, centerY: 450, horizonY: 650 };
      this.w = 1; this.h = 1; this.dpr = 1;
      this.k = 1; this.ox = 0; this.oy = 0;
      this.minZoom = ZOOM_MIN;
      this.target = null;
      this.panY = 0;
      this.userZoomed = false;
      this.sky = new Evo.Sky();
      this.ss = this.sky.ss;
      this.onDrawSenses = null;          // hook(ctx, creature, view, t) for options.showSenses
      this.hoveredCreature = null;
      this.hoveredItem = null;
      this.frameNo = 0;
      this.lastT = null;
      this.t = 0;
      this.wind = 1;
      this.levelIdx = 1;
      this.buildsLeft = 0;
      this.sprites = [];
      this.spritePx = 0;
      this.poses = [];
      this.fake = { id: 0, type: 'fruit', x: 0, y: 0, radius: 4.2, rot: 0, vx: 0, onGround: false };
      this.box = { x0: 0, y0: 0, x1: 0, y1: 0 };
      this.glows = {
        warm: glowSprite([255, 150, 70], 64), lure: glowSprite([255, 120, 190], 64),
        fly: glowSprite([220, 255, 120], 32), egg: glowSprite([255, 220, 150], 64),
      };
      // Particles (struct of arrays, pooled)
      const N = MAX_PARTICLES;
      this.p = {
        n: 0, x: new Float32Array(N), y: new Float32Array(N), vx: new Float32Array(N), vy: new Float32Array(N),
        rot: new Float32Array(N), vr: new Float32Array(N), life: new Float32Array(N), size: new Float32Array(N),
        ph: new Float32Array(N), kind: new Uint8Array(N), col: new Uint8Array(N), rest: new Uint8Array(N),
      };
      this.pSeason = -1;
      this.pSpawn = 0;
      this.setWorld(world);
      this.resize();
    }

    // Swap in a different world (a new game). Rebuilds every cache.
    setWorld(world) {
      this.world = world;
      this.heights = null;
      this.featRecs = new Map();
      this.platRecs = [];
      this.tiles = [];
      for (const sp of this.sprites) sp.canvas.width = sp.canvas.height = 0;
      this.sprites = [];
      this.spritePx = 0;
      this.scent = null;
      this.camReady = false;
      this.p.n = 0;
      if (world) this._sync();
    }

    get following() { return this.target; }
    get camera() { return this.cam; }

    // Match the canvas to its box
    resize() {
      const { width, height } = Evo.fitCanvas(this.canvas, this.ctx, 160, 160);
      this.w = width;
      this.h = height;
      this.dpr = this.canvas.width / width;
      this.vignette = null;
      if (!this.world) return;
      this._computeFit();
      if (!this.userZoomed) this.cam.zoom = this.fit.zoom;
      this.cam.zoom = clamp(this.cam.zoom, this.minZoom, ZOOM_MAX);
      this._clampCamera();
      this._computeTransform();
    }

    // Camera: follow a creature (smoothly), or null to stop
    follow(creature) {
      this.target = creature || null;
      this.panY = 0;
      if (this.target && !this.camReady && this.info) this._snapToGoal();
    }

    // Pan by a screen distance (CSS px). Taking the camera stops following.
    panBy(dx, dy) {
      this.target = null;
      this.cam.x -= dx / this.cam.zoom;
      this.cam.y -= dy / this.cam.zoom;
      this._clampCamera();
      this._keepHeight();
      this._computeTransform();
    }

    // Remember the camera's height relative to the ground line, so it stays where the user put it
    _keepHeight() {
      if (this.target || !this.info) return;
      const vh = this.h / this.cam.zoom;
      this.panY = this.cam.y - (this._groundLine(this.cam.x, (this.w / this.cam.zoom) * 0.3) - (GROUND_AT - 0.5) * vh);
    }

    zoomAt(factor, sx, sy) {
      const z0 = this.cam.zoom;
      const z1 = clamp(z0 * factor, this.minZoom, ZOOM_MAX);
      if (z1 === z0) return;
      let ax = sx, ay = sy;
      if (this.target) { // keep the followed creature where it is on screen
        ax = (this.target.x - this.cam.x) * z0 + this.w / 2;
        ay = (this.target.y - 15 - this.cam.y) * z0 + this.h / 2;
      }
      const wx = this.cam.x + (ax - this.w / 2) / z0, wy = this.cam.y + (ay - this.h / 2) / z0;
      this.cam.zoom = z1;
      this.cam.x = wx - (ax - this.w / 2) / z1;
      this.cam.y = wy - (ay - this.h / 2) / z1;
      this.userZoomed = true;
      this._clampCamera();
      this._keepHeight();
      this._computeTransform();
    }

    // Back to the default framing
    resetZoom() {
      this.userZoomed = false;
      this.panY = 0;
      this.cam.zoom = this.fit.zoom;
      this._clampCamera();
      this._computeTransform();
    }

    screenToWorld(sx, sy) {
      return { x: (sx * this.dpr - this.ox) / this.k, y: (sy * this.dpr - this.oy) / this.k };
    }

    worldToScreen(x, y) {
      return { x: (x * this.k + this.ox) / this.dpr, y: (y * this.k + this.oy) / this.dpr };
    }

    // The creature under a screen point (CSS px), or null. Touch-friendly padding.
    creatureAt(sx, sy) {
      const cs = this.world && this.world.creatures;
      if (!cs) return null;
      const p = this.screenToWorld(sx, sy);
      const pad = 8 / this.cam.zoom;
      let best = null, bestD = Infinity;
      for (let i = cs.length - 1; i >= 0; i--) {
        const c = cs[i];
        const d = this._creatureHit(c, this._poseFor(c, i), p.x, p.y, pad);
        if (d < bestD) { bestD = d; best = c; }
      }
      return best;
    }

    // The item under a screen point (CSS px), or null
    itemAt(sx, sy) {
      const items = this.world && this.world.items;
      if (!items) return null;
      const p = this.screenToWorld(sx, sy);
      return this._itemAtWorld(p.x, p.y, 10 / this.cam.zoom);
    }

    // ------------------------------------------------------------------------------ internals

    _sync() {
      const world = this.world, T = world.terrain;
      if (!T || !T.heights) return;
      if (T.heights === this.heights && world.width === this.info.W && world.height === this.info.H) return;
      this.heights = T.heights;
      this.info = buildTerrain(world);
      // Terrain tile records; empty ones (all sky) are skipped
      const cols = Math.ceil(world.width / TILE), rows = Math.ceil(world.height / TILE);
      this.tileCols = cols;
      this.tileRows = rows;
      this.tiles = new Array(cols * rows);
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const x0 = i * TILE, x1 = x0 + TILE, y1 = (j + 1) * TILE;
          let top = Infinity;
          for (let x = Math.max(0, x0 - 24); x <= Math.min(world.width, x1 + 24); x += 4) top = Math.min(top, this.info.surf(x));
          const cliff = (x0 < 110 || x1 > world.width - 110) && y1 > this.info.cliffTop - 50;
          const empty = !cliff && y1 < top - 30;
          this.tiles[j * cols + i] = { kind: KIND.TILE, empty, bx0: x0, by0: j * TILE, bw: TILE, bh: TILE, sp: new Array(4 * NL).fill(null) };
        }
      }
      for (const sp of this.sprites) sp.canvas.width = sp.canvas.height = 0;
      this.sprites = [];
      this.spritePx = 0;
      this.featRecs.clear();
      this.platRecs = [];
      this.scent = null;
      if (this.w > 1) this._computeFit();
    }

    // Default zoom: the view's height holds SKY_ROOM of scenery above the ground line (trees and
    // sky) and a band of soil below it. The camera then rides along the ground.
    _computeFit() {
      const W = this.world.width, info = this.info;
      if (!info) return;
      let tallest = 0;
      for (const f of this.world.features || []) if (f.kind === 'tree') tallest = Math.max(tallest, (f.height || 0) + 110);
      const vh = Math.max(SKY_ROOM, tallest) / GROUND_AT;
      this.minZoom = clamp(this.w / W, ZOOM_MIN, ZOOM_MAX);
      const f = this.fit;
      f.zoom = clamp(Math.max(this.h / vh, this.w / W), this.minZoom, ZOOM_MAX);
      f.centerY = info.meanS - (GROUND_AT - 0.5) * this.h / f.zoom; // the default camera height, for parallax
      f.horizonY = info.meanS;
    }

    _clampCamera() {
      const W = this.world.width, H = this.world.height, z = this.cam.zoom;
      const vw = this.w / z, vh = this.h / z;
      this.cam.x = vw >= W ? W / 2 : clamp(this.cam.x, vw / 2, W - vw / 2);
      this.cam.y = vh >= H ? H - vh / 2 : clamp(this.cam.y, vh / 2, H - vh / 2);
    }

    // Ground line under the middle of the view: the average surface (or pond surface) nearby
    _groundLine(x, halfWidth) {
      const info = this.info;
      let sum = 0, n = 0;
      for (let k = -4; k <= 4; k++) {
        const xx = clamp(x + (k / 4) * halfWidth, 0, info.W);
        const wl = info.waterAt(xx);
        const s = info.surf(xx);
        sum += wl !== null && wl < s ? wl : s;
        n++;
      }
      return sum / n;
    }

    // Where the camera wants to be: over the followed creature, or riding the ground line
    _cameraGoal(out) {
      const z = this.cam.zoom, vw = this.w / z, vh = this.h / z;
      const c = this.target;
      if (c) {
        const lead = clamp((c.vx || 0) * 14, -vw * 0.1, vw * 0.1) + (c.facing || 0) * Math.min(36, vw * 0.06);
        out.x = c.x + lead;
        // Mostly the ground under the creature, so jumps don't bob the whole world
        const ground = this._groundLine(c.x, Math.min(160, vw * 0.25));
        out.y = Math.min(c.y, ground * 0.6 + c.y * 0.4) - (GROUND_AT - 0.5) * vh;
      } else {
        out.x = this.cam.x;
        out.y = this._groundLine(this.cam.x, vw * 0.3) - (GROUND_AT - 0.5) * vh + this.panY;
      }
      return out;
    }

    _snapToGoal() {
      const p = this._cameraGoal(this.box);
      this.cam.x = p.x;
      this.cam.y = p.y;
      this._clampCamera();
      this.camReady = true;
    }

    _updateCamera(dt) {
      if (!this.camReady) {
        if (!this.target) this.cam.x = this.world.width / 2;
        this._snapToGoal();
      }
      const p = this._cameraGoal(this.box);
      const k = 1 - Math.exp(-dt * 3.4);
      if (this.target) this.cam.x += (p.x - this.cam.x) * k;
      this.cam.y += (p.y - this.cam.y) * k * 0.7;
      this._clampCamera();
      this._computeTransform();
    }

    _computeTransform() {
      const z = this.cam.zoom, dpr = this.dpr;
      this.k = z * dpr;
      this.ox = Math.round((this.w / 2 - this.cam.x * z) * dpr);
      this.oy = Math.round((this.h / 2 - this.cam.y * z) * dpr);
      this.vx0 = -this.ox / this.k;
      this.vx1 = (this.canvas.width - this.ox) / this.k;
      this.vy0 = -this.oy / this.k;
      this.vy1 = (this.canvas.height - this.oy) / this.k;
      let li = 0;
      while (li < NL - 1 && LEVELS[li] < this.k * 0.92) li++;
      this.levelIdx = li;
    }

    _setWorldTransform(g) { g.setTransform(this.k, 0, 0, this.k, this.ox, this.oy); }

    // Set a local transform at world (x, y), rotated or skewed (for swaying plants)
    _setLocal(g, x, y, rot, skew) {
      const k = this.k;
      if (rot) {
        const c = Math.cos(rot) * k, s = Math.sin(rot) * k;
        g.setTransform(c, s, -s, c, x * k + this.ox, y * k + this.oy);
      } else {
        g.setTransform(k, 0, skew * k, k, x * k + this.ox, y * k + this.oy);
      }
    }

    // Ground height at x
    surf(x) { return this.info.surf(x); }

    // The first walkable surface at or below (x, y): ground or a platform
    _surfaceBelow(x, y) {
      let s = this.info.surf(x);
      const ps = this.world.platforms;
      if (ps) {
        for (let i = 0; i < ps.length; i++) {
          const p = ps[i];
          if (x >= p.x0 && x <= p.x1 && p.y >= y - 6 && p.y < s) s = p.y;
        }
      }
      return s;
    }

    _iceAmount() {
      const ss = this.ss;
      if (ss.cur === 3) return 1 - ss.blend;
      if (ss.next === 3) return ss.blend;
      return 0;
    }

    // ---- Sprite cache: rec.sp[season * NL + level] ----
    _sprite(rec, si, force) {
      const base = si * NL, li = this.levelIdx;
      let sp = rec.sp[base + li];
      if (sp) { sp.used = this.frameNo; return sp; }
      let fb = null;
      for (let d = 1; d < NL && !fb; d++) {
        if (li + d < NL && rec.sp[base + li + d]) fb = rec.sp[base + li + d];
        else if (li - d >= 0 && rec.sp[base + li - d]) fb = rec.sp[base + li - d];
      }
      if (this.buildsLeft > 0 || (force && !fb)) {
        this.buildsLeft--;
        return this._buildSprite(rec, si, li);
      }
      if (fb) fb.used = this.frameNo;
      return fb;
    }

    _buildSprite(rec, si, li) {
      const L = LEVELS[li];
      const canvas = makeCanvas(rec.bw * L, rec.bh * L);
      const g = canvas.getContext('2d');
      g.setTransform(L, 0, 0, L, -rec.bx0 * L, -rec.by0 * L);
      g.lineJoin = 'round';
      switch (rec.kind) {
        case KIND.TILE: paintTile(g, this.info, rec.bx0, rec.by0, rec.bx0 + rec.bw, rec.by0 + rec.bh, si); break;
        case KIND.TREE: paintTree(g, rec.f, si, rec); break;
        case KIND.GRASS: paintGrass(g, rec.f, si, rec); break;
        case KIND.LOG: paintLog(g, rec.f, si, rec); break;
        case KIND.ROCK: paintRock(g, rec.f, si, rec); break;
        case KIND.REEDS: paintReeds(g, rec.f, si, rec); break;
        case KIND.THORN: paintThorn(g, rec.f, si, rec); break;
        case KIND.PLAT_LOG: paintPlatformLog(g, rec.f, si, rec); break;
        case KIND.PLAT_ROCK: paintPlatformRock(g, rec.f, si, rec); break;
      }
      const sp = { canvas, used: this.frameNo, px: canvas.width * canvas.height, rec, idx: si * NL + li };
      rec.sp[sp.idx] = sp;
      this.sprites.push(sp);
      this.spritePx += sp.px;
      if (this.spritePx > SPRITE_BUDGET) this._evict();
      return sp;
    }

    _evict() {
      this.sprites.sort((a, b) => a.used - b.used);
      let i = 0;
      while (this.spritePx > SPRITE_BUDGET * 0.7 && i < this.sprites.length) {
        const sp = this.sprites[i];
        if (sp.used >= this.frameNo - 1) break;
        sp.rec.sp[sp.idx] = null;
        this.spritePx -= sp.px;
        sp.canvas.width = sp.canvas.height = 0;
        i++;
      }
      this.sprites.splice(0, i);
    }

    // Feature record: bounds + fixed structure, rebuilt if the feature's shape changes
    _featRec(f) {
      const kind = FEATURE_KIND[f.kind];
      if (kind === undefined) return null;
      // A rock or log may carry a platform (its walkable top): then it is shaped to that height
      const plat = kind === KIND.LOG || kind === KIND.ROCK ? this._platformOn(f) : null;
      const top = plat ? Math.round(f.y - plat.y) : 0;
      const sig = (f.height || 0) * 7 + (f.canopy || 0) * 13 + (f.width || 0) * 17 + (f.length || 0) * 19 + (f.w || 0) * 23 +
        (f.h || 0) * 29 + (f.radius || 0) * 31 + (f.species === 'mimic' ? 1 : 0) + top * 37;
      let rec = this.featRecs.get(f.id);
      if (rec && rec.sig === sig && rec.kind === kind) { rec.f = f; return rec; }
      rec = { kind, f, sig, top, sp: new Array(4 * NL).fill(null), data: null, bx0: 0, by0: 0, bw: 1, bh: 1, phase: hash2(f.id | 0, 5) * TAU };
      switch (kind) {
        case KIND.TREE: {
          const s = rec.data = treeStructure(f);
          rec.bx0 = -s.cr * 1.4; rec.bw = s.cr * 2.8;
          rec.by0 = -s.H - s.cr * 0.2 - 8; rec.bh = -rec.by0 + 10;
          break;
        }
        case KIND.GRASS: {
          const s = rec.data = grassStructure(f);
          rec.bx0 = -s.w * 0.5 - s.h * 0.6 - 4; rec.bw = s.w + s.h * 1.2 + 8;
          rec.by0 = -s.h * 1.25 - 10; rec.bh = -rec.by0 + 6;
          break;
        }
        case KIND.LOG: {
          const L = f.length || 110, top = rec.top;
          const d = top ? clamp(top + 3, 14, 44) : clamp(L * 0.24, 20, 34);
          // Where the ground falls away under the log, a stone props it up
          const props = [];
          let deepest = 0;
          for (const u of [-0.36, 0.36]) {
            const gap = this.info.surf(f.x + u * L) - f.y;
            if (gap > 3) { props.push({ x: u * L, gap }); deepest = Math.max(deepest, gap); }
          }
          rec.data = { d, props };
          rec.bx0 = -L / 2 - d * 0.4; rec.bw = L + d * 0.8;
          rec.by0 = -d - 12; rec.bh = d + 18 + deepest;
          break;
        }
        case KIND.ROCK: {
          const s = rec.data = rockShape(f, rec.top);
          rec.bx0 = -s.w / 2 - 10; rec.bw = s.w + 20;
          rec.by0 = -s.h * 1.2 - 10; rec.bh = s.h * 1.2 + 18;
          break;
        }
        case KIND.REEDS: {
          const s = rec.data = reedStructure(f);
          rec.bx0 = -s.w / 2 - 36; rec.bw = s.w + 72;
          rec.by0 = -110; rec.bh = 116;
          break;
        }
        case KIND.THORN: {
          const r = f.radius || 26;
          rec.bx0 = -r * 1.75 - 6; rec.bw = r * 3.5 + 12;
          rec.by0 = -r * 2.2 - 6; rec.bh = r * 2.2 + 12;
          break;
        }
      }
      this.featRecs.set(f.id, rec);
      return rec;
    }

    // The rock or log feature whose top a platform is, if any
    _platformOn(f) {
      const ps = this.world.platforms;
      if (!ps) return null;
      const log = f.kind === 'log';
      const reach = log ? (f.length || 110) / 2 : (f.w || 70) / 2;
      const height = log ? 60 : (f.h || 40) * 1.5 + 10;
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i];
        if (Math.abs((p.x0 + p.x1) / 2 - f.x) < 14 && p.x1 - p.x0 <= reach * 2 + 16 && p.y < f.y && p.y > f.y - height) return p;
      }
      return null;
    }

    _platRec(p, i) {
      let rec = this.platRecs[i];
      const fs = this.world.features || [];
      const sig = p.x0 * 3 + p.x1 * 7 + p.y * 11 + (p.kind === 'rock' ? 1 : 2) + fs.length * 1e7;
      if (rec && rec.sig === sig) { rec.f = p; return rec; }
      // Platforms on top of a rock or log feature are drawn by that feature
      let owned = false;
      for (let k = 0; k < fs.length && !owned; k++) {
        const f = fs[k];
        if ((f.kind === 'rock' || f.kind === 'log') && this._platformOn(f) === p) owned = true;
      }
      const L = p.x1 - p.x0;
      const rock = p.kind === 'rock';
      const gap = rock ? this.info.surf((p.x0 + p.x1) / 2) - p.y : 0;
      rec = { kind: rock ? KIND.PLAT_ROCK : KIND.PLAT_LOG, f: p, sig, owned, sp: new Array(4 * NL).fill(null), data: { gap } };
      rec.bx0 = rock ? -26 : -10; rec.bw = L + (rock ? 52 : 20);
      rec.by0 = -12; rec.bh = rock ? Math.max(34, gap + 22) : 34;
      this.platRecs[i] = rec;
      return rec;
    }

    // ---------------------------------------------------------------------------- the frame

    // Draw the whole scene. t = seconds.
    render(t) {
      const world = this.world;
      if (!world || !world.terrain) return;
      if (t === undefined) t = performance.now() / 1000;
      const dt = this.lastT === null ? 1 / 60 : clamp(t - this.lastT, 0, 0.1);
      this.lastT = t;
      this.t = t;
      this.frameNo++;
      this._sync();
      if (this.w <= 1) this.resize();
      this._updateCamera(dt);
      this.sky.update(world, t);
      this.ss = this.sky.ss;
      this.wind = 0.65 + 0.35 * Math.sin(t * 0.21) + 0.15 * Math.sin(t * 0.53 + 1);
      this.buildsLeft = BUILDS_PER_FRAME;
      this._preparePoses();

      const g = this.ctx;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, this.canvas.width, this.canvas.height);
      g.imageSmoothingEnabled = true;

      // The lit scene, back to front
      this.sky.drawBackdrop(g, this);
      this._drawTerrain(g);
      this._drawFeatures(g, t, false);
      this._setWorldTransform(g);
      this._drawShadows(g);
      this._drawItems(g, t, false);
      this._drawCreatures(g, t);
      this._drawItems(g, t, true);
      this._drawWater(g, t);
      this._drawFeatures(g, t, true);
      this._updateParticles(dt, t);
      this._setWorldTransform(g);
      this._drawParticles(g);
      this._applyLight(g);
      // The sky goes behind everything drawn so far
      this.sky.drawSky(g, this, t);
      // Things that give off light, then the frame
      this._setWorldTransform(g);
      this._drawGlow(g, t);
      this._drawVignette(g);
      // Overlays
      this._setWorldTransform(g);
      if (this.options.showScent) this._drawScent(g);
      if (this.options.showSenses) this._drawSenses(g, t);
      this._drawSounds(g, t);
      this._drawHand(g, t);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }

    _drawTerrain(g) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      const cols = this.tileCols, rows = this.tileRows;
      const i0 = Math.max(0, Math.floor(this.vx0 / TILE)), i1 = Math.min(cols - 1, Math.floor(this.vx1 / TILE));
      const j0 = Math.max(0, Math.floor(this.vy0 / TILE)), j1 = Math.min(rows - 1, Math.floor(this.vy1 / TILE));
      const ss = this.ss, k = this.k;
      for (let pass = 0; pass < 2; pass++) {
        if (pass && ss.blend <= 0.001 && !ss.prefetch) break;
        const si = pass ? ss.next : ss.cur;
        g.globalAlpha = pass ? ss.blend : 1;
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const rec = this.tiles[j * cols + i];
            if (rec.empty) continue;
            const sp = this._sprite(rec, si, !pass);
            if (!sp || g.globalAlpha < 0.002) continue;
            const dx0 = Math.round(rec.bx0 * k + this.ox), dx1 = Math.round((rec.bx0 + TILE) * k + this.ox);
            const dy0 = Math.round(rec.by0 * k + this.oy), dy1 = Math.round((rec.by0 + TILE) * k + this.oy);
            g.drawImage(sp.canvas, dx0, dy0, dx1 - dx0, dy1 - dy0);
          }
        }
      }
      g.globalAlpha = 1;
    }

    _visible(rec, x, y, margin) {
      return x + rec.bx0 + rec.bw > this.vx0 - margin && x + rec.bx0 < this.vx1 + margin &&
        y + rec.by0 + rec.bh > this.vy0 - margin && y + rec.by0 < this.vy1 + margin;
    }

    _drawFeatures(g, t, front) {
      const fs = this.world.features || [];
      const passes = front ? FRONT_PASSES : BACK_PASSES;
      for (let pi = 0; pi < passes.length; pi++) {
        const kinds = passes[pi];
        if (!kinds) { this._drawPlatforms(g); continue; }
        for (let i = 0; i < fs.length; i++) {
          const f = fs[i];
          const kind = FEATURE_KIND[f.kind];
          if (kind !== kinds[0] && kind !== kinds[1]) continue;
          const rec = this._featRec(f);
          if (!rec || !this._visible(rec, f.x, f.y, 40)) continue;
          this._drawFeature(g, rec, f, t);
        }
      }
    }

    _drawFeature(g, rec, f, t) {
      const ss = this.ss;
      let rot = 0, skew = 0;
      const w = this.wind;
      switch (rec.kind) {
        case KIND.TREE: rot = (0.004 + 0.003 * w) * Math.sin(t * 0.8 + rec.phase) + 0.002 * Math.sin(t * 2.1 + rec.phase); break;
        case KIND.GRASS: skew = -(0.05 * w + 0.07 * Math.sin(t * 1.5 + rec.phase) + 0.02 * Math.sin(t * 3.7 + rec.phase)); break;
        case KIND.REEDS: skew = -(0.04 * w + 0.05 * Math.sin(t * 1.2 + rec.phase)); break;
      }
      for (let pass = 0; pass < 2; pass++) {
        if (pass && ss.blend <= 0.001 && !ss.prefetch) break;
        const si = pass ? ss.next : ss.cur;
        const sp = this._sprite(rec, si, !pass);
        const a = pass ? ss.blend : 1;
        if (!sp || a < 0.002) continue;
        this._setLocal(g, f.x, f.y, rot, skew);
        g.globalAlpha = a;
        g.drawImage(sp.canvas, rec.bx0, rec.by0, rec.bw, rec.bh);
      }
      g.globalAlpha = 1;
      // Live parts on top, in the same swaying frame
      if (rec.kind === KIND.TREE && f.fruiting > 0.01) this._drawTreeFruit(g, rec, f, t);
      else if (rec.kind === KIND.GRASS && f.seeding > 0.01) this._drawSeedHeads(g, rec, f);
      else if (rec.kind === KIND.ROCK && f.warm > 0.05) this._drawHeatShimmer(g, rec, f, t);
    }

    _drawPlatforms(g) {
      const ps = this.world.platforms;
      if (!ps) return;
      const ss = this.ss;
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i];
        const rec = this._platRec(p, i);
        if (rec.owned || !this._visible(rec, p.x0, p.y, 20)) continue;
        for (let pass = 0; pass < 2; pass++) {
          if (pass && ss.blend <= 0.001 && !ss.prefetch) break;
          const sp = this._sprite(rec, pass ? ss.next : ss.cur, !pass);
          const a = pass ? ss.blend : 1;
          if (!sp || a < 0.002) continue;
          this._setLocal(g, p.x0, p.y, 0, 0);
          g.globalAlpha = a;
          g.drawImage(sp.canvas, rec.bx0, rec.by0, rec.bw, rec.bh);
        }
        g.globalAlpha = 1;
      }
    }

    _drawTreeFruit(g, rec, f, t) {
      const pts = rec.data.fruit;
      const n = Math.min(pts.length, Math.round(f.fruiting * pts.length));
      const it = this.fake;
      it.type = f.species === 'mimic' ? 'mimic' : 'fruit';
      it.radius = 4.3;
      const lift = it.radius * (Evo.ItemArt.LIFT[it.type] || 1);
      for (let k = 0; k < n; k++) {
        it.id = k;
        it.x = pts[k].x;
        it.y = pts[k].y + lift; // the fruit's centre on the spot
        it.rot = Math.sin(t * 1.3 + k + rec.phase) * 0.12;
        Evo.ItemArt.draw(g, it, t);
      }
    }

    _drawSeedHeads(g, rec, f) {
      const heads = rec.data.heads;
      const n = Math.min(heads.length, Math.round(f.seeding * heads.length));
      if (!n) return;
      const IC = this._itemColors();
      g.strokeStyle = this.ss.cur === 3 ? '#b5a882' : '#b39a52';
      g.lineWidth = 1;
      g.beginPath();
      for (let k = 0; k < n; k++) {
        const h = heads[k];
        g.moveTo(h.x, 2);
        g.quadraticCurveTo(h.x, -h.h * 0.5, h.x + h.lean * h.h, -h.h);
      }
      g.stroke();
      g.fillStyle = IC.grain;
      g.strokeStyle = IC.grainDark;
      g.lineWidth = 0.6;
      g.beginPath();
      for (let k = 0; k < n; k++) {
        const h = heads[k];
        const tx = h.x + h.lean * h.h, ty = -h.h;
        for (let s = 0; s < 4; s++) {
          const y = ty + s * 2.6 + 1.5, x = tx - h.lean * s * 2.6;
          g.moveTo(x + 0.2, y); g.ellipse(x - 1.2, y, 1.5, 0.95, -0.7, 0, TAU);
          g.moveTo(x + 2.6, y); g.ellipse(x + 1.2, y, 1.5, 0.95, 0.7, 0, TAU);
        }
        g.moveTo(tx + 1, ty - 0.5); g.ellipse(tx, ty - 0.5, 1, 1.6, 0, 0, TAU);
      }
      g.fill();
      g.stroke();
    }

    _itemColors() {
      if (!this.ic) {
        const grain = Evo.theme.color('--grain');
        this.ic = { grain, grainDark: rgb(scale(Evo.theme.hexRgb(grain), 0.6)) };
      }
      return this.ic;
    }

    // Warm air rising off the rock: faint wavering strands that fade as they rise
    _drawHeatShimmer(g, rec, f, t) {
      const s = rec.data, a = clamp01((f.warm - 0.05) / 0.6);
      g.lineWidth = 0.9;
      for (let k = 0; k < 4; k++) {
        const u = (t * 0.45 + k * 0.25) % 1;
        const x0 = (k - 1.5) * s.w * 0.2;
        const y0 = -s.h * 0.95 - u * 26;
        g.strokeStyle = 'rgba(255,238,215,' + (0.3 * a * Math.sin(u * Math.PI)).toFixed(3) + ')';
        g.beginPath();
        for (let j = 0; j <= 6; j++) {
          const y = y0 - j * 2, x = x0 + Math.sin(j * 0.8 + t * 4 + k * 2) * 1.4;
          j ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.stroke();
      }
    }

    // Poses are computed once per frame (culled to the view) and reused for shadows, drawing and hover
    _preparePoses() {
      const cs = this.world.creatures || [];
      const poses = this.poses;
      poses.length = cs.length;
      const useArt = !!(Evo.poseOf && Evo.CreatureArt && !this.artBroken);
      // The real art draws each creature's shadow and focus ring from the pose; placeholders don't
      this.artGround = useArt && !Evo.CreatureArt.placeholder && Evo.CreatureArt.drawsGround !== false;
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i];
        const vis = c.x > this.vx0 - 90 && c.x < this.vx1 + 90 && c.y > this.vy0 - 90 && c.y < this.vy1 + 140;
        const pose = poses[i] = vis && useArt ? this._safePose(c) : null;
        // Where the ground is, so a jumping creature's shadow stays on it (an optional pose field)
        if (pose && pose.groundY === undefined) pose.groundY = this._surfaceBelow(c.x, c.y - 1);
      }
      // Hover under the hand
      this.hoveredCreature = null;
      this.hoveredItem = null;
      const hand = this.options.hand;
      if (hand && hand.x != null) {
        const p = hand.space === 'world' ? hand : this.screenToWorld(hand.x, hand.y);
        let bestD = Infinity;
        for (let i = 0; i < cs.length; i++) {
          const d = this._creatureHit(cs[i], poses[i], p.x, p.y, 4 / this.cam.zoom);
          if (d < bestD) { bestD = d; this.hoveredCreature = cs[i]; }
        }
        if (!this.hoveredCreature && (!hand.mode || hand.mode === 'grab') && !hand.holding) this.hoveredItem = this._itemAtWorld(p.x, p.y, 6 / this.cam.zoom);
      }
      const focused = this._focused();
      for (let i = 0; i < cs.length; i++) {
        const pose = poses[i];
        if (!pose) continue;
        pose.focused = cs[i] === focused;
        pose.hovered = cs[i] === this.hoveredCreature;
      }
    }

    _safePose(c) {
      try { return Evo.poseOf(c); } catch (err) { this._artFailed(err); return null; }
    }

    _artFailed(err) {
      if (!this.artBroken) console.warn('WorldView: creature art failed, using placeholders', err);
      this.artBroken = true;
    }

    _poseFor(c, i) {
      const p = this.poses[i];
      if (p && this.world.creatures[i] === c) return p;
      return Evo.poseOf && Evo.CreatureArt && !this.artBroken ? this._safePose(c) : null;
    }

    // Distance-like score of a hit (Infinity if missed)
    _creatureHit(c, pose, x, y, pad) {
      if (pose && Evo.CreatureArt && Evo.CreatureArt.bounds) {
        const b = Evo.CreatureArt.bounds(pose);
        if (x < b.x0 - pad || x > b.x1 + pad || y < b.y0 - pad || y > b.y1 + pad) return Infinity;
        return Math.hypot(x - (b.x0 + b.x1) / 2, y - (b.y0 + b.y1) / 2);
      }
      const r = (c.size || (pose && pose.size) || 30) * 0.6 + pad;
      const d = Math.hypot(x - c.x, y - (c.y - 15));
      return d < r ? d : Infinity;
    }

    _itemAtWorld(x, y, pad) {
      const items = this.world.items;
      if (!items) return null;
      let best = null, bestD = Infinity;
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        const r = Math.max((it.radius || 5) * 1.5, pad * 1.4) + pad;
        const d = Math.hypot(x - it.x, y - Evo.ItemArt.centerY(it));
        if (d < r && d < bestD) { bestD = d; best = it; }
      }
      return best;
    }

    _focused() {
      const f = this.options.focused;
      if (f == null) return null;
      if (typeof f === 'object') return f;
      const cs = this.world.creatures || [];
      for (let i = 0; i < cs.length; i++) if (cs[i].id === f) return cs[i];
      return null;
    }

    _drawShadows(g) {
      const items = this.world.items || [], cs = this.world.creatures || [];
      g.fillStyle = 'rgba(28,20,36,0.2)';
      g.beginPath();
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.held || it.x < this.vx0 - 20 || it.x > this.vx1 + 20) continue;
        const r = it.radius || 5;
        const sy = this._surfaceBelow(it.x, it.y - 1);
        const gap = sy - it.y;
        if (gap > 70 || gap < -r * 2 || this._floatDepth(it) >= 0) continue;
        const k = 1 - clamp01(gap / 70);
        const rx = r * (0.7 + 0.45 * k);
        g.moveTo(it.x + rx, sy);
        g.ellipse(it.x, sy, rx, rx * 0.3, 0, 0, TAU);
      }
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i];
        if (c.x < this.vx0 - 60 || c.x > this.vx1 + 60 || c.held || (this.artGround && this.poses[i])) continue;
        const size = (this.poses[i] && this.poses[i].size) || c.size || 30;
        const sy = this._surfaceBelow(c.x, c.y);
        const gap = sy - c.y;
        if (gap > 120 || gap < -20) continue;
        const k = 1 - clamp01(gap / 120);
        const rx = size * (0.3 + 0.28 * k);
        g.moveTo(c.x + rx, sy);
        g.ellipse(c.x, sy, rx, rx * 0.26, 0, 0, TAU);
      }
      g.fill();
    }

    _drawItems(g, t, held) {
      const items = this.world.items;
      if (!items) return;
      const art = Evo.ItemArt, m = 30;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!!it.held !== held) continue;
        if (it.x < this.vx0 - m || it.x > this.vx1 + m || it.y < this.vy0 - m || it.y > this.vy1 + m) continue;
        if (it === this.hoveredItem) {
          const r = (it.radius || 5) * 1.9 + 1.5 * Math.sin(t * 5);
          g.strokeStyle = 'rgba(255,255,255,0.8)';
          g.lineWidth = 1.4;
          g.beginPath(); g.arc(it.x, art.centerY(it), r, 0, TAU); g.stroke();
          g.fillStyle = 'rgba(255,255,255,0.14)';
          g.fill();
        }
        // Things floating on a pond sit half in the water and bob
        const float = held ? -1 : this._floatDepth(it);
        art.draw(g, it, t, float >= 0 ? (it.radius || 5) * 0.55 + Math.sin(t * 1.7 + (it.id | 0)) * 0.9 : 0);
      }
    }

    // >= 0 when an item rests on a pond's surface (how far above the bed), else -1
    _floatDepth(it) {
      if (it.held) return -1;
      const wl = this.info.waterAt(it.x);
      if (wl === null || it.y < wl - 1.5 || it.y > wl + 1.5) return -1;
      const d = this.info.surf(it.x) - wl;
      return d > 2 ? d : -1;
    }

    _drawCreatures(g, t) {
      const cs = this.world.creatures;
      if (!cs || !cs.length) return;
      const focused = this._focused();
      const art = Evo.CreatureArt;
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < cs.length; i++) {
          const c = cs[i];
          if ((c === focused) !== (pass === 1)) continue;
          if (c.x < this.vx0 - 90 || c.x > this.vx1 + 90 || c.y < this.vy0 - 90 || c.y > this.vy1 + 140) continue;
          const pose = this.poses[i];
          const ringFromArt = this.artGround && pose;
          if (c === focused && !ringFromArt) this._drawFocusRing(g, c, pose, t, true);
          this._setWorldTransform(g);
          if (pose && art && !this.artBroken) {
            try { art.draw(g, pose, t); } catch (err) { this._artFailed(err); this._drawPlaceholder(g, c, pose, t); }
          } else {
            this._drawPlaceholder(g, c, pose, t);
          }
          this._setWorldTransform(g);
          g.globalAlpha = 1;
          if (c === focused && !ringFromArt) this._drawFocusRing(g, c, pose, t, false);
        }
      }
    }

    // A glowing ring on the ground under the focused creature: back half behind it, front half in front
    _drawFocusRing(g, c, pose, t, back) {
      const size = (pose && pose.size) || c.size || 30;
      const sy = this._surfaceBelow(c.x, c.y - 2);
      const rx = size * 0.55 + 6, ry = rx * 0.28;
      const pulse = 0.5 + 0.5 * Math.sin(t * 3);
      g.lineWidth = 2;
      g.strokeStyle = 'rgba(155,227,200,' + (0.55 + 0.35 * pulse).toFixed(3) + ')';
      g.beginPath();
      g.ellipse(c.x, sy, rx, ry, 0, back ? Math.PI : 0, back ? TAU : Math.PI);
      g.stroke();
      if (back) {
        g.fillStyle = 'rgba(155,227,200,0.14)';
        g.beginPath(); g.ellipse(c.x, sy, rx, ry, 0, 0, TAU); g.fill();
      }
    }

    // Used until Evo.CreatureArt is loaded: a simple round critter
    _drawPlaceholder(g, c, pose, t) {
      const size = (pose && pose.size) || c.size || 30;
      const dir = ((pose ? pose.facing : c.facing) || 1) < 0 ? -1 : 1;
      const hue = (pose && pose.looks && pose.looks.hue) || (c.looks && c.looks.hue) || c.hue || 30;
      const walk = Math.sin((c.x || 0) * 0.25);
      g.save();
      g.translate(c.x, c.y);
      g.scale(dir, 1);
      const bw = size * 0.46, bh = size * 0.3, leg = size * 0.22;
      g.strokeStyle = `hsl(${hue},35%,30%)`;
      g.lineWidth = size * 0.07;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(-bw * 0.4, -leg); g.lineTo(-bw * 0.4 + walk * 3, 0);
      g.moveTo(bw * 0.4, -leg); g.lineTo(bw * 0.4 - walk * 3, 0);
      g.stroke();
      g.fillStyle = `hsl(${hue},55%,62%)`;
      g.beginPath(); g.ellipse(0, -leg - bh * 0.8, bw, bh, 0, 0, TAU); g.fill(); g.stroke();
      g.beginPath(); g.arc(bw * 0.85, -leg - bh * 1.6, bh * 0.85, 0, TAU); g.fill(); g.stroke();
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(bw * 1.05, -leg - bh * 1.75, bh * 0.3, 0, TAU); g.fill();
      g.fillStyle = '#222';
      g.beginPath(); g.arc(bw * 1.12, -leg - bh * 1.72, bh * 0.15, 0, TAU); g.fill();
      g.restore();
    }

    _drawWater(g, t) {
      const ponds = this.world.terrain.ponds;
      if (!ponds || !ponds.length) return;
      const pal = this.sky.pal;
      const ice = this._iceAmount();
      const amp = 1.1 * (1 - ice);
      const wc = this._waterColors();
      const surf = this.info.surf, step = this.info.step;
      for (let pi = 0; pi < ponds.length; pi++) {
        const p = ponds[pi];
        if (p.x1 < this.vx0 || p.x0 > this.vx1) continue;
        const L = p.level;
        let deep = L;
        for (let x = p.x0; x <= p.x1; x += step) deep = Math.max(deep, surf(x));
        const depth = Math.max(8, deep - L);
        // Water body: animated surface on top, the pond bed below
        g.beginPath();
        g.moveTo(p.x0, L);
        for (let x = p.x0; x <= p.x1; x += 5) g.lineTo(x, L + this._wave(x, t, amp));
        g.lineTo(p.x1, L);
        for (let x = Math.floor(p.x1 / step) * step; x > p.x0; x -= step) g.lineTo(x, Math.max(L, surf(x)) + 1);
        g.closePath();
        const grd = g.createLinearGradient(0, L - 2, 0, L + depth);
        grd.addColorStop(0, rgba(mix(wc.water, pal.hor, 0.4), 0.62));
        grd.addColorStop(0.18, rgba(mix(wc.water, pal.mid, 0.25), 0.66));
        grd.addColorStop(1, rgba(mix(wc.water, [10, 40, 70], 0.7), 0.86));
        g.fillStyle = grd;
        g.fill();
        g.save();
        g.clip();
        // Light shafts in daylight
        if (pal.day > 0.05 && ice < 0.9) {
          g.fillStyle = 'rgba(220,250,255,' + (0.07 * pal.day * (1 - ice)).toFixed(3) + ')';
          g.beginPath();
          for (let k = 0; k < 4; k++) {
            const x = p.x0 + (p.x1 - p.x0) * (0.15 + k * 0.22) + Math.sin(t * 0.4 + k * 2) * 8;
            g.moveTo(x, L); g.lineTo(x + 12, L); g.lineTo(x - 14, L + depth); g.lineTo(x - 30, L + depth); g.closePath();
          }
          g.fill();
        }
        // Bubbles rising from the bed
        if (ice < 0.5) {
          g.strokeStyle = 'rgba(230,250,255,0.55)';
          g.lineWidth = 0.8;
          g.beginPath();
          for (let k = 0; k < 4; k++) {
            const bx0 = p.x0 + (p.x1 - p.x0) * (0.3 + hash2(pi, k) * 0.4);
            const u = (t / 4.5 + hash2(k, pi + 9)) % 1;
            const by = surf(bx0) + (L - surf(bx0)) * u;
            const bx = bx0 + Math.sin(u * 12 + k) * 2;
            const r = 0.8 + u * 1.3;
            g.moveTo(bx + r, by); g.arc(bx, by, r, 0, TAU);
          }
          g.stroke();
        }
        // Ice
        if (ice > 0.01) {
          g.globalAlpha = ice;
          g.fillStyle = 'rgba(226,242,250,0.88)';
          g.fillRect(p.x0 - 2, L - 2, p.x1 - p.x0 + 4, 7);
          g.fillStyle = 'rgba(200,228,244,0.35)';
          g.fillRect(p.x0 - 2, L + 5, p.x1 - p.x0 + 4, 6);
          g.strokeStyle = 'rgba(255,255,255,0.9)';
          g.lineWidth = 1.2;
          g.beginPath();
          const n = Math.round((p.x1 - p.x0) / 40);
          for (let k = 0; k < n; k++) {
            const x = p.x0 + (k + 0.3 + hash2(k, 3) * 0.4) * (p.x1 - p.x0) / n;
            g.moveTo(x, L + 4); g.lineTo(x + 6, L - 1);
            g.moveTo(x + 4, L + 4); g.lineTo(x + 7, L + 0.5);
          }
          g.stroke();
          g.strokeStyle = 'rgba(130,170,200,0.6)';
          g.lineWidth = 0.8;
          g.beginPath();
          const cx = p.x0 + (p.x1 - p.x0) * 0.62;
          g.moveTo(cx, L); g.lineTo(cx + 5, L + 3); g.lineTo(cx + 2, L + 6);
          g.moveTo(cx + 5, L + 3); g.lineTo(cx + 12, L + 4);
          g.stroke();
          g.globalAlpha = 1;
        }
        g.restore();
        // Surface: a bright edge and a band reflecting the sky
        g.lineWidth = 2.4;
        g.strokeStyle = rgba(pal.mid, 0.45 * (1 - ice));
        g.beginPath();
        for (let x = p.x0 + 1; x <= p.x1 - 1; x += 5) {
          const y = L + 2 + this._wave(x, t, amp);
          x === p.x0 + 1 ? g.moveTo(x, y) : g.lineTo(x, y);
        }
        g.stroke();
        g.lineWidth = 1.2;
        g.strokeStyle = ice > 0.5 ? 'rgba(255,255,255,0.95)' : 'rgba(240,252,255,0.8)';
        g.beginPath();
        for (let x = p.x0 + 1; x <= p.x1 - 1; x += 5) {
          const y = L + this._wave(x, t, amp);
          x === p.x0 + 1 ? g.moveTo(x, y) : g.lineTo(x, y);
        }
        g.stroke();
        if (ice < 0.6) this._drawLilies(g, p, pi, t, amp, 1 - ice / 0.6);
        else this._drawIceSnow(g, p, pi, ice);
      }
    }

    _wave(x, t, amp) {
      return amp * (Math.sin(x * 0.045 + t * 1.6) + 0.6 * Math.sin(x * 0.11 - t * 2.3));
    }

    _waterColors() {
      if (!this.wc) {
        this.wc = { water: Evo.theme.rgb('--water') };
      }
      return this.wc;
    }

    _drawLilies(g, p, pi, t, amp, alpha) {
      const si = this.ss.cur;
      if (si === 3) return;
      const n = Math.max(2, Math.round((p.x1 - p.x0) / 70));
      g.globalAlpha = alpha;
      for (let k = 0; k < n; k++) {
        const x = p.x0 + (p.x1 - p.x0) * (0.12 + 0.76 * hash2(pi * 31 + k, 11)) + Math.sin(t * 0.2 + k) * 3;
        const y = p.level + this._wave(x, t, amp) - 0.5;
        const r = 6 + hash2(k, pi) * 4;
        g.fillStyle = si === 2 ? '#a8a04a' : '#3f8f4a';
        g.beginPath(); g.ellipse(x, y, r, r * 0.3, 0, 0.25, TAU - 0.1); g.lineTo(x, y); g.closePath(); g.fill();
        g.fillStyle = si === 2 ? '#c6b85c' : '#62b060';
        g.beginPath(); g.ellipse(x - r * 0.15, y - 0.6, r * 0.7, r * 0.16, 0, 0, TAU); g.fill();
        if (k % 2 === 0 && si < 2) {
          g.fillStyle = si === 0 ? '#ffd3e4' : '#fff5fa';
          g.beginPath();
          g.moveTo(x - 3.6, y - 1); g.lineTo(x - 2.2, y - 5.5); g.lineTo(x - 0.8, y - 2.4); g.lineTo(x, y - 6.5);
          g.lineTo(x + 0.8, y - 2.4); g.lineTo(x + 2.2, y - 5.5); g.lineTo(x + 3.6, y - 1); g.closePath();
          g.fill();
          g.fillStyle = '#f7c948';
          g.beginPath(); g.arc(x, y - 1.8, 1.1, 0, TAU); g.fill();
        }
      }
      g.globalAlpha = 1;
    }

    _drawIceSnow(g, p, pi, ice) {
      g.globalAlpha = ice;
      g.fillStyle = SNOW.body;
      g.beginPath();
      for (let k = 0; k < 3; k++) {
        const x = p.x0 + (p.x1 - p.x0) * (0.15 + 0.7 * hash2(pi * 7 + k, 21));
        const r = 10 + hash2(k, 5) * 14;
        g.moveTo(x + r, p.level - 1);
        g.ellipse(x, p.level - 1, r, 2.4, 0, Math.PI, TAU);
      }
      g.fill();
      g.globalAlpha = 1;
    }

    // ---- Weather and seasonal particles (pooled, world space) ----
    _spawn(kind, x, y, col) {
      const P = this.p;
      if (P.n >= MAX_PARTICLES) return -1;
      const i = P.n++;
      const R = Math.random;
      P.kind[i] = kind; P.x[i] = x; P.y[i] = y; P.col[i] = col; P.rest[i] = 0;
      P.rot[i] = R() * TAU; P.vr[i] = (R() - 0.5) * 4; P.ph[i] = R() * TAU;
      P.vx[i] = 0; P.vy[i] = 0;
      switch (kind) {
        case 0: P.size[i] = 2.4 + R() * 1.4; P.life[i] = 30; break;        // leaf
        case 1: P.size[i] = 0.7 + R() * 1.6; P.life[i] = 60; break;        // snow
        case 2: P.size[i] = 1.8 + R() * 0.9; P.life[i] = 25; break;        // petal
        case 3: P.size[i] = 0.6 + R() * 0.7; P.life[i] = 6 + R() * 6; break; // pollen
        case 4: P.size[i] = 1.2 + R() * 0.6; P.life[i] = 10 + R() * 12; break; // firefly
      }
      return i;
    }

    _updateParticles(dt, t) {
      const P = this.p, ss = this.ss, pal = this.sky.pal, R = Math.random;
      const si = ss.blend > 0.5 ? ss.next : ss.cur;
      const x0 = this.vx0, x1 = this.vx1, y0 = this.vy0, y1 = this.vy1;
      const vw = x1 - x0, vh = y1 - y0;
      const area = clamp((vw * vh) / (1100 * 650), 0.25, 2.5);
      const fresh = si !== this.pSeason;
      this.pSeason = si;
      if (fresh) { // drop the last season's weather at once
        for (let i = 0; i < P.n; i++) {
          const k = P.kind[i];
          const keep = (k === 1 && si === 3) || (k === 0 && si === 2) || (k === 2 && si === 0) || ((k === 3 || k === 4) && si < 2);
          if (!keep) this._kill(i--);
        }
      }
      // Spawning
      const wind = this.wind;
      if (si === 3) { // snow: keep a density in view, heavier now and then
        const target = Math.round(area * (110 + 70 * Math.sin(t * 0.05)));
        let count = 0;
        for (let i = 0; i < P.n; i++) if (P.kind[i] === 1) count++;
        let need = target - count;
        while (need-- > 0) {
          const i = this._spawn(1, x0 - 60 + R() * (vw + 120), fresh ? y0 + R() * vh : y0 - 10 - R() * 40, 5);
          if (i < 0) break;
        }
      } else if (si === 2 || si === 0) { // leaves from the trees in autumn, petals in spring
        const kind = si === 2 ? 0 : 2;
        this.pSpawn += dt;
        const fs = this.world.features || [];
        if (this.pSpawn > 0.12) {
          const steps = Math.min(8, Math.floor(this.pSpawn / 0.12));
          this.pSpawn -= steps * 0.12;
          for (let s = 0; s < steps; s++) {
            for (let k = 0; k < fs.length; k++) {
              const f = fs[k];
              if (f.kind !== 'tree') continue;
              const rec = this.featRecs.get(f.id);
              if (!rec || f.x < x0 - 200 || f.x > x1 + 200) continue;
              if (R() > (si === 2 ? 0.26 : 0.1)) continue;
              const d = rec.data;
              const a = R() * TAU;
              this._spawn(kind, f.x + Math.cos(a) * d.cr * 0.9, f.y + d.cy + Math.sin(a) * d.cr * 0.6, kind === 0 ? (R() * 4) | 0 : 4 + ((R() * 2) | 0));
            }
            if (si === 2 && R() < 0.35) this._spawn(0, x0 - 40 + R() * (vw + 80), y0 - 10, (R() * 4) | 0);
          }
        }
      }
      if (si === 0 || si === 1) { // pollen motes by day, fireflies on summer nights
        let pollen = 0, flies = 0;
        for (let i = 0; i < P.n; i++) { if (P.kind[i] === 3) pollen++; else if (P.kind[i] === 4) flies++; }
        const wantPollen = Math.round(area * 18 * pal.day);
        for (let k = pollen; k < wantPollen; k++) this._spawn(3, x0 + R() * vw, this.info.meanS - 20 - R() * 160, 0);
        const wantFlies = si === 1 ? Math.round(area * 26 * pal.night) : 0;
        for (let k = flies; k < wantFlies; k++) {
          const x = x0 + R() * vw;
          this._spawn(4, x, this.info.surf(x) - 8 - R() * 70, 0);
        }
      }
      // Motion
      for (let i = 0; i < P.n; i++) {
        const kind = P.kind[i];
        let dead = false;
        P.life[i] -= dt;
        if (P.rest[i]) {
          if (P.life[i] <= 0) dead = true;
        } else {
          const ph = P.ph[i];
          switch (kind) {
            case 0: case 2: {
              const light = kind === 2 ? 0.7 : 1;
              P.vx[i] = wind * 22 * light + Math.sin(t * 2.1 + ph) * 16;
              P.vy[i] = (15 + Math.sin(t * 3.3 + ph) * 9) * light;
              P.rot[i] += P.vr[i] * dt * (1 + Math.sin(t * 2 + ph));
              break;
            }
            case 1:
              P.vx[i] = wind * 12 + Math.sin(t * 1.3 + ph) * 7;
              P.vy[i] = 20 + P.size[i] * 10;
              break;
            case 3:
              P.vx[i] = wind * 7 + Math.sin(t * 0.7 + ph) * 5;
              P.vy[i] = Math.sin(t * 0.9 + ph * 2) * 4 - 1;
              break;
            case 4:
              P.vx[i] += (Math.sin(t * 1.1 + ph * 3) * 14 - P.vx[i]) * dt;
              P.vy[i] += (Math.cos(t * 0.8 + ph * 5) * 9 - P.vy[i]) * dt;
              break;
          }
          P.x[i] += P.vx[i] * dt;
          P.y[i] += P.vy[i] * dt;
          if (kind <= 2) {
            const gy = this._surfaceBelow(P.x[i], P.y[i] - 2);
            if (P.y[i] >= gy - 1) {
              const wl = this.info.waterAt(P.x[i]);
              if (kind === 1 || (wl !== null && gy > wl)) dead = true; // snow melts in; leaves sink
              else { P.y[i] = gy - 1; P.rest[i] = 1; P.life[i] = 3 + R() * 4; }
            }
          }
          if (P.life[i] <= 0) dead = true;
        }
        if (P.x[i] < x0 - 150 || P.x[i] > x1 + 150 || P.y[i] > y1 + 60 || P.y[i] < y0 - 300) dead = true;
        if (kind === 1 && si !== 3 && R() < dt * 0.5) dead = true;
        if (kind === 4 && pal.night < 0.2 && R() < dt) dead = true;
        if (dead) this._kill(i--);
      }
    }

    _kill(i) {
      const P = this.p, j = --P.n;
      if (i === j) return;
      P.x[i] = P.x[j]; P.y[i] = P.y[j]; P.vx[i] = P.vx[j]; P.vy[i] = P.vy[j]; P.rot[i] = P.rot[j]; P.vr[i] = P.vr[j];
      P.life[i] = P.life[j]; P.size[i] = P.size[j]; P.ph[i] = P.ph[j]; P.kind[i] = P.kind[j]; P.col[i] = P.col[j]; P.rest[i] = P.rest[j];
    }

    _drawParticles(g) {
      const P = this.p;
      if (!P.n) return;
      // Leaves and petals, batched by colour
      for (let c = 0; c < LEAF_COLORS.length; c++) {
        let any = false;
        for (let i = 0; i < P.n; i++) {
          const k = P.kind[i];
          if ((k !== 0 && k !== 2) || P.col[i] !== c) continue;
          if (!any) { g.beginPath(); any = true; }
          const s = P.size[i];
          const flip = Math.abs(Math.cos(P.rot[i] * 0.7)) * 0.7 + 0.3; // tumbling
          g.moveTo(P.x[i] + s, P.y[i]);
          g.ellipse(P.x[i], P.y[i], s, s * 0.5 * flip, P.rot[i], 0, TAU);
        }
        if (any) {
          g.fillStyle = LEAF_COLORS[c];
          g.globalAlpha = 1;
          g.fill();
        }
      }
      // Snow, in two sizes
      for (let pass = 0; pass < 2; pass++) {
        let any = false;
        for (let i = 0; i < P.n; i++) {
          if (P.kind[i] !== 1 || (P.size[i] > 1.4) !== !!pass) continue;
          if (!any) { g.beginPath(); any = true; }
          g.moveTo(P.x[i] + P.size[i], P.y[i]);
          g.arc(P.x[i], P.y[i], P.size[i], 0, TAU);
        }
        if (any) {
          g.fillStyle = pass ? 'rgba(255,255,255,0.95)' : 'rgba(240,246,255,0.8)';
          g.fill();
        }
      }
      // Pollen motes
      let any = false;
      for (let i = 0; i < P.n; i++) {
        if (P.kind[i] !== 3) continue;
        if (!any) { g.beginPath(); any = true; }
        g.moveTo(P.x[i] + P.size[i], P.y[i]);
        g.arc(P.x[i], P.y[i], P.size[i], 0, TAU);
      }
      if (any) { g.fillStyle = 'rgba(255,244,190,0.7)'; g.fill(); }
      g.globalAlpha = 1;
    }

    // Night and twilight: tint everything drawn so far (the sky is painted behind afterwards)
    _applyLight(g) {
      const pal = this.sky.pal;
      if (pal.ambA < 0.004) return;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'source-atop';
      g.globalAlpha = pal.ambA;
      g.fillStyle = pal.ambCss;
      g.fillRect(0, 0, this.canvas.width, this.canvas.height);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }

    // Emissive things, added on top of the lit scene
    _drawGlow(g, t) {
      const pal = this.sky.pal, night = pal.night, gl = this.glows;
      g.globalCompositeOperation = 'lighter';
      // The warm rock
      const fs = this.world.features || [];
      for (let i = 0; i < fs.length; i++) {
        const f = fs[i];
        if (f.kind !== 'rock' || !(f.warm > 0.03) || f.x < this.vx0 - 100 || f.x > this.vx1 + 100) continue;
        const w = f.w || 70, h = f.h || 40;
        g.globalAlpha = clamp01(f.warm) * (0.22 + 0.4 * night) * (0.9 + 0.1 * Math.sin(t * 2 + i));
        g.drawImage(gl.warm, f.x - w * 0.95, f.y - h * 1.45, w * 1.9, h * 1.9);
      }
      // Lures glow softly, more at night; eggs about to hatch too
      const items = this.world.items || [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.x < this.vx0 - 40 || it.x > this.vx1 + 40) continue;
        if (it.type === 'lure') {
          const r = (it.radius || 5) * 5, cy = Evo.ItemArt.centerY(it);
          g.globalAlpha = (0.12 + 0.4 * night) * (0.8 + 0.2 * Math.sin(t * 2.4 + i));
          g.drawImage(gl.lure, it.x - r, cy - r * 1.1, r * 2, r * 2);
        } else if (it.type === 'egg' && it.progress > 0.8) {
          const r = (it.radius || 8) * 3, cy = Evo.ItemArt.centerY(it);
          g.globalAlpha = (it.progress - 0.8) * 1.4 * (0.6 + 0.4 * Math.sin(t * 3 + i));
          g.drawImage(gl.egg, it.x - r, cy - r, r * 2, r * 2);
        }
      }
      // Fireflies
      const P = this.p;
      for (let i = 0; i < P.n; i++) {
        if (P.kind[i] !== 4) continue;
        const blink = Math.max(0, Math.sin(this.t * 2.2 + P.ph[i] * 3));
        const a = blink * blink * night * Math.min(1, P.life[i]);
        if (a < 0.02) continue;
        g.globalAlpha = a;
        const r = 7 * P.size[i];
        g.drawImage(gl.fly, P.x[i] - r, P.y[i] - r, r * 2, r * 2);
      }
      // Sun glints on open water
      const ice = this._iceAmount();
      const ponds = this.world.terrain.ponds || [];
      if (pal.day > 0.05 && ice < 0.5) {
        g.strokeStyle = '#ffffff';
        g.lineWidth = 1.2;
        g.lineCap = 'round';
        for (let pi = 0; pi < ponds.length; pi++) {
          const p = ponds[pi], W = p.x1 - p.x0;
          for (let k = 0; k < 7; k++) {
            const x = p.x0 + 8 + ((hash2(k, pi) * W + t * (6 + k * 2)) % (W - 16));
            const s = Math.sin(t * 2.6 + k * 1.9);
            if (s < 0.2) continue;
            g.globalAlpha = pal.day * (1 - ice * 2) * (s - 0.2) * 0.9;
            const y = p.level + this._wave(x, t, 1.1) + 0.5;
            g.beginPath(); g.moveTo(x - 2.5, y); g.lineTo(x + 2.5, y); g.stroke();
          }
        }
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }

    _drawVignette(g) {
      const dpr = this.dpr, w = this.w, h = this.h;
      if (!this.vignette) {
        const grd = g.createRadialGradient(w / 2, h * 0.46, Math.min(w, h) * 0.38, w / 2, h * 0.46, Math.hypot(w / 2, h / 2) * 1.1);
        grd.addColorStop(0, 'rgba(12,14,30,0)');
        grd.addColorStop(1, 'rgba(12,14,30,0.6)');
        this.vignette = grd;
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.globalAlpha = 0.45 + 0.4 * this.sky.pal.night;
      g.fillStyle = this.vignette;
      g.fillRect(0, 0, w, h);
      g.globalAlpha = 1;
    }

    // ---- Overlays ----

    // The scent field as a soft low-resolution image (cells under the ground are left clear)
    _drawScent(g) {
      const sc = this.world.scent;
      if (!sc || !sc.channels || !sc.channels.length) return;
      let S = this.scent;
      if (!S || S.cols !== sc.cols || S.rows !== sc.rows || S.cell !== sc.cell || S.nch !== sc.channels.length) {
        const canvas = makeCanvas(sc.cols, sc.rows);
        const cg = canvas.getContext('2d');
        const colors = [];
        for (let ch = 0; ch < sc.channels.length; ch++) {
          const def = Evo.SCENTS && Evo.SCENTS[ch];
          colors.push(Evo.theme.rgb(def.token));
        }
        const air = new Uint8Array(sc.cols * sc.rows);
        for (let j = 0; j < sc.rows; j++) {
          for (let i = 0; i < sc.cols; i++) {
            const x = (i + 0.5) * sc.cell, y = (j + 0.5) * sc.cell;
            air[j * sc.cols + i] = y < this.info.surf(x) + sc.cell * 0.3 ? 1 : 0;
          }
        }
        S = this.scent = { cols: sc.cols, rows: sc.rows, cell: sc.cell, nch: sc.channels.length, canvas, cg, img: cg.createImageData(sc.cols, sc.rows), colors, air, frame: -1 };
      }
      if (S.frame !== this.frameNo) {
        S.frame = this.frameNo;
        const px = S.img.data, colors = S.colors, chans = sc.channels, n = sc.cols * sc.rows;
        for (let i = 0; i < n; i++) {
          const o = i * 4;
          if (!S.air[i]) { px[o + 3] = 0; continue; }
          let R = 0, G = 0, B = 0, total = 0;
          for (let ch = 0; ch < chans.length; ch++) {
            const v = chans[ch][i];
            if (v <= 0) continue;
            const c = colors[ch];
            R += c[0] * v; G += c[1] * v; B += c[2] * v; total += v;
          }
          if (total > 0.004) {
            px[o] = R / total; px[o + 1] = G / total; px[o + 2] = B / total;
            px[o + 3] = Math.min(140, Math.sqrt(total) * 105);
          } else {
            px[o + 3] = 0;
          }
        }
        S.cg.putImageData(S.img, 0, 0);
      }
      g.imageSmoothingEnabled = true;
      g.globalAlpha = 1;
      g.drawImage(S.canvas, 0, 0, sc.cols * sc.cell, sc.rows * sc.cell);
    }

    _drawSenses(g, t) {
      const c = this._focused();
      if (c && this.onDrawSenses) this.onDrawSenses(g, c, this, t);
      this._setWorldTransform(g);
    }

    // Calls rise as little music notes and fade
    _drawSounds(g, t) {
      const ss = this.world.sounds;
      if (!ss || !ss.length) return;
      for (let i = 0; i < ss.length; i++) {
        const s = ss[i];
        const life = s.life || SOUND_LIFE;
        const a = (s.age || 0) / life;
        if (a < 0 || a >= 1 || s.x < this.vx0 - 40 || s.x > this.vx1 + 40) continue;
        const loud = clamp01(s.loudness === undefined ? 0.6 : s.loudness);
        const alpha = Math.min(1, a * 8) * Math.pow(1 - a, 1.2);
        const high = (s.pitch || 0) >= 0.5;
        const size = 0.8 + loud * 0.5;
        const x = s.x + Math.sin(a * 6 + (s.sourceId | 0)) * 5;
        const y = s.y - 6 - a * 42;
        this._note(g, x, y, size, high, alpha, high ? '#bff3ff' : '#ffe2a8');
        if (loud > 0.45 && a > 0.12) {
          const b = a - 0.12;
          this._note(g, s.x + 9 + Math.sin(b * 6) * 4, s.y - 2 - b * 42, size * 0.8, high, Math.min(1, b * 8) * Math.pow(1 - a, 1.2), high ? '#bff3ff' : '#ffe2a8');
        }
      }
      g.globalAlpha = 1;
    }

    _note(g, x, y, s, high, alpha, col) {
      g.globalAlpha = alpha;
      g.lineWidth = 1.1 * s;
      g.strokeStyle = 'rgba(30,24,44,0.75)';
      g.fillStyle = col;
      g.lineCap = 'round';
      // Stem and flag
      const draw = pass => {
        g.beginPath();
        g.moveTo(x + 3 * s, y);
        g.lineTo(x + 3 * s, y - 9 * s);
        if (high) g.quadraticCurveTo(x + 7 * s, y - 7 * s, x + 6.5 * s, y - 3 * s);
        else { g.lineTo(x + 10 * s, y - 11 * s); g.lineTo(x + 10 * s, y - 2 * s); }
        g.lineWidth = (pass ? 1.3 : 3) * s;
        g.strokeStyle = pass ? col : 'rgba(30,24,44,0.75)';
        g.stroke();
        g.beginPath();
        g.ellipse(x, y, 3.2 * s, 2.3 * s, -0.35, 0, TAU);
        if (!high) { g.moveTo(x + 10 * s, y - 2 * s); g.ellipse(x + 7 * s, y - 2 * s, 3.2 * s, 2.3 * s, -0.35, 0, TAU); }
        if (pass) g.fill(); else { g.lineWidth = 1.6 * s; g.stroke(); }
      };
      draw(0);
      draw(1);
    }

    _drawHand(g, t) {
      const hand = this.options.hand;
      if (!hand || hand.x == null) return;
      let sx = hand.x, sy = hand.y;
      if (hand.space === 'world') { const p = this.worldToScreen(hand.x, hand.y); sx = p.x; sy = p.y; }
      const dpr = this.dpr;
      // Drop shadow, then the hand
      for (let pass = 0; pass < 2; pass++) {
        g.setTransform(dpr, 0, 0, dpr, (sx + (pass ? 0 : 3)) * dpr, (sy + (pass ? 0 : 4)) * dpr);
        if (!pass) {
          g.globalAlpha = 0.25;
          g.save();
          // Draw the silhouette darkened by clipping nothing: reuse the shape in a flat colour
          this._handSilhouette(g, hand, t);
          g.restore();
          g.globalAlpha = 1;
        } else {
          drawHandShape(g, hand.mode || 'grab', !!hand.holding, t);
        }
      }
      g.setTransform(1, 0, 0, 1, 0, 0);
    }

    _handSilhouette(g, hand, t) {
      const mode = hand.mode || 'grab';
      g.fillStyle = '#1a1020';
      g.strokeStyle = '#1a1020';
      g.lineCap = 'round';
      if (mode === 'pat') {
        g.translate(0, -2.5 - Math.abs(Math.sin(t * 5)) * 3);
        g.beginPath(); g.roundRect(-20, -10, 38, 11, 5); g.fill();
        return;
      }
      if (mode === 'slap') g.rotate(-0.42);
      g.beginPath(); g.roundRect(-10.5, -8, 21, 26, 7); g.fill();
      if (!hand.holding) {
        const parts = mode === 'slap' ? SLAP_HAND : OPEN_HAND;
        for (let i = 0; i < parts.length; i += 5) {
          g.lineWidth = parts[i + 4] + 2.6;
          g.beginPath(); g.moveTo(parts[i], parts[i + 1]); g.lineTo(parts[i + 2], parts[i + 3]); g.stroke();
        }
      }
    }
  }

  WorldView.ZOOM_MIN = ZOOM_MIN;
  WorldView.ZOOM_MAX = ZOOM_MAX;
  WorldView.SOUND_LIFE = SOUND_LIFE;
  Evo.WorldView = WorldView;
})(globalThis.Evo);
