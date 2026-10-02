# World

`src/sim/world.js`: `Evo.World`, the side-view world: terrain, ponds, plants that grow food, day and night, seasons, temperature, scent, sound and the creatures. Its landscape comes from `src/sim/landscape.js` (see Land, light and weather). It never touches the page. It announces what happens on `world.events`, and renderers read it through the contract below without changing it. The shared tables (items, scents, seasons, limits) are in `src/sim/constants.js`.

## The contract

y grows downward. All lengths are world pixels.

```js
world.width, world.height            // from the map (the game's: 2960 × 900)
world.terrain = {
  spacing,                           // px between height samples
  cliffs: { width, rise },           // the cliff at each end: it reaches width px in and raises the land by up to rise px
  heights,                           // Float32Array: ground surface y at x = i * spacing
  groundY(x), slopeAt(x),            // interpolated surface y; its slope
  ponds: [{ x0, x1, level, bed }],   // water surface y over [x0, x1]; bed: the deepest ground y under it
  waterLevelAt(x)                    // pond surface y at x, or null
}
world.platforms = [{ x0, x1, y, kind, featureId }]  // one-way surfaces: the walkable top of every 'log' and 'rock'
                                                    // whose id is featureId (the feature draws it)
world.features  = [{ id, kind, x, y, ...props }]    // y = base on the ground
  //  'tree'      { height, canopy, species: 'fruit' | 'mimic', yields: item type, fruiting: 0..1 }
  //  'grass'     { width, height, seeding: 0..1 }       grain, dew and bugs appear here
  //  'log'       { length }                             grubs live here
  //  'rock'      { width, height, warm: 0..1 }          the sun-warmed rock
  //  'reeds'     { width }
  //  'thornbush' { radius }                             looks violet; moving through it pricks
world.items = [{ id, type, x, y, vx, vy, radius, rot, ageTicks, heldBy, onGround, ... }]
  //  type: 'fruit' | 'grain' | 'grub' | 'bug' | 'mimic' | 'dew' | 'lure' | 'carrion' | 'egg' | 'ball'
  //  heldBy: null, 'hand', or the id of the creature carrying it
  //  egg: { hue, accentHue, progress: 0..1 (it may pass 1 while the egg waits for room to hatch),
  //         genome, reserves, parents, generation, incubationTicks }
  //  ball: { hue }   carrion: { hue, contents }   grub: { home }
world.creatures                      // the living (see CREATURE.md)
world.history                        // everyone who has lived here:
  //  { id, name, sex, generation, born, died, cause, motherId, fatherId }   (born, died: clock ticks; born is the arrival for a founder or wanderer)
world.clock = { tick, day, phase, light, sunElevation }
  //  phase 0..1 (0 midnight, .25 sunrise, .5 noon, .75 sunset); light 0.08..1; sunElevation -1..1
world.season = { key, index, progress }   // key: 'SPRING' | 'SUMMER' | 'AUTUMN' | 'WINTER'
world.temperatureAt(x, y)            // 0..1 (0 freezing, 0.5 mild, 1 hot)
world.scent = { cols, rows, cell, channels }   // one Float32Array per channel of Evo.SCENTS
world.scentSolid                     // Uint8Array, one per scent cell (like a channel): 1 where the cell is solid ground
world.sampleScent(x, y, channel)     // a nose's reading: bilinear over the air cells only (Scent and sound)
world.sounds = [{ x, y, pitch, loudness, ageTicks, sourceId }]   // calls, kept Evo.WORLD.SOUND_LIFE_TICKS
world.nearestWater(x, range)         // { x, y }: the nearest pond surface within range of x, or null
world.surfaceBelow(x, fromY)         // the highest surface (ground or platform) at or below fromY at x
world.lookOf(item), lookOfCreature(c), lookOfFeature(f)     // what an eye sees: vision features
  //  lookOfFeature: { x, y, radius, features } for a thorn bush or a tree fruiting over 0.2, else null
world.stats, world.seedBank, world.hand = { holding }
world.events                         // an Evo.EventBus (below)
world.setTime(day, phase)            // jump the clock (the world lab, tests, the season skip)
```

Constants renderers share with the simulation: `Evo.WORLD.HOLD_GRIP` (a creature in the hand hangs with its feet `HOLD_GRIP × size` below it), `Evo.WORLD.SOUND_LIFE_TICKS`, `Evo.muscles.CALL_TICKS`, `Evo.muscles.MOUTH_TICKS` (the creature lab's eating creature bites at the game's pace) and `Evo.CREATURE.WALK_PHASE_PER_PX` (walk-cycle radians per px walked).

## Land, light and weather

The ground is a height field with ponds and a cliff at each end: the land rises by up to `terrain.cliffs.rise` px over the last `cliffs.width` px. Creatures and items stay `world.edge` px from the ends (at least `cliffs.width`), so they never reach the cliffs; the cliff art is drawn from `terrain.cliffs` too ([RENDERING.md](RENDERING.md)). A pond is a dip that fills with water up to 6 px below its lower rim; its record says where the water is (`x0`, `x1`), its surface (`level`) and the deepest ground under it (`bed`).

