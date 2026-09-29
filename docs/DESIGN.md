# SynapseCore design

SynapseCore is a *Creatures*-inspired artificial-life game. Where *Creatures* used hand-designed
feed-forward lobes (attention, concept, decision), SynapseCore uses a **recurrent spiking neural
network** whose wiring, chemistry and body are all grown from a mutable genome.

**Bottom-up is the rule.** The simulation provides physics (bodies, light, heat, scent, sound,
diffusion, spikes, chemical reactions). Genes decide everything else: which chemicals exist and
react, what the body reports as a need, which needs the brain can feel, what is rewarding, how the
brain is wired, and what a creature is born "knowing". Nothing is labelled good or bad by hand.

---

## 1. How the *Creatures* ideas map onto SynapseCore

| *Creatures* | SynapseCore |
|---|---|
| Biochemistry: 256 chemicals, reactions, emitters, receptors, half-lives | The same four gene kinds (plus initial concentrations), acting on 64 chemical slots (`src/sim/biochem.js`) |
| Drives are chemicals (hunger, pain, loneliness…) | Same. Emitter genes turn body states into drive chemicals; receptor genes let the brain feel each one in its own Drives cell |
| Stimulus genes: an event releases chemicals | Same: *stimulus* genes say what being patted, slapped, nuzzled, shoved, eating, falling asleep… releases |
| Reward and punishment chemicals teach the brain | Same, but reward comes from **drive-reduction reactions** at the moment of relief (`Hunger + sweet taste → Reward`), so eating only rewards a hungry creature, and punishment from acute harm (pain, nausea, fear, a bitter taste) |
| Lobes with fixed roles (attention, decision) | Spatial lobes of spiking neurons; roles emerge from genetic axon guidance, Lobe dynamics genes (competition, persistence) and learning from prediction errors |
| Instincts, processed while asleep | Instinct genes are replayed as **dreams**: the sleeping brain is driven with the gene's inputs and action, then its chemical, so the ordinary learning rule wires the association; it also replays surprising moments it lived through |
| Life stages; genes switch on at a stage | Every gene carries a switch-on stage (baby → senile). Sex hormones start at adolescence, ageing at old age, new brain tracts can grow mid-life |
| The hand: tickle, slap, pick up | Pat and slap are *physical* stimuli (gentle touch, impact). Genes decide how they feel; the founder genome makes pats pleasant and slaps painful |
| Social life, calls, mating, eggs | Loneliness, crowding, fear and anger are drive chemicals; calls are sounds others hear left/right; mating leads to pregnancy and an egg that incubates and hatches |
| Side-view world with day, night and seasons | Same: gravity, terrain, a pond, trees, a warm rock, day/night light and temperature, four seasons |

---

## 2. Time and scale

* 60 ticks = 1 simulated second at 1× speed.
* A day lasts `DAY_TICKS` (3 minutes); a season lasts 2 days; a year is 8 days.
* A creature lives roughly 25–40 minutes of simulated time (about one year), set by its genes.
* Life stages, as fractions of lifespan: baby 0–5%, child –15%, adolescent –25%, youth –35%,
  adult –75%, old –90%, senile after that.

---

## 3. Genome

A byte string. A gene is expressed only where a promoter byte (`0xA5`) sits in front of it:

```
A5  HH  payload…
    │└ type = HH % 32         (gene table index)
    └─ stage = HH >> 5         (0–7: life stage at which the gene switches on; 0 and 1 = from birth)
```

Everything else is silent junk DNA that mutation can turn into new genes. Mutation (point
changes, gene duplication, gene loss, frameshifts) and recombination work on raw bytes; every
decoded value is clamped, so a broken gene makes a bad creature, never a broken simulation.

Gene kinds: appearance, morphology, eyes, nose, membrane, plasticity, reinforcement sensitivity,
muscle, life history, voice, curiosity, anatomy, region duplication, axon guidance, pacemaker,
neurochemistry, **reaction, emitter, receptor, half-life, initial concentration, instinct**,
insulation, reproduction, **stimulus**, lobe dynamics. Each row of `Evo.GENES` (`src/sim/genome.js`) decodes its bytes,
expresses traits, and describes itself in plain words for the UI.

