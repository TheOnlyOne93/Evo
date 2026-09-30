# Brain

`src/sim/brain.js`: `Evo.Brain`, a recurrent spiking network grown from the genome. The founder's wiring genes are in `src/sim/founder-brain.js`.

Nothing is hand-wired to "do" attention or decisions. Those roles come from guidance genes, Lobe dynamics genes and learning from whatever the genes make rewarding.

## Neurons

Leaky integrate-and-fire cells with a refractory period, adaptation, and a threshold that drifts to hold each cell near a resting activity (its target firing rate). State lives in typed arrays, one entry per neuron. `brain.neurons[i]` describes neuron i (region, spot, side, position, meta) for the interface.

### The brain map

Coordinates: x runs from the creature's left (0) to its right (1) **in the world** (the side view has two hemifields: things to the left, things to the right). y runs from the front (senses, 0) to the back (muscles, 1). Every region is a **box** on this map (`box: [x0, y0, x1, y1]` in `LOBES`, `src/sim/constants.js`), and a cell's **address is its spot in its box**: `spot: [u, v]`, both from 0 to 1. Where the cell is drawn (`pos`) follows from its box and its spot. How long a signal takes to cross the brain follows from `pos` distance and the axon's speed, as before.

A **two-sided** region (`sided: true`) has a left box, the one in `LOBES`, and a right box that is its mirror image (x becomes 1 − x). In it u runs from the box's outer edge (0) to its inner edge next to the midline (1), so a left cell and its twin on the right have the same spot. Each cell also has a `side` (`'L'`, `'R'` or null): the cells of two-sided regions, the touch cells for the left and right, and the two walking muscles.

Most regions are a grid (`grid: [columns, rows]`, per side for a two-sided region, which also gives the usual cell count): cell i sits in column (i mod columns) and row (i div columns), with as many rows as the cell count needs, at `u = (column + 0.5) / columns`, `v = (row + 0.5) / rows`. The others:

