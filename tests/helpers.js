'use strict';
// Shared by the tests and by tools/behave.js and its scenarios. Every helper takes Evo, as the tests do.

// A fresh brain from a founder genome (the first female's unless told otherwise)
const founderBrain = (Evo, sex = 'FEMALE') => new Evo.Brain(Evo.Genome.founder(sex).develop());

// The options for Brain.tick most tests use: ordinary noise, awake, allowed to fire
const TICK_OPTS = { noise: 0.35, arousal: 0, canFire: true };

// The first female's genes with the thinking lobe's persistence gene set to 0 (no working memory)
const cortexKnockout = Evo => Evo.FOUNDER_GENOMES.FEMALE.map(g => g.gene === 'Lobe dynamics' && g.lobe === 'cortex' ? { ...g, persistence: 0 } : g);

// A seeded world with one creature and nothing else happening. `phase` sets the time of day when given.
function quietWorld(Evo, seed, phase) {
  Evo.seed(seed);
  const world = new Evo.World();
  world.items = [];
  world.growFood = () => {};
  world.maybeWanderer = () => {};
  if (phase !== undefined) {
    world.startPhase = phase;
    world.updateClock();
  }
  const c = world.creatures[0];
  world.creatures = [c];
  return { world, c };
}

// Make a quiet creature call (or jump) by driving its muscle for a few ticks every 300 ticks, and pat it
// `lag` ticks after each drive, `rounds` times. calm() is called before every tick, to hold its drives.
function callThenPat(world, c, muscle, lag, rounds, calm) {
  for (let t = 0; t < rounds * 300; t++) {
    calm();
    if (t % 300 < 6) c.brain.inject(muscle, 40, 1);
    if (t % 300 === lag) world.pat(c);
    world.step();
  }
}

module.exports = { founderBrain, TICK_OPTS, cortexKnockout, quietWorld, callThenPat };