Genes that switch on at a later stage join the traits then: the biochemistry is reconfigured, new
axon guidance tracts and pacemakers grow, and a later life-history gene changes the lifespan (life
stages only move forward). The brain's layout and cell properties are built once, at birth, so
later copies of **anatomy, region duplication, membrane, neurochemistry and lobe dynamics** genes have no effect
(the genome view says so).

---

## 4. Biochemistry (`src/sim/biochem.js`)

64 chemical slots (concentrations 0–1). Named slots are listed in `Evo.CHEMICALS`; the rest are
free for mutation to use.

* **Reaction** `A + B → C + D` at a genetic rate (B, C, D may be "nothing"). Catalysis is written
  `A + E → C + E`. Mass-action kinetics, with genetic yields.
* **Emitter** reads a *locus* (a body sensor or any chemical) and releases a chemical when the
  reading is above (or below) a threshold.
* **Receptor** reads a chemical and pushes on a *target*: muscle strength, arousal, sleep pressure,
  health damage, healing, fertility, growth, sex or alarm scent release, metabolic rate, shivering
  (thermogenesis), panting (cooling), or a current into a specific neuron of the Drives or Feelings
  lobe (`Evo.TARGETS`).
* **Stimulus** names an event (`Evo.STIMULI`: ate, drank, patted, slapped, nuzzled, was nuzzled,
  shoved, was shoved, called, heard a call, grabbed, dropped, bumped, fell, woke, fell asleep, mated,
  played, pricked by thorns) and releases (or removes) up to two chemicals when it happens. The world raises each
  event where it physically happens (`creature.stimulate(key, strength)`).
* **Half-life** and **initial concentration** genes.

The founder genome builds a working metabolism with these genes: digestion (gut sugar, starch,
protein, fat → blood), insulin and glucagon storing and releasing glycogen and fat, detox,
fatigue (adenosine), a day-driven sleep hormone, growth hormone in youth, sex hormone from
adolescence, and ageing in old age.

**Drives** (chemicals, `Evo.DRIVES`): pain, hunger, protein hunger, fat hunger, thirst, tiredness,
sleepiness, cold, heat, loneliness, crowding, fear, anger, boredom, sex drive, nausea. Each has its
own cell in the brain's Drives lobe (`Evo.driveCell(key)`; the founder's receptor genes wire one
drive to one cell). Drive cells sit at addresses of their own, apart from the muscles, so what a drive
makes the creature do is up to guidance genes: the founder has a few weak innate priors, each a
guidance gene windowed on one drive cell (pain and fear → run, sleepiness, tiredness and nausea →
rest, loneliness → call, hunger and protein hunger → eat, thirst → drink, anger → grab, boredom,
crowding, hunger and thirst → walk), and the rest is learned.

**Novelty** comes from things: a creature keeps a familiarity per vision feature, and the thing at its
mouth (or the nearest item within 60 px) is novel in as far as its look is unfamiliar. Looking makes
it familiar; familiarity fades slowly.

**Reinforcement.** Each drive has a matching *relief* signal released by the sense or act that
satisfies it: the taste of food (sweet or savoury), the taste of water, warmth flowing in (or out,
for a hot creature), company, rest, dozing off, novelty, mating. A reaction `Drive + Relief → Reward` turns relief into reward *in
proportion to how much drive there was*, at the moment of relief: eating rewards while the food is
tasted, falling asleep rewards once (not all night). A full gut still sates hunger, quietly, without
reward. Punishment is released by emitters reading pain, nausea, fear and a bitter taste, and by
stimulus genes (a slap).

---

## 5. Brain (`src/sim/brain.js`)

A recurrent spiking network grown from the genome: leaky integrate-and-fire neurons with conduction
delays (spikes travel along axons), homeostatic thresholds and adaptation. Nothing is hand-wired
into lobes that "do" attention or decisions: competition, persistence and memory come from Lobe
dynamics genes, and learning from whatever the genes make rewarding.

