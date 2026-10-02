# Testing and tools

Everything here runs headless in Node (with no page open): `tests/load.js` loads the scripts `index.html` marks `data-headless`, in page order, so the tests and tools see the simulation exactly as the page loads it. Drawing and the interface are checked in a browser instead ([BROWSER_CHECKS.md](BROWSER_CHECKS.md)).

## Before committing

`node tools/check.js` runs the tests and `fingerprint --check` side by side, prints one summary line for each (the test counts, and the fingerprint's last line) or, for a job that fails, all of its output, and exits 1 if either fails. After gene or body changes, also run `node tools/behave.js` and `node tools/evaluate.js`, and compare with a run from before the change: neither keeps a saved answer to check against, and neither fails.

## Tests

The tests use Node's own test runner, so there is nothing to install. It runs each `tests/*.test.js` in its own copy of Node (a process), side by side.

```sh
node --test "tests/*.test.js"                                  # all of them
node --test tests/life.test.js                                 # one file
node --test --test-name-pattern="thorn" tests/world.test.js    # the tests whose name matches
```

**How they play.** The tests play the real game the way a player plays it. The world is built the way the page builds it: `game(seed, ticks)` gives the valley, the starting pair and their food. It is played only with the player's tools: the hand (`world.grab`, `moveHand` and `releaseHand`, which lets go or throws), `world.pat` (tickle), `world.slap`, `world.dropItem` (an item, or a thorn bush planted), `world.addEgg`, `world.addAdult`, `world.setTime` to skip to a season (as the season button does) and waiting (`play`). It is judged by what the player can see: what a creature is doing (`c.action`), its needs and feelings (`feels`), what has happened to it (`times(c, key)`), its health and life stage, and the world's events (`world.events.on`). A need is never written in: `hungry` and `thirsty` change the body (they empty its stomach and stores, or take its water away) and then wait until the creature feels the need.

**Seeds and floors.** A seed fixes every chance in a world, so a seed plays the same way every time. The tests use the game's own seed (`Evo.DEFAULT_SEED`, the world a player sees first) and seeds 1 to 4 (`world.test.js` uses 1 to 3). A living creature doesn't do the same thing in every world, so a behaviour test passes when it holds in at least a floor of its seeds (`inSeeds`). Each floor is one below what the game did when the test was written, and a comment above it says what that was (`Today 3 of 4: seed 3 did not eat it`); a floor never goes below 1. A to-do's floor is what the game should do instead: all the seeds but one. When a test fails, its message says how many seeds held and what each one did.

**One stream of chance.** All worlds draw on one stream of random numbers (`Evo.random`), which `game` restarts from the seed. So build a world, play it to its end, then build the next: a world built early and played later takes a different turn, because another world used the stream in between. To compare two copies of a world, build and play one, then build and play the other (`hand.test.js` does this). Each test file is its own copy of Node, so each has its own stream.

**To-dos.** `test(name, { todo: 'why' }, fn)` states what the game should do but doesn't yet. It fails today, and its reason says what is wrong. Node counts it under `todo` (not `pass` or `fail`), marks it with a warning sign when it fails, and it doesn't fail the run. When the game starts to do it right, Node shows it with a check mark instead of the warning sign (and still counts it under `todo`): take `todo` off then, so a later slip fails the run. To find them all, search `tests/` for `todo:`.

**Direct tests.** Only the hidden foundations get tests of their own: the genes, the frame clock and the map. A player can't see them, and a slip in them (a broken inheritance, a clock that rushes, a tree standing in a pond) would take long to show in play. Everything else is tested by playing.

**Crowds.** Worlds start with the pair, and long runs grow past two creatures as the pair breeds; `world.test.js` also adds adults (two in one test, one in another). The fingerprint's crowd run stays the one check of crowding.

**The kit** (`tests/kit.js`) is what the test files share. It also counts what happens to each creature (by wrapping `Creature.prototype.stimulate`) and applies a breakage when `EVO_BREAK` is set (see Breakages).

| Export | What it does |
|---|---|
| `Evo` | The game's code, loaded once through `tests/load.js` |
| `game(seed = Evo.DEFAULT_SEED, ticks = 0)` | Restarts the stream of chance from `seed`, builds a world as the page does, plays `ticks` ticks of it and returns it |
| `play(world, ticks, until)` | Plays up to `ticks` ticks. With `until(t)` it stops as soon as that is true and returns `t`, the number of the tick (counting from 0 in this call); it returns null if that never happens, or if there is no `until` |
| `times(c, key)` | How many times a stimulus has happened to a creature: a key of `Evo.STIMULI` (`ate`, `drank`, `patted`, `slapped`, `pricked`, `fell`, `fellAsleep`, `woke` and the like, which the card lists as Ate, Drank, Tickled, Slapped and so on) |
| `feels(c, key)` | How strongly it feels a need or a feeling, 0 to 1 |
| `FELT` | The level at which a need counts as clearly felt (the tests' own) |
| `hungry(world, c)` | Empties its stomach, blood sugar and stores, then plays until it feels hunger (up to a day, or the test fails); returns the ticks that took |
| `thirsty(world, c)` | Takes water from its body, then waits the same way for thirst |
| `lift(world, c, height, vx = 0, vy = 0)` | The hand picks it up, holds it `height` px above the ground under it and lets go moving at (`vx`, `vy`); returns once it is back on the ground (null if it never lands) |
| `dropAt(world, type, x)` | Drops an item a little above the ground at `x`, as the item tools do |
| `isNight(world)` | The sun is down |
| `inSeeds(seeds, floor, fn)` | Calls `fn(seed)` for each seed, which returns `{ ok, note }`; passes when `ok` held in at least `floor` seeds, and a failure shows every seed's note |

**The files.** `day` and `life` play their worlds once, in a `before` (a step Node runs ahead of a file's tests), and record what they see; each test then reads the record. The other behaviour files build a fresh world for each test.

| File | Plays | Covers |
|---|---|---|
| `clock` | no world | `Evo.FrameClock`: 60 x speed ticks a second at any frame rate; paused, it runs none, and resuming doesn't rush to catch up; a long stall runs at most a moment of ticks; ticks a slow frame couldn't run are dropped, not owed |
| `day` | seeds 1 to 4, from the start to the next noon | How the founding pair sleep, eat, drink and call over a day and a night, and whether each does it for a reason the player can read (tired, hungry, thirsty, lonely). Some of these are to-dos |
| `food` | seeds 1 to 4, a short way in | A hungry creature with fruit dropped in front of it or behind it; a mimic berry (looks and smells like fruit, but makes the eater sick); a thirsty creature set down in the water or with water in sight; mimic berries given again and again. Some of these are to-dos |
| `genes` | no world | Every founder gene reads back from its DNA as the founder table wrote it; mutation keeps the DNA within its length limits and a brain still grows from it; a child carries DNA from both parents, as a son or a daughter by chance; a gene set to a later life stage switches on when the creature reaches it |
| `hand` | seeds 1 to 4, a short way in | What the player's hand does: a tickle feels good; a slap hurts and frightens it, and it runs off; dropped from high up it lands hard and from low down it doesn't; thrown, it lands the way it was thrown; what a slap or a tickle teaches it about calling and jumping (to-dos). Each compares two copies of one world |
| `life` | the game's own seed, for days | The pair mates, she lays an egg and it hatches, in that order; the young grow up one stage at a time and grow bigger; each founder lives to old age and dies of it; when one sex has no grown adult left, a wanderer of that sex walks in (in a new game of its own, where the only grown male's body is made old); every death leaves a body; the valley never empties or starts again; every death and action has words the player reads; every creature stays inside the world; needs, health, position and pose are always real numbers |
| `map` | the default map, no world | The valley's layout: every feature stands on dry, level ground a creature can reach; each founder starts on dry, level ground apart from the other; ponds are deep enough to drink from, held in by the ground, with banks a creature can climb; water is in sight of every feature and of each end of the world, where wanderers arrive; the mimic trees stand well away from the fruit trees |
| `world` | seeds 1 to 3, a short way in | What the player can put into the world and what comes of it: a thorn bush planted in a creature's way (it pricks and hurts, and whether that teaches it to keep out is a to-do); a ball dropped in front of it; an egg set down nearby, in spring and in winter (it hatches into a baby, and takes longer in the cold); two more adults (they mate, eggs come, nobody dies); winter skipped to (the pair feel the cold and nobody dies; thick fur keeps an adult warmer) |

## Breakages

A passing suite doesn't show that it would notice a fault. `tools/breakage.js` checks that: each breakage in it breaks one part of the game on purpose (a chemical's half-life, the left and right of the eyes, the way eggs hatch). The tool runs the whole suite once per breakage and shows which breakages no test noticed (gaps in the tests) and which tests no breakage tripped (tests that may catch nothing).

```sh
node tools/breakage.js [filter] [--jobs N]
```

A breakage's name reads `area: what is broken`, such as `muscles: eat does nothing`. `filter` runs only the breakages whose name contains it, so `muscles` runs that area. `--jobs` is how many runs go side by side; the default is a sixth of the computer's threads (at least 1), as each run already runs the test files side by side.

**What a sweep does.** It runs `(none)` first, with nothing broken: every test must pass, or the sweep stops (exit 1), because what the breakages trip would mean nothing. Then, for each breakage, it runs the tests and plays the game's first day side by side, and prints a line when that is done: `name: 3 tests failed`, or `name: NOT NOTICED` if every test passed, with notes in brackets. `crashes:` means a test file broke while loading, and gives the error. A sweep exits 1 only when `(none)` fails or the tool can't run, whatever else it finds.

**"Changes nothing in a day".** Besides the tests, each run plays the game's first day (the game's own seed, `Evo.DAY_TICKS` ticks) with the breakage, and boils how that day ended (the stats, the clock, how many items there are, each creature's place, health and chemistry) down to a short code; `node tools/breakage.js --day` prints it. If the code matches the day with nothing broken, the line says `changes nothing in a day`: the breakage did nothing the tool can see in that day. A test that plays only that day could not notice it, so a miss is not yet a gap in the tests: the part may matter only later (winter, old age, long learning), or the breakage may do nothing and need mending. If the day did change and still no test noticed, the tests have a gap. (`its day crashes:` means the day itself broke.)

**The three lists at the end:**

- *Breakages no test noticed*, each with its day note (`changes the game` or `changes nothing in a day`). Add or widen a test, then run that breakage again.
- *Breakages that crash the tests*, with the error. These are left out of the other two lists. It is usually the breakage that is out of date: what it breaks was renamed or removed.
- *Tests no breakage tripped* (to-dos left out). Such a test may catch nothing: either add a breakage that breaks what it guards, or, if nothing can make it fail, rewrite or delete it. With a filter, this list only says the filtered breakages didn't trip it.

**Running the suite with one breakage.** `tests/kit.js` applies the breakage named in `EVO_BREAK` as the tests load, so every file runs with it: `EVO_BREAK="muscles: eat does nothing" node --test "tests/*.test.js"` (in PowerShell, set `$env:EVO_BREAK` first). A name that isn't in `breakages` throws.

**Failing loudly.** Every change a breakage makes goes through `wrap` and `replace` (which throw if what they swap is no longer a function), `setAll` (which throws if a key it sets is no longer there) or `keyIndex` (a table entry that is gone). So a breakage whose target was renamed or removed fails with its own error, and shows under *Breakages that crash the tests*, instead of quietly changing nothing.

**When to run a full sweep.** It runs the whole suite once per breakage, so it takes minutes, and it prints the time at the end. It is not part of `check.js`. Run one after adding or changing tests, and after a change that could leave a part of the game untested (a new system, a rename, deleted tests). While working on one area, use the filter.

**Adding a breakage.** Add a line to `breakages` in `tools/breakage.js`: `'area: what is broken': E => ...`, where `E` is `Evo`. Break one thing, with `wrap`, `replace` and `setAll`; the helpers beside them cover the common shapes (`onConfigure`, `onTraits`, `afterSense`, `beforeAct`, `silence`). Run it by name: some test must fail. If none does, that is the gap. A breakage of the map changes the default map's spec in place (`defaultMap`), which works because the kit applies it before any world or landscape is built.

## The fingerprint

`node tools/fingerprint.js [--save | --check]` runs three worlds in child processes (separate copies of Node): `sim:seed1` (2 days; the first creature is killed a quarter of a day in), `sim:seed2` (2.5 days, so its first egg hatches) and `sim:crowd` (half a day, 8 adults near the first grass). Every 250 ticks it hashes (boils down to a short code that changes if any number in it changes) the clock, stats, food and items, and each creature's body, chemistry and whole brain, with ids made relative. It also hashes `Evo.poseOf` for every creature at each sample (`pose`), and `Evo.text` for the final creatures and the first female (`text`).

`--check` exits 1 naming each section that differs. A change meant to alter the simulation, the poses or the text runs `--save` and commits the new `tools/fingerprint.json` with it; a change that only tidies code (a refactor) must leave it unchanged.

## Tools

| Command | What it does |
|---|---|
| `node tools/behave.js [trials=12] [filter] [--jobs N]` | Behaviour reports: one creature in a controlled situation (the lab, below), seeds 1 to `trials`, split across worker processes (default: one per CPU thread, at most one per seed). Prints each report's mean over the seeds. It never passes or fails: run it before and after a change and compare |
| `node tools/breakage.js [filter] [--jobs N]` | Breaks one part of the game on purpose, once for each breakage, and runs the tests: do they notice? See Breakages |
| `node tools/evaluate.js [days=2] [seeds=3] [firstSeed=1]` | Ecology: one process per seed; meals, drinking, sleep, company, births, deaths, and where the creatures spend their time. `10 4` is the long run for body and chemistry changes (2 days reaches no death and no winter) |
| `node tools/wiring.js [FEMALE\|MALE]` | How a founder's brain is wired: what each wiring gene grows on its own and where it lands, then each region's connections in, out and inside, marking regions that receive but send little on |
| `node tools/simulate.js [days=2] [seed=1] [reportsPerDay=4]` | One run with a running report |
| `node tools/serve.js [port=8123]` | A no-cache static server on 127.0.0.1 for browser checks. Stop it when done |

**The lab.** `lab(seed)` is a quiet world with one creature on open ground: the first founder, with nothing else going on. No food grows and no wanderer comes; the other founder and the items are taken away, and so are the landscape's features and platforms (no tree, rock, log, reeds or thorn bush, so no shade, warmth, sight, scent or footing from them; a report adds the few things it needs), so only ponds could be in sight. The creature stands at the dry spot midway across the widest gap between two ponds, out of sight of both (the lab throws if a map change puts a pond in sight), with its drives at 0, its body fed, watered and rested, and the clock set to late morning. Every seed's creature has the same brain (the same genes always grow the same one: [BRAIN.md](BRAIN.md)), so the seeds differ only in what happens to it: its firing noise and the world's dice.

**Reports.** `behave.js` reads every `tools/scenarios/*.js` in name order. Each exports `({ Evo, lab, session, run, trial }) => reports`, a map from a report's name to `seed => number`. `run(setup, ticks, done, before)` plays a lab until `done` is true, the creature dies or `ticks` pass (the drives in `setup.hold` are set before every tick); `trial` gives the tick it happened at (null if it never did, or the creature died); `session(seed)` is a lab whose creature is kept across trials, so what it learns carries over. Today there is one file, `learning.js`; its reports go by the start of their name:

| Reports | What they measure |
|---|---|
| `modulators:` | How often the reward and punishment cells fire when nothing has happened to the creature (they should stay quiet) |
| `bench:` | Learning, with matched controls: whether finding food gets quicker; how many mimic berries it eats early and late (mimic aversion); how its calls change when each call is followed by a slap or a tickle, against another creature that gets the same touches at the same times whatever it does (the yoked control) |
| `memory:` | Working memory: a hungry creature sees fruit on one side, then it is gone; the share of the next ticks it walks toward where the fruit was, for the founder, for a copy whose thinking region has its persistence gene set to 0 (no working memory), and against a control that saw no fruit |
| `decision:` | How it picks what to do: the share of active ticks with more than one muscle firing, and how long it sticks with one action at a time |

The `memory:` reports need about 12 seeds to settle.

## CI and lint

`.github/workflows/test.yml` runs on pushes to `main`, on pull requests and by hand (Node 26, a read-only token, a 10-minute limit, a newer push cancelling an older run): `node --test "tests/*.test.js"` and `npx --yes eslint@10 .`. It doesn't run the fingerprint; `node tools/check.js` does, before a commit.

`eslint.config.js` is a flat config for plain ES2022 scripts. The scripts `index.html` marks `data-headless` (it reads the list with `tests/load.js`'s `headlessScripts()`) get only the globals browsers and Node share and a writable `Evo`: a headless script touching the page fails `no-undef`, and `Math.random`, `Date.now` and `new Date` are errors there, so a seed always gives the same world. The other `src/` and `dev/` scripts get browser globals and a writable `Evo`; `tests/`, `tools/` and `eslint.config.js` get Node's globals (test files import `test` from `node:test`, so there is no `test` global). ESLint's recommended correctness rules (undefined names, redeclarations, duplicates, unreachable code, bad assignments, fallthrough, `NaN` comparisons and the like) are errors, listed one by one because the config can't import `@eslint/js` without an install; unused variables only warn, and an unused `eslint-disable` comment is an error.

`.gitattributes` keeps every text file LF whatever `core.autocrlf` says, and `.editorconfig` gives editors the same defaults (UTF-8, LF, two-space indents, a final newline). `.claude/` (Claude Code's settings and the desktop app's preview config) is ignored.
