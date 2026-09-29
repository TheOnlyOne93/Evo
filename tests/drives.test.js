'use strict';

const founderTraits = (Evo, sex = 'X') => Evo.Genome.founder(sex).develop();

test('drives: every drive has exactly one receptor into its own Drives cell, and no cell is shared', (Evo, assert) => {
  const traits = founderTraits(Evo);
  const needTargets = traits.receptors.filter(r => Evo.TARGETS[r.target].startsWith('need:'));
  for (const key of Evo.DRIVES) {
    const mine = needTargets.filter(r => r.chem === Evo.CHEM[key]);
    assert.strictEqual(mine.length, 1, `${key}: ${mine.length} receptors`);
    assert.strictEqual(Evo.TARGETS[mine[0].target], `need:${Evo.driveCell(key)}`, key);
  }
  const cells = needTargets.map(r => r.target);
  assert.strictEqual(new Set(cells).size, cells.length, 'no two receptors share a Drives cell');
});

test('drives: Drives cells have their own addresses, apart from every muscle', (Evo, assert) => {
  const tags = Evo.DRIVE_CELL_TAGS;
  assert.strictEqual(tags.length, Evo.N_NEEDS);
  for (let a = 0; a < tags.length; a++) {
    for (let b = a + 1; b < tags.length; b++) assert.ok(Math.hypot(tags[a][0] - tags[b][0], tags[a][1] - tags[b][1]) > 0.15);
  }
});

test('drives: a stimulus releases exactly amount x strength of each chemical, clamped to 0..1', (Evo, assert) => {
  const { CHEM, STIMULUS } = Evo;
  const b = new Evo.Biochemistry();
  b.configure({ reactions: [], emitters: [], receptors: [], halfLives: {},
    stimuli: [{ event: STIMULUS.patted, chem1: CHEM.reward, amount1: 0.2, chem2: CHEM.fear, amount2: -0.1 },
      { event: STIMULUS.slapped, chem1: 0, amount1: 0.4, chem2: CHEM.pain, amount2: 0.3 }] });
  b.set('fear', 0.5);
  b.stimulate(STIMULUS.patted, 0.5);
  assert.ok(Math.abs(b.get('reward') - 0.1) < 1e-6 && Math.abs(b.get('fear') - 0.45) < 1e-6);
  b.stimulate(STIMULUS.patted, 10);
  assert.strictEqual(b.get('reward'), 1, 'clamped at 1');
  assert.strictEqual(b.get('fear'), 0, 'clamped at 0');
  b.stimulate(STIMULUS.slapped);
  assert.ok(Math.abs(b.get('pain') - 0.3) < 1e-6, 'chemical slot 0 is nothing');
  b.stimulate(STIMULUS.woke);
  assert.ok(Math.abs(b.get('pain') - 0.3) < 1e-6, 'a stimulus without genes does nothing');
});

test('drives: a stimulus gene survives encoding and decodes to its event and amounts', (Evo, assert) => {
  const spec = { gene: 'Stimulus', event: Evo.STIMULUS.wasShoved, chem1: 'anger', amount1: 0.1, chem2: 'fear', amount2: -0.05 };
  const traits = new Evo.Genome([0, ...Evo.encodeGene(spec), 0], 'X').develop();
  assert.strictEqual(traits.stimuli.length, 1);
  const s = traits.stimuli[0];
  assert.strictEqual(Evo.STIMULI[s.event], 'wasShoved');
  assert.strictEqual(s.chem1, Evo.CHEM.anger); assert.strictEqual(s.chem2, Evo.CHEM.fear);
  assert.ok(Math.abs(s.amount1 - 0.1) < 0.002 && Math.abs(s.amount2 + 0.05) < 0.002);
  assert.ok(Evo.CODEC.signed.decode(0) === -0.5 && Evo.CODEC.signed.decode(128) === 0);
});

test('drives: the world raises stimuli where they physically happen', (Evo, assert) => {
  const world = new Evo.World();
  const [a, b] = world.creatures;
  const seen = [];
  for (const c of [a, b]) c.stimulate = function (key) { seen.push(`${c === a ? 'a' : 'b'}:${key}`); };
  world.pat(a); world.slap(a); world.nuzzle(a, b); world.shove(b, a); world.makeSound(a);
  const ball = world.spawnItem('ball', a.x, undefined, { hue: 0 });
  world.pickUpItem(a, ball); world.dropCarried(a);
  assert.deepStrictEqual(seen, ['a:patted', 'a:slapped', 'a:nuzzled', 'b:wasNuzzled', 'b:shoved', 'a:wasShoved', 'a:called', 'a:grabbed', 'a:played', 'a:dropped']);
});

// One founder, alone, eats an item of this type with hunger h; returns the reward peak within 10
// ticks and the summed reward and punishment over 30 ticks
function taste(Evo, type, h) {
  const world = new Evo.World();
  const c = world.creatures[0];
  for (const k of Evo.DRIVES) c.chem.set(k, 0);
  c.chem.set('hunger', h);
  c.ingest(world.foodOf({ type }));
  let peak = 0, reward = 0, punishment = 0;
  for (let t = 0; t < 30; t++) {
    c.readLoci(world); c.chem.step(c.loci); c.decayStimuli();
    if (t < 10) peak = Math.max(peak, c.chem.get('reward'));
    reward += c.chem.get('reward'); punishment += c.chem.get('punishment');
  }
  return { peak, reward, punishment };
}

test('drives: eating rewards at once, in proportion to hunger; bitter punishes', (Evo, assert) => {
  const hungry = taste(Evo, 'fruit', 0.7), sated = taste(Evo, 'fruit', 0);
  assert.ok(hungry.peak >= 0.15, `hungry fruit: reward peak ${hungry.peak}`);
  assert.ok(sated.peak < 0.03, `sated fruit: reward peak ${sated.peak}`);
  const mimic = taste(Evo, 'mimic', 0.7);
  assert.ok(mimic.punishment > mimic.reward, `mimic: punishment ${mimic.punishment} vs reward ${mimic.reward}`);
});

test('drives: the Up close cells report the look of what is at the mouth', (Evo, assert) => {
  const world = new Evo.World();
  const c = world.creatures[0];
  world.items = []; world.creatures = [c];
  Object.assign(c, { facing: 1, asleep: false });
  const near = () => { c.sense(world); return Object.fromEntries(c.brain.lobes.near.map((i, k) => [Evo.VISION_FEATURES[k].key, c.drive[i]])); };
  assert.ok(Object.values(near()).every(v => v === 0), 'nothing at the mouth');
  world.spawnItem('mimic', c.mouthX + 2, c.y);
  const d = near(), N = Evo.CREATURE.NEURAL_GAIN;
  assert.ok(Math.abs(d.red - 0.9 * N) < 1e-6 && Math.abs(d.violet - 0.25 * N) < 1e-6, JSON.stringify(d));
  for (const k in d) if (k !== 'red' && k !== 'violet') assert.strictEqual(d[k], 0, k);
});
