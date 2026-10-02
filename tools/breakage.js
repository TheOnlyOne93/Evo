// Breakages: each one breaks one part of the game on purpose. The tool runs the whole test suite once
// per breakage and shows which breakages no test noticed (gaps in the tests) and which tests no
// breakage tripped (tests that may catch nothing).
//   node tools/breakage.js [filter] [--jobs N]
// filter: run only the breakages whose name contains it. --jobs: how many runs go side by side
// (default: a sixth of the CPU threads, as each run already starts one process per test file).
// tests/kit.js applies the breakage named in EVO_BREAK, so every test file runs with it. Each run also
// plays the game's first day with the breakage (node tools/breakage.js --day prints a short hash of
// how the day ended), to tell a breakage that changes nothing from one the tests miss.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');

// ---------- Changing the game ----------
// Every change goes through method, wrap, replace and setAll, so a breakage whose target was renamed
// or removed fails loudly instead of quietly changing nothing.

// The function obj[name]
function method(obj, name) {
  if (typeof obj[name] !== 'function') throw new Error(`breakage: ${name} is not a function`);
  return obj[name];
}
// Swap the function obj[name] for make(the original)
const wrap = (obj, name, make) => { obj[name] = make(method(obj, name)); };
// Swap the function obj[name] for fn
const replace = (obj, name, fn) => wrap(obj, name, () => fn);
// Object.assign(obj, values), but every key must already be in obj
function setAll(obj, values) {
  for (const key of Object.keys(values)) if (!(key in obj)) throw new Error(`breakage: there is no ${key} to set`);
  Object.assign(obj, values);
}
// Where the entry with this key sits in a table such as Evo.MOTORS
function keyIndex(list, key) {
  const i = list.findIndex(x => x.key === key);
  if (i < 0) throw new Error(`breakage: there is no ${key}`);
  return i;
}

// Change a creature's genes as they go into its chemistry, or as they grow into its traits
const onConfigure = (E, edit) => wrap(E.Biochemistry.prototype, 'configure', o => function (t) { o.call(this, t); edit(this); });
const onTraits = (E, edit) => wrap(E.Genome.prototype, 'develop', o => function (s) { const t = o.call(this, s); edit(t); return t; });
// Change what the brain's sense cells get, right after the senses run (L: the brain's regions)
const afterSense = (E, edit) => wrap(E.senses, 'sense', o => function (c, w) { o(c, w); edit(c.brain.lobes, c.input); });
const swap = (input, a, b) => { const t = input[a]; input[a] = input[b]; input[b] = t; };
const swapHalves = (input, cells) => { const h = cells.length / 2; for (let k = 0; k < h; k++) swap(input, cells[k], cells[k + h]); };
const zero = (input, cells) => { for (const i of cells) input[i] = 0; };
// Change which muscle cells fired, for the muscles only: the brain's own record is put back after
const beforeAct = (E, edit) => wrap(E.muscles, 'act', o => function (c, w) {
  const b = c.brain, m = b.lobes.motor, saved = m.map(i => b.hist[i]);
  edit(b.hist, m);
  o(c, w);
  m.forEach((i, k) => { b.hist[i] = saved[k]; });
});
// The default map's spec, which a breakage changes in place before any world or landscape is built
const defaultMap = E => E.MAPS[E.DEFAULT_MAP];
// The first of the items, in the order they are sorted by `before`; none fails loudly
function first(items, what, before = () => 0) {
  if (!items.length) throw new Error(`breakage: the default map has no ${what}`);
  return [...items].sort(before)[0];
}
// The default map's eastmost pond
const eastPond = map => first(map.ponds, 'pond', (a, b) => b.x1 - a.x1);
const motorK = (E, key) => keyIndex(E.MOTORS, key);
// A muscle that does nothing: its cell's spikes never reach it
const silence = key => E => { const k = motorK(E, key); beforeAct(E, (hist, m) => { hist[m[k]] = (hist[m[k]] & ~1) >>> 0; }); };

