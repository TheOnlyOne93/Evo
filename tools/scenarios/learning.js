// Learning and decision probes. See tools/behave.js for the shape. The reports never gate anything:
// they measure how the brain behaves (run with --report).
'use strict';

module.exports = ({ Evo, lab }) => {
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

  // Microseconds of brain (tick + morphogenesis) and senses per creature-tick in a full world
  const cost = cached(seed => {
    Evo.seed(seed);
    const world = new Evo.World();
    const B = Evo.Brain.prototype, C = Evo.Creature.prototype;
    const { tick, runMorphogenesis } = B, { sense } = C;
    let brainNs = 0n, senseNs = 0n, creatureTicks = 0;
    const timed = (fn, add) => function (...a) { const t0 = process.hrtime.bigint(); const r = fn.apply(this, a); add(process.hrtime.bigint() - t0); return r; };
    B.tick = timed(tick, d => { brainNs += d; creatureTicks++; });
    B.runMorphogenesis = timed(runMorphogenesis, d => { brainNs += d; });
    C.sense = timed(sense, d => { senseNs += d; });
    try {
      for (let t = 0; t < 900; t++) {
        if (t === 300) { brainNs = 0n; senseNs = 0n; creatureTicks = 0; }
        world.step();
      }
    } finally {
      Object.assign(B, { tick, runMorphogenesis }); C.sense = sense;
    }
    return { brain: Number(brainNs) / 1000 / creatureTicks, senses: Number(senseNs) / 1000 / creatureTicks };
  });

  return {
    scenarios: {},
    reports: {
      'modulators: spike rate with no outcome': seed => busy(seed).modRate,
      'decision: share of active ticks with >1 muscle': seed => busy(seed).multi,
      'decision: median action bout, by time (ticks)': seed => busy(seed).bout,
      'cost: brain us per creature-tick': seed => cost(seed).brain,
      'cost: senses us per creature-tick': seed => cost(seed).senses
    }
  };
};
