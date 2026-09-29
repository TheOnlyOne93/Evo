// Procedural sound. Listens to world events; the simulation never calls it directly.
(function (Evo) {
  'use strict';

  class BioSynthesizer {
    constructor() {
      this.ctx = null;
      this.enabled = false; // Off until the player turns it on
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

    chomp() { this.playNotes([[0, 600, 0.035, 'sine', 0.05], [30, 380, 0.045, 'triangle', 0.06]]); }
    hatchChime() { this.playNotes([[0, 523.25, 0.08, 'sine', 0.05], [60, 659.25, 0.09, 'sine', 0.06], [120, 783.99, 0.12, 'sine', 0.07]]); }
    deathTone() { this.playNotes([[0, 200, 0.14, 'sawtooth', 0.04], [90, 130, 0.20, 'sawtooth', 0.05]]); }
    sip() { this.playNotes([[0, 493.88, 0.05, 'sine', 0.03], [45, 987.77, 0.06, 'sine', 0.03]]); }
    hazardAlarm() { this.playNotes([[0, 170, 0.14, 'sawtooth', 0.07], [60, 110, 0.18, 'sawtooth', 0.08]]); }
    purr() { this.playNotes([[0, 150, 0.12, 'triangle', 0.05], [70, 175, 0.12, 'triangle', 0.04]]); }
    thwack() { this.playNotes([[0, 90, 0.06, 'square', 0.07], [20, 60, 0.1, 'sawtooth', 0.06]]); }
    loveChime() { this.playNotes([[0, 659.25, 0.1, 'sine', 0.04], [90, 880, 0.14, 'sine', 0.05]]); }
    // A creature's call: a rising chirp at its genetic pitch
    voice(pitch, loud) {
      const f = 260 + pitch * 620;
      this.playNotes([[0, f, 0.07, 'triangle', 0.025 * loud], [60, f * 1.26, 0.09, 'triangle', 0.03 * loud]]);
    }
  }

  // Wire a synthesizer to a world. isFocused(creature) says which creature the player is following:
  // its meals, sips and calls are heard clearly; the rest of the world stays quiet.
  function connectAudio(synth, world, isFocused) {
    let lastSip = 0;
    world.events.on('hatch', () => synth.hatchChime());
    world.events.on('death', () => synth.deathTone());
    world.events.on('mate', () => synth.loveChime());
    world.events.on('eat', ({ creature, food }) => {
      if (!isFocused(creature)) return;
      if (food.toxin) synth.hazardAlarm(); else synth.chomp();
    });
    world.events.on('drink', ({ creature }) => {
      const now = performance.now();
      if (!isFocused(creature) || now - lastSip < 400) return;
      lastSip = now;
      synth.sip();
    });
    world.events.on('call', ({ creature }) => synth.voice(creature.traits.voicePitch, isFocused(creature) ? 1 : 0.35));
    world.events.on('pat', () => synth.purr());
    world.events.on('slap', () => synth.thwack());
  }

  Object.assign(Evo, { BioSynthesizer, connectAudio });
})(globalThis.Evo);
