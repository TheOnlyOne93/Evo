// The Evo namespace and small shared helpers. Loaded before every other script.
// Plain scripts (no modules, no build) so the page opens straight from disk; each file adds
// its exports to globalThis.Evo. The scripts index.html marks data-headless also load in Node,
// for the tests and tools.
(function (root) {
  'use strict';
  const Evo = root.Evo = root.Evo || {};

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  // Hermite ease of v between edges a and b
  const smoothstep = (a, b, v) => { const x = clamp01((v - a) / (b - a)); return x * x * (3 - 2 * x); };
  const mean = arr => (arr.length ? arr.reduce((a, v) => a + v, 0) / arr.length : 0);
  const TAU = Math.PI * 2;
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
  // be reproduced exactly by seeding it (the tests do). Growing a brain is the exception: it rolls
  // fixed dice (fixedRoll, below), so the same genes always grow the same brain.
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
  const search = globalThis.location?.search; // Only in the page: Node has no location
  if (search) {
    const m = /[?&]seed=(-?\d+)/.exec(search);
    if (m) startSeed = Number(m[1]);
  }
  let rng = mulberry32(startSeed);
  Evo.seed = seed => { rng = mulberry32(seed); };
  Evo.useRandomSource = fn => { rng = fn; }; // Tests: script exact random draws
  Evo.random = () => rng();
  Evo.randRange = (lo, hi) => lo + (hi - lo) * rng();
  Evo.randInt = n => Math.floor(rng() * n);
  Evo.chance = p => rng() < p;
  Evo.pick = arr => arr[Evo.randInt(arr.length)];

  // Integer hash of two ints -> [0, 1), for stable per-place decoration
  function hash2(a, b) {
    let x = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263);
    x = Math.imul(x ^ (x >>> 13), 1274126177);
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
  }

  // Fixed dice: the same "random" number for the same inputs, and no draw from Evo.random. The inputs
  // are whole numbers, each read as 32 bits: any from -2^31 to 2^31 - 1 (or from 0 to 2^32 - 1) is
  // told apart from the others, and a fraction is cut down to a whole number. The steps are
  // MurmurHash3's, a well-tried way to mix numbers: mixIn stirs one more number into the running mix,
  // and settle spreads every bit of the mix across the result, so changing any input, even by 1,
  // gives an unrelated result.
  const FIXED_START = 0x2545F491;
  function mixIn(h, v) {
    let k = Math.imul(v | 0, 0xCC9E2D51);
    k = Math.imul((k << 15) | (k >>> 17), 0x1B873593);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    return (Math.imul(h, 5) + 0xE6546B64) | 0;
  }
  function settle(h) {
    h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B);
    h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35);
    return (h ^ (h >>> 16)) >>> 0;
  }
  // A number from 0 up to (not including) 1, always the same for the same four whole numbers
  const fixedRoll = (a, b, c, d) => settle(mixIn(mixIn(mixIn(mixIn(FIXED_START, a), b), c), d)) / 4294967296;
  // A whole number from 0 up to (not including) 2^32, always the same for the same list of whole
  // numbers (of any length)
  const fixedNumber = numbers => settle(numbers.reduce(mixIn, FIXED_START));

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

  Evo.util = { clamp, clamp01, lerp, mean, maxBy, minBy, countBy, TAU, smoothstep, mulberry32, hash2, fixedRoll, fixedNumber };
  Evo.EventBus = EventBus;
})(globalThis);