The landscape is data in `src/sim/landscape.js`. `Evo.MAPS` holds the maps by name, and `Evo.buildLandscape(map)` takes a name or a map object and returns `{ width, height, edge, terrain, features, platforms, ballX, founderX }`; `new Evo.World({ map })` uses it, the game's map by default (`Evo.DEFAULT_MAP`, `valley`). `founderX` is where the first female and the first male stand (`{ FEMALE, MALE }`), and `ballX` is where the ball starts. `Evo.FEATURE_KINDS` says what each kind of feature is to the landscape: its half-width (`extent`) and, for rocks and logs, the platform on top (`platform`). `buildLandscape` makes a platform for every feature whose kind has one.

A map is a spec, built by one shared function with nothing random in it. `valley` is the game's, 2960 px wide, with the ground level at y 640 and three ponds dug into it: `ponds[0]` the lake, `ponds[1]` the east pool and `ponds[2]` the spring. Left to right (a pond's x is its rims; the water is inside them):

| x | What |
|---|---|
| 175 | Where the ball starts |
| 275 and 345 | Where the first female (275) and male (345) stand, on level ground in the home meadow, clear of the spring |
| 310 | The home meadow (grass) |
| 440–680 | The spring (`ponds[2]`): 28 px deep, its water 476–644, with reeds at 456 and 664. The home water |
| 800 | The fruit tree |
| 990 | The warm rock: a platform 35 px above the ground |
| 1265 | The log: a platform 24 px up |
| 1601–2121 | The lake (`ponds[0]`): 45 px deep, its water 1645–2077, with reeds at 1625 and 2097 |
| 2250 | The east meadow |
| 2460 | The mimic tree |
| 2530–2770 | The east pool (`ponds[1]`): 28 px deep, its water 2566–2734, with reeds at 2546 and 2754. It is by the east end of the world, 46 px from where wanderers arrive there |

Reeds stand 20 px outside the ends of a pond's water. The map's design rules follow; `tests/map.test.js` checks the default map against all but the one about thorn bushes:

