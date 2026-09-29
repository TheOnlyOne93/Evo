'use strict';
// How the brain learns: modulator cells, prediction errors, credit assignment.

const founderBrain = (Evo, sex = 'X') => new Evo.Brain(Evo.Genome.founder(sex).develop());

// Random sensory drive, as a creature looking around would get
function senseAround(Evo, brain, drive) {
  for (let i = 0; i < brain.N; i++) drive[i] = brain.isSensory[i] && brain.neurons[i].lobe !== 'needs' ? 25 * Evo.random() : 0;
}

test('learning: modulator cells stay silent without an outcome', (Evo, assert) => {
  const brain = founderBrain(Evo);
  const drive = new Float32Array(brain.N);
  for (let t = 0; t < 600; t++) {
    senseAround(Evo, brain, drive);
    brain.outcome[0] = 0; brain.outcome[1] = 0;
    brain.tick(drive, { noise: 0.35, arousal: 0, canFire: true });
  }
  for (const m of brain.modulatorCells) assert.ok(brain.rate[m] < 0.02, `modulator ${m} fires at ${brain.rate[m].toFixed(3)}`);
});

const quiet = { noise: 0.35, arousal: 0, canFire: true };

test('learning: an unexpected outcome is a prediction error; a constant one stops being one', (Evo, assert) => {
  const brain = founderBrain(Evo);
  const drive = new Float32Array(brain.N);
  for (let t = 0; t < 200; t++) brain.tick(drive, quiet);
  brain.outcome[0] = 0.5;
  brain.tick(drive, quiet);
  assert.ok(brain.delta[0] > 0.3, `error at an unexpected reward: ${brain.delta[0].toFixed(3)}`);
  const m = brain.modulatorCells[0];
  let fired = 0;
  for (let t = 0; t < 3; t++) { brain.tick(drive, quiet); fired += brain.hist[m] & 1; }
  assert.ok(fired > 0, 'the reward cell fires on the error');
  for (let t = 0; t < 400; t++) brain.tick(drive, quiet);
  assert.ok(Math.abs(brain.delta[0]) < 0.05, `error once the reward is usual: ${brain.delta[0].toFixed(3)}`);
  // Punishment works the same way on its own channel
  brain.outcome[1] = 0.5;
  brain.tick(drive, quiet);
  assert.ok(brain.delta[1] > 0.3 && Math.abs(brain.delta[0]) < 0.05);
});

test('learning: a cue that comes before reward comes to predict it', (Evo, assert) => {
  const brain = founderBrain(Evo);
  const drive = new Float32Array(brain.N);
  const P = Evo.BRAIN_BODY_PLAN;
  const cue = ['L', 'R'].flatMap(side => ['low', 'high'].map(band => brain.lobes.sight[P.sightIndex(side, band, 'yellow')]));
  const valueOf = () => brain.valueIn[0].reduce((w, s) => w + (cue.includes(brain.sSrc[s]) ? brain.sW[s] : 0), 0);
  // The founder's cue synapses start out predicting a little: the cue alone first teaches it nothing comes
  const trial = reward => {
    let error = 0;
    for (let t = 0; t < 120; t++) {
      for (const i of cue) drive[i] = t < 20 ? 30 : 0;
      brain.outcome[0] = reward && t === 20 ? 0.5 : 0;
      brain.tick(drive, quiet);
      // The prediction fades over a few ticks after the cue goes, so the error at the reward is
      // the sum over those ticks
      if (t >= 20 && t < 32) error += brain.delta[0];
    }
    return error;
  };
  for (let k = 0; k < 30; k++) trial(false);
  const w0 = valueOf();
  const errors = [];
  for (let k = 0; k < 40; k++) errors.push(trial(true));
  assert.ok(valueOf() > w0, `cue value synapses ${w0.toFixed(3)} -> ${valueOf().toFixed(3)}`);
  assert.ok(errors[39] < errors[0] * 0.6, `error at the reward: ${errors[0].toFixed(3)} first, ${errors[39].toFixed(3)} after 40 pairings`);
});

