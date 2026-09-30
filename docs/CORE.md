# Core

`src/core/`: three headless scripts that everything else builds on. `evo.js` loads first.

## The namespace and helpers (`evo.js`)

Every script adds its exports to `globalThis.Evo`.

| Name | What it is |
|---|---|
| `Evo.random()`, `randRange(lo, hi)`, `randInt(n)`, `chance(p)`, `pick(arr)`, `shuffle(arr)` | Random numbers, all from one seeded stream (mulberry32) |
| `Evo.DEFAULT_SEED` | The seed every run starts from; `?seed=N` in the URL overrides it when the script loads |
| `Evo.seed(n)`, `Evo.useRandomSource(fn)` | Reseed the stream, or script its draws (tests and tools) |
| `Evo.nextId()` | Increasing ids for creatures, items and planted thorn bushes, never reused in a session |
| `Evo.EventBus` | `on(type, fn)` (returns a function that unsubscribes), `off(type, fn)`, `emit(type, payload)`. Handlers run at once, in the order they were added |
| `Evo.util` | `clamp`, `clamp01`, `lerp`, `smoothstep`, `mean`, `maxBy`, `minBy`, `countBy`, `TAU`, `mulberry32`, `hash2` |

**Determinism.** All simulation randomness goes through `Evo.random`, so a seed reproduces a run exactly. Drawing must never draw from it: scenery and creature markings use their own `mulberry32` streams or `hash2`, and passing effects (weather, shooting stars) use `Math.random`.

## The frame clock (`clock.js`)

`Evo.FrameClock` turns wall time into whole ticks. See [TIME.md](TIME.md).

## Diffusion (`diffusion.js`)

`Evo.diffuse(grid, next, cols, rows, rate, keep, eps, solid, box)` is one step of 5-point diffusion followed by decay, done in place (`next` is scratch space). Edges and solid cells reflect, and values under `eps` snap to 0. It sweeps only `box` (the rows and columns that hold every non-zero cell) plus a one-cell margin, and returns the box of what is left, or null when the grid is empty. Its only caller is the world's scent ([WORLD.md](WORLD.md)).