const breakages = {
  'chem: no half-lives': E => onConfigure(E, b => b.keep.fill(1)),
  'chem: no reactions': E => onConfigure(E, b => setAll(b, { reactions: [] })),
  'chem: no emitters': E => onConfigure(E, b => setAll(b, { emitters: [] })),
  'chem: no receptors': E => onConfigure(E, b => setAll(b, { receptors: [] })),
  'chem: receptors never lower their target': E => onConfigure(E, b => setAll(b, { receptors: b.receptors.map(r => ({ ...r, negative: false })) })),
  'chem: emitters never inverted': E => onConfigure(E, b => setAll(b, { emitters: b.emitters.map(r => ({ ...r, invert: false })) })),
  'chem: stimuli release nothing': E => replace(E.Biochemistry.prototype, 'stimulate', function () {}),
  'brain: no learning (rate 0)': E => onTraits(E, t => setAll(t, { learningRate: 0 })),
  'brain: no value prediction': E => wrap(E.Brain.prototype, 'rebuildAdjacency', o => function () {
    o.call(this);
    setAll(this, { valueIn: this.valueIn.map(() => new Int32Array(0)) });
  }),
  'brain: no competition or persistence': E => replace(E.Brain.prototype, 'applyDynamics', function () {}),
  'brain: every delay 1 tick': E => wrap(E.Brain.prototype, 'addSynapse', o => function (...a) { const s = o.apply(this, a); if (s >= 0) this.sDelay[s] = 1; return s; }),
  // Morphogenesis keeps its synaptic scaling (it also runs that), but no synapse sprouts or is pruned
  'brain: no sprouting or pruning': E => {
    const scale = method(E.Brain.prototype, 'scaleSynapses');
    replace(E.Brain.prototype, 'runMorphogenesis', function () { scale.call(this); });
  },
  'brain: no threshold balancing': E => wrap(E.Brain.prototype, 'initNeurons', o => function () { o.call(this); this.homeo.fill(0); }),
  'brain: no seizure brake': E => wrap(E.Brain.prototype, 'tick', o => function (i, opts) { setAll(this, { brake: 0, overdrive: 0 }); return o.call(this, i, opts); }),
  'brain: no dreams': E => replace(E.Brain.prototype, 'sleepStep', function () {}),
  'brain: no remembered surprises': E => replace(E.Brain.prototype, 'rememberEpisode', function () {}),
  'brain: no eligibility memory': E => onTraits(E, t => setAll(t, { traceDecay: 0 })),
  'brain: guidance sides crossed': E => wrap(E.Brain.prototype, 'tractTargets', o => function (rule, s) {
    const side = rule.source.side, crossed = side === 'same' ? 'other' : side === 'other' ? 'same' : side;
    return o.call(this, { ...rule, source: { ...rule.source, side: crossed } }, s);
  }),
  'brain: no noise': E => wrap(E.Brain.prototype, 'tick', o => function (i, opts) { return o.call(this, i, { ...opts, noise: 0 }); }),
  'brain: fires without energy': E => wrap(E.Brain.prototype, 'tick', o => function (i, opts) { return o.call(this, i, { ...opts, canFire: true }); }),
  'body: no running costs': E => setAll(E.BODY.cost, { basal: 0, shiver: 0, work: 0, spike: 0 }),
  'body: no water loss': E => setAll(E.BODY.water, { loss: 0, pant: 0 }),
  'body: no heat exchange with the air': E => setAll(E.BODY.heat, { exchange: 0 }),
  'body: no growth': E => setAll(E.BODY.scale, { growth: 0 }),
  'body: no healing': E => setAll(E.BODY.scale, { healing: 0 }),
  'body: chemicals do no harm': E => setAll(E.BODY.scale, { damage: 0 }),
  'body: no starvation or thirst harm': E => setAll(E.BODY.harm, { starvation: 0, dehydration: 0 }),
  'body: sleep never changes by itself': E => replace(E.Body.prototype, 'updateSleep', function () {}),
  'body: never wakes': E => replace(E.Body.prototype, 'wake', function () {}),
  'body: touch never fades': E => replace(E.Body.prototype, 'fade', function () {}),
  'body: strength always full': E => wrap(E.Body.prototype, 'physiology', o => function (c, w) { const r = o.call(this, c, w); setAll(this, { strength: 1 }); return r; }),
  'body: gives off no scent': E => setAll(E.BODY.scale, { scentSex: 0, scentAlarm: 0 }),
  'body: food has no taste': E => replace(E.Body.prototype, 'ingest', function (food) { for (const k in food) this.chem.add(k, food[k]); }),
  // Below the speed of a hard landing, so a fall from any height lands softly
  'body: falls are slowed, so no landing is hard': E => wrap(E.Creature.prototype, 'settle', o => function (world) {
    if (!this.onGround && this.vy > 4) setAll(this, { vy: 4 });
    return o.call(this, world);
  }),
  'senses: sight mirrored': E => afterSense(E, (L, inp) => swapHalves(inp, L.sight)),
  'senses: smell mirrored': E => afterSense(E, (L, inp) => swapHalves(inp, L.smell)),
  'senses: hearing mirrored': E => afterSense(E, (L, inp) => swapHalves(inp, L.hearing)),
  'senses: touch mirrored': E => {
    const [l, r, ml, mr] = ['contactL', 'contactR', 'mouthL', 'mouthR'].map(k => keyIndex(E.TOUCH, k));
    afterSense(E, (L, inp) => { swap(inp, L.touch[l], L.touch[r]); swap(inp, L.touch[ml], L.touch[mr]); });
  },
  'senses: blind': E => afterSense(E, (L, inp) => zero(inp, L.sight)),
  'senses: no smell': E => afterSense(E, (L, inp) => zero(inp, L.smell)),
  'senses: drives not felt': E => afterSense(E, (L, inp) => zero(inp, L.needs)),
  'senses: nothing seen up close': E => afterSense(E, (L, inp) => zero(inp, L.near)),
  'senses: no touch': E => afterSense(E, (L, inp) => zero(inp, L.touch)),
  'senses: no taste cells': E => afterSense(E, (L, inp) => zero(inp, L.taste)),
  'senses: no reward or punishment reaches the brain': E => wrap(E.senses, 'fromBody', o => function (c) { const r = o(c); c.brain.outcome.fill(0); return r; }),
  'senses: no novelty': E => replace(E.senses, 'noticeNovelty', c => { c.novelty = 0; return 0; }),
  'muscles: walk left and right swapped': E => {
    const l = motorK(E, 'walkL'), r = motorK(E, 'walkR');
    beforeAct(E, (hist, m) => {
      const a = hist[m[l]] & 1, b = hist[m[r]] & 1;
      hist[m[l]] = ((hist[m[l]] & ~1) | b) >>> 0;
      hist[m[r]] = ((hist[m[r]] & ~1) | a) >>> 0;
    });
  },
  'muscles: eat does nothing': silence('eat'),
  'muscles: drink does nothing': silence('drink'),
  'muscles: jump does nothing': silence('jump'),
  'muscles: call does nothing': silence('call'),
  'muscles: rest does nothing': silence('rest'),
  'muscles: run does nothing': silence('run'),
  'muscles: grab does nothing': silence('grab'),
  'world: scent does not spread or fade': E => replace(E, 'diffuse', function (grid, next, cols, rows, rate, keep, eps, solid, box) { return box; }),
  'world: no mating': E => replace(E.World.prototype, 'tryMating', function () {}),
  'world: eggs never hatch': E => replace(E.World.prototype, 'hatch', function () {}),
  'world: no food grows': E => replace(E.World.prototype, 'growFood', function () {}),
  'world: one temperature everywhere, always': E => replace(E.World.prototype, 'temperatureAt', function () { return 0.5; }),
  'world: no company, crowding or touch between creatures': E => replace(E.World.prototype, 'socialContact', function () {}),
  'world: thorns never prick': E => replace(E.World.prototype, 'prickCreatures', function () {}),
  'world: queued deeds never land': E => replace(E.World.prototype, 'applyQueuedDeeds', function () { this.pendingDeeds.length = 0; }),
  'world: first in the list wins a contested item': E => replace(E.World.prototype, 'applyQueuedDeeds', function () {
    const taken = new Set();
    for (const { creature: c, kind, target } of this.pendingDeeds) {
      if (kind === 'bite' || kind === 'pickUp') {
        if (taken.has(target)) continue;
        taken.add(target);
        if (kind === 'bite') this.eatItem(c, target); else this.pickUpItem(c, target);
      } else if (kind === 'drop') {
        if (c.carrying === target) this.dropCarried(c);
      } else if (kind === 'shove') this.shove(c, target);
      else this.nuzzle(c, target);
    }
    this.pendingDeeds.length = 0;
  }),
  'world: no wanderers': E => replace(E.World.prototype, 'maybeWanderer', function () {}),
  'world: no walls at the ends': E => replace(E.World.prototype, 'clampX', function (x) { return x; }),
  'hand: a tickle does nothing': E => replace(E.World.prototype, 'pat', function () {}),
  'world: warmth does not change incubation': E => replace(E.World.prototype, 'incubate', function (egg) { egg.progress += 1 / egg.incubationTicks; return egg.progress >= 1; }),
  'world: the dead leave no carrion': E => wrap(E.World.prototype, 'handleDeath', o => function (c) {
    o.call(this, c);
    const left = this.items.pop();
    if (!left || left.type !== 'carrion') throw new Error('breakage: the dead left no carrion to take away');
  }),
  'world: the seed bank is ignored': E => wrap(E.World.prototype, 'addFromBank', o => function (sex, fromEdge) {
    const bank = this.seedBank;
    setAll(this, { seedBank: [] });
    try { return o.call(this, sex, fromEdge); } finally { setAll(this, { seedBank: bank }); }
  }),
  'creature: never changes life stage': E => replace(E.Creature.prototype, 'enterStage', function () {}),
  'genome: no mutation': E => replace(E.Genome.prototype, 'cloneWithMutation', function () { return this.clone(); }),
  'genome: no crossover': E => replace(E.Genome, 'recombine', function (m, f) {
    const c = new E.Genome(m.dna, null);
    setAll(c, { mutationCount: Math.max(m.mutationCount, f.mutationCount) });
    return c.cloneWithMutation();
  }),
  'genome: every gene on from birth': E => wrap(E.Genome.prototype, 'develop', o => function () { return o.call(this, Infinity); }),
  // The 0..1 values most genes are made of read back pushed toward the middle: their byte is clamped
  // to the middle half of 0..255 before it is read, so 0..1 reads as 0.25..0.75
  'genome: gene values clamped as they are read': E => wrap(E.CODEC.unit, 'decode', o => b => o(Math.min(Math.max(b, 255 / 4), 255 * 3 / 4))),
  // The frame clock runs at the normal speed whatever speed was chosen
  'clock: speed ignored': E => wrap(E.FrameClock.prototype, 'advance', o => function (frameMs, speed, paused) { return o.call(this, frameMs, 1, paused); }),
  // The frame clock runs ticks even while paused
  'clock: runs while paused': E => wrap(E.FrameClock.prototype, 'advance', o => function (frameMs, speed) { return o.call(this, frameMs, speed, false); }),
  // Ticks a slow frame couldn't run are put back on what the clock owes, so the next frame runs them
  'clock: owes the ticks a slow frame dropped': E => wrap(E.FrameClock.prototype, 'report', o => function (ran) {
    const missing = this.wanted - ran;
    o.call(this, ran);
    if (missing > 0) setAll(this, { owed: this.owed + missing });
  }),
  // A long stall runs every tick it missed: the ticks the frame clock's cap cut off a frame are owed too
  'clock: no cap on a long stall': E => wrap(E.FrameClock.prototype, 'advance', o => function (frameMs, speed, paused) {
    const ticks = o.call(this, frameMs, speed, paused), fullMs = Math.max(frameMs, 0);
    const owed = paused ? 0 : this.owed + (fullMs - this.frameMs) / 1000 * E.TICKS_PER_SECOND * speed, more = Math.floor(owed);
    setAll(this, { frameMs: fullMs, owed: owed - more, wanted: ticks + more });
    return ticks + more;
  }),
  // The default map's first tree moves to the middle of its first pond, before any world is built
  'map: a feature stands in a pond': E => {
    const map = defaultMap(E), pond = map.ponds[0], tree = map.features.find(f => f.kind === 'tree');
    if (!pond || !tree) throw new Error('breakage: the default map has no pond or no tree');
    setAll(tree, { x: (pond.x0 + pond.x1) / 2 });
  },
  // The male founder's spot moves to the middle of the pond nearest to it
  'map: a founder starts in a pond': E => {
    const map = defaultMap(E), at = map.founders.MALE;
    const middle = p => (p.x0 + p.x1) / 2;
    const pond = first(map.ponds, 'pond', (a, b) => Math.abs(middle(a) - at) - Math.abs(middle(b) - at));
    setAll(map.founders, { MALE: middle(pond) });
  },
  // The eastmost pond is too shallow to drink from
  'map: a pond too shallow to drink from': E => setAll(eastPond(defaultMap(E)), { depth: 10 }),
  // The eastmost pond is gone, so there is no water near the east end of the world
  'map: no water near the east end': E => {
    const map = defaultMap(E), east = eastPond(map);
    setAll(map, { ponds: map.ponds.filter(p => p !== east) });
  },
  // The mimic tree moves to stand 100 px east of the fruit tree
  'map: the mimic tree stands beside a fruit tree': E => {
    const trees = defaultMap(E).features.filter(f => f.kind === 'tree');
    const fruit = first(trees.filter(t => t.species === 'fruit'), 'fruit tree');
    setAll(first(trees.filter(t => t.species === 'mimic'), 'mimic tree'), { x: fruit.x + 100 });
  }
};

