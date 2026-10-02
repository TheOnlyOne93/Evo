// A creature: its genes, its body (body.js: the chemistry and everything inside the skin) and its
// brain, living in the side-view world. The senses (senses.js) carry everything into the brain, and
// the muscles (muscles.js) everything out. The creature itself is the shell around them: its name
// and family, its life stages, where it is and how it moves, and the order of each tick.
//
// A tick is four phases, each run for every creature before the next (see World.step):
//   body    the body takes its readings, its chemistry steps, and its workings follow (energy,
//           water, heat, growth, healing, damage, sleep). The only phase where a creature dies.
//   mind    the senses turn the settled world and the body into neuron currents; the brain ticks
//   act     the muscles that fired act: legs, mouth, calls. What it does to things and to others
//           (a bite, a grab, a shove) is queued, and lands once every creature has acted
//   settle  the creature moves, a carried item follows the mouth, and what the skin felt fades
// A stimulus (stimulate) changes chemistry at once and is read by the next body phase.
// Geometry: x = centre, y = feet on the ground, facing ±1; `size` is the body length in px.
(function (Evo) {
  'use strict';
  const { STAGES, STAGE, MOTORS, STIMULUS } = Evo;
  const { LYING_ABOVE } = Evo.muscles;

  const GRAVITY = 0.28;
  const BUMP_COOLDOWN_TICKS = 30;   // A bump is felt as a stimulus at most this often
  const STEP_HEIGHT = 10;           // Highest ledge a creature can walk up without jumping
  const WALK_PHASE_PER_PX = 0.35;   // Walk cycle radians per px walked
  const { SIGHT_CELLS } = Evo.BRAIN_BODY_PLAN;
  const { MORPHOGENESIS_EVERY } = Evo.BRAIN;

  // Pronounceable names of two syllables; children mix syllables from their parents' names
  const SYLLABLES = ['ka', 'mi', 'ro', 'lu', 'sa', 'vi', 'no', 'pip', 'bo', 'ki', 'ar', 'el', 'ju', 'zo', 'fen', 'wy', 'dru', 'ta', 'po', 'lin', 'ose', 'mar', 'tuk', 'bel', 'ren', 'ani', 'qui', 'da'];
  const capital = s => s.charAt(0).toUpperCase() + s.slice(1);
  function makeSyllables(parents) {
    const pool = parents ? parents.flatMap(p => p.syllables) : [];
    const syl = () => (pool.length && Evo.chance(0.6) ? Evo.pick(pool) : Evo.pick(SYLLABLES));
    const syllables = [syl(), syl()];
    if (syllables[0] === syllables[1]) syllables[1] = Evo.pick(SYLLABLES);
    return syllables;
  }

  class Creature {
    // opts: { generation, parents: [mother, father] (a hatchling's are { id, syllables }), reserves: { glucose, ... }, ageTicks, growth,
    //   facing (1 or -1; chosen by chance if left out), syllables (the two syllables of its name; made from its parents' if left out) }
    constructor(genome, x, y, opts = {}) {
      this.id = Evo.nextId();
      this.syllables = opts.syllables || makeSyllables(opts.parents);
      this.name = capital(this.syllables.join(''));
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

      this.body = new Evo.Body(this.traits, {
        reserves: opts.reserves, growth: opts.growth !== undefined ? opts.growth : this.stage >= STAGE.YOUTH ? 1 : 0
      });
      // Built from the birth traits, so birth-only genes that switch on later have no effect even
      // in a creature that starts life grown
      this.brain = new Evo.Brain(birth);
      if (this.traits !== birth) this.growBrain(birth);

      // Physical state
      this.x = x; this.y = y; this.vx = 0; this.vy = 0;
      this.facing = opts.facing || (Evo.chance(0.5) ? 1 : -1);
      this.onGround = false;
      this.inWater = false;
      this.walkPhase = 0;
      this.dead = false;
      this.causeOfDeath = null;
      this.held = false;               // Carried by the player's hand
      this.carrying = null;            // An item held in the mouth
      this.timesMated = 0;
      this.lastStimulus = null;        // { key, strength, atAge }: the last thing that happened to it (the card shows it)
      this.meals = 0;
      this.recentStimuli = [];         // the last 8 { key, strength, atAge } (oldest first), for the observers; nothing in the sim reads it
      this.stimCount = 0;              // how many stimuli there have ever been (numbers the ring's entries)

      // What the muscles are doing
      this.mouthTimer = 0; this.drinkTimer = 0; this.runTimer = 0; this.restTimer = 0; this.callTimer = 0; this.jumpCooldown = 0;
      this.grabCooldown = 0; this.mateCooldown = 0; this.bumpCooldown = 0; this.prickCooldown = 0; this.lastMotors = new Uint8Array(MOTORS.length);
      this.muscle = new Float32Array(MOTORS.length); // Muscle activation: spike trains smoothed into force
      this.action = 'idle';

      this.companyCount = 0; this.company = 0; this.crowding = 0; this.exertion = 0;
      this.familiar = new Float32Array(Evo.VISION_FEATURES.length); // How used it is to each look (vision feature)
      this.novelty = 0;                // How new the thing in front of it looks (0..1)

      this.input = new Float32Array(this.brain.N);
      this.senses = null;              // The last sensory reading (for the UI)
      this.visionBuffer = new Float32Array(SIGHT_CELLS); // Sight cell signals (sightIndex order), reused each tick
    }

    // ---------- Geometry ----------
    get size() { return this.traits.adultSize * (0.42 + 0.58 * this.body.growth); }
    get radius() { return this.size * 0.4; }
    get centerY() { return this.y - this.size * 0.4; }
    get headX() { return this.x + this.facing * this.size * 0.38; }
    get headY() { return this.y - this.size * 0.62; }
    get mouthX() { return this.x + this.facing * (this.size * 0.55 + 2); }
    get mouthY() { return this.y - this.size * 0.45; }
    get sex() { return this.traits.sex; }
    get isMature() { return this.stage >= STAGE.ADOLESCENT; } // Adolescent or older: sexually mature
    get fertile() { return !this.dead && !this.body.asleep && this.isMature && this.stage <= STAGE.OLD && this.body.chem.effect('fertility') > 1; }
    // Read from the current traits, so a life-history gene that switches on later in life counts
    get lifespan() { return this.traits.lifespanTicks; }
    get lying() { return this.dead || this.body.asleep || this.restTimer > LYING_ABOVE; }

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

    // A new life stage: genes that switch on now join the body's chemistry, the brain grows any new
    // tracts, and the creature adopts the new traits
    enterStage(stage, world) {
      this.stage = stage;
      const before = this.traits;
      this.traits = this.genome.develop(stage);
      this.body.takeUp(this.traits, before);
      this.growBrain(before);
      world.events.emit('stage', { creature: this, stage });
    }

    // Something happened to the creature or it did something (a key of Evo.STIMULI): its stimulus
    // genes release their chemicals
    stimulate(key, s = 1) {
      this.lastStimulus = { key, strength: s, atAge: this.ageTicks };
      this.recentStimuli.push(this.lastStimulus);
      if (this.recentStimuli.length > 8) this.recentStimuli.shift();
      this.stimCount++;
      this.body.chem.stimulate(STIMULUS[key], s);
    }

    // While asleep the brain dreams: instinct genes and remembered surprises are replayed (see
    // Brain.sleepStep); an instinct's chemical goes into the body
    dreamStep() {
      this.brain.sleepStep(this.traits.instincts, this.body.chem);
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
    // settle (movement). World.step runs each phase for every creature before the next phase. A
    // creature that dies in its body phase skips the rest (World.step removes it)
    tickBody(world) {
      this.ageTicks++;
      // Stages only move forward: a later gene that lengthens the lifespan must not send the
      // creature back to an earlier stage (which would switch that gene off again)
      const stage = this.stageForAge();
      if (stage > this.stage) this.enterStage(stage, world);

      const cause = this.body.step(this, world);
      if (cause) this.die(cause, world);
    }

    mind(world) {
      const brain = this.brain;
      Evo.senses.sense(this, world);
      if (this.body.asleep) this.dreamStep();
      brain.tick(this.input, Evo.senses.fromBody(this));
      if (brain.tickCount % MORPHOGENESIS_EVERY === 0) brain.runMorphogenesis();
    }

    settle(world) {
      this.move(world);
      this.carryInMouth();
      this.body.fade();
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

    // The muscles that fired act (see muscles.js)
    act(world) {
      Evo.muscles.act(this, world);
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
          this.body.stim.impact = Math.max(this.body.stim.impact, hard);
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

    // Walking into a wall or ledge: felt on that side, and a 'bumped' stimulus at most every BUMP_COOLDOWN_TICKS
    bump(side) {
      this.body.stim[side] = 1;
      if (this.bumpCooldown === 0) { this.bumpCooldown = BUMP_COOLDOWN_TICKS; this.stimulate('bumped'); }
    }

    die(cause, world) {
      if (this.dead) return;
      this.dead = true;
      this.body.asleep = false;
      this.causeOfDeath = cause;
      // What it carried is let go when the world takes the body away (World.handleDeath)
      world.events.emit('death', { creature: this, cause });
    }

    // ---------- Read-outs for the UI ----------
    get mood() {
      const c = this.body.chem;
      if (this.dead) return 'dead';
      if (this.body.asleep) return 'asleep';
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
      return Evo.DRIVES.map(k => [k, this.body.chem.get(k)]).sort((a, b) => b[1] - a[1]).slice(0, n);
    }
  }

  Object.assign(Evo, { Creature, CREATURE: { GRAVITY, WALK_PHASE_PER_PX } });
})(globalThis.Evo);
