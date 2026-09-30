// Determinism check: run a few scripted worlds headless and hash their state, the creatures'
// poses and the plain-language text, so a refactor can prove it changed nothing (bit for bit).
// Each world runs in its own process, side by side.
//   node tools/fingerprint.js           print the hashes and event counts
//   node tools/fingerprint.js --save    write tools/fingerprint.json
//   node tools/fingerprint.js --check   compare with tools/fingerprint.json (exit 1 naming each section that differs)
'use strict';
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const Evo = require('../tests/load')();

const FILE = path.join(__dirname, 'fingerprint.json');
const EVERY = 250;                 // Sample the world every this many ticks
const EVENTS = ['mate', 'egg', 'hatch', 'death', 'wanderer'];
const CROWD = { adults: 8, span: 300 }; // The crowd run: this many adults in all, the added ones within span px around the first grass
const T = Evo.text;

// FNV-1a 32-bit over strings (UTF-16 code units); each value ends with a separator
class Hash {
  constructor() { this.h = 0x811c9dc5; }
  add(v) {
    const s = String(v);
    let h = this.h;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    this.h = Math.imul(h ^ 0x1f, 0x01000193);
    return this;
  }
  all(arr, n = arr.length) { for (let i = 0; i < n; i++) this.add(arr[i]); return this; }
  get hex() { return (this.h >>> 0).toString(16).padStart(8, '0'); }
}

// This process's pose and text hashes: one run's (in a worker), or the founder's text (in the parent)
const pose = new Hash(), text = new Hash();

// Ids come from one counter shared by every run: hash them relative to the run's first id, so
// each sim section depends on its own run only
function sampleWorld(h, world, base) {
  const rel = id => (typeof id === 'number' ? id - base : id);
  h.add(world.clock.tick).add(world.season.key).add(JSON.stringify(world.stats)).add(world.foodCount);
  for (const c of world.creatures) {
    h.all([rel(c.id), c.x, c.y, c.vx, c.vy, c.facing, c.stage, c.growth, c.health, c.injury, c.bodyTemp, c.action, c.dead, c.asleep]);
    h.all(c.chem.c);
    const b = c.brain;
    h.add(b.N).add(b.S).all(b.sSrc, b.S).all(b.sDst, b.S).all(b.sW, b.S).all(b.sDelay, b.S).all(b.v).all(b.thr);
  }
  for (const i of world.items) h.all([rel(i.id), i.type, i.x, i.y, i.vx, i.vy, i.age, rel(i.heldBy), i.progress, i.hue, i.home]);
}

// Every Evo.text output a genome (and its brain and traits) can drive
function describe(genome, brain, traits) {
  for (const gene of genome.findGenes()) text.add(JSON.stringify(T.describeGene(genome, gene, brain)));
  for (const n of brain.neurons) text.add(T.neuronName(brain, n)).add(T.neuronRole(brain, n)).add(T.lobeName(brain, n));
  for (const lobe of Object.keys(brain.lobes)) text.add(T.regionName(brain, lobe)).add(T.regionAbout(brain, lobe));
  text.add(JSON.stringify(T.traitWords(traits)));
  for (const ch of T.geneChanges(genome, T.founderGenomes())) {
    text.add(ch.kind).add(ch.gene ? ch.gene.start : ch.ref.gene.start);
    if (ch.kind === 'changed') text.add(JSON.stringify(T.fieldChanges(genome, ch.gene, ch.ref.genome, ch.ref.gene)));
  }
}