- **Sight**: the column is the vision feature (red at the outer edge); the row is the height, `v` 0.35 for high and 0.65 for low (closer together than the grid would put them, so one source window can take a colour's two cells without its neighbours).
- **Attention**: the column is the vision feature, `v` 0.5: the same columns as Sight.
- **Smell**: column = odour mod 5, row = odour div 5. **Hearing**: one column, row 0 for the high pitch and row 1 for the low one.
- **Touch** and **Movement**: each cell has a spot of its own (the `TOUCH` table in `brain.js`, `Evo.MOTORS`). The muscles sit along one row, left to right: walk left, jump, eat, grab or drop, rest, call, run, drink, walk right.

| Region | Box | Sided | Cells |
|---|---|---|---|
| Sight | [0.10, 0.10, 0.47, 0.18] | yes | 32: 2 sides × 2 heights (low, high) × 8 features (red, yellow, green, blue, violet, pink, creature, motion) |
| Smell | [0.30, 0.02, 0.47, 0.08] | yes | 20: 2 antennae × 10 odours |
| Hearing | [0.02, 0.10, 0.08, 0.18] | yes | 4: 2 ears × 2 pitches |
| Touch | [0.36, 0.80, 0.64, 0.87] | | 11: contact left and right, mouth left and right, lips (water), back, feet, pain, gentle touch, falling, in water |
| Taste | [0.14, 0.80, 0.30, 0.85] | | 6: sweet, starchy, savoury, fatty, bitter, water (the list is `Evo.TASTES`, in `src/sim/constants.js`; this file only gives each cell its spot) |
| Up close | [0.70, 0.80, 0.86, 0.85] | | 8: one per vision feature, the look of whatever is at the mouth |
| Drives | [0.33, 0.71, 0.67, 0.78] | | 18 (`N_DRIVE_CELLS`): the founder feels drive k in cell k (`Evo.driveCell`); 2 are spare |
| Feelings | [0.41, 0.63, 0.59, 0.68] | | 8: the reward cell, the punishment cell and 6 general cells |
| Attention | [0.16, 0.26, 0.47, 0.30] | yes | 16: 2 sides × 8 vision features. Its cells compete; the winner is what the creature is looking at |
| Thinking | [0.08, 0.34, 0.45, 0.48] | yes | 30 general-purpose cells (15 a side) |
| Side lobes | [0.03, 0.53, 0.20, 0.67] | yes | 24 general-purpose cells (12 a side) |
| Central lobe | [0.39, 0.52, 0.61, 0.61] | | 20 general-purpose cells |
| Movement | [0.06, 0.95, 0.94, 0.99] | | 9: walk left, walk right, jump, eat, grab or drop, rest, call, run, drink |
| Brainstem | [0.10, 0.89, 0.90, 0.93] | | 18 general-purpose cells (9 × 2) |

The founder's brain has 224 neurons and 1,367 synapses at birth, the same every time ([below](#the-same-genes-grow-the-same-brain)). `Evo.LIMITS` caps a brain at 3,200 synapses, of which the genome may grow 2,400 before birth.

`Evo.BRAIN_BODY_PLAN` defines the cell layouts once: `sightIndex(side, band, feature)`, `smellIndex(side, odour)` and `hearingIndex(side, pitch)` give a cell's place in its region, and `sightCell(k)` and `smellCell(k)` decode it. `gridSpot(region, i)`, `colourSpot(feature)` and `smellSpot(odour)` give a cell's spot, and `TOUCH` and `Evo.MOTORS` carry the spots of the touch cells and the muscles; the founder's wiring genes read their spots from these (`founderKit`, [GENOME.md](GENOME.md)), so no number is copied.

**Anatomy genes** reshape a region's box, not its cells: *shift* moves the box front or back, *lateral* scales its distance from the map's middle (x − 0.5), *size* stretches its height about its middle, and *count* changes the number of cells in the four general-purpose regions (the grid gets more or fewer rows, and a two-sided region keeps an even count). The box stays inside the map. Spots, and so addresses, don't change with position or size.

### Resting activity

Every thinking cell's balancing (homeostasis) pulls its firing toward a resting activity and lets a quiet cell's threshold drop by up to a set number of mV. Each kind of cell gets both from its region's **Cell type** genes (region, rest, twitch): rest is the share of ticks the cell fires when nothing drives it (0.001 to about 0.3, on a log scale), twitch is how many mV easier to fire a quiet cell may become (0 to 16). Several genes for one region: the last one wins. Sensory cells have no balancing, and the first two Feelings cells (reward and punishment) are not balanced either.

A region with no Cell type gene rests at 0.12 and may drop 14 mV, like a thinking cell: a missing gene makes a restless creature, never a broken one. The founder has three: muscles, Feelings cells and Brainstem cells rest at 0.4% and may drop 3 mV, so a single weak input doesn't make them fire (a Feelings cell that fired at rest would make fear all the time; a Brainstem cell must wait for two inputs at once). The muscles' pacemaker then lifts their resting activity a little (to about 0.6%). Every cell starts life at its own resting activity, so a newborn has no burst of firing.

## Wiring

- **Axon guidance.** Each gene sends the axons of one region toward a **spot** in a **target region** (never a sensory region), and a source window (a spot and a radius on the source region's own spots) can limit the gene to a few cells. Which **side** of the target a cell aims at depends on the gene: *same side* (the source cell's own; a cell with no side aims at both sides), *other side* (the opposite; no side, both), or a fixed *left* or *right* side whatever the source. In a two-sided target region a side is its box: only that side's cells are candidates, compared by spot. In any other region the left side is the spot as given and the right side its mirror image `[1 − u, v]`; aiming at both takes the nearer. The cells within the gene's radius of the aimed spot are candidates; a good match within reach almost always connects. Candidates from all genes join one queue and take the innate budget in turn. A gene that switches on later grows its tract then.
- **Background wiring** at birth: sparse, weak links between neighbours, scattered as if at random (by fixed dice, below).
- **Pacemaker** genes give a region a steady current.
- **Delay.** A spike arrives 1 to 20 ticks after it is fired, by the axon's length and its conduction speed.
- **Morphogenesis**, every 80 ticks. An active cell may sprout one weak synapse to a depolarised neighbour. A sprout that stays weak is pruned; innate tracts are never pruned. Synaptic scaling turns a cell's excitatory inputs down when it fires far too much, and up when it has fallen silent.

A synapse keeps the sign it was born with (Dale's law). Weights run from −1.8 to 2.0.

### The same genes grow the same brain

Every chance in growing the wiring is a roll of fixed dice, `Evo.util.fixedRoll(dice, from, to, which)` ([CORE.md](CORE.md)): the same four whole numbers always give the same number, and nothing is drawn from `Evo.random`. So the same genes always grow the same brain, and a birth leaves the world's dice (food, weather, firing noise) as they were.

- `dice` is the gene's own number, carried by the tract entry `genome.develop()` makes for it ([GENOME.md](GENOME.md)). It comes from the gene's bytes and from how many identical genes came before it, so taking out or moving another gene leaves it as it was, and each copy of a doubled gene rolls its own dice (a copy can grow connections the first one did not).
- `from` and `to` are the two cells' `stableId`: the region's number × 1024 + the cell's number within its region. A region's number is its place in `Evo.LOBE_ORDER`. So a cell keeps its id when another region grows or shrinks (1024 is more cells than any region can hold).
- `which` picks the roll: 0 whether it connects (the odds: how near the target cell's spot is to the spot sought, and how far away it is on the map against the gene's reach (0.15 to 3.0 map heights; the founder's genes reach 3.0, anywhere on the map, and the target region limits where they land); a spot within 0.01 of the one sought counts as a perfect match, since what is left is only the byte rounding of a gene's spot, so it connects whenever the target is within reach, and further off the odds fall with the square of how far the spot is from a match), 1 its strength (0.3 to 0.5 × the gene's weight), 2 its place in the queue for the budget. Where two genes want the same connection, the one first in the queue makes it.
- The background wiring has no gene, so it rolls with a fixed number of its own (`BACKGROUND_DICE`).
- A gene that switches on later in life rolls the same way when it grows.

So changing one wiring gene changes only connections that gene could make, while the innate budget of 2,400 lasts (the founder uses 1,383): the rest of the brain stays as it was. The one exception: where the gene made a connection that another gene (or the background wiring) also wanted, the other one makes it once the gene is gone, with its own weight. Any change to a gene's bytes gives it new dice, so all of that gene's connections are rolled again, not only those its changed value touches.

What happens while living still uses the world's dice: firing noise, sprouting new connections (morphogenesis), and which dream plays.

### The founder's wiring

91 genes in `founder-brain.js`: 84 tracts, all excitatory, and seven others. Each is written with `wire(from, to, { at, radius, weight, side, window })`: which region's axons go to which spot of which region.

| Purpose | Genes |
|---|---|
| Orienting by sight | 14: walk toward red (strongest), yellow, green, blue, pink and other creatures, each colour's cells to the walking muscle on their own side; away from violet (the other side). The same 7 for Attention at full strength: it works like the midbrain's orienting map, so whatever wins its competition turns the creature hard toward it (away from violet), on top of what it merely sees |
| Orienting by smell and hearing | 4: toward the side a smell or a call is stronger on; away from bitter and alarm |
| Innate priors | 18, each from one Drives cell to one muscle: pain and fear → run; sleepiness, tiredness and nausea → rest; loneliness → call; hunger and protein hunger → eat; thirst → drink; anger → grab; boredom, crowdedness, hunger and thirst → walk |
| Touch reflexes | 5: something at the mouth (either mouth cell, not the lips) → eat, water at the lips → drink, pain → run; a bump on one side makes the opposite leg push (2) |
| Into the thinking regions | 13: what is up close, tastes, sights, attention and smells (two each: Thinking and the Central lobe), drives (two), and what the muscles just did (Movement → Thinking), each side to its own side |
| Working memory | 2: the colours of food and water (red to blue, both heights, not violet) from Sight and from Attention start working memory on their own side of Thinking |
| Sight to Attention | 8: each sight cell feeds the attention cell of its side and feature (both heights feed the same cell) |
| Out to the muscles | 3: from Thinking and the Central lobe, broadly; and each Thinking cell pulls on the walk muscle on its own side |
| Value | 4 cue tracts from sight and smell onto the reward and punishment cells, which learn what each predicts; 1 from the alarm odour to a Feelings cell that raises fear; 6 broad, fast projections from Feelings (to Attention, Thinking, Side lobes, Central lobe, Movement and Brainstem), which set where learning happens |
| Attention | 6: a drive's cell biases the attention cells (both sides) toward what it needs |
| Others | A pacemaker that keeps the muscles restless; three Lobe dynamics genes and three Cell type genes (below) |

## A tick

`brain.tick(input, { noise, arousal, canFire, asleep })` runs once per sim tick and returns the number of spikes.

1. Every neuron adds up what arrived this tick (delayed spikes, its sense current, noise, its bias, the Lobe dynamics current, less adaptation) and fires at threshold. Arousal goes to every non-sensory neuron. A body out of blood sugar cannot fire.
2. Lobe dynamics resolve competition in the regions that have the gene.
3. The seizure brake: when more than a quarter of the brain has fired for 3 ticks running, every non-sensory neuron is held back 10 mV, from the next tick until the run ends.
4. New spikes leave along their axons.
5. Learning.

## Lobe dynamics

A Lobe dynamics gene (lobe, competition, persistence, tau, fatigue) makes the cells of one region work together. Each cell is held back in proportion to the others' recent firing. Cells that cross threshold in the same tick are resolved strongest first, each later one held back by those already firing. Each spike adds a self-sustaining current (up to 3 spikes' worth) that fades with tau. Fatigue slows recovery from adaptation. The founder uses it three times:

- **Movement**: weak competition, low persistence. The most strongly driven muscle wins and keeps going until it tires or a clearly stronger input takes over. `brain.decided()` is the winning muscle.
- **Attention**: strong competition, so it settles on one thing. Sight feeds it, and guidance genes from single Drives cells bias the features each drive cares about (hunger: red, yellow, green; thirst: blue; loneliness: creatures; sex drive: pink). Its orienting genes are at full strength, so what is attended pulls hardest. `brain.attended()` gives `{ side, band, feature }` or null: attention knows what and on which side, and the eyes say how high (`band` is whichever of the two sight cells for that side and feature fires more).
- **Thinking**: weak competition, strong persistence: working memory that outlasts what caused it. The colours of food and water on one side excite the cells of that side of Thinking, and those pull on that side's walk muscle, so a creature keeps heading where it saw food after it vanishes. The `memory:` reports in `tools/scenarios/learning.js` measure this, two against a knockout with no persistence and one against a control with no fruit.

## Learning

The first two Feelings cells are the modulators: reward (channel 0) and punishment (channel 1).

- **Outcome.** Each tick the creature sets `brain.outcome[c]` from the receptor effects on `limbic:0` and `limbic:1`, so which chemicals feel good or bad is up to receptor genes. Only a rise above the recent level counts: r = max(0, O − Ō), with Ō following O over 120 ticks.
- **Prediction.** Every synapse onto a modulator from another cell is a value synapse: it delivers no current and carries a prediction, V = Σ w·x (never below 0), where x is its recent input.
- **Error.** δ = r + 0.98·V − V_prev, clamped to ±1. It trains the value synapses by TD(λ), every tick. A positive δ makes the modulator cell fire (60 mV × δ), so the cell stays silent when nothing unexpected happens.
- **Eligibility.** When a neuron fires, each input that arrived in that tick or the 3 before becomes eligible: e ← e·λ^Δt + 1, capped at 2. λ comes from the Plasticity gene (a half-life of 14 to 140 ticks).
- **Weights.** Every 4 ticks each plastic weight moves by 0.25 × learning rate × e × the signal at its target, summed since the last update: joy × δ_R × F_R − stress × δ_P × F_P. Joy and stress come from the Reinforcement gene. These steps are soft-bounded, and a modulator's own outgoing synapses never learn.
- **Learning fields.** F is where a modulator's signal reaches: Gaussians around its axon terminals and the cell itself, as wide as the Neurochemistry gene says. So where learning happens depends on where those axons grew.

`brain.chemImages[0]` and `[1]` are 20 × 20 images of where the net signal is positive and where it is negative, for the brain view. `Evo.NEUROCHEMS` lists the two channels: DA (reward) and ST (punishment), which a Neurochemistry gene picks between.

## Sleep and dreams

`brain.sleepStep(instincts, chem)` runs before each sleeping tick. Now and then (1 tick in 150) a 40-tick dream starts:

- an **instinct** gene: its input cells are driven, then its muscle, then its chemical goes into the body, so the ordinary learning rule wires the association; or,
- half the time, when there are any, a remembered **episode**. Awake, each prediction error beyond ±0.2 stores the active senses, the busiest muscle, and the error's sign and size (8 at most, at least 20 ticks apart). Asleep, the replay drives those senses, then the muscle, then counts half the value as reward or punishment.

## Other hooks

`brain.inject(neuron, mV, delayTicks)` delivers an input after a delay (the inspector's Stimulate button and dreams use it).