**Learning.** The first two Feelings cells are modulators: reward (channel 0) and punishment
(channel 1). What they learn from is `brain.outcome[c]`, set by the creature each tick from the
receptor effects on `limbic:0` / `limbic:1` (so which chemicals feel good is up to receptor genes;
the brain never reads a chemical by name). Only a rise above the recent level counts
(r = max(0, O − Ō), Ō following O over 120 ticks). Every synapse onto a modulator is a *value*
synapse: it carries a prediction V (= Σ w·x, x = its recent input) and delivers no current. The
prediction error δ = r + 0.98·V − V_prev (clamped ±1) trains the value synapses by TD(λ) and makes the
modulator fire on positive errors (60 mV × δ), so the cells stay silent when nothing unexpected
happens. Elsewhere, learning is three-factor: when a neuron fires, each input that arrived in the
4 ticks before (at that axon's delay) becomes eligible (e ← e·λ^Δt + 1, capped at 2; λ from the
Plasticity memory gene, half-life 14–140 ticks); every 4 ticks each weight moves by
0.25 × learning rate × e × the summed signal at its target, joy × δ_R × F_R − stress × δ_P × F_P.
F_c is the modulator's *learning field*: Gaussians around its axon terminals (width set by the
Neurochemistry gene), so where learning happens depends on where its axons grew. Synapses keep
their sign (Dale's law) and soft bounds. `brain.chem[0..2]` are 20×20 images of this signal for the
brain view (the old NO channel is retired: a Neurochemistry gene that picks it does nothing).

**Lobe dynamics** (gene: lobe, which copy, competition, persistence, tau, fatigue). The cells of a
region inhibit each other in proportion to the others' recent firing; cells crossing threshold in
the same tick are resolved strongest first, each later one held back by the competition current of
those already firing; each spike adds a self-sustaining current (up to 3 spikes' worth) that fades
with tau; fatigue slows recovery from adaptation. The founder uses it three times:
- *Movement*: weak competition, low persistence. The most strongly driven muscle wins and keeps
  going until it tires or a clearly stronger input takes over (actions persist; rivals rarely fire
  in the same tick).
- *The sight copy* (the second region duplication): strong competition, so it settles on one thing;
  windowed guidance genes from each drive's Drives cell bias the features it cares about (hunger:
  red, yellow, green; thirst: blue; loneliness: creatures; sex drive: pink). The copy inherits the
  sight lobe's approach tracts, so what is attended pulls hardest. `brain.attended()` reads
  `{ side, band, feature }`.
- *Thinking*: weak competition, strong persistence: working memory that outlasts what caused it.
  The colours of food and water on one side excite the thinking cells tagged for that side, and
  those pull on that side's walk muscle, so a creature keeps heading where it saw food after it
  vanishes (`memory:` reports in tools/scenarios/learning.js, against a persistence-0 knockout).
A seizure brake holds every central neuron back 10 mV for a tick when more than a quarter of the
brain has fired for 3 ticks running.

**Sleep.** `brain.sleepStep(instincts, chem)` runs before each sleeping tick. A dream starts now and
then: an instinct gene (its inputs, then its action, then its chemical, into the body), or, half
the time, a replayed *episode*: awake, each prediction error beyond ±0.2 stores the active senses,
the working muscle and the error's sign and size (8 at most); asleep, the replay drives those
senses, then the muscle, then adds half the value to the reward or punishment outcome.

**Cost.** ~25–30 µs of brain and ~20 µs of senses per creature-tick (16 creatures ≈ 1.1 ms per
world tick headless); `node tools/behave.js 12 cost --report` measures it.

Brain coordinates: x = the creature's left (0) to right (1) **in the world** (the side view has
two hemifields: things to the left and things to the right); y = front (senses) to back (motor).

| Lobe | Neurons |
|---|---|
| Sight | 2 sides × 2 heights (low, high) × 8 features (red, yellow, green, blue, violet, pink, creature, motion) |
| Smell | 2 antennae × 10 odours |
| Hearing | 2 ears × 2 pitches |
| Touch | contact left/right, mouth left/right, lips (water), back (pat/hit), feet, pain, gentle touch, falling, in water |
| Taste | sweet, starchy, savoury, fatty, bitter, water |
| Up close | one cell per vision feature: the look of whatever is at the mouth |
| Drives | 18 cells (`N_NEEDS`), each driven by whichever chemicals receptor genes attach to it; the founder feels drive k in cell k (`Evo.driveCell`), 2 spare |
| Feelings | reward cell, punishment cell and 6 general cells (emitter genes can read these) |
| Thinking, Side lobes, Central lobe, Brainstem | general-purpose cells |
| Movement | walk left, walk right, jump, eat, grab/drop, rest, call, run, drink |

