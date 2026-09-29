// Behaviour bench: one creature in a controlled situation, many trials, and how often (and how
// fast) it does the sensible thing. Drives are held at fixed levels during a trial.
//   node tools/behave.js [trials=12] [filter] [--report]
// Scenarios live in tools/scenarios/*.js. Each file exports ({ Evo, lab, session, trial, avoids }) =>
// ({ scenarios, reports }): scenarios map a name to seed => tick it passed (null = fail); reports map a
// name to seed => number and are averaged and printed only with --report (they never gate anything).
'use strict';
const fs = require('fs');
const path = require('path');
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

// A creature kept across trials: one world and brain, so learning carries over. place() puts an item
// dx pixels from the creature (clearing any others); resetBody() clears toxin, injury and pain and
// restores health, but keeps the brain.
function session(seed, opts) {
  const s = lab(seed, opts);
  s.place = (type, dx) => { s.world.items.length = 0; return s.world.spawnItem(type, s.c.x + dx); };
  s.resetBody = () => {
    const { c } = s;
    c.health = 1; c.injury = 0; c.damageLog = {};
    c.chem.set('toxin', 0); c.chem.set('pain', 0);
  };
  return s;
}

const kit = { Evo, lab, session, trial, avoids };
const SCENARIOS = {}, REPORTS = {};
const dir = path.join(__dirname, 'scenarios');
for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort()) {
  const { scenarios, reports } = require(path.join(dir, file))(kit);
  Object.assign(SCENARIOS, scenarios);
  Object.assign(REPORTS, reports);
}

const args = process.argv.slice(2);
const showReport = args.includes('--report');
const [trialsArg, filter = ''] = args.filter(a => a !== '--report');
const trials = Number(trialsArg || 12);
for (const [name, scenario] of Object.entries(SCENARIOS)) {
  if (!name.includes(filter)) continue;
  const times = [];
  for (let seed = 1; seed <= trials; seed++) times.push(scenario(seed));
  const ok = times.filter(t => t !== null);
  const median = ok.length ? ok.sort((a, b) => a - b)[Math.floor(ok.length / 2)] : null;
  console.log(`${String(Math.round(ok.length / trials * 100)).padStart(3)}%  ${name.padEnd(48)} ${median !== null && median > 0 ? `median ${median} ticks` : ''}`);
}
if (showReport) {
  for (const [name, metric] of Object.entries(REPORTS)) {
    if (!name.includes(filter)) continue;
    let sum = 0;
    for (let seed = 1; seed <= trials; seed++) sum += metric(seed);
    console.log(`  ~  ${name.padEnd(48)} mean ${(sum / trials).toFixed(3)}`);
  }
}
