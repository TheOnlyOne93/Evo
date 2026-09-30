// A creature: genome, biochemistry, brain and body, living in the side-view world.
//
// A tick is four phases, each run for every creature before the next (see World.step):
//   body    the body's state is read into loci; the biochemistry runs (emitters, reactions,
//           receptors); physiology follows the receptors (strength, growth, healing, damage, sleep,
//           fertility). The only phase where a creature dies.
//   mind    the senses turn the settled world into neuron currents; the brain ticks (once per tick)
//   act     the muscles that fired act: mouth, hands, calls
//   settle  the body moves, a carried item follows the mouth, and stimuli fade
// A stimulus (stimulate) changes chemistry at once and is read by the next body phase.
// Geometry: x = centre, y = feet on the ground, facing ±1; `size` is the body length in px.
(function (Evo) {
  'use strict';
  const { clamp, clamp01 } = Evo.util;
  const { BODY_LOCI, LOCUS, TARGET, STAGES, STAGE, SCENTS, MOTORS, N_LIMBIC, STIMULUS } = Evo;

  const GRAVITY = 0.28;
  const STEP_HEIGHT = 10;           // Highest ledge a creature can walk up without jumping
  const NEURAL_GAIN = 30;           // mV per unit of sense or receptor signal
  const SPIKE_COST = 1.2e-7;        // Glucose per spike: thinking costs energy
  const GROWTH_PROTEIN = 0.6;       // Body protein built into a body growing from newborn to adult
  const WALK_PHASE_PER_PX = 0.35;   // Walk cycle radians per px walked
  const CALL_TICKS = 40;            // A call lasts this long (callTimer counts down from it)
  const JUMP_COOLDOWN = 30;         // Ticks after a jump before the next
  const HIGH_BAND_SLOPE = 0.35;     // Sight: a thing rising more than this per px of distance (about 20 degrees) is in the high band
  const EGG_INVESTMENT_BASE = 0.6;  // An egg holds (this + eggInvestment) x EGG_CONTENTS
  const { sightIndex, smellIndex, hearingIndex, SIGHT_CELLS, HEARING_CELLS, SIDES, BANDS } = Evo.BRAIN_BODY_PLAN;
  const { MORPHOGENESIS_EVERY } = Evo.BRAIN;
  const MOTOR_INDEX = Object.fromEntries(MOTORS.map((m, i) => [m.key, i]));
  const ODOUR_COUNT = SCENTS.length;
  const FEATURE_KEYS = Evo.VISION_FEATURES.map(f => f.key);
  // Sight and smell respond logarithmically (Weber-Fechner): faint signals register, strong ones still read as stronger
  const logResponse = (x, K, norm) => Math.log1p(x / K) / norm;
  const LOOK_K = 0.005, LOOK_NORM = Math.log1p(1 / LOOK_K);
  const RECEPTOR_K = 0.02, RECEPTOR_NORM = Math.log1p(1 / RECEPTOR_K);
  // Timers that count down once a tick in act(). Not here: prickCooldown (World.prickCreatures) and heardCall (sense)
  const ACT_TIMERS = ['mouthTimer', 'drinkTimer', 'jumpCooldown', 'grabCooldown', 'mateCooldown', 'callTimer', 'runTimer', 'restTimer', 'bumpCooldown'];
  // Each taste: the food key it reads and how strongly
  const TASTE_FROM_FOOD = { sweet: ['gutSugar', 4], starch: ['gutStarch', 4], savory: ['gutProtein', 4], fat: ['gutFat', 4], bitter: ['toxin', 4], water: ['water', 6] };
  // Sight cell for each side, band and feature key (a lookup table built from sightIndex, for the hot loop)
  const SIGHT_CELL = {};
  for (const side of SIDES) {
    SIGHT_CELL[side] = {};
    for (const band of BANDS) SIGHT_CELL[side][band] = Object.fromEntries(Evo.VISION_FEATURES.map(f => [f.key, sightIndex(side, band, f.key)]));
  }
  const LEFT = [SIGHT_CELL.L], RIGHT = [SIGHT_CELL.R], BOTH_SIDES = [SIGHT_CELL.L, SIGHT_CELL.R];
  // Per-tick scales for the physiological receptor targets (chem.effect(target) × scale)
  const SCALE = { damage: 0.001, healing: 0.0002, growth: 0.00003, scentSex: 0.02, scentAlarm: 0.05 };
  // Physiology per tick. cost: glucose burned (basal x mass^0.75, shivering, muscle work); water: evaporation
  // and its rise with heat and panting; heat: body temperature exchange and heat sources; harm: what fails
  // the body, and how fast it recovers
  const BODY = {
    cost: { basal: 0.00003, sleepFactor: 0.7, shiver: 0.00003, work: 0.00006, massSize: 40 },
    water: { loss: 0.000012, heatOnset: 0.55, heatFactor: 2, pant: 0.00001 },
    heat: { wetInsulation: 0.3, exchange: 0.004, body: 0.3, work: 0.8, thermogenesis: 0.6, scale: 0.0006, huddle: 0.0005,
      baseLoss: 0.00025, pantCooling: 0.0003, display: 500 },
    heal: { protein: 0.3 },
    harm: { starvation: 0.0003, dehydration: 0.0003, thirstBelow: 0.05, cold: 0.0002, coldBelow: 0.12, heat: 0.0002, heatAbove: 0.88,
      injury: 0.001, injuryAt: 0.99, recovery: 0.00003, recoveryProtein: 0.15, logFade: 0.998 }
  };
  const FAMILIARITY_FADE = 0.9999;  // Per tick, what a creature has grown used to fades back
  const HABITUATION_SCALE = 20;     // Habituation gene x this = how fast looking at a thing makes it familiar
  const NOVELTY_GAIN_MID = 8;       // The Curiosity gene's mid value (genome: noveltyGain = 4 + v.novelty * 8, so 0.5 gives 8)
  const SIGHT_GAIN = 1.4;           // Sight drive relative to the other senses
  const POND_SIGHT_RADIUS = 30;     // A pond is seen as a blue blob of this radius
  const HEARING_FALLOFF = { x: 200, y: 400 }; // Distance (px) at which a call's loudness halves, sideways and vertically

  // Pronounceable names; children mix syllables from their parents' names
  const SYLLABLES = ['ka', 'mi', 'ro', 'lu', 'sa', 'vi', 'no', 'pip', 'bo', 'ki', 'ar', 'el', 'ju', 'zo', 'fen', 'wy', 'dru', 'ta', 'po', 'lin', 'ose', 'mar', 'tuk', 'bel', 'ren', 'ani', 'qui', 'da'];
  const capital = s => s.charAt(0).toUpperCase() + s.slice(1);
  function makeName(parents) {
    const pool = parents ? parents.flatMap(p => p.syllables) : [];
    const syl = () => (pool.length && Evo.chance(0.6) ? Evo.pick(pool) : Evo.pick(SYLLABLES));
    const syllables = [syl(), syl()];
    if (syllables[0] === syllables[1]) syllables[1] = Evo.pick(SYLLABLES);
    return { name: capital(syllables.join('')), syllables };
  }

  class Creature {
    // opts: { generation, parents: [mother, father], reserves: { glucose, ... }, ageTicks, growth }
    constructor(genome, x, y, opts = {}) {
      this.id = Evo.nextId();
      const n = makeName(opts.parents);
      this.name = n.name;
      this.syllables = n.syllables;
      this.genome = genome;
      this.generation = opts.generation || 1;
      this.motherId = opts.parents ? opts.parents[0].id : null;
      this.fatherId = opts.parents ? opts.parents[1].id : null;
      this.ageTicks = opts.ageTicks || 0;
      this.stage = STAGE.BABY;

      const birth = genome.develop(this.stage);
      this.traits = birth;
      this.stage = this.stageForAge();
      if (this.stage !== STAGE.BABY) this.traits = genome.develop(this.stage);

      this.chem = new Evo.Biochemistry();
      this.chem.configure(this.traits);
      this.chem.setInitial(this.traits);
      if (opts.reserves) for (const k in opts.reserves) this.chem.set(k, opts.reserves[k]);
      // Built from the birth traits, so birth-only genes that switch on later have no effect even
      // in a creature that starts life grown
      this.brain = new Evo.Brain(birth);
      if (this.traits !== birth) this.growBrain(birth);

      // Physical state
      this.x = x; this.y = y; this.vx = 0; this.vy = 0;
      this.facing = Evo.chance(0.5) ? 1 : -1;
      this.onGround = false;
      this.inWater = false;
      this.walkPhase = 0;
      this.growth = opts.growth !== undefined ? opts.growth : this.stage >= STAGE.YOUTH ? 1 : 0;
      this.health = 1;
      this.strength = 1;               // Muscle strength (set each tick by physiology)
      this.injury = 0;
      this.bodyTemp = 0.5;
      this.dead = false;
      this.causeOfDeath = null;
      this.held = false;               // Carried by the player's hand
      this.carrying = null;            // An item held in the mouth
      this.pregnancy = null;           // { genome, fatherId, generation, parents, progress, reserves }
      this.timesMated = 0;
      this.lastStimulus = null;        // { key, strength, age }: the last thing that happened to it (the card shows it)
      this.meals = 0;
      this.recentStimuli = [];         // the last 8 { key, strength, age } (oldest first), for the observers; nothing in the sim reads it
      this.stimCount = 0;              // how many stimuli there have ever been (numbers the ring's entries)

      // What the muscles are doing
      this.mouthTimer = 0; this.drinkTimer = 0; this.runTimer = 0; this.restTimer = 0; this.callTimer = 0; this.jumpCooldown = 0;
      this.grabCooldown = 0; this.mateCooldown = 0; this.bumpCooldown = 0; this.prickCooldown = 0; this.lastMotors = new Uint8Array(MOTORS.length);
      this.muscle = new Float32Array(MOTORS.length); // Muscle activation: spike trains smoothed into force
      this.asleep = false;
      this.action = 'idle';

      // Transient sensations, decaying each tick
      this.stim = { impact: 0, gentle: 0, back: 0, mated: 0, heardCall: 0, flinch: 0, contactL: 0, contactR: 0, touchingFriend: 0 };
      this.taste = { sweet: 0, starch: 0, savory: 0, fat: 0, bitter: 0, water: 0 };
      this.companyCount = 0; this.company = 0; this.crowding = 0; this.exertion = 0; this.heatGain = 0; this.heatLoss = 0;
      this.damageLog = {};             // Recent damage by cause (decaying), to name a cause of death
      this.familiar = new Float32Array(FEATURE_KEYS.length); // How used it is to each look (vision feature)
      this.novelty = 0;                // How new the thing in front of it looks (0..1)

      this.loci = new Float32Array(BODY_LOCI.length);
      this.input = new Float32Array(this.brain.N);
      this.senses = null;              // The last sensory reading (for the UI)
      this.visionBuffer = new Float32Array(SIGHT_CELLS); // Sight cell signals (sightIndex order), reused each tick
    }

    // ---------- Geometry ----------
    get size() { return this.traits.adultSize * (0.42 + 0.58 * this.growth); }
    get radius() { return this.size * 0.4; }
    get centerY() { return this.y - this.size * 0.4; }
    get headX() { return this.x + this.facing * this.size * 0.38; }
    get headY() { return this.y - this.size * 0.62; }
    get mouthX() { return this.x + this.facing * (this.size * 0.55 + 2); }
    get mouthY() { return this.y - this.size * 0.45; }
    get sex() { return this.traits.sex; }
    get isMature() { return this.stage >= STAGE.ADOLESCENT; } // Adolescent or older: sexually mature
    get fertile() { return !this.dead && !this.asleep && this.isMature && this.stage <= STAGE.OLD && this.chem.effect('fertility') > 1; }
    // Read from the current traits, so a life-history gene that switches on later in life counts
    get lifespan() { return this.traits.lifespanTicks; }
    get lying() { return this.dead || this.asleep || this.restTimer > 30; }

    stageForAge() {
      const f = this.ageTicks / this.lifespan;
      let s = STAGE.BABY;
      while (s < STAGES.length - 1 && f >= STAGES[s].until) s++;
      return s;
    }

    // The brain takes up the current traits: guidance genes and pacemakers new since `before` grow
    // (birth-only genes stay as they were when it was built)
    growBrain(before) {
      this.brain.traits = this.traits;
      this.brain.growTracts(this.traits.axonGuidance);
      const seen = new Set(before.pacemakers.map(p => p.gene));
      this.brain.applyPacemakers(this.traits.pacemakers.filter(p => !seen.has(p.gene)));
    }

    // A new life stage: genes that switch on now join the biochemistry, the brain grows any new
    // tracts, and the body adopts the new traits
    enterStage(stage, world) {
      this.stage = stage;
      const before = this.traits;
      this.traits = this.genome.develop(stage);
      this.chem.configure(this.traits);
      this.growBrain(before);
      world.events.emit('stage', { creature: this, stage });
    }

    // Something happened to the creature or it did something (a key of Evo.STIMULI): its stimulus
    // genes release their chemicals
    stimulate(key, s = 1) {
      this.lastStimulus = { key, strength: s, age: this.ageTicks };
      this.recentStimuli.push(this.lastStimulus);
      if (this.recentStimuli.length > 8) this.recentStimuli.shift();
      this.stimCount++;
      this.chem.stimulate(STIMULUS[key], s);
    }

    // ---------- Body loci: what emitter genes read ----------
    readLoci(world) {
      const L = this.loci, s = this.stim, t = this.taste, brain = this.brain;
      L[LOCUS.always] = 1;
      L[LOCUS.bodyTemp] = this.bodyTemp;
      L[LOCUS.heatGain] = this.heatGain;
      L[LOCUS.heatLoss] = this.heatLoss;
      L[LOCUS.darkness] = 1 - world.clock.light;
      L[LOCUS.exertion] = this.exertion;
      L[LOCUS.awake] = this.asleep ? 0 : 1;
      L[LOCUS.asleep] = this.asleep ? 1 : 0;
      L[LOCUS.resting] = (this.asleep || this.restTimer > 0) ? 1 : 0;
      L[LOCUS.injury] = this.injury;
      L[LOCUS.health] = this.health;
      L[LOCUS.impact] = s.impact;
      L[LOCUS.gentleTouch] = s.gentle;
      L[LOCUS.touchingFriend] = s.touchingFriend;
      L[LOCUS.company] = this.company;
      L[LOCUS.crowding] = this.crowding;
      L[LOCUS.novelty] = this.noticeNovelty(world);
      L[LOCUS.falling] = !this.onGround && this.vy > 2 ? Math.min(1, this.vy / 6) : 0;
      L[LOCUS.inWater] = this.inWater ? 1 : 0;
      L[LOCUS.held] = this.held ? 1 : 0;
      L[LOCUS.tasteSweet] = t.sweet; L[LOCUS.tasteStarch] = t.starch; L[LOCUS.tasteSavory] = t.savory;
      L[LOCUS.tasteFat] = t.fat; L[LOCUS.tasteBitter] = t.bitter; L[LOCUS.tasteWater] = t.water;
      const c = this.chem;
      L[LOCUS.gutFullness] = clamp01(c.get('gutSugar') + c.get('gutStarch') + c.get('gutProtein') + c.get('gutFat'));
      L[LOCUS.mated] = s.mated;
      L[LOCUS.pregnant] = this.pregnancy ? 1 : 0;
      L[LOCUS.heardCall] = s.heardCall;
      L[LOCUS.growth] = this.growth;
      L[LOCUS.starving] = c.get('glucose') < 0.01 && c.get('glycogen') < 0.01 ? 1 : 0;
      const feelings = brain.lobes.feelings;
      for (let k = 0; k < N_LIMBIC; k++) L[LOCUS.limbic0 + k] = Math.min(1, brain.rate[feelings[k]] * 5);
    }

    // Novelty comes from things: the thing at the mouth, or else the nearest item within 60 px, is
    // new in as far as its look is unfamiliar. Looking at it makes the look familiar (habituation);
    // familiarity fades slowly, so things become interesting again.
    noticeNovelty(world) {
      const fam = this.familiar, T = this.traits;
      for (let f = 0; f < fam.length; f++) fam[f] *= FAMILIARITY_FADE;
      const t = this.thingAtMouth(world);
      let look = null;
      if (t) look = t.kind === 'item' ? world.lookOf(t.item) : world.lookOfCreature(t.creature);
      else {
        let best = 60;
        for (const item of world.items) {
          if (item.heldBy) continue;
          const d = Math.hypot(item.x - this.x, item.y - this.y);
          if (d < best) { best = d; look = world.lookOf(item); }
        }
      }
      let nov = 0;
      if (look) {
        const h = T.habituationRate * HABITUATION_SCALE;
        for (let f = 0; f < fam.length; f++) {
          const v = look[FEATURE_KEYS[f]];
          if (!v) continue;
          nov += v * (1 - fam[f]);
          fam[f] += h * v * (1 - fam[f]);
        }
      }
      this.novelty = clamp01(nov * T.noveltyGain / NOVELTY_GAIN_MID);
      return this.novelty;
    }

    // ---------- Physiology ----------
    physiology(world) {
      const c = this.chem, T = this.traits;
      const muscle = clamp(1 + c.effect('muscle'), 0.1, 2);
      this.strength = muscle;

      // Running costs, paid from blood sugar: a basal rate (mass^0.75, Kleiber's law, taking mass
      // as (size / 40)^2 for a body seen side-on), shivering when cold, and the muscles in use
      const mass = (this.size / BODY.cost.massSize) ** 2;
      const basal = BODY.cost.basal * Math.pow(mass, 0.75) * (1 + c.effect('metabolism')) * (this.asleep ? BODY.cost.sleepFactor : 1);
      const shiver = BODY.cost.shiver * Math.max(0, c.effect('thermogenesis'));
      const work = BODY.cost.work * this.exertion;
      c.add('glucose', -(basal + shiver + work + SPIKE_COST * this.brain.spikesThisTick));

      // Water: evaporation rises with heat and effort, and panting costs more
      const ambient = world.temperatureAt(this.x, this.centerY);
      const pant = Math.max(0, c.effect('cooling'));
      c.add('water', -BODY.water.loss * (1 + BODY.water.heatFactor * Math.max(0, ambient - BODY.water.heatOnset)) * (1 + this.exertion) - BODY.water.pant * pant);

      // Temperature: exchange with the air through the fur, plus heat from the body's own work
      // and from huddling against others
      const insulation = this.inWater ? T.insulation * BODY.heat.wetInsulation : T.insulation; // Wet fur keeps little heat in
      const exchange = (ambient - this.bodyTemp) * (1 - insulation) * BODY.heat.exchange;
      const heat = (T.bodyHeat * BODY.heat.body + this.exertion * BODY.heat.work + Math.max(0, c.effect('thermogenesis')) * BODY.heat.thermogenesis) * BODY.heat.scale
        + this.stim.touchingFriend * BODY.heat.huddle - BODY.heat.baseLoss - pant * BODY.heat.pantCooling;
      const dT = exchange + heat;
      this.bodyTemp = clamp01(this.bodyTemp + dT);
      this.heatGain = clamp01(dT * BODY.heat.display);
      this.heatLoss = clamp01(-dT * BODY.heat.display);

      // Growth: growth hormone builds body protein into a bigger body
      if (this.growth < 1) {
        const g = Math.min(1 - this.growth, Math.max(0, c.effect('growth')) * SCALE.growth, c.get('protein') / GROWTH_PROTEIN);
        this.growth += g;
        c.add('protein', -g * GROWTH_PROTEIN);
      }
      // Healing: injury repaired with protein
      if (this.injury > 0) {
        const heal = Math.min(this.injury, Math.max(0, c.effect('healing')) * SCALE.healing);
        this.injury -= heal;
        c.add('protein', -heal * BODY.heal.protein);
      }

      // Damage: chemicals (via receptor genes), and failing supplies
      const hurt = (cause, amount) => {
        if (amount <= 0) return;
        this.health -= amount;
        this.damageLog[cause] = (this.damageLog[cause] || 0) + amount;
      };
      const chemDamage = Math.max(0, c.effect('damage')) * SCALE.damage;
      if (chemDamage > 0) hurt(c.damageCause() || 'illness', chemDamage);
      if (this.loci[LOCUS.starving]) hurt('starvation', BODY.harm.starvation);
      if (c.get('water') < BODY.harm.thirstBelow) hurt('dehydration', BODY.harm.dehydration);
      if (this.bodyTemp < BODY.harm.coldBelow) hurt('cold', BODY.harm.cold);
      if (this.bodyTemp > BODY.harm.heatAbove) hurt('heat', BODY.harm.heat);
      if (this.injury >= BODY.harm.injuryAt) hurt('injury', BODY.harm.injury);
      if (chemDamage === 0 && !this.loci[LOCUS.starving] && c.get('protein') > BODY.harm.recoveryProtein) this.health = Math.min(1, this.health + BODY.harm.recovery);
      for (const k in this.damageLog) this.damageLog[k] *= BODY.harm.logFade;
      if (this.health <= 0) {
        let cause = 'illness', worst = 0;
        for (const k in this.damageLog) if (this.damageLog[k] > worst) { worst = this.damageLog[k]; cause = k; }
        this.die(cause, world);
        return;
      }

      // Scents the body releases (receptor genes decide how much). Queued, like the egg below:
      // they reach the world once every body has run
      const sexScent = Math.max(0, c.effect('scentSex')) * SCALE.scentSex;
      if (sexScent > 0) world.queueScent(this.x, this.y - this.size * 0.3, this.sex === 'FEMALE' ? Evo.SCENT.muskF : Evo.SCENT.muskM, sexScent);
      const alarm = Math.max(0, c.effect('scentAlarm')) * SCALE.scentAlarm;
      if (alarm > 0) world.queueScent(this.x, this.y - this.size * 0.3, Evo.SCENT.alarm, alarm);

      // Pregnancy: the mother builds the egg from her own reserves over the gestation
      if (this.pregnancy) {
        const p = this.pregnancy;
        const share = 1 / T.gestationTicks;
        for (const [key, want] of Object.entries(Evo.EGG_CONTENTS)) {
          const take = Math.min(c.get(key) * 0.5, want * share * (EGG_INVESTMENT_BASE + T.eggInvestment));
          c.add(key, -take);
          p.reserves[key] += take;
        }
        p.progress += share;
        if (p.progress >= 1 && this.onGround) {
          world.queueEgg(this, p);
          this.pregnancy = null;
        }
      }
    }

    // ---------- Sleep ----------
    updateSleep(world) {
      const pressure = this.chem.effect('sleep');
      if (!this.asleep) {
        if ((pressure > 1.0 && this.restTimer > 0) || pressure > 2.0) this.fallAsleep(world);
      } else if (pressure < 0.25 || this.stim.impact > 0.3 || this.chem.get('pain') > 0.3 || (this.stim.heardCall > 0.8 && pressure < 1)) {
        this.wake(world);
      }
    }

    fallAsleep(world) {
      this.asleep = true;
      this.stimulate('fellAsleep');
      world.events.emit('sleep', { creature: this });
    }

    wake(world) {
      this.asleep = false;
      this.stimulate('woke');
      world.events.emit('wake', { creature: this });
    }

    // While asleep the brain dreams: instinct genes and remembered surprises are replayed (see
    // Brain.sleepStep); an instinct's chemical goes into the body
    dreamStep() {
      this.brain.sleepStep(this.traits.instincts, this.chem);
    }

    // ---------- Senses: the world becomes neuron currents ----------
    sense(world) {
      const brain = this.brain, T = this.traits, input = this.input;
      input.fill(0);
      const gainScale = this.asleep ? 0.15 : 1;
      const light = world.clock.light;
      const see = T.nightVision + (1 - T.nightVision) * light;

      // Sight: each thing in range excites the colour/motion cells of the side it is on, in the
      // low band (up to about 20 degrees above eye level) or the high band (steeper than that). Signal = apparent size.
      const ex = this.headX, ey = this.headY;
      const range = T.visionRange;
      const sight = this.visionBuffer;
      sight.fill(0);
      // Like smell, sight responds logarithmically to apparent size (radius / distance), so a
      // small fruit across a clearing still registers while a nearby creature doesn't swamp it
      const look = (tx, ty, radius, features) => {
        const dx = tx - ex, dy = ty - ey;
        const dist = Math.hypot(dx, dy);
        if (dist > range || dist < 1) return;
        const intensity = logResponse(Math.min(1, radius / Math.max(8, dist)), LOOK_K, LOOK_NORM) * see;
        const band = dy < -dist * HIGH_BAND_SLOPE ? 'high' : 'low';
        const sides = Math.abs(dx) < 3 ? BOTH_SIDES : dx < 0 ? LEFT : RIGHT;
        for (const f in features) {
          const v = intensity * features[f] / sides.length;
          for (const side of sides) {
            const k = side[band][f];
            if (v > sight[k]) sight[k] = v;
          }
        }
      };
      for (const item of world.items) {
        if (item.heldBy === this.id) continue;
        look(item.x, item.y - item.radius, item.radius, world.lookOf(item));
      }
      for (const other of world.creatures) {
        if (other !== this) look(other.x, other.centerY, other.size * 0.45, world.lookOfCreature(other));
      }
      for (const f of world.features) {
        const l = world.lookOfFeature(f);
        if (l) look(l.x, l.y, l.radius, l.features);
      }
      const pond = world.nearestWater(ex, range);
      if (pond) look(pond.x, pond.y, POND_SIGHT_RADIUS, { blue: 1 });
      const sightGain = NEURAL_GAIN * SIGHT_GAIN * T.opticGain * gainScale;
      const sightIdx = brain.lobes.sight;
      for (let k = 0; k < SIGHT_CELLS; k++) input[sightIdx[k]] = sight[k] * sightGain;

      // Smell: odour at each antenna tip (one reaching left, one right). Receptors respond
      // logarithmically (Weber-Fechner): faint traces register, stronger ones still read as stronger.
      const smellGain = NEURAL_GAIN * T.scentGain * gainScale;
      const smellIdx = brain.lobes.smell;
      const scentsL = [], scentsR = [];
      for (let o = 0; o < ODOUR_COUNT; o++) {
        const l = Math.min(1, world.sampleScent(ex - T.noseReach, ey, o));
        const r = Math.min(1, world.sampleScent(ex + T.noseReach, ey, o));
        scentsL.push(l); scentsR.push(r);
        input[smellIdx[smellIndex('L', o)]] = logResponse(l, RECEPTOR_K, RECEPTOR_NORM) * smellGain;
        input[smellIdx[smellIndex('R', o)]] = logResponse(r, RECEPTOR_K, RECEPTOR_NORM) * smellGain;
      }

      // Hearing: another's call, louder when near, on the side it came from. A call is made in the
      // act phase and ages at the end of the tick, so every listener hears it for two ticks (ages 1
      // and 2; a hearing cell still refractory from the first can't miss it), and the heardCall
      // stimulus fires once, at age 1. A caller doesn't hear itself.
      let heard = 0, heardNew = 0;
      const hear = new Array(HEARING_CELLS).fill(0);
      for (const snd of world.sounds) {
        if (snd.age < 1 || snd.age > 2 || snd.sourceId === this.id) continue;
        const dx = snd.x - this.x;
        const v = snd.loudness / (1 + Math.abs(dx) / HEARING_FALLOFF.x + Math.abs(snd.y - this.y) / HEARING_FALLOFF.y);
        const k = hearingIndex(dx < 0 ? 'L' : 'R', snd.pitch < 0.5 ? 'low' : 'high');
        hear[k] = Math.max(hear[k], v);
        heard = Math.max(heard, v);
        if (snd.age === 1) heardNew = Math.max(heardNew, v);
      }
      this.stim.heardCall = Math.max(this.stim.heardCall * 0.9, heard);
      if (heardNew > 0) this.stimulate('heardCall', heardNew);
      brain.lobes.hearing.forEach((i, k) => { input[i] = hear[k] * NEURAL_GAIN * gainScale; });

      // Touch
      const s = this.stim;
      const mouthThing = this.thingAtMouth(world);
      const touch = {
        contactL: Math.max(s.contactL, mouthThing && mouthThing.kind === 'creature' && this.facing < 0 ? 1 : 0),
        contactR: Math.max(s.contactR, mouthThing && mouthThing.kind === 'creature' && this.facing > 0 ? 1 : 0),
        // The mouth feels food and objects, the lips feel water; another creature at the mouth is
        // felt as a touch on that side
        mouthL: this.facing < 0 && mouthThing && mouthThing.kind === 'item' ? 1 : 0,
        mouthR: this.facing > 0 && mouthThing && mouthThing.kind === 'item' ? 1 : 0,
        lips: this.waterAtMouth(world) ? 1 : 0,
        back: s.back, feet: this.onGround ? 1 : 0, pain: Math.min(1, s.impact + this.chem.get('pain')),
        gentle: s.gentle, falling: this.loci[LOCUS.falling], inWater: this.inWater ? 1 : 0
      };
      Evo.BRAIN_BODY_PLAN.TOUCH.forEach((t, k) => {
        // Pain, impacts and pats get through even to a sleeper
        const g = (t.key === 'pain' || t.key === 'back') ? 1 : gainScale;
        input[brain.lobes.touch[k]] = touch[t.key] * NEURAL_GAIN * g;
      });
      Evo.BRAIN_BODY_PLAN.TASTES.forEach((t, k) => { input[brain.lobes.taste[k]] = this.taste[t.key] * NEURAL_GAIN; });
      // Up close: how the thing at the mouth looks (Up close cells are in vision feature order)
      const near = !mouthThing ? null : mouthThing.kind === 'item' ? world.lookOf(mouthThing.item) : world.lookOfCreature(mouthThing.creature);
      brain.lobes.near.forEach((i, k) => { input[i] = near ? (near[FEATURE_KEYS[k]] || 0) * NEURAL_GAIN * gainScale : 0; });

      // Needs and Feelings cells: driven by whichever chemicals receptor genes attached to them
      const fx = this.chem.effects;
      brain.lobes.needs.forEach((i, k) => { input[i] = fx[TARGET[`need:${k}`]] * NEURAL_GAIN; });
      brain.lobes.feelings.forEach((i, k) => { input[i] = fx[TARGET[`limbic:${k}`]] * NEURAL_GAIN; });

      this.senses = { sight, scentsL, scentsR, hear, touch, mouthThing };
    }

    // Water the lips can reach: in the water, it is at the chin (even facing the bank); on the bank
    // or wading, the head reaches forward and down, to a surface a little below the feet
    waterAtMouth(world) {
      if (this.inWater) return true;
      const level = world.terrain.waterLevelAt(this.mouthX);
      return level !== null && level > this.mouthY - this.traits.mouthReach - 2 && level < this.y + this.size * 0.4;
    }

    // What is in reach of the mouth: a carried item first, then an item in front (the head reaches
    // forward and down to the ground at its feet), or another creature
    thingAtMouth(world) {
      if (this.carrying) return { kind: 'item', item: this.carrying };
      const mx = this.mouthX, my = this.mouthY, reach = this.traits.mouthReach + 2;
      let best = null, bestD = Infinity;
      for (const item of world.items) {
        if (item.heldBy) continue;
        const d = Math.abs(item.x - mx) - item.radius, iy = item.y - item.radius;
        if (d < reach && d < bestD && iy > my - reach - item.radius && iy < this.y + 2) { bestD = d; best = { kind: 'item', item }; }
      }
      if (best) return best;
      for (const other of world.creatures) {
        if (other !== this && !other.held && Math.hypot(other.x - mx, other.centerY - my) < other.radius + reach) return { kind: 'creature', creature: other };
      }
      return null;
    }

    // ---------- One tick ----------
    // A tick runs in phases: body (chemistry and health), mind (senses and brain), act (muscles),
    // settle (movement). World.step runs each phase for every creature before the next phase;
    // step() runs one creature through all of them on its own (for tests and tools), applying the
    // world writes its body queued straight away. A creature that dies in its body phase skips the
    // rest (World.step removes it; here the caller does)
    step(world) {
      if (this.dead) return;
      this.body(world);
      world.applyQueuedWrites();
      if (this.dead) return;
      this.mind(world);
      this.act(world);
      this.settle(world);
    }

    body(world) {
      this.ageTicks++;
      // Stages only move forward: a later gene that lengthens the lifespan must not send the
      // creature back to an earlier stage (which would switch that gene off again)
      const stage = this.stageForAge();
      if (stage > this.stage) this.enterStage(stage, world);

      this.readLoci(world);
      this.chem.step(this.loci);
      this.physiology(world);
      if (this.dead) return;
      this.updateSleep(world);
    }

    mind(world) {
      this.sense(world);
      if (this.asleep) this.dreamStep();
      const brain = this.brain;
      // What the brain learns from is whatever receptor genes make its reward and punishment cells feel
      const fx = this.chem.effects;
      brain.outcome[0] = fx[TARGET['limbic:0']];
      brain.outcome[1] = fx[TARGET['limbic:1']];
      brain.tick(this.input, {
        noise: 0.35 + this.chem.get('toxin') * 12,
        arousal: this.chem.effect('arousal'),
        canFire: this.chem.get('glucose') > 0.0005,
        asleep: this.asleep
      });
      if (brain.tickCount % MORPHOGENESIS_EVERY === 0) brain.runMorphogenesis();
    }

    settle(world) {
      this.move(world);
      this.carryInMouth();
      this.decayStimuli();
    }

    // A carried item hangs from the mouth, wherever the body has just moved
    carryInMouth() {
      const item = this.carrying;
      if (!item) return;
      item.x = this.mouthX + this.facing * item.radius * 0.5;
      item.y = this.mouthY + item.radius;
      item.vx = this.vx;
      item.vy = 0;
    }

    // ---------- Muscles ----------
    act(world) {
      const brain = this.brain, T = this.traits;
      const m = this.lastMotors;
      for (let k = 0; k < MOTORS.length; k++) m[k] = brain.hist[brain.lobes.motor[k]] & 1;
      for (const timer of ACT_TIMERS) if (this[timer] > 0) this[timer]--;
      if (this.asleep || this.held) {
        this.exertion *= 0.95;
        this.muscle.fill(0);
        if (this.onGround) this.vx *= 0.8;
        this.action = this.asleep ? 'sleeping' : 'held';
        return;
      }

      const strength = this.strength;
      let effort = 0;
      // Muscles integrate their spike trains into a smooth force
      const muscle = this.muscle;
      for (let k = 0; k < muscle.length; k++) muscle[k] = muscle[k] * 0.88 + m[k] * 0.35;
      // Walking: the left and right walk muscles pull against each other; the stronger one wins
      const pull = muscle[MOTOR_INDEX.walkR] - muscle[MOTOR_INDEX.walkL];
      const push = Math.abs(pull) > 0.08 ? Math.sign(pull) : 0;
      if (m[MOTOR_INDEX.run]) this.runTimer = 20;
      const running = this.runTimer > 0;
      const maxSpeed = T.walkSpeed * (running ? T.runBoost : 1) * strength * (this.inWater ? 0.5 : 1) * (0.6 + 0.4 * this.growth);
      const target = push * Math.min(1, Math.abs(pull) * 2) * maxSpeed;
      if (push !== 0) {
        this.facing = push;
        if (Math.abs(pull) > 0.3) this.restTimer = 0;
        effort += Math.abs(target) / T.walkSpeed * (running ? 0.9 : 0.5);
      }
      if (this.onGround) this.vx += (target - this.vx) * 0.25;
      else this.vx += (target - this.vx) * 0.03;
      // Jumping
      if (m[MOTOR_INDEX.jump] && this.onGround && this.jumpCooldown === 0) {
        this.vy = -T.jumpPower * Math.sqrt(strength) * (0.7 + 0.3 * this.growth);
        this.onGround = false;
        this.jumpCooldown = JUMP_COOLDOWN;
        this.restTimer = 0;
        effort += 1;
      }
      // Eating: the mouth opens and works on whatever is there. Drinking: the lips take a sip.
      if (m[MOTOR_INDEX.eat]) {
        this.mouthTimer = 12;
        this.useMouth(world);
      }
      if (m[MOTOR_INDEX.drink] && this.waterAtMouth(world)) {
        this.drinkTimer = 12;
        this.ingest({ water: 0.05 });
        this.stimulate('drank');
        world.events.emit('drink', { creature: this });
      }
      // Grab or drop an item; with another creature at the mouth, a shove
      if (m[MOTOR_INDEX.grab] && this.grabCooldown === 0) {
        this.grabCooldown = 40;
        if (this.carrying) world.dropCarried(this);
        else {
          const t = this.thingAtMouth(world);
          if (t && t.kind === 'item' && !t.item.heldBy) world.pickUpItem(this, t.item);
          else if (t && t.kind === 'creature') world.shove(this, t.creature);
        }
      }
      // Resting: each spike of the rest muscle keeps the creature lying down for a while
      if (m[MOTOR_INDEX.rest] && push === 0) this.restTimer = 90; // move() brakes a resting body
      // Calling
      if (m[MOTOR_INDEX.call] && this.callTimer === 0) {
        this.callTimer = CALL_TICKS;
        world.makeSound(this);
      }
      this.exertion = this.exertion * 0.9 + Math.min(1, effort) * 0.1;
      this.action = this.drinkTimer > 0 ? 'drinking' : this.mouthTimer > 0 ? 'eating' : this.restTimer > 30 ? 'resting' : this.callTimer > 30 ? 'calling'
        : !this.onGround ? 'jumping' : Math.abs(this.vx) > 0.25 ? (running ? 'running' : 'walking') : 'idle';
    }

    useMouth(world) {
      const t = this.thingAtMouth(world);
      if (!t) return;
      if (t.kind === 'item') {
        const food = world.foodOf(t.item);
        if (food) {
          this.ingest(food);
          this.stimulate('ate');
          world.consumeItem(this, t.item, food);
        }
      } else if (t.kind === 'creature') {
        world.nuzzle(this, t.creature);
      }
    }

    // Food enters the gut; each nutrient is also tasted
    ingest(food) {
      const c = this.chem;
      for (const key in food) c.add(key, food[key]);
      for (const taste in TASTE_FROM_FOOD) {
        const [key, scale] = TASTE_FROM_FOOD[taste];
        this.taste[taste] = Math.min(1, this.taste[taste] + (food[key] || 0) * scale);
      }
    }

    // ---------- Physics ----------
    move(world) {
      if (this.held) { this.vx = 0; this.vy = 0; this.onGround = false; return; }
      const terrain = world.terrain;
      this.vy += GRAVITY;
      if (this.onGround && this.restTimer > 0) this.vx *= 0.6; // Resting: lying down brakes the body
      if (this.inWater) { this.vx *= 0.9; this.vy *= 0.85; }

      // Horizontal: a rise higher than a step blocks the way (jump to climb it)
      const wantX = this.x + this.vx;
      const nx = world.clampX(wantX);
      const groundHere = world.surfaceBelow(this.x, this.y - STEP_HEIGHT);
      const groundNext = world.surfaceBelow(nx, this.y - STEP_HEIGHT);
      if (this.onGround && groundNext < this.y - STEP_HEIGHT && groundNext < groundHere - 0.5) {
        this.vx = 0;
        this.bump(this.facing > 0 ? 'contactR' : 'contactL');
      } else {
        this.x = nx;
      }
      // The world's end is felt only when walking into it, not while standing beside it
      if (wantX !== nx && Math.abs(this.vx) > 0.05) this.bump(wantX < nx ? 'contactL' : 'contactR');

      // Vertical: land on the ground or a platform (one-way, from above)
      const prevY = this.y;
      this.y += this.vy;
      const floor = world.surfaceBelow(this.x, prevY - 1);
      if (this.y >= floor) {
        if (!this.onGround && this.vy > 7) { // A hard landing hurts
          const hard = Math.min(1, (this.vy - 7) / 5);
          this.stim.impact = Math.max(this.stim.impact, hard);
          this.stimulate('fell', hard);
        }
        this.y = floor;
        this.vy = 0;
        this.onGround = true;
      } else if (this.onGround && this.y > floor - STEP_HEIGHT && this.vy >= 0) {
        this.y = floor; // Walk down gentle slopes without floating off them
        this.vy = 0;
      } else {
        this.onGround = false;
      }
      // Water: deeper than half its body, a creature floats and paddles with its head up
      const level = terrain.waterLevelAt(this.x);
      this.inWater = level !== null && this.y > level + 2;
      const floatAt = level === null ? Infinity : level + this.size * 0.45;
      if (this.y > floatAt) {
        this.y = floatAt;
        if (this.vy > 0) this.vy = 0;
        this.onGround = true;
      }
      if (Math.abs(this.vx) > 0.05 && this.onGround) this.walkPhase += Math.abs(this.vx) * WALK_PHASE_PER_PX;
    }

    // Walking into a wall or ledge: felt on that side, and a 'bumped' stimulus at most every 30 ticks
    bump(side) {
      this.stim[side] = 1;
      if (this.bumpCooldown === 0) { this.bumpCooldown = 30; this.stimulate('bumped'); }
    }

    decayStimuli() {
      const s = this.stim;
      s.impact *= 0.8; s.gentle *= 0.95; s.back *= 0.85; s.mated *= 0.95; s.flinch *= 0.85;
      s.contactL *= 0.7; s.contactR *= 0.7; s.touchingFriend *= 0.9;
      for (const k in this.taste) this.taste[k] *= 0.93;
    }

    die(cause, world) {
      if (this.dead) return;
      this.dead = true;
      this.asleep = false;
      this.causeOfDeath = cause;
      // What it carried is let go when the world takes the body away (World.handleDeath)
      world.events.emit('death', { creature: this, cause });
    }

    // ---------- Read-outs for the UI ----------
    get mood() {
      const c = this.chem;
      if (this.dead) return 'dead';
      if (this.asleep) return 'asleep';
      const feelings = [
        ['in pain', c.get('pain')], ['afraid', c.get('fear')], ['angry', c.get('anger')], ['sick', c.get('nausea')],
        ['delighted', c.get('reward') * 2.5], ['upset', c.get('punishment') * 2.5]
      ];
      let best = 'calm', v = 0.25;
      for (const [word, level] of feelings) if (level > v) { v = level; best = word; }
      return best;
    }

    // The strongest drives right now, as [key, level]
    topDrives(n = 3) {
      return Evo.DRIVES.map(k => [k, this.chem.get(k)]).sort((a, b) => b[1] - a[1]).slice(0, n);
    }
  }

  // What a mother puts into an egg (and a hatchling starts with), in chemical units
  Evo.EGG_CONTENTS = { glucose: 0.35, glycogen: 0.3, fat: 0.25, protein: 0.45, water: 0.6 };
  Evo.EGG_INVESTMENT_BASE = EGG_INVESTMENT_BASE;

  Object.assign(Evo, { Creature, CREATURE: { GRAVITY, NEURAL_GAIN, WALK_PHASE_PER_PX, CALL_TICKS, JUMP_COOLDOWN } });
})(globalThis.Evo);