The sensory layouts are defined once, in `Evo.BRAIN_BODY_PLAN`: `sightIndex(side, band, feature)`,
`smellIndex(side, odour)` and `hearingIndex(side, pitch)` give a cell's place in its lobe, and
`sightCell(k)` / `smellCell(k)` decode it (the body's senses, founder instincts and the pose use
them). The modulatory channels (DA reward, ST stress, and the retired NO) are listed in `Evo.NEUROCHEMS`.
`brain.inject(neuron, mV, delayTicks)` delivers an input that arrives after a delay (the inspector's
"stimulate").

Neuron state lives in typed arrays (struct-of-arrays) for speed; `brain.neurons[i]` holds each
neuron's identity (id, lobe, position, receptor tag, meta) for the UI.

---

## 6. World (`src/sim/world.js`) — **read-only contract for renderers**

y grows downward. All lengths in world pixels.

```js
world.width, world.height            // ~3600 × 900
world.terrain = {
  step,                              // px between height samples
  heights,                           // Float32Array: ground surface y at x = i * step
  groundY(x),                        // interpolated surface y
  ponds: [{ x0, x1, level }],        // water surface y over [x0, x1] where the ground is below it
  waterLevelAt(x)                    // pond surface y at x, or null
}
world.platforms = [{ x0, x1, y, kind }]            // one-way surfaces: 'log' | 'rock'
world.features  = [{ id, kind, x, y, ...props }]   // y = base on the ground
  //  'tree'      { height, canopy, species: 'fruit' | 'mimic', yields: item type, fruiting: 0..1 }
  //  'grass'     { width, height, seeding: 0..1 }       grain grows here
  //  'log'       { length }                             grubs live here
  //  'rock'      { w, h, warm: 0..1 }                   the sun-warmed rock
  //  'reeds'     { width }
  //  'thornbush' { radius }                             looks violet; moving through it pricks ('pricked' stimulus)
world.items = [{ id, type, x, y, vx, vy, radius, rot, age, held, onGround, ... }]
  //  type: 'fruit' | 'grain' | 'grub' | 'bug' | 'mimic' | 'dew' | 'lure' | 'carrion' | 'egg' | 'ball'
  //  egg: { hue, accentHue, progress: 0..1 }   ball: { hue }
world.creatures                      // live creatures; draw each via Evo.CreatureArt.draw(ctx, Evo.poseOf(c), t)
world.clock = { tick, day, phase, light, sunElevation }
  //  phase 0..1 (0 midnight, .25 sunrise, .5 noon, .75 sunset); light 0..1; sunElevation -1..1
world.season = { key, index, progress }   // key: 'SPRING' | 'SUMMER' | 'AUTUMN' | 'WINTER'
world.temperatureAt(x, y)            // 0..1 (0 freezing, 0.5 mild, 1 hot)
world.scent = { cols, rows, cell, channels }   // Float32Array per channel; channel list in Evo.SCENTS
world.sounds = [{ x, y, pitch, loudness, age, sourceId }]   // calls, for drawing notes; kept Evo.WORLD.SOUND_LIFE ticks
world.surfaceBelow(x, fromY)         // the highest surface (ground or platform) at or below fromY at x
world.setTime(day, phase)            // jump the clock (tools, tests, UI)
```

Constants renderers share with the simulation: `Evo.WORLD.HOLD_GRIP` (a creature in the hand hangs
with its feet `HOLD_GRIP × size` below the hand), `Evo.WORLD.SOUND_LIFE`, and
`Evo.CREATURE.WALK_PHASE_PER_PX` (walk-cycle radians per px walked).

Creatures (`src/sim/creature.js`): `x` = centre, `y` = feet on the ground, `facing` ±1, `vx`, `vy`,
`onGround`, `id`, `name`, `sex`, `stage`, `genome`, `chem` (biochemistry), `brain`, `traits`,
`action` ('idle' | 'walking' | 'running' | 'jumping' | 'eating' | 'drinking' | 'resting' | 'calling' |
'sleeping' | 'held'), `lifespan` (ticks, from the current traits), `isMature` (adolescent or older).

