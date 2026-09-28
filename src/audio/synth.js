// Procedural sound. Listens to world events; the simulation never calls it directly.
(function (Evo) {
  'use strict';

  class BioSynthesizer {
    constructor() {
      this.ctx = null;
      this.enabled = false; // Off until the player turns it on
      this.lastSpikeTime = 0;
      this.spikeThrottleMs = 75;
    }

    init() {
      if (!this.ctx) {
        try {
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          if (AudioCtx) this.ctx = new AudioCtx();
        } catch (e) {
          this.ctx = null;
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    }

    playTone(freq, duration = 0.04, type = 'sine', gainVal = 0.035) {
      if (!this.enabled) return;
      try {
        this.init();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(gainVal, now + 0.003);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + duration);
      } catch (e) { /* Audio is decoration; never let it break the simulation */ }
    }

    // A sequence of [delayMs, freq, duration, type, gain] notes
    playNotes(notes) {
      for (const [delay, ...tone] of notes) {
        if (delay === 0) this.playTone(...tone);
        else setTimeout(() => this.playTone(...tone), delay);
      }
    }

    chirpSpike() {
      const now = performance.now();
      if (now - this.lastSpikeTime < this.spikeThrottleMs) return;
      this.lastSpikeTime = now;
      this.playTone(840 + Math.random() * 220, 0.02, 'triangle', 0.012);
    }

    chompBite() { this.playNotes([[0, 600, 0.035, 'sine', 0.05], [30, 380, 0.045, 'triangle', 0.06]]); }
    birthChime() { this.playNotes([[0, 523.25, 0.08, 'sine', 0.05], [60, 659.25, 0.09, 'sine', 0.06], [120, 783.99, 0.12, 'sine', 0.07]]); }
    deathTone() { this.playNotes([[0, 200, 0.14, 'sawtooth', 0.05], [90, 130, 0.20, 'sawtooth', 0.06]]); }
    sweetChime() { this.playNotes([[0, 587.33, 0.08, 'sine', 0.05], [40, 783.99, 0.06, 'sine', 0.04]]); }
    drinkChime() { this.playNotes([[0, 493.88, 0.06, 'sine', 0.04], [50, 987.77, 0.08, 'sine', 0.05]]); }
    hazardAlarm() { this.playNotes([[0, 170, 0.14, 'sawtooth', 0.08], [60, 110, 0.18, 'sawtooth', 0.09]]); }
  }

  // Wire a synthesizer to a world. isFocused(org) says which organism the player is following:
  // only its bites and meals make sounds, so a crowd doesn't turn into noise.
  function connectAudio(synth, world, isFocused) {
    world.events.on('birth', () => synth.birthChime());
    world.events.on('death', () => synth.deathTone());
    world.events.on('bite', ({ org }) => { if (isFocused(org)) synth.chompBite(); });
    world.events.on('eat', ({ org, nutrients }) => {
      if (!isFocused(org)) return;
      if (nutrients.toxin) synth.hazardAlarm();
      else if (nutrients.water && !nutrients.carbs && !nutrients.protein) synth.drinkChime();
      else synth.sweetChime();
    });
  }

  Object.assign(Evo, { BioSynthesizer, connectAudio });
})(globalThis.Evo);
