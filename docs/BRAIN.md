# Brain

`src/sim/brain.js`: `Evo.Brain`, a recurrent spiking network grown from the genome. The founder's wiring genes are in `src/sim/founder-brain.js`.

Nothing is hand-wired to "do" attention or decisions. Those roles come from guidance genes, Lobe dynamics genes and learning from whatever the genes make rewarding.

## Neurons

Leaky integrate-and-fire cells with a refractory period, adaptation, and a threshold that drifts to hold each cell near a target firing rate. State lives in typed arrays, one entry per neuron. `brain.neurons[i]` describes neuron i (lobe, position, receptor tag, meta) for the interface.

Coordinates: x runs from the creature's left (0) to its right (1) **in the world** (the side view has two hemifields: things to the left, things to the right). y runs from the front (senses, 0) to the back (muscles, 1). Each neuron also has a tag, a chemical address `[x, y, z]` that guidance genes aim at.

| Lobe | Cells |
|---|---|
| Sight | 32: 2 sides × 2 heights (low, high) × 8 features (red, yellow, green, blue, violet, pink, creature, motion) |
| Smell | 20: 2 antennae × 10 odours |
| Hearing | 4: 2 ears × 2 pitches |
| Touch | 11: contact left and right, mouth left and right, lips (water), back, feet, pain, gentle touch, falling, in water |
| Taste | 6: sweet, starchy, savoury, fatty, bitter, water |
| Up close | 8: one per vision feature, the look of whatever is at the mouth |
| Drives | 18 (`N_DRIVE_CELLS`): the founder feels drive k in cell k (`Evo.driveCell`); 2 are spare |
| Feelings | 8: the reward cell, the punishment cell and 6 general cells |
| Thinking, Side lobes, Central lobe, Brainstem | 30, 24, 20 and 16 general-purpose cells (Anatomy genes change the counts) |
| Movement | 9: walk left, walk right, jump, eat, grab or drop, rest, call, run, drink |

The founder's brain has 247 neurons, counting its two region copies, and about 1,660 synapses at birth. `Evo.LIMITS` caps a brain at 512 neurons and 3,200 synapses, of which the genome may grow 2,400 before birth.

`Evo.BRAIN_BODY_PLAN` defines the sensory layouts once: `sightIndex(side, band, feature)`, `smellIndex(side, odour)` and `hearingIndex(side, pitch)` give a cell's place in its lobe, and `sightCell(k)` and `smellCell(k)` decode it.

## Wiring

- **Axon guidance.** Each gene sends the axons of one region, and of its copies, toward a receptor chemistry. The target is fixed, or relative to each source cell's own tag (a topographic map, mirrored for a crossed one), and a source window can limit the gene to a few cells. A good match within reach almost always connects. Axons never target sensory cells. Candidates from all genes compete for the innate budget. A gene that switches on later grows its tract then.
- **Region duplication** copies a region. Each original cell feeds its copy, and the copy inherits its parent's guidance genes. A copy that would take the brain past 512 neurons is skipped.
- **Background wiring** at birth: sparse, weak, random links between neighbours.
- **Pacemaker** genes give a region a steady current.
- **Delay.** A spike arrives 1 to 20 ticks after it is fired, by the axon's length and its conduction speed.
- **Morphogenesis**, every 80 ticks. An active cell may sprout one weak synapse to a depolarised neighbour. A sprout that stays weak is pruned; innate tracts are never pruned. Synaptic scaling turns a cell's excitatory inputs down when it fires far too much, and up when it has fallen silent.

A synapse keeps the sign it was born with (Dale's law). Weights run from −1.8 to 2.0.

### The founder's wiring

65 genes in `founder-brain.js`: 59 tracts, all excitatory, and six others.

| Purpose | Genes |
|---|---|
| Orienting by sight | 7: walk toward red (strongest), yellow, green, blue, pink and other creatures; walk away from violet |
| Orienting by smell and hearing | 4: toward the side a smell or a call is stronger on; away from bitter and alarm |
| Innate priors | 18, each from one Drives cell to one muscle: pain and fear → run; sleepiness, tiredness and nausea → rest; loneliness → call; hunger and protein hunger → eat; thirst → drink; anger → grab; boredom, crowdedness, hunger and thirst → walk |
| Touch reflexes | 2: a touch cell excites the muscle that shares its address (mouth → eat, lips → drink, pain → run); a bump makes the opposite leg push |
| Into the thinking regions | 7: what is up close, tastes, drives, sights (two of them side by side, for working memory) and smells |
| Out to the muscles | 3: from Thinking and the Central lobe |
| Value | 4 cue tracts from sight and smell onto the reward and punishment cells, which learn what each predicts; 1 from the alarm odour to a Feelings cell that raises fear; 1 broad, fast projection from Feelings, which sets where learning happens |
| Attention | 12: a drive's cell biases the sight copy toward what it needs |
| Others | A pacemaker that keeps the muscles restless; copies of Movement and of Sight; three Lobe dynamics genes (below) |

## A tick

`brain.tick(input, { noise, arousal, canFire, asleep })` runs once per sim tick and returns the number of spikes.

1. Every neuron adds up what arrived this tick (delayed spikes, its sense current, noise, its bias, the Lobe dynamics current, less adaptation) and fires at threshold. Arousal goes to every non-sensory neuron. A body out of blood sugar cannot fire.
2. Lobe dynamics resolve competition in the regions that have the gene.
3. The seizure brake: when more than a quarter of the brain has fired for 3 ticks running, every non-sensory neuron is held back 10 mV, from the next tick until the run ends.
4. New spikes leave along their axons.
5. Learning.

## Lobe dynamics

A Lobe dynamics gene (lobe, which copy, competition, persistence, tau, fatigue) makes the cells of one region work together. Each cell is held back in proportion to the others' recent firing. Cells that cross threshold in the same tick are resolved strongest first, each later one held back by those already firing. Each spike adds a self-sustaining current (up to 3 spikes' worth) that fades with tau. Fatigue slows recovery from adaptation. The founder uses it three times:

