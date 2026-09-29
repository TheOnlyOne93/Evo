// The Evo namespace and small shared helpers. Loaded before every other script.
// Plain scripts (no modules, no build) so the page opens straight from disk; each file adds
// its exports to globalThis.Evo. The same files load in Node for the headless tests.
(function (root) {
  'use strict';
  const Evo = root.Evo = root.Evo || {};

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const mean = arr => (arr.length ? arr.reduce((a, v) => a + v, 0) / arr.length : 0);
  const TAU = Math.PI * 2;
  // Wrap an angle into [-PI, PI)
  const wrapAngle = a => {
    a = (a + Math.PI) % TAU;
    return (a < 0 ? a + TAU : a) - Math.PI;
  };
  // The element with the highest score, in one pass (null for an empty list)
  const maxBy = (arr, score) => {
    let best = null, bestScore = -Infinity;
    for (const x of arr) {
      const s = score(x);
      if (s > bestScore) { bestScore = s; best = x; }
    }
    return best;
  };
  const minBy = (arr, score) => maxBy(arr, x => -score(x));
  const countBy = (arr, key) => arr.reduce((acc, x) => { const k = key(x); acc[k] = (acc[k] || 0) + 1; return acc; }, {});

  // Seedable PRNG (mulberry32). All simulation randomness goes through Evo.random, so a run can
  // be reproduced exactly by seeding it (the tests do).
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // Every run starts from the same seed so the app is deterministic; ?seed=N overrides it.
  Evo.DEFAULT_SEED = 20260929;
  let startSeed = Evo.DEFAULT_SEED;
  if (typeof location !== 'undefined' && location.search) {
    const m = /[?&]seed=(-?\d+)/.exec(location.search);
    if (m) startSeed = Number(m[1]);
  }
  let rng = mulberry32(startSeed);
  Evo.seed = seed => { rng = mulberry32(seed); };
  Evo.useRandomSource = fn => { rng = fn; }; // Tests: script exact random draws
  Evo.random = () => rng();
  Evo.randRange = (lo, hi) => lo + (hi - lo) * rng();
  Evo.randInt = n => Math.floor(rng() * n);
  Evo.chance = p => rng() < p;
  Evo.pick = arr => arr[Math.floor(rng() * arr.length)];
  Evo.shuffle = arr => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  // Unique, increasing ids (never reused within a session)
  let lastId = 0;
  Evo.nextId = () => ++lastId;

  // Minimal publish/subscribe. The simulation announces what happened (births, deaths, meals…);
  // audio and UI listen. The simulation never calls into either.
  class EventBus {
    constructor() { this.handlers = {}; }
    on(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); return () => this.off(type, fn); }
    off(type, fn) { const h = this.handlers[type]; if (h) this.handlers[type] = h.filter(f => f !== fn); }
    emit(type, payload) { const h = this.handlers[type]; if (h) for (const fn of h) fn(payload); }
  }

  Evo.util = { clamp, clamp01, lerp, mean, wrapAngle, maxBy, minBy, countBy, TAU, mulberry32 };
  Evo.EventBus = EventBus;
})(globalThis);