module.exports = { breakages };

// ---------- Running the tests with each breakage ----------
const NONE = '(none)';

// One day of the game's own world with the breakage in EVO_BREAK (tests/kit.js applies it), as a short
// hash of how the day ended: the stats, the clock, the items, and where each creature is, its health
// and its chemistry
function dayHash() {
  const { Evo, game } = require('../tests/kit.js');
  const world = game(Evo.DEFAULT_SEED, Evo.DAY_TICKS);
  const end = [world.stats, world.clock.tick, world.items.length,
    world.creatures.map(c => [c.x, c.y, c.body.health, Evo.CHEMICALS.map(k => c.body.chem.get(k.key))])];
  return crypto.createHash('sha1').update(JSON.stringify(end)).digest('hex').slice(0, 12);
}

// Run node with these arguments and the breakage `name` in EVO_BREAK (none for NONE); resolves to
// { code, out }, out being everything it printed
function runNode(args, name) {
  const env = { ...process.env };
  delete env.EVO_BREAK;
  if (name !== NONE) env.EVO_BREAK = name;
  return new Promise(resolve => {
    const child = spawn(process.execPath, args, { cwd: root, env });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('close', code => resolve({ code, out }));
  });
}

// The first line of the first error in what a run printed
function firstError(out) {
  const m = /^(?:# )?(\w*Error\b.*)$/m.exec(out);
  return m ? m[1].trim() : 'no error line';
}

// Node's TAP output says which file a test is in only when it fails, so for the others: the file
// whose test(...) has that name, by name
function declaredFiles() {
  const fileOf = {}, dir = path.join(root, 'tests');
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.test.js'))) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const m of source.matchAll(/\btest\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)) fileOf[m[2].replace(/\\(.)/g, '$1')] = file;
  }
  return fileOf;
}