* Water is within sight of every station: each tree, grass patch, rock and log is within a founder's sight (306 px) of some pond's water, measured from the nearest edge of its extent.
* Something useful and harmless is at each wall, because creatures gather at the world's ends: water, within sight of where wanderers arrive at each end.
* No thorn bushes on the map. In a one-line world a bush is either a toll gate or a dead end, and dead ends are where creatures gather. (The player's thorn tool still plants one, and teaches pain.)
* Sources of the same odour are at least 500 px apart (the mimic tree from the fruit tree).
* The ground under every station is flat (a slope of at most 0.05); a pond's banks are at most 0.4, a slope a creature can climb.
* Each founder's spot is dry, level (a slope of at most 0.05 around it), inside the walkable edge and clear of thorn bushes, and the two spots differ, so the pair can face each other.

The spec's format:

```js
valley: {
  width: 2960, height: 900, edge: 150,
  cliffs: { width: 140, rise: 260 },
  ground: 640,                          // the level ground's y
  ponds: [{ x0, x1, depth, bank }],     // dips that fill with water
  features: [{ kind, x, ...props }],    // the contract's features; list order is id order (1..N) and the order they are visited
  ball: 175,                            // where the ball starts
  founders: { FEMALE: 275, MALE: 345 }  // where the first female and the first male stand
}
```

The ground is sampled every 8 px: `y(x) = ground + pond dips - cliff`. A pond is centred between its rims `x0` and `x1`; its dip lowers the ground by `depth`, flat for `(x1 - x0) - 2 * bank` and easing to nothing over `bank` px on each side (half a cosine), so it ends at the rims; its steepest slope is about `depth * PI / (2 * bank)`. The water stands 6 px below the lower rim, and its ends are found by walking in from the rims to where the ground falls below it; a map's reeds are written in as numbers taken from those ends. The cliff takes `rise * (1 - e / width)^2` off y where e, the distance from the nearer end, is under `width`. A feature's y is the ground's at its x, and a tree's `yields` is its species.

The sun's elevation is a sine of the day's phase, and light follows it. `Evo.SEASONS` gives each season a mean temperature, a day-night swing, a dew factor and a growth factor for each food. `temperatureAt` adds to the season and the sun: cooler in a tree's shade and in water, warmer by the rock, which stores the day's sun and gives it back at night.

## Food and items

`Evo.ITEM_TYPES` says how each item looks and smells, what eating it puts in the gut, how long it lasts and how it moves.

| Item | Grows | Notes |
|---|---|---|
| fruit | Falls from fruit trees | Sugar |
| mimic | Falls from the mimic tree | Looks and smells nearly like fruit; toxin |
| grain | In grass | Starch and a little protein |
| dew | On grass at dawn | Water |
| bug | In grass | Protein and fat; flees and hops |
| grub | By the log | Protein and fat; crawls, stays near the log |
| carrion | A dead creature | What the body held |
| egg, ball, lure | Laid or placed | Not food. The lure smells of female musk |

Trees and grass build up with light and the season's growth factor, then drop food by chance (the numbers are `GROWTH` in `src/sim/world.js`; a season with no growth factor for a food throws an error). A new world starts each tree with 3 fruit, each grass patch with 4 grain and each log with 2 grubs. Growing food stops while 70 food items exist (`Evo.LIMITS.MAX_FOOD`, carrion not counted), checked once per tick. Items fall and bounce, and those that roll or bounce slide downhill. Most float on ponds, but grubs, bugs and dew sink and crawlers turn back at the water. Items rot at the end of their time unless held. An egg incubates faster in warmth, not at all in the cold or while held, and hatches when its progress reaches 1, if the world has room and nobody holds it.

## Scent and sound

Scent is a grid of 30 px cells (99 × 30 in the valley), one layer per odour in `Evo.SCENTS`: `sweet`, `starch`, `moist`, `bitter`, `earthy`, `prey`, `muskF`, `muskM`, `alarm`, `carrion`. Items and ponds give off their odours every tick, and bodies their musk and alarm (queued, like every write a body or its muscles make). Each odour's diffusion and decay are in `Evo.SCENTS`; the method is in [CORE.md](CORE.md). Solid ground holds none: `world.scentSolid` marks the cells whose centre is more than half a cell below the surface. Write scent only through `depositScent`, which keeps the box that diffusion sweeps. `sampleScent(x, y, channel)`, what a nose reads, blends the four nearest cells bilinearly but reads only air: a solid cell has no weight and the rest are divided by the weight left (0 if all four are solid), so the ground beside a nose neither dims its reading nor makes a slope look like a scent gradient.

A call is a sound at the caller's head, with its voice's pitch (higher for a baby or child) and loudness. It stays in `world.sounds` for 90 ticks; others hear it in the mind phase of the next two ticks ([TIME.md](TIME.md)).

## Creatures in the world

- A world starts with two founders, a grown female and male, the same two every time: `Evo.Genome.founder(sex)` builds each one's genome with no random numbers ([GENOME.md](GENOME.md)). Each stands on the spot the map gives its sex (`founderX`), faces the other, and has the name written in `Evo.FOUNDERS`: Elani and Fenro. Their brains grow the same too ([BRAIN.md](BRAIN.md)), so every world starts the same. `addAdult(sex, opts)` brings a grown creature at 40% of its life (`ADULT_ARRIVAL_AGE` in `world.js`), on its sex's founder spot unless `opts.x` says where; `opts.facing` and `opts.syllables` (the two syllables of its name) are chosen at random when left out ([CREATURE.md](CREATURE.md)). `addEgg(x, y)` places a founder egg (a fresh founder genome of a random sex, unless told which). Nothing is added past 16 creatures (`Evo.LIMITS.MAX_POPULATION`), and eggs wait to hatch.
- Each creature within 160 px adds 0.5 company (full at two); crowding starts past three and is full at seven. Touching is felt on that side. A held creature is company but not touch.
- A fertile female who is not pregnant and a fertile male who touch have a 3% chance each tick to mate. Both wait 1800 ticks before mating again, and he pays some protein. She carries the egg, built from a recombined, mutated genome, and both genomes go into the seed bank (the last 24). Genes change only here, when a child is conceived: everyone else keeps the genes they were made with.
- Every 1800 ticks, if a sex has no mature (adolescent to senile) adult left, one wanderer of that sex walks in from an end of the world (a female first, if neither is left): an exact copy of a random banked genome of that sex, keeping its generation, or the starting genome (the first female's or male's, generation 1) if the bank holds none of that sex. A fresh world stays at its two founders until babies come.
- A world with no creatures and no eggs is founded again, from the seed bank when it holds any genomes: a copy of a random banked genome of each sex, standing on the founder spots, with random names and facing. With an empty bank it is the starting pair again, named and facing each other as at the start.
- The dead leave carrion holding part of their protein, fat and sugar.

## The hand

| Call | What it does |
|---|---|
| `world.pat(c)` | A gentle touch on the back, and the *patted* stimulus |
| `world.slap(c)` | An impact on the back, a little injury, and the *slapped* stimulus. It wakes a sleeper |
| `world.grab(holding, x, y)`, `moveHand(x, y)`, `releaseHand(vx, vy)` | Carry a creature or an item (`{ creature }` or `{ item }`), and let it go with a velocity |
| `world.dropItem(type, x, y)` | Drop an item from a height; `'thorn'` plants a thorn bush |

What a pat or a slap feels like is up to the genes: the founder's make a pat pleasant and a slap painful.

## Events

| Event | Payload |
|---|---|
| `hatch`, `wanderer` | `{ creature }` |
| `stage` | `{ creature, stage }` |
| `death` | `{ creature, cause }` (raised in the body phase, before the body is removed) |
| `mate` | `{ mother, father }` |
| `egg` | `{ mother }` |
| `eat` | `{ creature, item, food }` |
| `grab` | `{ creature, item }` |
| `drink`, `call`, `sleep`, `wake`, `pat`, `slap` | `{ creature }` |
| `nuzzle`, `shove` | `{ from, to }` |
| `season` | `{ season }` |
| `refound` | `{}` |
