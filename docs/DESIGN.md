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
| Drives are chemicals (hunger, pain, loneliness…) | Same. Emitter genes turn body states into drive chemicals; receptor genes let the brain feel them |
| Reward and punishment chemicals teach the brain | Same, but reward comes from **drive-reduction reactions** (`Hunger + gut sugar → Reward`), so eating only rewards a hungry creature, and punishment from acute harm (pain, nausea, fear) |
| Lobes with fixed roles (attention, decision) | Spatial lobes of spiking neurons; roles emerge from genetic axon guidance and learning |
| Instincts, processed while asleep | Instinct genes are replayed as **dreams**: the sleeping brain is driven with the gene's inputs and action, then its chemical, so the ordinary learning rule wires the association |
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
neurochemistry, **reaction, emitter, receptor, half-life, initial concentration, instinct**.

---

## 4. Biochemistry (`src/sim/biochem.js`)

64 chemical slots (concentrations 0–1). Named slots are listed in `Evo.CHEMICALS`; the rest are
free for mutation to use.

* **Reaction** `A + B → C + D` at a genetic rate (B, C, D may be "nothing"). Catalysis is written
  `A + E → C + E`. Mass-action kinetics, with genetic yields.
* **Emitter** reads a *locus* (a body sensor or any chemical) and releases a chemical when the
  reading is above (or below) a threshold.
* **Receptor** reads a chemical and pushes on a *locus*: muscle strength, sleep pressure, health
  damage, healing, fertility, growth, scent release, arousal, or a current into a specific neuron
  of the Needs or Feelings lobe.
* **Half-life** and **initial concentration** genes.

The founder genome builds a working metabolism with these genes: digestion (gut sugar, starch,
protein, fat → blood), insulin and glucagon storing and releasing glycogen and fat, detox,
fatigue (adenosine), a day-driven sleep hormone, growth hormone in youth, sex hormone from
adolescence, and ageing in old age.

**Drives** (chemicals): pain, hunger, protein hunger, fat hunger, thirst, tiredness, sleepiness,
cold, heat, loneliness, crowding, fear, anger, boredom, sex drive, nausea.

**Reinforcement.** Each drive has a matching *relief* signal released by the sense or act that
satisfies it (gut contents, the taste of water, warmth flowing in, company, rest, sleep, novelty,
mating). A reaction `Drive + Relief → Reward` turns relief into reward *in proportion to how much
drive there was*. Punishment is released by emitters reading pain, nausea and fear.

---

## 5. Brain (`src/sim/brain.js`)

Leaky integrate-and-fire neurons with conduction delays (spikes travel along axons), homeostatic
thresholds, adaptation, and three-factor learning: a Hebbian eligibility trace times the reward
minus stress chemical *at the synapse's location*. Reward and stress chemicals are released by two
limbic cells at the ends of their axons (volume transmission), so where learning happens depends
on where those axons grew. Cue synapses onto the limbic cells learn by temporal difference.

Brain coordinates: x = the creature's left (0) to right (1) **in the world** (the side view has
two hemifields: things to the left and things to the right); y = front (senses) to back (motor).

| Lobe | Neurons |
|---|---|
| Sight | 2 sides × 2 heights (low, high) × 7 features (red, yellow, green, blue, violet, pink, motion) |
| Smell | 2 antennae × 10 odours |
| Hearing | 2 ears × 2 pitches |
| Touch | contact left/right, mouth left/right, back (pat/hit), feet, pain, gentle touch, falling, in water |
| Taste | sweet, starchy, savoury, fatty, bitter, water |
| Needs | 16 cells, each driven by whichever chemicals receptor genes attach to it |
| Feelings | reward cell, punishment cell and 6 general cells (emitter genes can read these) |
| Thinking, Side lobes, Central lobe, Brainstem | general-purpose cells |
| Movement | walk left, walk right, jump, eat, grab/drop, rest, call, run |

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
  //  'tree'      { height, canopy, species: 'fruit' | 'mimic', fruiting: 0..1 }
  //  'grass'     { width, height, seeding: 0..1 }       grain grows here
  //  'log'       { length }                             grubs live here
  //  'rock'      { w, h, warm: 0..1 }                   the sun-warmed rock
  //  'reeds'     { width }
  //  'thornbush' { radius }                             hurts on contact
