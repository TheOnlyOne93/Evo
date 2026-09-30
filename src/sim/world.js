// The side-view world: terrain, ponds, trees and plants that grow food, day and night, seasons,
// temperature, scent in the air, sound, and the creatures. A pure simulation: it never touches the
// page; it announces what happens on world.events.
(function (Evo) {
  'use strict';
  const { clamp, clamp01, TAU } = Evo.util;
  const { SCENTS, ITEM_TYPES, SEASONS, DAY_TICKS, SEASON_DAYS, LIMITS, STAGE, CREATURE } = Evo;

  const SCENT_CELL = 30;
  const SCENT_EVERY = 3;            // Scent spreads slowly, so it diffuses every third tick (at triple rate)
  const GRAVITY = CREATURE.GRAVITY;
  const WANDER_INTERVAL = 1800;
  const HOLD_GRIP = 0.7;            // A creature in the hand hangs with its feet this many body lengths below it
  const SOUND_LIFE = 90;            // Ticks a call stays in world.sounds
  const ADULT_ARRIVAL_AGE = [0.36, 0.5]; // A wandering adult arrives at this fraction of its lifespan
  // Food growth per tick (rate x light x season): fruit and grain build up to a threshold, then ripen by chance; dew forms in a dawn window
  const GROWTH = {
    fruit: { rate: 0.00009, threshold: 0.3, chance: 0.0025, cost: 0.06 },
    grain: { rate: 0.0001, threshold: 0.3, chance: 0.003, cost: 0.05 },
    dew: { from: 0.2, to: 0.3, chance: 0.004 }, bug: 0.0004, grub: 0.0007
  };
  // The warm rock: its warmth rises by `warm` a tick in daylight (light above `light`) and falls by `cool` otherwise
  const ROCK = { warm: 0.0004, cool: 0.00025, light: 0.5 };
  // Mating: reach is a share of the two body sizes (horizontal), vertical is px
  const MATING = { reach: 0.45, vertical: 20, chance: 0.03, cooldown: 1800, maleProtein: 0.04 };
  // Egg incubation speed: (temperature - cold) / span, at most max
  const INCUBATION = { cold: 0.15, span: 0.3, max: 1.3 };
  // A dead body's food: gut protein (capped) from body protein and growth, fat and sugar from reserves
  const CARRION = { proteinCap: 0.5, protein: 0.6, growth: 0.1, fat: 0.5, sugar: 0.3 };
  const POND_SCENT = { spacing: 60, amount: 0.02 };

  // A new world, and one refounded after extinction (from the seed bank), starts with one female and one male
  const FOUNDERS = ['FEMALE', 'MALE'];
  const FOUNDER_RESERVES = { glucose: 0.6, glycogen: 0.6, fat: 0.5, protein: 0.6, water: 0.8 };
  const WANDERER_RESERVES = { glucose: 0.5, glycogen: 0.4, fat: 0.35, protein: 0.45, water: 0.7 };

  class World {
    constructor({ map = Evo.DEFAULT_MAP } = {}) {
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
      this.hand = { holding: null };   // What the player's hand carries: { creature } or { item }
      // World writes the bodies make while they run (scent they give off, eggs laid), applied once
      // every body has run, so all bodies read the same world (see step)
      this.pendingScent = [];          // { x, y, channel, amount }
      this.pendingEggs = [];           // { mother, pregnancy }

      // The landscape (Evo.buildLandscape): the size, the terrain, the features and platforms, where
      // founders appear and where the ball starts. Built before anyone is founded, as it draws at random
      const land = Evo.buildLandscape(map);
      const { width, height } = land;
      this.width = width;
      this.height = height;
      this.edge = land.edge;   // Creatures and items stay this far from the world's ends, so they never reach the cliffs (edge >= terrain.cliffs.width)
      this.terrain = land.terrain;
      this.features = land.features;
      this.platforms = land.platforms;
      this.ballX = land.ballX;
      this.spawnX = land.spawnX;
      this.scent = {
        cols: Math.ceil(width / SCENT_CELL), rows: Math.ceil(height / SCENT_CELL), cell: SCENT_CELL,
        channels: SCENTS.map(() => new Float32Array(Math.ceil(width / SCENT_CELL) * Math.ceil(height / SCENT_CELL)))
      };
      // Per channel, the rows and columns holding every non-zero cell ({ r0, r1, c0, c1 }, or null
      // when the channel is all zero), so diffusion sweeps only where there is scent. Write scent
      // only through depositScent, which grows the box
      this.scentBox = SCENTS.map(() => null);
      this.scentScratch = new Float32Array(this.scent.cols * this.scent.rows);
      this.scentSolid = new Uint8Array(this.scent.cols * this.scent.rows);
      for (let r = 0; r < this.scent.rows; r++) {
        for (let c = 0; c < this.scent.cols; c++) {
          // A cell is solid when its centre is more than half a cell below the surface
          if ((r + 0.5) * SCENT_CELL > this.terrain.groundY((c + 0.5) * SCENT_CELL) + SCENT_CELL * 0.5) this.scentSolid[r * this.scent.cols + c] = 1;
        }
      }
      this.updateClock();
      this.found();
      this.seedFood();
    }

    // ---------- Landscape ----------
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
      c.sunElevation = Math.sin((c.phase - 0.25) * TAU);
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
        if (f.kind === 'rock' && Math.abs(x - f.x) < f.width * 0.8 && y > f.y - f.height - 40) t += 0.04 + f.warm * 0.14; // Stored sun
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
      const s = this.scent, g = s.channels[channel], i = this.scentIndex(x, y);
      if (this.scentSolid[i]) return;
      g[i] = Math.min(2.5, g[i] + amount);
      if (g[i] === 0) return;
      const r = Math.floor(i / s.cols), c = i - r * s.cols, box = this.scentBox[channel];
      if (!box) { this.scentBox[channel] = { r0: r, r1: r, c0: c, c1: c }; return; }
      if (r < box.r0) box.r0 = r; else if (r > box.r1) box.r1 = r;
      if (c < box.c0) box.c0 = c; else if (c > box.c1) box.c1 = c;
    }

    // Scent a body gives off: it lands when the bodies' writes are applied
    queueScent(x, y, channel, amount) {
      this.pendingScent.push({ x, y, channel, amount });
    }

    // Bilinear sample of the air; a cell's centre is at (k + 0.5) * cell. Solid cells hold no scent and
    // carry no weight: the other cells' weights are renormalised to sum to 1, so the ground never pulls
    // a nose's reading toward 0 (a slope would make a false gradient), and all four solid reads 0.
    sampleScent(x, y, channel) {
      const s = this.scent, g = s.channels[channel], solid = this.scentSolid;
      const gx = clamp(x / s.cell - 0.5, 0, s.cols - 1), gy = clamp(y / s.cell - 0.5, 0, s.rows - 1);
      const c0 = Math.floor(gx), r0 = Math.floor(gy);
      const c1 = Math.min(s.cols - 1, c0 + 1), r1 = Math.min(s.rows - 1, r0 + 1);
      const fx = gx - c0, fy = gy - r0;
      const a = r0 * s.cols + c0, b = r0 * s.cols + c1, c = r1 * s.cols + c0, d = r1 * s.cols + c1;
      const wa = solid[a] ? 0 : (1 - fx) * (1 - fy), wb = solid[b] ? 0 : fx * (1 - fy);
      const wc = solid[c] ? 0 : (1 - fx) * fy, wd = solid[d] ? 0 : fx * fy;
      const w = wa + wb + wc + wd;
      return w > 0 ? (g[a] * wa + g[b] * wb + g[c] * wc + g[d] * wd) / w : 0;
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
        vx: 0, vy: 0, radius: def.radius, rot: Evo.random() * TAU,
        age: 0, heldBy: null, onGround: false, ...props
      };
      this.items.push(item);
      return item;
    }

    // The player drops an item from a height (it falls to the ground), or plants a thorn bush
    dropItem(type, x, y) {
      if (type === 'thorn') return this.addThornbush(x);
      const props = type === 'ball' ? { hue: Evo.randInt(360) } : {};
      const at = this.placeAbove(x, y);
      return this.spawnItem(type, at.x, at.y, props);
    }

    // Where a thing released at (x, y) starts falling: kept off the cliffs, and just above the surface below it
    placeAbove(x, y) {
      x = this.clampX(x);
      return { x, y: Math.min(y, this.surfaceBelow(x, y) - 1) };
    }

    // x kept this far from the world's ends
    clampX(x) {
      return clamp(x, this.edge, this.width - this.edge);
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
      if (!item.heldBy || item.heldBy === 'hand') return;
      const c = this.creatureById(item.heldBy);
      if (c && c.carrying === item) c.carrying = null;
      item.heldBy = null;
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
      if (item.heldBy) return;
      item.heldBy = creature.id;
      creature.carrying = item;
      creature.stimulate('grabbed');
      if (item.type === 'ball') creature.stimulate('played');
      this.events.emit('grab', { creature, item });
    }

    dropCarried(creature) {
      const item = creature.carrying;
      if (!item) return;
      this.detachFromCarrier(item);
      creature.carrying = null;
      item.vx = creature.vx + creature.facing * 0.6;
      item.vy = -0.5;
      creature.stimulate('dropped');
    }

    // ---------- Sound ----------
    makeSound(creature) {
      const T = creature.traits;
      const baby = creature.stage <= STAGE.CHILD;
      this.sounds.push({ x: creature.headX, y: creature.headY, pitch: Math.min(1, T.voicePitch + (baby ? 0.3 : 0)), loudness: T.voiceLoudness, age: 0, sourceId: creature.id });
      creature.stimulate('called');
      this.events.emit('call', { creature });
    }

    // ---------- Creatures ----------
    addCreature(genome, x, opts) {
      const c = new Evo.Creature(genome, x, this.terrain.groundY(x), opts);
      this.creatures.push(c);
      this.history.push({ id: c.id, name: c.name, sex: c.sex, generation: c.generation, born: this.clock.tick, died: null, cause: null, motherId: c.motherId, fatherId: c.fatherId });
      return c;
    }

    // A grown adult arriving (founders, wanderers, or added by the player)
    addAdult(sex, { genome = null, x = null, reserves = FOUNDER_RESERVES, generation = 1 } = {}) {
      if (this.creatures.length >= LIMITS.MAX_POPULATION) return null;
      genome = genome || Evo.Genome.founder(sex);
      genome.sexChrom = Evo.chromFor(sex);
      const lifespan = genome.develop().lifespanTicks;
      const px = x === null ? this.spawnX() : x;
      return this.addCreature(genome, px, { generation, reserves, growth: 1, ageTicks: Math.floor(lifespan * Evo.randRange(ADULT_ARRIVAL_AGE[0], ADULT_ARRIVAL_AGE[1])) });
    }

    // An adult descended from a random banked genome (or a fresh founder if the bank is empty); fromEdge
    // has it walk in at one end of the world (the side is drawn after the genome)
    addFromBank(sex, fromEdge = false) {
      const src = this.seedBank.length ? Evo.pick(this.seedBank) : null;
      return this.addAdult(sex, {
        genome: src ? src.genome.cloneWithMutation() : null, generation: src ? src.generation : 1,
        reserves: WANDERER_RESERVES, x: fromEdge ? (Evo.chance(0.5) ? this.edge + 30 : this.width - this.edge - 30) : null
      });
    }

    found() {
      const fromBank = this.seedBank.length > 0;
      for (const sex of FOUNDERS) {
        if (fromBank) this.addFromBank(sex);
        else this.addAdult(sex);
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
      const adults = Evo.util.countBy(this.creatures.filter(c => c.isMature), c => c.sex);
      const females = adults.FEMALE || 0, males = adults.MALE || 0;
      const sex = females < 2 ? 'FEMALE' : males < 2 ? 'MALE' : null;
      if (!sex) return;
      const c = this.addFromBank(sex, true);
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
          if (Math.abs(m.x - f.x) > (m.size + f.size) * MATING.reach || Math.abs(m.y - f.y) > MATING.vertical) continue;
          if (!Evo.chance(MATING.chance)) continue;
          f.pregnancy = { genome: Evo.Genome.recombine(f.genome, m.genome), fatherId: m.id, generation: Math.max(f.generation, m.generation) + 1,
            parents: [f, m], progress: 0, reserves: Object.fromEntries(Object.keys(Evo.EGG_CONTENTS).map(k => [k, 0])) };
          f.stim.mated = 1; m.stim.mated = 1;
          f.stimulate('mated'); m.stimulate('mated');
          f.mateCooldown = m.mateCooldown = MATING.cooldown;
          f.timesMated++; m.timesMated++;
          m.chem.add('protein', -MATING.maleProtein);
          this.bankGenome(f); this.bankGenome(m);
          this.stats.matings++;
          this.events.emit('mate', { mother: f, father: m });
          break;
        }
      }
    }

    // A mother ready to lay: the egg appears when the bodies' writes are applied
    queueEgg(mother, pregnancy) {
      this.pendingEggs.push({ mother, pregnancy });
    }

    // Apply the queued writes in the order the bodies made them (egg laying draws random numbers)
    applyQueuedWrites() {
      for (const s of this.pendingScent) this.depositScent(s.x, s.y, s.channel, s.amount);
      for (const e of this.pendingEggs) this.layEgg(e.mother, e.pregnancy);
      this.pendingScent.length = 0;
      this.pendingEggs.length = 0;
    }

    layEgg(mother, pregnancy) {
      this.spawnEgg(pregnancy.genome, mother.x - mother.facing * mother.size * 0.4, mother.y, {
        reserves: pregnancy.reserves, parents: pregnancy.parents.map(p => ({ id: p.id, syllables: p.syllables })), generation: pregnancy.generation
      });
      this.stats.eggsLaid++;
      this.events.emit('egg', { mother });
    }

    // A founder egg placed by the player: a fresh genome, provisioned as a mother would
    addEgg(x, y, { sex = Evo.chance(0.5) ? 'FEMALE' : 'MALE', genome = null } = {}) {
      genome = genome || Evo.Genome.founder(sex);
      const at = this.placeAbove(x, y);
      return this.spawnEgg(genome, at.x, at.y, { parents: null, generation: 1 });
    }

    // An egg item holding a genome, developed here for its looks and incubation time. Without
    // reserves, it is filled as its own genome's Reproduction gene would have a mother fill it
    spawnEgg(genome, x, y, { reserves = null, parents, generation }) {
      const traits = genome.develop();
      if (!reserves) {
        const share = Evo.eggShare(traits);
        reserves = Object.fromEntries(Object.entries(Evo.EGG_CONTENTS).map(([k, v]) => [k, v * share]));
      }
      return this.spawnItem('egg', x, y, {
        genome, reserves, parents, generation,
        hue: traits.hue, accentHue: traits.accentHue, progress: 0, incubationTicks: traits.incubationTicks
      });
    }

    // Eggs incubate faster when warm, stall when cold, and hatch into babies. Returns true when the
    // egg is ready to hatch (the caller hatches it once it is no longer iterating the items).
    incubate(egg) {
      const t = this.temperatureAt(egg.x, egg.y - 5);
      egg.progress += clamp((t - INCUBATION.cold) / INCUBATION.span, 0, INCUBATION.max) / egg.incubationTicks;
      return egg.progress >= 1;
    }

    hatch(egg) {
      if (this.creatures.length >= LIMITS.MAX_POPULATION || egg.heldBy) return;
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
      from.stimulate('nuzzled'); to.stimulate('wasNuzzled');
      this.events.emit('nuzzle', { from, to });
    }

    // A shove pushes the other creature away, and hurts a little
    shove(from, to) {
      to.stim.impact = Math.max(to.stim.impact, 0.4);
      to.stim.flinch = 1;
      to.vx += from.facing * 2.5;
      to.vy = Math.min(to.vy, -1.5);
      to.onGround = false;
      from.stimulate('shoved'); to.stimulate('wasShoved');
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

    // Take a dead creature out of the world: it lets go of what it carried and leaves carrion
    handleDeath(c) {
      if (c.carrying) this.dropCarried(c);
      this.creatures.splice(this.creatures.indexOf(c), 1);
      this.stats.deaths[c.causeOfDeath] = (this.stats.deaths[c.causeOfDeath] || 0) + 1;
      const rec = this.history.find(h => h.id === c.id);
      if (rec) { rec.died = this.clock.tick; rec.cause = c.causeOfDeath; }
      const ch = c.chem;
      const contents = { gutProtein: Math.min(CARRION.proteinCap, ch.get('protein') * CARRION.protein + CARRION.growth * c.growth), gutFat: ch.get('fat') * CARRION.fat, gutSugar: ch.get('glucose') * CARRION.sugar };
      this.spawnItem('carrion', c.x, c.y, { contents, hue: c.traits.hue });
      if (this.hand.holding && this.hand.holding.creature === c) this.hand.holding = null;
    }

    // ---------- Plants and animals that make food ----------
    growFood() {
      const s = this.seasonInfo, light = this.clock.light;
      const full = this.foodCount >= LIMITS.MAX_FOOD;
      for (const f of this.features) {
        if (f.kind === 'tree') {
          f.fruiting = clamp01(f.fruiting + s.grow[f.yields] * GROWTH.fruit.rate * light);
          if (!full && f.fruiting > GROWTH.fruit.threshold && Evo.chance(f.fruiting * GROWTH.fruit.chance)) {
            this.spawnItem(f.yields, f.x + Evo.randRange(-0.7, 0.7) * f.canopy, f.y - f.height + f.canopy * 0.5);
            f.fruiting -= GROWTH.fruit.cost;
          }
        } else if (f.kind === 'grass') {
          f.seeding = clamp01(f.seeding + s.grow.grain * GROWTH.grain.rate * light);
          if (!full && f.seeding > GROWTH.grain.threshold && Evo.chance(f.seeding * GROWTH.grain.chance)) {
            const x = f.x + Evo.randRange(-0.5, 0.5) * f.width;
            this.spawnItem('grain', x, this.terrain.groundY(x) - f.height);
            f.seeding -= GROWTH.grain.cost;
          }
          // Dew forms on the grass at dawn
          if (!full && this.clock.phase > GROWTH.dew.from && this.clock.phase < GROWTH.dew.to && Evo.chance(GROWTH.dew.chance * s.dew)) {
            const x = f.x + Evo.randRange(-0.5, 0.5) * f.width;
            this.spawnItem('dew', x, this.terrain.groundY(x) - 2);
          }
          if (!full && Evo.chance(GROWTH.bug * s.grow.bug)) this.spawnItem('bug', f.x + Evo.randRange(-0.5, 0.5) * f.width, f.y - 4);
        } else if (f.kind === 'log') {
          if (!full && Evo.chance(GROWTH.grub * s.grow.grub)) {
            const x = f.x + (Evo.chance(0.5) ? -1 : 1) * (f.length / 2 + Evo.randRange(0, 30));
            this.spawnItem('grub', x, this.terrain.groundY(x), { home: f.x });
          }
        } else if (f.kind === 'rock') {
          // The rock soaks up sunshine by day and gives it back at night
          f.warm = clamp01(f.warm + (light > ROCK.light ? ROCK.warm : -ROCK.cool));
        }
      }
    }

    seedFood() {
      for (const f of this.features) {
        if (f.kind === 'tree') for (let i = 0; i < 3; i++) this.spawnItem(f.yields, f.x + Evo.randRange(-1, 1) * f.canopy);
        if (f.kind === 'grass') for (let i = 0; i < 4; i++) this.spawnItem('grain', f.x + Evo.randRange(-0.5, 0.5) * f.width);
        if (f.kind === 'log') for (let i = 0; i < 2; i++) this.spawnItem('grub', f.x + (i ? 1 : -1) * (f.length / 2 + 10), undefined, { home: f.x });
      }
      this.spawnItem('ball', this.ballX, undefined, { hue: 200 });
    }

    // A creature pushing through a thornbush is pricked (at most every 30 ticks); what that feels
    // like is up to its stimulus genes
    prickCreatures() {
      for (const c of this.creatures) {
        if (c.prickCooldown > 0) { c.prickCooldown--; continue; }
        if (c.held || c.asleep || Math.abs(c.vx) < 0.2) continue;
        const bush = this.features.find(f => f.kind === 'thornbush' && Math.abs(c.x - f.x) < f.radius && c.y > f.y - f.radius * 1.2);
        if (bush) { c.prickCooldown = 30; c.stimulate('pricked'); }
      }
    }

    // ---------- Item physics ----------
    moveItems() {
      const hatching = [];
      for (const item of this.items) {
        const def = ITEM_TYPES[item.type];
        item.age++;
        // A held item moves with its holder: the hand (moveHand), or a carrier's mouth (Creature.settle)
        if (item.heldBy) continue;
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
        item.x = this.clampX(item.x + item.vx);
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
      this.items = this.items.filter(i => !ITEM_TYPES[i.type].ttl || i.age < ITEM_TYPES[i.type].ttl || i.heldBy);
    }

    // Odours rise from items and ponds (the creatures queue their own), spread through the air, and fade
    stepScent() {
      for (const item of this.items) {
        for (const [ch, rate] of ITEM_TYPES[item.type].odour) this.depositScent(item.x, item.y - item.radius, ch, rate);
      }
      for (const p of this.terrain.ponds) for (let x = p.x0; x < p.x1; x += POND_SCENT.spacing) this.depositScent(x, p.level - 10, Evo.SCENT.moist, POND_SCENT.amount);
      if (this.clock.tick % SCENT_EVERY) return;
      const s = this.scent;
      SCENTS.forEach((sc, ch) => {
        this.scentBox[ch] = Evo.diffuse(s.channels[ch], this.scentScratch, s.cols, s.rows,
          sc.diffusion * SCENT_EVERY, Math.pow(1 - sc.decay, SCENT_EVERY), 0.0005, this.scentSolid, this.scentBox[ch]);
      });
    }

    // ---------- The player's hand ----------
    pat(c) {
      c.stim.gentle = 1; c.stim.back = Math.max(c.stim.back, 0.6);
      c.stimulate('patted');
      this.events.emit('pat', { creature: c });
    }

    slap(c) {
      c.stim.impact = 1; c.stim.back = 1; c.stim.flinch = 1;
      c.injury = Math.min(1, c.injury + 0.01);
      c.stimulate('slapped');
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
        holding.item.heldBy = 'hand';
      }
      this.hand.holding = holding;
      this.moveHand(x, y);
    }

    moveHand(x, y) {
      const h = this.hand.holding;
      if (!h) return;
      if (h.creature) { h.creature.x = this.clampX(x); h.creature.y = y + h.creature.size * HOLD_GRIP; }
      if (h.item) { h.item.x = x; h.item.y = y + h.item.radius; }
    }

    releaseHand(vx, vy) {
      const h = this.hand.holding;
      if (!h) return;
      if (h.creature) { h.creature.held = false; h.creature.vx = clamp(vx, -8, 8); h.creature.vy = clamp(vy, -10, 10); h.creature.onGround = false; }
      if (h.item) { h.item.heldBy = null; h.item.vx = clamp(vx, -8, 8); h.item.vy = clamp(vy, -10, 10); }
      this.hand.holding = null;
    }

    // ---------- One tick ----------
    // A tick runs in phases. Each creature phase runs for every creature before the next phase
    // starts, so what a creature senses and how soon others feel its actions never depend on its
    // place in the array:
    //   time         the clock advances
    //   environment  food grows, items fall and drift (eggs hatch), scent diffuses
    //   contact      creatures register company, crowding and touch; thorn bushes prick
    //   body         age and stage, chemistry, physiology, sleep (a creature may die here); scent
    //                a body gives off and eggs it lays are queued, not written
    //   body commit  the queued scent and eggs land, in creature order; the dead leave carrion
    //   mind         senses, dreams, the brain's tick: everyone reads the same settled world
    //   act          muscles, mouth and hands: eating, grabbing, shoving, nuzzling, calling
    //   settle       movement (a carried item follows its carrier's mouth), then stimuli fade
    //   ecology      mating, sounds age, wanderers arrive, an empty world is founded again
    // Only physiology kills, so no creature dies after the body commit. A call made in act is
    // heard by everyone in the next two ticks' mind (see Creature.sense).
    step() {
      this.clock.tick++;
      this.updateClock();
      this.growFood();
      this.moveItems();
      this.stepScent();
      this.socialContact();
      this.prickCreatures();
      const all = [...this.creatures];
      for (const c of all) c.body(this);
      this.applyQueuedWrites();
      for (const c of all) if (c.dead) this.handleDeath(c);
      const living = all.filter(c => !c.dead);
      for (const c of living) c.mind(this);
      for (const c of living) c.act(this);
      for (const c of living) c.settle(this);
      this.tryMating();
      for (const s of this.sounds) s.age++;
      this.sounds = this.sounds.filter(s => s.age < SOUND_LIFE);
      if (this.clock.tick % WANDER_INTERVAL === 0) this.maybeWanderer();
      if (this.creatures.length === 0 && !this.items.some(i => i.type === 'egg')) this.found();
    }

    // ---------- Queries ----------
    creatureById(id) { return this.creatures.find(c => c.id === id) || null; }
  }

  Object.assign(Evo, { World, WORLD: { ADULT_ARRIVAL_AGE, HOLD_GRIP, SOUND_LIFE } });
})(globalThis.Evo);