// Neuron A excites X and Y; X is made to fire just after A's spike arrives, Y is not. An outcome
// on `channel` follows 30 ticks later. Returns the weight changes of A->X and A->Y.
function creditTrial(Evo, channel, weight) {
  const brain = founderBrain(Evo);
  const field = brain.field[channel];
  const plain = [...brain.lobes.cortex, ...brain.lobes.side, ...brain.lobes.central];
  const [X, Y] = plain.slice().sort((a, b) => field[b] - field[a]);
  const A = plain.find(i => i !== X && i !== Y);
  for (const dst of [X, Y]) {
    const old = brain.incoming(dst).find(s => brain.sSrc[s] === A);
    if (old !== undefined) brain.removeSynapse(old);
  }
  const ax = brain.addSynapse(A, X, weight), ay = brain.addSynapse(A, Y, weight);
  const drive = new Float32Array(brain.N), still = { noise: 0, arousal: 0, canFire: true };
  for (let t = 0; t < 200; t++) brain.tick(drive, still);
  const wx = brain.sW[ax], wy = brain.sW[ay];
  brain.inject(A, 60, 1);
  brain.inject(X, 60, brain.sDelay[ax] + 2);
  for (let t = 0; t < 120; t++) {
    brain.outcome[channel] = t >= 30 && t < 45 ? 0.5 : 0;
    brain.tick(drive, still);
  }
  return { dx: brain.sW[ax] - wx, dy: brain.sW[ay] - wy, fieldX: field[X] };
}

test('learning: reward credits the synapse that made its target fire, not its neighbour', (Evo, assert) => {
  const { dx, dy, fieldX } = creditTrial(Evo, 0, 0.3);
  assert.ok(fieldX > 0.5, `the target sits in the reward cell's field (${fieldX.toFixed(2)})`);
  assert.ok(dx > 0.02, `A->X grows: ${dx.toFixed(4)}`);
  assert.ok(Math.abs(dy) < 0.1 * dx, `A->Y stays: ${dy.toFixed(4)}`);
});

test('learning: punishment weakens the synapse that made its target fire, not its neighbour', (Evo, assert) => {
  const { dx, dy } = creditTrial(Evo, 1, 0.7);
  // (Weakening is gentler: the soft bound scales it by how far the weight is from 0)
  assert.ok(dx < -0.01, `A->X weakens: ${dx.toFixed(4)}`);
  assert.ok(Math.abs(dy) < 0.1 * -dx, `A->Y stays: ${dy.toFixed(4)}`);
});

test('learning: a brain tick stays within its time budget', (Evo, assert) => {
  // In a living world (16 creatures must run at 60 frames a second)
  const world = new Evo.World();
  const B = Evo.Brain.prototype, { tick, runMorphogenesis } = B;
  let ns = 0n, ticks = 0;
  B.tick = function (...a) { const t0 = process.hrtime.bigint(); const r = tick.apply(this, a); ns += process.hrtime.bigint() - t0; ticks++; return r; };
  B.runMorphogenesis = function () { const t0 = process.hrtime.bigint(); runMorphogenesis.call(this); ns += process.hrtime.bigint() - t0; };
  try {
    for (let t = 0; t < 800; t++) {
      if (t === 200) { ns = 0n; ticks = 0; }
      world.step();
    }
  } finally {
    Object.assign(B, { tick, runMorphogenesis });
  }
  const us = Number(ns) / 1000 / ticks;
  assert.ok(us < 60, `${us.toFixed(1)} us per creature-tick`);
});

test('learning: flat-out input and relentless reward neither run away nor break the weights', (Evo, assert) => {
  const brain = founderBrain(Evo);
  const drive = new Float32Array(brain.N);
  for (let i = 0; i < brain.N; i++) drive[i] = brain.isSensory[i] ? 30 : 0;
  let spikes = 0;
  for (let t = 0; t < 3000; t++) {
    brain.outcome[0] = t % 50 < 25 ? 1 : 0;
    const n = brain.tick(drive, { noise: 2, arousal: 3, canFire: true });
    if (t >= 1000) spikes += brain.spikesThisTick;
    if (brain.tickCount % Evo.BRAIN.MORPHOGENESIS_EVERY === 0) brain.runMorphogenesis();
    assert.ok(n >= 0);
  }
  const share = spikes / 2000 / brain.N;
  assert.ok(share < 0.3, `${Math.round(share * 100)}% of neurons fire each tick`);
  const { WEIGHT_MIN, WEIGHT_MAX } = Evo.BRAIN;
  for (let s = 0; s < brain.S; s++) assert.ok(Number.isFinite(brain.sW[s]) && brain.sW[s] >= WEIGHT_MIN && brain.sW[s] <= WEIGHT_MAX);
});

