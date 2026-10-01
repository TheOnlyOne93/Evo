// The body: everything inside the skin. It owns the chemistry and runs the body's own workings each
// tick: running costs, water, heat, growth, healing, damage, scent, building an egg, and sleep. Food
// comes in through the stomach (ingest), and the skin and tongue feel what touches them.
// It reads the creature it belongs to (where it is, how hard its muscles work, how much its brain
// fired) but writes only its own state; scent and eggs reach the world through the world's queues.
// Every number about the body is in one table, Evo.BODY.
(function (Evo) {
  'use strict';
  const { clamp, clamp01 } = Evo.util;
  const { BODY_LOCI, LOCUS, N_LIMBIC, TASTES } = Evo;

  const TASTE_KEYS = TASTES.map(t => t.key);
  const TASTE_LOCI = TASTES.map(t => LOCUS[t.locus]);
  const GUT = TASTES.filter(t => t.gut).map(t => t.food); // The chemicals in the gut, added up for how full it is

  const BODY = {
    // Running costs per tick, paid in ready energy (the founder's genes charge 20 of it from 1 of blood
    // sugar): a resting rate by mass (this share of it asleep), shivering, the muscles in use, each spike
    cost: { basal: 0.0006, sleepFactor: 0.7, shiver: 0.0006, work: 0.0012, massSize: 40, spike: 1.3e-5 },
    // Water: evaporation, its rise with heat and effort, and panting
    water: { loss: 0.000012, heatOnset: 0.55, heatFactor: 2, pant: 0.00001 },
    // Heat: exchange with the air through the fur, and the body's own heat sources
    heat: { wetInsulation: 0.3, exchange: 0.004, body: 0.3, work: 0.8, thermogenesis: 0.6, scale: 0.0006, huddle: 0.0005,
      baseLoss: 0.00025, pantCooling: 0.0003, display: 500 },
    heal: { protein: 0.3 },
    // What fails the body, and how fast it recovers
    harm: { starvation: 0.0003, dehydration: 0.0003, thirstBelow: 0.05, cold: 0.0002, coldBelow: 0.12, heat: 0.0002, heatAbove: 0.88,
      injury: 0.001, injuryAt: 0.99, recovery: 0.00003, recoveryProtein: 0.15, logFade: 0.998 },
    // Per-tick scales for the receptor targets that act on the body (chem.effect(target) × scale)
    scale: { damage: 0.001, healing: 0.0002, growth: 0.00003, scentSex: 0.02, scentAlarm: 0.05 },
    growthProtein: 0.6,   // Body protein built into a body growing from newborn to adult
    sip: { water: 0.05 }, // What one sip puts in
    matingProtein: 0.04,  // Body protein a male spends mating
    eggBase: 0.6,         // An egg holds (this + the Reproduction gene's eggInvestment) x EGG_CONTENTS
    // A dead body's food: gut protein (capped) from body protein and growth, fat and sugar from its stores
    carrion: { proteinCap: 0.5, protein: 0.6, growth: 0.1, fat: 0.5, sugar: 0.3 },
    // The stores a creature starts with when it arrives grown: the first pair, and a newcomer
    reserves: {
      founder: { glucose: 0.6, glycogen: 0.6, fat: 0.5, protein: 0.6, water: 0.8 },
      wanderer: { glucose: 0.5, glycogen: 0.4, fat: 0.35, protein: 0.45, water: 0.7 }
    }
  };
  // A standard egg's contents (what a hatchling starts with), in chemical units
  const EGG_CONTENTS = { glucose: 0.35, glycogen: 0.3, fat: 0.25, protein: 0.45, water: 0.6 };
  // How full a mother with these traits fills each egg, as a share of a standard egg
  const eggShare = traits => BODY.eggBase + traits.eggInvestment;

  class Body {
    // traits: the creature's developed genes. reserves: stores that override the starting levels
    // (an egg's contents, an arriving adult's). growth: how grown it is, 0 (newborn) to 1
    constructor(traits, { reserves = null, growth = 0 } = {}) {
      this.chem = new Evo.Biochemistry();
      this.chem.configure(traits);
      this.chem.setInitial(traits.initial);
      if (reserves) for (const k in reserves) this.chem.set(k, reserves[k]);
      this.growth = growth;
      this.health = 1;
      this.strength = 1;               // Muscle strength (set each tick)
      this.injury = 0;
      this.temperature = 0.5;
      this.heatGain = 0; this.heatLoss = 0;
      this.asleep = false;
      this.pregnancy = null;           // { genome, fatherId, generation, parents, progress, reserves }
      this.damageLog = {};             // Recent damage by cause (fading), to name a cause of death
      // What the skin and tongue feel, fading each tick
      this.stim = { impact: 0, gentle: 0, back: 0, mated: 0, heardCall: 0, flinch: 0, contactL: 0, contactR: 0, touchingFriend: 0 };
      this.taste = Object.fromEntries(TASTES.map(t => [t.key, 0]));
      this.loci = new Float32Array(BODY_LOCI.length); // The readings emitter genes can read
    }

    // A new life stage: genes that switch on now join the chemistry (an Initial concentration gene
    // sets its chemical, once)
    takeUp(traits, before) {
      this.chem.configure(traits);
      const had = new Set(before.initial.map(g => g.gene));
      this.chem.setInitial(traits.initial.filter(g => !had.has(g.gene)));
    }

    // One body phase: take the readings, step the chemistry, then the body's workings and sleep.
    // Returns the cause of death if it died, else null
    step(creature, world) {
      this.readings(creature, world);
      this.chem.step(this.loci);
      const cause = this.physiology(creature, world);
      if (cause) return cause;
      this.updateSleep(creature, world);
      return null;
    }

    // ---------- Readings: what emitter genes read ----------
    readings(creature, world) {
      const L = this.loci, s = this.stim, t = this.taste, brain = creature.brain;
      L[LOCUS.always] = 1;
      L[LOCUS.bodyTemp] = this.temperature;
      L[LOCUS.heatGain] = this.heatGain;
      L[LOCUS.heatLoss] = this.heatLoss;
      L[LOCUS.darkness] = 1 - world.clock.light;
      L[LOCUS.exertion] = creature.exertion;
      L[LOCUS.awake] = this.asleep ? 0 : 1;
      L[LOCUS.asleep] = this.asleep ? 1 : 0;
      L[LOCUS.resting] = (this.asleep || creature.restTimer > 0) ? 1 : 0;
      L[LOCUS.injury] = this.injury;
      L[LOCUS.health] = this.health;
      L[LOCUS.impact] = s.impact;
      L[LOCUS.gentleTouch] = s.gentle;
      L[LOCUS.touchingFriend] = s.touchingFriend;
      L[LOCUS.company] = creature.company;
      L[LOCUS.crowding] = creature.crowding;
      L[LOCUS.novelty] = creature.noticeNovelty(world);
      L[LOCUS.falling] = !creature.onGround && creature.vy > 2 ? Math.min(1, creature.vy / 6) : 0;
      L[LOCUS.inWater] = creature.inWater ? 1 : 0;
      L[LOCUS.held] = creature.held ? 1 : 0;
      for (let k = 0; k < TASTE_KEYS.length; k++) L[TASTE_LOCI[k]] = t[TASTE_KEYS[k]];
      const c = this.chem;
      let full = 0;
      for (const k of GUT) full += c.get(k);
      L[LOCUS.gutFullness] = clamp01(full);
      L[LOCUS.mated] = s.mated;
      L[LOCUS.pregnant] = this.pregnancy ? 1 : 0;
      L[LOCUS.heardCall] = s.heardCall;
      L[LOCUS.growth] = this.growth;
      L[LOCUS.starving] = c.get('glucose') < 0.01 && c.get('glycogen') < 0.01 ? 1 : 0;
      // The brain reaches the body here too: genes can read how fast each Feelings cell fires
      const feelings = brain.lobes.feelings;
      for (let k = 0; k < N_LIMBIC; k++) L[LOCUS.limbic0 + k] = Math.min(1, brain.rate[feelings[k]] * 5);
    }

    // ---------- The body's workings ----------
    // Returns the cause of death if health ran out, else null
    physiology(creature, world) {
      const c = this.chem, T = creature.traits;
      this.strength = clamp(1 + c.effect('muscle'), 0.1, 2);

      // Running costs, paid in ready energy: a resting rate that grows more slowly than the body does
      // (mass^0.75, Kleiber's law, taking mass as (size / 40)^2 for a body seen side-on), shivering when
      // cold, the muscles in use and every spike (the brain's cost to the body).
      // What is paid becomes spent energy; what there is no ready energy for goes unpaid
      const mass = (creature.size / BODY.cost.massSize) ** 2;
      const basal = BODY.cost.basal * Math.pow(mass, 0.75) * (1 + c.effect('metabolism')) * (this.asleep ? BODY.cost.sleepFactor : 1);
      const shiver = BODY.cost.shiver * Math.max(0, c.effect('thermogenesis'));
      const work = BODY.cost.work * creature.exertion;
      const paid = Math.min(c.get('readyEnergy'), basal + shiver + work + BODY.cost.spike * creature.brain.spikesThisTick);
      c.add('readyEnergy', -paid);
      c.add('spentEnergy', paid);

      // Water: evaporation rises with heat and effort, and panting costs more
      const ambient = world.temperatureAt(creature.x, creature.centerY);
      const pant = Math.max(0, c.effect('cooling'));
      c.add('water', -BODY.water.loss * (1 + BODY.water.heatFactor * Math.max(0, ambient - BODY.water.heatOnset)) * (1 + creature.exertion) - BODY.water.pant * pant);

      // Temperature: exchange with the air through the fur, plus heat from the body's own work
      // and from huddling against others
      const insulation = creature.inWater ? T.insulation * BODY.heat.wetInsulation : T.insulation; // Wet fur keeps little heat in
      const exchange = (ambient - this.temperature) * (1 - insulation) * BODY.heat.exchange;
      const heat = (T.bodyHeat * BODY.heat.body + creature.exertion * BODY.heat.work + Math.max(0, c.effect('thermogenesis')) * BODY.heat.thermogenesis) * BODY.heat.scale
        + this.stim.touchingFriend * BODY.heat.huddle - BODY.heat.baseLoss - pant * BODY.heat.pantCooling;
      const dT = exchange + heat;
      this.temperature = clamp01(this.temperature + dT);
      this.heatGain = clamp01(dT * BODY.heat.display);
      this.heatLoss = clamp01(-dT * BODY.heat.display);

      // Growth: growth hormone builds body protein into a bigger body
      if (this.growth < 1) {
        const g = Math.min(1 - this.growth, Math.max(0, c.effect('growth')) * BODY.scale.growth, c.get('protein') / BODY.growthProtein);
        this.growth += g;
        c.add('protein', -g * BODY.growthProtein);
      }
      // Healing: injury repaired with protein
      if (this.injury > 0) {
        const heal = Math.min(this.injury, Math.max(0, c.effect('healing')) * BODY.scale.healing);
        this.injury -= heal;
        c.add('protein', -heal * BODY.heal.protein);
      }

      // Damage: chemicals (via receptor genes), and failing supplies
      const hurt = (cause, amount) => {
        if (amount <= 0) return;
        this.health -= amount;
        this.damageLog[cause] = (this.damageLog[cause] || 0) + amount;
      };
      const chemDamage = Math.max(0, c.effect('damage')) * BODY.scale.damage;
      if (chemDamage > 0) hurt(c.damageCause() || 'illness', chemDamage);
      if (this.loci[LOCUS.starving]) hurt('starvation', BODY.harm.starvation);
      if (c.get('water') < BODY.harm.thirstBelow) hurt('dehydration', BODY.harm.dehydration);
      if (this.temperature < BODY.harm.coldBelow) hurt('cold', BODY.harm.cold);
      if (this.temperature > BODY.harm.heatAbove) hurt('heat', BODY.harm.heat);
      if (this.injury >= BODY.harm.injuryAt) hurt('injury', BODY.harm.injury);
      if (chemDamage === 0 && !this.loci[LOCUS.starving] && c.get('protein') > BODY.harm.recoveryProtein) this.health = Math.min(1, this.health + BODY.harm.recovery);
      for (const k in this.damageLog) this.damageLog[k] *= BODY.harm.logFade;
      if (this.health <= 0) {
        let cause = 'illness', worst = 0;
        for (const k in this.damageLog) if (this.damageLog[k] > worst) { worst = this.damageLog[k]; cause = k; }
        return cause;
      }

      // Scents the body releases (receptor genes decide how much). Queued, like the egg below:
      // they reach the world once every body has run
      const sexScent = Math.max(0, c.effect('scentSex')) * BODY.scale.scentSex;
      if (sexScent > 0) world.queueScent(creature.x, creature.y - creature.size * 0.3, creature.sex === 'FEMALE' ? Evo.SCENT.muskF : Evo.SCENT.muskM, sexScent);
      const alarm = Math.max(0, c.effect('scentAlarm')) * BODY.scale.scentAlarm;
      if (alarm > 0) world.queueScent(creature.x, creature.y - creature.size * 0.3, Evo.SCENT.alarm, alarm);

      // Pregnancy: the mother builds the egg from her own reserves over the gestation
      if (this.pregnancy) {
        const p = this.pregnancy;
        const share = 1 / T.gestationTicks;
        for (const [key, want] of Object.entries(EGG_CONTENTS)) {
          const take = Math.min(c.get(key) * 0.5, want * share * eggShare(T));
          c.add(key, -take);
          p.reserves[key] += take;
        }
        p.progress += share;
        if (p.progress >= 1 && creature.onGround) {
          world.queueEgg(creature, p);
          this.pregnancy = null;
        }
      }
      return null;
    }

    // ---------- Sleep ----------
    updateSleep(creature, world) {
      const pressure = this.chem.effect('sleep');
      if (!this.asleep) {
        if ((pressure > 1.0 && creature.restTimer > 0) || pressure > 2.0) this.fallAsleep(creature, world);
      } else if (pressure < 0.25 || this.stim.impact > 0.3 || this.chem.get('pain') > 0.3 || (this.stim.heardCall > 0.8 && pressure < 1)) {
        this.wake(creature, world);
      }
    }

    fallAsleep(creature, world) {
      this.asleep = true;
      creature.stimulate('fellAsleep');
      world.events.emit('sleep', { creature });
    }

    wake(creature, world) {
      this.asleep = false;
      creature.stimulate('woke');
      world.events.emit('wake', { creature });
    }

    // ---------- The stomach, the skin and the tongue ----------
    // Food enters the gut; each nutrient is also tasted
    ingest(food) {
      const c = this.chem;
      for (const key in food) c.add(key, food[key]);
      for (const t of TASTES) this.taste[t.key] = Math.min(1, this.taste[t.key] + (food[t.food] || 0) * t.scale);
    }

    // What the skin and tongue felt fades
    fade() {
      const s = this.stim;
      s.impact *= 0.8; s.gentle *= 0.95; s.back *= 0.85; s.mated *= 0.95; s.flinch *= 0.85;
      s.contactL *= 0.7; s.contactR *= 0.7; s.touchingFriend *= 0.9;
      for (const k in this.taste) this.taste[k] *= 0.93;
    }

    // What the dead body leaves to eat
    remains() {
      const ch = this.chem, C = BODY.carrion;
      return { gutProtein: Math.min(C.proteinCap, ch.get('protein') * C.protein + C.growth * this.growth), gutFat: ch.get('fat') * C.fat, gutSugar: ch.get('glucose') * C.sugar };
    }
  }

  Object.assign(Evo, { Body, BODY, EGG_CONTENTS, eggShare });
})(globalThis.Evo);
