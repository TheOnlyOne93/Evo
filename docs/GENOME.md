# Genome

`src/sim/genome.js` holds the DNA format, the gene table, mutation and development. The founders' genomes are in `src/sim/founder.js`, `founder-brain.js` and `founder-chem.js`.

## DNA

A genome is a byte string (`genome.dna`), at most 8192 bytes. A gene is expressed only where a promoter byte (`0xA5`) sits in front of it:

```
A5  HH  payload…
type  = HH % 32    low 5 bits: the row of Evo.GENES (26 are in use; the other 6 are silent)
stage = HH >> 5    high 3 bits: the life stage at which the gene switches on (0 and 1: from birth)
```

Everything else is silent junk DNA that mutation can turn into new genes. A gene cut off by the end of the DNA is not expressed, and genes never overlap. Every decoded value is clamped, so a broken gene makes a bad creature, never a broken simulation. Sex is carried apart from the DNA, in `genome.sexChrom` (`'X'` female, `'Y'` male; `Evo.chromFor(sex)` gives the one for `'FEMALE'` or `'MALE'`).

## Genes

Each row of `Evo.GENES` decodes its payload bytes (`fields`, one codec per byte), expresses traits (`express`), and names the group the Genes tab lists it under. `src/ui/text.js` puts each gene in plain words.

| Group | Gene | What it sets |
|---|---|---|
| body | Appearance | Hue, accent hue, pattern (plain, stripes, spots, patches) and its scale, ear size, tail length, eye size, plumpness |
| | Morphology | Adult size (30–46 px; females 2 px more), leg length, mouth reach, crest |
| | Eyes, Nose | Vision range (180–460 px), gain, night vision; smell reach (14–44 px), gain |
| | Muscle | Walk speed, jump power, run boost |
| | Life history | Lifespan (20–44 minutes), gestation (3000–9000 ticks) |
| | Voice | Pitch, loudness |
| | Insulation | Fur, body heat |
| | Reproduction | How full a mother fills an egg; how long an egg of this genome incubates (3000–9000 ticks) |
| brain | Membrane | Firing threshold; leak and refractory period of the interior neurons |
| | Plasticity | Learning rate, eligibility half-life (14–140 ticks), sprouting threshold, pruning |
| | Reinforcement | Sensitivity to reward and to punishment |
| | Curiosity | How fast a look becomes familiar, how strongly novelty registers |
| | Anatomy | A region's position, width, depth and cell count |
| | Region duplication | A copy of a region |
| | Axon guidance | A tract: the source region (and a window on it), the receptor chemistry sought, sign and strength, reach, conduction speed |
| | Pacemaker | A steady current into a region |
| | Neurochemistry | How far a modulator's learning signal spreads |
| | Lobe dynamics | Competition and persistence within a region or one of its copies |
| chemistry | Reaction, Emitter, Receptor, Half-life, Initial concentration, Stimulus | See [BIOCHEMISTRY.md](BIOCHEMISTRY.md) |
| instinct | Instinct | Two input cells, a muscle, and a chemical with an amount: replayed in dreams ([BRAIN.md](BRAIN.md)) |

Several copies of a trait gene average their values. Genes that add to a list (tracts, reactions, emitters, instincts…) each add an entry. For Half-life the last copy wins, and for Lobe dynamics the last one for each region.

## Development

`genome.develop(stage)` builds the traits for a life stage: fallback values for any trait whose gene is missing, then every gene whose switch-on stage has been reached. A creature develops again on entering each stage. The genes that switch on then join its biochemistry (a new Initial concentration gene sets its chemical once), new tracts and pacemakers grow in the brain, and a later Life history gene joins the average that sets the lifespan. Stages only move forward.

## Mutation and recombination

Both work on raw bytes.

- `genome.cloneWithMutation()`: each byte mutates with a chance of 0.4% (mostly a small step, else a new byte). Then there is a 3% chance that a whole gene is copied to a random place, 2% that one is lost, and 2% of a one-byte insertion or deletion (a frameshift when it lands in a gene). Losses and deletions stop once the DNA is down to 256 bytes.
- `Genome.recombine(mother, father)`: one parent is the backbone and the other donates the bytes between two random crossover points. The child's sex is drawn at even odds, and it then mutates.
- `genome.mutationCount` counts mutation events along the longer parental line since the first female and male.

## The founder genomes

The first female and the first male are written by hand and are the same every time: no dice are rolled for them. `Evo.FOUNDER_GENOMES` holds one list of 266 readable gene specs for each sex (`FEMALE` and `MALE`), and `Evo.Genome.founder(sex)` encodes one to bytes (about 3 KB). The two lists hold the same genes in the same order; only the looks and voice differ. They are ordinary genes: they mutate, duplicate, recombine and can be lost, and nothing in the simulation treats them specially.

`Evo.FOUNDERS` holds what sets the two apart: each one's looks (the Appearance gene), voice (the Voice gene) and the syllables of its name (Elani, Fenro; the game does not use them yet). Both coats are sea green, near 160 degrees, the colour other creatures' food-colour cells notice least. Her voice is high and his is low, so each can hear which of the two is calling.

The bytes between genes are filler: four at the start and three after each gene. A filler byte is a fixed pattern of its position in the DNA (`Evo.util.hash2`), never the promoter byte, so a founder is the same on every call, never uses `Evo.random`, and the two founders' DNA line up byte for byte (only the looks and voice bytes differ). The filler is silent until a mutation turns some of it into a gene.

| File | What it holds |
|---|---|
| `founder.js` | `Evo.founderKit`, the helpers that write specs (`reaction`, `emitter`, `receptor`, `stimulus`, `halfLife`, `initial`, `guide`, `approach`, `prior`, `instinct`), `Evo.FOUNDERS`, and `Evo.founderBody(sex)`: one each of the 13 trait genes, with that sex's looks and voice |
| `founder-brain.js` | 65 wiring genes: 59 tracts, a pacemaker, two region duplications, three Lobe dynamics genes ([BRAIN.md](BRAIN.md)) |
| `founder-chem.js` | 188 genes: metabolism, drives, relief, stimuli, reinforcement, receptors, adolescence, old age, and 15 instincts ([BIOCHEMISTRY.md](BIOCHEMISTRY.md)); it also puts the three lists together into `Evo.FOUNDER_GENOMES` |

The founder has no Anatomy or Neurochemistry gene. All its genes are on from birth except four for adolescence and two for old age.
