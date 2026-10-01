# Creature

A creature's genes ([GENOME.md](GENOME.md)) build two working parts: a **body** (`src/sim/body.js`, `Evo.Body`: the chemistry and everything inside the skin) and a **brain** ([BRAIN.md](BRAIN.md)). Two files join them: the senses (`src/sim/senses.js`) carry everything into the brain, and the muscles (`src/sim/muscles.js`) carry everything out. `src/sim/creature.js` (`Evo.Creature`) is the shell around them all: its name and family, its life stages, where it is and how it moves, what its mouth can reach, and the order of each tick. Each tick it runs four phases, each for every creature before the next ([TIME.md](TIME.md)). The body reads the creature it belongs to (where it is, how hard its muscles work, how much its brain fired) but writes only its own state.

## What other code reads

| Field | Meaning |
|---|---|
| `id`, `name`, `sex`, `generation`, `motherId`, `fatherId` | Identity. `sex` is `'FEMALE'` or `'MALE'` |
| `genome`, `traits`, `body`, `brain` | Its parts ([GENOME.md](GENOME.md), the Body below, [BRAIN.md](BRAIN.md)) |
| `x`, `y`, `facing`, `vx`, `vy`, `onGround`, `inWater` | `x` is the centre, `y` the feet, `facing` ±1 |
| `size` | Body length in px: adult size × (0.42 + 0.58 × `body.growth`), so about 13–20 newborn and 30–48 grown |
| `stage`, `ageTicks`, `lifespan`, `isMature`, `fertile` | `stage` indexes `Evo.STAGES`; mature means adolescent or older; fertile means mature, not senile, awake, and a fertility effect over 1 |
| `held`, `dead`, `causeOfDeath`, `carrying` | State. `carrying` is an item in the mouth |
| `action` | `'idle'`, `'walking'`, `'running'`, `'jumping'`, `'eating'`, `'drinking'`, `'resting'`, `'calling'`, `'sleeping'` or `'held'` |
| `senses`, `lastStimulus`, `recentStimuli`, `mood`, `topDrives(n)`, `meals`, `timesMated` | Read-outs for the interface |
| `walkPhase`, `lying`, `mouthTimer`, `drinkTimer`, `callTimer`, `stimCount` | Read by the pose and the cues |

`creature.body` holds:

| Field | Meaning |
|---|---|
| `chem` | Its chemistry ([BIOCHEMISTRY.md](BIOCHEMISTRY.md)) |
| `health`, `injury`, `temperature`, `growth`, `strength` | 0–1, except strength (0.1–2) |
| `asleep`, `pregnancy` | State. `pregnancy` is the egg forming, with its `progress` |
| `stim`, `taste` | What the skin and tongue feel, fading each tick |
| `loci`, `damageLog`, `heatGain`, `heatLoss` | Its readings for genes, recent damage by cause, and heat flowing in and out |

Every number about the body is in one table, `Evo.BODY` in `src/sim/body.js`: running costs, water, heat, harm, what a sip holds, the protein a male spends mating, what a dead body leaves to eat (`body.remains()`), and the stores a creature starts with when it arrives grown.

`new Evo.Creature(genome, x, y, opts)` takes `opts` `{ generation, parents, reserves, ageTicks, growth, facing, syllables }`. Left out, `facing` (1 or -1) is chosen at random, and `syllables` (the two syllables of its name, such as `['el', 'ani']` for Elani) are made from its parents' syllables, or at random when it has none. `name` is the syllables joined and capitalised.

`creature.stimulate(key, strength)` raises a stimulus in its body's chemistry and notes it for the interface ([BIOCHEMISTRY.md](BIOCHEMISTRY.md)). `creature.step(world)` runs one creature through all four phases on its own, for tests; it also flushes every creature's queued writes.

## Body

1. It ages, and enters the next life stage when due: its traits are developed again, new genes join the chemistry and the brain, and a `stage` event is raised. A creature made past the baby stage (a founder, a wanderer) builds its brain from its birth genes, then grows it to its stage, with no event. The lifespan only times the stages. Nothing dies at that age: old age kills through chemistry.
2. `body.step` takes the body's readings, then the biochemistry steps.
3. Physiology follows the receptors. If health runs out, `body.step` returns the cause and the creature dies:

| | |
|---|---|
| Energy | Ready energy pays a basal rate (by body mass; 70% asleep), shivering, muscle work and every spike, and what is paid becomes spent energy. Genes charge it back from blood sugar ([BIOCHEMISTRY.md](BIOCHEMISTRY.md)). A brain out of ready energy cannot fire |
| Water | Lost steadily, faster in heat, with effort and when panting |
| Temperature | Heat is exchanged with the air through the fur (wet fur keeps little in), made by the body, by work and by shivering, shared by huddling, and shed by panting |
| Growth and healing | Growth hormone builds body protein into a bigger body; protein repairs injury |
| Damage | From receptors (toxin, ageing), starvation, dehydration, cold, heat and severe injury. Health recovers slowly while no receptor does damage, it is not starving and its protein is above 0.15. At zero it dies of whatever did the most damage lately |
| Scent | Sex musk and alarm scent, as receptors direct |
| Pregnancy | Each tick the mother moves a share of her reserves into the egg (`Evo.EGG_CONTENTS`, `Evo.eggShare`); at term she lays it once she is on the ground |

