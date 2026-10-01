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

test("brain: a Cell type gene with learns 0 keeps its region's incoming connections fixed", (Evo, assert) => {
  const brain = founderBrain(Evo);
  const onto = lobe => {
    const into = new Set(brain.lobes[lobe]), out = new Map();
    for (let s = 0; s < brain.S; s++) if (into.has(brain.sDst[s])) out.set(`${brain.sSrc[s]}>${brain.sDst[s]}`, brain.sW[s]);
    return out;
  };
  const stemBefore = onto('stem'), thinkingBefore = onto('cortex');
  assert.ok(stemBefore.size > 0, 'connections reach the Brainstem');
  const input = new Float32Array(brain.N);
  for (let t = 0; t < 1500; t++) {
    // Every sense and drive busy, so the Brainstem cells and their sources fire, with pulsing reward then punishment
    for (let i = 0; i < brain.N; i++) input[i] = brain.isSensory[i] ? 25 * Evo.random() : 0;
    const pulse = t % 40 < 10 ? 1 : 0;
    brain.outcome[0] = t < 750 ? pulse : 0; brain.outcome[1] = t < 750 ? 0 : pulse;
    brain.tick(input, TICK_OPTS);
    if (t % Evo.BRAIN.MORPHOGENESIS_EVERY === 0) brain.runMorphogenesis();
  }
  const stemAfter = onto('stem'), thinkingAfter = onto('cortex');
  assert.strictEqual(stemAfter.size, stemBefore.size, 'no new connection grows onto a Brainstem cell');
  for (const [key, w] of stemBefore) assert.strictEqual(stemAfter.get(key), w, `Brainstem connection ${key} stays as grown`);
  const changed = [...thinkingBefore].filter(([key, w]) => thinkingAfter.get(key) !== w).length;
  assert.ok(changed > 0 || thinkingAfter.size !== thinkingBefore.size, 'connections onto Thinking cells do change');
});

// A brain's connections, to compare two brains: sources, targets, weights, delays and flags, in order
const wiringOf = brain => Object.fromEntries(['sSrc', 'sDst', 'sW', 'sDelay', 'sFlags'].map(name => [name, Array.from(brain[name].subarray(0, brain.S))]));
// A brain's connections by source and target: key -> [weight, delay]
const connections = brain => {
  const out = new Map();
  for (let s = 0; s < brain.S; s++) out.set(`${brain.sSrc[s]}>${brain.sDst[s]}`, [brain.sW[s], brain.sDelay[s]]);
  return out;
};
const same = (a, b) => a[0] === b[0] && a[1] === b[1];

test('brain: growing a brain rolls fixed dice and draws none from the world', (Evo, assert) => {
  try {
    Evo.useRandomSource(() => { throw new Error('growing a brain asked the world for a random number'); });
    new Evo.Brain(Evo.Genome.founder('FEMALE').develop());
    new Evo.Brain(Evo.Genome.founder('MALE').develop());
    // Wiring genes that switch on later in life grow the same way
    const traits = Evo.Genome.founder('FEMALE').develop(), rules = traits.axonGuidance;
    traits.axonGuidance = [];
    new Evo.Brain(traits).growTracts(rules);
  } finally {
    Evo.seed(1);
  }
});

test('brain: the same genes grow the same brain, whatever the seed', (Evo, assert) => {
  Evo.seed(1);
  const first = founderBrain(Evo);
  Evo.seed(5);
  const second = founderBrain(Evo);
  assert.ok(first.S > 1000, `${first.S} connections`);
  assert.deepStrictEqual(wiringOf(second), wiringOf(first));
});

test('brain: the first female and male grow the same brain (their genes differ only in looks and voice)', (Evo, assert) => {
  const she = founderBrain(Evo, 'FEMALE'), he = founderBrain(Evo, 'MALE');
  assert.strictEqual(he.N, she.N);
  assert.deepStrictEqual(wiringOf(he), wiringOf(she));
});

