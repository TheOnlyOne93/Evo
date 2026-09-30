// Behaviour bench: one creature in a controlled situation, many trials, and how often (and how
// fast) it does the sensible thing. Drives are held at fixed levels during a trial.
//   node tools/behave.js [trials=12] [filter] [--report] [--jobs N]   (in any order)
// Scenarios live in tools/scenarios/*.js. Each file exports ({ Evo, lab, session, run, trial, avoids }) =>
// ({ scenarios, reports }): scenarios map a name to seed => tick it passed (null = fail); reports map a
// name to seed => number and are averaged and printed only with --report (they never gate anything).
// The seeds are split across N worker processes (default: one per CPU thread, at most one per seed;
// --jobs 1 runs everything in this process). Every seed starts from its own seeded world, so the
// results don't depend on the split.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');
const Evo = require('../tests/load')();
const { quietWorld } = require('../tests/helpers');

// A quiet world with one creature and nothing else happening, on open ground: the landscape's features
// and platforms are taken away (a scenario adds the ones it needs) so that only ponds could be in sight,
// and the creature stands at the dry spot midway across the widest gap between two ponds, out of sight
// of both (it throws if a map change puts one in sight). Besides { world, c }, it has
// placeAt(x, facing) to stand the creature on the ground at x, and count(eventName, [filter]) which
// returns a function giving how many such events (passing the filter) have happened since.
function lab(seed, { phase = 0.45 } = {}) {
  const s = quietWorld(Evo, seed, phase);
  const { world, c } = s;
  s.placeAt = (x, facing = 1) => Object.assign(c, { x, y: world.terrain.groundY(x), facing });
  s.count = (name, filter = () => true) => {
    let n = 0;
    world.events.on(name, e => { if (filter(e)) n++; });
    return () => n;
  };
  Object.assign(c, { vx: 0, vy: 0 });
  // Open ground: no feature or platform (shade, warmth, sight, scent, footing), only the scenario's own
  // items. The spot is the middle of the widest dry stretch between two ponds
  world.features = [];
  world.platforms = [];
  const ponds = [...world.terrain.ponds].sort((p, q) => p.x0 - q.x0);
  let gap = [0, 0];
  for (let i = 1; i < ponds.length; i++) if (ponds[i].x0 - ponds[i - 1].x1 > gap[1] - gap[0]) gap = [ponds[i - 1].x1, ponds[i].x0];
  const spot = (gap[0] + gap[1]) / 2, sight = c.traits.visionRange + c.size * 0.4;
  if (ponds.some(p => spot > p.x0 - sight && spot < p.x1 + sight)) throw new Error(`behave: a pond is in sight of the lab spot x ${spot}`);
  s.placeAt(spot);
  for (const k of Evo.DRIVES) c.chem.set(k, 0);
  c.chem.set('glucose', 0.5); c.chem.set('water', 0.8); c.chem.set('adenosine', 0); c.chem.set('melatonin', 0);
  return s;
}

// Run until done(world, creature, tick) is true, the creature dies, or `ticks` pass. Drives in
// setup.hold are set before every tick, and before(world, creature, tick) runs then too, just before
// the world steps. Returns { at: the tick it happened (or null), died }.
function run(setup, ticks, done, before) {
  const { world, c, hold } = setup;
  for (let t = 0; t < ticks; t++) {
    if (hold) for (const [k, v] of Object.entries(hold)) c.chem.set(k, v);
    if (before) before(world, c, t);
    world.step();
    if (done(world, c, t)) return { at: t, died: false };
    if (c.dead) return { at: null, died: true };
  }
  return { at: null, died: false };
}
// A scenario's score: the tick at which it passed, or null for a failure. Dying always fails.
// trial: pass when done() happens; avoids: pass when done() never happens and the creature lives.
const trial = (setup, ticks, done, before) => run(setup, ticks, done, before).at;
const avoids = (setup, ticks, done, before) => {
  const r = run(setup, ticks, done, before);
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

const kit = { Evo, lab, session, run, trial, avoids };
const SCENARIOS = {}, REPORTS = {};
const dir = path.join(__dirname, 'scenarios');
for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort()) {
  const { scenarios, reports } = require(path.join(dir, file))(kit);
  Object.assign(SCENARIOS, scenarios);
  Object.assign(REPORTS, reports);
}