4. Sleep: it falls asleep when sleep pressure passes 2, or 1 while resting. It wakes when pressure drops under 0.25, on an impact or pain over 0.3, or at a call louder than 0.8 while pressure is under 1.

Causes of death: `poison`, `old age`, `illness`, `starvation`, `dehydration`, `cold`, `heat`, `injury`.

## How the body and the brain reach each other

| Body → brain (`src/sim/senses.js`) | Brain → body |
|---|---|
| Sight, smell, hearing, touch, taste, up close | Its muscle cells → actions (`src/sim/muscles.js`, Act below) |
| Needs and Feelings cells, through receptor genes | Every spike costs ready energy (`body.js`) |
| Reward and punishment it learns from | How fast each Feelings cell fires, which genes can read (`body.js` readings) |
| Arousal, noise from toxin, energy to fire, sleep (`senses.fromBody`) | Dreams: an instinct gene puts its chemical into the body (`Brain.sleepStep`) |

## Mind

`Evo.senses.sense(creature, world)` turns the settled world into one current per neuron (30 mV per unit of signal, times the optic or scent gain for sight and smell). Asleep, sight, smell, hearing, up close and most touch are dulled to 15%; pain, a touch on the back, taste, Drives and Feelings are not.

| Sense | What drives it |
|---|---|
| Sight | Every item, creature, thorn bush, fruiting tree and the nearest pond within vision range excites the feature cells for the side it is on, in the low band or (steeper than about 20° up) the high one. The signal is its apparent size, on a log scale, dimmed in the dark by night vision, and for things behind the creature (on the side it is not facing) by rear vision |
| Smell | Each odour at the two antenna tips, a nose's reach left and right of the head, on a log scale |
| Hearing | Others' calls, louder when near, by side and pitch |
| Touch | Contact left and right (a creature, a wall), an item at the mouth, water at the lips, the back, the feet, pain, gentle touch, falling, being in water |
| Taste | What it has just eaten or drunk. The six tastes are one table, `Evo.TASTES` in `src/sim/constants.js`: for each, the chemical in a food it reads, how strongly, the body reading emitter genes see, and whether it sits in the gut (the four that do add up to gut fullness) |
| Up close | The look of the thing at its mouth |
| Drives, Feelings | Whatever receptor genes attach to each cell |

Asleep, the brain dreams first. Then the brain ticks once, with what `Evo.senses.fromBody(creature)` passes on from the chemistry: noise rises with toxin, the arousal receptor target (adrenaline, in the founder) arouses it, and with no ready energy no cell fires.

**Novelty** (`Evo.senses.noticeNovelty`, read by the body for genes) comes from things. A creature keeps a familiarity for each vision feature. The thing at its mouth, or else the nearest loose item within 60 px of its feet, is novel in as far as its look is unfamiliar. Looking makes it familiar, and familiarity fades slowly. The Curiosity gene sets how fast a look becomes familiar and how strongly novelty registers.

## Act

`Evo.muscles.act(creature, world)`: the muscle cells that fired this tick act. A creature that is asleep or held does nothing. How hard they worked (`exertion`) goes back to the body as running costs and heat; food and water go in through `body.ingest`, a sip being `Evo.BODY.sip`.

| Muscle | What it does |
|---|---|
| Walk left, walk right | Spikes are smoothed into force and the stronger side wins. Speed follows walk speed, strength and growth, halved in water |
| Run | Multiplies speed by the run boost for 20 ticks |
| Jump | From the ground, at most every 30 ticks |
| Eat | The mouth works on what is there: food is eaten, another creature is nuzzled |
| Drink | A sip, with water at the lips |
| Grab | At most every 40 ticks: drops what it carries, or picks up the item at its mouth, or shoves the creature there |
| Rest | Rests (brakes, sleeps more easily) for 90 ticks per spike, lying down for the first 60. Ignored while walking; a firm walk or a jump ends it |
| Call | A call that others hear, at most every 40 ticks |

## Settle

The body moves under gravity. A ledge more than 10 px high blocks walking (a bump) until it jumps; platforms hold it from above only; a hard landing hurts; in water deeper than half its body it floats. A carried item follows the mouth point (`mouthX`, `mouthY`: a fixed point ahead of and above the body's centre; the view draws the item at the drawn mouth instead). Then passing sensations and tastes fade.
