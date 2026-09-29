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
