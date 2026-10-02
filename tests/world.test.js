'use strict';
// What the player can put into the world, and what comes of it: a thorn bush planted in a creature's
// way, a ball dropped in front of it, an egg set down nearby (in spring and in winter), two more
// adults, and winter skipped to, with a thick-furred adult. Seven tests hold today. The last is a
// to-do: how a creature should act after a prick, not yet how it does.
//
// Each world is built just before it is played and played to its end: the game's chance is one
// stream shared by every world, so a world built early would take a different turn.
const { test } = require('node:test');
const { Evo, game, play, times, feels, FELT, dropAt, inSeeds } = require('./kit.js');

const SEEDS = [1, 2, 3];
// The floor for a to-do: what the game should do in all seeds but one
const MOST = SEEDS.length - 1;

const SETTLE_TICKS = 600;  // Each test starts this far into the game, with the pair up and about
const THORN_AHEAD = 100;   // How far in front of the creature (px) a thorn bush is planted
const PRICK_TICKS = 4500;  // How long the pair gets to walk into the bush
const MORE_PRICKS = 2;     // After its first prick, the most more pricks it may take in half a day
const BALL_AHEAD = 40;     // How far in front of the creature (px) a ball is dropped
const PLAY_TICKS = 3000;   // How long a dropped ball gets to be picked up
const EGG_AWAY = 80;       // How far from the creature (px) an egg is set down
const EGG_ABOVE = 40;      // How high above the ground (px) an egg is let go
const COLD_SHARE = 0.25;   // The share of a winter day a founder must feel cold in

const BABY = Evo.STAGES.findIndex(s => s.key === 'baby');
const WINTER_DAY = Evo.SEASON_DAYS * Evo.SEASONS.findIndex(s => s.key === 'WINTER');

// A world, and its first founder (the female), as they are SETTLE_TICKS into the game
function start(seed) {
  const world = game(seed, SETTLE_TICKS);
  return { world, c: world.creatures[0] };
}

// Skip to the first day of winter, at the hour a world begins (a morning)
function winter(world) {
  world.setTime(WINTER_DAY, world.startPhase);
}

// Write down every death in the world as it happens, as 'name (cause)'. Returns the list.
function recordDeaths(world) {
  const deaths = [];
  world.events.on('death', ({ creature, cause }) => deaths.push(`${creature.name} (${cause})`));
  return deaths;
}

// Plant a thorn bush THORN_AHEAD px in front of `c` and play up to PRICK_TICKS ticks until one of
// the pair is pricked. Returns { by, at, painBefore, painAfter }: the one that was, the tick, and how
// much pain it felt a tick before and on that tick (all null if neither was pricked).
function plantsThorn(world, c) {
  const pair = world.creatures.slice(0, 2);
  const before = pair.map(f => times(f, 'pricked'));
  const x = c.x + c.facing * THORN_AHEAD;
  world.dropItem('thorn', x, world.terrain.groundY(x));
  let pain = pair.map(f => feels(f, 'pain')); // How much pain each felt at the end of the last tick
  let by = null, painBefore = null, painAfter = null;
  const at = play(world, PRICK_TICKS, () => {
    const i = pair.findIndex((f, k) => times(f, 'pricked') > before[k]);
    if (i >= 0) {
      by = pair[i];
      painBefore = pain[i];
      painAfter = feels(by, 'pain');
      return true;
    }
    pain = pair.map(f => feels(f, 'pain'));
    return false;
  });
  return { by, at, painBefore, painAfter };
}

// Set an egg down EGG_AWAY px in front of `c`, let go EGG_ABOVE px above the ground. Returns what is
// known of it: its `hatched` is null until it hatches, then { creature, stage } as it was born.
function setsDownEgg(world, c) {
  const x = c.x + EGG_AWAY;
  const egg = world.addEgg(x, world.terrain.groundY(x) - EGG_ABOVE);
  const watch = { hatched: null };
  world.events.on('hatch', ({ creature }) => {
    if (creature.genome === egg.genome) watch.hatched = { creature, stage: creature.stage };
  });
  return watch;
}

test('a thorn bush planted in its way pricks it, and it hurts', () => {
  // Today 3 of 3
  inSeeds(SEEDS, 2, seed => {
    const { world, c } = start(seed);
    const { by, at, painBefore, painAfter } = plantsThorn(world, c);
    if (by === null) return { ok: false, note: `nobody pricked in ${PRICK_TICKS} ticks` };
    return { ok: painAfter > painBefore, note: `${by.name} pricked at tick ${at}, pain ${painBefore.toFixed(2)} -> ${painAfter.toFixed(2)}` };
  });
});

test('a ball dropped in front of it gets played with', () => {
  // Today 3 of 3
  inSeeds(SEEDS, 2, seed => {
    const { world, c } = start(seed);
    const ball = dropAt(world, 'ball', c.x + c.facing * BALL_AHEAD);
    let by = null;
    world.events.on('grab', ({ creature, item }) => {
      if (item === ball) by = creature;
    });
    const at = play(world, PLAY_TICKS, () => by !== null);
    return { ok: by !== null, note: by === null ? `not picked up in ${PLAY_TICKS} ticks` : `${by.name} picked it up at tick ${at}` };
  });
});

