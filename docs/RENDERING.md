# Rendering

`src/render/`: canvas drawing. Renderers read the simulation and never change it or draw from `Evo.random`. Only `pose.js` is `data-headless`, and `tools/fingerprint.js` hashes its output, so a change to the pose moves the fingerprint. Everything else is checked in a browser ([BROWSER_CHECKS.md](BROWSER_CHECKS.md)).

## Files

| File | Puts on `Evo` |
|---|---|
| `theme.js` | `theme` (`color(token)`, `rgbOf`, `rgba`) reads the CSS tokens in `styles/app.css`; `color` has the `[r, g, b]` helpers |
| `canvas.js` | `fitCanvas(canvas, ctx)` sizes a canvas's buffer to its on-screen size at the device pixel ratio and returns the CSS size; `makeCanvas(w, h)`; `Paint`, the shared path helpers |
| `pose.js` | `poseOf`, `looksOf`, `attentionOf` (below) |
| `creature-art.js` | `CreatureArt` (below) |
| `season.js` | `SEASON` (`SPRING` 0 … `WINTER` 3, the order of `world.season.index`) |
| `sky.js` | `Sky`: gradient, sun, moon, stars, clouds and three parallax layers; the light palette the view tints with. Reads `world.clock` and `world.season` only |
| `item-art.js` | `ItemArt`: items from their data, one row per type in `ART` (lift, icon size, tilt, the function that draws it; a type without a row warns and draws as a grey circle); `drawIcon` for the toolbar; `colors()`, the food colours it draws with (the grass seed heads use its grain) |
| `painters/` | Add the static-art painters to `Paint`: `palette.js` (seasonal palettes), `terrain.js` (tiles, stones, cliffs: the art reaches `terrain.cliffs.width` in from each end and stands as high as the ground at the ends, the higher of the two; turf and snow thin out to nothing at a pond's edge), `plants.js` (trees, grass, reeds, thorn bush), `rocks.js` (the log and the rock, shaped to their platforms). Each feature's shape function (`treeStructure`, `grassStructure`, `reedStructure`, `thornShape`, `rockShape`, `logShape`) also returns the box its sprite is painted in (`box`), so the box sits beside the drawing |
| `water.js` | `Water`: ponds (the water is as deep as the pond's `bed`), their ice and snow in winter, the sun's glints |
| `weather.js` | `Weather`: snow, leaves, petals, pollen and fireflies, pooled around the visible area |
| `hand-art.js` | `HandArt`: the player's hand in four poses, in screen px |
| `cues.js` | `CreatureCues`: thought bubbles, hearts, bursts, name tags, attention brackets, and each creature's recent events for the card; `shownDrives`, `DRIVE_SHOWN`, `EVENT_LOOK` for the interface |
| `world-view.js` | `WorldView` (below) |
| `brain-view.js` | `BrainView` (the brain map: every region as a box, every cell at its spot) and `VoltageScope` (one neuron's membrane potential) |
| `family-view.js` | `FamilyView`: the family tree |
| `charts.js` | `Charts`: the inside view's two charts (`ringLines`: the drive history from ring buffers; `area`: the population as a filled line); they draw only what the inspector gives them |

## Creature pose

The contract between the simulation and `Evo.CreatureArt`. `Evo.poseOf(creature, { focused, hovered, world })` turns simulation state into this plain object. With `world`, the eyes follow what the creature attends to and easing counts world ticks; without it, easing counts the creature's age. Easing and attention live in weak maps, so calling `poseOf` twice in a tick changes nothing. The artist draws only from the pose, never from simulation internals.

`Evo.looksOf(creature)` gives the `looks` alone: with an id, a stage and a sex they are pose enough for a portrait, which is how the family tree draws the dead. `Evo.attentionOf(creature, world)` gives the thing a creature attends to, or null.

```js
pose = {
  id, x, y,                 // world coords; y = where the feet touch the ground
  groundY,                  // added by WorldView: the surface below the creature (for a shadow while airborne)
  waterY,                   // added by WorldView while it drinks: the water's surface at its mouth (the lips go there)
  facing,                   // 1 = facing right, -1 = facing left
  size,                     // body length in px (about 13–20 for a newborn, 30–48 grown)
  stage,                    // 1 baby, 2 child, 3 adolescent, 4 youth, 5 adult, 6 old, 7 senile
  sex,                      // 'FEMALE' | 'MALE'
  looks: {                  // all 0..1 unless noted; genetic (a later-stage appearance gene can change them)
    hue, accentHue,         // 0..360
    pattern,                // 0 plain, 1 stripes, 2 spots, 3 patches
    patternScale, earSize, tailLength, eyeSize, plumpness, legLength, crest
  },
  motion: {
    vx,                     // px per tick, signed (flying backwards fast, the art flails)
    vy,                     // px per tick, + = falling
    air,                    // 0..1, eased: into the jump's pose after it leaves the ground, 0 from the tick it lands
    land,                   // 0..1: a landing's squash (full when it lands at 7 px a tick), easing off
    walkPhase,              // radians; advances with distance walked (Evo.CREATURE.WALK_PHASE_PER_PX)
    lying,                  // 0..1 (1 = lying down: resting or asleep)
    headDown,               // 0..1, eased: the head is down while the mouth works (eating or drinking)
    turn,                   // -1..1, eased toward facing: which way it is drawn (it passes 0 as it turns round, where the art narrows the body)
    swim                    // 0..1, eased: floating in deep water, held up by it rather than standing on the bed (needs the world)
  },
  face: {
    eyesClosed,             // 0..1
    pupilX, pupilY,         // -1..1: where it is looking (pupilX +1 = world right, whichever way it faces; pupilY -1 = up)
    mouthOpen,              // 0..1: calling or yawning (while eating, the art chews by itself)
    smile,                  // -1 (miserable) .. 1 (delighted)
    earDroop,               // 0..1 (tired, queasy or lonely; the art adds old age itself)
    blush,                  // 0..1 (pleasure, e.g. being patted)
    happy,                  // 0..1 (just patted: happy eyes, wagging tail)
    worry,                  // 0..1 (worried brows: in pain, lonely, bored)
    yawn, lick              // 0..1 (brief gestures: sleepy or tired; hungry for any food or thirsty)
  },
  state: {
    asleep, held, dead,
    calling,                // 0..1 (show a call)
    flinch,                 // 0..1 (just hurt)
    fear, anger, pain, sick, cold, hot, wet, pregnant,   // 0..1
    inHeat                  // boolean: creature.fertile, shown by crest and colour
  },
  focused, hovered          // UI highlight
}
```

## Public APIs

```js
Evo.CreatureArt = {
  draw(ctx, pose, t),                 // ctx in world coordinates; t = wall seconds
  drawPortrait(ctx, pose, w, h, t, framing),  // a calm copy (facing right, not walking or eating) fitted into a
                                      // w×h box at the origin, clipped; used by the card, the strip and the family tree
  //  framing: 'body' | 'face' | 'auto' (default: the face in boxes under 100 px)
  bounds(pose)                        // { x0, y0, x1, y1 } in world coordinates, for picking
  mouthAt(pose, t, out)               // out = [x, y]: where draw puts the middle of the mouth, in world coordinates
  // The framing and bounds take in the ears along the outline that draws them
}

class WorldView {
  constructor(world, canvas)
  setWorld(world)                     // show another world (after a restart); drops every cache
  resize()
  render(t)                           // one frame; t = wall seconds
  follow(creature | null); followed   // the camera tracks a creature smoothly
  panBy(dx, dy)                       // also stops following
  zoomAt(factor, sx, sy); resetZoom() // zoomAt keeps the followed creature in place, else the point (sx, sy)
  screenToWorld(sx, sy); worldToScreen(x, y)
  creatureAt(sx, sy); itemAt(sx, sy)  // picking in screen coordinates
  focused()                           // options.focused as a creature
  poseFor(creature)                   // this frame's pose (with groundY, focused, hovered), for portraits
  hoveredCreature, hoveredItem, w, h
  cues                                // CreatureCues: the app calls cues.track(world, t) every tick; cues.recent(c)
  onDrawSenses(ctx, creature, view, t)  // drawn when showSenses is on; only the world lab sets it
  options: { showScent, showSenses, focused /* creature or id */,
             hand /* null or { x, y (canvas px), mode: 'grab' | 'pat' | 'slap', holding } */ }
}

class BrainView {
  constructor(canvas); resize(); setBrain(brain); render()
  pickAt(x, y); tapAt(x, y)           // the neuron under a point, else the region whose box it is in
  allWiring, ticksRun, probed, region, marks
}
class VoltageScope { resize(); clear(); push(v); render(threshold) }

class FamilyView {
  constructor(canvas); resize(); redraw(); hover
  render(kin, index, who, t)          // kin and index from Evo.kinOf and Evo.kinIndex (src/ui/kin.js);
                                      // who: { creatureOf(id), poseOf(creature), faces: Map id -> { looks, stage } as last seen }
  nodeAt(x, y)                        // the face under a point: { rec, x, y, r, role, self } or null
}
```

What renderers read beyond the world contract ([WORLD.md](WORLD.md)): `world.nearestWater` (pose), the creature fields listed in [CREATURE.md](CREATURE.md), `stimCount` and `brain.dream` (cues), the brain's arrays, `boxes` and `chemImages` (brain map), and `world.history` through `Evo.kinOf` (family tree).

## A frame

`WorldView.render(t)`:

1. Sync the terrain, move the camera, update the sky palette, and pose the visible creatures.
2. The parallax backdrop, terrain tiles, then back features (trees, the log and rock, thorn bushes, grass).
3. Shadows, loose items, creatures (the focused one last), held items, water, reeds. An item in a creature's mouth is drawn at `mouthAt`, which moves with the head, keeping the offset at which the simulation hangs it from its own fixed mouth point; the simulation's point still decides where it is picked at and dropped. A just-eaten item (from the world's eat event) slides from where it lay into the drawn mouth, shrinking, over 6 ticks.
4. Weather, then the day-night light tint over everything drawn so far.
5. The sky behind it all (drawn beneath): gradient, stars, sun, moon, clouds.
6. Glows (the warm rock, lures, ripe eggs, fireflies, water glints) and the vignette.
7. Overlays: scent (left clear where `world.scentSolid` is set), senses, calls, creature cues (in screen px), the hand.

If posing or drawing a creature ever throws, the view warns once and draws placeholders for every creature from then on.

## The brain map

`BrainView` draws the brain's own map ([BRAIN.md](BRAIN.md)) as one picture, stretched to fill the canvas with a small margin: x across, y from the front (top) to the back (bottom). Under the cells, each region is a rounded box from `brain.boxes` with a faint tint and a thin outline in its colour; a two-sided region has a second box, the mirror image of the first (x to 1 - x). The region's name sits on a dark tag just above the top left corner of its (left) box, a dashed line marks the midline, and "left" and "right" hints sit at the bottom. Each cell is a dot at its spot in its box. The reward and punishment haze (`chemImages`) is under the boxes. Cells glow as they fire, spikes travel along the connections, and only recently used connections are drawn (or all of them with "All wiring"). Tapping a cell picks it; tapping inside a box but away from any cell picks that region, which dims the other cells and shows only the connections that touch it. Tapping the same thing again lets go.

## Caching

- **Static art** (terrain tiles of 256 px, plants, the log, the rock) is painted once per season into offscreen sprites at 1, 1.5, 2, 3 or 4 device px per world px, whichever first covers the zoom (4 is for phones at 3 device px per CSS px), and blitted each frame. At most 3 sprites are upgraded per frame; until then another resolution stands in. The next season's sprites are built from 80% of the way through a season. Sprites are evicted least recently used when they pass 24 Mpx. A feature's sprite is rebuilt when its shape changes, the terrain's when `terrain.heights` is replaced.
- **The sky** caches its parallax layers per season, its clouds and a stepped moon.
- **CreatureArt** keeps up to 300 creatures' layouts, palettes and gradients, keyed by `pose.id`, so ids must be stable and unique. Only `draw` advances the leg phase (from `walkPhase`); portraits, `bounds` and `mouthAt` don't.
- **Theme tokens** are read once from the page's CSS and kept; a missing token draws magenta.

## Time and randomness

Renderers depict sim state in ticks; they never drive it. Pose easing moves per sim tick (a paused world freezes, and high speed keeps up). The brain map lights a neuron that fired in any tick since the last frame (up to 31). What watches the simulation samples after each tick ([TIME.md](TIME.md)). Everything animated between ticks uses wall seconds: idle motion (blinks, breath, tail wags, chewing, the legs' flailing and dog paddle), cue effects, plant sway, clouds, weather, water, the camera. The hand converts its own timing into ticks ([INTERFACE.md](INTERFACE.md)).

Scenery and creature markings use their own `mulberry32` streams or `hash2`, seeded from ids. Passing effects (weather, shooting stars) use `Math.random`, so two frames never match pixel for pixel.

## Colours

Where a colour *means* something (food types, sexes, reward and punishment), it comes from a CSS token through `Evo.theme`, so the map, the toolbar and the bars agree. Environment art uses its own palettes (`Paint.GROUND` and others). The lure's glow, call notes and burst colours are still hard-coded.

## Performance

Target: 60 fps on a mid-range laptop, even with a full world (16 creatures, about 80 items). Cache static layers; avoid per-frame allocation in hot paths.
