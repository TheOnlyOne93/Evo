// What the test files share. The tests play the real game: the world built the way the page builds
// it (the valley, the starting pair and their food), played only with the player's tools (the hand,
// tickle, slap, dropping things, adding creatures, skipping a season, waiting), and judged by what
// the player can see (what a creature is doing, its needs, what just happened to it, its health and
// stage, the log). Run them with: node --test
'use strict';
const assert = require('node:assert/strict');
const Evo = require('./load.js')();

// tools/breakage.js runs the tests with one part of the game broken on purpose, named here
if (process.env.EVO_BREAK) {
  const breakage = require('../tools/breakage.js').breakages[process.env.EVO_BREAK];
  if (!breakage) throw new Error(`no breakage named ${process.env.EVO_BREAK}`);
  breakage(Evo);
}

// How many times each thing has happened to each creature: its stimuli, which the card lists as
// Ate, Drank, Tickled, Slapped, Fell hard and so on
const happened = new WeakMap();
const stimulate = Evo.Creature.prototype.stimulate;
Evo.Creature.prototype.stimulate = function (key, s) {
  const counts = happened.get(this) || {};
  counts[key] = (counts[key] || 0) + 1;
  happened.set(this, counts);
  return stimulate.call(this, key, s);
};
const times = (c, key) => (happened.get(c) || {})[key] || 0;

// The game as the page starts it (Evo.DEFAULT_SEED is the one every player sees first), `ticks` in.
// All worlds draw on one stream of chance, so play a world to its end before building the next.
function game(seed = Evo.DEFAULT_SEED, ticks = 0) {
  Evo.seed(seed);
  const world = new Evo.World();
  play(world, ticks);
  return world;
}

// Let the world run up to `ticks` ticks. With until(t), stop once it is true and return that tick (null
// if it never was)
function play(world, ticks, until) {
  for (let t = 0; t < ticks; t++) {
    world.step();
    if (until && until(t)) return t;
  }
  return null;
}

// How strongly it feels a need or a feeling (0..1)
const feels = (c, key) => c.body.chem.get(key);
// A need it clearly feels (the tests' own level)
const FELT = 0.3;

// Make it hungry the way a body gets there: empty its stomach (sugar and starch still to digest keep
// hunger away) and its blood sugar and stores, then wait until it feels it. The creature's own
// chemistry does the rest. Returns the ticks it took.
function hungry(world, c) {
  c.body.chem.set('gutSugar', 0);
  c.body.chem.set('gutStarch', 0);
  c.body.chem.set('glucose', 0.05);
  c.body.chem.set('glycogen', 0.05);
  return waitToFeel(world, c, 'hunger');
}

// Make it thirsty the same way: take water from its body, then wait until it feels it
function thirsty(world, c) {
  c.body.chem.set('water', 0.25);
  return waitToFeel(world, c, 'thirst');
}

function waitToFeel(world, c, need) {
  const t = play(world, Evo.DAY_TICKS, () => feels(c, need) > FELT);
  assert.notEqual(t, null, `${c.name} never felt ${need}`);
  return t;
}

// Pick a creature up, hold it `height` px above the ground under it, and let go with the hand moving
// at (vx, vy), as the hand tool does. Returns once it is back on the ground.
function lift(world, c, height, vx = 0, vy = 0) {
  world.grab({ creature: c }, c.x, world.terrain.groundY(c.x) - height);
  play(world, 2);
  world.releaseHand(vx, vy);
  return play(world, 600, () => c.onGround);
}

// Drop an item a little above the ground at x, as the item tools do
const dropAt = (world, type, x) => world.dropItem(type, x, world.terrain.groundY(x) - 40);

// The sun is down
const isNight = world => world.clock.sunElevation < 0;

// A living creature won't do the same thing in every world, so a behaviour holds when it holds in at
// least `floor` of the seeds. fn(seed) returns { ok, note }; the notes show on a failure.
function inSeeds(seeds, floor, fn) {
  const notes = [];
  let held = 0;
  for (const seed of seeds) {
    const r = fn(seed);
    if (r.ok) held++;
    notes.push(`seed ${seed}: ${r.note}`);
  }
  assert.ok(held >= floor, `held in ${held} of ${seeds.length} seeds, needs ${floor}. ${notes.join('; ')}`);
}

module.exports = { Evo, game, play, times, feels, FELT, hungry, thirsty, lift, dropAt, isNight, inSeeds };
