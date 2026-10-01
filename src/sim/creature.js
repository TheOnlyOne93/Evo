// A creature: its genes, its body (body.js: the chemistry and everything inside the skin) and its
// brain, living in the side-view world. The creature itself is the shell around them: its name and
// family, its life stages, where it is and how it moves, and the order of each tick.
//
// A tick is four phases, each run for every creature before the next (see World.step):
//   body    the body takes its readings, its chemistry steps, and its workings follow (energy,
//           water, heat, growth, healing, damage, sleep). The only phase where a creature dies.
//   mind    the senses turn the settled world into neuron currents; the brain ticks (once per tick)
//   act     the muscles that fired act: mouth, hands, calls
//   settle  the creature moves, a carried item follows the mouth, and what the skin felt fades
// A stimulus (stimulate) changes chemistry at once and is read by the next body phase.
// Geometry: x = centre, y = feet on the ground, facing ±1; `size` is the body length in px.
(function (Evo) {
  'use strict';
  const { STAGES, STAGE, MOTORS, STIMULUS } = Evo;

  const GRAVITY = 0.28;
  const STEP_HEIGHT = 10;           // Highest ledge a creature can walk up without jumping
  const WALK_PHASE_PER_PX = 0.35;   // Walk cycle radians per px walked
  const CALL_TICKS = 40;            // A call lasts this long (callTimer counts down from it)
  const CALLING_ABOVE = CALL_TICKS - 10; // Its action reads 'calling' while callTimer is above this (the call's first 10 ticks)
  const REST_TICKS = 90;            // Each spike of the rest muscle keeps it resting this long (restTimer counts down from it)
  const LYING_ABOVE = 30;           // It lies down while restTimer is above this (the rest's first 60 ticks)
  const JUMP_COOLDOWN = 30;         // Ticks after a jump before the next
  const { SIGHT_CELLS } = Evo.BRAIN_BODY_PLAN;
  const { MORPHOGENESIS_EVERY } = Evo.BRAIN;
  const MOTOR_INDEX = Object.fromEntries(MOTORS.map((m, i) => [m.key, i]));
  // Timers that count down once a tick in act(). Not here: prickCooldown (World.prickCreatures) and heardCall (sense)
  const ACT_TIMERS = ['mouthTimer', 'drinkTimer', 'jumpCooldown', 'grabCooldown', 'mateCooldown', 'callTimer', 'runTimer', 'restTimer', 'bumpCooldown'];
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
      this.lastStimulus = null;        // { key, strength, age }: the last thing that happened to it (the card shows it)
      this.meals = 0;
      this.recentStimuli = [];         // the last 8 { key, strength, age } (oldest first), for the observers; nothing in the sim reads it
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
      this.lastStimulus = { key, strength: s, age: this.ageTicks };
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
    // settle (movement). World.step runs each phase for every creature before the next phase;
    // step() runs one creature through all of them on its own (for tests and tools), applying the
    // world writes its body queued straight away. A creature that dies in its body phase skips the
    // rest (World.step removes it; here the caller does)
    step(world) {
      if (this.dead) return;
      this.tickBody(world);
      world.applyQueuedWrites();
      if (this.dead) return;
      this.mind(world);
      this.act(world);
      this.settle(world);
    }

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

    // ---------- Muscles ----------
    act(world) {
      const brain = this.brain, T = this.traits;
      const m = this.lastMotors;
      for (let k = 0; k < MOTORS.length; k++) m[k] = brain.hist[brain.lobes.motor[k]] & 1;
      for (const timer of ACT_TIMERS) if (this[timer] > 0) this[timer]--;
      if (this.body.asleep || this.held) {
        this.exertion *= 0.95;
        this.muscle.fill(0);
        if (this.onGround) this.vx *= 0.8;
        this.action = this.body.asleep ? 'sleeping' : 'held';
        return;
      }

      const strength = this.body.strength;
      let effort = 0;
      // Muscles integrate their spike trains into a smooth force
      const muscle = this.muscle;
      for (let k = 0; k < muscle.length; k++) muscle[k] = muscle[k] * 0.88 + m[k] * 0.35;
      // Walking: the left and right walk muscles pull against each other; the stronger one wins
      const pull = muscle[MOTOR_INDEX.walkR] - muscle[MOTOR_INDEX.walkL];
      const push = Math.abs(pull) > 0.08 ? Math.sign(pull) : 0;
      if (m[MOTOR_INDEX.run]) this.runTimer = 20;
      const running = this.runTimer > 0;
      const maxSpeed = T.walkSpeed * (running ? T.runBoost : 1) * strength * (this.inWater ? 0.5 : 1) * (0.6 + 0.4 * this.body.growth);
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
        this.vy = -T.jumpPower * Math.sqrt(strength) * (0.7 + 0.3 * this.body.growth);
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
        this.body.ingest(Evo.BODY.sip);
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
      if (m[MOTOR_INDEX.rest] && push === 0) this.restTimer = REST_TICKS; // move() brakes a resting body
      // Calling
      if (m[MOTOR_INDEX.call] && this.callTimer === 0) {
        this.callTimer = CALL_TICKS;
        world.makeSound(this);
      }
      this.exertion = this.exertion * 0.9 + Math.min(1, effort) * 0.1;
      this.action = this.drinkTimer > 0 ? 'drinking' : this.mouthTimer > 0 ? 'eating' : this.restTimer > LYING_ABOVE ? 'resting' : this.callTimer > CALLING_ABOVE ? 'calling'
        : !this.onGround ? 'jumping' : Math.abs(this.vx) > 0.25 ? (running ? 'running' : 'walking') : 'idle';
    }

    useMouth(world) {
      const t = this.thingAtMouth(world);
      if (!t) return;
      if (t.kind === 'item') {
        const food = world.foodOf(t.item);
        if (food) {
          this.body.ingest(food);
          this.stimulate('ate');
          world.consumeItem(this, t.item, food);
        }
      } else if (t.kind === 'creature') {
        world.nuzzle(this, t.creature);
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

    // Walking into a wall or ledge: felt on that side, and a 'bumped' stimulus at most every 30 ticks
    bump(side) {
      this.body.stim[side] = 1;
      if (this.bumpCooldown === 0) { this.bumpCooldown = 30; this.stimulate('bumped'); }
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

  Object.assign(Evo, { Creature, CREATURE: { GRAVITY, WALK_PHASE_PER_PX, CALL_TICKS, LYING_ABOVE, JUMP_COOLDOWN } });
})(globalThis.Evo);
