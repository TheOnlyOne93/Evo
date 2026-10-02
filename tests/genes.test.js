'use strict';
// The genes, tested directly: a player can't see DNA, but every creature grows from it, and a broken
// inheritance would take many generations to notice in play.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Evo } = require('./kit.js');

test('every founder gene reads back from its DNA as the founder table wrote it', () => {
  for (const sex of ['FEMALE', 'MALE']) {
    const genome = Evo.Genome.founder(sex), genes = genome.findGenes(), specs = Evo.FOUNDER_GENOMES[sex];
    assert.equal(genes.length, specs.length, `${sex}: one gene for each line of the table, none from the filler between them`);
    specs.forEach((spec, k) => {
      const def = Evo.GENES[genes[k].type], got = genome.decode(genes[k]);
      assert.equal(def.name, spec.gene, `${sex} gene ${k}`);
      assert.equal(genes[k].stage, spec.stage || 0, `${sex} ${spec.gene}: its stage`);
      for (const [key] of def.fields) {
        const want = spec[key], what = `${sex} ${spec.gene}.${key}: wrote ${want}, reads ${got[key]}`;
        // A value can't be stored exactly in a byte, but it must land close (a clamped or misread value doesn't)
        if (want === Infinity) assert.equal(got[key], Infinity, what);
        else if (typeof want === 'number') assert.ok(Math.abs(got[key] - want) <= Math.max(0.2 * Math.abs(want), 1 / 64), what);
      }
    });
  }
});

test('mutation changes the DNA but keeps it within its length limits, and what grows from it is whole', () => {
  Evo.seed(1);
  let g = Evo.Genome.founder('FEMALE');
  const first = g.dna.join();
  for (let i = 0; i < 40; i++) g = g.cloneWithMutation(0.02);
  assert.notEqual(g.dna.join(), first);
  assert.ok(g.mutationCount > 0, 'the mutations are counted');
  const { MIN_LENGTH, MAX_LENGTH } = Evo.GENOME_LIMITS;
  assert.ok(g.dna.length >= MIN_LENGTH && g.dna.length <= MAX_LENGTH, `length ${g.dna.length}`);
  const traits = g.develop(Evo.STAGES.length - 1);
  for (const [k, v] of Object.entries(traits)) if (typeof v === 'number') assert.ok(!Number.isNaN(v), `${k} is not a number`);
  assert.doesNotThrow(() => new Evo.Brain(traits), 'a brain grows from it');
});

test('a child carries DNA from both parents, and is a son or a daughter by chance', () => {
  Evo.seed(1);
  // Parents whose every byte tells them apart (DNA need not hold genes to be passed on)
  const mother = new Evo.Genome(new Uint8Array(3000).fill(10), 'X'), father = new Evo.Genome(new Uint8Array(3000).fill(20), 'Y');
  let fromBoth = 0;
  const sexes = new Set();
  for (let i = 0; i < 20; i++) {
    const child = Evo.Genome.recombine(mother, father);
    if (child.dna.includes(10) && child.dna.includes(20)) fromBoth++;
    sexes.add(child.sexChrom);
  }
  assert.ok(fromBoth >= 15, `${fromBoth} of 20 children carry DNA from both parents`);
  assert.deepEqual([...sexes].sort(), ['X', 'Y']);
});

test('a gene set to a later life stage switches on when the creature reaches it', () => {
  const later = Evo.FOUNDER_GENOMES.FEMALE.map(g => g.gene === 'Life history' ? { ...g, lifespan: 1, stage: 3 } : g);
  const g = Evo.Genome.founder('FEMALE', later);
  assert.ok(g.develop(3).lifespanTicks > g.develop(2).lifespanTicks, 'a longer life from stage 3');
});
