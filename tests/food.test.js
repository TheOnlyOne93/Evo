'use strict';
// Eating and drinking, set up the way a player would: a hungry creature with fruit dropped in front
// of it or behind it, a mimic berry (it looks and smells much like fruit but makes the eater sick),
// a thirsty creature set down in or beside the water, and a creature given mimic berries again and
// again. Four tests hold today. The other two are to-dos: how a creature should drink and how it
// should learn, not yet how it does.
//
// Each world is built just before it is played and played to its end: the game's chance is one
// stream shared by every world, so a world built early would take a different turn.
const { test } = require('node:test');
const { Evo, game, play, feels, hungry, thirsty, dropAt, inSeeds } = require('./kit.js');

const SEEDS = [1, 2, 3, 4];
// The floor for a to-do: what the game should do in all seeds but one
const MOST = SEEDS.length - 1;

const SETTLE_TICKS = 600;  // Each test starts this far into the game, with the pair up and about
const FIND_TICKS = 3000;   // How long a hungry creature gets to find food
const AHEAD = 60;          // How far in front of the creature (px) food is dropped
const BEHIND = 150;        // How far behind it (px) food is dropped
const SICK_TICKS = 600;    // How long to watch for sickness after a bad meal
const QUEASY = 0.2;        // Nausea that counts as feeling sick
const EDGE_IN = 12;        // How far inside the water (px) a creature is set down at its edge
const IN_SIGHT = 100;      // How far outside the water (px) a creature is set down, in sight of it
const HOLD_ABOVE = 20;     // How high above the water or the ground (px) the hand lets go
const DRINK_TICKS = 600;   // How long a creature set down in the water gets to take a sip
const ROUNDS = 4;          // How many mimic berries a creature is given, one after another
const BETWEEN_TICKS = 600; // A pause after each round, so a meal is over before it is made hungry again

// A world, and its first founder (the female), as they are SETTLE_TICKS into the game
function start(seed) {
  const world = game(seed, SETTLE_TICKS);
  return { world, c: world.creatures[0] };
}

// Play up to `ticks` ticks until somebody eats this very item. Returns { at, by }: the tick it was
// eaten (null if it wasn't) and the creature that ate it (null if none did).
function eats(world, item, ticks) {
  let by = null;
  world.events.on('eat', ({ creature, item: eaten }) => {
    if (eaten === item) by = creature;
  });
  const at = play(world, ticks, () => by !== null);
  return { at, by };
}

// The hand picks the creature up and holds it at (x, y), lets go with no throw, and waits until it
// stands again
function setDown(world, c, x, y) {
  world.grab({ creature: c }, x, y);
  play(world, 2);
  world.releaseHand(0, 0);
  return play(world, 600, () => c.onGround);
}

// What a hungry creature does with food dropped `offset` px from it (`offset` gets the creature's
// facing, so ahead is positive). Returns what the test needs to judge it.
function hungryFinds(seed, type, offset) {
  const { world, c } = start(seed);
  hungry(world, c);
  const item = dropAt(world, type, c.x + offset(c));
  const { at, by } = eats(world, item, FIND_TICKS);
  return { world, c, at, by };
}

function sayEaten({ at, by, c }) {
  if (at === null) return `not eaten in ${FIND_TICKS} ticks`;
  return by === c ? `ate it at tick ${at}` : `${by.name} ate it first, at tick ${at}`;
}

// The pond nearest to the creature (by the distance to the nearer end of its water), the end that is
// nearer, and which way is inside the water from there (1 to the right, -1 to the left)
function nearestWater(world, c) {
  let best = null;
  for (const pond of world.terrain.ponds) {
    for (const [end, inward] of [[pond.x0, 1], [pond.x1, -1]]) {
      const distance = Math.abs(c.x - end);
      if (!best || distance < best.distance) best = { pond, end, inward, distance };
    }
  }
  return best;
}

// A thirsty creature set down at x (given the nearest water) gets `ticks` ticks to take a sip.
// Returns the tick of its first sip, or null.
function drinksAfterSetDown(world, c, x, y, ticks) {
  let sipped = false;
  world.events.on('drink', ({ creature }) => {
    if (creature === c) sipped = true;
  });
  setDown(world, c, x, y);
  return play(world, ticks, () => sipped);
}

test('hungry, it eats a fruit dropped in front of it', () => {
  // Today 3 of 4: seed 3 did not eat it
  inSeeds(SEEDS, 2, seed => {
    const r = hungryFinds(seed, 'fruit', c => c.facing * AHEAD);
    return { ok: r.by === r.c, note: sayEaten(r) };
  });
});

test('hungry, it finds a fruit dropped behind it', () => {
  // Today 3 of 4: seed 3 did not find it
  inSeeds(SEEDS, 2, seed => {
    const r = hungryFinds(seed, 'fruit', c => -c.facing * BEHIND);
    return { ok: r.by === r.c, note: sayEaten(r) };
  });
});

test('hungry, it eats a mimic berry and feels sick', () => {
  // Today 1 of 4: seeds 1, 2 and 3 did not eat it
  inSeeds(SEEDS, 1, seed => {
    const r = hungryFinds(seed, 'mimic', c => c.facing * AHEAD);
    if (r.by !== r.c) return { ok: false, note: sayEaten(r) };
    let nausea = 0;
    play(r.world, SICK_TICKS, () => {
      nausea = Math.max(nausea, feels(r.c, 'nausea'));
      return false;
    });
    return { ok: nausea > QUEASY, note: `${sayEaten(r)}; highest nausea ${nausea.toFixed(2)}` };
  });
});

test('thirsty and set down at the water\'s edge, it drinks', { todo: 'a thirsty creature in the water mostly doesn\'t drink' }, () => {
  inSeeds(SEEDS, MOST, seed => {
    const { world, c } = start(seed);
    thirsty(world, c);
    const { pond, end, inward } = nearestWater(world, c);
    const sip = drinksAfterSetDown(world, c, end + inward * EDGE_IN, pond.level - HOLD_ABOVE, DRINK_TICKS);
    return { ok: sip !== null, note: sip === null ? `no sip in ${DRINK_TICKS} ticks` : `first sip at tick ${sip}` };
  });
});

test('thirsty with water in sight, it goes and drinks', () => {
  // Today 3 of 4: seed 1 did not drink
  inSeeds(SEEDS, 2, seed => {
    const { world, c } = start(seed);
    thirsty(world, c);
    const { end, inward } = nearestWater(world, c);
    const x = end - inward * IN_SIGHT;
    const ticks = Evo.DAY_TICKS / 2;
    const sip = drinksAfterSetDown(world, c, x, world.terrain.groundY(x) - HOLD_ABOVE, ticks);
    return { ok: sip !== null, note: sip === null ? `no sip in ${ticks} ticks` : `first sip at tick ${sip}` };
  });
});

test('after a few mimic berries, it eats fewer', { todo: 'creatures don\'t learn to avoid mimic berries yet' }, () => {
  inSeeds(SEEDS, MOST, seed => {
    const { world, c } = start(seed);
    const ate = [];
    for (let round = 0; round < ROUNDS; round++) {
      hungry(world, c);
      const item = dropAt(world, 'mimic', c.x + c.facing * AHEAD);
      const { by } = eats(world, item, FIND_TICKS);
      ate.push(by === c ? 1 : 0);
      play(world, BETWEEN_TICKS);
    }
    const half = ROUNDS / 2;
    const sum = list => list.reduce((a, b) => a + b, 0);
    const first = sum(ate.slice(0, half)), last = sum(ate.slice(half));
    return { ok: last < first, note: `ate ${first} then ${last}` };
  });
});
