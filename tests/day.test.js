'use strict';
// A day and a night in the valley, in four worlds: how the founding pair sleep, eat, drink and call,
// and whether each does it for a reason the player can read (tired, hungry, thirsty, lonely). The
// first two tests hold today. The rest are to-dos: how a creature should behave, not yet how it does.
const { test, before } = require('node:test');
const { Evo, game, play, times, feels, FELT, isNight, inSeeds } = require('./kit.js');

const SEEDS = [1, 2, 3, 4];
// The floor for a to-do: what the game should do in all seeds but one
const MOST = SEEDS.length - 1;

const SCARED = 0.5;       // How much fear counts as scared
const NIGHT_ASLEEP = 0.6; // The share of the night a creature should be asleep
const SCARED_SHARE = 0.1; // The share of the day a grown creature may be scared

// What the founders did in each seed, kept once for every test to read: days[seed] is one record each
const days = {};

// Close the run of chewing a record has open, if it has one
function endChew(r) {
  if (!r.chewing) return;
  r.chews++;
  if (r.chewFed) r.fedChews++;
  r.chewing = false;
  r.chewFed = false;
}

before(() => {
  for (const seed of SEEDS) {
    const world = game(seed);
    const records = [...world.creatures].map(c => ({
      c, name: c.name,
      ticks: 0, nightTicks: 0, asleepAtNight: 0, scared: 0,
      eats: 0, sips: 0, calls: 0, thirstySips: 0, lonelyCalls: 0,
      chews: 0, fedChews: 0,
      chewing: false, chewFed: false, ateNow: false // Only used while counting
    }));
    const recordOf = c => records.find(r => r.c === c);

    world.events.on('eat', ({ creature }) => {
      const r = recordOf(creature);
      if (!r) return;
      r.eats++;
      r.ateNow = true;
    });
    world.events.on('drink', ({ creature }) => {
      const r = recordOf(creature);
      if (!r) return;
      r.sips++;
      if (feels(creature, 'thirst') > FELT) r.thirstySips++;
    });
    world.events.on('call', ({ creature }) => {
      const r = recordOf(creature);
      if (!r) return;
      r.calls++;
      if (feels(creature, 'loneliness') > FELT) r.lonelyCalls++;
    });

    // A whole day and night, until the next noon, so a creature asleep at dawn has time to wake
    play(world, Math.round((1.5 - world.startPhase) * Evo.DAY_TICKS), () => {
      const night = isNight(world);
      for (const r of records) {
        const c = r.c;
        if (c.dead) {
          endChew(r);
          continue;
        }
        r.ticks++;
        if (night) {
          r.nightTicks++;
          if (c.body.asleep) r.asleepAtNight++;
        }
        if (feels(c, 'fear') > SCARED) r.scared++;
        // A chew is a run of ticks with the mouth working; it is fed if something was eaten in it
        if (c.action === 'eating') {
          r.chewing = true;
          if (r.ateNow) r.chewFed = true;
        } else {
          endChew(r);
        }
        r.ateNow = false;
      }
      return false;
    });

    for (const r of records) {
      endChew(r);
      r.fellAsleep = times(r.c, 'fellAsleep');
      r.woke = times(r.c, 'woke');
    }
    days[seed] = records;
  }
});

const percent = (part, whole) => (whole > 0 ? Math.round((100 * part) / whole) : 0);
// One note for a seed: what `say` makes of each founder's record
const noteOf = (seed, say) => days[seed].map(say).join('; ');
const sum = (seed, key) => days[seed].reduce((total, r) => total + r[key], 0);

test('each founder falls asleep and wakes again', () => {
  // Today 4 of 4
  inSeeds(SEEDS, 3, seed => ({
    ok: days[seed].every(r => r.fellAsleep >= 1 && r.woke >= 1),
    note: noteOf(seed, r => `${r.name} fell asleep ${r.fellAsleep}, woke ${r.woke}`)
  }));
});

test('each founder eats, drinks and calls', () => {
  // Today 3 of 4: Fenro doesn't drink in seed 1
  inSeeds(SEEDS, 2, seed => ({
    ok: days[seed].every(r => r.eats >= 1 && r.sips >= 1 && r.calls >= 1),
    note: noteOf(seed, r => `${r.name} ate ${r.eats}, sipped ${r.sips}, called ${r.calls}`)
  }));
});

test('each founder sleeps through most of the night', { todo: 'sleep is short: under 60% of the night today' }, () => {
  inSeeds(SEEDS, MOST, seed => ({
    ok: days[seed].every(r => r.nightTicks > 0 && r.asleepAtNight / r.nightTicks >= NIGHT_ASLEEP),
    note: noteOf(seed, r => `${r.name} asleep ${percent(r.asleepAtNight, r.nightTicks)}% of the night`)
  }));
});

test('a grown creature is seldom scared', { todo: 'fear runs high for much of the day' }, () => {
  inSeeds(SEEDS, MOST, seed => ({
    ok: days[seed].every(r => r.ticks > 0 && r.scared / r.ticks < SCARED_SHARE),
    note: noteOf(seed, r => `${r.name} scared ${percent(r.scared, r.ticks)}% of the day`)
  }));
});

test('it drinks when thirsty, not all day', { todo: 'creatures sip all day without being thirsty' }, () => {
  inSeeds(SEEDS, MOST, seed => {
    const sips = sum(seed, 'sips');
    const thirsty = sum(seed, 'thirstySips');
    return { ok: sips > 0 && thirsty * 2 >= sips, note: `${thirsty} of ${sips} sips thirsty` };
  });
});

test('when it starts to chew, it mostly has food', { todo: 'most chewing is at nothing' }, () => {
  inSeeds(SEEDS, MOST, seed => {
    const chews = sum(seed, 'chews');
    const fed = sum(seed, 'fedChews');
    return { ok: chews > 0 && fed * 2 >= chews, note: `${fed} of ${chews} chews had food` };
  });
});

test('it calls mostly when lonely', { todo: 'it calls all day, lonely or not' }, () => {
  inSeeds(SEEDS, MOST, seed => {
    const calls = sum(seed, 'calls');
    const lonely = sum(seed, 'lonelyCalls');
    return { ok: calls > 0 && lonely * 2 >= calls, note: `${lonely} of ${calls} calls lonely` };
  });
});
