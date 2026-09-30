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
const { cortexKnockout, callThenPat, timeCosts } = require('../../tests/helpers');

module.exports = ({ Evo, lab, session, run, trial }) => {
  const cached = fn => { const memo = new Map(); return seed => { if (!memo.has(seed)) memo.set(seed, fn(seed)); return memo.get(seed); }; };

  // A creature with several moderate drives, things to look at and no reward or punishment: which
  // actions does it pick, how long does it stick with one, and do its modulator cells stay quiet?
  const busy = cached(seed => {
    const s = lab(seed), { world, c } = s;
    world.spawnItem('fruit', c.x - 150);
    world.spawnItem('ball', c.x + 120);
    s.hold = { hunger: 0.4, thirst: 0.2, loneliness: 0.3, boredom: 0.3, reward: 0, punishment: 0 };
    const motor = c.brain.lobes.motor, [rewardCell, punishCell] = c.brain.lobes.feelings;
    let active = 0, multi = 0, modSpikes = 0, ticks = 0, cur = -1, first = 0, last = 0;
    const bouts = [];
    run(s, 2400, (w, _c, t) => {
      if (t < 300) return;
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
    });
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
  // world tick, in a default world (its 2 founders, as the game starts; no wanderers)
  const COST_WARMUP = 300, COST_TICKS = 900;   // Ticks before timing starts, and in all
  const BRAIN_BUDGET_US = 60;                  // A brain tick should cost less than this per creature
  const cost = cached(seed => {
    Evo.seed(seed);
    const world = new Evo.World();
    world.maybeWanderer = () => {};
    let worldMs = 0;
    const { brain, senses } = timeCosts(Evo, reset => {
      let t0 = 0n;
      for (let t = 0; t < COST_TICKS; t++) {
        if (t === COST_WARMUP) { reset(); t0 = process.hrtime.bigint(); }
        world.step();
      }
      worldMs = Number(process.hrtime.bigint() - t0) / 1e6 / (COST_TICKS - COST_WARMUP);
    });
    return { brain, senses, worldMs };
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
      s.placeAt(p.x0 - 150);
      s.world.spawnItem('fruit', s.c.x - 150);
      s.hold = { thirst: 0.7 };
      const drinks = s.count('drink');
      return trial(s, 1800, () => drinks() > 0);
    }
  };

  // Object permanence: a hungry creature in a lab sees fruit 150 px to one side (or, for a control,
  // nothing) for 60 ticks; then the fruit is taken away. Returns the share of the next 120 ticks it
  // spends walking toward where the fruit was (side -1 is left, 1 is right).
  const walksTowardHidden = (s, side, show = true) => {
    s.hold = { hunger: 0.7 };
    if (show) s.world.spawnItem('fruit', s.c.x + side * 150);
    let toward = 0;
    run(s, 180, (w, c, t) => { if (t >= 60 && c.vx * side > 0.25) toward++; },
      (w, c, t) => { if (t === 60) w.items.length = 0; });
    return toward / 120;
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
    const { mean } = Evo.util;
    return mean(times.slice(5)) / Math.max(1, mean(times.slice(0, 3)));
  });

  // Operant conditioning of calling. A lonely creature's calls are counted for 1500 ticks; then for
  // 3000 ticks the hand slaps (or pats) it 5-15 ticks after each call; then calls are counted for
  // 1500 more. A yoked control, another creature (seed + 1000), gets the same touches at the same
  // times, whatever it does. (Yoking a copy of the same creature doesn't work: until chance
  // sets the two apart the copy calls when the original did, so most of its pats follow a call too.)
  // Returns the change in calls, (test - baseline) / the larger of the two (-1 .. 1), for the
  // contingent and the yoked creature.
  const BASELINE_END = 1500, TRAINING_END = 4500, TOTAL_TICKS = 6000;
  const consequence = kind => cached(seed => {
    // Plays one creature through all three phases and records the ticks it called on. It is touched at
    // the ticks in `schedule` or, without one, 5-15 ticks after a call in the training phase (the
    // ticks are returned as `touches`).
    const play = (seed, schedule) => {
      const s = lab(seed);
      s.hold = { loneliness: 0.3, sleepiness: 0, tiredness: 0, hunger: 0, thirst: 0 };
      const touches = schedule || [], callTicks = [];
      let now = 0, due = -1;
      s.world.events.on('call', ({ creature }) => {
        if (creature !== s.c) return;
        callTicks.push(now);
        if (!schedule && due < 0) due = 5 + Evo.randInt(11);
      });
      run(s, TOTAL_TICKS, () => false, (w, c, t) => {
        now = t;
        const training = t >= BASELINE_END && t < TRAINING_END;
        if (schedule ? touches.includes(t) : training && due === 0) {
          w[kind](c);
          if (!schedule) touches.push(t);
        }
        if (due >= 0) due--;
        if (!training) due = -1;
      });
      const base = callTicks.filter(t => t < BASELINE_END).length, test = callTicks.filter(t => t >= TRAINING_END).length;
      return { change: (test - base) / Math.max(1, base, test), touches };
    };
    const contingent = play(seed, null);
    return { contingent: contingent.change, yoked: play(seed + 1000, contingent.touches).change };
  });
  const slapped = consequence('slap'), patted = consequence('pat');

  // ---------- Working memory: object permanence ----------
  // A hungry creature sees fruit 150 px to one side (alternating by seed) for 60 ticks; then the
  // fruit vanishes. Share of the next 120 ticks spent walking toward where it was, for the founder
  // and for a knockout whose thinking (cortex) Lobe dynamics gene has persistence 0 (same seed).
  const labWith = (seed, genes) => {
    const saved = Evo.FOUNDER_GENOME;
    Evo.FOUNDER_GENOME = genes;
    try { return lab(seed); } finally { Evo.FOUNDER_GENOME = saved; }
  };
  const hiddenFruit = genes => cached(seed => walksTowardHidden(labWith(seed, genes), seed % 2 ? -1 : 1));
  const permanence = { founder: hiddenFruit(Evo.FOUNDER_GENOME), knockout: hiddenFruit(cortexKnockout(Evo)) };
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
  const MOULD_ROUNDS = 8, COUNT_TICKS = 1500;
  const moulded = (seed, action, lag) => {
    const s = lab(seed), muscle = s.c.brain.lobes.motor[Evo.MOTORS.findIndex(m => m.key === action)];
    s.hold = { loneliness: 0, sleepiness: 0, tiredness: 0, hunger: 0, thirst: 0 };
    const { JUMP_COOLDOWN, CALL_TICKS } = Evo.CREATURE;
    const did = action === 'jump' ? () => s.c.jumpCooldown === JUMP_COOLDOWN : () => s.c.callTimer === CALL_TICKS;
    callThenPat(s.world, s.c, muscle, lag, MOULD_ROUNDS, () => { for (const k in s.hold) s.c.chem.set(k, s.hold[k]); });
    let n = 0;
    run(s, COUNT_TICKS, () => { if (did()) n++; });
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
      'memory: walks left after fruit there vanishes (share above control)': seed => walksTowardHidden(lab(seed), -1) - walksTowardHidden(lab(seed), -1, false),
      'decision: share of active ticks with >1 muscle': seed => busy(seed).multi,
      'decision: median action bout, by time (ticks)': seed => busy(seed).bout,
      [`cost: brain us per creature-tick (budget ${BRAIN_BUDGET_US})`]: seed => cost(seed).brain,
      'cost: senses us per creature-tick': seed => cost(seed).senses,
      'cost: ms per world tick (default world, 2 founders)': seed => cost(seed).worldMs,
      ...memoryReports
    }
  };
};
