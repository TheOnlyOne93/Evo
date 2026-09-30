# Notes for Claude

- Write in plain words: code, names, comments, docs, commit messages and replies. Someone without
  a degree should understand them at first sight. Use everyday words; when a technical word is
  truly needed, say what it means the first time it appears.
- No build step: plain scripts under `src/` add to `globalThis.Evo` and load from `index.html`
  in order. Scripts marked `data-headless` also run in Node for the tests and tools, so they
  must not touch the page.
- Before committing, run `node tools/check.js` (the tests and `fingerprint --check`, side by
  side). After gene or physiology changes, also run `node tools/behave.js` and
  `node tools/evaluate.js`, and compare with a run from before the change.
- Drawing and interface changes can't be fingerprinted (only the poses and the plain-language
  text are): check them in a browser as `docs/BROWSER_CHECKS.md` says, and stop
  `node tools/serve.js` when the check is done.
- Each system has a doc in `docs/` (`docs/DESIGN.md` lists them). Change the doc in the same
  commit as the code it describes.
