// Ponds: the water body with its animated surface, light shafts and bubbles, lilies, and the ice
// and snow that cover it in winter; plus the sun's glints for the glow pass. Drawn every frame in
// world coordinates.
(function (Evo) {
  'use strict';
  const { TAU, hash2 } = Evo.util;
  const { rgba, mix } = Evo.Sky.util;
  const { SNOW } = Evo.Paint;
  const { SPRING, SUMMER, AUTUMN, WINTER } = Evo.SEASON;

  // How frozen the ponds are: 1 in winter, easing in and out with the season blend
  function iceAmount(ss) {
    if (ss.cur === WINTER) return 1 - ss.blend;
    if (ss.next === WINTER) return ss.blend;
    return 0;
  }

  // The water surface's ripple at x
  function wave(x, t, amp) {
    return amp * (Math.sin(x * 0.045 + t * 1.6) + 0.6 * Math.sin(x * 0.11 - t * 2.3));
  }

  let colors = null; // read from the CSS theme on first use
  function waterColors() {
    if (!colors) colors = { water: Evo.theme.rgb('--water') };
    return colors;
  }

  // The ponds (v is the WorldView): water with light shafts and bubbles, or ice, a bright surface
  // line, then lilies or snow on the ice
  function drawWater(g, v, t) {
    const ponds = v.world.terrain.ponds;
    const pal = v.sky.pal;
    const ice = iceAmount(v.ss);
    const amp = 1.1 * (1 - ice);
    const wc = waterColors();
    const surf = v.info.surf, step = v.info.step;
    for (let pi = 0; pi < ponds.length; pi++) {
      const p = ponds[pi];
      if (p.x1 < v.vx0 || p.x0 > v.vx1) continue;
      const L = p.level;
      let deep = L;
      for (let x = p.x0; x <= p.x1; x += step) deep = Math.max(deep, surf(x));
      const depth = Math.max(8, deep - L);
      // Water body: animated surface on top, the pond bed below
      g.beginPath();
      g.moveTo(p.x0, L);
      for (let x = p.x0; x <= p.x1; x += 5) g.lineTo(x, L + wave(x, t, amp));
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
        const y = L + 2 + wave(x, t, amp);
        x === p.x0 + 1 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.stroke();
      g.lineWidth = 1.2;
      g.strokeStyle = ice > 0.5 ? 'rgba(255,255,255,0.95)' : 'rgba(240,252,255,0.8)';
      g.beginPath();
      for (let x = p.x0 + 1; x <= p.x1 - 1; x += 5) {
        const y = L + wave(x, t, amp);
        x === p.x0 + 1 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.stroke();
      if (ice < 0.6) drawLilies(g, v, p, pi, t, amp, 1 - ice / 0.6);
      else drawIceSnow(g, p, pi, ice);
    }
  }

  function drawLilies(g, v, p, pi, t, amp, alpha) {
    const si = v.ss.cur;
    if (si === WINTER) return;
    const n = Math.max(2, Math.round((p.x1 - p.x0) / 70));
    g.globalAlpha = alpha;
    for (let k = 0; k < n; k++) {
      const x = p.x0 + (p.x1 - p.x0) * (0.12 + 0.76 * hash2(pi * 31 + k, 11)) + Math.sin(t * 0.2 + k) * 3;
      const y = p.level + wave(x, t, amp) - 0.5;
      const r = 6 + hash2(k, pi) * 4;
      g.fillStyle = si === AUTUMN ? '#a8a04a' : '#3f8f4a';
      g.beginPath(); g.ellipse(x, y, r, r * 0.3, 0, 0.25, TAU - 0.1); g.lineTo(x, y); g.closePath(); g.fill();
      g.fillStyle = si === AUTUMN ? '#c6b85c' : '#62b060';
      g.beginPath(); g.ellipse(x - r * 0.15, y - 0.6, r * 0.7, r * 0.16, 0, 0, TAU); g.fill();
      if (k % 2 === 0 && si <= SUMMER) {
        g.fillStyle = si === SPRING ? '#ffd3e4' : '#fff5fa';
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

  function drawIceSnow(g, p, pi, ice) {
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

  // Sun glints on open water (drawn in the additive glow pass)
  function drawGlints(g, v, t) {
    const pal = v.sky.pal;
    const ice = iceAmount(v.ss);
    const ponds = v.world.terrain.ponds;
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
          const y = p.level + wave(x, t, 1.1) + 0.5;
          g.beginPath(); g.moveTo(x - 2.5, y); g.lineTo(x + 2.5, y); g.stroke();
        }
      }
    }
  }

  Evo.Water = { draw: drawWater, drawGlints, iceAmount, wave };
})(globalThis.Evo);
