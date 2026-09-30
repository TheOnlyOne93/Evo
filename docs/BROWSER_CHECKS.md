# Checking changes in a browser

`node tools/check.js` proves the simulation, the poses and the text unchanged. Drawing and the
interface can't be fingerprinted: a change to `src/render/`, `src/ui/`, `styles/` or the pages is
checked by loading the page and looking. This is how, for a person or for Claude Code.

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
meant to draw the same thing can prove it. In `dev/world-lab.html`, `lab.paintHash()` builds every
static sprite (the terrain tiles and each kind of feature, in every season, at two resolutions)
and returns a hash of the pixels for each: `{ tiles, thornbush, tree, rock, grass, log, reeds }`.

1. Before the change, load the lab and note the hashes (the same browser gives the same hashes
   on every load).
2. Make the change, load the lab fresh, and compare. A hash that moved names the painter.

The default world has one log and one rock. When a painter has cases the world doesn't show (a
log with no platform on it, say), paint those onto a scratch canvas with the painter itself
(`Evo.Paint.paintLog(g, f, season, rec)`) and hash them the same way, before and after.

## The pages

* `index.html`: the game. `Evo.app` holds the world, the view, the inspector and the frame clock.
* `dev/world-lab.html`: the game's world drawn by the game's `WorldView`, with controls for the
  time of day, season, speed and overlays. URL options (`dev/world-lab.js` lists them):
  `?seed=11&paused=1&phase=0.5&season=2&creatures=4&ui=0&scent=1`. `window.lab` is there for
  scripted checks: `world`, `view`, `setPhase(p)`, `setSeason(s)`, `step(n)`, `measure(n)`,
  `paintHash()`.
* `dev/creature-lab.html`: the creature art at every life stage and state (`?t=S` freezes time,
  `?bounds` outlines the picking boxes).
