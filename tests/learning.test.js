'use strict';
// How the brain learns: modulator cells, prediction errors, credit assignment.

const founderBrain = (Evo, sex = 'X') => new Evo.Brain(Evo.Genome.founder(sex).develop());
const skip = () => {}; // A test waiting for the brain change that makes it pass

// Random sensory drive, as a creature looking around would get
function senseAround(Evo, brain, drive) {
  for (let i = 0; i < brain.N; i++) drive[i] = brain.isSensory[i] && brain.neurons[i].lobe !== 'needs' ? 25 * Evo.random() : 0;
}

skip('learning: modulator cells stay silent without an outcome', (Evo, assert) => {
  const brain = founderBrain(Evo);
  const drive = new Float32Array(brain.N);
  for (let t = 0; t < 600; t++) {
    senseAround(Evo, brain, drive);
    brain.outcome[0] = 0; brain.outcome[1] = 0;
    brain.tick(drive, { noise: 0.35, arousal: 0, canFire: true });
  }
  for (const m of brain.modulatorCells) assert.ok(brain.rate[m] < 0.02, `modulator ${m} fires at ${brain.rate[m].toFixed(3)}`);
});
