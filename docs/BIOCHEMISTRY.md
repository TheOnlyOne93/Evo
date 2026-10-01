# Biochemistry

`src/sim/biochem.js` runs the chemistry. The chemicals, body loci, receptor targets and stimuli are tables in `src/sim/constants.js`. The founder's chemistry genes are in `src/sim/founder-chem.js`.

## Chemicals

There are 64 slots (`Evo.N_CHEM`), each a concentration from 0 to 1. Slot 0 means "nothing". `Evo.CHEMICALS` names 51 of the other 63, and 12 are free for mutation to use. A named chemical has a kind: nutrient, energy, hormone, drive, relief, reinforcer or other.

The body's fixed physiology reads a few of them by name: it pays for everything it does in ready energy and gets back spent energy, it loses water, it grows and heals with protein, toxin adds noise to the brain, and pain wakes a sleeper ([CREATURE.md](CREATURE.md)). Everything else about a chemical is up to genes.

## The genes that act on them

| Gene | What it does |
|---|---|
| Reaction | `A + B → C + D` by mass action, at a rate of 10⁻⁶ to 0.1 per tick, with a yield each for C and D. B, C and D may be nothing. A chemical on both sides is a catalyst |
| Emitter | Reads a locus (a body reading, or any chemical) and releases a chemical in proportion to how far the reading is past a threshold. Flags: inverted (below the threshold), all or nothing |
| Receptor | Reads a chemical the same way and pushes on a target. A third flag lowers the target instead of raising it |
| Stimulus | When an event happens to the creature, releases or removes up to two chemicals |
| Half-life | A chemical's half-life: 1 tick to about 16 minutes, or never. A chemical with no such gene does not decay |
| Initial concentration | A chemical's level at birth, or when the gene switches on. Reserves given to a creature (an egg's contents, an arriving adult's) override it |

Each body phase, `chem.step(loci)` runs the emitters, then the reactions, then decay (levels are kept in 0 to 1), then the receptors, whose summed output per target is `chem.effect(target)`. `chem.get`, `set` and `add` take a chemical's key; a name that is not a chemical (a misspelling) throws an error instead of quietly reading nothing.

| Table | Members |
|---|---|
| `Evo.BODY_LOCI`: what an emitter can read | always, body temperature, heat gain, heat loss, darkness, exertion, awake, asleep, resting, injury, health, impact, gentle touch, touching a friend, company, crowding, novelty, falling, in water, held, six tastes (the table `Evo.TASTES` makes their names), gut fullness, mated, pregnant, heard a call, growth, starving, and the firing rate of each Feelings cell |
| `Evo.TARGETS`: what a receptor can push on | muscle strength, arousal, sleep pressure, damage, healing, fertility, growth, sex scent, alarm scent, metabolic rate, thermogenesis (shivering), cooling (panting), and one Drives cell (`need:k`) or Feelings cell (`limbic:k`) |
| `Evo.STIMULI`: events | ate, drank, patted, slapped, nuzzled, was nuzzled, shoved, was shoved, called, heard a call, grabbed, dropped, bumped, fell, woke, fell asleep, mated, played, pricked by thorns |

A `need:k` or `limbic:k` receptor puts a current into its cell, except `limbic:0` and `limbic:1`: those are the reward and punishment the brain learns from ([BRAIN.md](BRAIN.md)). The world raises each stimulus where it physically happens: `creature.stimulate(key, strength)`.

## The founder's chemistry

**Metabolism.** Gut sugar and starch become blood sugar, gut protein becomes body protein, gut fat the fat store. Insulin stores surplus blood sugar as glycogen and fat; glucagon releases them again and slowly wastes body protein. Blood sugar charges spent energy back into ready energy (using up 1 part in 20 of what it makes), more slowly than hard work spends it, so a creature that runs for long tires and weakens; the body and brain always hold the same total of ready and spent energy, as a cell holds ATP and ADP. Spent energy leaves a little adenosine behind, which builds all day, faster with effort and thought, and only sleep clears it. The liver clears toxin. Growth hormone builds the body until it is full-grown; protein heals injury.

**Drives** are chemicals (`Evo.DRIVES`). Emitters raise each one from a body state, and a receptor gene lets the brain feel each in its own Drives cell (`Evo.driveCell(key)`). Eleven have a *relief* chemical, released by the sense or act that satisfies the drive, and a reaction `Drive + Relief → Reward` that turns relief into reward in proportion to how much drive there was, at the moment of relief.

| Drive | Raised by | Relief that rewards |
|---|---|---|
| hunger | Low blood sugar or glycogen | Sweet taste: tasting sugar or starch |
| protein hunger, fat hunger | Low body protein, low fat store | Savoury taste: tasting protein or fat |
| thirst | Low water | The taste of water |
| tiredness | Adenosine, left behind as ready energy is spent: by effort, thinking and time awake | Resting |
| sleepiness | Melatonin (darkness), high adenosine | Dozing off: once, not all night |
| coldness, hotness | Body temperature | Heat flowing in, heat flowing out |
| loneliness | Too little company | Company: touching a friend, a gentle touch, a call heard |
| boredom | Nothing novel | Novelty: an unfamiliar thing, play |
| sex drive | Sex hormone, from adolescence | Mating |
| pain | An impact, injury, a bump, thorns | None. Endorphin, from a gentle touch, removes it |
| fear | An impact, falling, being held, alarm scent, a slap, a shove, thorns | None. Company calms it |
| crowdedness, anger | Crowding; crowdedness, being shoved | None |
| nausea | Toxin, an over-full gut, a lot of bitter taste | None |

Eating only rewards a hungry creature, and only while the food is tasted: a full gut still sates hunger, quietly, without reward. Reward also comes straight from a pat, and slowly from endorphin.

**Punishment** is released by emitters reading pain, nausea, fear and a bitter taste, and by the *slapped* stimulus.

**Stimulus genes** (for 9 of the 19 events). A pat releases reward and company; a slap, punishment and fear; a nuzzle, company for both; being shoved, anger and fear; play, novelty; a bump, a little pain; thorns, pain and fear; falling asleep, the dozing-off relief.

**Receptors on the body.** Low ready energy, or tiredness, weakens the muscles; adrenaline strengthens them and arouses the brain. Sleepiness and tiredness build sleep pressure; adrenaline and pain lower it. Toxin damages. Coldness makes it shiver, hotness pant. Fear releases alarm scent.

**Later stages.** From adolescence, fat stores raise sex hormone, which brings sex drive, fertility and sex scent. From old age an ageing chemical builds up (faster once senile), never decays, and in time damages health: this is what old age dies of, a little before the lifespan is up.

**Instincts** are dreamt ([BRAIN.md](BRAIN.md)): eat food colours when hungry, drink when thirsty, nuzzle when lonely, rest when sleepy or tired, call when lonely, run from pain and fear, keep away from violet and from alarm scent.
