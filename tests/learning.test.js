'use strict';
// How the brain learns: modulator cells, prediction errors, credit assignment.

const founderBrain = (Evo, sex = 'X') => new Evo.Brain(Evo.Genome.founder(sex).develop());
const skip = () => {}; // A test waiting for the brain change that makes it pass

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
