// The side-view world: terrain, a pond, trees and plants that grow food, day and night, seasons,
// temperature, scent in the air, sound, and the creatures. A pure simulation: it never touches the
// page; it announces what happens on world.events.
(function (Evo) {
  'use strict';
  const { clamp, clamp01 } = Evo.util;
  const { SCENTS, ITEM_TYPES, SEASONS, DAY_TICKS, SEASON_DAYS, LIMITS, STAGE, CREATURE } = Evo;

  const WORLD_W = 3600, WORLD_H = 900;
  const SCENT_CELL = 30;
  const SCENT_EVERY = 3;            // Scent spreads slowly, so it diffuses every third tick (at triple rate)
  const GRAVITY = CREATURE.GRAVITY;
  const WANDER_INTERVAL = 1800;
  const HOLD_GRIP = 0.7;            // A creature in the hand hangs with its feet this many body lengths below it
  const SOUND_LIFE = 90;            // Ticks a call stays in world.sounds

  // ---------- Terrain: a height field with a pond ----------
  class Terrain {
    constructor(width, height, layout) {
      this.step = 8;
      const n = Math.ceil(width / this.step) + 1;
      this.heights = new Float32Array(n);
      const ph = [Evo.random() * 6.28, Evo.random() * 6.28, Evo.random() * 6.28];
      for (let i = 0; i < n; i++) {
        const x = i * this.step;
        let h = 640 + 30 * Math.sin(x / 1400 * 6.28 + ph[0]) + 18 * Math.sin(x / 520 * 6.28 + ph[1]) + 7 * Math.sin(x / 170 * 6.28 + ph[2]);
        // The hill with the warm rock
        const hill = (x - layout.hill) / 260;
        h -= 70 * Math.exp(-hill * hill);
        // Cliffs at both ends keep everyone in
        const edge = Math.min(x, width - x);
        if (edge < 140) h -= 260 * (1 - edge / 140) ** 2;
        this.heights[i] = h;
      }
      // Ponds: smooth dips that fill with water up to just below their lower rim
      this.ponds = layout.ponds.map(([x0, x1, depth]) => {
        for (let i = 0; i < n; i++) {
          const x = i * this.step;
          if (x > x0 && x < x1) this.heights[i] += depth * Math.pow(Math.sin(Math.PI * (x - x0) / (x1 - x0)), 0.8);
        }
        const level = Math.min(this.groundY(x0), this.groundY(x1)) + 6;
        let a = x0, b = x1;
        while (a < x1 && this.groundY(a) < level) a += 2;
        while (b > x0 && this.groundY(b) < level) b -= 2;
        return { x0: a, x1: b, level };
      });
    }

    groundY(x) {
      const f = clamp(x / this.step, 0, this.heights.length - 1.001);
      const i = Math.floor(f), t = f - i;
      return this.heights[i] * (1 - t) + this.heights[i + 1] * t;
    }

    slopeAt(x) {
      return (this.groundY(x + 4) - this.groundY(x - 4)) / 8;
    }

    // The pond surface at x, or null where there is no water
    waterLevelAt(x) {
      for (const p of this.ponds) if (x >= p.x0 && x <= p.x1) return p.level;
      return null;
    }
  }

  // What each tree species grows (an ITEM_TYPES key)
  const TREE_YIELDS = { fruit: 'fruit', mimic: 'mimic' };

  const SEXES = ['FEMALE', 'MALE', 'FEMALE', 'MALE', 'FEMALE', 'MALE'];
  const chromFor = sex => (sex === 'FEMALE' ? 'X' : 'Y');
  const FOUNDER_RESERVES = { glucose: 0.6, glycogen: 0.6, fat: 0.5, protein: 0.6, water: 0.8 };
  const WANDERER_RESERVES = { glucose: 0.5, glycogen: 0.4, fat: 0.35, protein: 0.45, water: 0.7 };

  class World {
    constructor({ width = WORLD_W, height = WORLD_H } = {}) {
      this.width = width;
      this.height = height;
      this.events = new Evo.EventBus();
      this.clock = { tick: 0, day: 0, phase: 0.3, light: 1, sunElevation: 1 };
      this.startPhase = 0.3; // Begin on a morning
      this.season = { key: SEASONS[0].key, index: 0, progress: 0 };
      this.creatures = [];
      this.items = [];
      this.sounds = [];
      this.history = [];     // Everyone who has lived here: { id, name, sex, generation, born, died, cause, motherId, fatherId }
      this.seedBank = [];    // Genomes of creatures that mated: wanderers and re-founders come from here
      this.stats = { hatched: 0, eggsLaid: 0, matings: 0, meals: 0, poisonings: 0, wanderers: 0, refoundings: 0, deaths: {} };
      this.hand = { x: 0, y: 0, holding: null };
      this.edge = 150;       // Creatures and items stay this far from the world's ends (the cliffs are scenery)

      this.buildLandscape();
      this.scent = {
        cols: Math.ceil(width / SCENT_CELL), rows: Math.ceil(height / SCENT_CELL), cell: SCENT_CELL,
        channels: SCENTS.map(() => new Float32Array(Math.ceil(width / SCENT_CELL) * Math.ceil(height / SCENT_CELL)))
      };
      this.scentScratch = new Float32Array(this.scent.cols * this.scent.rows);
      this.scentSolid = new Uint8Array(this.scent.cols * this.scent.rows);
      for (let r = 0; r < this.scent.rows; r++) {
        for (let c = 0; c < this.scent.cols; c++) {
          // A cell is solid when its centre is underground
          if ((r + 0.5) * SCENT_CELL > this.terrain.groundY((c + 0.5) * SCENT_CELL) + SCENT_CELL * 0.5) this.scentSolid[r * this.scent.cols + c] = 1;
        }
      }
      this.updateClock();
      this.found();
      this.seedFood();
    }

    // ---------- Landscape ----------
    buildLandscape() {
      const W = this.width;
      const jitter = f => (f + Evo.randRange(-0.015, 0.015)) * W;
      const big = jitter(0.58), small = jitter(0.06);
      const layout = { hill: jitter(0.31), ponds: [[big, big + 420, 80], [small, small + 170, 45]] };
      this.terrain = new Terrain(W, this.height, layout);
      const t = this.terrain;
      const at = x => ({ x, y: t.groundY(x) });
      let id = 0;
      const feature = (kind, x, props) => ({ id: ++id, kind, ...at(x), ...props });
      // A tree's species decides the item type it yields (renderers draw by species)
      const tree = (x, species, props) => feature('tree', x, { species, yields: TREE_YIELDS[species], ...props });
      this.features = [
        feature('thornbush', jitter(0.125), { radius: 22 }),
        tree(jitter(0.16), 'fruit', { height: 210, canopy: 85, fruiting: 0.5 }),
        tree(jitter(0.235), 'mimic', { height: 140, canopy: 55, fruiting: 0.4 }),
        feature('rock', layout.hill + 30, { w: 96, h: 52, warm: 0 }),
        feature('grass', jitter(0.41), { width: 230, height: 40, seeding: 0.4 }),
        feature('log', jitter(0.49), { length: 150 }),
        ...this.terrain.ponds.flatMap(p => [feature('reeds', p.x0 - 20, { width: 50 }), feature('reeds', p.x1 + 20, { width: 50 })]),
        tree(jitter(0.79), 'fruit', { height: 230, canopy: 95, fruiting: 0.5 }),
        feature('thornbush', jitter(0.84), { radius: 20 }),
        feature('grass', jitter(0.905), { width: 210, height: 40, seeding: 0.4 }),
        feature('thornbush', jitter(0.70), { radius: 18 })
      ];
      const rock = this.features.find(f => f.kind === 'rock');
      const log = this.features.find(f => f.kind === 'log');
      this.platforms = [
        { x0: rock.x - rock.w / 2 + 6, x1: rock.x + rock.w / 2 - 6, y: rock.y - rock.h + 4, kind: 'rock' },
        { x0: log.x - log.length / 2, x1: log.x + log.length / 2, y: log.y - 24, kind: 'log' }
      ];
    }

    // The highest surface at or below fromY at x: the ground, or a platform the thing is above
    surfaceBelow(x, fromY) {
      let y = this.terrain.groundY(x);
      for (const p of this.platforms) if (x >= p.x0 && x <= p.x1 && p.y >= fromY && p.y < y) y = p.y;
      return y;
    }

    // ---------- Time, light, seasons, temperature ----------
    updateClock() {
      const c = this.clock;
      const total = c.tick + this.startPhase * DAY_TICKS;
      c.day = Math.floor(total / DAY_TICKS);
      c.phase = (total % DAY_TICKS) / DAY_TICKS;
      c.sunElevation = Math.sin((c.phase - 0.25) * Math.PI * 2);
      c.light = clamp01(0.08 + 0.92 * clamp01((c.sunElevation + 0.15) / 0.45));
      const idx = Math.floor(c.day / SEASON_DAYS) % SEASONS.length;
      const progress = (c.day % SEASON_DAYS + c.phase) / SEASON_DAYS;
      if (idx !== this.season.index) {
        this.season = { key: SEASONS[idx].key, index: idx, progress };
        this.events.emit('season', { season: this.season });
      } else {
        this.season.progress = progress;
      }
    }

    // Jump the clock to a day and time of day (phase 0 = midnight, 0.5 = noon)
    setTime(day, phase) {
      this.clock.tick = Math.round((day + phase - this.startPhase) * DAY_TICKS);
      this.updateClock();
    }

    get seasonInfo() { return SEASONS[this.season.index]; }

    // Air temperature (0 freezing .. 1 hot): the season, the sun, shade, water, and the warm rock
    temperatureAt(x, y) {
      const s = this.seasonInfo, c = this.clock;
      let t = s.temp + s.swing * c.sunElevation;
      for (const f of this.features) {
        if (f.kind === 'tree' && Math.abs(x - f.x) < f.canopy && y > f.y - f.height) t -= 0.05 * c.light; // Shade
        if (f.kind === 'rock' && Math.abs(x - f.x) < f.w * 0.8 && y > f.y - f.h - 40) t += 0.04 + f.warm * 0.14; // Stored sun
      }
      const level = this.terrain.waterLevelAt(x);
      if (level !== null && y > level) t -= 0.08;
      return clamp01(t);
    }

    // ---------- Scent ----------
    scentIndex(x, y) {
      const s = this.scent;
      return clamp(Math.floor(y / s.cell), 0, s.rows - 1) * s.cols + clamp(Math.floor(x / s.cell), 0, s.cols - 1);
    }

    depositScent(x, y, channel, amount) {
      const g = this.scent.channels[channel], i = this.scentIndex(x, y);
      if (!this.scentSolid[i]) g[i] = Math.min(2.5, g[i] + amount);
    }

    // Bilinear sample; a cell's centre is at (k + 0.5) * cell
    sampleScent(x, y, channel) {
      const s = this.scent, g = s.channels[channel];
      const gx = clamp(x / s.cell - 0.5, 0, s.cols - 1), gy = clamp(y / s.cell - 0.5, 0, s.rows - 1);
      const c0 = Math.floor(gx), r0 = Math.floor(gy);
      const c1 = Math.min(s.cols - 1, c0 + 1), r1 = Math.min(s.rows - 1, r0 + 1);
      const fx = gx - c0, fy = gy - r0;
      const top = g[r0 * s.cols + c0] * (1 - fx) + g[r0 * s.cols + c1] * fx;
      const bot = g[r1 * s.cols + c0] * (1 - fx) + g[r1 * s.cols + c1] * fx;
      return top * (1 - fy) + bot * fy;
    }

    // ---------- What things look like to an eye ----------
    lookOf(item) {
      const def = ITEM_TYPES[item.type];
      if (item.type === 'egg' || item.type === 'ball') {
        const l = Evo.hueFeatures(item.hue || 0, 0.8);
        if (item.type === 'ball' && Math.abs(item.vx) > 0.3) l.motion = Math.min(1, Math.abs(item.vx) / 3);
        return l;
      }
      if (def.crawls && Math.abs(item.vx) > 0.1) return { ...def.look, motion: Math.min(1, Math.abs(item.vx) * 2) };
      return def.look;
    }

    // Another creature: a big furry shape, faintly the colour of its coat
    lookOfCreature(c) {
      const l = Evo.hueFeatures(c.traits.hue, 0.25);
      l.creature = 1;
      if (c.fertile) l.pink = Math.max(l.pink || 0, 0.8); // Courtship display: the crest flushes pink
      const speed = Math.abs(c.vx) + Math.abs(c.vy) * 0.5;
      if (speed > 0.3) l.motion = Math.min(1, speed / 2);
      return l;
    }

    lookOfFeature(f) {
      if (f.kind === 'thornbush') return { x: f.x, y: f.y - f.radius * 0.6, radius: f.radius, features: { violet: 1, green: 0.3 } };
      if (f.kind === 'tree' && f.fruiting > 0.2) {
        return { x: f.x, y: f.y - f.height + f.canopy * 0.4, radius: f.canopy * 0.35 * f.fruiting, features: ITEM_TYPES[f.yields].look };
      }
      return null;
    }

    // The nearest point of pond surface within range (as seen from x)
    nearestWater(x, range) {
      let best = null;
      for (const p of this.terrain.ponds) {
        const px = clamp(x, p.x0, p.x1);
        if (Math.abs(px - x) <= range && (!best || Math.abs(px - x) < Math.abs(best.x - x))) best = { x: px, y: p.level };
      }
      return best;
    }

    // ---------- Items ----------
    spawnItem(type, x, y, props = {}) {
      const def = ITEM_TYPES[type];
      if (!def) return null;
      const item = {
        id: Evo.nextId(), type, x, y: y === undefined ? this.terrain.groundY(x) : y,
        vx: props.vx || 0, vy: props.vy || 0, radius: def.radius, rot: Evo.random() * Math.PI * 2,
        age: 0, held: null, onGround: false, ...props
      };
      this.items.push(item);
      return item;
    }

    // A player (or plant) drops an item from a height; it falls to the ground
    dropItem(type, x, y) {
      if (type === 'thorn') return this.addThornbush(x);
      const props = type === 'ball' ? { hue: Evo.randInt(360) } : {};
      x = clamp(x, this.edge, this.width - this.edge);
      return this.spawnItem(type, x, Math.min(y, this.surfaceBelow(x, y) - 1), props);
    }

    addThornbush(x) {
      const f = { id: Evo.nextId(), kind: 'thornbush', x, y: this.terrain.groundY(x), radius: 18 };
      this.features.push(f);
      return f;
    }

    // What eating an item puts in the gut (null if it isn't food)
    foodOf(item) {
      const def = ITEM_TYPES[item.type];
      if (def.food === 'contents') return item.contents;
      return def.food;
    }

    get foodCount() {
      let n = 0;
      for (const i of this.items) if (ITEM_TYPES[i.type].food && i.type !== 'carrion') n++;
      return n;
    }

    // Take an item out of the mouth of the creature carrying it (if one is)
    detachFromCarrier(item) {
      if (!item.held || item.held === 'hand') return;
      const c = this.creatureById(item.held);
      if (c && c.carrying === item) c.carrying = null;
      item.held = null;
    }

    removeItem(item) {
      const i = this.items.indexOf(item);
      if (i >= 0) this.items.splice(i, 1);
      this.detachFromCarrier(item);
      if (this.hand.holding && this.hand.holding.item === item) this.hand.holding = null;
    }

    consumeItem(creature, item, food) {
      this.removeItem(item);
      creature.meals++;
      if (food.toxin) this.stats.poisonings++; else this.stats.meals++;
      this.events.emit('eat', { creature, item, food });
    }

    pickUpItem(creature, item) {
      if (item.held) return;
      item.held = creature.id;
      creature.carrying = item;
      this.events.emit('grab', { creature, item });
    }

    dropCarried(creature) {
      const item = creature.carrying;
      if (!item) return;
      this.detachFromCarrier(item);
      creature.carrying = null;
      item.vx = creature.vx + creature.facing * 0.6;
      item.vy = -0.5;
    }

    // ---------- Sound ----------
    makeSound(creature) {
      const T = creature.traits;
      const baby = creature.stage <= STAGE.CHILD;
      this.sounds.push({ x: creature.headX, y: creature.headY, pitch: Math.min(1, T.voicePitch + (baby ? 0.3 : 0)), loudness: T.voiceLoudness, age: 0, sourceId: creature.id });
      this.events.emit('call', { creature });
    }

    // ---------- Creatures ----------
    // A founder genome with its own looks (appearance and voice vary between founders)
    founderGenome(sex) {
      const g = Evo.Genome.founder(chromFor(sex));
      for (const gene of g.findGenes()) {
        const name = Evo.GENES[gene.type].name;
        if (name === 'Appearance' || name === 'Voice') {
          for (let k = gene.start + 2; k < gene.end; k++) g.dna[k] = Evo.randInt(256);
        }
      }
      return g;
    }

    addCreature(genome, x, opts) {
      const c = new Evo.Creature(genome, x, this.terrain.groundY(x), opts);
      this.creatures.push(c);
      this.history.push({ id: c.id, name: c.name, sex: c.sex, generation: c.generation, born: this.clock.tick, died: null, cause: null, motherId: c.motherId, fatherId: c.fatherId });
      return c;
    }

    // A grown adult arriving (founders, wanderers, or added by the player)
    addAdult(sex, { genome = null, x = null, reserves = FOUNDER_RESERVES, generation = 1 } = {}) {
      if (this.creatures.length >= LIMITS.MAX_POPULATION) return null;
      genome = genome || this.founderGenome(sex);
      genome.sexChrom = chromFor(sex);
      const lifespan = genome.develop().lifespanTicks;
      const px = x === null ? Evo.randRange(0.2, 0.8) * this.width : x;
      return this.addCreature(genome, px, { generation, reserves, growth: 1, ageTicks: Math.floor(lifespan * Evo.randRange(0.36, 0.5)) });
    }

    found() {
      const fromBank = this.seedBank.length > 0;
      for (const sex of SEXES) {
        if (fromBank) {
          const src = Evo.pick(this.seedBank);
          this.addAdult(sex, { genome: src.genome.cloneWithMutation(), generation: src.generation, reserves: WANDERER_RESERVES });
        } else {
          this.addAdult(sex);
        }
      }
      if (fromBank) {
        this.stats.refoundings++;
        this.events.emit('refound', {});
      }
    }

    bankGenome(creature) {
      this.seedBank.push({ genome: creature.genome.clone(), generation: creature.generation });
      if (this.seedBank.length > LIMITS.SEED_BANK) this.seedBank.shift();
    }

    // A wanderer walks in from the edge when one sex is nearly gone
    maybeWanderer() {
      if (this.creatures.length >= LIMITS.MAX_POPULATION) return;
      const females = this.creatures.filter(c => c.sex === 'FEMALE' && c.isMature).length;
      const males = this.creatures.filter(c => c.sex === 'MALE' && c.isMature).length;
      const sex = females < 2 ? 'FEMALE' : males < 2 ? 'MALE' : null;
      if (!sex) return;
      const src = this.seedBank.length ? Evo.pick(this.seedBank) : null;
      const c = this.addAdult(sex, {
        genome: src ? src.genome.cloneWithMutation() : null, generation: src ? src.generation : 1,
        reserves: WANDERER_RESERVES, x: Evo.chance(0.5) ? this.edge + 30 : this.width - this.edge - 30
      });
      if (c) {
        this.stats.wanderers++;
        this.events.emit('wanderer', { creature: c });
      }
    }

    // Mating: a fertile female and male touching may mate; she carries the egg
    tryMating() {
      for (const f of this.creatures) {
        if (f.sex !== 'FEMALE' || f.pregnancy || f.mateCooldown > 0 || !f.fertile) continue;
        for (const m of this.creatures) {
          if (m.sex !== 'MALE' || m.mateCooldown > 0 || !m.fertile) continue;
          if (Math.abs(m.x - f.x) > (m.size + f.size) * 0.45 || Math.abs(m.y - f.y) > 20) continue;
          if (!Evo.chance(0.03)) continue;
          f.pregnancy = { genome: Evo.Genome.recombine(f.genome, m.genome), fatherId: m.id, generation: Math.max(f.generation, m.generation) + 1,
            parents: [f, m], progress: 0, reserves: Object.fromEntries(Object.keys(Evo.EGG_CONTENTS).map(k => [k, 0])) };
          f.stim.mated = 1; m.stim.mated = 1;
          f.mateCooldown = m.mateCooldown = 1800;
          f.timesMated++; m.timesMated++;
          m.chem.add('protein', -0.04);
          this.bankGenome(f); this.bankGenome(m);
          this.stats.matings++;
          this.events.emit('mate', { mother: f, father: m });
          break;
        }
      }
    }

    layEgg(mother, pregnancy) {
      const traits = pregnancy.genome.develop();
      this.spawnItem('egg', mother.x - mother.facing * mother.size * 0.4, mother.y, {
        genome: pregnancy.genome, reserves: pregnancy.reserves, parents: pregnancy.parents.map(p => ({ id: p.id, syllables: p.syllables })),
        generation: pregnancy.generation, hue: traits.hue, accentHue: traits.accentHue, progress: 0, incubationTicks: traits.incubationTicks
      });
      this.stats.eggsLaid++;
      this.events.emit('egg', { mother });
    }

    // A founder egg placed by the player: a fresh genome, provisioned as a mother would
    addEgg(x, y, { sex = Evo.chance(0.5) ? 'FEMALE' : 'MALE', genome = null } = {}) {
      genome = genome || this.founderGenome(sex);
      const traits = genome.develop();
      x = clamp(x, this.edge, this.width - this.edge);
      return this.spawnItem('egg', x, Math.min(y, this.surfaceBelow(x, y) - 1), {
        genome, reserves: { ...Evo.EGG_CONTENTS }, parents: null, generation: 1,
        hue: traits.hue, accentHue: traits.accentHue, progress: 0, incubationTicks: traits.incubationTicks
      });
    }

    // Eggs incubate faster when warm, stall when cold, and hatch into babies. Returns true when the
    // egg is ready to hatch (the caller hatches it once it is no longer iterating the items).
    incubate(egg) {
      const t = this.temperatureAt(egg.x, egg.y - 5);
      egg.progress += clamp((t - 0.15) / 0.3, 0, 1.3) / egg.incubationTicks;
      return egg.progress >= 1;
    }

    hatch(egg) {
      if (this.creatures.length >= LIMITS.MAX_POPULATION || egg.held) return;
      this.removeItem(egg);
      const c = this.addCreature(egg.genome, egg.x, { generation: egg.generation, parents: egg.parents, reserves: egg.reserves, growth: 0 });
      c.y = egg.y;
      this.stats.hatched++;
      this.events.emit('hatch', { creature: c });
    }

    // Mouth against another creature: a nuzzle, felt by both as friendly touch
    nuzzle(from, to) {
      to.stim.gentle = Math.max(to.stim.gentle, 0.5);
      to.stim.touchingFriend = 1;
      from.stim.touchingFriend = 1;
      this.events.emit('nuzzle', { from, to });
    }

    // A shove pushes the other creature away, and hurts a little
    shove(from, to) {
      to.stim.impact = Math.max(to.stim.impact, 0.4);
      to.stim.flinch = 1;
      to.vx += from.facing * 2.5;
      to.vy = Math.min(to.vy, -1.5);
      to.onGround = false;
      this.events.emit('shove', { from, to });
    }

    // Company, crowding and touch between creatures (a purely local interaction)
    socialContact() {
      const cs = this.creatures;
      for (const c of cs) { c.companyCount = 0; }
      for (let i = 0; i < cs.length; i++) {
        const a = cs[i];
        for (let j = i + 1; j < cs.length; j++) {
          const b = cs[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.hypot(dx, dy);
          if (d > 160) continue;
          a.companyCount++; b.companyCount++;
          if (d < (a.radius + b.radius) * 1.1 && !a.held && !b.held) {
            a.stim.touchingFriend = 1; b.stim.touchingFriend = 1;
            a.stim[dx > 0 ? 'contactR' : 'contactL'] = 1;
            b.stim[dx > 0 ? 'contactL' : 'contactR'] = 1;
          }
        }
      }
      for (const c of cs) {
        c.company = Math.min(1, c.companyCount * 0.5);
        c.crowding = clamp01((c.companyCount - 3) / 4);
      }
    }

    handleDeath(c) {
      this.creatures.splice(this.creatures.indexOf(c), 1);
      this.stats.deaths[c.causeOfDeath] = (this.stats.deaths[c.causeOfDeath] || 0) + 1;
      const rec = this.history.find(h => h.id === c.id);
      if (rec) { rec.died = this.clock.tick; rec.cause = c.causeOfDeath; }
      const ch = c.chem;
      const contents = { gutProtein: Math.min(0.5, ch.get('protein') * 0.6 + 0.1 * c.growth), gutFat: ch.get('fat') * 0.5, gutSugar: ch.get('glucose') * 0.3 };
      this.spawnItem('carrion', c.x, c.y, { contents, hue: c.traits.hue });
      if (this.hand.holding && this.hand.holding.creature === c) this.hand.holding = null;
    }

    // ---------- Plants and animals that make food ----------
    growFood() {
      const s = this.seasonInfo, light = this.clock.light;
      const full = this.foodCount >= LIMITS.MAX_FOOD;
      for (const f of this.features) {
        if (f.kind === 'tree') {
          f.fruiting = clamp01(f.fruiting + s.grow[f.yields] * 0.00009 * light);
          if (!full && f.fruiting > 0.3 && Evo.chance(f.fruiting * 0.0025)) {
            this.spawnItem(f.yields, f.x + Evo.randRange(-0.7, 0.7) * f.canopy, f.y - f.height + f.canopy * 0.5);
            f.fruiting -= 0.06;
          }
        } else if (f.kind === 'grass') {
          f.seeding = clamp01(f.seeding + s.grow.grain * 0.0001 * light);
          if (!full && f.seeding > 0.3 && Evo.chance(f.seeding * 0.003)) {
            const x = f.x + Evo.randRange(-0.5, 0.5) * f.width;
            this.spawnItem('grain', x, this.terrain.groundY(x) - f.height);
            f.seeding -= 0.05;
          }
          // Dew forms on the grass at dawn
          if (!full && this.clock.phase > 0.2 && this.clock.phase < 0.3 && Evo.chance(0.004 * s.dew)) {
            const x = f.x + Evo.randRange(-0.5, 0.5) * f.width;
            this.spawnItem('dew', x, this.terrain.groundY(x) - 2);
          }
          if (!full && Evo.chance(0.0004 * s.grow.bug)) this.spawnItem('bug', f.x + Evo.randRange(-0.5, 0.5) * f.width, f.y - 4);
        } else if (f.kind === 'log') {
          if (!full && Evo.chance(0.0007 * s.grow.grub)) {
            const x = f.x + (Evo.chance(0.5) ? -1 : 1) * (f.length / 2 + Evo.randRange(0, 30));
            this.spawnItem('grub', x, this.terrain.groundY(x), { home: f.x });
          }
        } else if (f.kind === 'rock') {
          // The rock soaks up sunshine by day and gives it back at night
          f.warm = clamp01(f.warm + (light > 0.5 ? 0.0004 : -0.00025));
        }
      }
    }

    seedFood() {
      for (const f of this.features) {
        if (f.kind === 'tree') for (let i = 0; i < 3; i++) this.spawnItem(f.yields, f.x + Evo.randRange(-1, 1) * f.canopy);
        if (f.kind === 'grass') for (let i = 0; i < 4; i++) this.spawnItem('grain', f.x + Evo.randRange(-0.5, 0.5) * f.width);
        if (f.kind === 'log') for (let i = 0; i < 2; i++) this.spawnItem('grub', f.x + (i ? 1 : -1) * (f.length / 2 + 10), undefined, { home: f.x });
      }
      this.spawnItem('ball', this.width * 0.45, undefined, { hue: 200 });
    }

    // ---------- Item physics ----------
    moveItems() {
      const hatching = [];
      for (const item of this.items) {
        const def = ITEM_TYPES[item.type];
        item.age++;
        if (item.held) {
          const holder = item.held === 'hand' ? null : this.creatureById(item.held);
          if (holder) { item.x = holder.mouthX + holder.facing * item.radius * 0.5; item.y = holder.mouthY + item.radius; item.vx = holder.vx; item.vy = 0; }
          continue;
        }
        // Little animals move by themselves
        if (def.crawls && item.onGround) {
          if (Evo.chance(0.03)) item.vx += (Evo.random() - 0.5) * def.crawls;
          if (def.flees) {
            for (const c of this.creatures) {
              const dx = item.x - c.x;
              if (Math.abs(dx) < 70 && Math.abs(item.y - c.y) < 40) {
                item.vx += Math.sign(dx || 1) * 0.08;
                if (def.hops && Evo.chance(0.02)) item.vy = -3.2;
              }
            }
          }
          if (item.home !== undefined && Math.abs(item.x - item.home) > 120) item.vx += Math.sign(item.home - item.x) * 0.05;
          item.vx = clamp(item.vx, -def.crawls * 2, def.crawls * 2);
          const ahead = item.x + Math.sign(item.vx) * 10;
          if (this.terrain.waterLevelAt(ahead) !== null) item.vx = -item.vx; // Bugs keep out of the water
        }
        item.vy += GRAVITY;
        const prevY = item.y;
        item.x = clamp(item.x + item.vx, this.edge, this.width - this.edge);
        item.y += item.vy;
        const floor = this.surfaceBelow(item.x, prevY - 1);
        const level = this.terrain.waterLevelAt(item.x);
        if (level !== null && item.y > level && !def.crawls && item.type !== 'dew') {
          item.y = Math.min(item.y, level); // Floats
          item.vy = 0; item.vx *= 0.96; item.onGround = true;
        } else if (item.y >= floor) {
          item.y = floor;
          item.vy = Math.abs(item.vy) > 1.5 ? -item.vy * (def.bounce || 0) : 0;
          item.onGround = true;
          item.vx *= def.rolls ? 0.985 : def.crawls ? 0.9 : 0.8;
          if (def.rolls || def.bounce) item.vx += this.terrain.slopeAt(item.x) * 0.12;
          if (def.rolls) item.rot += item.vx / item.radius;
        } else {
          item.onGround = false;
        }
        if (item.type === 'egg' && this.incubate(item)) hatching.push(item);
      }
      // Hatch after the loop: removing an egg from this.items mid-loop would skip the next item
      for (const egg of hatching) this.hatch(egg);
      this.items = this.items.filter(i => !ITEM_TYPES[i.type].ttl || i.age < ITEM_TYPES[i.type].ttl || i.held);
    }

    // Odours rise from items and bodies, spread through the air, and fade
    stepScent() {
      for (const item of this.items) {
        for (const [ch, rate] of ITEM_TYPES[item.type].odour) this.depositScent(item.x, item.y - item.radius, ch, rate);
      }
      for (const p of this.terrain.ponds) for (let x = p.x0; x < p.x1; x += 60) this.depositScent(x, p.level - 10, Evo.SCENT.moist, 0.02);
      if (this.clock.tick % SCENT_EVERY) return;
      const s = this.scent;
      SCENTS.forEach((sc, ch) => Evo.diffuse(s.channels[ch], this.scentScratch, s.cols, s.rows,
        sc.diffusion * SCENT_EVERY, Math.pow(1 - sc.decay, SCENT_EVERY), 0.0005, this.scentSolid));
    }

    // ---------- The player's hand ----------
    pat(c) {
      c.stim.gentle = 1; c.stim.back = Math.max(c.stim.back, 0.6);
      this.events.emit('pat', { creature: c });
    }

    slap(c) {
      c.stim.impact = 1; c.stim.back = 1; c.stim.flinch = 1;
      c.injury = Math.min(1, c.injury + 0.01);
      this.events.emit('slap', { creature: c });
    }

    // holding: { creature } or { item }
    grab(holding, x, y) {
      this.releaseHand(0, 0);
      if (holding.creature) {
        holding.creature.held = true;
        if (holding.creature.carrying) this.dropCarried(holding.creature);
      }
      if (holding.item) {
        this.detachFromCarrier(holding.item);
        holding.item.held = 'hand';
      }
      this.hand.holding = holding;
      this.moveHand(x, y);
    }

    moveHand(x, y) {
      this.hand.x = clamp(x, 0, this.width);
      this.hand.y = clamp(y, 0, this.height);
      const h = this.hand.holding;
      if (!h) return;
      if (h.creature) { h.creature.x = clamp(x, this.edge, this.width - this.edge); h.creature.y = y + h.creature.size * HOLD_GRIP; }
      if (h.item) { h.item.x = x; h.item.y = y + h.item.radius; }
    }

    releaseHand(vx, vy) {
      const h = this.hand.holding;
      if (!h) return;
      if (h.creature) { h.creature.held = false; h.creature.vx = clamp(vx, -8, 8); h.creature.vy = clamp(vy, -10, 10); h.creature.onGround = false; }
      if (h.item) { h.item.held = null; h.item.vx = clamp(vx, -8, 8); h.item.vy = clamp(vy, -10, 10); }
      this.hand.holding = null;
    }

    // ---------- One tick ----------
    step() {
      this.clock.tick++;
      this.updateClock();
      this.growFood();
      this.moveItems();
      this.stepScent();
      this.socialContact();
      for (const c of [...this.creatures]) {
        c.step(this);
        if (c.dead) this.handleDeath(c);
      }
      this.tryMating();
      for (const s of this.sounds) s.age++;
      this.sounds = this.sounds.filter(s => s.age < SOUND_LIFE);
      if (this.clock.tick % WANDER_INTERVAL === 0) this.maybeWanderer();
      if (this.creatures.length === 0 && !this.items.some(i => i.type === 'egg')) this.found();
    }

    // ---------- Queries ----------
    creatureById(id) { return this.creatures.find(c => c.id === id) || null; }
  }

  Object.assign(Evo, { World, Terrain, WORLD: { WIDTH: WORLD_W, HEIGHT: WORLD_H, SCENT_CELL, HOLD_GRIP, SOUND_LIFE } });
})(globalThis.Evo);
