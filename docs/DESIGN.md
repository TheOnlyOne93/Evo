# SynapseCore design

SynapseCore is an artificial-life game inspired by *Creatures*. Where *Creatures* used hand-designed feed-forward lobes (attention, concept, decision), its creatures have a **recurrent spiking neural network** whose wiring, chemistry and body are all grown from a mutable genome.

**Bottom-up is the rule.** The simulation provides the physics: bodies, light, heat, scent, sound, diffusion, spikes, chemical reactions, and a body that burns blood sugar, loses water and is built from protein. Genes decide the rest: which chemicals react, what the body reports as a need, which needs the brain can feel, what is rewarding, how the brain is wired, and what a creature is born "knowing". The brain never reads a chemical by name: good and bad are whatever receptor genes wire to its reward and punishment cells.

## The systems

Each system has its own doc. Change the doc with the code it describes.

| System | Doc | Code |
|---|---|---|
| Ticks, the frame clock, the phases of a tick, how long things last | [TIME.md](TIME.md) | `src/core/clock.js`, `World.step` |
| The namespace, random numbers, events, diffusion | [CORE.md](CORE.md) | `src/core/` |
| DNA, the gene table, mutation, the founder genomes | [GENOME.md](GENOME.md) | `src/sim/genome.js`, `src/sim/founder*.js` |
| Chemicals, drives, reward and punishment | [BIOCHEMISTRY.md](BIOCHEMISTRY.md) | `src/sim/biochem.js`, `src/sim/constants.js` |
| The spiking brain: wiring, learning, dreams | [BRAIN.md](BRAIN.md) | `src/sim/brain.js` |
| The creature: its body (chemistry, energy, water, heat, growth, damage, sleep), senses and muscles | [CREATURE.md](CREATURE.md) | `src/sim/body.js`, `src/sim/senses.js`, `src/sim/muscles.js`, `src/sim/creature.js` |
| Land, food, scent, sound, ecology, the hand, events | [WORLD.md](WORLD.md) | `src/sim/landscape.js`, `src/sim/world.js` |
| Sound | [AUDIO.md](AUDIO.md) | `src/audio/` |
| Drawing: the creature pose, the world view, the brain map, the family tree | [RENDERING.md](RENDERING.md) | `src/render/` |
| The page: the main loop, the hand and tools, the inside view, layout, styles | [INTERFACE.md](INTERFACE.md) | `src/ui/`, `index.html`, `styles/` |
| Tests, the fingerprint, the behaviour bench and ecology tools, CI, lint | [TESTING.md](TESTING.md) | `tests/`, `tools/`, `.github/`, `eslint.config.js`, `.gitattributes`, `.editorconfig` |
| Opening the game and the lab pages in a browser | [BROWSER_CHECKS.md](BROWSER_CHECKS.md) | `tools/serve.js` |

## How the *Creatures* ideas map

| *Creatures* | SynapseCore |
|---|---|
| Biochemistry: 256 chemicals, reactions, emitters, receptors, half-lives | The same four gene kinds (plus initial concentrations), acting on 63 chemical slots |
| Drives are chemicals (hunger, pain, loneliness…) | Same. Emitter genes turn body states into drive chemicals; receptor genes let the brain feel each one in its own Drives cell |
| Stimulus genes: an event releases chemicals | Same: *stimulus* genes say what an event (being patted, slapped, nuzzled, shoved, falling asleep…) releases |
| Reward and punishment chemicals teach the brain | Same, but reward comes mostly from **drive-reduction reactions** at the moment of relief (`Hunger + sweet taste → Reward`), so eating only rewards a hungry creature. Punishment comes from acute harm (pain, nausea, fear, a bitter taste) |
| Lobes with fixed roles (attention, decision) | Spatial lobes of spiking neurons; roles emerge from genetic axon guidance, Lobe dynamics genes (competition, persistence) and learning from prediction errors |
| Instincts, processed while asleep | Instinct genes are replayed as **dreams**: the sleeping brain is driven with the gene's inputs and action, then its chemical, so the ordinary learning rule wires the association. It also replays surprising moments it lived through |
| Life stages; genes switch on at a stage | Every gene carries a switch-on stage (birth to senile). Sex hormones start at adolescence, ageing at old age, and new brain tracts can grow mid-life |
| The hand: tickle, slap, pick up | Pat and slap are *physical* stimuli (gentle touch, impact). Genes decide how they feel; the founder genome makes pats pleasant and slaps painful |
| Social life, calls, mating, eggs | Loneliness, crowding, fear and anger are drive chemicals; calls are sounds others hear left or right; mating leads to pregnancy and an egg that incubates and hatches |
| Side-view world with day, night and seasons | Same: gravity, terrain, two ponds, trees, a warm rock, day and night light and temperature, four seasons |
