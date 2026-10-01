# Interface

`src/ui/`, `index.html` and `styles/app.css`: the page around the world view. The element ids in `index.html` are the contract with the scripts: every panel and deck is static markup that a script fills by id. Only `text.js` and `kin.js` are `data-headless`, and they are the only interface code with tests (`tests/text.test.js`, `tests/kin.test.js`; the fingerprint hashes `Evo.text`'s output). Everything else is checked in a browser ([BROWSER_CHECKS.md](BROWSER_CHECKS.md)). The README lists the controls as a player sees them.

## Files

| File | Puts on `Evo` |
|---|---|
| `app.js` | `bootApp()`: builds the world, the view, the synthesizer, the inspector, the hand and the frame clock, sets `Evo.app`, runs the loop |
| `toolbar.js` | `setupToolbar`: pause, the speeds, Scent and Sound, and the tool tray in groups (hand tools, food, toys and more, add a creature) |
| `keyboard.js` | `setupKeyboard` |
| `layout.js` | `setupLayout`: the layout mode, opening and closing the inside view, the sheet's handle, the deck tabs |
| `status.js` | `setupStatus`: the header chips, the toast, the event log (at most 5 lines, 10 s each; a line about a creature is a button that selects it) |
| `card.js` | `setupCard`: the creature card (portrait, name, what it is doing and why, needs, recent events, health and the top three drives) and the Follow button |
| `strip.js` | `setupStrip`: every creature as an avatar with a badge for its strongest need |
| `hand.js` | `HandController`: pointer and wheel input on the world canvas |
| `inspector.js` | `Inspector`: the inside view |
| `helpers.js` | `uiHelpers`: escaping, bars, `setHtml` (keeps buttons stable under a tap), creature faces, colours, plurals |
| `text.js` | `text`: plain-language words for chemicals, drives, genes and actions (headless) |
| `kin.js` | `kinIndex`, `kinOf`: a creature's family from `world.history` (headless) |

Each `setup*` registers its functions on the app (`toast`, `log`, `refreshStatus`, `refreshCard`, `setTool`, `setSpeed`, `togglePause`, `setDeck` …).

## `Evo.app`

State: `world`, `view`, `synth`, `inspector`, `frameClock`, `focus`, `following`, `tool`, `speed`, `paused`, `SPEEDS`. Methods: `select(creature, keepFollowing)`, `stepOnce()` and the ones the setups register. The hand controller is not on it.

**Focus and following** are separate. `focus` is the creature the card and the inside view are about; `following` says whether the camera tracks it. `app.select` is the one way to change the focus. Panning (a drag, the arrow keys) stops following but keeps the focus; `F` or the Follow button toggles it. When the focused creature dies or leaves, the nearest one along x takes its place and following stays as it was.

## The main loop

| When | What |
|---|---|
| Every frame | `frameClock.advance`, then ticks until 11 ms are spent ([TIME.md](TIME.md)), `frameClock.report`; then the view renders, the card's portrait redraws, and `inspector.frame()` runs while the inside view is open (it only draws on the Brain deck) |
| Every tick | `world.step()`, `inspector.sample()`, `view.cues.track()`, `inspector.scopeTick()` |
| 6 times a second | The card |
| 3 times a second | The status chips and the strip |
| 4 times a second | `inspector.update()` for the visible deck, while the inside view is open |

## The hand and the tools

| Tool | On a creature | Elsewhere |
|---|---|---|
| Hand | Tap to put it on the card and follow it; drag to carry it, let go while moving to throw | Drag an egg or item to carry it; drag empty ground to pan |
| Tickle (`pat`) | `world.pat` on press, and again every 15 ticks while stroking; puts it on the card without changing following | Dragging pans |
| Slap | `world.slap` on press only; puts it on the card | Dragging pans |
| An item: fruit, grain, dew, grub, bug, mimic berry, ball, lure, egg (a founder egg), thorn bush | | Tap to drop it there (`world.dropItem`, or `world.addEgg` for the egg; the thorn bush plants one) |

The wheel and a two-finger pinch zoom (a pinch also pans). **Add a creature** brings a grown female or male within 120 px of the focused creature, or, with none, within 120 px of where the first creature of its sex stood; a full world (16) says so in a toast. The hand counts its timing in ticks (the 15-tick pat, flings at the hand's on-screen speed), so it feels the same at every speed.

Keys (`keyboard.js`): arrows and WASD pan, `+`/`=` and `-`/`_` zoom, `0` resets the zoom, `F` toggles following, `[` and `]` step through the creatures, Space pauses, `.` steps one tick while paused, `1`–`4` pick a speed (and resume), Esc goes back to the hand. Keys are ignored while typing in a field.

The only URL option is `?seed=N` (read by `src/core/evo.js`).

## The inside view

`Inspector` renders the visible deck from the simulation. A creature deck with nobody on the card says so. The Genes deck re-renders only when the focus or its stage changes, or on a tab switch; the others on every update.

| Deck | Shows |
|---|---|
| Body | Its life line, every drive, two minutes of drive history, Feelings, vitals, energy (ready, spent, adenosine), food and water, hormones and unnamed chemicals |
| Brain | Counts; what its mind is doing (looking at, decided, reward and punishment surprise, thinking, sleep and dreams, seizures); the brain map (`Evo.BrainView`); a tapped cell or region, with Stimulate (3 pulses of 40 mV); its charge over the last two seconds; the muscles; learned cue values |
| Genes | A summary, traits, mutations against its parents and against both starting genomes (the first female's and the first male's, with nothing left out), a filter, the genes by group, the raw DNA |
| Family | The family tree (`Evo.FamilyView`): tap a living relative to follow it, a dead one to see that relative's family (with a Back button); lists of parents, grandparents, brothers and sisters, children and grandchildren |
| World | Day, season and food; stat tiles; causes of death; a population chart; everyone alive; Skip to the next season |

What it samples each tick: drive history every 30 ticks (240 samples), the mind every tick, genomes and looks every 60 ticks, population every 600. It remembers the genomes and looks of up to 400 creatures, and that memory is the only source for the Genes deck's parent comparison and the faces of dead relatives. Nothing is saved: a reload starts over.

## Layout

`layout.js` picks a mode from `window.visualViewport`. Any change of mode closes the inside view.

| Mode | When | The inside view |
|---|---|---|
| `desktop` | At least 1100 × 600 px | Docked beside the map (`--lab-w`), starts closed |
| `drawer` | Otherwise, 700 px wide or more, or landscape | Slides over the map from the right |
| `sheet` | Otherwise | A bottom sheet with stops at 70 px, 55% and 92%: tap the handle to cycle, drag to snap |

Under 560 px wide the page is also `.compact`: two header chips, no strip, the tool groups open from one button each, icon-only tabs. The card starts folded in the sheet layout or under 560 px tall.

## Styles

`styles/app.css` starts with the tokens on `:root`: surfaces, text, the colours that *mean* something (foods, drives and feelings, the sexes), fonts, layout sizes that `layout.js` reads (`--lab-w`, `--peek`, `--sheet-half`, `--sheet-full`), motion and radii. The canvases read the meaning colours through `Evo.theme` ([RENDERING.md](RENDERING.md)), once, on first use. Then the header, the floats over the stage, the panel layouts (`[data-layout]`, `[data-sheet]`, `.lab-open`), the decks, and the narrow-screen rules.
