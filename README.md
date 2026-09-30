# SynapseCore

An artificial-life world inspired by the *Creatures* series, driven by recurrent spiking neural
networks instead of feed-forward lobes. Everything is bottom-up: genes build the body, the
biochemistry and the brain's wiring; drives, learning and behaviour emerge from them.

**Play it in your browser: https://theonlyone93.github.io/Evo/** (updates with every push to `main`)

## Running

Open `index.html` in a browser (double-click works; there is no build step). Runs are deterministic:
the world starts from a fixed seed (`Evo.DEFAULT_SEED`); open `index.html?seed=123` to try another.

* **Hand** (✋): tap a creature to put it on the card and follow it; drag creatures, eggs and items
  to carry them, and let go while moving to throw. Drag empty ground to look around (the card
  keeps its creature).
* **Tickle** and **Slap**: touch a creature. Tickling is pleasant (stroke to keep going); a slap
  hurts, so it learns to stop doing whatever it was doing.
* **Items**: pick one in the toolbar, then tap the world to drop it. **Egg** places a new founder egg.
* **Add a creature**: a grown female (♀) or male (♂) arrives near the one on the card. On a narrow
  screen, each toolbar group (Food, More, Add) opens from one button.
* **Inside view**: the body chemistry, brain, genes and family of the creature on the card, and the world.
  The Family tab draws its family tree: tap a living relative to follow it, a dead one to see
  its family.
* Zoom: mouse wheel or two-finger pinch. **Sound** (top right) turns the sound on or off, and
  **Scent** (beside the speed buttons) shows the scents in the air. **Skip to the next season** is
  in the Inside view's World tab.
* Keys: arrows / WASD pan, `+` `-` zoom, `0` reset zoom, `F` follow or stop following,
  `]` next creature, `[` previous creature, `Space` pause, `.` step one tick while paused,
  `1`–`4` speed (and resume), `Esc` back to the hand. `Tab` moves between the buttons as usual.

## Tests and tools

```sh
node tools/check.js            # the tests and fingerprint --check side by side: run before committing
node tests/run.js [filter]     # the tests, or those whose name contains the filter
node tools/behave.js 12        # behaviour bench (--report adds metrics)
node tools/evaluate.js 2 3     # ecology: 2 days on 3 seeds, in parallel
node tools/simulate.js 2 1     # one headless run with a running report
node tools/serve.js            # a no-cache server at http://127.0.0.1:8123/ for browser checks
npx eslint@10 .                # lint (no install or package.json needed)
```

[docs/TESTING.md](docs/TESTING.md) describes them. `dev/creature-lab.html` and `dev/world-lab.html`
preview the creature and world art with the game's own code
([docs/BROWSER_CHECKS.md](docs/BROWSER_CHECKS.md)).

## Layout

| Path | What lives there |
|---|---|
| `src/core/` | The `Evo` namespace, shared helpers (seedable random numbers, events), the frame clock, diffusion |
| `src/sim/` | The simulation: shared tables, genome, founder genes, biochemistry, brain, creature, world. No DOM, no audio |
| `src/audio/` | Procedural sound, driven by simulation events |
| `src/render/` | Canvas drawing: sky, world, items, creatures (from a pose), brain map, family tree |
| `src/ui/` | The main loop, the hand, header, card, strip, toolbar, keys, layout and inside view; plain-language text and family lookups |
| `styles/app.css` | Styles and colour tokens (the canvases read the same tokens) |
| `tests/`, `tools/` | Headless tests; the check, the determinism fingerprint, the behaviour bench, ecology runs, the no-cache server |
| `dev/` | The creature and world lab pages |
| `docs/` | One doc per system. `docs/DESIGN.md` is the overview and lists them |
| `.github/`, `eslint.config.js` | CI (tests and lint) and the lint config |
