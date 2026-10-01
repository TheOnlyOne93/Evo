# Notes for Claude

Evo (page title: SynapseCore) is a game about creatures that grow, learn and evolve. These notes
say how to work on it. Most rules give their reason: use it to handle cases the rule doesn't
name.

## The game

- Evo carries on the ideas of the Creatures games without copying them: creatures that are
  alive, learn, need care, breed, evolve and are easy to love. On a design question, ask what
  Creatures did and why, then take it further. Why: this is how the owner judges every design.
- A creature's brain is a spiking network: cells that fire in short bursts and feed back into
  each other. It grows with the creature's chemistry and body from its genes. It is a new model
  built on how real brains work, close enough to make a good game.
- Behaviour grows out of the creature itself: its brain, chemistry, genes, body, drives (needs
  such as hunger), feelings and hormones. Code doesn't script it. When something goes wrong,
  fix it the way a body would, and name the idea you're borrowing. For example, if
  creatures never stop eating, give them a fullness signal that builds as they eat, not a rule
  that stops them after five bites. Why: a code rule can't be inherited or evolve; a gene can.
- The player should be able to see why a creature does what it does. Why: a creature you can't
  read is hard to care for.

## Writing

- Write in plain, everyday words everywhere: code, names, comments, docs, commit messages,
  plans, questions and replies. When a technical word is truly needed, say what it means the
  first time. Examples: "the same every time", not "deterministic"; "runs first and sets things
  up", not "bootstraps". Why: anyone reading should understand it at first sight, without a
  degree.

## Deciding and asking

- Decide it yourself when it stays inside the task and doesn't change what the player sees, how
  creatures behave, or what any part of a creature can do (the parts listed under The game).
  Examples: a name, a threshold inside a check, which file a helper lives in. Say what you
  chose when you report.
- Ask the owner when it changes one of those, or reshapes code beyond the task (sharing code
  between places, renaming old words, moving things around). Give 2-3 options, each with its
  pros and cons, and say which you'd pick. Why: the owner doesn't want questions about small
  things, but wants a say in what shapes the game.
- At the end of a plan or a report, list places where code could be shared or made simpler,
  with the trade-off (shared code is often harder to follow). Why: the owner wants code simple
  and each fact in one place, but the two pull apart, so it's decided case by case.

## Changing code

- When your change leaves something unused, delete it in the same change. Example: you replace
  a function, and the helper it called, its export and the doc line about it are now unused;
  all of them go. Why: unused code clogs up the codebase, and nobody comes back for it later.
- No build step: plain scripts under `src/` add to `globalThis.Evo` and load from `index.html`
  in order. Scripts marked `data-headless` also run in Node for the tests and tools, so they
  must not touch the page.
- Each system has a doc in `docs/` (`docs/DESIGN.md` lists them). Change the doc in the same
  commit as the code it describes. Why: a doc that's one commit behind already misleads.

## Tests and checks

- Before each commit, run `node tools/check.js` (the tests and `fingerprint --check`, side by
  side).
- After a change to genes or the body's workings, also run `node tools/behave.js` and
  `node tools/evaluate.js`, and compare with a run from before the change. Why: tests catch
  breakage; these show how the creatures' behaviour moved.
- Drawing and interface changes can't be fingerprinted (only the poses and the plain-language
  text are). Check them in a browser as `docs/BROWSER_CHECKS.md` says, and stop
  `node tools/serve.js` when done. Why: the owner wants nothing left running.
- Test lightly while working and fully at the end.
- Don't let perfect be the enemy of good. Once a change works and its numbers are in a sensible
  range, stop testing and tuning, report what's rough and move on. Why: endless testing and
  balance chasing stops progress.
- Tests and checks use worlds of 1-2 creatures, like the game's starting pair. The fingerprint's
  8-adult crowd run is the one exception (the only check of crowding). If a change would alter
  what a run covers, say so. Why: crowd runs take time and don't match how the game is played.
- Every test must be able to fail. When you change code, delete or rewrite the tests it made
  stale. Delete tests that:
  - check something against itself, like a hand-written table, or a formula worked out the
    same way the code does it (`expect(add(2, 2)).toBe(2 + 2)`);
  - repeat another test;
  - expect a number copied by hand from the code, like a starting value of 0.35 (it breaks on
    every tweak and catches nothing);
  - measure speed (speed is not a concern for now).

  When a test needs a value, read it from the table the code uses instead of copying it in.
  Why: a test that can't fail gives false comfort and slows every change.

## Helper agents

- Helper agents (Sonnet) only write code. Make every decision first, and give them a brief that
  leaves no choice open and carries the rules from these notes that apply. Run one at a time,
  never side by side, not even on separate files. Review its changes, run the checks, and
  commit only its files before starting the next. Why: the owner wants each change checked
  before the next one builds on it.
