// Behaviour reports: one creature in a controlled situation over many seeds, and numbers on how its
// brain behaves (learning, memory, how it picks what to do). They never pass or fail: run them before
// and after a change and compare.
//   node tools/behave.js [trials=12] [filter] [--jobs N]   (in any order)
// Reports live in tools/scenarios/*.js. Each file exports ({ Evo, lab, session, run, trial }) =>
// reports, a map from a report's name to seed => number; each report's mean over the seeds is printed.
// The seeds are split across N worker processes (default: one per CPU thread, at most one per seed;
// --jobs 1 runs everything in this process). Every seed starts from its own seeded world, so the
// results don't depend on the split.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');
const Evo = require('../tests/load')();

// A quiet world with one creature (the first founder) and nothing else happening: no food grows, no
// wanderer comes, the other founder and the items are taken away, and so are the landscape's features
// and platforms (a report adds the things it needs), so only ponds could be in sight. The creature
// stands at the dry spot midway across the widest gap between two ponds, out of sight of both (it
// throws if a map change puts one in sight), its drives at 0. Returns { world, c }.
function lab(seed) {
  Evo.seed(seed);
  const world = new Evo.World();
  world.items = [];
  world.growFood = () => {};
  world.maybeWanderer = () => {};
  world.startPhase = 0.45;
  world.updateClock();
  const c = world.creatures[0];
  world.creatures = [c];
  world.features = [];
  world.platforms = [];
  const ponds = [...world.terrain.ponds].sort((p, q) => p.x0 - q.x0);
  let gap = [0, 0];
  for (let i = 1; i < ponds.length; i++) if (ponds[i].x0 - ponds[i - 1].x1 > gap[1] - gap[0]) gap = [ponds[i - 1].x1, ponds[i].x0];
  const spot = (gap[0] + gap[1]) / 2, sight = c.traits.visionRange + c.size * 0.4;
  if (ponds.some(p => spot > p.x0 - sight && spot < p.x1 + sight)) throw new Error(`behave: a pond is in sight of the lab spot x ${spot}`);
  Object.assign(c, { x: spot, y: world.terrain.groundY(spot), facing: 1, vx: 0, vy: 0 });
  for (const k of Evo.DRIVES) c.body.chem.set(k, 0);
  c.body.chem.set('glucose', 0.5); c.body.chem.set('water', 0.8); c.body.chem.set('adenosine', 0); c.body.chem.set('melatonin', 0);
  return { world, c };
}

// Run until done(world, creature, tick) is true, the creature dies, or `ticks` pass. Drives in
// setup.hold are set before every tick, and before(world, creature, tick) runs then too, just before
// the world steps. Returns { at: the tick it happened (or null), died }.
function run(setup, ticks, done, before) {
  const { world, c, hold } = setup;
  for (let t = 0; t < ticks; t++) {
    if (hold) for (const [k, v] of Object.entries(hold)) c.body.chem.set(k, v);
    if (before) before(world, c, t);
    world.step();
    if (done(world, c, t)) return { at: t, died: false };
    if (c.dead) return { at: null, died: true };
  }
  return { at: null, died: false };
}
// A report's tick: the tick at which done() happened, or null if it never did or the creature died.
const trial = (setup, ticks, done, before) => run(setup, ticks, done, before).at;

// A creature kept across trials: one world and brain, so learning carries over. place() puts an item
// dx pixels from the creature (clearing any others); resetBody() clears toxin, injury and pain and
// restores health, but keeps the brain.
function session(seed) {
  const s = lab(seed);
  s.place = (type, dx) => { s.world.items.length = 0; return s.world.spawnItem(type, s.c.x + dx); };
  s.resetBody = () => {
    const { c } = s;
    c.body.health = 1; c.body.injury = 0; c.body.damageLog = {};
    c.body.chem.set('toxin', 0); c.body.chem.set('pain', 0);
  };
  return s;
}

const kit = { Evo, lab, session, run, trial };
const REPORTS = {};
const dir = path.join(__dirname, 'scenarios');
for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort()) Object.assign(REPORTS, require(path.join(dir, file))(kit));

// Each selected report's result for the given seeds: { name: { seed: value } }
function measure({ seeds, filter }) {
  const out = {};
  for (const [name, fn] of Object.entries(REPORTS)) {
    if (!name.includes(filter)) continue;
    out[name] = {};
    for (const seed of seeds) out[name][seed] = fn(seed);
  }
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
const trialsArg = args.find(a => /^\d+$/.test(a));
const filter = args.find(a => !a.startsWith('-') && a !== trialsArg) || '';
const trials = Number(trialsArg || 12);
const jobs = Math.max(1, Math.min(trials, jobsArg ? Number(jobsArg) : os.availableParallelism()));
if (!Number.isInteger(jobs)) { console.error('usage: --jobs N (a whole number)'); process.exit(1); }
const seeds = Array.from({ length: trials }, (_, i) => i + 1);

(async () => {
  const opts = { filter };
  const results = jobs > 1 ? await pool(seeds, jobs, opts) : measure({ ...opts, seeds });
  const reportWidth = Math.max(...Object.keys(REPORTS).map(n => n.length));
  for (const name of Object.keys(REPORTS)) {
    if (!results[name]) continue;
    let sum = 0;
    for (const s of seeds) sum += results[name][s];   // In seed order, so the float sum is the same however the seeds were split
    console.log(`  ~  ${name.padEnd(reportWidth)} mean ${(sum / trials).toFixed(3)}`);
  }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
