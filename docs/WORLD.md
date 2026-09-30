# World

`src/sim/world.js`: `Evo.World`, the side-view world: terrain, ponds, plants that grow food, day and night, seasons, temperature, scent, sound and the creatures. It never touches the page. It announces what happens on `world.events`, and renderers read it through the contract below without changing it. The shared tables (items, scents, seasons, limits) are in `src/sim/constants.js`.

## The contract

y grows downward. All lengths are world pixels.

```js
world.width, world.height            // 3600 × 900
world.terrain = {
  spacing,                           // px between height samples
  heights,                           // Float32Array: ground surface y at x = i * spacing
  groundY(x), slopeAt(x),            // interpolated surface y; its slope
  ponds: [{ x0, x1, level }],        // water surface y over [x0, x1]
  waterLevelAt(x)                    // pond surface y at x, or null
}
world.platforms = [{ x0, x1, y, kind, featureId }]  // one-way surfaces: the walkable top of the 'log' or 'rock'
                                                    // whose id is featureId (the feature draws it)
world.features  = [{ id, kind, x, y, ...props }]    // y = base on the ground
  //  'tree'      { height, canopy, species: 'fruit' | 'mimic', yields: item type, fruiting: 0..1 }
  //  'grass'     { width, height, seeding: 0..1 }       grain, dew and bugs appear here
  //  'log'       { length }                             grubs live here
  //  'rock'      { width, height, warm: 0..1 }          the sun-warmed rock
  //  'reeds'     { width }
  //  'thornbush' { radius }                             looks violet; moving through it pricks
world.items = [{ id, type, x, y, vx, vy, radius, rot, age, heldBy, onGround, ... }]
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
world.sampleScent(x, y, channel)
world.sounds = [{ x, y, pitch, loudness, age, sourceId }]   // calls, kept Evo.WORLD.SOUND_LIFE ticks
world.nearestWater(x, range)         // { x, y }: the nearest pond surface within range of x, or null
world.surfaceBelow(x, fromY)         // the highest surface (ground or platform) at or below fromY at x
world.lookOf(item), lookOfCreature(c), lookOfFeature(f)     // what an eye sees: vision features
  //  lookOfFeature: { x, y, radius, features } for a thorn bush or a tree fruiting over 0.2, else null
world.stats, world.seedBank, world.hand = { holding }
world.events                         // an Evo.EventBus (below)
world.setTime(day, phase)            // jump the clock (the world lab, tests, the season skip)
```

Constants renderers share with the simulation: `Evo.WORLD.HOLD_GRIP` (a creature in the hand hangs with its feet `HOLD_GRIP × size` below it), `Evo.WORLD.SOUND_LIFE`, `Evo.WORLD.CLIFF_WIDTH`, `Evo.CREATURE.CALL_TICKS` and `Evo.CREATURE.WALK_PHASE_PER_PX` (walk-cycle radians per px walked).

## Land, light and weather

The ground is a height field with a hill that carries the warm rock, a cliff at each end, and two ponds. Creatures and items stay 150 px from the ends. The seed jitters where things stand: three trees (two fruit, one mimic), two grass patches, the grub log, the rock, reeds at each pond's edges and three thorn bushes.

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

Trees and grass build up with light and the season's growth factor, then drop food by chance. Growing food stops while 70 food items exist (`Evo.LIMITS.MAX_FOOD`, carrion not counted), checked once per tick. Items fall and bounce, and those that roll or bounce slide downhill. Most float on ponds, but grubs, bugs and dew sink and crawlers turn back at the water. Items rot at the end of their time unless held. An egg incubates faster in warmth, not at all in the cold or while held, and hatches when its progress reaches 1, if the world has room and nobody holds it.

## Scent and sound

Scent is a grid of 30 px cells (120 × 30), one layer per odour in `Evo.SCENTS`: `sweet`, `starch`, `moist`, `bitter`, `earthy`, `prey`, `muskF`, `muskM`, `alarm`, `carrion`. Items and ponds give off their odours every tick, and bodies their musk and alarm (queued, like every creature write). Each odour's diffusion and decay are in `Evo.SCENTS`; the method is in [CORE.md](CORE.md). Solid ground holds none. Write scent only through `depositScent`, which keeps the box that diffusion sweeps.

A call is a sound at the caller's head, with its voice's pitch (higher for a baby or child) and loudness. It stays in `world.sounds` for 90 ticks; others hear it in the mind phase of the next two ticks ([TIME.md](TIME.md)).

## Creatures in the world

- A world starts with two founders, a grown female and male. `addAdult(sex, opts)` brings a grown creature, part-way through its life (a banked genome is re-sexed to fit); `addEgg(x, y)` places a founder egg. Nothing is added past 16 creatures (`Evo.LIMITS.MAX_POPULATION`), and eggs wait to hatch.
- Each creature within 160 px adds 0.5 company (full at two); crowding starts past three and is full at seven. Touching is felt on that side. A held creature is company but not touch.
- A fertile female who is not pregnant and a fertile male who touch have a 3% chance each tick to mate. Both wait 1800 ticks before mating again, and he pays some protein. She carries the egg, built from a recombined, mutated genome, and both genomes go into the seed bank (the last 24).
- Every 1800 ticks, if fewer than two mature (adolescent to senile) females, or else males, are left, one wanderer of that sex walks in from an end of the world: a mutated copy from the seed bank, keeping its generation, or a fresh founder if the bank is empty. A fresh world gets a female at tick 1800 and a male at 3600.
- A world with no creatures and no eggs is founded again, from the seed bank when it holds any genomes.
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
