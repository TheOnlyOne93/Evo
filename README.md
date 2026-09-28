# SynapseCore

An artificial-life terrarium inspired by the *Creatures* series, driven by recurrent spiking
neural networks instead of feed-forward lobes. Everything is bottom-up: genes build the body,
the brain's wiring and its chemistry; behaviour and learning emerge from them.

## Running

Open `index.html` in a browser (double-click works; there is no build step).

## Tests

```sh
node tests/run.js           # everything
node tests/run.js genome    # tests whose name contains "genome"
```

The runner loads every script that `index.html` marks `data-headless` into Node, in page order,
so the simulation is tested exactly as the page loads it.

## Layout

| Path | What lives there |
|---|---|
| `src/core/` | The `Evo` namespace, shared helpers (seedable random numbers, events), diffusion |
| `src/sim/` | The simulation: genome, body, brain, organisms, world. No DOM, no audio |
| `src/audio/` | Procedural sound, driven by simulation events |
| `src/render/` | Canvas drawing: terrarium, brain map, pulse monitor |
| `src/ui/` | Panels, controls and the main loop |
| `styles/app.css` | Styles and colour tokens (the canvases read the same tokens) |
| `tests/` | Headless tests |
