// Items in the world, drawn from their plain data (DESIGN.md §6): fruit, grain, dew, grubs, bugs,
// mimic berries, lures, carrion, eggs and balls. Food colours come from the CSS tokens so the map,
// the toolbar and the bars agree. ctx is in world coordinates. As in the simulation, (item.x,
// item.y) is where the item touches the ground: an item resting on the ground has y = ground, and
// its body is drawn above that point.
(function (Evo) {
  'use strict';
  const { TAU } = Evo.util;

  const RADIUS = Object.fromEntries(Object.entries(Evo.ITEM_TYPES).map(([k, v]) => [k, v.radius]));
  // How far above (item.x, item.y) each body's centre sits, in radii (so it rests on its lowest point)
  const LIFT = { fruit: 0.92, mimic: 0.92, grain: 0.72, dew: 1.26, grub: 0.98, bug: 0.95, lure: 0.84, carrion: 0.9, egg: 1, ball: 1 };

  const css = (c, k, a) => {
    const r = Math.min(255, c[0] * k) | 0, g = Math.min(255, c[1] * k) | 0, b = Math.min(255, c[2] * k) | 0;
    return a === undefined ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
  };
  const tint = Evo.color.mix;
  const WHITE = [255, 255, 255];

  let C = null;
  function colors() {
    if (C) return C;
    const tok = Evo.theme.rgb;
    const fruit = tok('--fruit'), grain = tok('--grain'), water = tok('--water'), protein = tok('--protein');
    const grub = tok('--grub'), carrion = tok('--carrion'), spot = tok('--mimic-spot'), female = tok('--female');
    C = {
      fruit: css(fruit, 1), fruitDark: css(fruit, 0.55), fruitShade: css(fruit, 0.62, 0.42), leaf: '#5fa04a', leafMimic: '#4f8f58',
      stem: '#6b4a2f', spot: css(spot, 1), spotRim: css(tint(spot, WHITE, 0.35), 1, 0.7),
      grain: css(grain, 1), grainDark: css(grain, 0.58), grainLight: css(tint(grain, WHITE, 0.45), 1), stalk: css(tint(grain, [120, 110, 60], 0.5), 1),
      water: css(water, 1, 0.72), waterDark: css(water, 0.55, 0.85), waterLight: css(tint(water, WHITE, 0.7), 1, 0.95),
      grub: css(grub, 1), grubDark: css(grub, 0.66), grubLight: css(tint(grub, WHITE, 0.5), 1), grubHead: '#a8683a',
      bug: css(protein, 1), bugDark: css(protein, 0.52), bugLight: css(tint(protein, WHITE, 0.55), 1), bugLeg: css(protein, 0.3),
      lure: css(female, 1), lureDark: css(female, 0.6), lureLight: css(tint(female, WHITE, 0.55), 1), lurePuff: tint(female, WHITE, 0.35).map(Math.round),
      carrionRgb: carrion,
      outline: 'rgba(40,24,20,0.55)',
    };
    return C;
  }

  // Per-egg / per-ball colours are cached (hue pairs rarely change)
  const hueCache = new Map();
  function hueSet(h1, h2) {
    const key = (Math.round(h1) * 1000 + Math.round(h2 || 0)) | 0;
    let s = hueCache.get(key);
    if (!s) {
      s = {
        shell: `hsl(${h1},58%,84%)`, shade: `hsl(${h1},42%,66%)`, speck: `hsl(${h2},52%,40%)`, line: `hsl(${h1},35%,42%)`,
        b1: `hsl(${h1},82%,60%)`, b2: `hsl(${(h1 + 120) % 360},78%,58%)`, b3: `hsl(${(h1 + 240) % 360},78%,62%)`,
      };
      if (hueCache.size > 256) hueCache.clear();
      hueCache.set(key, s);
    }
    return s;
  }

  // Small stable per-item hash in [0, 1)
  const hash = Evo.util.hash2;

  function fruitBody(g, r, c, mimic) {
    g.beginPath();
    g.moveTo(0, -r * 0.62);
    g.bezierCurveTo(r * 0.55, -r * 1.05, r * 1.18, -r * 0.62, r * 1.02, r * 0.12);
    g.bezierCurveTo(r * 0.92, r * 0.78, r * 0.42, r * 1.02, 0, r * 0.9);
    g.bezierCurveTo(-r * 0.42, r * 1.02, -r * 0.92, r * 0.78, -r * 1.02, r * 0.12);
    g.bezierCurveTo(-r * 1.18, -r * 0.62, -r * 0.55, -r * 1.05, 0, -r * 0.62);
    g.closePath();
    g.fillStyle = c.fruit;
    g.fill();
    g.lineWidth = Math.max(0.5, r * 0.13);
    g.strokeStyle = c.fruitDark;
    g.stroke();
    g.fillStyle = c.fruitShade;
    g.beginPath(); g.ellipse(r * 0.26, r * 0.3, r * 0.68, r * 0.52, -0.5, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.78)';
    g.beginPath(); g.ellipse(-r * 0.44, -r * 0.2, r * 0.2, r * 0.32, 0.5, 0, TAU); g.fill();
    g.strokeStyle = c.stem;
    g.lineWidth = r * 0.17;
    g.lineCap = 'round';
    g.beginPath(); g.moveTo(0, -r * 0.55); g.quadraticCurveTo(r * 0.04, -r * 0.95, r * 0.24, -r * 1.2); g.stroke();
    g.fillStyle = mimic ? c.leafMimic : c.leaf;
    g.beginPath(); g.ellipse(r * 0.56, -r * 1.02, r * 0.44, r * 0.19, -0.45, 0, TAU); g.fill();
    if (mimic) { // The tell: a small violet bruise
      g.fillStyle = c.spotRim;
      g.beginPath(); g.arc(r * 0.36, r * 0.3, r * 0.27, 0, TAU); g.fill();
      g.fillStyle = c.spot;
      g.beginPath(); g.arc(r * 0.36, r * 0.3, r * 0.19, 0, TAU); g.fill();
    }
  }

  // A fallen ear of grain, lying along x
  function grainEar(g, r, c) {
    g.strokeStyle = c.stalk;
    g.lineWidth = r * 0.16;
    g.lineCap = 'round';
    g.beginPath(); g.moveTo(-r * 1.7, r * 0.35); g.quadraticCurveTo(-r * 0.4, r * 0.1, r * 1.3, -r * 0.1); g.stroke();
    // Awns
    g.strokeStyle = c.grainDark;
    g.lineWidth = Math.max(0.35, r * 0.06);
    g.beginPath();
    for (let k = 0; k < 4; k++) {
      const u = -r * 0.5 + k * r * 0.5;
      g.moveTo(u + r * 0.2, -r * 0.3); g.lineTo(u + r * 0.95, -r * 0.95);
      g.moveTo(u + r * 0.2, r * 0.1); g.lineTo(u + r * 0.95, r * 0.55);
    }
    g.moveTo(r * 1.25, -r * 0.1); g.lineTo(r * 2.1, -r * 0.3);
    g.stroke();
    // Kernels in a chevron
    g.fillStyle = c.grain;
    g.strokeStyle = c.grainDark;
    g.lineWidth = Math.max(0.4, r * 0.08);
    g.beginPath();
    for (let k = 0; k < 4; k++) {
      const u = -r * 0.75 + k * r * 0.52;
      g.moveTo(u + r * 0.34, -r * 0.24);
      g.ellipse(u, -r * 0.24, r * 0.36, r * 0.21, -0.5, 0, TAU);
      g.moveTo(u + r * 0.34, r * 0.16);
      g.ellipse(u, r * 0.16, r * 0.36, r * 0.21, 0.5, 0, TAU);
    }
    g.moveTo(r * 1.35, -r * 0.05);
    g.ellipse(r * 1.05, -r * 0.05, r * 0.32, r * 0.2, 0, 0, TAU);
    g.fill();
    g.stroke();
    g.fillStyle = c.grainLight;
    g.beginPath();
    for (let k = 0; k < 4; k++) {
      const u = -r * 0.8 + k * r * 0.52;
      g.moveTo(u + r * 0.12, -r * 0.3);
      g.arc(u, -r * 0.3, r * 0.12, 0, TAU);
    }
    g.fill();
  }

  function dewDrop(g, r, c, t, id) {
    g.beginPath();
    g.moveTo(0, -r * 1.45);
    g.bezierCurveTo(r * 0.35, -r * 0.9, r * 1.02, -r * 0.3, r * 1.0, r * 0.28);
    g.arc(0, r * 0.28, r, 0, Math.PI);
    g.bezierCurveTo(-r * 1.02, -r * 0.3, -r * 0.35, -r * 0.9, 0, -r * 1.45);
    g.closePath();
    g.fillStyle = c.water;
    g.fill();
    g.lineWidth = Math.max(0.4, r * 0.1);
    g.strokeStyle = c.waterDark;
    g.stroke();
    g.fillStyle = c.waterLight;
    g.beginPath(); g.ellipse(-r * 0.36, -r * 0.05, r * 0.2, r * 0.36, 0.3, 0, TAU); g.fill();
    g.beginPath(); g.arc(r * 0.42, r * 0.62, r * 0.12, 0, TAU); g.fill();
    // An occasional glint
    const s = Math.sin(t * 2.2 + id * 1.7);
    if (s > 0.85) {
      const k = (s - 0.85) / 0.15 * r * 0.8;
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.lineWidth = Math.max(0.4, r * 0.1);
      g.beginPath();
      g.moveTo(-r * 0.35 - k, -r * 0.55); g.lineTo(-r * 0.35 + k, -r * 0.55);
      g.moveTo(-r * 0.35, -r * 0.55 - k); g.lineTo(-r * 0.35, -r * 0.55 + k);
      g.stroke();
    }
  }

  // A pale curled larva; the curl breathes
  function grubBody(g, r, c, t, id) {
    const wig = Math.sin(t * 3 + id) * 0.25;
    const R0 = r * 0.62, a0 = 0.35 + wig * 0.4, a1 = Math.PI * 1.55 + wig;
    const n = 6;
    for (let k = 0; k < n; k++) {
      const u = k / (n - 1);
      const a = a0 + (a1 - a0) * u;
      const x = Math.cos(a) * R0, y = Math.sin(a) * R0 * 0.85 + r * 0.1;
      const sr = r * (0.34 + 0.12 * Math.sin(u * Math.PI)) ;
      g.fillStyle = c.grub;
      g.strokeStyle = c.grubDark;
      g.lineWidth = Math.max(0.4, r * 0.09);
      g.beginPath(); g.arc(x, y, sr, 0, TAU); g.fill(); g.stroke();
      g.fillStyle = c.grubLight;
      g.beginPath(); g.arc(x - sr * 0.3, y - sr * 0.35, sr * 0.35, 0, TAU); g.fill();
    }
    // Head at the end of the curl
    const ah = a1 + 0.35;
    const hx = Math.cos(ah) * R0 * 0.95, hy = Math.sin(ah) * R0 * 0.8 + r * 0.1;
    g.fillStyle = c.grubHead;
    g.beginPath(); g.arc(hx, hy, r * 0.27, 0, TAU); g.fill();
    g.fillStyle = '#3a2418';
    g.beginPath(); g.arc(hx + r * 0.1, hy - r * 0.05, r * 0.07, 0, TAU); g.fill();
  }

  // A small green beetle seen from the side, legs scurrying when it moves
  function bugBody(g, r, c, t, item) {
    const dir = (item.vx || 0) < -0.01 ? -1 : (item.vx || 0) > 0.01 ? 1 : (item.facing || 1);
    const moving = Math.abs(item.vx || 0) > 0.01 ? 1 : 0.15;
    g.scale(dir, 1);
    g.strokeStyle = c.bugLeg;
    g.lineWidth = Math.max(0.45, r * 0.13);
    g.lineCap = 'round';
    g.beginPath();
    for (let k = 0; k < 3; k++) {
      const hx = (-0.55 + k * 0.5) * r;
      const ph = t * 18 + k * 2.1 + (item.id | 0);
      const fx = hx + Math.sin(ph) * r * 0.32 * moving - r * 0.1;
      const lift = Math.max(0, Math.cos(ph)) * r * 0.18 * moving;
      g.moveTo(hx, r * 0.25);
      g.lineTo(hx + (fx - hx) * 0.5 - r * 0.12, r * 0.55 - lift);
      g.lineTo(fx, r * 0.95 - lift);
    }
    g.stroke();
    // Antennae
    g.lineWidth = Math.max(0.35, r * 0.08);
    g.beginPath();
    g.moveTo(r * 1.1, -r * 0.05); g.quadraticCurveTo(r * 1.5, -r * 0.8, r * 1.85, -r * 0.7);
    g.moveTo(r * 1.05, -r * 0.1); g.quadraticCurveTo(r * 1.25, -r * 0.9, r * 1.55, -r * 0.95);
    g.stroke();
    // Head
    g.fillStyle = c.bugDark;
    g.beginPath(); g.arc(r * 0.92, r * 0.08, r * 0.36, 0, TAU); g.fill();
    g.fillStyle = '#f4ffe8';
    g.beginPath(); g.arc(r * 1.06, r * 0.0, r * 0.1, 0, TAU); g.fill();
    // Shell
    g.beginPath();
    g.moveTo(-r * 1.02, r * 0.32);
    g.bezierCurveTo(-r * 1.08, -r * 0.62, -r * 0.2, -r * 0.92, r * 0.35, -r * 0.62);
    g.bezierCurveTo(r * 0.78, -r * 0.4, r * 0.84, 0, r * 0.74, r * 0.32);
    g.closePath();
    g.fillStyle = c.bug;
    g.fill();
    g.lineWidth = Math.max(0.4, r * 0.1);
    g.strokeStyle = c.bugDark;
    g.stroke();
    g.beginPath(); g.moveTo(-r * 0.98, r * 0.18); g.quadraticCurveTo(-r * 0.1, r * 0.02, r * 0.74, r * 0.2); g.stroke();
    g.fillStyle = c.bugLight;
    g.beginPath(); g.ellipse(-r * 0.3, -r * 0.42, r * 0.34, r * 0.14, -0.2, 0, TAU); g.fill();
  }

  // A pink scent lure: a bulb breathing out puffs
  function lureBody(g, r, c, t, id) {
    const p = c.lurePuff;
    for (let k = 0; k < 3; k++) {
      let u = (t * 0.45 + k / 3 + hash(id, 3)) % 1;
      const x = Math.sin(u * 5 + k * 2) * r * 0.7;
      const y = -r * 0.4 - u * r * 3.4;
      const pr = r * (0.28 + u * 0.5);
      g.fillStyle = `rgba(${p[0]},${p[1]},${p[2]},${((1 - u) * 0.45).toFixed(3)})`;
      g.beginPath(); g.arc(x, y, pr, 0, TAU); g.fill();
    }
    // Leaves cupping the bulb
    g.fillStyle = '#6aa85a';
    g.beginPath(); g.ellipse(-r * 0.55, r * 0.62, r * 0.55, r * 0.22, 0.4, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(r * 0.55, r * 0.62, r * 0.55, r * 0.22, -0.4, 0, TAU); g.fill();
    const pulse = 1 + Math.sin(t * 2.4 + id) * 0.05;
    g.fillStyle = c.lure;
    g.strokeStyle = c.lureDark;
    g.lineWidth = Math.max(0.4, r * 0.1);
    g.beginPath();
    g.moveTo(0, -r * 0.95 * pulse);
    g.bezierCurveTo(r * 0.95 * pulse, -r * 0.6, r * 0.85, r * 0.75, 0, r * 0.72);
    g.bezierCurveTo(-r * 0.85, r * 0.75, -r * 0.95 * pulse, -r * 0.6, 0, -r * 0.95 * pulse);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = c.lureLight;
    g.beginPath(); g.ellipse(-r * 0.28, -r * 0.2, r * 0.18, r * 0.32, 0.3, 0, TAU); g.fill();
  }

  // hsl (degrees, 0..1, 0..1) -> [r, g, b]
  function hslRgb(h, sat, l) {
    const k = n => (n + h / 30) % 12, a = sat * Math.min(l, 1 - l);
    const f = n => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)));
    return [f(0), f(8), f(4)];
  }

  // Carrion colours: the --carrion grey, faintly tinted by the coat of whoever it was
  const carrionCache = new Map();
  function carrionSet(c, hue) {
    const key = hue === undefined ? -1 : Math.round(hue / 10);
    let s = carrionCache.get(key);
    if (!s) {
      const base = hue === undefined ? c.carrionRgb : tint(c.carrionRgb, hslRgb(key * 10, 0.35, 0.55), 0.28);
      s = { body: css(base, 1), dark: css(base, 0.62), light: css(tint(base, WHITE, 0.35), 1), line: css(base, 0.45) };
      carrionCache.set(key, s);
    }
    return s;
  }

  // A small, still bundle of grey fur lying on its side, with a couple of flies
  function carrionBody(g, r, c, t, item) {
    const s = carrionSet(c, item.hue), id = item.id | 0;
    // Tail curled along the ground at the back
    g.strokeStyle = s.dark;
    g.lineWidth = r * 0.2;
    g.lineCap = 'round';
    g.beginPath(); g.moveTo(-r * 0.9, r * 0.55); g.quadraticCurveTo(-r * 1.55, r * 0.75, -r * 1.35, r * 0.25); g.stroke();
    // Body and head as one lumpy outline
    g.beginPath();
    g.ellipse(-r * 0.15, r * 0.3, r * 1.0, r * 0.6, -0.06, 0, TAU);
    g.moveTo(r * 1.23, r * 0.42);
    g.ellipse(r * 0.82, r * 0.42, r * 0.42, r * 0.38, 0.2, 0, TAU);
    g.fillStyle = s.body;
    g.fill();
    g.lineWidth = Math.max(0.5, r * 0.1);
    g.strokeStyle = s.line;
    g.stroke();
    g.fill(); // hide the inner seam
    // A flopped ear, the belly's shade and a light back
    g.fillStyle = s.dark;
    g.beginPath(); g.moveTo(r * 0.62, r * 0.12); g.quadraticCurveTo(r * 0.5, -r * 0.18, r * 0.95, -r * 0.02); g.closePath(); g.fill();
    g.beginPath(); g.ellipse(0, r * 0.66, r * 0.8, r * 0.2, 0, 0, Math.PI); g.fill();
    g.fillStyle = s.light;
    g.beginPath(); g.ellipse(-r * 0.3, -r * 0.08, r * 0.55, r * 0.16, -0.12, 0, TAU); g.fill();
    // Ruffled fur
    g.strokeStyle = s.dark;
    g.lineWidth = Math.max(0.4, r * 0.07);
    g.beginPath();
    for (let k = 0; k < 4; k++) {
      const x = -r * 0.8 + k * r * 0.42;
      g.moveTo(x, r * 0.05); g.lineTo(x + r * 0.12, r * 0.28);
    }
    g.stroke();
    // Flies circling above
    for (let k = 0; k < 2; k++) {
      const a = t * (3.2 + k) + id + k * 2;
      const fx = Math.cos(a) * r * (1.0 + k * 0.4), fy = -r * (1.1 + k * 0.5) + Math.sin(a * 1.7) * r * 0.35;
      g.fillStyle = 'rgba(220,230,240,0.65)';
      g.beginPath(); g.ellipse(fx, fy - r * 0.1, r * 0.13, r * 0.06, Math.sin(t * 40 + k) * 0.6, 0, TAU); g.fill();
      g.fillStyle = '#2a2a30';
      g.beginPath(); g.arc(fx, fy, Math.max(0.5, r * 0.09), 0, TAU); g.fill();
    }
  }

  // A speckled egg. It rocks more and more as it gets close to hatching, then cracks.
  function eggBody(g, r, item, t) {
    const hs = hueSet(item.hue || 40, item.accentHue === undefined ? (item.hue || 40) + 180 : item.accentHue);
    const p = item.progress || 0;
    const id = item.id | 0;
    const rx = r * 0.78, ry = r;
    // Wobble in episodes, around the egg's base
    const episode = Math.max(0, Math.sin(t * 0.9 + id));
    const amp = (0.02 + 0.32 * Math.max(0, (p - 0.55) / 0.45)) * (0.3 + episode * 0.7);
    const wob = Math.sin(t * (5 + p * 9) + id) * amp;
    g.translate(0, ry * 0.95);
    g.rotate(wob);
    g.translate(0, -ry * 0.95);
    g.beginPath();
    g.moveTo(0, -ry);
    g.bezierCurveTo(rx * 0.75, -ry, rx, -ry * 0.1, rx, ry * 0.22);
    g.bezierCurveTo(rx, ry * 0.75, rx * 0.55, ry, 0, ry);
    g.bezierCurveTo(-rx * 0.55, ry, -rx, ry * 0.75, -rx, ry * 0.22);
    g.bezierCurveTo(-rx, -ry * 0.1, -rx * 0.75, -ry, 0, -ry);
    g.closePath();
    g.fillStyle = hs.shell;
    g.fill();
    g.save();
    g.clip();
    g.fillStyle = hs.shade;
    g.beginPath(); g.ellipse(rx * 0.45, ry * 0.5, rx * 0.95, ry * 0.8, -0.4, 0, TAU); g.fill();
    g.fillStyle = hs.shell;
    g.beginPath(); g.ellipse(-rx * 0.15, -ry * 0.1, rx * 0.8, ry * 0.85, -0.2, 0, TAU); g.fill();
    g.fillStyle = hs.speck;
    g.beginPath();
    for (let k = 0; k < 9; k++) {
      const a = hash(id, k) * TAU, d = Math.sqrt(hash(id, k + 20)) * 0.85;
      const sx = Math.cos(a) * rx * d, sy = Math.sin(a) * ry * d, sr = r * (0.06 + hash(id, k + 40) * 0.1);
      g.moveTo(sx + sr, sy);
      g.ellipse(sx, sy, sr, sr * 0.75, a, 0, TAU);
    }
    g.fill();
    g.restore();
    g.lineWidth = Math.max(0.5, r * 0.08);
    g.strokeStyle = hs.line;
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.beginPath(); g.ellipse(-rx * 0.4, -ry * 0.42, rx * 0.18, ry * 0.26, 0.4, 0, TAU); g.fill();
    // Cracks as hatching nears
    if (p > 0.82) {
      const k = Math.min(1, (p - 0.82) / 0.15);
      g.strokeStyle = 'rgba(60,40,30,0.75)';
      g.lineWidth = Math.max(0.5, r * 0.08);
      g.beginPath();
      const n = 2 + Math.round(k * 4);
      g.moveTo(-rx * 0.7, -ry * 0.3);
      for (let i = 1; i <= n; i++) g.lineTo(-rx * 0.7 + (i / 6) * rx * 1.4, -ry * 0.3 + (i % 2 ? -1 : 1) * ry * 0.13);
      g.stroke();
    }
  }

  function ballBody(g, r, item) {
    const hs = hueSet(item.hue || 200, 0);
    const cols = [hs.b1, '#fbf7ee', hs.b2, '#fbf7ee', hs.b3, '#fbf7ee'];
    for (let k = 0; k < 6; k++) {
      g.fillStyle = cols[k];
      g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, r, k * TAU / 6, (k + 1) * TAU / 6); g.closePath(); g.fill();
    }
    g.fillStyle = '#fbf7ee';
    g.beginPath(); g.arc(0, 0, r * 0.2, 0, TAU); g.fill();
    g.rotate(-(item.rot || 0)); // lighting stays put while the ball rolls
    g.fillStyle = 'rgba(40,30,60,0.22)';
    g.beginPath(); g.arc(0, 0, r, 0.1, Math.PI - 0.1); g.arc(r * 0.05, -r * 0.3, r * 1.02, Math.PI - 0.35, 0.35, true); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.beginPath(); g.ellipse(-r * 0.4, -r * 0.45, r * 0.26, r * 0.15, -0.6, 0, TAU); g.fill();
    g.lineWidth = Math.max(0.5, r * 0.08);
    g.strokeStyle = 'rgba(40,30,60,0.5)';
    g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke();
  }

  // Draw one item. ctx is in world coordinates. t = seconds (for small idle animations). dy moves
  // the drawing down (e.g. to float an item half-sunk in water).
  function draw(g, item, t, dy) {
    const c = colors();
    const type = item.type;
    const r = item.radius || RADIUS[type] || 5;
    const id = item.id | 0;
    g.save();
    g.translate(item.x, item.y - r * (LIFT[type] || 1) + (dy || 0));
    // item.rot is any angle (the simulation spins things as they fall or roll). Things lying on
    // the ground keep only a small tilt from it; round things and falling things turn freely.
    const rot = item.rot || 0, lying = item.onGround !== false;
    switch (type) {
      case 'fruit': case 'mimic':
        g.rotate(lying ? Math.sin(rot) * 0.45 : rot);
        fruitBody(g, r, c, type === 'mimic');
        break;
      case 'grain':
        g.translate(0, r * 0.35);
        g.rotate((lying ? Math.sin(rot) * 0.2 : rot) - 0.12);
        grainEar(g, r, c);
        break;
      case 'dew':
        dewDrop(g, r, c, t, id);
        break;
      case 'grub':
        g.rotate(lying ? Math.sin(rot) * 0.3 : rot);
        grubBody(g, r, c, t, id);
        break;
      case 'bug':
        if (!lying) g.rotate(rot);
        bugBody(g, r, c, t, item);
        break;
      case 'lure':
        lureBody(g, r, c, t, id);
        break;
      case 'carrion':
        g.rotate(Math.sin(rot) * 0.08);
        carrionBody(g, r, c, t, item);
        break;
      case 'egg':
        eggBody(g, r, item, t);
        break;
      case 'ball':
        g.rotate(item.rot || 0);
        ballBody(g, r, item);
        break;
      default:
        g.fillStyle = '#ccc';
        g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
    }
    g.restore();
  }

  // The centre of an item's body in world coordinates (y only; x is item.x)
  function centerY(item) {
    const r = item.radius || RADIUS[item.type] || 5;
    return item.y - r * (LIFT[item.type] || 1);
  }

  // Draw an item type centred in a box of `size` CSS px (toolbar swatches, cards)
  const iconItem = { id: 7, type: 'fruit', x: 0, y: 0, radius: 5, rot: 0, vx: 0, onGround: true, hue: 40, accentHue: 220, progress: 0.3 };
  function drawIcon(g, type, x, y, size, t) {
    iconItem.type = type;
    iconItem.x = x;
    iconItem.radius = size * (type === 'grain' ? 0.22 : type === 'lure' ? 0.26 : 0.34);
    iconItem.y = y + (type === 'lure' ? size * 0.12 : 0) + iconItem.radius * (LIFT[type] || 1);
    draw(g, iconItem, t || 0);
  }

  Evo.ItemArt = { draw, centerY, drawIcon, LIFT };
})(globalThis.Evo);
