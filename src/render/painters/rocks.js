// Painters for wood and stone: the grub log, boulders (the warm rock) and the two kinds of
// platform, a log ledge and a sandstone outcrop. Features draw with the origin at their base
// (f.x, f.y); platforms at (p.x0, p.y), their walking surface. y up is negative.
(function (Evo) {
  'use strict';
  const { TAU } = Evo.util;
  const { rng, rgb, rgba, mix, scale } = Evo.Sky.util;
  const { GROUND, MOSS, SNOW, ROCK_TONES, circle, paintStone } = Evo.Paint;
  const { SUMMER, AUTUMN, WINTER } = Evo.SEASON;

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
    if (si === WINTER) {
      g.fillStyle = SNOW.body;
      g.beginPath(); g.moveTo(-2, 1); for (let x = 0; x <= L; x += 5) g.lineTo(x, -3.5 - Math.sin(x * 0.4) * 1); g.lineTo(L + 2, 1); g.closePath(); g.fill();
    } else {
      g.fillStyle = MOSS.ledge[si];
      g.beginPath();
      for (let x = 6; x < L - 4; x += 7 + R() * 9) circle(g, x, -0.5, 1.5 + R() * 2);
      g.fill();
      if (si <= SUMMER) { // A sprout
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
    if (si !== WINTER && grounded) {
      g.fillStyle = MOSS.outcrop[si];
      g.beginPath();
      for (let k = 0; k < 6; k++) circle(g, -6 + R() * 10, gap * (0.3 + R() * 0.6), 2 + R() * 3);
      g.fill();
    }
    g.restore();
    g.strokeStyle = rgba(scale(tone, 0.45), 0.9);
    g.lineWidth = 1.2;
    g.stroke(body);
    const gp = GROUND[si];
    if (si === WINTER) {
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

  Object.assign(Evo.Paint, { paintLog, rockShape, paintRock, paintPlatformLog, paintPlatformRock });
})(globalThis.Evo);
