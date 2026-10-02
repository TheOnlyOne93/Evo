'use strict';
// What the player's hand does to a creature, in four worlds: a tickle feels good, a slap hurts and
// frightens it, a creature dropped from high up lands hard and one thrown lands where it was thrown,
// and a creature slapped each time it calls calls less. The first five tests hold today. The last two
// are to-dos: how a creature should learn from a slap or a tickle, not yet how it does.
//
// Each test compares two copies of the same world: the same seed played the same way is the same
// world every time, so the only difference between the copies is what the test does to one of them.
// A copy is built just before it is played, never earlier: the game's chance is one stream shared by
// every world, so a copy built before another is played would take a different turn.
const { test } = require('node:test');
const { game, play, times, feels, lift, inSeeds } = require('./kit.js');

const SEEDS = [1, 2, 3, 4];
// The floor for a to-do: what the game should do in all seeds but one
const MOST = SEEDS.length - 1;

const SETTLE_TICKS = 600;  // Each test starts this far into the game, with the pair up and about
const FEEL_TICKS = 30;     // How long to watch how a tickle or a slap feels
const RUN_TICKS = 120;     // How long to wait for a slapped creature to run
const HIGH = 250;          // A drop from this many px up is a hard fall
const LOW = 80;            // A drop from this many px up is not
const THROW_HEIGHT = 100;  // How high up it is held before it is thrown
const THROW_SPEED = 6;     // How fast the hand moves as it lets go (px a tick)
const THROWN_PX = 20;      // How far a thrown creature must land from where it was picked up
const TRAIN_TICKS = 5400;  // How long to tickle or slap a creature each time it does something

// A world, and its first founder (the female), as they are SETTLE_TICKS into the game
function start(seed) {
  const world = game(seed, SETTLE_TICKS);
  return { world, c: world.creatures[0] };
}

// Play `ticks` ticks and return the highest each of these feelings reached, as { feeling: highest }
function highestFeelings(world, c, keys, ticks) {
  const top = Object.fromEntries(keys.map(key => [key, 0]));
  play(world, ticks, () => {
    for (const key of keys) top[key] = Math.max(top[key], feels(c, key));
    return false;
  });
  return top;
}

// Play `ticks` ticks and count the ticks in which happened() was true. If answer is given, it is
// called right after each of those ticks (after the step, never inside it).
function playCounting(world, ticks, happened, answer) {
  let count = 0;
  play(world, ticks, () => {
    if (happened()) {
      count++;
      if (answer) answer();
    }
    return false;
  });
  return count;
}

// Says whether the creature called since it was last asked
function callWatcher(world, c) {
  let called = false;
  world.events.on('call', ({ creature }) => {
    if (creature === c) called = true;
  });
  return () => {
    const was = called;
    called = false;
    return was;
  };
}

// Says whether a jump of the creature started since it was last asked: its jump timer is set high
// when it jumps and counts down after, so a timer higher than before is a jump that just began
function jumpWatcher(c) {
  let before = c.jumpCooldown;
  return () => {
    const started = c.jumpCooldown > before;
    before = c.jumpCooldown;
    return started;
  };
}

test('a tickle makes it feel good', () => {
  // Today 4 of 4
  inSeeds(SEEDS, 3, seed => {
    const highestReward = tickle => {
      const { world, c } = start(seed);
      if (tickle) world.pat(c);
      return highestFeelings(world, c, ['reward'], FEEL_TICKS).reward;
    };
    const tickled = highestReward(true), left = highestReward(false);
    return { ok: tickled > left, note: `highest reward ${tickled.toFixed(2)} tickled, ${left.toFixed(2)} left alone` };
  });
});

test('a slap hurts and frightens it', () => {
  // Today 4 of 4
  inSeeds(SEEDS, 3, seed => {
    const highest = slap => {
      const { world, c } = start(seed);
      if (slap) world.slap(c);
      return highestFeelings(world, c, ['punishment', 'pain'], FEEL_TICKS);
    };
    const slapped = highest(true), left = highest(false);
    return {
      ok: slapped.punishment > left.punishment && slapped.pain > left.pain,
      note: `punishment ${slapped.punishment.toFixed(2)} slapped, ${left.punishment.toFixed(2)} left alone; pain ${slapped.pain.toFixed(2)}, ${left.pain.toFixed(2)}`
    };
  });
});

test('slapped, it runs off', () => {
  // Today 3 of 4: seed 4 did not run
  inSeeds(SEEDS, 2, seed => {
    const { world, c } = start(seed);
    world.slap(c);
    const ran = play(world, RUN_TICKS, () => c.action === 'running');
    return { ok: ran !== null, note: ran === null ? `did not run in ${RUN_TICKS} ticks` : `started running at tick ${ran}` };
  });
});

test('dropped from high up it lands hard, from low down it doesn\'t', () => {
  // Today 4 of 4
  inSeeds(SEEDS, 3, seed => {
    const dropFrom = height => {
      const { world, c } = start(seed);
      const before = times(c, 'fell');
      const landed = lift(world, c, height) !== null;
      return { landed, hardFalls: times(c, 'fell') - before };
    };
    const high = dropFrom(HIGH), low = dropFrom(LOW);
    const say = (height, d) => `${height} px up: ${d.landed ? 'landed' : 'never landed'}, fell hard ${d.hardFalls}`;
    return {
      ok: high.landed && low.landed && high.hardFalls >= 1 && low.hardFalls === 0,
      note: `${say(HIGH, high)}; ${say(LOW, low)}`
    };
  });
});

test('thrown, it lands the way it was thrown', () => {
  // Today 4 of 4
  inSeeds(SEEDS, 3, seed => {
    const throwAt = speed => {
      const { world, c } = start(seed);
      const from = c.x;
      const landed = lift(world, c, THROW_HEIGHT, speed, 0) !== null;
      return { landed, moved: c.x - from };
    };
    const right = throwAt(THROW_SPEED), left = throwAt(-THROW_SPEED);
    const say = d => `moved ${Math.round(d.moved)} px${d.landed ? '' : ' (never landed)'}`;
    return {
      ok: right.landed && left.landed && right.moved >= THROWN_PX && left.moved <= -THROWN_PX,
      note: `thrown right it ${say(right)}, thrown left it ${say(left)}`
    };
  });
});

test('slapped each time it calls, it calls less', { todo: 'a slap after a call makes it call more, not less' }, () => {
  inSeeds(SEEDS, MOST, seed => {
    const calls = slapIt => {
      const { world, c } = start(seed);
      return playCounting(world, TRAIN_TICKS, callWatcher(world, c), slapIt ? () => world.slap(c) : undefined);
    };
    const left = calls(false), slapped = calls(true);
    return { ok: slapped < left, note: `calls ${left} -> ${slapped}` };
  });
});

test('tickled each time it jumps, it jumps more', { todo: 'it never jumps on its own today, and a tickle teaches it nothing yet' }, () => {
  inSeeds(SEEDS, MOST, seed => {
    const jumps = tickleIt => {
      const { world, c } = start(seed);
      return playCounting(world, TRAIN_TICKS, jumpWatcher(c), tickleIt ? () => world.pat(c) : undefined);
    };
    const left = jumps(false), tickled = jumps(true);
    return { ok: tickled > left, note: `jumps ${left} -> ${tickled}` };
  });
});