---

## 7. Creature pose — contract between the simulation and `Evo.CreatureArt`

`Evo.poseOf(creature)` (in `src/render/pose.js`) turns simulation state into this plain object.
The creature artist draws only from the pose, never from simulation internals.

```js
pose = {
  id, x, y,                 // world coords; y = where the feet touch the ground
  groundY,                  // optional: ground surface below the creature (for a shadow while airborne)
  facing,                   // 1 = facing right, -1 = facing left
  size,                     // body length in px (≈18 for a newborn, ≈44 for a large adult)
  stage,                    // 1 baby, 2 child, 3 adolescent, 4 youth, 5 adult, 6 old, 7 senile
  sex,                      // 'FEMALE' | 'MALE'
  looks: {                  // all 0..1 unless noted; genetic, fixed for life
    hue, accentHue,         // 0..360
    pattern,                // 0 plain, 1 stripes, 2 spots, 3 patches
    patternScale, earSize, tailLength, eyeSize, plumpness, legLength, crest
  },
  motion: {
    vx,                     // px per tick, signed
    airborne,               // true while jumping or falling
    walkPhase,              // radians; advances with distance walked (Evo.CREATURE.WALK_PHASE_PER_PX)
    lying                   // 0..1 (1 = lying down: resting or asleep)
  },
  face: {
    eyesClosed,             // 0..1
    pupilX, pupilY,         // -1..1: where it is looking
    mouthOpen,              // 0..1
    smile,                  // -1 (miserable) .. 1 (delighted)
    earDroop,               // 0..1 (tired, sad, lonely, ill)
    blush,                  // 0..1 (pleasure, e.g. being patted)
    happy,                  // 0..1 (just patted: happy eyes, wagging tail)
    worry,                  // 0..1 (worried brows: in pain, lonely, bored)
    yawn, lick              // 0..1 (brief gestures: sleepy or tired; hungry or thirsty)
  },
  state: {
    asleep, held, dead, eating,   // eating: the mouth is at work (eating or drinking)
    calling,                // 0..1 (show a call)
    flinch,                 // 0..1 (just hurt)
    fear, anger, pain, sick, cold, hot, wet, pregnant,   // 0..1
    inHeat                  // boolean: crest/colour display of a fertile adult
  },
  focused, hovered          // UI highlight
}
```

---

## 8. Rendering modules

```js
// src/render/creature-art.js
Evo.CreatureArt = {
  draw(ctx, pose, t),                 // ctx is already in world coordinates; t = seconds
  drawPortrait(ctx, pose, w, h, t),   // fit the creature into a w×h box (UI card)
  bounds(pose)                        // { x0, y0, x1, y1 } in world coordinates, for picking
}

// src/render/world-view.js
class WorldView {
  constructor(world, canvas)
  setWorld(world)                     // show another world (e.g. after a restart)
  resize()
  render(t)                           // sky, parallax, terrain, water, features, items, creatures, overlays
  follow(creature | null)             // camera tracks a creature smoothly
  panBy(dx, dy); zoomAt(factor, sx, sy); resetZoom()
  screenToWorld(sx, sy); worldToScreen(x, y)
  creatureAt(sx, sy); itemAt(sx, sy)  // picking in screen coordinates
  options: { showScent, showSenses, focused, hand: { x, y, mode, holding, tool } }
}
```

Colours come from CSS tokens through `Evo.theme` where a colour *means* something (food types,
sexes, reward/stress). Environment art may use its own palette.

Performance: 60 fps with 16 creatures and 80 items on a mid-range laptop. Cache static layers
(terrain, far scenery) in offscreen canvases; avoid per-frame allocation in hot paths.

---

## 9. Player tools (the hand)

* **Hand**: tap a creature to follow it; drag a creature, egg or item to carry it; release to drop or throw.
* **Tickle** (the `pat` tool, `world.pat`): gentle touch on the creature's back (a physical
  stimulus; the founder genome makes it pleasant).
* **Slap** (`world.slap`): an impact on its back (painful; wakes a sleeper).
* **Drop things**: food (fruit, grain, dew, grubs, bugs, mimic berries), a ball, a lure, a founder
  egg, a thorn bush. Adult founders (female or male) can be added too.

Keyboard: see the README.
