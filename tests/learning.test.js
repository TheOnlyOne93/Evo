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
  for (let k = 0; k < 30; k++) errors.push(trial(true));
  assert.ok(valueOf() > w0, `cue value synapses ${w0.toFixed(3)} -> ${valueOf().toFixed(3)}`);
  assert.ok(errors[29] < errors[0] * 0.6, `error at the reward: ${errors[0].toFixed(3)} first, ${errors[29].toFixed(3)} after 30 pairings`);
});