- **Movement**: weak competition, low persistence. The most strongly driven muscle wins and keeps going until it tires or a clearly stronger input takes over. `brain.decided()` is the winning muscle.
- **The sight copy**: strong competition, so it settles on one thing. Guidance genes from single Drives cells bias the features each drive cares about (hunger: red, yellow, green; thirst: blue; loneliness: creatures; sex drive: pink). The copy inherits the sight lobe's approach tracts, so what is attended pulls hardest. `brain.attended()` gives `{ side, band, feature }` or null.
- **Thinking**: weak competition, strong persistence: working memory that outlasts what caused it. The colours of food and water on one side excite cells tagged for that side, Thinking cells above all, and those pull on that side's walk muscle, so a creature keeps heading where it saw food after it vanishes. The `memory:` reports in `tools/scenarios/learning.js` measure this, two against a knockout with no persistence and one against a control with no fruit.

## Learning

The first two Feelings cells are the modulators: reward (channel 0) and punishment (channel 1).

- **Outcome.** Each tick the creature sets `brain.outcome[c]` from the receptor effects on `limbic:0` and `limbic:1`, so which chemicals feel good or bad is up to receptor genes. Only a rise above the recent level counts: r = max(0, O − Ō), with Ō following O over 120 ticks.
- **Prediction.** Every synapse onto a modulator from another cell is a value synapse: it delivers no current and carries a prediction, V = Σ w·x (never below 0), where x is its recent input.
- **Error.** δ = r + 0.98·V − V_prev, clamped to ±1. It trains the value synapses by TD(λ), every tick. A positive δ makes the modulator cell fire (60 mV × δ), so the cell stays silent when nothing unexpected happens.
- **Eligibility.** When a neuron fires, each input that arrived in that tick or the 3 before becomes eligible: e ← e·λ^Δt + 1, capped at 2. λ comes from the Plasticity gene (a half-life of 14 to 140 ticks).
- **Weights.** Every 4 ticks each plastic weight moves by 0.25 × learning rate × e × the signal at its target, summed since the last update: joy × δ_R × F_R − stress × δ_P × F_P. Joy and stress come from the Reinforcement gene. These steps are soft-bounded, and a modulator's own outgoing synapses never learn.
- **Learning fields.** F is where a modulator's signal reaches: Gaussians around its axon terminals and the cell itself, as wide as the Neurochemistry gene says. So where learning happens depends on where those axons grew.

`brain.chemImages[0]` and `[1]` are 20 × 20 images of where the net signal is positive and where it is negative, for the brain view. `Evo.NEUROCHEMS` lists the channels: DA (reward), ST (punishment) and the retired NO, which a Neurochemistry gene can still pick, to no effect.

## Sleep and dreams

`brain.sleepStep(instincts, chem)` runs before each sleeping tick. Now and then (1 tick in 150) a 40-tick dream starts:

- an **instinct** gene: its input cells are driven, then its muscle, then its chemical goes into the body, so the ordinary learning rule wires the association; or,
- half the time, when there are any, a remembered **episode**. Awake, each prediction error beyond ±0.2 stores the active senses, the busiest muscle, and the error's sign and size (8 at most, at least 20 ticks apart). Asleep, the replay drives those senses, then the muscle, then counts half the value as reward or punishment.

## Other hooks

`brain.inject(neuron, mV, delayTicks)` delivers an input after a delay (the inspector's Stimulate button and dreams use it).

## Cost

About 10 µs of brain and 4–6 µs of senses per creature-tick, and 0.05–0.06 ms per tick of a default two-founder world (headless, wanderers off, on the owner’s PC, September 2026). `node tools/behave.js 12 cost --report` measures it; the means fall with more trials as the JIT warms up.
