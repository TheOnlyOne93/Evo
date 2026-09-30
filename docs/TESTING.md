# Testing and tools

Everything here runs headless in Node: `tests/load.js` loads the scripts `index.html` marks `data-headless`, in page order, so the tests and tools see the simulation exactly as the page loads it. Drawing and the interface are checked in a browser instead ([BROWSER_CHECKS.md](BROWSER_CHECKS.md)).

## Before committing

`node tools/check.js` runs the tests and `fingerprint --check` side by side, prints the last line of each (all of it on a failure) and exits 1 if either fails. After gene or physiology changes, also run `node tools/behave.js` and `node tools/evaluate.js`, and compare with a run from before the change: neither has a baseline or fails.

## Tests

`node tests/run.js [filter]` requires every `tests/*.test.js` in name order. Each registers `test(name, (Evo, assert) => …)`, which may be async. The filter is a substring of the name, so `genome` also matches a world test about genomes; `"genome:"` picks one file's area. Every test starts from `Evo.seed(12345)`. It exits 1 on a failure or when nothing matches.

| File | Covers |
|---|---|
| `biochem` | Reactions, catalysts, emitters, half-lives, receptors and damage blame, the founder's hunger, thirst and reward, staged initial concentrations |
| `brain` | Wiring, weight bounds, region copies and the neuron budget, reflexes, delays, muscle competition, attention, working memory |
| `clock` | The frame clock: rate, pause, the hitch cap, the budget |
| `drives` | Drives cells, stimulus genes, world stimuli, thorn pain, the reward of eating, Up close cells, instincts, novelty, the reward of sleep |
| `genome` | Encoding round trips, founder genes, stages, duplication and loss, mutation, inheritance, guidance |
| `kin` | `Evo.kinOf` and `Evo.kinIndex` |
| `learning` | The modulators, prediction error, credit assignment, stability, replay, dreams, the timing of pats |
| `render` | The `poseOf` contract, item radii |
| `text` | `Evo.text`: names, gene descriptions, the mutation list |
| `world` | Ponds, clock and seasons, temperature, scent, mating and eggs, the population cap, death and re-founding, the hand, regrowth, life-history genes, order independence, wanderers |

`tests/helpers.js` is shared with the behaviour bench: `founderBrain`, `TICK_OPTS`, `cortexKnockout`, `quietWorld(Evo, seed, phase)`, `callThenPat`, `timeCosts`.

## The fingerprint

`node tools/fingerprint.js [--save | --check]` runs three worlds in child processes: `sim:seed1` (2 days; the first creature is killed a quarter of the way in), `sim:seed2` (2 days) and `sim:crowd` (half a day, 8 adults near the first grass). Every 250 ticks it hashes the clock, stats, food and items, and each creature's body, chemistry and whole brain, with ids made relative. It also hashes `Evo.poseOf` for every creature at each sample (`pose`), and `Evo.text` for the final creatures and a founder (`text`).

`--check` exits 1 naming each section that differs. A change meant to alter the simulation, the poses or the text runs `--save` and commits the new `tools/fingerprint.json` with it; a refactor must leave it unchanged.

## Tools

| Command | What it does |
|---|---|
| `node tools/behave.js [trials=12] [filter] [--report] [--jobs N]` | The behaviour bench: one creature in a controlled situation, seeds 1 to N, split across worker processes (default: one per CPU thread, at most one per seed). Prints each scenario's pass rate and median ticks; with `--report`, each report's mean. Always exits 0 |
| `node tools/evaluate.js [days=2] [seeds=3] [firstSeed=1]` | Ecology: one process per seed; meals, drinking, sleep, company, births, deaths, and where the creatures spend their time |
| `node tools/simulate.js [days=2] [seed=1] [reportsPerDay=4]` | One run with a running report |
| `node tools/serve.js [port=8123]` | A no-cache static server on 127.0.0.1 for browser checks. Stop it when done |

**Scenarios.** Each `tools/scenarios/*.js` exports `({ Evo, lab, session, run, trial, avoids }) => ({ scenarios, reports })`. A scenario maps a seed to the tick it passed (null for a fail). A report maps a seed to a number; reports run only with `--report`, and those named `cost:` run on their own after the rest.

| File | Scenarios | Reports |
|---|---|---|
| `basics.js` | 11: eating, reaching fruit either side, drinking, sleeping at night and not by day, running in pain, calling when lonely, keeping away from thorns | |
| `drives.js` | 5: nausea, nuzzling, drinking at the world's edge, pats as reward, slaps as punishment | 2 |
| `learning.js` | 5: fruit before dew, water past fruit, mimic aversion (known to fail), calling and jumping sooner after pats | 17: `modulators:`, `bench:`, `memory:`, `decision:`, `cost:` |

The `memory:` and `cost:` reports need about 12 seeds to settle.

## CI and lint

`.github/workflows/test.yml` runs on pushes to `main` and on pull requests (Node 24): `node tests/run.js` and `npx --yes eslint@10 .`. It does not run the fingerprint.

`eslint.config.js` is a flat config for plain ES2022 scripts: `src/` and `dev/` get browser globals and a writable `Evo`, `tests/` and `tools/` Node globals and `test`. Undefined names, redeclarations, duplicate keys, unreachable code and bad assignments are errors; unused variables only warn.
