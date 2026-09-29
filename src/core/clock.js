// The frame clock: turns wall time into whole sim ticks, so the sim runs 60 x speed ticks per
// second on any screen. Pure (the caller passes dt), so tests can drive it with fake frames.
(function (Evo) {
  'use strict';
  const MAX_DT_MS = 250;      // A longer gap (hidden tab, hitch) counts as this much, not a burst
  const WINDOW_MS = 1000;     // Time constant of the achieved-speed average

  class FrameClock {
    constructor() {
      this.acc = 0;           // Ticks owed (fraction of one)
      this.wanted = 0;        // Ticks asked for this frame
      this.dt = 0;
      this.speed = 1;
      this.sumRan = 0;        // Decayed sums of ticks run and ticks asked for
      this.sumWanted = 0;
    }

    // How many ticks to run for a frame that took dtMs. Paused: none, and nothing owed on resume.
    advance(dtMs, speed, paused) {
      if (speed !== this.speed) { this.sumRan = 0; this.sumWanted = 0; }   // A new speed starts a fresh average
      this.speed = speed;
      this.dt = Math.min(Math.max(dtMs, 0), MAX_DT_MS);
      if (paused) { this.acc = 0; this.wanted = 0; return 0; }
      this.acc += this.dt / 1000 * Evo.TICKS_PER_SECOND * speed;
      this.wanted = Math.floor(this.acc);
      this.acc -= this.wanted;
      return this.wanted;
    }

    // How many of those ticks actually ran. Ticks the frame budget cut off are dropped, not owed.
    report(ran) {
      if (this.wanted <= 0) return;
      if (ran < this.wanted) this.acc = 0;
      const k = Math.exp(-this.dt / WINDOW_MS);
      this.sumRan = this.sumRan * k + ran;
      this.sumWanted = this.sumWanted * k + this.wanted;
    }

    // The speed actually achieved (the chosen speed unless ticks were being dropped)
    achievedSpeed() {
      return this.sumWanted > 0 ? this.speed * Math.min(1, this.sumRan / this.sumWanted) : this.speed;
    }
  }

  Evo.FrameClock = FrameClock;
})(globalThis.Evo);
