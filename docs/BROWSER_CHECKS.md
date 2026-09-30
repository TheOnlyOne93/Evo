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
