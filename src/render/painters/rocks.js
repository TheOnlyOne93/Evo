// Painters for wood and stone: the grub log and boulders (the warm rock), each shaped to carry
// its platform when it has one. Features draw with the origin at their base (f.x, f.y). y up is
// negative.
(function (Evo) {
  'use strict';
  const { TAU, clamp, mulberry32: rng } = Evo.util;
  const { rgb, rgba, mix, scale } = Evo.color;
  const { GROUND, MOSS, SNOW, ROCK_TONES, circle, paintStone } = Evo.Paint;
  const { AUTUMN, WINTER } = Evo.SEASON;

  // The grub log's depth d (shaped to its platform `top` when it has one) and the stones under it.
  // groundAt(x) is the ground's height at world x.
  function logShape(f, top, groundAt) {
    const L = f.length;
    const d = top ? clamp(top + 3, 14, 44) : clamp(L * 0.24, 20, 34);
    // Where the ground falls away under the log, a stone props it up
    const props = [];
    let deepest = 0;
    for (const u of [-0.36, 0.36]) {
      const gap = groundAt(f.x + u * L) - f.y;
      if (gap > 3) { props.push({ x: u * L, gap }); deepest = Math.max(deepest, gap); }
    }
    // The box its sprite is painted in, in world px around the base
    const box = { x0: -L / 2 - d * 0.4, w: L + d * 0.8, y0: -d - 12, h: d + 18 + deepest };
    return { d, props, box };
  }

  // The grub log: a trunk d deep lying from x0 to x1, hollow at the left end and sawn at the right,
  // propped on stones where the ground falls away under it
  function paintLog(g, f, si, rec) {
    const R = rng(4000 + (f.id | 0) * 7);
    const L = f.length, d = rec.data.d;
    const x0 = -L / 2, x1 = L / 2, yT = 3 - d, yM = 3 - d / 2;
    const ex = d * 0.26, ey = d / 2;   // the rounded ends' radii
    const bark = [118, 84, 56];
    for (const p of rec.data.props) {
      const ry = p.gap + 5;
      paintStone(g, p.x, p.gap + 3, Math.max(10, ry * 0.8 + 5), ry, ROCK_TONES[(f.id | 0) % 3], si);
    }
    // The body, rounded at both ends and lit from above
    const bg = g.createLinearGradient(0, yT, 0, 3);
    bg.addColorStop(0, rgb(mix(bark, [255, 230, 190], 0.25)));
    bg.addColorStop(0.5, rgb(bark));
    bg.addColorStop(1, rgb(scale(bark, 0.55)));
    g.fillStyle = bg;
    g.beginPath();
    g.moveTo(x0, yT);
    g.lineTo(x1, yT);
    g.ellipse(x1, yM, ex, ey, 0, -Math.PI / 2, Math.PI / 2);
    g.lineTo(x0, 3);
    g.ellipse(x0, yM, ex, ey, 0, Math.PI / 2, Math.PI * 1.5);
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
    g.beginPath(); g.ellipse(x0, yM, ex, ey, 0, 0, TAU); g.fill();
    const hg = g.createRadialGradient(x0 + 1, yM, 1, x0, yM, d * 0.42);
    hg.addColorStop(0, '#120a06');
    hg.addColorStop(1, '#3a2618');
    g.fillStyle = hg;
    g.beginPath(); g.ellipse(x0 + 1, yM, d * 0.18, d * 0.38, 0, 0, TAU); g.fill();
    // The cut end: pale wood with three growth rings
    g.fillStyle = '#d6b082';
    g.beginPath(); g.ellipse(x1, yM, ex, ey - 1, 0, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(150,108,70,0.8)';
    g.lineWidth = 0.9;
    for (let k = 1; k <= 3; k++) { g.beginPath(); g.ellipse(x1, yM, ex * k / 4, (ey - 1) * k / 4, 0, 0, TAU); g.stroke(); }
    // On top: a lumpy cap of snow in winter, else moss cushions and bracket fungi
    if (si === WINTER) {
      g.fillStyle = SNOW.body;
      g.beginPath();
      g.moveTo(x0 - 2, yT + 3);
      for (let x = x0; x <= x1 + 1; x += 6) g.lineTo(x, yT - 2.5 - Math.sin(x * 0.3) * 1.2);
      g.lineTo(x1 + 3, yT + 3);
      g.closePath();
      g.fill();
    } else {
      g.fillStyle = MOSS.log[si];
      g.beginPath();
      for (let x = x0 + 6; x < x1 - 4; x += 5 + R() * 6) circle(g, x, yT + 1, 2 + R() * 2.8);
      g.fill();
      const caps = si === AUTUMN ? 4 : 2;
      for (let k = 0; k < caps; k++) {
        const fx = x0 + L * (0.2 + R() * 0.6), fy = yM + (R() - 0.2) * d * 0.3;
        g.fillStyle = '#e6cfa2';
        g.beginPath(); g.ellipse(fx, fy, 5, 2.4, 0, Math.PI, TAU); g.fill();
        g.fillStyle = '#b8966a';
        g.beginPath(); g.ellipse(fx, fy, 5, 1, 0, 0, Math.PI); g.fill();
      }
      if (si === AUTUMN) {
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
    const w = f.width, h = top || f.height;
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
    // The box its sprite is painted in, in world px around the base
    const box = { x0: -w / 2 - 10, w: w + 20, y0: -h * 1.2 - 10, h: h * 1.2 + 18 };
    return { w, h, pts, tone: ROCK_TONES[(f.id | 0) % ROCK_TONES.length], box };
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
    if (si === WINTER) {
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
      g.fillStyle = MOSS.rock[si];
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

  Object.assign(Evo.Paint, { logShape, paintLog, rockShape, paintRock });
})(globalThis.Evo);
