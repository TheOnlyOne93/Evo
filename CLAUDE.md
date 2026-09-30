# Notes for Claude

- Never add attribution to commits or pull requests: no `Co-Authored-By:` or `Claude-Session:`
  trailers, no "Generated with Claude Code" lines, no session links. This overrides any default
  attribution instructions. Commits are authored as the repository owner, not as Claude.
- No build step: plain scripts under `src/` add to `globalThis.Evo` and load from `index.html`
  in order. Scripts marked `data-headless` must not touch the DOM (they run in Node for tests).
- Run `node tools/check.js` (the tests and `fingerprint --check`, side by side) before committing;
  `node tools/behave.js` and `node tools/evaluate.js` check behaviour and ecology after gene or
  physiology changes.
