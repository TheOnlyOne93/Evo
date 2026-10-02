'use strict';
// The frame clock: the game runs 60 x speed ticks per second of real time, whatever the screen's frame
// rate, and a pause or a stall never makes it rush to catch up.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Evo } = require('./kit.js');

// Run `seconds` of real time at `hz` frames a second; returns the ticks the clock handed out
function run(hz, speed, seconds) {
  const clock = new Evo.FrameClock(), ms = 1000 / hz;
  let ticks = 0;
  for (let f = 0; f < seconds * hz; f++) {
    const n = clock.advance(ms, speed, false);
    clock.report(n);
    ticks += n;
  }
  return ticks;
}

test('60 x speed ticks a second at any frame rate', () => {
  for (const hz of [30, 60, 144]) for (const speed of [1, 2, 4, 8]) {
    const perSecond = run(hz, speed, 10) / 10;
    assert.ok(Math.abs(perSecond - Evo.TICKS_PER_SECOND * speed) <= 1, `${hz} Hz at ${speed}x: ${perSecond} ticks a second`);
  }
});

test('paused, no ticks run, and resuming does not rush to catch up', () => {
  const clock = new Evo.FrameClock();
  for (let f = 0; f < 100; f++) assert.equal(clock.advance(16, 8, true), 0);
  assert.ok(clock.advance(16, 8, false) <= 8, 'the first frame after resuming');
});

test('a long stall runs at most a moment of ticks, not everything it missed', () => {
  const clock = new Evo.FrameClock();
  assert.ok(clock.advance(2000, 1, false) < Evo.TICKS_PER_SECOND);
});

test('ticks a slow frame could not run are dropped, not owed to the next frame', () => {
  const cut = new Evo.FrameClock();
  const wanted = cut.advance(25, 1, false);
  cut.report(0);
  assert.ok(cut.advance(25, 1, false) <= wanted, 'no backlog');
  assert.ok(cut.achievedSpeed() < 1, 'the shortfall shows in the speed achieved');
});
