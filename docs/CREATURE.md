# Creature

`src/sim/creature.js`: `Evo.Creature`, a genome, a biochemistry, a brain and a body in the side-view world. Each tick it runs four phases, each for every creature before the next ([TIME.md](TIME.md)).

## What other code reads

| Field | Meaning |
|---|---|
| `id`, `name`, `sex`, `generation`, `motherId`, `fatherId` | Identity. `sex` is `'FEMALE'` or `'MALE'` |
| `genome`, `traits`, `chem`, `brain` | Its parts ([GENOME.md](GENOME.md), [BIOCHEMISTRY.md](BIOCHEMISTRY.md), [BRAIN.md](BRAIN.md)) |
| `x`, `y`, `facing`, `vx`, `vy`, `onGround`, `inWater` | `x` is the centre, `y` the feet, `facing` ±1 |
| `size`, `growth` | Body length in px: adult size × (0.42 + 0.58 × growth), so about 13–20 newborn and 30–48 grown |
| `stage`, `ageTicks`, `lifespan`, `isMature`, `fertile` | `stage` indexes `Evo.STAGES`; mature means adolescent or older; fertile means mature, not senile, awake, and a fertility effect over 1 |
| `health`, `injury`, `bodyTemp`, `strength` | 0–1, except strength (0.1–2) |
| `asleep`, `held`, `dead`, `causeOfDeath`, `carrying`, `pregnancy` | State. `carrying` is an item in the mouth |
| `action` | `'idle'`, `'walking'`, `'running'`, `'jumping'`, `'eating'`, `'drinking'`, `'resting'`, `'calling'`, `'sleeping'` or `'held'` |
| `senses`, `lastStimulus`, `recentStimuli`, `mood`, `topDrives(n)`, `meals`, `timesMated` | Read-outs for the interface |
| `walkPhase`, `lying`, `mouthTimer`, `drinkTimer`, `callTimer`, `stim`, `stimCount` | Read by the pose and the cues |

`new Evo.Creature(genome, x, y, opts)` takes `opts` `{ generation, parents, reserves, ageTicks, growth, facing, syllables }`. Left out, `facing` (1 or -1) is chosen at random, and `syllables` (the two syllables of its name, such as `['el', 'ani']` for Elani) are made from its parents' syllables, or at random when it has none. `name` is the syllables joined and capitalised.

`creature.stimulate(key, strength)` raises a stimulus ([BIOCHEMISTRY.md](BIOCHEMISTRY.md)). `creature.step(world)` runs one creature through all four phases on its own, for tests; it also flushes every creature's queued writes.

## Body

1. It ages, and enters the next life stage when due: its traits are developed again, new genes join the chemistry and the brain, and a `stage` event is raised. A creature made past the baby stage (a founder, a wanderer) builds its brain from its birth genes, then grows it to its stage, with no event. The lifespan only times the stages. Nothing dies at that age: old age kills through chemistry.
2. The body loci are read, then the biochemistry steps.
3. Physiology follows the receptors:

| | |
|---|---|
| Energy | Blood sugar pays a basal rate (by body mass; 70% asleep), shivering, muscle work and every spike. A brain out of sugar cannot fire |
| Water | Lost steadily, faster in heat, with effort and when panting |
| Temperature | Heat is exchanged with the air through the fur (wet fur keeps little in), made by the body, by work and by shivering, shared by huddling, and shed by panting |
| Growth and healing | Growth hormone builds body protein into a bigger body; protein repairs injury |
| Damage | From receptors (toxin, ageing), starvation, dehydration, cold, heat and severe injury. Health recovers slowly while no receptor does damage, it is not starving and its protein is above 0.15. At zero it dies of whatever did the most damage lately |
| Scent | Sex musk and alarm scent, as receptors direct |
| Pregnancy | Each tick the mother moves a share of her reserves into the egg (`Evo.EGG_CONTENTS`, `Evo.eggShare`); at term she lays it once she is on the ground |

4. Sleep: it falls asleep when sleep pressure passes 2, or 1 while resting. It wakes when pressure drops under 0.25, on an impact or pain over 0.3, or at a call louder than 0.8 while pressure is under 1.

Causes of death: `poison`, `old age`, `illness`, `starvation`, `dehydration`, `cold`, `heat`, `injury`.

## Mind

The senses turn the settled world into one current per neuron (30 mV per unit of signal, times the optic or scent gain for sight and smell). Asleep, sight, smell, hearing, up close and most touch are dulled to 15%; pain, a touch on the back, taste, Drives and Feelings are not.

| Sense | What drives it |
|---|---|
| Sight | Every item, creature, thorn bush, fruiting tree and the nearest pond within vision range excites the feature cells for the side it is on, in the low band or (steeper than about 20° up) the high one. The signal is its apparent size, on a log scale, dimmed in the dark by night vision |
| Smell | Each odour at the two antenna tips, a nose's reach left and right of the head, on a log scale |
| Hearing | Others' calls, louder when near, by side and pitch |
| Touch | Contact left and right (a creature, a wall), an item at the mouth, water at the lips, the back, the feet, pain, gentle touch, falling, being in water |
| Taste | What it has just eaten or drunk |
| Up close | The look of the thing at its mouth |
| Drives, Feelings | Whatever receptor genes attach to each cell |

Asleep, the brain dreams first. Then the brain ticks once. Noise rises with toxin, and the arousal receptor target (adrenaline, in the founder) arouses it.

**Novelty** comes from things. A creature keeps a familiarity for each vision feature. The thing at its mouth, or else the nearest loose item within 60 px of its feet, is novel in as far as its look is unfamiliar. Looking makes it familiar, and familiarity fades slowly. The Curiosity gene sets how fast a look becomes familiar and how strongly novelty registers.

## Act

The muscle cells that fired this tick act. A creature that is asleep or held does nothing.

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

The body moves under gravity. A ledge more than 10 px high blocks walking (a bump) until it jumps; platforms hold it from above only; a hard landing hurts; in water deeper than half its body it floats. A carried item follows the mouth. Then passing sensations and tastes fade.
