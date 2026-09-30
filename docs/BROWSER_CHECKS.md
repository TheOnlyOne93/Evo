# Checking changes in a browser

`node tools/check.js` proves the simulation, the poses and the text unchanged. Drawing and the
interface can't be fingerprinted: a change to `src/render/`, `src/ui/` (except the headless `pose.js`,
`text.js` and `kin.js`), `styles/` or the pages is checked by loading the page and looking. This is how, for a person or for Claude Code.

## Serve the repo without caching

```sh
node tools/serve.js        # http://127.0.0.1:8123/ (another port: node tools/serve.js 8124)
```

Every response says `Cache-Control: no-store`, so a reload always runs the scripts on disk. A plain
static server lets the browser keep old scripts after an edit, and a check then passes or fails on
code that is no longer there.

Run the server only for the check and stop it when the check is done.

## Which browser

| Where | How |
|---|---|
| Claude Code desktop app | It has a built-in browser. `.claude/launch.json` has a `static` entry that starts this server: start the preview by that name. |
| Claude Code in VS Code | It has no built-in browser. Start the server in the background and drive Chrome through the Claude in Chrome extension, at the `http://127.0.0.1:8123/` address (the extension can't open `file://` pages). |
| By hand | Any browser. `index.html` and the lab pages also open straight from disk. |

## Every check

1. Load the page fresh.
2. Prove the page runs the new code before trusting anything it shows: probe something only the
   new code has (a renamed method, a new field, a changed constant) and say so in the report.
3. Read the console for errors.
4. Look: a screenshot for how it draws, the page's state for what it computed.
5. Stop the server and close the tab.

The game keeps nothing in localStorage or IndexedDB, so a reload is a full reset. A world is the
same every time from its seed (`?seed=11`), but the weather and the sky's shooting stars use
unseeded random numbers, so two whole frames never match pixel for pixel.

## A painter refactor: the same pixels

A change to the static art (`src/render/painters/`, the sprite code in `world-view.js`) that is
meant to draw the same thing can prove it. In `dev/world-lab.html`, `lab.paintHash(levels = [0, 2])` builds
the terrain tiles and every feature's sprite (not the sky's layers), in every season, at 1× and 2×,
and returns one hash of the pixels per kind: `{ tiles, thornbush, tree, rock, grass, log, reeds }`.
`levels` index the sprite resolutions `[1, 1.5, 2, 3]`.

1. Before the change, load the lab and note the hashes (the same browser gives the same hashes
   on every load).
2. Make the change, load the lab fresh, and compare. A hash that moved names the painter.

The default world has one log and one rock. When a painter has cases the world doesn't show (a
log with no platform on it, say), paint those onto a scratch canvas with the painter itself
and hash them the same way, before and after. `rec = lab.view._featRec(f)` gives the shape the
painter needs; painters draw in the feature's own coordinates, so size the canvas `rec.bw × rec.bh`,
`g.setTransform(1, 0, 0, 1, -rec.bx0, -rec.by0)`, then `Evo.Paint.paintLog(g, f, season, rec)` with a
season index 0–3.

## The pages

* `index.html`: the game. `Evo.app` holds the world, the view, the inspector, the frame clock and the
  interface state ([INTERFACE.md](INTERFACE.md)); the hand controller is not on it.
* `dev/world-lab.html`: the game's world drawn by the game's `WorldView`, with controls for the
  time of day, speed (❚❚, 1×, 4×, 20×, 120×), season, overlays, following, fitting the view, and the
  hand (grab, tickle, slap). Keys: arrows or WASD pan, `+` `-` zoom, `f` follows, Space pauses, and
  `1`–`4` pick the **season** (in the game they pick the speed). URL options (`dev/world-lab.js`
  lists them): `?seed=11&speed=4&paused=1&phase=0.5&season=2&creatures=4&ui=0&scent=1`. `window.lab`
  is there for scripted checks: `world`, `view`, `state`, `hand`, `clock`, `focus`, `refresh`,
  `setPhase(p)`, `setSeason(s)`, `step(n)`, `measure(n = 600)` (a promise of
  `{ frames, renderAvg, renderP95, frameAvg }`) and `paintHash()`.
* `dev/creature-lab.html`: real creatures from the founder genome, posed by `Evo.poseOf` and drawn on
  their own backdrops (no world) at every life stage and state. `?seed=N`, `?t=S` freezes time,
  `?bounds` outlines the picking boxes. Reroll looks, Pause and a benchmark
  (`window.creatureBench(frames = 600, n = 20)`); click a creature to focus it.

Both labs load `index.html`'s scripts up to the drawing ones, not the interface (the world lab adds
`src/ui/hand.js`). A new simulation or drawing script goes into all three pages.
