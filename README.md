# SynapseCore

An artificial-life world inspired by the *Creatures* series, driven by recurrent spiking neural
networks instead of feed-forward lobes. Everything is bottom-up: genes build the body, the
biochemistry and the brain's wiring; drives, learning and behaviour emerge from them.

**Play it in your browser: https://theonlyone93.github.io/Evo/** (updates with every push to `main`)

## Running

Open `index.html` in a browser (double-click works; there is no build step). Runs are deterministic: the world starts from a fixed seed
(`Evo.DEFAULT_SEED`); open `index.html?seed=123` to try another.

* **Hand** (✋): tap a creature to follow it; drag creatures, eggs and items to carry them, and let
  go while moving to throw. Drag empty ground to look around.
* **Tickle** and **Slap**: touch a creature. Tickling is pleasant (stroke to keep going); a slap
  hurts, so it learns to stop doing whatever it was doing.
* **Items**: pick one in the toolbar, then tap the world to drop it. **Egg** places a new founder egg.
* **Add a creature**: a grown female (♀) or male (♂) arrives near the one you follow. On a phone,
  each toolbar group (Food, More, Add) opens from one button.
* **Inside view**: the followed creature's body chemistry, brain, genes and family, and the world.
* Keys: arrows / WASD pan, `+` `−` zoom, `0` reset zoom, `F` follow, `Tab` next creature,
  `Space` pause, `1`–`4` speed, `Esc` back to the hand.

## Tests and tools

```sh
node tests/run.js              # everything
node tests/run.js genome       # tests whose name contains "genome"
node tools/behave.js 12        # behaviour bench (scenarios in tools/scenarios/; --report adds non-gating metrics)
node tools/evaluate.js 2 3     # ecology: several seeds in parallel, meals, sleep, births, deaths
node tools/simulate.js 2 1     # one headless run with a running report
npx eslint@9 .                 # lint (flat config in eslint.config.js; needs no install or package.json)
```

The runner loads every script that `index.html` marks `data-headless` into Node, in page order,
so the simulation is tested exactly as the page loads it. `dev/creature-lab.html` and
`dev/world-lab.html` are preview pages for the creature and world art.

## Layout

| Path | What lives there |
|---|---|
| `src/core/` | The `Evo` namespace, shared helpers (seedable random numbers, events), diffusion |
| `src/sim/` | The simulation: genome, founder genes, biochemistry, brain, creature, world. No DOM, no audio |
| `src/audio/` | Procedural sound, driven by simulation events |
| `src/render/` | Canvas drawing: sky, world, items, creatures (from a pose), brain map |
| `src/ui/` | The hand, the inside view, the main loop |
| `styles/app.css` | Styles and colour tokens (the canvases read the same tokens) |
| `tests/`, `tools/` | Headless tests; behaviour and ecology tools |
| `docs/DESIGN.md` | How it works, and the contracts between the simulation and the renderers |