test('an egg set down nearby hatches into a baby', () => {
  // Today 3 of 3
  inSeeds(SEEDS, 2, seed => {
    const { world, c } = start(seed);
    const egg = setsDownEgg(world, c);
    const at = play(world, Evo.DAY_TICKS, () => egg.hatched !== null);
    if (egg.hatched === null) return { ok: false, note: 'didn\'t hatch' };
    return { ok: egg.hatched.stage === BABY, note: `hatched at tick ${at}, as a ${Evo.STAGES[egg.hatched.stage].key}` };
  });
});

test('in the cold, an egg takes longer to hatch', () => {
  // Today 3 of 3
  inSeeds(SEEDS, 2, seed => {
    const spring = start(seed);
    const warmEgg = setsDownEgg(spring.world, spring.c);
    const at = play(spring.world, Evo.DAY_TICKS, () => warmEgg.hatched !== null);
    if (at === null) return { ok: false, note: 'in spring it didn\'t hatch in a day' };
    // Again, in winter, with as many ticks as the first egg took (ticks 0 to `at`)
    const cold = start(seed);
    winter(cold.world);
    const coldEgg = setsDownEgg(cold.world, cold.c);
    play(cold.world, at + 1);
    return {
      ok: coldEgg.hatched === null,
      note: `hatched at tick ${at} in spring; in winter ${coldEgg.hatched === null ? 'not by then' : 'it had hatched by then'}`
    };
  });
});

test('two more adults: they mate, eggs come, and nobody dies', () => {
  // Today 3 of 3
  inSeeds(SEEDS, 2, seed => {
    const { world } = start(seed);
    const added = [world.addAdult('FEMALE'), world.addAdult('MALE')];
    const deaths = recordDeaths(world);
    const matings = [];
    let eggs = 0;
    world.events.on('mate', pair => matings.push(pair));
    world.events.on('egg', () => eggs++);
    play(world, Evo.DAY_TICKS);
    const withNew = matings.filter(m => added.includes(m.mother) || added.includes(m.father)).length;
    return {
      ok: withNew >= 1 && eggs >= 1 && deaths.length === 0,
      note: `${matings.length} matings (${withNew} with an added adult), ${eggs} eggs, ${deaths.length} deaths${deaths.length ? `: ${deaths.join(', ')}` : ''}`
    };
  });
});

test('in winter they feel the cold, and nobody dies', () => {
  // Today 3 of 3
  inSeeds(SEEDS, 2, seed => {
    const { world } = start(seed);
    const pair = world.creatures.slice(0, 2);
    winter(world);
    const deaths = recordDeaths(world);
    const cold = pair.map(() => 0);
    play(world, Evo.DAY_TICKS, () => {
      pair.forEach((f, i) => {
        if (feels(f, 'coldness') > FELT) cold[i]++;
      });
      return false;
    });
    const shares = cold.map(n => n / Evo.DAY_TICKS);
    return {
      ok: shares.every(s => s >= COLD_SHARE) && deaths.length === 0,
      note: `${pair.map((f, i) => `${f.name} felt cold ${Math.round(shares[i] * 100)}% of the day`).join(', ')}; ${deaths.length} deaths${deaths.length ? `: ${deaths.join(', ')}` : ''}`
    };
  });
});

test('in winter, thick fur keeps it warmer', () => {
  // Today 2 of 3: in seed 2 the thick-furred one spent most of the day in the water, which chills it
  inSeeds(SEEDS, 1, seed => {
    const averageWith = insulation => {
      const { world } = start(seed);
      winter(world);
      const genes = Evo.FOUNDER_GENOMES.FEMALE.map(g => (g.gene === 'Insulation' ? { ...g, insulation } : g));
      const a = world.addAdult('FEMALE', { genome: Evo.Genome.founder('FEMALE', genes) });
      let sum = 0;
      play(world, Evo.DAY_TICKS, () => {
        sum += a.body.temperature;
        return false;
      });
      return sum / Evo.DAY_TICKS;
    };
    const thick = averageWith(1), thin = averageWith(0);
    return { ok: thick > thin, note: `average temperature ${thick.toFixed(3)} thick-furred, ${thin.toFixed(3)} thin-furred` };
  });
});

test('after its first prick, it keeps out of the thorns', { todo: 'pricks don\'t teach it to keep away yet' }, () => {
  inSeeds(SEEDS, MOST, seed => {
    const { world, c } = start(seed);
    const { by, at } = plantsThorn(world, c);
    if (by === null) return { ok: false, note: `nobody pricked in ${PRICK_TICKS} ticks` };
    const first = times(by, 'pricked');
    play(world, Evo.DAY_TICKS / 2);
    const more = times(by, 'pricked') - first;
    return { ok: more <= MORE_PRICKS, note: `${by.name} pricked at tick ${at}, then ${more} more times in half a day` };
  });
});
