'use strict';

// A chemistry with hand-written genes (traits in the shape Genome.develop() returns)
function chemistry(Evo, genes) {
  const b = new Evo.Biochemistry();
  b.configure({ reactions: [], emitters: [], receptors: [], halfLives: {}, ...genes });
  return b;
}
const loci = Evo => new Float32Array(Evo.BODY_LOCI.length);

test('biochem: reactions conserve mass by their yields, and stop when a reactant runs out', (Evo, assert) => {
  const { CHEM } = Evo;
  const b = chemistry(Evo, { reactions: [{ a: CHEM.gutSugar, b: 0, c: CHEM.glucose, d: 0, rate: 0.05, yieldC: 1, yieldD: 0 }] });
  b.set('gutSugar', 0.5);
  let drift = 0;
  for (let t = 0; t < 400; t++) {
    b.step(loci(Evo));
    drift = Math.max(drift, Math.abs(b.get('gutSugar') + b.get('glucose') - 0.5));
  }
  assert.ok(drift < 1e-5, `mass drifts by ${drift}`);
  assert.ok(b.get('gutSugar') < 0.001 && b.get('glucose') > 0.49);
});

test('biochem: a catalyst drives a reaction without being used up', (Evo, assert) => {
  const { CHEM } = Evo;
  const b = chemistry(Evo, { reactions: [{ a: CHEM.toxin, b: CHEM.liverEnzyme, c: 0, d: CHEM.liverEnzyme, rate: 0.1, yieldC: 0, yieldD: 1 }] });
  b.set('toxin', 0.4); b.set('liverEnzyme', 0.2);
  for (let t = 0; t < 200; t++) b.step(loci(Evo));
  assert.ok(b.get('toxin') < 0.2);
  assert.ok(Math.abs(b.get('liverEnzyme') - 0.2) < 1e-5);
});

test('biochem: emitters respond above their threshold, or below it when inverted', (Evo, assert) => {
  const { CHEM, LOCUS } = Evo;
  const b = chemistry(Evo, { emitters: [
    { locus: { body: LOCUS.darkness }, chem: CHEM.melatonin, threshold: 0.5, gain: 0.01 },
    { locus: { chem: CHEM.water }, chem: CHEM.thirst, threshold: 0.6, gain: 0.01, invert: true },
    { locus: { body: LOCUS.impact }, chem: CHEM.pain, threshold: 0, gain: 0.1, digital: true }
  ] });
  const L = loci(Evo);
  L[LOCUS.darkness] = 0.4; b.set('water', 0.8);
  b.step(L);
  assert.strictEqual(b.get('melatonin'), 0); assert.strictEqual(b.get('thirst'), 0); assert.strictEqual(b.get('pain'), 0);
  L[LOCUS.darkness] = 1; L[LOCUS.impact] = 0.01; b.set('water', 0.2);
  b.step(L);
  assert.ok(Math.abs(b.get('melatonin') - 0.005) < 1e-6);
  assert.ok(Math.abs(b.get('thirst') - 0.004) < 1e-6);
  assert.ok(Math.abs(b.get('pain') - 0.1) < 1e-6, 'digital emitters release their full gain');
});

test('biochem: a half-life halves a chemical in that many ticks', (Evo, assert) => {
  const b = chemistry(Evo, { halfLives: { [Evo.CHEM.fear]: 100 } });
  b.set('fear', 0.8);
  for (let t = 0; t < 100; t++) b.step(loci(Evo));
  assert.ok(Math.abs(b.get('fear') - 0.4) < 0.002, `fear ${b.get('fear')}`);
});

test('biochem: receptors act on their target, and damage is blamed on its chemical', (Evo, assert) => {
  const { CHEM, TARGET } = Evo;
  const b = chemistry(Evo, { receptors: [
    { chem: CHEM.toxin, target: TARGET.damage, threshold: 0.2, gain: 2 },
    { chem: CHEM.adrenaline, target: TARGET.sleep, threshold: 0.1, gain: 1, negative: true }
  ] });
  b.set('toxin', 0.5); b.set('adrenaline', 0.3);
  b.step(loci(Evo));
  assert.ok(Math.abs(b.effect('damage') - 0.6) < 1e-6);
  assert.ok(Math.abs(b.effect('sleep') + 0.2) < 1e-6);
  assert.strictEqual(b.damageCause(), 'poison');
});

test('biochem: in a hungry founder, sweet taste turns hunger into reward and gut sugar sates quietly', (Evo, assert) => {
  const traits = Evo.Genome.founder('FEMALE').develop();
  const b = new Evo.Biochemistry();
  b.configure(traits);
  b.setInitial(traits.initial);
  b.set('hunger', 0.6);
  b.set('gutSugar', 0.3);
  const L = loci(Evo);
  let reward = 0;
  for (let t = 0; t < 60; t++) { b.step(L); reward = Math.max(reward, b.get('reward')); }
  assert.ok(reward < 0.01, `gut sugar alone gives no reward (${reward})`);
  assert.ok(b.get('hunger') < 0.59, `…but sates (hunger ${b.get('hunger')})`);
  L[Evo.LOCUS.tasteSweet] = 1;
  for (let t = 0; t < 30; t++) { b.step(L); reward = Math.max(reward, b.get('reward')); }
  assert.ok(reward > 0.1, `tasting sugar rewards (${reward})`);
});

test('biochem: a founder going without food gets hungry, and without water gets thirsty', (Evo, assert) => {
  const traits = Evo.Genome.founder('FEMALE').develop();
  const b = new Evo.Biochemistry();
  b.configure(traits);
  b.set('glucose', 0.1); b.set('glycogen', 0.05); b.set('water', 0.3);
  for (let t = 0; t < 600; t++) b.step(loci(Evo));
  assert.ok(b.get('hunger') > 0.2, `hunger ${b.get('hunger')}`);
  assert.ok(b.get('thirst') > 0.2, `thirst ${b.get('thirst')}`);
});

test('biochem: an Initial concentration gene that switches on later sets its chemical once, on reaching that stage', (Evo, assert) => {
  const { STAGE } = Evo;
  const late = { gene: 'Initial concentration', stage: STAGE.ADOLESCENT, chem: 'endorphin', amount: 0.8 };
  const genome = Evo.Genome.founder('FEMALE', [...Evo.FOUNDER_GENOMES.FEMALE, late]);
  const world = new Evo.World();
  const c = new Evo.Creature(genome, world.width / 2, 0);
  const level = () => c.chem.get('endorphin');
  assert.ok(level() < 0.5, `not at birth (${level()})`);
  c.enterStage(STAGE.CHILD, world);
  assert.ok(level() < 0.5, `not as a child (${level()})`);
  c.enterStage(STAGE.ADOLESCENT, world);
  const want = c.traits.initial.find(g => g.stage === STAGE.ADOLESCENT).amount;
  assert.ok(Math.abs(level() - want) < 1e-6, `set on becoming adolescent (${level()} vs ${want})`);
  c.chem.set('endorphin', 0.1);
  c.enterStage(STAGE.YOUTH, world);
  assert.ok(Math.abs(level() - 0.1) < 1e-6, `not set again later (${level()})`);
  const gene = genome.findGenes().find(g => g.stage === STAGE.ADOLESCENT && Evo.GENES[g.type].name === 'Initial concentration');
  const text = Evo.text.describeGene(genome, gene).text;
  assert.ok(/adolescent stage/.test(text), text);
});
