'use strict';

const founderBrain = (Evo, sex = 'X') => new Evo.Brain(Evo.Genome.founder(sex).develop());

// The synapse arrays, the lookup set and the outgoing lists must always agree
function checkWiring(brain, assert) {
  assert.strictEqual(brain.keys.size, brain.S);
  brain.rebuildAdjacency();
  assert.strictEqual(brain.outStart[brain.N], brain.S);
  for (let i = 0; i < brain.N; i++) {
    for (const s of brain.outgoing(i)) assert.strictEqual(brain.sSrc[s], i);
  }
  for (let s = 0; s < brain.S; s++) assert.ok(brain.hasSynapse(brain.sSrc[s], brain.sDst[s]));
}

test('brain: synapse arrays, lookup set and adjacency stay in step', (Evo, assert) => {
  const brain = founderBrain(Evo);
  checkWiring(brain, assert);
  for (let i = 0; i < 60; i++) brain.removeSynapse(Evo.randInt(brain.S));
  checkWiring(brain, assert);
  const a = brain.lobes.touch[0], b = brain.lobes.cortex[3];
  if (brain.hasSynapse(a, b)) brain.removeSynapse(brain.incoming(b).find(s => brain.sSrc[s] === a));
  assert.ok(brain.addSynapse(a, b, 0.2) >= 0);
  assert.strictEqual(brain.addSynapse(a, b, 0.2), -1, 'no duplicate synapses');
  assert.strictEqual(brain.addSynapse(b, b, 0.2), -1, 'no self-synapses');
  checkWiring(brain, assert);
});

test('brain: nothing ever synapses onto a sensory cell', (Evo, assert) => {
  const brain = founderBrain(Evo);
  for (let s = 0; s < brain.S; s++) assert.ok(!brain.isSensory[brain.sDst[s]] || brain.neurons[brain.sDst[s]].copyOf !== null);
});

test('brain: weights stay inside their limits under relentless reward and punishment', (Evo, assert) => {
  const brain = founderBrain(Evo);
  const drive = new Float32Array(brain.N);
  for (let t = 0; t < 1500; t++) {
    for (let i = 0; i < brain.N; i++) drive[i] = brain.isSensory[i] ? 25 * Evo.random() : 0;
    brain.outcome[0] = t < 750 ? 1 : 0; brain.outcome[1] = t < 750 ? 0 : 1;
    brain.lDA.fill(0);
    brain.chem[0].fill(t < 750 ? 3 : 0); brain.chem[1].fill(t < 750 ? 0 : 3);
    brain.tick(drive, { noise: 0.35, arousal: 0, canFire: true });
    if (t % 80 === 0) brain.runMorphogenesis();
  }
  const { WEIGHT_MIN, WEIGHT_MAX } = Evo.BRAIN;
  for (let s = 0; s < brain.S; s++) {
    assert.ok(brain.sW[s] >= WEIGHT_MIN && brain.sW[s] <= WEIGHT_MAX && Number.isFinite(brain.sW[s]));
    assert.strictEqual(brain.sW[s] < 0, !!(brain.sFlags[s] & Evo.BRAIN.INHIBITORY) && brain.sW[s] !== 0, 'no synapse changes sign');
  }
  for (let i = 0; i < brain.N; i++) assert.ok(Number.isFinite(brain.v[i]) && Number.isFinite(brain.thr[i]));
  checkWiring(brain, assert);
});

test('brain: every neuron has a plain-language name', (Evo, assert) => {
  const brain = founderBrain(Evo);
  for (const n of brain.neurons) {
    const name = Evo.text.neuronName(brain, n);
    assert.ok(name && !/undefined|NaN/.test(name), `${n.id} -> ${name}`);
    assert.ok(!/undefined/.test(Evo.text.lobeName(n)));
  }
});

test('brain: founders grow the movement copy and the sight copy', (Evo, assert) => {
  for (let i = 0; i < 10; i++) {
    const brain = founderBrain(Evo);
    const parents = brain.duplicateLobes.map(l => brain.neurons[brain.lobes[l][0]].parentLobe);
    assert.deepStrictEqual(parents.sort(), ['motor', 'sight']);
  }
});

