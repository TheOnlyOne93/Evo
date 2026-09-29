'use strict';
// The frame clock: the sim runs 60 x speed ticks per wall second whatever the frame rate.

// Run `seconds` of wall time at `hz`, returning the ticks the clock handed out
function run(Evo, hz, speed, seconds) {
  const clock = new Evo.FrameClock(), dt = 1000 / hz;
  let ticks = 0;
  for (let f = 0; f < seconds * hz; f++) {
    const n = clock.advance(dt, speed, false);
    clock.report(n);
    ticks += n;
  }
  return ticks;
}

test('clock: 60 x speed ticks per second at 30, 60, 120 and 144 Hz', (Evo, assert) => {
  for (const hz of [30, 60, 120, 144]) for (const speed of [1, 2, 4, 8]) {
    const ticks = run(Evo, hz, speed, 10) / 10;
    assert.ok(Math.abs(ticks - 60 * speed) <= 1, `${hz} Hz at ${speed}x: ${ticks} ticks per second`);
  }
});

test('clock: paused runs nothing and resuming does not burst', (Evo, assert) => {
  const clock = new Evo.FrameClock();
  clock.advance(16, 8, false);
  for (let f = 0; f < 100; f++) assert.strictEqual(clock.advance(16, 8, true), 0);
  assert.ok(clock.advance(16, 8, false) <= 8, 'first frame after resuming');
});

test('clock: a long hitch runs at most a quarter second of ticks', (Evo, assert) => {
  const clock = new Evo.FrameClock();
  assert.ok(clock.advance(2000, 1, false) <= 15);
  assert.ok(clock.advance(2000, 8, false) <= 120);
});

test('clock: ticks cut off by the frame budget are dropped, not owed', (Evo, assert) => {
  const clock = new Evo.FrameClock();
  const wanted = clock.advance(1000 / 60, 8, false);
  clock.report(2);
  assert.ok(wanted > 2);
  assert.ok(clock.advance(1000 / 60, 8, false) <= 8, 'no backlog on the next frame');
  assert.ok(clock.achievedSpeed() < 8, 'the shortfall shows in the achieved speed');
  const fine = new Evo.FrameClock();
  for (let f = 0; f < 60; f++) fine.report(fine.advance(1000 / 60, 8, false));
  assert.strictEqual(fine.achievedSpeed(), 8);
});

test('clock: a brain gives the same spikes however its ticks are split into frames', (Evo, assert) => {
  const N_TICKS = 300;
  const play = frames => {
    Evo.seed(7);
    const brain = new Evo.Brain(Evo.Genome.founder('X').develop());
    const drive = new Float32Array(brain.N);
    const spikes = [];
    let done = 0;
    for (const n of frames) for (let i = 0; i < n; i++, done++) {
      // The same inputs for the same tick number, whichever frame it falls in
      for (let j = 0; j < brain.N; j++) drive[j] = brain.isSensory[j] ? 10 + 8 * Math.sin(done * 0.3 + j) : 0;
      brain.tick(drive, { noise: 0.35, arousal: 0, canFire: true });
      spikes.push(Array.from(brain.hist), Array.from(brain.v));
    }
    return JSON.stringify(spikes);
  };
  const clock = new Evo.FrameClock(), split = [];
  for (let total = 0, f = 0; total < N_TICKS; f++) {
    const n = Math.min(clock.advance([7, 16, 33, 41][f % 4], 4, false), N_TICKS - total);
    split.push(n); total += n;
  }
  assert.ok(split.length > 10 && new Set(split).size > 2, 'frames of different sizes');
  assert.strictEqual(play(split), play([N_TICKS]));
});