// What a run's TAP output says: every test that ran and those that failed, each as 'file: name' (to-dos
// and skips left out), and the test files that crashed while loading
function readTap(out, fileOf) {
  const lines = out.split(/\r?\n/), tests = [], failed = [], crashed = [];
  lines.forEach((line, k) => {
    const m = /^(not )?ok \d+ - (.*?)( # (TODO|SKIP)\b.*)?$/.exec(line);
    if (!m || m[3]) return;
    const name = m[2].replace(/\\(.)/g, '$1');
    if (m[1] && name.endsWith('.test.js')) { crashed.push(name.split(/[\\/]/).pop()); return; }
    // Its location is in the block of indented lines just below
    let file = fileOf[name] || '?';
    for (let j = k + 1; j < lines.length && /^\s/.test(lines[j]); j++) {
      const at = /^\s+location: '(.*):\d+:\d+'$/.exec(lines[j]);
      if (at) file = at[1].split(/[\\/]+/).pop();
    }
    tests.push(`${file}: ${name}`);
    if (m[1]) failed.push(`${file}: ${name}`);
  });
  return { tests, failed, crashed };
}

// One run: the tests and the day, side by side, with this breakage
async function measure(name, fileOf) {
  const [tests, day] = await Promise.all([
    runNode(['--test', '--test-reporter=tap', 'tests/*.test.js'], name),
    runNode([__filename, '--day'], name)
  ]);
  const hash = day.out.trim().split(/\r?\n/).pop();
  return {
    name, ...readTap(tests.out, fileOf), crash: firstError(tests.out),
    day: day.code === 0 && /^[0-9a-f]{12}$/.test(hash) ? hash : null, dayCrash: firstError(day.out)
  };
}

// What a breakage did to the day, against nothing broken
const dayNote = (r, none) => (r.day === null ? `its day crashes: ${r.dayCrash}` : r.day === none.day ? 'changes nothing in a day' : 'changes the game');

const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// A finished run's line
function summary(r, none) {
  const notes = [];
  if (r.crashed.length) notes.push(`crashes: ${r.crash}`);
  if (r.day === null || r.day === none.day) notes.push(dayNote(r, none));
  return `${r.name}: ${r.failed.length ? `${count(r.failed.length, 'test')} failed` : 'NOT NOTICED'}${notes.map(x => ` (${x})`).join('')}`;
}

// Run each item through fn, `jobs` at a time
async function pool(items, jobs, fn) {
  let next = 0;
  const worker = async () => { while (next < items.length) await fn(items[next++]); };
  await Promise.all(Array.from({ length: Math.min(jobs, items.length) }, worker));
}

async function sweep(args) {
  const at = args.indexOf('--jobs');
  const jobs = at < 0 ? Math.max(1, Math.floor(os.availableParallelism() / 6)) : Number(args.splice(at, 2)[1]);
  const filter = args[0] || '';
  if (!Number.isInteger(jobs) || jobs < 1) throw new Error('usage: node tools/breakage.js [filter] [--jobs N]');
  const names = Object.keys(breakages).filter(n => n.includes(filter));
  if (!names.length) throw new Error(`no breakage name contains "${filter}"`);
  const start = Date.now(), fileOf = declaredFiles();

  // Nothing broken, alone: every test must pass, or what the breakages trip means nothing
  const none = await measure(NONE, fileOf);
  const wrong = [...none.failed, ...none.crashed.map(f => `${f} crashes: ${none.crash}`)];
  if (none.day === null) wrong.push(`the day crashes: ${none.dayCrash}`);
  if (wrong.length) {
    console.log(`${NONE} fails, so no breakage was run:\n  ${wrong.join('\n  ')}`);
    process.exitCode = 1;
    return;
  }
  console.log(`${NONE}: all ${none.tests.length} tests pass (to-dos left out)`);

  const results = {};
  await pool(names, jobs, async name => {
    results[name] = await measure(name, fileOf);
    console.log(summary(results[name], none));
  });

  const ran = names.map(n => results[n]), list = lines => (lines.length ? lines.map(l => `  ${l}`).join('\n') : '  none');
  const sound = ran.filter(r => !r.crashed.length);
  console.log(`\nBreakages no test noticed:\n${list(sound.filter(r => !r.failed.length).map(r => `${r.name}: ${dayNote(r, none)}`))}`);
  console.log(`\nBreakages that crash the tests:\n${list(ran.filter(r => r.crashed.length).map(r => `${r.name}: ${r.crash}`))}`);
  const tripped = new Set(sound.flatMap(r => r.failed));
  console.log(`\nTests no breakage tripped${filter ? ` (only the breakages that contain "${filter}" were run)` : ''}:`);
  console.log(list(none.tests.filter(t => !tripped.has(t))));
  console.log(`\n${count(names.length, 'breakage')} in ${((Date.now() - start) / 60000).toFixed(1)} min`);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === '--day') console.log(dayHash());
  else sweep(args).catch(e => { console.error(e.message); process.exitCode = 1; });
}