// Each selected scenario's and report's result for the given seeds: { name: { seed: value } }
function measure({ seeds, filter, report }) {
  const out = {};
  const each = table => {
    for (const [name, fn] of Object.entries(table)) {
      if (!name.includes(filter)) continue;
      out[name] = {};
      for (const seed of seeds) out[name][seed] = fn(seed);
    }
  };
  each(SCENARIOS);
  if (report) each(REPORTS);
  return out;
}

// A worker: measure its seeds and send them back
if (process.argv[2] === '--child') {
  process.send(measure(JSON.parse(process.argv[3])));
  process.exit(0);
}

// Split the seeds across `jobs` worker processes (seed s goes to worker (s - 1) % jobs); resolves to
// their merged results
function pool(seeds, jobs, opts) {
  return Promise.all(Array.from({ length: jobs }, (_, j) => new Promise((resolve, reject) => {
    const mine = seeds.filter(s => (s - 1) % jobs === j);
    const child = fork(__filename, ['--child', JSON.stringify({ ...opts, seeds: mine })]);
    let got = null;
    child.on('message', r => { got = r; });
    child.on('exit', code => (got ? resolve(got) : reject(new Error(`worker ${j} exited ${code} without a result`))));
  }))).then(parts => {
    const out = {};
    for (const part of parts) for (const [name, bySeed] of Object.entries(part)) Object.assign(out[name] = out[name] || {}, bySeed);
    return out;
  });
}

const args = process.argv.slice(2);
const jobsAt = args.findIndex(a => a === '--jobs' || a.startsWith('--jobs='));
const jobsArg = jobsAt < 0 ? null : args[jobsAt].includes('=') ? args[jobsAt].split('=')[1] : args.splice(jobsAt + 1, 1)[0];
if (jobsAt >= 0) args.splice(jobsAt, 1);
const showReport = args.includes('--report');
const trialsArg = args.find(a => /^\d+$/.test(a));
const filter = args.find(a => !a.startsWith('-') && a !== trialsArg) || '';
const trials = Number(trialsArg || 12);
const jobs = Math.max(1, Math.min(trials, jobsArg ? Number(jobsArg) : os.availableParallelism()));
if (!Number.isInteger(jobs)) { console.error('usage: --jobs N (a whole number)'); process.exit(1); }
const seeds = Array.from({ length: trials }, (_, i) => i + 1);

(async () => {
  const opts = { filter, report: showReport };
  const results = jobs > 1 ? await pool(seeds, jobs, opts) : measure({ ...opts, seeds });
  const nameWidth = Math.max(...Object.keys(SCENARIOS).map(n => n.length));
  for (const name of Object.keys(SCENARIOS)) {
    if (!results[name]) continue;
    const ok = seeds.map(s => results[name][s]).filter(t => t !== null);
    const median = ok.length ? ok.sort((a, b) => a - b)[Math.floor(ok.length / 2)] : null;
    console.log(`${String(Math.round(ok.length / trials * 100)).padStart(3)}%  ${name.padEnd(nameWidth)} ${median !== null && median > 0 ? `median ${median} ticks` : ''}`);
  }
  const reportWidth = Math.max(...Object.keys(REPORTS).map(n => n.length));
  for (const name of Object.keys(REPORTS)) {
    if (!results[name]) continue;
    let sum = 0;
    for (const s of seeds) sum += results[name][s];   // In seed order, so the float sum is the same however the seeds were split
    console.log(`  ~  ${name.padEnd(reportWidth)} mean ${(sum / trials).toFixed(3)}`);
  }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
