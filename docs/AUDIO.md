# Audio

`src/audio/synth.js`: procedural sound, made of short oscillator tones (no audio files). The simulation never calls it; it listens to `world.events`. It needs a browser, so it is not a headless script.

`Evo.BioSynthesizer` makes every sound with `playTone(freq, duration, type, gain)` and `playNotes([[delayMs, freq, duration, type, gain], …])`. Sound starts off (`enabled` is false) until the player presses the sound button in the header. The `AudioContext` is created on the first press anywhere on the page. An audio error is swallowed, so sound can never break the simulation.

`Evo.connectAudio(synth, world, isFocused)` wires the events. The game passes `c => c === app.focus` as `isFocused`.

| Event | Sound | Heard for |
|---|---|---|
| `hatch`, `death`, `mate`, `pat`, `slap` | chime, low tone, love chime, purr, thwack | every creature |
| `eat` | a chomp, or an alarm when the food held toxin | the focused creature |
| `drink` | a sip, at most one every 400 ms | the focused creature |
| `call` | a rising chirp at the creature's voice pitch | every creature: the focused one at full volume, others at 0.35 |
