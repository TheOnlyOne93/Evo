// The terrarium: a pure simulation. It never touches the page or plays sounds; it announces
// what happened on world.events ('birth', 'death', 'eat', 'bite', 'migrant', 'season', 'hurt').
(function (Evo) {
  'use strict';
  const { clamp, wrapAngle, minBy } = Evo.util;
  const { SCENTS, SCENT, ITEM_TYPES, SEASONS, SEASON_LENGTH, RAYS, LIMITS } = Evo;

  // Continuous 2D scent diffusion: one planar grid per channel (see Evo.SCENTS for the channels)
  class ScentGrid {
    constructor(cols = 36, rows = 36) {
      this.cols = cols;
      this.rows = rows;
      this.channels = SCENTS.map(() => new Float32Array(cols * rows));
      this.scratch = new Float32Array(cols * rows);
    }
    // Cell k covers [k, k+1) * cellSize
    cellOf(x, y, W, H) {
      const c = clamp(Math.floor((x / W) * this.cols), 0, this.cols - 1);
      const r = clamp(Math.floor((y / H) * this.rows), 0, this.rows - 1);
      return r * this.cols + c;
    }
    deposit(x, y, W, H, ch, amount) {
      const g = this.channels[ch], i = this.cellOf(x, y, W, H);
      g[i] = Math.min(2.5, g[i] + amount);
    }
    // Bilinear sample; a cell's centre is at (k + 0.5) * cellSize (the same mapping as deposit)
    sample(x, y, W, H, ch) {
      const g = this.channels[ch], cols = this.cols;
      const gx = clamp((x / W) * cols - 0.5, 0, cols - 1);
      const gy = clamp((y / H) * this.rows - 0.5, 0, this.rows - 1);
      const c0 = Math.floor(gx), r0 = Math.floor(gy);
      const c1 = Math.min(cols - 1, c0 + 1), r1 = Math.min(this.rows - 1, r0 + 1);
      const fx = gx - c0, fy = gy - r0;
      const top = g[r0 * cols + c0] * (1 - fx) + g[r0 * cols + c1] * fx;
      const bot = g[r1 * cols + c0] * (1 - fx) + g[r1 * cols + c1] * fx;
      return top * (1 - fy) + bot * fy;
    }
    step() {
      SCENTS.forEach((s, ch) => Evo.diffuse(this.channels[ch], this.scratch, this.cols, this.rows, s.diffusion, 1 - s.decay, 0.001));
    }
  }

  const SEXES = ['FEMALE', 'MALE', 'FEMALE', 'MALE', 'FEMALE', 'MALE']; // Balanced founding group
  const chromFor = sex => (sex === 'FEMALE' ? 'X' : 'Y');

  class TerrariumWorld {
    constructor(width = 600, height = 600) {
      this.width = width;
      this.height = height;
      this.events = new Evo.EventBus();
      this.tick = 0;                 // World clock
      this.scentGrid = new ScentGrid(36, 36);
      this.organisms = [];
      this.focusedOrganism = null;
      this.items = [];
      this.regenTicks = 0;
      this.season = 'TEMPERATE';
      this.stats = {
        births: 0, meals: 0, poisonings: 0, migrants: 0, refoundings: 0, injuries: 0,
        deaths: { starvation: 0, dehydration: 0, 'old age': 0, injury: 0 }
      };
      // Persistent places: food grows from these, so there is something to learn about WHERE things are.
      // Positions are fractions of the arena so they survive resizing.
      this.sources = [];
      this.hazards = []; // Thorn bushes: they hurt on contact
      this.placeLandscape();
      // Genomes of organisms that successfully bred. Migrants and re-founders come from here, so
      // evolutionary progress survives population crashes (and only proven breeders get in).
      this.seedBank = [];

      this.seedPrimordialPopulation();
      this.seedEcosystem();
    }

    get environment() {
      return { waterLoss: SEASONS[this.season].waterLoss };
    }

    get isFull() {
      return this.organisms.length >= LIMITS.MAX_POPULATION;
    }

    placeLandscape() {
      const spots = [];
      const pick = () => {
        for (let tries = 0; tries < 40; tries++) {
          const p = [Evo.randRange(0.12, 0.88), Evo.randRange(0.12, 0.88)];
          if (spots.every(s => Math.hypot(s[0] - p[0], s[1] - p[1]) > 0.22)) { spots.push(p); return p; }
        }
        const p = [Evo.randRange(0.15, 0.85), Evo.randRange(0.15, 0.85)];
        spots.push(p);
        return p;
      };
      this.sources = [
        { kind: 'bush', yields: 'carb', pos: pick() },
        { kind: 'bush', yields: 'carb', pos: pick() },
        { kind: 'field', yields: 'starch', pos: pick() },
        { kind: 'field', yields: 'starch', pos: pick() },
        { kind: 'spring', yields: 'water', pos: pick() },
        { kind: 'log', yields: 'grub', pos: pick() }
      ];
      // Thorns grow beside one fruit bush and one grain field: the best food is guarded
      this.hazards = [this.sources[0], this.sources[2]].map(src => {
        const a = Evo.random() * Math.PI * 2;
        return { fx: src.pos[0] + Math.cos(a) * 0.07, fy: src.pos[1] + Math.sin(a) * 0.07, radius: 16 };
      });
      this.hazards.push({ fx: Evo.randRange(0.15, 0.85), fy: Evo.randRange(0.15, 0.85), radius: 16 });
    }

    hazardXY(h) {
      return [h.fx * this.width, h.fy * this.height];
    }

    // The arena changed size (e.g. rotating a phone): keep everything reachable
    resize(width, height) {
      this.width = width;
      this.height = height;
      for (const item of this.items) {
        item.x = clamp(item.x, 20, width - 20);
        item.y = clamp(item.y, 20, height - 20);
      }
      for (const org of this.organisms) {
        const m = org.currentRadius + 4;
        org.x = clamp(org.x, m, width - m);
        org.y = clamp(org.y, m, height - m);
      }
    }

    depositScent(x, y, channel, amount) {
      this.scentGrid.deposit(x, y, this.width, this.height, channel, amount);
    }

    // ---------- Populating ----------
    randomPoint(margin) {
      return [Evo.randRange(margin, this.width - margin), Evo.randRange(margin, this.height - margin)];
    }

    // Place a mature adult carrying `reserves`. Every way an adult enters the world goes through here.
    spawnAdult(genome, { generation = 1, lineage = 'Added', reserves = Evo.ADULT_RESERVES, extraAge = 0 } = {}) {
      const [x, y] = this.randomPoint(40);
      const org = new Evo.Organism(genome, x, y, generation, lineage, reserves);
      org.body.ageTicks = org.body.maturityTicks + extraAge;
      this.organisms.push(org);
      return org;
    }

    // A fresh adult with a founder genome, added by the player. Returns null when the world is full.
    addAdult(sex) {
      if (this.isFull) return null;
      const org = this.spawnAdult(new Evo.Genome(null, chromFor(sex)));
      this.events.emit('birth', { child: org, added: true });
      return org;
    }

    // A mutated copy of a proven breeder's genome, from the wider metapopulation
    spawnFromBank(sex) {
      if (!this.seedBank.length) return null;
      const src = Evo.pick(this.seedBank);
      const genome = src.genome.cloneWithMutation(0.02);
      genome.sexChrom = chromFor(sex);
      return this.spawnAdult(genome, { generation: src.generation, lineage: src.lineage });
    }

    addMigrant(sex) {
      if (this.isFull) return null;
      const org = this.spawnFromBank(sex);
      if (org) {
        this.stats.migrants++;
        this.events.emit('migrant', { org });
      }
      return org;
    }

    bankGenome(org) {
      this.seedBank.push({ genome: org.genome.clone(), generation: org.generation, lineage: org.lineage });
      if (this.seedBank.length > LIMITS.SEED_BANK) this.seedBank.shift();
    }

    seedPrimordialPopulation() {
      this.organisms = [];
      if (this.seedBank.length) {
        // Re-found from the seed bank rather than starting evolution over
        SEXES.forEach(sex => this.spawnFromBank(sex));
        this.stats.refoundings++;
      } else {
        // Balanced founders, mature, carrying founder reserves, at staggered ages so they don't
        // all die of old age together
        const baseGenome = new Evo.Genome();
        SEXES.forEach((sex, i) => {
          const genome = baseGenome.cloneWithMutation(0.04, false);
          genome.sexChrom = chromFor(sex);
          const org = this.spawnAdult(genome, { lineage: `Lineage-${String.fromCharCode(65 + i)}`, reserves: Evo.FOUNDER_RESERVES });
          org.body.ageTicks += Math.floor(Evo.random() * 0.4 * org.body.maxLifespanTicks);
        });
      }
      this.focusedOrganism = this.organisms[0] || null;
    }

    seedEcosystem() {
      this.items = [];
      ['carb', 'carb', 'carb', 'starch', 'starch', 'starch', 'water', 'water', 'water', 'grub', 'grub', 'bug', 'deceptive']
        .forEach(type => this.growItem(type));
    }

    // ---------- Items ----------
    // Place an item (or a thorn bush). Without coordinates it lands somewhere random.
    spawnItem(type, x = null, y = null, contents = null) {
      if (type === 'thorn') {
        if (x !== null) this.hazards.push({ fx: x / this.width, fy: y / this.height, radius: 16 });
        return;
      }
      const def = ITEM_TYPES[type];
      if (!def) return;
      if (x === null) [x, y] = this.randomPoint(32);
      this.items.push({
        id: Evo.nextId(),
        type, x, y,
        vx: def.mobile ? (Evo.random() - 0.5) * 0.8 : 0,
        vy: def.mobile ? (Evo.random() - 0.5) * 0.8 : 0,
        radius: def.radius,
        contents, // What a carcass still holds
        age: 0,
        pulse: Evo.random() * Math.PI * 2
      });
    }

    // Food mostly grows where its plant is; some scatters randomly. Mimic fruit grows among real fruit.
    growItem(type) {
      const want = type === 'deceptive' ? 'carb' : type;
      const homes = this.sources.filter(s => s.yields === want);
      if (homes.length && Evo.chance(0.8)) {
        const src = Evo.pick(homes);
        const a = Evo.random() * Math.PI * 2, d = Evo.random() * 42;
        this.spawnItem(type,
          clamp(src.pos[0] * this.width + Math.cos(a) * d, 24, this.width - 24),
          clamp(src.pos[1] * this.height + Math.sin(a) * d, 24, this.height - 24));
      } else {
        this.spawnItem(type);
      }
    }

    // What an item gives when eaten (carrion returns what the dead organism still held)
    nutrientsOf(item) {
      if (item.type === 'carrion') return item.contents;
      return ITEM_TYPES[item.type].nutrients;
    }

    // Remove everything edible (lures stay: they aren't food)
    clearFood() {
      this.items = this.items.filter(item => !this.nutrientsOf(item));
    }

    // ---------- Senses ----------
    // Which side of the body a nearby object touches, or null when it is out of reach
    touchSide(c, x, y, radius) {
      if (Math.hypot(x - c.x, y - c.y) >= c.currentRadius + radius + 6) return null;
      const rel = wrapAngle(Math.atan2(y - c.y, x - c.x) - c.angle);
      return Math.abs(rel) < 0.7 ? 'fwd' : rel > 0 ? 'right' : 'left';
    }

    sense(c) {
      const T = c.traits;
      const maxVisionDist = T.visionRange;
      const halfAperture = T.visionAperture;

      // Optics: a target's signal is its apparent (angular) size, which falls off as 1/distance,
      // weighted by where it sits in the ray's receptive field
      const inRay = (tx, ty, radius, rayAngle) => {
        const dx = tx - c.x, dy = ty - c.y;
        const dist = Math.hypot(dx, dy);
        if (dist > maxVisionDist) return null;
        const angleDiff = wrapAngle(Math.atan2(dy, dx) - rayAngle);
        if (Math.abs(angleDiff) >= halfAperture) return null;
        const apparentSize = Math.min(1.0, 1.8 * radius / Math.max(1, dist));
        return { dist, intensity: apparentSize * Math.max(0, Math.cos((angleDiff / halfAperture) * (Math.PI * 0.5))) };
      };

      const visionRays = RAYS.map(r => {
        const rayAngle = c.angle + r.angle;
        const ray = { carb: 0, starch: 0, water: 0, toxic: 0, pheromone: 0, hitDist: maxVisionDist }; // hitDist: drawn on the map
        const see = (hit, channel, strength) => {
          ray[channel] = Math.max(ray[channel], Math.min(1.0, hit.intensity * strength));
          ray.hitDist = Math.min(ray.hitDist, hit.dist);
        };

        for (const item of this.items) {
          const hit = inRay(item.x, item.y, item.radius, rayAngle);
          if (!hit) continue;
          const sight = ITEM_TYPES[item.type].sight;
          for (const ch in sight) see(hit, ch, sight[ch]);
        }
        // Thorn bushes look dangerous (toxic-coloured)
        for (const h of this.hazards) {
          const [hx, hy] = this.hazardXY(h);
          const hit = inRay(hx, hy, h.radius, rayAngle);
          if (hit) see(hit, 'toxic', 0.7);
        }
        // A mature opposite-sex organism in estrus is a visible courtship display
        for (const other of this.organisms) {
          if (other === c || other.body.isDead || other.sex === c.sex) continue;
          if (!other.body.isMature || other.body.libido <= 0.2) continue;
          const hit = inRay(other.x, other.y, other.currentRadius, rayAngle);
          if (hit) see(hit, 'pheromone', 1.0);
        }
        return ray;
      });

      // Bilateral olfaction: raw odor concentration at each antenna, the snout and the body core
      const antLen = c.antennaLength, spread = T.antennaSpread, r = c.currentRadius;
      const noses = [
        [c.x + Math.cos(c.angle - spread) * antLen, c.y + Math.sin(c.angle - spread) * antLen],
        [c.x + Math.cos(c.angle + spread) * antLen, c.y + Math.sin(c.angle + spread) * antLen],
        [c.x + Math.cos(c.angle) * (r + 6), c.y + Math.sin(c.angle) * (r + 6)],
        [c.x, c.y]
      ];
      // Each sex smells the other's pheromone; one receptor responds to both its volatile and trail forms
      const [pheroCh, trailCh] = c.sex === 'MALE' ? [SCENT.pheroF, SCENT.trailF] : [SCENT.pheroM, SCENT.trailM];
      const g = this.scentGrid, W = this.width, H = this.height;
      const scents = noses.map(([x, y]) => {
        const s = ch => g.sample(x, y, W, H, ch);
        return {
          carb: Math.min(1.0, s(SCENT.carb)),
          starch: Math.min(1.0, s(SCENT.starch)),
          water: Math.min(1.0, s(SCENT.water)),
          toxic: Math.min(1.0, s(SCENT.toxic)),
          pheromone: Math.min(1.0, s(pheroCh) + s(trailCh)),
          alarm: Math.min(1.0, s(SCENT.alarm))
        };
      });

      // Touch
      const touch = { fwd: 0, left: 0, right: 0 };
      for (const item of this.items) {
        const side = this.touchSide(c, item.x, item.y, item.radius);
        if (side) touch[side] = 1.0;
      }
      for (const h of this.hazards) {
        const [hx, hy] = this.hazardXY(h);
        const side = this.touchSide(c, hx, hy, h.radius);
        if (side) touch[side] = 1.0;
      }

      // Wall proximity is graded over the last 40px; shock fires only on an actual impact
      const wallGap = Math.min(c.x, this.width - c.x, c.y, this.height - c.y) - r;

      let tailTouch = 0;
      const tailTip = c.tailSegments[c.tailSegments.length - 1];
      for (const other of this.organisms) {
        if (other === c || other.body.isDead) continue;
        if (Math.hypot(other.x - tailTip.x, other.y - tailTip.y) < other.currentRadius + 4) { tailTouch = 1.0; break; }
      }

      return {
        visionRays,
        scents,
        bumpFwd: touch.fwd,
        bumpLeft: touch.left,
        bumpRight: touch.right,
        wallDist: clamp(1 - wallGap / 40, 0, 1),
        bumpShock: c.wallImpact ? 1.0 : 0.0,
        tailTouch,
        kineticSpeed: Math.min(1.0, Math.abs(c.speed) / 2.5)
      };
    }

    // ---------- Breeding ----------
    // Two parents pay their dowries into a new child. Every birth goes through here.
    // Returns the child, or null if the world is full or either parent is still a juvenile.
    breed(a, b) {
      if (this.isFull || a.sex === b.sex || !a.body.isMature || !b.body.isMature) return null;
      const female = a.sex === 'FEMALE' ? a : b;
      const male = female === a ? b : a;
      const reserves = Evo.BodySimulator.childReserves(female.body.deductParentalDowry(), male.body.deductParentalDowry());
      const child = new Evo.Organism(Evo.Genome.recombine(female.genome, male.genome),
        clamp((female.x + male.x) * 0.5 + (Evo.random() - 0.5) * 16, 20, this.width - 20),
        clamp((female.y + male.y) * 0.5 + (Evo.random() - 0.5) * 16, 20, this.height - 20),
        Math.max(female.generation, male.generation) + 1, female.lineage, reserves);
      this.organisms.push(child);
      this.stats.births++;
      this.bankGenome(female);
      this.bankGenome(male);
      this.events.emit('birth', { child, mother: female, father: male });
      return child;
    }

    // ---------- Time ----------
    nextSeason() {
      const names = Object.keys(SEASONS);
      this.setSeason(names[(names.indexOf(this.season) + 1) % names.length]);
    }

    setSeason(season) {
      this.season = season;
      this.events.emit('season', { season });
    }

    step() {
      this.tick++;
      if (this.tick % SEASON_LENGTH === 0) {
        // A new season, never the same one again
        this.setSeason(Evo.pick(Object.keys(SEASONS).filter(s => s !== this.season)));
      }

      // Items release odor into the diffusion grid, which then spreads and decays; perishables rot
      for (const item of this.items) {
        for (const [ch, rate] of ITEM_TYPES[item.type].scent) this.depositScent(item.x, item.y, ch, rate);
        item.age++;
      }
      this.items = this.items.filter(item => !ITEM_TYPES[item.type].ttl || item.age < ITEM_TYPES[item.type].ttl);
      this.scentGrid.step();
      this.moveLivePrey();

      for (let idx = this.organisms.length - 1; idx >= 0; idx--) {
        const org = this.organisms[idx];
        org.step(this);
        if (org.body.isDead) {
          this.handleDeath(org, idx);
          continue;
        }
        this.applyHazards(org);
        if (org.mouthOpen) this.feed(org);
        this.tryMating(org);
      }

      this.growFood();

      // Occasional migration keeps a small population from dying out for lack of a mate
      if (this.tick % 600 === 0 && !this.isFull) {
        const females = this.organisms.filter(o => o.sex === 'FEMALE').length;
        const males = this.organisms.length - females;
        if (females < 2) this.addMigrant('FEMALE');
        else if (males < 2) this.addMigrant('MALE');
      }

      // Re-found after total extinction
      if (this.organisms.length === 0) this.seedPrimordialPopulation();
    }

    // Live prey skitters away from nearby organisms
    moveLivePrey() {
      const m = 20;
      for (const item of this.items) {
        if (!ITEM_TYPES[item.type].mobile) continue;
        for (const org of this.organisms) {
          if (Math.hypot(org.x - item.x, org.y - item.y) < 70) {
            const a = Math.atan2(item.y - org.y, item.x - org.x);
            item.vx += Math.cos(a) * 0.3;
            item.vy += Math.sin(a) * 0.3;
          }
        }
        item.vx *= 0.92; item.vy *= 0.92;
        item.x += item.vx; item.y += item.vy;
        if (item.x < m || item.x > this.width - m) { item.x = clamp(item.x, m, this.width - m); item.vx *= -1; }
        if (item.y < m || item.y > this.height - m) { item.y = clamp(item.y, m, this.height - m); item.vy *= -1; }
      }
    }

    // Death: the body's remaining energy returns to the ground as carrion
    handleDeath(org, idx) {
      const cause = org.body.causeOfDeath;
      this.stats.deaths[cause] = (this.stats.deaths[cause] || 0) + 1;
      // Some of the body is lost to decay; the rest (including its own tissue) feeds scavengers
      const b = org.body;
      const contents = { carbs: b.carbs * 0.5, fats: b.fats * 0.6, protein: b.protein * 0.6 + 6, bulk: 20 };
      if (contents.carbs + contents.fats + contents.protein > 4) this.spawnItem('carrion', org.x, org.y, contents);
      this.organisms.splice(idx, 1);
      if (this.focusedOrganism === org) this.focusedOrganism = this.organisms[0] || null;
      this.events.emit('death', { org, cause });
    }

    // Thorns hurt: contact causes pain and injury
    applyHazards(org) {
      for (const h of this.hazards) {
        const [hx, hy] = this.hazardXY(h);
        if (Math.hypot(hx - org.x, hy - org.y) < org.currentRadius + h.radius - 4) {
          if (org.body.pain < 0.5) {
            this.stats.injuries++;
            this.events.emit('hurt', { org });
          }
          org.body.pain = 1.0;
          org.body.injury = Math.min(1.0, org.body.injury + 0.003);
        }
      }
    }

    // Feeding: an open mouth at an edible item eats it
    feed(org) {
      const reach = org.currentRadius + 4;
      const snoutX = org.x + Math.cos(org.angle) * reach;
      const snoutY = org.y + Math.sin(org.angle) * reach;
      for (let i = this.items.length - 1; i >= 0; i--) {
        const item = this.items[i];
        const nutrients = this.nutrientsOf(item);
        if (!nutrients) continue; // Lures aren't food
        if (Math.hypot(item.x - snoutX, item.y - snoutY) >= item.radius + org.traits.mouthRadius) continue;
        org.body.ingest(nutrients);
        if (nutrients.toxin) this.stats.poisonings++;
        else { this.stats.meals++; org.meals++; }
        this.items.splice(i, 1);
        this.events.emit('eat', { org, item, nutrients });
      }
    }

    // Sexual reproduction between touching, ready partners
    tryMating(org) {
      if (this.isFull || !org.body.canReproduce()) return;
      const partner = this.organisms.find(other => other !== org && other.sex !== org.sex && other.body.canReproduce() &&
        Math.hypot(org.x - other.x, org.y - other.y) < org.currentRadius + other.currentRadius + 22);
      if (partner) this.breed(org, partner);
    }

    // Primary productivity: growable food appears on a seasonal timer up to the carrying capacity
    growFood() {
      const season = SEASONS[this.season];
      if (++this.regenTicks < season.regenTicks) return;
      this.regenTicks = 0;
      if (this.items.filter(i => ITEM_TYPES[i.type].growable).length >= LIMITS.MAX_ITEMS) return;
      let roll = Evo.random();
      for (const [type, weight] of Object.entries(season.weights)) {
        roll -= weight;
        if (roll <= 0) { this.growItem(type); break; }
      }
    }

    // The nearest mature opposite-sex organism to `org`, or null
    nearestPartner(org) {
      return minBy(this.organisms.filter(o => o !== org && o.sex !== org.sex && o.body.isMature),
        o => Math.hypot(o.x - org.x, o.y - org.y));
    }
  }

  Object.assign(Evo, { TerrariumWorld, ScentGrid });
})(globalThis.Evo);
