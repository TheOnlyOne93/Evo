# Opening the game in a browser

Drawing and the interface can't be fingerprinted, so a change to them is checked in a browser.

## Serve the repo without caching

```sh
node tools/serve.js        # http://127.0.0.1:8123/ (another port: node tools/serve.js 8124)
```

Every response says `Cache-Control: no-store`, so a reload always runs the scripts on disk (a plain
static server lets the browser keep old scripts after an edit). Run the server only while checking
and stop it when done.

## Which browser

| Where | How |
|---|---|
| Claude Code desktop app | It has a built-in browser. Start the preview named `static` from `.claude/launch.json` (below), which runs this server. |
| Claude Code in VS Code | It has no built-in browser. Start the server in the background and drive Chrome through the Claude in Chrome extension, at the `http://127.0.0.1:8123/` address (the extension can't open `file://` pages). |
| By hand | Any browser. `index.html` and the lab pages in `dev/` also open straight from disk. |

`.claude/` is not committed, so on a new machine the desktop app's `.claude/launch.json` needs this entry:

```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "static", "runtimeExecutable": "node", "runtimeArgs": ["tools/serve.js"], "port": 8123 }
  ]
}
```

## Looking at a moment tick by tick in the world lab

`dev/world-lab.html` gives scripts `window.lab` (`world`, `view`, `state`, `step(n)`, `focus(c)`, …).
To look at a pose tick by tick (a jump, a turn, a bite), and compare shots from before and after a
change:

- Pause (`lab.state.paused = true`) and stop the lab's own frames, which run on the real clock.
  Keep the view's real render first: `const render = Object.getPrototypeOf(lab.view).render.bind(lab.view)`,
  then `lab.view.render = () => {}`. Take it from the prototype: if a script that binds
  `lab.view.render` runs twice, the second time it binds the empty one and nothing is drawn.
- Step and draw one tick at a time on a clock of your own: `lab.step(1); render(T += 1 / 60)`.
  Poses ease by the world ticks since the last pose, so draw every tick you step, or the easing
  jumps in one go.
- `lab.step` tracks the cues (hearts, bursts, bubbles) at the real time. To see them on your own
  clock, start it at `performance.now() / 1000` and call `lab.view.cues.track(lab.world, T)` right
  after causing what they show, before stepping.
- Let the camera settle on the creature, then stop following (`lab.view.follow(null);
  lab.state.following = false`) so it holds still. To set several ticks side by side, copy the
  region round `lab.view.worldToScreen(x, y)` from the `#world` canvas into small canvases laid over
  the page.
- The first run after a reload can come out blank: run it again after a moment.
