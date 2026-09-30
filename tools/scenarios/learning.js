// Learning and decision probes. See tools/behave.js for the shape. The reports never gate anything:
// they measure how the brain behaves (run with --report).
//
// Learning bench (one creature kept across trials, with matched controls).
// TODO mimic aversion (the scenario below) fails: mimic is eaten as often in exposures 8-10 as in
//   1-3. What was measured: a hungry creature's eat muscle fires on its own much of the time, so
//   its inputs are eligible at every learning signal. The shared features (red look, sweet smell,
//   something at the mouth, hunger) are weakened after a mimic and restored after a fruit, while
//   what tells the two apart (a faint violet, a bitter smell) has no path to the jaws that
//   punishment could strengthen. And while a mimic sits uneaten in view, the discounted punishment
//   prediction (GAMMA) gives a steady trickle of relief that strengthens the eat muscle's inputs.
'use strict';

module.exports = ({ Evo, lab, session, trial }) => {
  const cached = fn => { const memo = new Map(); return seed => { if (!memo.has(seed)) memo.set(seed, fn(seed)); return memo.get(seed); }; };

  // A creature with several moderate drives, things to look at and no reward or punishment: which
  // actions does it pick, how long does it stick with one, and do its modulator cells stay quiet?
  const busy = cached(seed => {
    const { world, c } = lab(seed);
    world.spawnItem('fruit', c.x - 150);
    world.spawnItem('ball', c.x + 120);
    const hold = { hunger: 0.4, thirst: 0.2, loneliness: 0.3, boredom: 0.3, reward: 0, punishment: 0 };
    const motor = c.brain.lobes.motor, [rewardCell, punishCell] = c.brain.lobes.feelings;
    let active = 0, multi = 0, modSpikes = 0, ticks = 0, cur = -1, first = 0, last = 0;
    const bouts = [];
    for (let t = 0; t < 2400 && !c.dead; t++) {
      for (const k in hold) c.chem.set(k, hold[k]);
      world.step();
      if (t < 300) continue;
      const b = c.brain;
      ticks++;
      let n = 0, some = -1;
      motor.forEach((i, k) => { if (b.hist[i] & 1) { n++; if (some < 0) some = k; } });
      if (n) active++;
      if (n > 1) multi++;
      modSpikes += (b.hist[rewardCell] & 1) + (b.hist[punishCell] & 1);
      // A bout: one muscle firing again and again (gaps under 30 ticks) until another muscle fires
      if (cur >= 0 && (t - last > 30 || (n && !(b.hist[motor[cur]] & 1)))) { bouts.push(last - first + 1); cur = -1; }
      if (n && cur < 0) { cur = some; first = t; }
      if (n) last = t;
    }
    if (cur >= 0) bouts.push(last - first + 1);
    // Half the time spent acting is in bouts at least this long (a stray twitch barely counts)
    bouts.sort((a, b) => a - b);
    const total = bouts.reduce((n, b) => n + b, 0);
    let bout = 0;
    for (let k = 0, sum = 0; k < bouts.length && sum < total / 2; k++) { sum += bouts[k]; bout = bouts[k]; }
    return {
      multi: active ? multi / active : 0,
      bout,
      modRate: ticks ? modSpikes / (2 * ticks) : 0
    };
  });

  // Microseconds of brain (tick + morphogenesis) and senses per creature-tick, and milliseconds per
  // world tick, in a full world
  const COST_WARMUP = 300, COST_TICKS = 900;   // Ticks before timing starts, and in all
  const cost = cached(seed => {
    Evo.seed(seed);
    const world = new Evo.World();
    // A full world: MAX_POPULATION creatures (the population ceiling)
    while (world.creatures.length < Evo.LIMITS.MAX_POPULATION) world.addAdult(Evo.chance(0.5) ? 'FEMALE' : 'MALE');
    world.maybeWanderer = () => {};
    const B = Evo.Brain.prototype, C = Evo.Creature.prototype;
    const { tick, runMorphogenesis } = B, { sense } = C;
    let brainNs = 0n, senseNs = 0n, creatureTicks = 0, t0 = 0n, worldMs = 0;
    const timed = (fn, add) => function (...a) { const t0 = process.hrtime.bigint(); const r = fn.apply(this, a); add(process.hrtime.bigint() - t0); return r; };
    B.tick = timed(tick, d => { brainNs += d; creatureTicks++; });
    B.runMorphogenesis = timed(runMorphogenesis, d => { brainNs += d; });
    C.sense = timed(sense, d => { senseNs += d; });
    try {
      for (let t = 0; t < COST_TICKS; t++) {
        if (t === COST_WARMUP) { brainNs = 0n; senseNs = 0n; creatureTicks = 0; t0 = process.hrtime.bigint(); }
        world.step();
      }
      worldMs = Number(process.hrtime.bigint() - t0) / 1e6 / (COST_TICKS - COST_WARMUP);
    } finally {
      Object.assign(B, { tick, runMorphogenesis }); C.sense = sense;
    }
    return { brain: Number(brainNs) / 1000 / creatureTicks, senses: Number(senseNs) / 1000 / creatureTicks, worldMs };
  });

  // Two things in view, one on each side: does the creature go for the one its need is about?
  const choice = {
    'hungry, fruit left + dew right -> eats the fruit first': seed => {
      const s = lab(seed);
      s.hold = { hunger: 0.7 };
      const fruit = s.world.spawnItem('fruit', s.c.x - 120), dew = s.world.spawnItem('dew', s.c.x + 120);
      const gone = item => !s.world.items.includes(item);
      const at = trial(s, 1800, () => gone(fruit) || gone(dew));
      return at !== null && gone(fruit) ? at : null;
    },
    'thirsty, fruit left + pond right -> reaches water': seed => {
      const s = lab(seed);
      const p = s.world.terrain.ponds[0];
      Object.assign(s.c, { x: p.x0 - 150, facing: 1 });
      s.c.y = s.world.terrain.groundY(s.c.x);
      s.world.spawnItem('fruit', s.c.x - 150);
      s.hold = { thirst: 0.7 };
      let drank = false;
      s.world.events.on('drink', () => { drank = true; });
      return trial(s, 1800, () => drank);
    }
  };

  // Object permanence: a hungry creature sees fruit on its left for 60 ticks, then the fruit is
  // taken away. How much more of the next 120 ticks does it spend walking left than a creature that
  // never saw it?
  const walkingLeft = (seed, show) => {
    const s = lab(seed);
    s.hold = { hunger: 0.7 };
    const fruit = show ? s.world.spawnItem('fruit', s.c.x - 150) : null;
    let left = 0;
    for (let t = 0; t < 180; t++) {
      for (const k in s.hold) s.c.chem.set(k, s.hold[k]);
      if (t === 60 && fruit) s.world.items.length = 0;
      s.world.step();
      if (t >= 60 && s.c.vx < -0.25) left++;
    }
    return left / 120;
  };

  // Does finding food get quicker? A hungry creature finds fruit placed 150 px away, alternately
  // left and right, 8 times: mean time to eat in trials 6-8 over trials 1-3.
  const approachLatency = cached(seed => {
    const s = session(seed);
    s.hold = { hunger: 0.7 };
    const times = [];
    for (let k = 0; k < 8; k++) {
      s.resetBody();
      const fruit = s.place('fruit', k % 2 ? 150 : -150);
      const at = trial(s, 1800, w => !w.items.includes(fruit));
      times.push(at === null ? 1800 : at);
    }
    const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
    return mean(times.slice(5)) / Math.max(1, mean(times.slice(0, 3)));
  });

  // Operant conditioning of calling. A lonely creature's calls are counted for 1500 ticks; then for
  // 3000 ticks the hand slaps (or pats) it 5-15 ticks after each call; then calls are counted for
  // 1500 more. A yoked control, another creature (seed + 1000), gets the same touches at the same
  // times, whatever it does. (Yoking a copy of the same creature doesn't work: until chance
  // sets the two apart the copy calls when the original did, so most of its pats follow a call too.)
  // Returns the change in calls, (test - baseline) / the larger of the two (-1 .. 1), for the
  // contingent and the yoked creature.
  const consequence = kind => cached(seed => {
    const run = (seed, schedule) => {
      const s = lab(seed);
      const hold = { loneliness: 0.3, sleepiness: 0, tiredness: 0, hunger: 0, thirst: 0 };
      const touches = schedule || [];
      let calls = 0, due = -1;
      s.world.events.on('call', ({ creature }) => { if (creature === s.c) { calls++; if (!schedule && due < 0) due = 5 + Evo.randInt(11); } });
      let base = 0;
      for (let t = 0; t < 6000; t++) {
        for (const k in hold) s.c.chem.set(k, hold[k]);
        if (t === 1500) { base = calls; calls = 0; }
        if (t === 4500) calls = 0;
        const training = t >= 1500 && t < 4500;
        if (schedule ? touches.includes(t) : training && due === 0) {
          s.world[kind](s.c);
          if (!schedule) touches.push(t);
        }
        if (due >= 0) due--;
        if (!training) due = -1;
        s.world.step();
      }
      return { change: (calls - base) / Math.max(1, base, calls), touches };
    };
    const contingent = run(seed, null);
    return { contingent: contingent.change, yoked: run(seed + 1000, contingent.touches).change };
  });
  const slapped = consequence('slap'), patted = consequence('pat');

  // ---------- Working memory: object permanence ----------
  // A hungry creature sees fruit 150 px to one side (alternating by seed) for 60 ticks; then the
  // fruit vanishes. Share of the next 120 ticks spent walking toward where it was, for the founder
  // and for a knockout whose thinking (cortex) Lobe dynamics gene has persistence 0 (same seed).
  const cortexKnockout = Evo.FOUNDER_GENOME.map(g => g.gene === 'Lobe dynamics' && g.lobe === 'cortex' ? { ...g, persistence: 0 } : g);
  const labWith = (seed, genes) => {
    const saved = Evo.FOUNDER_GENOME;
    Evo.FOUNDER_GENOME = genes;
    try { return lab(seed); } finally { Evo.FOUNDER_GENOME = saved; }
  };
  const hiddenFruit = genes => cached(seed => {
    const s = labWith(seed, genes), side = seed % 2 ? -1 : 1;
    s.world.spawnItem('fruit', s.c.x + side * 150);
    let toward = 0;
    for (let t = 0; t < 180 && !s.c.dead; t++) {
      s.c.chem.set('hunger', 0.7);
      if (t === 60) s.world.items.length = 0;
      s.world.step();
      if (t >= 60 && s.c.vx * side > 0.25) toward++;
    }
    return toward / 120;
  });
  const permanence = { founder: hiddenFruit(Evo.FOUNDER_GENOME), knockout: hiddenFruit(cortexKnockout) };
  const memoryReports = {
    'memory: walks toward hidden fruit (founder)': permanence.founder,
    'memory: walks toward hidden fruit (cortex persistence 0)': permanence.knockout
  };

  // Mimic aversion. A hungry creature is offered 10 mimic berries interleaved with 10 fruits, 40 px
  // away (a pair on the left, then a pair on the right), for up to 400 ticks each, with 150 quiet
  // ticks after each. Passes when it eats mimic in exposures 8-10 at most half as often as in 1-3
  // (and at least once there) while still eating at least 8 of the 10 fruits.
  const mimicTrials = cached(seed => {
    const s = session(seed);
    s.hold = { hunger: 0.7, sleepiness: 0, tiredness: 0, loneliness: 0, thirst: 0, boredom: 0 };
    const ate = { mimic: [], fruit: [] };
    for (let k = 0; k < 20; k++) {
      const type = k % 2 ? 'mimic' : 'fruit';
      s.resetBody();
      const item = s.place(type, (k >> 1) % 2 ? 40 : -40);
      ate[type].push(trial(s, 400, w => !w.items.includes(item)) !== null ? 1 : 0);
      s.world.items.length = 0;
      trial(s, 150, () => false);
    }
    const count = a => a.reduce((n, x) => n + x, 0);
    return { early: count(ate.mimic.slice(0, 3)), late: count(ate.mimic.slice(7)), fruit: count(ate.fruit) };
  });
  const mimicAversion = seed => {
    const { early, late, fruit } = mimicTrials(seed);
    return early > 0 && late <= early / 2 && fruit >= 8 ? 0 : null;
  };

  // A pat reinforces what the creature was just doing. A quiet creature is made to call (or jump),
  // its muscle driven for a few ticks, every 300 ticks, 8 times, and patted `lag` ticks after each;
  // then how often it calls (jumps) on its own in the next 1500 ticks is counted.
  const moulded = (seed, action, lag) => {
    const s = lab(seed), b = s.c.brain, muscle = b.lobes.motor[Evo.MOTORS.findIndex(m => m.key === action)];
    const hold = { loneliness: 0, sleepiness: 0, tiredness: 0, hunger: 0, thirst: 0 };
    const did = action === 'jump' ? () => s.c.jumpCooldown === 30 : () => s.c.callTimer === 40;
    let n = 0;
    for (let t = 0; t < 2400 + 1500; t++) {
      for (const k in hold) s.c.chem.set(k, hold[k]);
      if (t < 2400 && t % 300 < 6) b.inject(muscle, 40, 1);
      if (t < 2400 && t % 300 === lag) s.world.pat(s.c);
      s.world.step();
      if (t >= 2400 && did()) n++;
    }
    return n;
  };
  const pattedSoon = action => seed => (moulded(seed, action, 10) > moulded(seed, action, 150) ? 0 : null);

  return {
    scenarios: {
      ...choice,
      'hungry, mimic and fruit in turn -> eats mimic less, fruit still': mimicAversion,
      'made to call, patted just after -> calls more than patted later': pattedSoon('call'),
      'made to jump, patted just after -> jumps more than patted later': pattedSoon('jump')
    },
    reports: {
      'modulators: spike rate with no outcome': seed => busy(seed).modRate,
      'bench: hungry approach time, trials 6-8 over 1-3': approachLatency,
      'bench: mimics eaten, exposures 1-3 (of 3)': seed => mimicTrials(seed).early,
      'bench: mimics eaten, exposures 8-10 (of 3)': seed => mimicTrials(seed).late,
      'bench: fruits eaten alongside the mimics (of 10)': seed => mimicTrials(seed).fruit,
      'bench: calls after slaps that follow each call (change)': seed => slapped(seed).contingent,
      'bench: calls after the same slaps at random (yoked, change)': seed => slapped(seed).yoked,
      'bench: calls after pats that follow each call (change)': seed => patted(seed).contingent,
      'bench: calls after the same pats at random (yoked, change)': seed => patted(seed).yoked,
      'memory: walks left after fruit there vanishes (share above control)': seed => walkingLeft(seed, true) - walkingLeft(seed, false),
      'decision: share of active ticks with >1 muscle': seed => busy(seed).multi,
      'decision: median action bout, by time (ticks)': seed => busy(seed).bout,
      'cost: brain us per creature-tick': seed => cost(seed).brain,
      'cost: senses us per creature-tick': seed => cost(seed).senses,
      [`cost: ms per world tick (${Evo.LIMITS.MAX_POPULATION} creatures)`]: seed => cost(seed).worldMs,
      ...memoryReports
    }
  };
};