// One scripted world. crowd: add adults up to CROWD.adults, close together, so they crowd each other;
// killAt: at that tick the first creature's health drops below zero, so it dies the way the sim kills
// creatures (physiology, then handleDeath). Also returns the peak crowding and anger, to show what
// the run covers.
function run(seed, ticks, { crowd = false, killAt = 0 } = {}) {
  const start = Date.now();
  Evo.seed(seed);
  const world = new Evo.World();
  const base = world.creatures[0].id - 1;
  const counts = Object.fromEntries(EVENTS.map(e => [e, 0]));
  for (const e of EVENTS) world.events.on(e, () => counts[e]++);
  if (crowd) {
    const x = world.features.find(f => f.kind === 'grass').x;
    for (let i = 0; world.creatures.length < CROWD.adults; i++) world.addAdult(i % 2 ? 'MALE' : 'FEMALE', { x: x + Evo.randRange(-0.5, 0.5) * CROWD.span });
  }
  const h = new Hash();
  const peak = { crowding: 0, anger: 0 };
  for (let t = 1; t <= ticks; t++) {
    if (t === killAt) world.creatures[0].health = -1;
    world.step();
    for (const c of world.creatures) {
      peak.crowding = Math.max(peak.crowding, c.crowding);
      peak.anger = Math.max(peak.anger, c.chem.get('anger'));
    }
    if (t % EVERY) continue;
    sampleWorld(h, world, base);
    for (const c of world.creatures) pose.add(JSON.stringify(Evo.poseOf(c, { world })));
  }
  text.add(T.timeOfDay(world.clock.phase));
  for (const c of world.creatures) {
    describe(c.genome, c.brain, c.traits);
    text.add(T.clock(c.ageTicks)).add(T.ACTION_WORDS[c.action]);
  }
  return { hash: h.hex, pose: pose.hex, text: text.hex, counts, peak, ms: Date.now() - start, alive: world.creatures.length };
}

const D = Evo.DAY_TICKS;
const RUNS = {
  'sim:seed1': [1, 2 * D, { killAt: D / 4 }],
  'sim:seed2': [2, 2 * D],
  'sim:crowd': [3, D / 2, { crowd: true }]
};

// A worker: one run
if (process.argv[2] === '--child') {
  process.send(run(...RUNS[process.argv[3]]));
  process.exit(0);
}

const workers = Object.keys(RUNS).map(name => new Promise((resolve, reject) => {
  const child = fork(__filename, ['--child', name]);
  let got = null;
  child.on('message', r => { got = r; });
  child.on('exit', code => (got ? resolve(got) : reject(new Error(`${name} exited ${code} without a result`))));
}));
// Meanwhile: the first female's genome, with a brain built from it (the brain draws random numbers: seed them)
const t0 = Date.now();
Evo.seed(4);
const founder = Evo.Genome.founder('FEMALE');
const founderTraits = founder.develop();
describe(founder, new Evo.Brain(founderTraits), founderTraits);
const textMs = Date.now() - t0;

Promise.all(workers).then(results => {
  const runs = Object.fromEntries(Object.keys(RUNS).map((name, i) => [name, results[i]]));
  // The pose and text sections: each run's hash in a fixed order (and the founder's text last)
  const poses = new Hash().all(results.map(r => r.pose)), texts = new Hash().all(results.map(r => r.text)).add(text.hex);
  const sections = Object.fromEntries([...Object.entries(runs).map(([k, r]) => [k, r.hash]), ['pose', poses.hex], ['text', texts.hex]]);
  for (const [k, r] of Object.entries(runs)) {
    console.log(`${k.padEnd(10)} ${r.hash}  ${(r.ms / 1000).toFixed(1)} s  alive ${r.alive}  ${EVENTS.map(e => `${e} ${r.counts[e]}`).join(', ')}` +
      `  (peak crowding ${r.peak.crowding.toFixed(2)}, anger ${r.peak.anger.toFixed(2)})`);
  }
  console.log(`${'pose'.padEnd(10)} ${poses.hex}`);
  console.log(`${'text'.padEnd(10)} ${texts.hex}  (founder ${textMs} ms)`);
  const missing = EVENTS.filter(e => results.every(r => !r.counts[e]));
  if (missing.length) console.log(`warning: no run had ${missing.join(', ')}; extend the scripted runs`);
  if (results.every(r => !r.peak.crowding)) console.log('warning: no run was crowded; bring the crowd closer together');
  finish(sections);
}).catch(e => { console.error(e.message); process.exitCode = 1; });

function finish(sections) {
  if (process.argv.includes('--save')) {
    fs.writeFileSync(FILE, JSON.stringify(sections, null, 2) + '\n');
    console.log(`saved ${path.relative(process.cwd(), FILE)}`);
  } else if (process.argv.includes('--check')) {
    const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const differ = Object.keys({ ...saved, ...sections }).filter(k => saved[k] !== sections[k]);
    if (differ.length) {
      console.log(`fingerprint differs: ${differ.join(', ')}`);
      process.exitCode = 1;
      return;
    }
    console.log('fingerprint matches');
  }
}
