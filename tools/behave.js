// Behaviour bench: one creature in a controlled situation, many trials, and how often (and how
// fast) it does the sensible thing. Drives are held at fixed levels during a trial.
//   node tools/behave.js [trials=12] [filter]
'use strict';
const Evo = require('../tests/load')();

// A quiet world with one creature and nothing else happening
function lab(seed, { phase = 0.45 } = {}) {
  Evo.seed(seed);
  const world = new Evo.World();
  world.items = [];
  world.growFood = () => {};
  world.maybeWanderer = () => {};
  world.startPhase = phase;
  world.updateClock();
  const c = world.creatures[0];
  world.creatures = [c];
  const x = world.features.find(f => f.kind === 'grass').x;
  Object.assign(c, { x, y: world.terrain.groundY(x), vx: 0, vy: 0, facing: 1 });
  for (const k of Evo.DRIVES) c.chem.set(k, 0);
  c.chem.set('glucose', 0.5); c.chem.set('water', 0.8); c.chem.set('adenosine', 0); c.chem.set('melatonin', 0);
  return { world, c };
}

// Run until done(world, creature, tick) is true, the creature dies, or `ticks` pass.
// Returns { at: the tick it happened (or null), died }.
function run(setup, ticks, done) {
  const { world, c, hold } = setup;
  for (let t = 0; t < ticks; t++) {
    if (hold) for (const [k, v] of Object.entries(hold)) c.chem.set(k, v);
    world.step();
    if (done(world, c, t)) return { at: t, died: false };
    if (c.dead) return { at: null, died: true };
  }
  return { at: null, died: false };
}
// A scenario's score: the tick at which it passed, or null for a failure. Dying always fails.
// trial: pass when done() happens; avoids: pass when done() never happens and the creature lives.
const trial = (setup, ticks, done) => run(setup, ticks, done).at;
const avoids = (setup, ticks, done) => {
  const r = run(setup, ticks, done);
  return r.at === null && !r.died ? 0 : null;
};

const SCENARIOS = {
  'hungry, food at mouth -> eats': seed => {
    const s = lab(seed);
    s.hold = { hunger: 0.7 };
    s.world.spawnItem('fruit', s.c.mouthX + 3);
    return trial(s, 600, w => !w.items.length);
  },
  'sated, food at mouth -> leaves it': seed => {
    const s = lab(seed);
    s.world.spawnItem('fruit', s.c.mouthX + 3);
    return avoids(s, 600, w => !w.items.length);
  },
  'hungry, fruit 150px left -> reaches and eats it': seed => {
    const s = lab(seed);
    s.hold = { hunger: 0.7 };
    s.c.facing = 1;
    s.world.spawnItem('fruit', s.c.x - 150);
    return trial(s, 1800, w => !w.items.length);
  },
  'hungry, fruit 150px right -> reaches and eats it': seed => {
    const s = lab(seed);
    s.hold = { hunger: 0.7 };
    s.world.spawnItem('fruit', s.c.x + 150);
    return trial(s, 1800, w => !w.items.length);
  },
  'thirsty at the pond -> drinks': seed => {
    const s = lab(seed);
    const p = s.world.terrain.ponds[0];
    Object.assign(s.c, { x: p.x0 + 12, facing: 1 });
    s.c.y = s.world.terrain.groundY(s.c.x);
    s.hold = { thirst: 0.7 };
    let drank = false;
    s.world.events.on('drink', () => { drank = true; });
    return trial(s, 900, () => drank);
  },
  'not thirsty at the pond -> rarely drinks': seed => {
    const s = lab(seed);
    const p = s.world.terrain.ponds[0];
    Object.assign(s.c, { x: p.x0 + 12, facing: 1 });
    s.c.y = s.world.terrain.groundY(s.c.x);
    let drinks = 0;
    s.world.events.on('drink', () => { drinks++; });
    return avoids(s, 900, () => drinks > 8);
  },
  'sleepy at night -> falls asleep': seed => {
    const s = lab(seed, { phase: 0.95 });
    s.hold = { sleepiness: 0.7, tiredness: 0.3 };
    return trial(s, 1800, (w, c) => c.asleep);
  },
  'rested by day -> stays awake': seed => {
    const s = lab(seed);
    return avoids(s, 1200, (w, c) => c.asleep);
  },
  'in pain -> runs': seed => {
    const s = lab(seed);
    s.hold = { pain: 0.6 };
    return trial(s, 600, (w, c) => c.runTimer > 0);
  },
  'lonely -> calls': seed => {
    const s = lab(seed);
    s.hold = { loneliness: 0.8 };
    return trial(s, 900, (w, c) => c.callTimer > 0);
  },
  'thorn bush 120px right -> keeps away': seed => {
    const s = lab(seed);
    const bush = s.world.addThornbush(s.c.x + 120);
    // Fails if it ever walks up to the bush (within 35 px of its centre)
    return avoids(s, 1200, (w, c) => c.x > bush.x - 35);
  }
};

const trials = Number(process.argv[2] || 12);
const filter = process.argv[3] || '';
for (const [name, scenario] of Object.entries(SCENARIOS)) {
  if (!name.includes(filter)) continue;
  const times = [];
  for (let seed = 1; seed <= trials; seed++) times.push(scenario(seed));
  const ok = times.filter(t => t !== null);
  const median = ok.length ? ok.sort((a, b) => a - b)[Math.floor(ok.length / 2)] : null;
  console.log(`${String(Math.round(ok.length / trials * 100)).padStart(3)}%  ${name.padEnd(48)} ${median !== null && median > 0 ? `median ${median} ticks` : ''}`);
}
