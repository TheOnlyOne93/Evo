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
  assert.ok(clock.achievedSpeed() < 8, 'the shortfall shows in the achieved speed');
  // 1.5 ticks a frame: a frame that ran all its ticks carries the half tick on; a cut-off frame does not
  const carry = new Evo.FrameClock();
  carry.report(carry.advance(25, 1, false));
  assert.strictEqual(carry.advance(25, 1, false), 2);
  const cut = new Evo.FrameClock();
  cut.advance(25, 1, false); cut.report(0);
  assert.strictEqual(cut.advance(25, 1, false), 1, 'no backlog on the next frame');
  const fine = new Evo.FrameClock();
  for (let f = 0; f < 60; f++) fine.report(fine.advance(1000 / 60, 8, false));
  assert.strictEqual(fine.achievedSpeed(), 8);
});
