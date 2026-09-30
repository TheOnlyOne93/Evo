'use strict';

const { founderBrain, TICK_OPTS, cortexKnockout } = require('./helpers');

// The synapse arrays, the lookup set and the outgoing lists must always agree; nothing ends on a sense cell
function checkWiring(brain, assert) {
  assert.strictEqual(brain.keys.size, brain.S);
  brain.rebuildAdjacency();
  // Synapses onto a modulator cell carry a prediction (value), not current
  const onto = s => brain.modulator[brain.sDst[s]];
  let delivering = 0, value = 0;
  for (let s = 0; s < brain.S; s++) if (onto(s) < 0) delivering++; else if (brain.modulator[brain.sSrc[s]] < 0) value++;
  assert.strictEqual(brain.outStart[brain.N], delivering);
  assert.strictEqual(brain.valueIn.reduce((n, l) => n + l.length, 0), value);
  brain.valueIn.forEach((list, c) => { for (const s of list) assert.strictEqual(onto(s), c); });
  for (let i = 0; i < brain.N; i++) {
    for (const s of brain.outgoing(i)) assert.ok(brain.sSrc[s] === i && onto(s) < 0);
  }
  for (let s = 0; s < brain.S; s++) {
    assert.ok(brain.hasSynapse(brain.sSrc[s], brain.sDst[s]));
    assert.ok(!brain.isSensory[brain.sDst[s]], `synapse ${s} ends on sense cell ${brain.sDst[s]}`);
  }
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
  for (let s = 0; s < brain.S; s++) assert.ok(!brain.isSensory[brain.sDst[s]], `synapse ${s} ends on sense cell ${brain.sDst[s]}`);
});

test('brain: weights stay inside their limits under relentless reward and punishment', (Evo, assert) => {
  const brain = founderBrain(Evo);
  const input = new Float32Array(brain.N);
  for (let t = 0; t < 1500; t++) {
    for (let i = 0; i < brain.N; i++) input[i] = brain.isSensory[i] ? 25 * Evo.random() : 0;
    // Outcomes that keep coming, in pulses, so they never become fully expected
    const pulse = t % 40 < 10 ? 1 : 0;
    brain.outcome[0] = t < 750 ? pulse : 0; brain.outcome[1] = t < 750 ? 0 : pulse;
    brain.tick(input, TICK_OPTS);
    if (t % Evo.BRAIN.MORPHOGENESIS_EVERY === 0) brain.runMorphogenesis();
  }
  const { WEIGHT_MIN, WEIGHT_MAX } = Evo.BRAIN;
  for (let s = 0; s < brain.S; s++) {
    assert.ok(brain.sW[s] >= WEIGHT_MIN && brain.sW[s] <= WEIGHT_MAX && Number.isFinite(brain.sW[s]));
    assert.strictEqual(brain.sW[s] < 0, !!(brain.sFlags[s] & Evo.BRAIN.INHIBITORY) && brain.sW[s] !== 0, 'no synapse changes sign');
  }
  for (let i = 0; i < brain.N; i++) assert.ok(Number.isFinite(brain.v[i]) && Number.isFinite(brain.thr[i]));
  checkWiring(brain, assert);
});

test('brain: founders grow the movement copy and the sight copy', (Evo, assert) => {
  const brain = founderBrain(Evo);
  const parents = brain.duplicateLobes.map(l => brain.neurons[brain.lobes[l][0]].parentLobe);
  assert.deepStrictEqual(parents.sort(), ['motor', 'sight']);
});

// Unbudgeted, 121 more sight copies would make 4119 neurons: more than synapse keys allow
test('brain: region copies stop at the neuron budget, however many genes ask for them', (Evo, assert) => {
  const copy = { gene: 'Region duplication', source: 'sight', depth: 0.5, lateral: 0.5, chemShift: 0.5, input: 0.5 };
  const genome = Evo.Genome.founder('FEMALE', [...Evo.FOUNDER_GENOMES.FEMALE, ...Array(121).fill(copy)]);
  const brain = new Evo.Brain(genome.develop());
  assert.ok(brain.N <= Evo.LIMITS.MAX_NEURONS, `${brain.N} neurons`);
  assert.ok(brain.N + brain.lobes.sight.length > Evo.LIMITS.MAX_NEURONS, 'copies are made until the next would not fit');
  // The Genes tab says which copies were not built
  const copies = genome.findGenes().filter(g => Evo.GENES[g.type].name === 'Region duplication');
  const skipped = copies.filter(g => brain.skippedDuplications.has(g.start));
  assert.strictEqual(brain.duplicateLobes.length + skipped.length, copies.length);
  assert.ok(/not built/.test(Evo.text.describeGene(genome, skipped[0], brain).text));
  assert.ok(!/not built/.test(Evo.text.describeGene(genome, copies[0], brain).text));
});

