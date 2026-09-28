// An organism: genome, body and brain, plus its physical state in the world.
(function (Evo) {
  'use strict';

  // What the muscles did this tick, in words. Uses the same rules as the physics in step(), so the
  // label always describes the movement that actually happened.
  function describeAction(a, drivingStraight) {
    if (a.caudalWhip) return a.reverse ? 'Recoil & Whip' : 'Tail Whip';
    if (a.groomRest) return 'Rest / Groom';
    if (a.biteIngest) return 'Mandible Grasp';
    if (a.burst && (drivingStraight || a.hopFwd)) return 'Fast Pursuit';
    if (a.reverse) return 'Retraction';
    if (drivingStraight) return 'Axial Forward';
    if (a.hopFwd) return a.thrustL ? 'Left-Arc Propulsion' : 'Right-Arc Propulsion';
    if (a.thrustL) return 'Steer Left';
    if (a.thrustR) return 'Steer Right';
    return 'Drift';
  }

  class Organism {
    constructor(genome, x, y, generation = 1, lineage = 'Proto-Alpha', reserves = Evo.FOUNDER_RESERVES) {
      this.id = Evo.nextId();
      this.generation = generation;
      this.lineage = lineage;
      this.genome = genome;
      this.traits = genome.develop();
      this.body = new Evo.BodySimulator(this.traits, reserves);
      this.brain = new Evo.NeuralBrain(this.body, this.traits);

      this.x = x;
      this.y = y;
      this.angle = Evo.random() * Math.PI * 2;
      this.speed = 0;
      this.angularSpeed = 0;
      this.mouthOpen = false;
      this.biteTimer = 0;
      this.currentAction = 'Drift';
      this.lastSenses = null;
      this.wallImpact = false;
      this.meals = 0;

      this.tailSegments = Array.from({ length: 4 }, () => ({ x, y }));
    }

    get sex() { return this.traits.sex; }

    // Swap in a new genome (e.g. an experimental mutation): traits, physiology and brain are rebuilt
    // from it; the body keeps its reserves and age.
    rebuild(genome) {
      this.genome = genome;
      this.traits = genome.develop();
      this.body.applyTraits(this.traits);
      this.brain = new Evo.NeuralBrain(this.body, this.traits);
    }

    // Newborns are 65% of adult size and grow only as they build protein into their bodies
    get currentRadius() {
      return this.traits.radius * (0.65 + Math.min(1.0, this.body.growth) * 0.35);
    }

    // Antennae grow with the body. Sensing and drawing both use this, so what you see is where it smells.
    get antennaLength() {
      return this.traits.antennaLength * (0.75 + 0.25 * Math.min(1.0, this.body.growth));
    }

    step(world) {
      if (this.body.isDead) return;
      const body = this.body;
      const T = this.traits;

      let localNeighbors = 0;
      for (const other of world.organisms) {
        if (other !== this && Math.hypot(other.x - this.x, other.y - this.y) < 95) localNeighbors++;
      }
      body.update(localNeighbors, world.environment);
      if (body.isDead) return;

      // Pheromones (volatile and trail forms): only mature specimens release mate signals
      if (body.isMature) {
        const S = Evo.SCENT;
        const female = this.sex === 'FEMALE';
        if (!female || body.libido > 0.25) {
          const rate = T.pheromoneEmissionRate * (female ? body.libido : 1.0);
          world.depositScent(this.x, this.y, female ? S.pheroF : S.pheroM, rate * (1 - T.trailFraction));
          world.depositScent(this.x, this.y, female ? S.trailF : S.trailM, rate * T.trailFraction * 0.5);
        }
      }

      // Distress (poison, pain, sudden need) releases an alarm pheromone others can smell
      if (body.stress > 0.3) world.depositScent(this.x, this.y, Evo.SCENT.alarm, 0.25 * body.stress);

      if (body.ageTicks % 80 === 0) this.brain.runMorphogenesis();

      const senses = world.sense(this);
      this.lastSenses = senses;
      const action = this.brain.tick(senses);

      // Muscles: every contraction is paid for from stamina; an exhausted body can't move
      if (this.biteTimer > 0) this.biteTimer--;
      this.angularSpeed *= 0.65;
      this.speed *= T.exoskeletonDrag;

      let speedFactor = T.speedMult;
      if (action.burst) speedFactor *= 1.0 + (T.burstFactor - 1.0) * body.exert(0.0008);
      // Both side muscles together, or the axial muscle alone, drive the body straight ahead
      const drivingStraight = (action.hopFwd && !action.thrustL && !action.thrustR) || (action.thrustL && action.thrustR);
      this.currentAction = describeAction(action, drivingStraight);

      if (drivingStraight) {
        this.speed += 0.84 * speedFactor * body.exert(0.0014);
        this.angularSpeed = 0.0;
      } else {
        if (action.thrustL) {
          const f = body.exert(0.0009);
          this.speed += 0.45 * speedFactor * f;
          this.angularSpeed -= T.turnAgility * f;
        }
        if (action.thrustR) {
          const f = body.exert(0.0009);
          this.speed += 0.45 * speedFactor * f;
          this.angularSpeed += T.turnAgility * f;
        }
        if (action.hopFwd) this.speed += 0.58 * speedFactor * body.exert(0.0011);
      }
      if (action.reverse) this.speed -= 0.45 * body.exert(0.0011);
      if (action.caudalWhip) {
        const f = body.exert(0.0014);
        // Flick away from whatever touched the body; with nothing touching, either direction
        const away = senses.bumpLeft - senses.bumpRight;
        const whipDir = away > 0 ? 0.14 : away < 0 ? -0.14 : (Evo.chance(0.5) ? 0.14 : -0.14);
        this.angularSpeed += whipDir * f;
        this.speed *= 1.0 - 0.45 * f;
      }
      if (action.biteIngest && body.exert(0.0005) > 0.5) {
        if (this.biteTimer === 0) world.events.emit('bite', { org: this });
        this.biteTimer = 14;
      }
      if (action.groomRest) {
        // Rest clears fatigue; relief from that is felt as joy through the drives
        this.speed *= 0.55;
        this.angularSpeed *= 0.55;
        body.adenosineDebt = Math.max(0, body.adenosineDebt - 0.004);
      }

      this.mouthOpen = this.biteTimer > 0;
      this.angle += this.angularSpeed;
      this.x += Math.cos(this.angle) * this.speed;
      this.y += Math.sin(this.angle) * this.speed;
      this.collideWithWalls(world);

      // Tail kinematics
      let prevX = this.x, prevY = this.y;
      for (const seg of this.tailSegments) {
        const dx = seg.x - prevX, dy = seg.y - prevY;
        const dist = Math.hypot(dx, dy) || 1;
        seg.x = prevX + (dx / dist) * 5.5;
        seg.y = prevY + (dy / dist) * 5.5;
        prevX = seg.x;
        prevY = seg.y;
      }
    }

    // Walls deflect the body: the heading reflects off the surface
    collideWithWalls(world) {
      const pad = this.currentRadius + 4;
      const impactSpeed = Math.abs(this.speed);
      const dir = this.speed >= 0 ? 1 : -1;
      const hx = Math.cos(this.angle) * dir, hy = Math.sin(this.angle) * dir;
      let hitWall = false, reflX = false, reflY = false;
      if (this.x < pad) { this.x = pad; hitWall = true; reflX = reflX || hx < 0; }
      if (this.x > world.width - pad) { this.x = world.width - pad; hitWall = true; reflX = reflX || hx > 0; }
      if (this.y < pad) { this.y = pad; hitWall = true; reflY = reflY || hy < 0; }
      if (this.y > world.height - pad) { this.y = world.height - pad; hitWall = true; reflY = reflY || hy > 0; }
      if (reflX) this.angle = Math.PI - this.angle;
      if (reflY) this.angle = -this.angle;
      if (reflX || reflY) {
        this.speed *= 0.4;
        this.angularSpeed = 0;
      }
      this.wallImpact = hitWall && impactSpeed > 0.3; // Felt by the shock mechanoreceptor
    }
  }

  Object.assign(Evo, { Organism, describeAction });
})(globalThis.Evo);