// Awake, sight cell A and muscle X fire together and reward follows; then the brain sleeps for
// 3000 ticks, replaying what it remembers (or, with forget, remembering nothing). Returns the
// change of w(A->X) during sleep.
function sleepAfterReward(Evo, forget) {
  Evo.seed(7);
  const brain = founderBrain(Evo);
  const A = brain.lobes.sight[Evo.BRAIN_BODY_PLAN.sightIndex('L', 'low', 'red')], X = brain.lobes.motor[0];
  const old = brain.incoming(X).find(s => brain.sSrc[s] === A);
  if (old !== undefined) brain.removeSynapse(old);
  const ax = brain.addSynapse(A, X, 0.2);
  const drive = new Float32Array(brain.N);
  const awake = { noise: 0.35, arousal: 0, canFire: true, asleep: false }, asleep = { ...awake, asleep: true };
  for (let t = 0; t < 200; t++) brain.tick(drive, awake);
  for (let trial = 0; trial < 4; trial++) {
    for (let t = 0; t < 100; t++) {
      drive[A] = t < 30 ? 30 : 0;
      drive[X] = t >= 5 && t < 30 ? 20 : 0;
      brain.outcome[0] = t >= 25 && t < 30 ? 0.5 : 0;
      brain.tick(drive, awake);
    }
  }
  drive.fill(0);
  if (forget) brain.episodes.length = 0;
  const episodes = brain.episodes.length, w0 = brain.sW[ax];
  for (let t = 0; t < 3000; t++) {
    brain.sleepStep([], null);
    brain.tick(drive, asleep);
  }
  return { episodes, dw: brain.sW[ax] - w0 };
}

test('learning: sleep replays a rewarded moment and strengthens what led to it', (Evo, assert) => {
  const replay = sleepAfterReward(Evo, false), idle = sleepAfterReward(Evo, true);
  assert.ok(replay.episodes > 0, 'the reward was remembered');
  assert.ok(replay.dw > idle.dw + 0.002, `w(A->X) grows by ${replay.dw.toFixed(4)} replaying, ${idle.dw.toFixed(4)} idle`);
});

test('learning: dreaming an instinct strengthens its synapse', (Evo, assert) => {
  const run = dream => {
    Evo.seed(3);
    const world = new Evo.World();
    world.creatures.length = 1;
    const c = world.creatures[0], b = c.brain;
    const inst = c.traits.instincts.find(i => i.chem === Evo.CHEM.reward && i.indexA < b.lobes[Evo.LOBE_ORDER[i.lobeA]].length);
    const a = b.lobes[Evo.LOBE_ORDER[inst.lobeA]][inst.indexA], m = b.lobes.motor[inst.motor];
    const s = b.incoming(m).find(k => b.sSrc[k] === a) ?? b.addSynapse(a, m, 0.2);
    c.traits = { ...c.traits, instincts: dream ? [inst] : [] };
    c.updateSleep = () => {};
    c.asleep = true;
    const w0 = b.sW[s];
    for (let t = 0; t < 3000; t++) { c.chem.set('glucose', 0.5); c.chem.set('water', 0.8); world.step(); }
    return b.sW[s] - w0;
  };
  const dreaming = run(true), idle = run(false);
  assert.ok(dreaming > idle + 0.01, `the instinct's synapse grows by ${dreaming.toFixed(4)} dreaming it, ${idle.toFixed(4)} not`);
});

// In a quiet world a creature is made to call (its call muscle driven for a few ticks) every 300
// ticks, and the hand pats it `lag` ticks after each call. Returns the change in the summed weight
// of the synapses into the call muscle.
function patAfterCall(Evo, seed, lag) {
  Evo.seed(seed);
  const world = new Evo.World();
  world.items = []; world.maybeWanderer = () => {}; world.growFood = () => {};
  world.creatures.length = 1;
  const c = world.creatures[0], b = c.brain, call = b.lobes.motor[Evo.MOTORS.findIndex(m => m.key === 'call')];
  const inputs = () => b.incoming(call).reduce((w, s) => w + b.sW[s], 0);
  const calm = () => { for (const k of Evo.DRIVES) c.chem.set(k, 0); c.chem.set('glucose', 0.5); c.chem.set('water', 0.8); };
  for (let t = 0; t < 200; t++) { calm(); world.step(); }
  const w0 = inputs();
  for (let k = 0; k < 4; k++) {
    for (let t = 0; t < 300; t++) {
      calm();
      if (t < 6) b.inject(call, 40, 1);
      if (t === lag) world.pat(c);
      world.step();
    }
  }
  return inputs() - w0;
}

test('learning: a pat just after an action strengthens what drove it; the same pat much later does not', (Evo, assert) => {
  let soon = 0, late = 0;
  for (let seed = 1; seed <= 3; seed++) { soon += patAfterCall(Evo, seed, 10); late += patAfterCall(Evo, seed, 150); }
  assert.ok(soon > late + 0.3, `inputs to the call muscle grow by ${soon.toFixed(2)} patted just after calling, ${late.toFixed(2)} patted 150 ticks later`);
});
