// Determinism check: run a few scripted worlds headless and hash their state, the creatures'
// poses and the plain-language text, so a refactor can prove it changed nothing (bit for bit).
//   node tools/fingerprint.js           print the hashes and event counts
//   node tools/fingerprint.js --save    write tools/fingerprint.json
//   node tools/fingerprint.js --check   compare with tools/fingerprint.json (exit 1 naming each section that differs)
'use strict';
const fs = require('fs');
const path = require('path');
const Evo = require('../tests/load')();

const FILE = path.join(__dirname, 'fingerprint.json');
const EVERY = 250;                 // Sample the world every this many ticks
const EVENTS = ['mate', 'egg', 'hatch', 'death', 'wanderer'];
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
  for (const ch of T.geneChanges(genome, [T.founderGenome(genome.sexChrom)])) {
    text.add(ch.kind).add(ch.gene ? ch.gene.start : ch.ref.gene.start);
    if (ch.kind === 'changed') text.add(JSON.stringify(T.fieldChanges(genome, ch.gene, ch.ref.genome, ch.ref.gene)));
  }
}

// One scripted world. crowd: fill it with adults first; killAt: at that tick the first creature's
// health drops below zero, so it dies the way the sim kills creatures (physiology, then handleDeath)
function run(seed, ticks, { crowd = false, killAt = 0 } = {}) {
  const start = Date.now();
  Evo.seed(seed);
  const world = new Evo.World();
  const base = world.creatures[0].id - 1;
  const counts = Object.fromEntries(EVENTS.map(e => [e, 0]));
  for (const e of EVENTS) world.events.on(e, () => counts[e]++);
  if (crowd) for (let i = 0; world.addAdult(i % 2 ? 'MALE' : 'FEMALE'); i++);
  const h = new Hash();
  for (let t = 1; t <= ticks; t++) {
    if (t === killAt) world.creatures[0].health = -1;
    world.step();
    if (t % EVERY) continue;
    sampleWorld(h, world, base);
    for (const c of world.creatures) pose.add(JSON.stringify(Evo.poseOf(c, { world })));
  }
  text.add(T.timeOfDay(world.clock.phase));
  for (const c of world.creatures) {
    describe(c.genome, c.brain, c.traits);
    text.add(T.clock(c.ageTicks)).add(T.ACTION_WORDS[c.action]);
  }
  return { hash: h.hex, counts, ms: Date.now() - start, alive: world.creatures.length };
}

const D = Evo.DAY_TICKS;
const runs = {
  'sim:seed1': run(1, 2 * D, { killAt: D / 4 }),
  'sim:seed2': run(2, 2 * D),
  'sim:crowd': run(3, D / 2, { crowd: true })
};
// The founder genome, with a brain built from it (both draw random numbers: seed them)
const t0 = Date.now();
Evo.seed(4);
const founder = Evo.Genome.founder();
const founderTraits = founder.develop();
describe(founder, new Evo.Brain(founderTraits), founderTraits);
const textMs = Date.now() - t0;

const sections = Object.fromEntries([...Object.entries(runs).map(([k, r]) => [k, r.hash]), ['pose', pose.hex], ['text', text.hex]]);
for (const [k, r] of Object.entries(runs)) {
  console.log(`${k.padEnd(10)} ${r.hash}  ${(r.ms / 1000).toFixed(1)} s  alive ${r.alive}  ${EVENTS.map(e => `${e} ${r.counts[e]}`).join(', ')}`);
}
console.log(`${'pose'.padEnd(10)} ${pose.hex}`);
console.log(`${'text'.padEnd(10)} ${text.hex}  (founder ${textMs} ms)`);
const missing = EVENTS.filter(e => Object.values(runs).every(r => !r.counts[e]));
if (missing.length) console.log(`warning: no run had ${missing.join(', ')}; extend the scripted runs`);

if (process.argv.includes('--save')) {
  fs.writeFileSync(FILE, JSON.stringify(sections, null, 2) + '\n');
  console.log(`saved ${path.relative(process.cwd(), FILE)}`);
} else if (process.argv.includes('--check')) {
  const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const differ = Object.keys({ ...saved, ...sections }).filter(k => saved[k] !== sections[k]);
  if (differ.length) {
    console.log(`fingerprint differs: ${differ.join(', ')}`);
    process.exit(1);
  }
  console.log('fingerprint matches');
}
