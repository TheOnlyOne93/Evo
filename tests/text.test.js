'use strict';

// Evo.text: the plain-language names and descriptions the inspector shows

const { founderBrain } = require('./helpers');

test('text: every neuron has a plain-language name', (Evo, assert) => {
  const brain = founderBrain(Evo);
  for (const n of brain.neurons) {
    const name = Evo.text.neuronName(brain, n);
    assert.ok(name && !/undefined|NaN/.test(name), `neuron ${n.index} (${n.lobe}) -> ${name}`);
    assert.ok(!/undefined/.test(Evo.text.lobeName(brain, n)));
  }
});

test('text: every kind of gene describes itself in plain words', (Evo, assert) => {
  const brain = new Evo.Brain(Evo.Genome.founder().develop());
  const seen = new Set();
  for (let i = 0; i < 30; i++) {
    const g = Evo.Genome.founder().cloneWithMutation(0.3);
    for (const gene of g.findGenes()) {
      const d = Evo.text.describeGene(g, gene, brain);
      seen.add(d.name);
      assert.ok(['body', 'brain', 'chemistry', 'instinct'].includes(d.group), `${d.name}: group ${d.group}`);
      assert.ok(d.text && !/undefined|NaN/.test(d.text), `${d.name}: ${d.text}`);
    }
  }
  assert.strictEqual(seen.size, Evo.GENES.length, 'every gene kind was seen');
});

test('text: a brain-building gene that switches on after birth says it has no effect', (Evo, assert) => {
  const g = Evo.Genome.founder('X', [{ gene: 'Region duplication', stage: Evo.STAGE.ADULT, source: 'cortex', depth: 0.5, lateral: 0.5, chemShift: 0.5, input: 0.5 },
    { gene: 'Region duplication', stage: 0, source: 'cortex', depth: 0.5, lateral: 0.5, chemShift: 0.5, input: 0.5 }]);
  const [late, early] = g.findGenes().map(gene => Evo.text.describeGene(g, gene).text);
  assert.ok(/no effect/.test(late), late);
  assert.ok(!/no effect/.test(early), early);
});

test('text: the mutation list pairs a changed gene with the one it came from', (Evo, assert) => {
  const parent = Evo.Genome.founder();
  assert.deepStrictEqual(Evo.text.geneChanges(parent, [parent]), [], 'no differences from itself');
  const child = new Evo.Genome(parent.dna.slice(), parent.sexChrom);
  const gene = child.findGenes().find(x => Evo.GENES[x.type].name === 'Stimulus');
  child.dna[gene.start + 4] ^= 0x40; // One payload byte of a Stimulus gene
  const changes = Evo.text.geneChanges(child, [parent]);
  assert.strictEqual(changes.length, 1, JSON.stringify(changes.map(c => c.kind)));
  assert.strictEqual(changes[0].kind, 'changed');
  const fields = Evo.text.fieldChanges(child, changes[0].gene, changes[0].ref.genome, changes[0].ref.gene);
  assert.strictEqual(fields.length, 1);
  assert.notStrictEqual(fields[0].before, fields[0].after);
});