test('brain: founders are born with their reflex arcs', (Evo, assert) => {
  const motor = key => Evo.MOTORS.findIndex(m => m.key === key);
  const touch = key => Evo.BRAIN_BODY_PLAN.TOUCH.findIndex(t => t.key === key);
  const arcs = { painRun: 0, mouthEatL: 0, mouthEatR: 0, lipsDrink: 0, sleepyRest: 0, bumpTurnL: 0, bumpTurnR: 0 };
  const trials = 40;
  for (let i = 0; i < trials; i++) {
    const b = founderBrain(Evo, i % 2 ? 'X' : 'Y');
    const M = k => b.lobes.motor[motor(k)], T = k => b.lobes.touch[touch(k)], D = k => b.lobes.needs[Evo.driveCell(k)];
    if (b.hasSynapse(D('pain'), M('run'))) arcs.painRun++;
    if (b.hasSynapse(T('mouthL'), M('eat'))) arcs.mouthEatL++;
    if (b.hasSynapse(T('mouthR'), M('eat'))) arcs.mouthEatR++;
    if (b.hasSynapse(T('lips'), M('drink'))) arcs.lipsDrink++;
    if (b.hasSynapse(D('sleepiness'), M('rest'))) arcs.sleepyRest++;
    if (b.hasSynapse(T('contactL'), M('walkR'))) arcs.bumpTurnL++;
    if (b.hasSynapse(T('contactR'), M('walkL'))) arcs.bumpTurnR++;
  }
  // Development is stochastic: most founders are born with each arc, and learning covers the rest
  for (const [arc, n] of Object.entries(arcs)) assert.ok(n >= trials * 0.6, `${arc}: ${n}/${trials}`);
});

test('brain: a driven sense cell makes its downstream cells fire', (Evo, assert) => {
  const brain = founderBrain(Evo);
  const drive = new Float32Array(brain.N);
  let before = 0, after = 0;
  const cortex = brain.lobes.cortex;
  for (let t = 0; t < 400; t++) {
    const on = t >= 200;
    for (const i of brain.lobes.sight) drive[i] = on ? 30 : 0;
    brain.tick(drive, { noise: 0.35, arousal: 0, canFire: true });
    for (const i of cortex) { const f = brain.hist[i] & 1; if (on) after += f; else before += f; }
  }
  assert.ok(after > before, `cortex spikes: ${before} quiet, ${after} seeing`);
});

test('brain: the body plan index helpers match the sensory neurons', (Evo, assert) => {
  const brain = founderBrain(Evo);
  const P = Evo.BRAIN_BODY_PLAN;
  assert.strictEqual(brain.lobes.sight.length, P.SIGHT_CELLS);
  assert.strictEqual(brain.lobes.smell.length, P.SMELL_CELLS);
  for (const side of P.SIDES) {
    for (const band of P.BANDS) {
      for (const f of Evo.VISION_FEATURES) {
        const k = P.sightIndex(side, band, f.key);
        assert.deepStrictEqual(brain.neurons[brain.lobes.sight[k]].meta, { kind: 'sight', side, band, feature: f.key });
        assert.deepStrictEqual(P.sightCell(k), { side, band, feature: f.key });
      }
    }
    for (const s of Evo.SCENTS) {
      const k = P.smellIndex(side, s.key);
      assert.deepStrictEqual(brain.neurons[brain.lobes.smell[k]].meta, { kind: 'smell', side, odour: s.key });
      assert.deepStrictEqual(P.smellCell(k), { side, odour: s.key });
    }
    for (const pitch of ['low', 'high']) {
      const m = brain.neurons[brain.lobes.hearing[P.hearingIndex(side, pitch)]].meta;
      assert.ok(m.side === side && m.pitch === pitch);
    }
  }
});

test('brain: an injected input arrives after its delay', (Evo, assert) => {
  const brain = founderBrain(Evo);
  const i = brain.lobes.cortex[0], drive = new Float32Array(brain.N);
  const opts = { noise: 0, arousal: 0, canFire: false };
  for (let t = 0; t < 30; t++) brain.tick(drive, opts);
  brain.inject(i, 15, 3);
  const v = [];
  for (let t = 0; t < 4; t++) { brain.tick(drive, opts); v.push(brain.v[i]); }
  assert.ok(v[2] > v[1] + 10, `the input lands on the third tick: ${v.map(x => x.toFixed(1))}`);
});