test('brain: taking out one wiring gene changes only the connections that gene reaches', (Evo, assert) => {
  const genes = Evo.FOUNDER_GENOMES.FEMALE;
  const traits = Evo.Genome.founder('FEMALE', genes).develop();
  const old = new Evo.Brain(traits), was = connections(old);
  // The founder's innate budget is not used up, so a gene taken out frees no room for others' connections
  assert.ok(old.S < Evo.LIMITS.INNATE_BUDGET, `${old.S} connections of a budget of ${Evo.LIMITS.INNATE_BUDGET}`);
  // The k-th Axon guidance gene is traits.axonGuidance[k] (every founder wiring gene adds its entry)
  const wiring = genes.flatMap((g, i) => (g.gene === 'Axon guidance' ? [i] : []));
  assert.strictEqual(wiring.length, traits.axonGuidance.length);
  let gone = 0;
  wiring.forEach((at, k) => {
    const rule = traits.axonGuidance[k];
    // Every connection the gene could make: its source cells to the cells whose chemistry matches
    const reach = new Set(old.tractSources(rule).flatMap(s => old.tractTargets(rule, s).map(([d]) => `${s.index}>${d.index}`)));
    const now = connections(new Evo.Brain(Evo.Genome.founder('FEMALE', genes.filter((_, j) => j !== at)).develop()));
    for (const [key, wd] of now) {
      assert.ok(was.has(key), `without gene ${at}, the new connection ${key}`);
      // Where another gene (or the background wiring) wanted the same connection but came later in
      // the queue, it makes that connection now, with its own weight
      if (!same(was.get(key), wd)) assert.ok(reach.has(key), `without gene ${at}, ${key} changed but the gene does not reach it`);
    }
    for (const key of was.keys()) if (!now.has(key)) { gone++; assert.ok(reach.has(key), `without gene ${at}, ${key} is gone but the gene does not reach it`); }
  });
  assert.ok(gone > old.S / 2, `${gone} of ${old.S} connections went with their genes`);
});

test('brain: a doubled wiring gene grows more connections than one copy (the copy rolls its own dice)', (Evo, assert) => {
  const genes = Evo.FOUNDER_GENOMES.FEMALE;
  // Tastes into the thinking regions: a broad tract, where many connections are a matter of chance
  const at = genes.findIndex(g => g.gene === 'Axon guidance' && g.source.lobe === 'taste');
  const doubledGenes = [...genes.slice(0, at + 1), genes[at], ...genes.slice(at + 1)];
  const doubled = Evo.Genome.founder('FEMALE', doubledGenes).develop();
  const [first, copy] = doubled.axonGuidance.filter(r => r.source.lobe === Evo.LOBE_ORDER.indexOf('taste'));
  assert.notStrictEqual(copy.dice, first.dice, 'the copy has dice of its own');
  const one = founderBrain(Evo), two = new Evo.Brain(doubled);
  assert.ok(two.S > one.S, `one copy grows ${one.S} connections in all, two copies ${two.S}`);
  const had = connections(one), has = connections(two);
  for (const key of had.keys()) assert.ok(has.has(key), `the doubled brain keeps ${key}`);
});

test('brain: the first female and male are born with their reflex arcs', (Evo, assert) => {
  const motor = key => Evo.MOTORS.findIndex(m => m.key === key);
  const touch = key => Evo.TOUCH.findIndex(t => t.key === key);
  for (const sex of ['FEMALE', 'MALE']) {
    const b = founderBrain(Evo, sex);
    const M = k => b.lobes.motor[motor(k)], T = k => b.lobes.touch[touch(k)], D = k => b.lobes.needs[Evo.driveCell(k)];
    const arcs = {
      painRun: [D('pain'), M('run')], sleepyRest: [D('sleepiness'), M('rest')],
      bumpTurnL: [T('contactL'), M('walkR')], bumpTurnR: [T('contactR'), M('walkL')]
    };
    for (const [arc, [from, to]] of Object.entries(arcs)) assert.ok(b.hasSynapse(from, to), `${sex}: ${arc}`);
  }
});

// How often (share of ticks) the Brainstem cell above one muscle fires while a drive sits at `level` and
// a touch cell is on or off. The current is what Creature.sense gives the cells: a drive cell gets
// (level - 0.05) * 1.2 * 30 mV (the receptor gene's threshold and gain, then the sense gain), a touch cell 30 mV.
function stemCellShare(Evo, muscle, drive, touch, level, touchOn) {
  Evo.seed(5);
  const b = founderBrain(Evo);
  const input = new Float32Array(b.N);
  const D = b.lobes.needs[Evo.driveCell(drive)], T = b.lobes.touch[Evo.TOUCH.findIndex(t => t.key === touch)];
  const m = b.lobes.motor[Evo.MOTORS.findIndex(x => x.key === muscle)];
  const cell = b.incoming(m).map(s => b.sSrc[s]).find(i => b.neurons[i].lobe === 'stem');
  if (cell === undefined) return null;
  let fired = 0;
  for (let t = 0; t < 320; t++) {
    input[D] = (level - 0.05) * 1.2 * 30;
    input[T] = touchOn ? 30 : 0;
    b.tick(input, TICK_OPTS);
    if (t >= 20) fired += b.hist[cell] & 1;
  }
  return fired / 300;
}

