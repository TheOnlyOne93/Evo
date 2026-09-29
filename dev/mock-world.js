// A stand-in world for the world lab (dev only). It follows the renderer contract in
// docs/DESIGN.md §6 and mirrors src/sim/world.js (the same landscape recipe, feature kinds and
// sizes, platforms on top of the rock and the log, items whose y is where they touch the ground,
// world.edge), so src/render/world-view.js can be tuned without running brains. It adds a few
// extra features and many more items than the real world starts with, to show every kind at once.
// Nothing here is loaded by index.html.
(function (Evo) {
  'use strict';
  const TAU = Math.PI * 2;
  const DAY_TICKS = 10800;  // 3 minutes at 60 ticks per second, as in the simulation
  const SEASON_DAYS = 2;
  const SEASON_KEYS = ['SPRING', 'SUMMER', 'AUTUMN', 'WINTER'];
  const GRAVITY = 0.25;
  const NAMES = ['Pip', 'Moss', 'Bramble', 'Tansy', 'Wren', 'Sorrel', 'Fennel', 'Juniper', 'Clover', 'Nettle', 'Rowan', 'Hazel', 'Yarrow', 'Burdock', 'Teasel', 'Sedge'];

  // Item sizes and behaviour, as in src/sim/constants.js (used when that file is not loaded)
  const TYPES = Evo.ITEM_TYPES || {
    fruit: { radius: 6, bounce: 0.3 }, grain: { radius: 5, bounce: 0.2 }, grub: { radius: 5, crawls: 0.15 },
    bug: { radius: 4.5, crawls: 0.6, hops: true }, mimic: { radius: 6, bounce: 0.3 }, dew: { radius: 4 },
    lure: { radius: 6 }, carrion: { radius: 9 }, egg: { radius: 7, bounce: 0.2 }, ball: { radius: 8, bounce: 0.7, rolls: true },
  };

  // Scent channels for the overlay, only when the real list is not loaded (same keys and tokens)
  if (!Evo.SCENTS) {
    Evo.SCENTS = [
      { key: 'sweet', token: '--fruit' }, { key: 'starch', token: '--grain' }, { key: 'moist', token: '--water' },
      { key: 'bitter', token: '--toxin' }, { key: 'earthy', token: '--grub' }, { key: 'prey', token: '--protein' },
      { key: 'muskF', token: '--female' }, { key: 'muskM', token: '--male' }, { key: 'alarm', token: '--alarm' },
      { key: 'decay', token: '--carrion' },
    ];
  }
  const SCENT_OF = { fruit: 0, mimic: 3, grain: 1, dew: 2, grub: 4, bug: 5, lure: 6, carrion: 9 };

  const rng = Evo.util.mulberry32;

  // The terrain recipe of src/sim/world.js: rolling sines, a hill for the warm rock, cliffs rising
  // at both ends and ponds filled to just below their lower rim
  function makeTerrain(W, R, layout) {
    const step = 8, n = Math.ceil(W / step) + 1;
    const heights = new Float32Array(n);
    const ph = [R() * 6.28, R() * 6.28, R() * 6.28];
    for (let i = 0; i < n; i++) {
      const x = i * step;
      let h = 640 + 30 * Math.sin(x / 1400 * 6.28 + ph[0]) + 18 * Math.sin(x / 520 * 6.28 + ph[1]) + 7 * Math.sin(x / 170 * 6.28 + ph[2]);
      const hill = (x - layout.hill) / 260;
      h -= 70 * Math.exp(-hill * hill);
      const edge = Math.min(x, W - x);
      if (edge < 140) h -= 260 * (1 - edge / 140) ** 2;
      heights[i] = h;
    }
    const groundY = x => {
      const f = Math.max(0, Math.min(n - 1.001, x / step));
      const i = Math.floor(f), t = f - i;
      return heights[i] * (1 - t) + heights[i + 1] * t;
    };
    const ponds = layout.ponds.map(([x0, x1, depth]) => {
      for (let i = 0; i < n; i++) {
        const x = i * step;
        if (x > x0 && x < x1) heights[i] += depth * Math.pow(Math.sin(Math.PI * (x - x0) / (x1 - x0)), 0.8);
      }
      const level = Math.min(groundY(x0), groundY(x1)) + 6;
      let a = x0, b = x1;
      while (a < x1 && groundY(a) < level) a += 2;
      while (b > x0 && groundY(b) < level) b -= 2;
      return { x0: a, x1: b, level };
    });
    return {
      step, heights, ponds, groundY,
      waterLevelAt(x) { for (const p of ponds) if (x >= p.x0 && x <= p.x1) return p.level; return null; },
    };
  }

  class MockWorld {
    constructor(opts = {}) {
      const R = this.R = rng(opts.seed || 11);
      const W = this.width = 3600;
      this.height = 900;
      this.edge = 150;
      this.speed = opts.speed === undefined ? 4 : opts.speed; // clock speed multiplier
      this.nextId = 1;

      // ---- Landscape (as buildLandscape() in src/sim/world.js)
      const jitter = f => (f + (R() - 0.5) * 0.03) * W;
      const big = jitter(0.58), small = jitter(0.06);
      const layout = { hill: jitter(0.31), ponds: [[big, big + 420, 80], [small, small + 170, 45]] };
      const T = this.terrain = makeTerrain(W, R, layout);
      const f = [];
      const add = (kind, x, props) => { const it = Object.assign({ id: this.nextId++, kind, x, y: T.groundY(x) }, props); f.push(it); return it; };
      add('thornbush', jitter(0.125), { radius: 22 });
      add('tree', jitter(0.16), { species: 'fruit', height: 210, canopy: 85, fruiting: 0.5 });
      add('tree', jitter(0.235), { species: 'mimic', height: 140, canopy: 55, fruiting: 0.4 });
      const rock = add('rock', layout.hill + 30, { w: 96, h: 52, warm: 0 });
      add('grass', jitter(0.41), { width: 230, height: 40, seeding: 0.4 });
      const log = add('log', jitter(0.49), { length: 150 });
      for (const p of T.ponds) { add('reeds', p.x0 - 20, { width: 50 }); add('reeds', p.x1 + 20, { width: 50 }); }
      add('tree', jitter(0.79), { species: 'fruit', height: 230, canopy: 95, fruiting: 0.5 });
      add('thornbush', jitter(0.84), { radius: 20 });
      add('grass', jitter(0.905), { width: 210, height: 40, seeding: 0.4 });
      add('thornbush', jitter(0.70), { radius: 18 });
      // Extras the real world doesn't start with, so every kind shows more than once
      add('rock', jitter(0.955), { w: 58, h: 34, warm: 0 });
      add('grass', jitter(0.515), { width: 90, height: 30, seeding: 0.6 });
      add('tree', jitter(0.87), { species: 'fruit', height: 180, canopy: 70, fruiting: 0.6 });
      this.features = f;
      this.warmRock = rock;
      this.platforms = [
        { x0: rock.x - rock.w / 2 + 6, x1: rock.x + rock.w / 2 - 6, y: rock.y - rock.h + 4, kind: 'rock' },
        { x0: log.x - log.length / 2, x1: log.x + log.length / 2, y: log.y - 24, kind: 'log' },
      ];

      // ---- Clock and season
      this.clock = { tick: Math.round(DAY_TICKS * 0.42), day: 0, phase: 0.42, light: 1, sunElevation: 0.9 };
      this.season = { key: 'SPRING', index: 0, progress: 0 };

      // ---- Scent grid (30 px cells, as in the simulation)
      const cell = 30, cols = Math.ceil(W / cell), rows = Math.ceil(this.height / cell);
      this.scent = { cols, rows, cell, channels: Evo.SCENTS.map(() => new Float32Array(cols * rows)) };
      this.scentTmp = new Float32Array(cols * rows);
      this.scentSolid = new Uint8Array(cols * rows);
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) if ((j + 0.5) * cell > T.groundY((i + 0.5) * cell) + cell * 0.5) this.scentSolid[j * cols + i] = 1;

      this.sounds = [];
      this.items = [];
      this.creatures = [];
      this._spawnItems(opts.items === undefined ? 72 : opts.items);
      this._spawnCreatures(opts.creatures === undefined ? 7 : opts.creatures);
      this._updateClock();
      this._updatePlants(0);
    }

    groundAt(x) { return this.terrain.groundY(x); }

    // The highest surface at or below fromY at x: the ground or a platform (as in the simulation)
    surfaceBelow(x, fromY) {
      let y = this.terrain.groundY(x);
      for (const p of this.platforms) if (x >= p.x0 && x <= p.x1 && p.y >= fromY && p.y < y) y = p.y;
      return y;
    }

    temperatureAt(x, y) {
      const base = [0.48, 0.6, 0.44, 0.22][this.season.index];
      let t = base + 0.13 * this.clock.sunElevation;
      const rock = this.warmRock;
      if (Math.abs(x - rock.x) < rock.w * 0.8 && y > rock.y - rock.h - 40) t += 0.04 + rock.warm * 0.14;
      return Math.max(0, Math.min(1, t));
    }

    _item(type, x, extra) {
      const def = TYPES[type];
      const item = Object.assign({
        id: this.nextId++, type, x, y: this.surfaceBelow(x, -1e9), vx: 0, vy: 0, radius: def.radius, rot: this.R() * TAU,
        age: 0, held: null, onGround: true,
      }, extra);
      this.items.push(item);
      return item;
    }

    // Keep dry-land things out of the ponds and inside the edges
    _dryX(x) {
      const R = this.R;
      for (const p of this.terrain.ponds) if (x > p.x0 - 6 && x < p.x1 + 6) x = R() < 0.5 ? p.x0 - 20 - R() * 60 : p.x1 + 20 + R() * 60;
      return Math.max(this.edge + 10, Math.min(this.width - this.edge - 10, x));
    }

    _spawnItems(total) {
      const R = this.R, fs = this.features;
      const trees = fs.filter(f => f.kind === 'tree' && f.species === 'fruit');
      const mimic = fs.find(f => f.species === 'mimic');
      const grass = fs.filter(f => f.kind === 'grass');
      const log = fs.find(f => f.kind === 'log');
      const plan = [['fruit', 0.18], ['mimic', 0.07], ['grain', 0.15], ['dew', 0.1], ['grub', 0.09], ['bug', 0.14], ['lure', 0.05], ['carrion', 0.04], ['egg', 0.08], ['ball', 0.1]];
      for (const [type, share] of plan) {
        const count = Math.max(1, Math.round(total * share));
        for (let k = 0; k < count; k++) {
          let x;
          switch (type) {
            case 'fruit': { const t = trees[k % trees.length]; x = t.x + (R() - 0.5) * t.canopy * 2; break; }
            case 'mimic': x = mimic.x + (R() - 0.5) * mimic.canopy * 2; break;
            case 'grain': { const g = grass[k % grass.length]; x = g.x + (R() - 0.5) * g.width; break; }
            case 'dew': { const g = grass[k % grass.length]; x = g.x + (R() - 0.5) * g.width * 1.2; break; }
            case 'grub': x = log.x + (R() < 0.5 ? -1 : 1) * (log.length / 2 + R() * 30); break;
            default: x = 200 + R() * (this.width - 400);
          }
          const extra = {};
          if (type === 'bug' || type === 'grub') extra.vx = (R() < 0.5 ? -1 : 1) * 0.2;
          if (type === 'grub') extra.home = log.x;
          if (type === 'egg') Object.assign(extra, { hue: (R() * 360) | 0, accentHue: (R() * 360) | 0, progress: [0.25, 0.7, 0.94, 0.5, 0.85][k % 5] });
          if (type === 'ball' || type === 'carrion') extra.hue = (R() * 360) | 0;
          this._item(type, this._dryX(x), extra);
        }
      }
      // Things on the platforms, and a fruit and a ball floating on the big pond
      const [ledge, top] = this.platforms;
      this._item('fruit', ledge.x0 + 20, { y: ledge.y });
      this._item('ball', top.x0 + 50, { y: top.y, hue: 200 });
      const pond = this.terrain.ponds[0];
      this._item('fruit', pond.x0 + (pond.x1 - pond.x0) * 0.3, { y: pond.level });
      this._item('ball', pond.x0 + (pond.x1 - pond.x0) * 0.62, { y: pond.level, hue: 30 });
    }

    _spawnCreatures(n) {
      const R = this.R;
      for (let i = 0; i < n; i++) {
        const x = this._dryX(this.edge + 60 + ((i * 977) % (this.width - 2 * this.edge - 120)) + R() * 80);
        const stage = [5, 5, 2, 4, 5, 1, 6, 3][i % 8];
        const size = [0, 18, 24, 30, 36, 42, 40, 38][stage];
        this.creatures.push({
          id: this.nextId++, name: NAMES[i % NAMES.length], sex: i % 2 ? 'MALE' : 'FEMALE', stage,
          x, y: this.groundAt(x), vx: 0, vy: 0, facing: R() < 0.5 ? -1 : 1, onGround: true, size, held: false, inWater: false,
          looks: {
            hue: (i * 67 + 20) % 360, accentHue: (i * 67 + 200) % 360, pattern: i % 4, patternScale: R(),
            earSize: 0.3 + R() * 0.7, tailLength: 0.3 + R() * 0.7, eyeSize: 0.4 + R() * 0.6, plumpness: R(), legLength: 0.3 + R() * 0.5, crest: R(),
          },
          walkPhase: 0, asleep: false, calling: 0, target: x, idle: 60 + R() * 200, sleepy: R(),
        });
      }
    }

    // Lab controls
    setPhase(phase) {
      const c = this.clock;
      c.tick = c.day * DAY_TICKS + Math.round(phase * DAY_TICKS);
      this._updateClock();
      this._updatePlants(0);
    }

    setSeason(index) {
      const c = this.clock;
      c.day = index * SEASON_DAYS;
      c.tick = c.day * DAY_TICKS + Math.round(c.phase * DAY_TICKS);
      this._updateClock();
      this._updatePlants(0);
    }

    _updateClock() {
      const c = this.clock;
      c.day = Math.floor(c.tick / DAY_TICKS);
      c.phase = (c.tick % DAY_TICKS) / DAY_TICKS;
      c.sunElevation = Math.sin((c.phase - 0.25) * TAU);
      c.light = Math.max(0, Math.min(1, 0.08 + 0.92 * Math.max(0, Math.min(1, (c.sunElevation + 0.15) / 0.45))));
      const si = Math.floor(c.day / SEASON_DAYS) % 4;
      this.season.index = si;
      this.season.key = SEASON_KEYS[si];
      this.season.progress = ((c.day % SEASON_DAYS) + c.phase) / SEASON_DAYS;
    }

    // Fruit in summer and autumn, seed heads most of the year, a rock that warms in the sun
    _updatePlants(ticks) {
      const si = this.season.index, tick = this.clock.tick;
      for (const f of this.features) {
        if (f.kind === 'tree') f.fruiting = si === 3 ? 0.05 : si === 0 ? 0.25 : Math.max(0, Math.min(1, 0.6 + 0.4 * Math.sin(tick / 4000 + f.id)));
        if (f.kind === 'grass') f.seeding = si === 3 ? 0.15 : Math.max(0, Math.min(1, 0.55 + 0.45 * Math.sin(tick / 5000 + f.id)));
      }
      const rock = this.warmRock;
      const goal = (si === 3 ? 0.35 : 1) * Math.max(0, this.clock.sunElevation);
      rock.warm = ticks ? rock.warm + (goal - rock.warm) * Math.min(1, 0.001 * ticks) : goal;
    }

    // Advance by dt real seconds
    update(dt) {
      const ticks = Math.min(40, Math.round(dt * 60 * this.speed * 10) / 10);
      if (ticks <= 0) return;
      this.clock.tick += ticks;
      this._updateClock();
      this._updatePlants(ticks);
      this._updateItems(ticks);
      this._updateCreatures(ticks);
      for (const s of this.sounds) s.age += ticks;
      this.sounds = this.sounds.filter(s => s.age < 90);
      this._updateScent(ticks);
    }

    _updateItems(ticks) {
      const R = this.R, T = this.terrain;
      for (const it of this.items) {
        it.age += ticks;
        if (it.held) continue;
        const def = TYPES[it.type];
        if (def.crawls && it.onGround && R() < 0.01 * ticks) it.vx = R() < 0.3 ? 0 : (R() < 0.5 ? -1 : 1) * def.crawls * (0.4 + R() * 0.5);
        if (it.type === 'ball' && it.onGround && R() < 0.0015 * ticks) it.vx = (R() < 0.5 ? -1 : 1) * (1 + R() * 1.5);
        if (it.type === 'egg') { it.progress += 0.00004 * ticks; if (it.progress > 1) it.progress = 0.2; }
        // Crawlers turn back from water; everything stays inside the edges
        let nx = it.x + it.vx * ticks;
        if (def.crawls && T.waterLevelAt(nx + Math.sign(it.vx) * 10) !== null) { it.vx = -it.vx; nx = it.x; }
        if (it.home !== undefined && Math.abs(nx - it.home) > 120) it.vx = Math.sign(it.home - it.x) * Math.abs(it.vx);
        if (nx < this.edge || nx > this.width - this.edge) { it.vx = -it.vx * 0.6; nx = it.x; }
        it.x = nx;
        if (def.rolls) { it.vx *= Math.pow(0.985, ticks); it.rot += (it.vx / it.radius) * ticks; }
        // Fall, land on the ground or a platform, or float
        const prevY = it.y;
        it.vy += GRAVITY * ticks;
        it.y += it.vy * ticks;
        const floor = this.surfaceBelow(it.x, prevY - 1);
        const level = T.waterLevelAt(it.x);
        if (level !== null && it.y > level && !def.crawls && it.type !== 'dew') {
          it.y = level; it.vy = 0; it.vx *= 0.96; it.onGround = true;
        } else if (it.y >= floor) {
          it.y = floor; it.vy = 0; it.onGround = true;
        } else {
          it.onGround = false;
          if (!def.rolls) it.rot += 0.05 * ticks;
        }
      }
      // Now and then a fruit drops from a tree
      if (R() < 0.003 * ticks) {
        const trees = this.features.filter(f => f.kind === 'tree' && f.fruiting > 0.3);
        if (trees.length) {
          const t = trees[(R() * trees.length) | 0];
          this._item(t.species === 'mimic' ? 'mimic' : 'fruit', this._dryX(t.x + (R() - 0.5) * t.canopy * 1.4), { y: t.y - t.height + t.canopy * 0.5, onGround: false });
          const idx = this.items.findIndex(i => (i.type === 'fruit' || i.type === 'mimic') && i.onGround && i.age > 600);
          if (idx >= 0) this.items.splice(idx, 1);
        }
      }
    }

    _updateCreatures(ticks) {
      const R = this.R, night = this.clock.light < 0.2, T = this.terrain;
      for (const c of this.creatures) {
        c.asleep = night && c.sleepy > 0.4;
        if (c.calling > 0) c.calling -= ticks;
        if (!c.asleep && R() < 0.0012 * ticks) {
          c.calling = 40;
          const baby = c.stage <= 2;
          this.sounds.push({ x: c.x + c.facing * c.size * 0.38, y: c.y - c.size * 0.62, pitch: baby ? 0.9 : R() < 0.5 ? 0.7 : 0.2, loudness: 0.4 + R() * 0.6, age: 0, sourceId: c.id });
        }
        if (c.asleep) c.vx *= 0.8;
        else if (c.idle > 0) {
          c.idle -= ticks;
          c.vx *= Math.pow(0.8, ticks);
          if (c.idle <= 0) c.target = Math.max(this.edge, Math.min(this.width - this.edge, c.x + (R() < 0.5 ? -1 : 1) * (120 + R() * 420)));
        } else {
          const dx = c.target - c.x;
          c.vx = Math.sign(dx) * (0.55 + (c.stage < 3 ? 0.2 : 0.35) * c.looks.legLength) * (c.inWater ? 0.5 : 1);
          if (Math.abs(dx) < 4) c.idle = 60 + R() * 260;
        }
        if (Math.abs(c.vx) > 0.05) c.facing = c.vx > 0 ? 1 : -1;
        c.x = Math.max(this.edge, Math.min(this.width - this.edge, c.x + c.vx * ticks));
        // Jumps, gravity, landing on the ground or a platform, floating in a pond
        if (c.onGround && !c.inWater && !c.asleep && R() < 0.0008 * ticks) { c.vy = -4.6; c.onGround = false; }
        const prevY = c.y;
        c.vy += 0.22 * ticks;
        c.y += c.vy * ticks;
        const floor = this.surfaceBelow(c.x, prevY - 1);
        if (c.y >= floor) { c.y = floor; c.vy = 0; c.onGround = true; } else if (c.onGround && c.y > floor - 6 && c.vy >= 0) c.y = floor;
        else c.onGround = false;
        if (Math.abs(c.vx) > 0.05 && c.onGround) c.walkPhase += Math.abs(c.vx) * ticks * 0.35;
        const level = T.waterLevelAt(c.x);
        c.inWater = level !== null && c.y > level + 2;
        if (level !== null && c.y > level + c.size * 0.45) { c.y = level + c.size * 0.45; c.vy = Math.min(c.vy, 0); c.onGround = true; }
      }
    }

    _updateScent(ticks) {
      const sc = this.scent, { cols, rows, cell } = sc, solid = this.scentSolid;
      const decay = Math.pow(0.992, ticks);
      const emit = (ch, x, y, amount) => {
        const i = Math.floor(x / cell), j = Math.floor(y / cell);
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const ii = i + di, jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= cols || jj >= rows || solid[jj * cols + ii]) continue;
            sc.channels[ch][jj * cols + ii] += amount * (di || dj ? 0.35 : 1);
          }
        }
      };
      for (const it of this.items) if (SCENT_OF[it.type] !== undefined) emit(SCENT_OF[it.type], it.x, it.y - it.radius, 0.012 * ticks);
      for (const p of this.terrain.ponds) for (let x = p.x0; x < p.x1; x += 60) emit(2, x, p.level - 10, 0.01 * ticks);
      for (const c of this.creatures) emit(c.sex === 'FEMALE' ? 6 : 7, c.x, c.y - c.size * 0.3, 0.01 * ticks);
      // Diffuse (a cheap blur with an upward drift) and decay; nothing soaks into the ground
      const tmp = this.scentTmp;
      for (const ch of sc.channels) {
        for (let j = 0; j < rows; j++) {
          for (let i = 0; i < cols; i++) {
            const o = j * cols + i;
            if (solid[o]) { tmp[o] = 0; continue; }
            const v = ch[o];
            const l = i > 0 && !solid[o - 1] ? ch[o - 1] : v, r = i < cols - 1 && !solid[o + 1] ? ch[o + 1] : v;
            const u = j > 0 && !solid[o - cols] ? ch[o - cols] : v, d = j < rows - 1 && !solid[o + cols] ? ch[o + cols] : v;
            tmp[o] = (v * 2 + l + r + u * 0.8 + d * 1.2) / 6 * decay;
          }
        }
        ch.set(tmp);
      }
    }
  }

  MockWorld.DAY_TICKS = DAY_TICKS;
  Evo.MockWorld = MockWorld;
})(globalThis.Evo);
