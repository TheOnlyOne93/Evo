'use strict';

test('genome: every founder gene declares the right payload length', (Evo, assert) => {
  for (const g of Evo.FOUNDER_GENES) {
    assert.strictEqual(g.length, 1 + Evo.GENES[g[0]].payload, `founder gene ${Evo.GENES[g[0]].name}`);
  }
});

test('genome: founders always carry exactly the founder genes', (Evo, assert) => {
  const expected = Evo.FOUNDER_GENES.map(g => g[0]);
  for (let i = 0; i < 300; i++) {
    const types = new Evo.Genome().findGenes().map(g => g.type);
    assert.deepStrictEqual(types, expected);
  }
});

test('genome: gene loss after a duplication removes a whole gene', (Evo, assert) => {
  const parent = new Evo.Genome();
  const before = parent.findGenes();
  const target = 3;
  // Script the random draws: no point mutations, duplicate gene #3 to the front, then lose gene #3
  const draws = [
    ...new Array(parent.dna.length).fill(0.99), // no point mutations
    0.0, (target + 0.5) / before.length, 0.0,   // duplicate gene #target, insert at position 0
    0.0, (target + 0.5) / (before.length + 1),   // lose gene #target of the new (longer) list
    0.99                                         // no small indel
  ];
  let i = 0;
  Evo.useRandomSource(() => (i < draws.length ? draws[i++] : 0.5));
  const child = parent.cloneWithMutation(0.035, true);
  Evo.seed(1);
  const after = child.findGenes();
  assert.strictEqual(after.length, before.length, 'one gene gained, one whole gene lost');
  // Every surviving gene is byte-for-byte a gene the parent had
  const bytes = (g, dna) => Array.from(dna.slice(g.start, g.end)).join(',');
  const parentGenes = new Set(before.map(g => bytes(g, parent.dna)));
  for (const g of after) assert.ok(parentGenes.has(bytes(g, child.dna)), 'no garbled gene');
});

test('genome: mutation keeps length in bounds and traits finite over many generations', (Evo, assert) => {
  let g = new Evo.Genome();
  for (let gen = 0; gen < 400; gen++) {
    g = g.cloneWithMutation(0.05, true);
    assert.ok(g.dna.length >= 96 - 1 && g.dna.length <= 768 + 20, `length ${g.dna.length}`);
    const t = g.develop();
    for (const [k, v] of Object.entries(t)) {
      if (typeof v === 'number') assert.ok(Number.isFinite(v), `${k} = ${v}`);
    }
  }
});

test('genome: clone keeps the family line mutation count', (Evo, assert) => {
  const g = new Evo.Genome().cloneWithMutation(0.05);
  assert.ok(g.mutationCount > 0);
  assert.strictEqual(g.clone().mutationCount, g.mutationCount);
});

test('genome: a hue gene byte of zero gives a red coat, not the default', (Evo, assert) => {
  const g = new Evo.Genome();
  const morph = g.findGenes().find(x => Evo.GENES[x.type].name === 'Morphology');
  g.dna[morph.start + 2] = 0;
  assert.strictEqual(g.develop().coatColorHue, 0);
});
