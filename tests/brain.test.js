'use strict';

test('brain: synapse list, lookup set and outgoing lists stay in step', (Evo, assert) => {
  const org = new Evo.Organism(new Evo.Genome(), 100, 100);
  const brain = org.brain;
  const check = () => {
    assert.strictEqual(brain.synapseKeys.size, brain.synapses.length);
    const outgoing = brain.allNeurons.reduce((a, n) => a + n.outgoingSynapses.length, 0);
    assert.strictEqual(outgoing, brain.synapses.length);
  };
  check();
  for (let i = 0; i < 40; i++) brain.removeSynapseAt(Evo.randInt(brain.synapses.length));
  check();
  const [a, b] = [brain.allNeurons[0], brain.centralNeurons[5]];
  brain.addSynapse(a, b, 0.2);
  assert.strictEqual(brain.addSynapse(a, b, 0.2), null, 'no duplicate synapses');
  check();
});

test('brain: learning keeps weights inside their limits', (Evo, assert) => {
  const org = new Evo.Organism(new Evo.Genome(), 100, 100);
  const syn = org.brain.synapses[0];
  for (let i = 0; i < 2000; i++) syn.nudge(5);
  assert.ok(syn.weight <= Evo.BRAIN.WEIGHT_MAX);
  for (let i = 0; i < 2000; i++) syn.nudge(-5);
  assert.ok(syn.weight >= Evo.BRAIN.WEIGHT_MIN);
});

test('brain: every neuron has a plain-language name', (Evo, assert) => {
  const org = new Evo.Organism(new Evo.Genome(), 100, 100);
  for (const n of org.brain.allNeurons) {
    const name = Evo.text.neuronName(n);
    assert.ok(name && !/undefined/.test(name), `${n.id} -> ${name}`);
    assert.ok(!/undefined/.test(Evo.text.lobeName(n)));
  }
});

test('brain: founders grow the smell-map copy and the visual-map copy', (Evo, assert) => {
  for (let i = 0; i < 20; i++) {
    const org = new Evo.Organism(new Evo.Genome(), 100, 100);
    const parents = org.brain.duplicateLobes.map(l => org.brain.lobe(l)[0].parentLobe);
    assert.deepStrictEqual(parents.sort(), ['motor', 'olfactory', 'vision']);
  }
});
