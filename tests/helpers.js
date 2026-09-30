'use strict';
// Shared by the tests and by tools/behave.js and its scenarios. Every helper takes Evo, as the tests do.

// A fresh brain from the founder genome
const founderBrain = (Evo, sex = 'X') => new Evo.Brain(Evo.Genome.founder(sex).develop());

// The options for Brain.tick most tests use: ordinary noise, awake, allowed to fire
const TICK_OPTS = { noise: 0.35, arousal: 0, canFire: true };

// The founder genome with the thinking lobe's persistence gene set to 0 (no working memory)
const cortexKnockout = Evo => Evo.FOUNDER_GENOME.map(g => g.gene === 'Lobe dynamics' && g.lobe === 'cortex' ? { ...g, persistence: 0 } : g);

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

// Run body(reset) with the brain (tick and morphogenesis) and senses timed. body calls reset() when
// its warm-up is over. Returns the microseconds per creature-tick of each since then.
function timeCosts(Evo, body) {
  const B = Evo.Brain.prototype, C = Evo.Creature.prototype;
  const { tick, runMorphogenesis } = B, { sense } = C;
  let brainNs = 0n, senseNs = 0n, creatureTicks = 0;
  const timed = (fn, add) => function (...a) { const t0 = process.hrtime.bigint(); const r = fn.apply(this, a); add(process.hrtime.bigint() - t0); return r; };
  B.tick = timed(tick, d => { brainNs += d; creatureTicks++; });
  B.runMorphogenesis = timed(runMorphogenesis, d => { brainNs += d; });
  C.sense = timed(sense, d => { senseNs += d; });
  try {
    body(() => { brainNs = 0n; senseNs = 0n; creatureTicks = 0; });
  } finally {
    Object.assign(B, { tick, runMorphogenesis }); C.sense = sense;
  }
  return { brain: Number(brainNs) / 1000 / creatureTicks, senses: Number(senseNs) / 1000 / creatureTicks };
}

module.exports = { founderBrain, TICK_OPTS, cortexKnockout, quietWorld, callThenPat, timeCosts };