world.items = [{ id, type, x, y, vx, vy, radius, rot, age, held, onGround, ... }]
  //  type: 'fruit' | 'grain' | 'grub' | 'bug' | 'mimic' | 'dew' | 'lure' | 'carrion' | 'egg' | 'ball'
  //  egg: { hue, accentHue, progress: 0..1 }   ball: { hue }
world.creatures                      // live creatures; draw each via Evo.CreatureArt.draw(ctx, Evo.poseOf(c), t)
world.clock = { tick, day, phase, light, sunElevation }
  //  phase 0..1 (0 midnight, .25 sunrise, .5 noon, .75 sunset); light 0..1; sunElevation -1..1
world.season = { key, index, progress }   // key: 'SPRING' | 'SUMMER' | 'AUTUMN' | 'WINTER'
world.temperatureAt(x, y)            // 0..1 (0 freezing, 0.5 mild, 1 hot)
world.scent = { cols, rows, cell, channels }   // Float32Array per channel; channel list in Evo.SCENTS
world.sounds = [{ x, y, pitch, loudness, age, sourceId }]   // calls, for drawing notes
```

Creatures (`src/sim/creature.js`): `x` = centre, `y` = feet on the ground, `facing` ±1, `vx`, `vy`,
`onGround`, `id`, `name`, `sex`, `stage`, `genome`, `chem` (biochemistry), `brain`, `body`.

---

## 7. Creature pose — contract between the simulation and `Evo.CreatureArt`

`Evo.poseOf(creature)` (in `src/render/pose.js`) turns simulation state into this plain object.
The creature artist draws only from the pose, never from simulation internals.

```js
pose = {
  id, x, y,                 // world coords; y = where the feet touch the ground
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
    walkPhase,              // radians; advances with distance walked
    lying                   // 0..1 (1 = lying down: resting or asleep)
  },
  face: {
    eyesClosed,             // 0..1
    pupilX, pupilY,         // -1..1: where it is looking
    mouthOpen,              // 0..1
    smile,                  // -1 (miserable) .. 1 (delighted)
    earDroop,               // 0..1 (tired, sad, ill)
    blush                   // 0..1 (pleasure, e.g. being patted)
  },
  state: {
    asleep, held, dead, eating,
    calling,                // 0..1 (show a call)
    flinch,                 // 0..1 (just hurt)
    fear, anger, sick, cold, hot, wet, pregnant,   // 0..1
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
  resize()
  render(t)                           // sky, parallax, terrain, water, features, items, creatures, overlays
  follow(creature | null)             // camera tracks a creature smoothly
  panBy(dx, dy); zoomAt(factor, sx, sy)
  screenToWorld(sx, sy); worldToScreen(x, y)
  creatureAt(sx, sy); itemAt(sx, sy)  // picking in screen coordinates
  options: { showScent, showSenses, focused, hand: { x, y, mode, holding } }
}
```

Colours come from CSS tokens through `Evo.theme` where a colour *means* something (food types,
sexes, reward/stress). Environment art may use its own palette.

Performance: 60 fps with 16 creatures and 80 items on a mid-range laptop. Cache static layers
(terrain, far scenery) in offscreen canvases; avoid per-frame allocation in hot paths.

---

## 9. Player tools (the hand)

* **Look / grab**: tap a creature to follow it; drag a creature, egg or item to carry it; release to drop or throw.
* **Pat**: gentle touch on the creature's back (a physical stimulus; the founder genome makes it pleasant).
* **Slap**: an impact on its back (painful; wakes a sleeper).
* **Drop items**: food, toys, lures.

Keyboard: arrow keys / A–D pan, +/− zoom, F follow, Space pause.