// Neither input alone may fire the cell, a weak drive with touch may not either, and together they do
function checkTwoThingsAtOnce(Evo, assert, muscle, drive, touch) {
  const share = (level, touchOn) => stemCellShare(Evo, muscle, drive, touch, level, touchOn);
  const driveAlone = share(0.6, false), touchAlone = share(0, true), both = share(0.6, true), weakDrive = share(0.15, true);
  assert.notStrictEqual(driveAlone, null, `a Brainstem cell excites the ${muscle} muscle`);
  const said = `${muscle}: ${drive} alone ${driveAlone}, ${touch} alone ${touchAlone}, both ${both}, weak ${drive} with ${touch} ${weakDrive}`;
  assert.ok(driveAlone < 0.02, said);
  assert.ok(touchAlone < 0.02, said);
  assert.ok(both > 0.1, said);
  assert.ok(weakDrive < 0.05, said);
}

test('brain: the eat Brainstem cell fires only when hunger and something at the mouth come together', (Evo, assert) => {
  checkTwoThingsAtOnce(Evo, assert, 'eat', 'hunger', 'mouthL');
});

test('brain: the drink Brainstem cell fires only when thirst and water at the lips come together', (Evo, assert) => {
  checkTwoThingsAtOnce(Evo, assert, 'drink', 'thirst', 'lips');
});

test('brain: a driven sense cell makes its downstream cells fire',(Evo, assert) => {
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

test("brain: a Cell type gene sets its region's resting activity", (Evo, assert) => {
  const brain = founderBrain(Evo);
  const restOf = lobe => brain.traits.cellTypes.find(e => Evo.LOBE_ORDER[e.lobeIdx] === lobe).restingRate;
  // The Feelings cells that feed the body's emitters (all but the reward and punishment cells) and the
  // Brainstem cells rest where their gene says; the muscles' pacemaker gene lifts theirs above it
  for (const i of brain.lobes.feelings.slice(2)) assert.ok(Math.abs(brain.targetRate[i] - restOf('feelings')) < 1e-9);
  for (const i of brain.lobes.stem) assert.ok(Math.abs(brain.targetRate[i] - restOf('stem')) < 1e-9);
  for (const i of brain.lobes.motor) assert.ok(brain.targetRate[i] >= restOf('motor'));
  for (const n of brain.neurons) assert.strictEqual(brain.rate[n.index], brain.targetRate[n.index], `cell ${n.index} starts at its resting activity`);
  // Without the genes, those cells rest like a thinking cell, far busier
  const without = new Evo.Brain(Evo.Genome.founder('FEMALE', Evo.FOUNDER_GENOMES.FEMALE.filter(g => g.gene !== 'Cell type')).develop());
  const usual = without.targetRate[without.lobes.cortex[0]];
  assert.ok(usual > 10 * restOf('feelings'));
  for (const i of without.lobes.feelings.slice(2)) assert.strictEqual(without.targetRate[i], usual);
});

test("brain: a guidance gene aims at its source cell's own side, the other side, both, or a fixed side", (Evo, assert) => {
  const brain = founderBrain(Evo), { wire, muscleSpot, colourSpot } = Evo.founderKit;
  const aim = (from, to, cell, at, side) => {
    const spec = wire(from, to, { at, radius: 0.06, weight: 0.5, side });
    const rule = new Evo.Genome([0, ...Evo.encodeGene(spec), 0], 'X').develop().axonGuidance[0];
    return brain.tractTargets(rule, brain.neurons[cell]).map(([d]) => d.side);
  };
  const eyeL = brain.lobes.sight[Evo.BRAIN_BODY_PLAN.sightIndex('L', 'low', 'red')], eyeR = brain.lobes.sight[Evo.BRAIN_BODY_PLAN.sightIndex('R', 'low', 'red')];
  const walkL = muscleSpot('walkL');
  // The walking muscles are a pair, in a region that is not two-sided: the right one is the mirror image of the left
  assert.deepStrictEqual(aim('sight', 'motor', eyeL, walkL, 'same'), ['L']);
  assert.deepStrictEqual(aim('sight', 'motor', eyeR, walkL, 'same'), ['R']);
  assert.deepStrictEqual(aim('sight', 'motor', eyeL, walkL, 'other'), ['R']);
  assert.deepStrictEqual(aim('sight', 'motor', eyeR, walkL, 'left'), ['L']);
  assert.deepStrictEqual(aim('sight', 'motor', eyeL, walkL, 'right'), ['R']);
  // A cell with no side aims at both sides
  assert.deepStrictEqual(aim('needs', 'motor', brain.lobes.needs[0], walkL, 'same'), ['L', 'R']);
  // In a two-sided region a side is its own box
  const red = colourSpot('red');
  assert.deepStrictEqual(aim('sight', 'attention', eyeR, red, 'same'), ['R']);
  assert.deepStrictEqual(aim('sight', 'attention', eyeR, red, 'left'), ['L']);
  assert.deepStrictEqual(aim('needs', 'attention', brain.lobes.needs[0], red, 'same'), ['L', 'R']);
});