test('brain: founders are born with their reflex arcs', (Evo, assert) => {
  const motor = key => Evo.MOTORS.findIndex(m => m.key === key);
  const touch = key => Evo.BRAIN_BODY_PLAN.TOUCH.findIndex(t => t.key === key);
  const arcs = { painRun: 0, mouthEatL: 0, mouthEatR: 0, lipsDrink: 0, sleepyRest: 0, bumpTurnL: 0, bumpTurnR: 0 };
  const trials = 40;
  for (let i = 0; i < trials; i++) {
    const b = founderBrain(Evo, i % 2 ? 'FEMALE' : 'MALE');
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
  const input = new Float32Array(brain.N);
  let before = 0, after = 0;
  const cortex = brain.lobes.cortex;
  for (let t = 0; t < 400; t++) {
    const on = t >= 200;
    for (const i of brain.lobes.sight) input[i] = on ? 30 : 0;
    brain.tick(input, TICK_OPTS);
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
  const i = brain.lobes.cortex[0], input = new Float32Array(brain.N);
  const opts = { noise: 0, arousal: 0, canFire: false };
  for (let t = 0; t < 30; t++) brain.tick(input, opts);
  brain.inject(i, 15, 3);
  const v = [];
  for (let t = 0; t < 4; t++) { brain.tick(input, opts); v.push(brain.v[i]); }
  assert.ok(v[2] > v[1] + 10, `the input lands on the third tick: ${v.map(x => x.toFixed(1))}`);
});

// Two muscles driven almost equally, near threshold (as the senses and needs usually drive them)
function twoMuscles(Evo, seed) {
  Evo.seed(seed);
  const brain = founderBrain(Evo);
  const [L, R] = brain.lobes.motor, input = new Float32Array(brain.N), opts = TICK_OPTS;
  for (let t = 0; t < 100; t++) brain.tick(input, opts);
  const fired = i => brain.hist[i] & 1;
  let active = 0, both = 0, winner = -1, held = 0;
  for (let t = 0; t < 400; t++) {
    input[L] = 2.1; input[R] = 2.0;
    brain.tick(input, opts);
    if (fired(L) || fired(R)) active++;
    if (fired(L) && fired(R)) both++;
    // held: ticks the loser stays silent after the winner first fires alone
    if (winner < 0) {
      if (fired(L) !== fired(R)) winner = fired(L) ? L : R;
    } else if (fired(winner === L ? R : L)) break;
    else held++;
  }
  // Now the loser's input doubles
  const loser = winner === L ? R : L;
  let takeover = null;
  for (let t = 0; t < 60 && takeover === null; t++) {
    input[loser] = 4.0; input[winner] = 2.0;
    brain.tick(input, opts);
    if (fired(loser) && !fired(winner)) takeover = t;
  }
  return { coFiring: both / Math.max(1, active), held, takeover };
}

test('brain: of two muscles driven almost equally, one wins and keeps going; a doubled input takes over', (Evo, assert) => {
  for (let seed = 1; seed <= 5; seed++) {
    const { coFiring, held, takeover } = twoMuscles(Evo, seed);
    assert.ok(coFiring < 0.1, `seed ${seed}: they fire together ${Math.round(coFiring * 100)}% of the time`);
    assert.ok(held >= 40, `seed ${seed}: the winner held ${held} ticks`);
    assert.ok(takeover !== null && takeover <= 20, `seed ${seed}: took over after ${takeover} ticks`);
  }
});

test('brain: decided() names the muscle that is winning, and nothing when all are quiet', (Evo, assert) => {
  Evo.seed(1);
  const brain = founderBrain(Evo), input = new Float32Array(brain.N), opts = { noise: 0, arousal: 0, canFire: true };
  for (let t = 0; t < 100; t++) brain.tick(input, opts);
  assert.strictEqual(brain.decided(), -1, 'quiet');
  const eat = Evo.MOTORS.findIndex(m => m.key === 'eat');
  for (let t = 0; t < 40; t++) { input[brain.lobes.motor[eat]] = 6; brain.tick(input, opts); }
  assert.strictEqual(brain.decided(), eat);
});

// Red on the left and blue on the right, equally bright: which does the sight copy attend to?
function attentionWinner(Evo, seed, drive) {
  Evo.seed(seed);
  const brain = founderBrain(Evo), P = Evo.BRAIN_BODY_PLAN;
  const input = new Float32Array(brain.N), opts = TICK_OPTS;
  const cell = Evo.driveCell(drive);
  const count = {};
  for (let t = 0; t < 400; t++) {
    input[brain.lobes.sight[P.sightIndex('L', 'low', 'red')]] = 15;
    input[brain.lobes.sight[P.sightIndex('R', 'low', 'blue')]] = 15;
    input[brain.lobes.needs[cell]] = 0.6 * Evo.CREATURE.NEURAL_GAIN;
    brain.tick(input, opts);
    const a = t >= 100 && brain.attended();
    if (a) count[a.feature] = (count[a.feature] || 0) + 1;
  }
  const red = count.red || 0, blue = count.blue || 0;
  return red > blue ? 'red' : blue > red ? 'blue' : 'none';
}

test('brain: attention goes to what the creature needs', (Evo, assert) => {
  // Chance is half; 20 seeds keep a change to the founder's DNA from tipping the count by luck
  const seeds = 20;
  let red = 0, blue = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    if (attentionWinner(Evo, seed, 'hunger') === 'red') red++;
    if (attentionWinner(Evo, seed, 'thirst') === 'blue') blue++;
  }
  assert.ok(red >= seeds * 0.6, `hungry: red wins in ${red} of ${seeds}`);
  assert.ok(blue >= seeds * 0.6, `thirsty: blue wins in ${blue} of ${seeds}`);
});

// Red seen on the left for 60 ticks, then nothing: cortex spikes before, while seeing, and from 10
// ticks after it stops, for a brain grown from the given genes
function cortexAfterSight(Evo, seed, genes) {
  Evo.seed(seed);
  const brain = new Evo.Brain(Evo.Genome.founder('FEMALE', genes).develop()), P = Evo.BRAIN_BODY_PLAN;
  const input = new Float32Array(brain.N), opts = TICK_OPTS;
  const eyes = P.BANDS.map(band => brain.lobes.sight[P.sightIndex('L', band, 'red')]);
  const spikes = { before: 0, seeing: 0, gap: 0, after: 0 };
  for (let t = 0; t < 200; t++) {
    const seeing = t >= 50 && t < 110;
    for (const i of eyes) input[i] = seeing ? 20 : 0;
    brain.tick(input, opts);
    let n = 0;
    for (const i of brain.lobes.cortex) n += brain.hist[i] & 1;
    spikes[t < 50 ? 'before' : seeing ? 'seeing' : t < 120 ? 'gap' : 'after'] += n;
  }
  return spikes;
}

test('brain: working memory keeps the cortex going after what it saw is gone; a persistence knockout does not', (Evo, assert) => {
  const knockout = cortexKnockout(Evo);
  for (let seed = 1; seed <= 4; seed++) {
    const wm = cortexAfterSight(Evo, seed), ko = cortexAfterSight(Evo, seed, knockout);
    assert.ok(wm.seeing > 0 && ko.seeing > 0, `seed ${seed}: the cortex hears the eyes (${wm.seeing}, knockout ${ko.seeing})`);
    assert.ok(wm.after >= 8 && wm.after > 3 * wm.before, `seed ${seed}: founder cortex after the sight: ${wm.after} spikes (${wm.before} before)`);
    assert.ok(ko.after <= 2, `seed ${seed}: knockout cortex after the sight: ${ko.after} spikes`);
  }
});
