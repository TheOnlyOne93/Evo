// The world's landscape as data: the terrain (a height field with ponds and cliffs), the features
// standing on it (trees, rocks, logs...) and the platforms some of them make, built from a map.
// Pure: it never touches the page. A map is data with nothing random in it: every seed gets the
// same landscape (only spawnX() draws, from Evo.random, when a founder is placed).
(function (Evo) {
  'use strict';
  const { clamp } = Evo.util;

  const POND_BELOW_RIM = 6; // px: a pond's water stands this far below its lower rim
  const SPACING = 8; // px between height samples

  // ---------- Terrain: a height field with ponds and cliffs ----------
  // Only the ground and its queries; terrainFromSpec builds the pieces
  //   spacing  px between height samples           heights  Float32Array: ground surface y at x = i * spacing
  //   ponds    [{ x0, x1, level, bed }]: the water's ends, its surface y and the deepest ground y under it
  //   cliffs   { width, rise }: at each end of the world the land rises by up to `rise` px over the last
  //            `width` px (World.edge must be at least `width`)
  class Terrain {
    constructor({ spacing, heights, ponds, cliffs }) {
      this.spacing = spacing;
      this.heights = heights;
      this.ponds = ponds;
      this.cliffs = cliffs;
    }

    groundY(x) {
      const f = clamp(x / this.spacing, 0, this.heights.length - 1.001);
      const i = Math.floor(f), t = f - i;
      return this.heights[i] * (1 - t) + this.heights[i + 1] * t;
    }

    slopeAt(x) {
      return (this.groundY(x + 4) - this.groundY(x - 4)) / 8;
    }

    // The pond surface at x, or null where there is no water
    waterLevelAt(x) {
      for (const p of this.ponds) if (x >= p.x0 && x <= p.x1) return p.level;
      return null;
    }
  }

  // How far the land is raised at x by the cliff at the nearer end of a world `width` px wide
  function cliffRise(x, width, cliffs) {
    const edge = Math.min(x, width - x);
    return edge < cliffs.width ? cliffs.rise * (1 - edge / cliffs.width) ** 2 : 0;
  }

  // The deepest ground (the largest y) between a pond's rims
  function bedBetween(terrain, x0, x1) {
    let bed = -Infinity;
    for (let i = Math.ceil(x0 / terrain.spacing); i * terrain.spacing < x1; i++) bed = Math.max(bed, terrain.heights[i]);
    return bed;
  }

  // A pond's record for water at `level` between the rims x0 and x1: the water's ends are found by
  // walking in from each rim to where the ground falls below the surface
  function pondWater(terrain, x0, x1, level) {
    let a = x0, b = x1;
    while (a < x1 && terrain.groundY(a) < level) a += 2;
    while (b > x0 && terrain.groundY(b) < level) b -= 2;
    return { x0: a, x1: b, level, bed: bedBetween(terrain, x0, x1) };
  }

  // What each kind of feature is to the landscape: its half-width (px) and, for kinds creatures can
  // stand on, the platform it makes. Drawing has its own per-kind code.
  const FEATURE_KINDS = {
    tree: { extent: f => f.canopy },
    grass: { extent: f => f.width / 2 },
    reeds: { extent: f => f.width / 2 },
    log: {
      extent: f => f.length / 2,
      platform: f => ({ x0: f.x - f.length / 2, x1: f.x + f.length / 2, y: f.y - 24 })
    },
    rock: {
      extent: f => f.width / 2,
      platform: f => ({ x0: f.x - f.width / 2 + 6, x1: f.x + f.width / 2 - 6, y: f.y - f.height + 4 })
    },
    thornbush: { extent: f => f.radius }
  };

  // ---------- A map spec ----------
  // 1 within top / 2 of a centre (d = distance from it), easing to 0 over the next `ramp` px
  function plateau(d, top, ramp) {
    if (d <= top / 2) return 1;
    return d < top / 2 + ramp ? (1 + Math.cos(Math.PI * (d - top / 2) / ramp)) / 2 : 0;
  }

  // A spec's ground, sampled every SPACING px:
  //   y(x) = ground + sum of pond dips - cliff
  // A pond dips the ground `depth` px over a flat (x1 - x0) - 2 * bank px wide with `bank` px of slope
  // on each side, so the dip ends at the rims x0 and x1. Water stands POND_BELOW_RIM below the lower rim.
  function terrainFromSpec(spec) {
    const { width, cliffs, ponds: dips = [] } = spec;
    const n = Math.ceil(width / SPACING) + 1;
    const heights = new Float32Array(n);
    const ponds = [];
    const terrain = new Terrain({ spacing: SPACING, heights, ponds, cliffs });
    for (let i = 0; i < n; i++) {
      const x = i * SPACING;
      let y = spec.ground;
      for (const p of dips) y += p.depth * plateau(Math.abs(x - (p.x0 + p.x1) / 2), p.x1 - p.x0 - 2 * p.bank, p.bank);
      heights[i] = y - cliffRise(x, width, cliffs);
    }
    for (const p of dips) ponds.push(pondWater(terrain, p.x0, p.x1, Math.max(terrain.groundY(p.x0), terrain.groundY(p.x1)) + POND_BELOW_RIM));
    return terrain;
  }

  // The landscape of a map spec:
  //   width, height, edge       the world's size; how far creatures and items stay from its ends
  //   cliffs: { width, rise }   the cliff at each end
  //   ground                    the level ground's y
  //   ponds: [{ x0, x1, depth, bank }]    dips that fill with water
  //   features: [{ kind, x, ...props }]   what stands on the ground (its y is the ground's at x); the list
  //                                       order is the ids 1..N and the order the world visits them
  //   ball, spawn: [x0, x1]               where the ball starts; the span a founder appears in
  // Nothing in it is random.
  function buildFromSpec(spec) {
    const terrain = terrainFromSpec(spec);
    const features = (spec.features || []).map(({ kind, x, ...props }, i) => {
      if (!FEATURE_KINDS[kind]) throw new Error(`Unknown feature kind: ${kind}`);
      const feature = { id: i + 1, kind, x, y: terrain.groundY(x), ...props };
      // A tree's species decides the item type it yields (renderers draw by species)
      if (kind === 'tree') feature.yields = feature.species;
      return feature;
    });
    return { width: spec.width, height: spec.height, edge: spec.edge, terrain, features, ballX: spec.ball, spawnX: () => Evo.randRange(spec.spawn[0], spec.spawn[1]) };
  }

  // ---------- Maps ----------
  // A map is a spec (see buildFromSpec).
  const MAPS = {
    // Left to right: the home meadow, the spring, the fruit tree, the warm rock, the log, the lake, the
    // east meadow with the mimic tree, and the east pool by the world's end. Every station is within sight
    // of water, and there is water at each end of the world (creatures gather at the ends); no thorn
    // bushes. Reeds stand 20 px outside the ends of each pond's water (written in as numbers, taken from
    // the built ponds).
    valley: {
      width: 2960, height: 900, edge: 150,
      cliffs: { width: 140, rise: 260 },
      ground: 640,
      ponds: [
        { x0: 1601, x1: 2121, depth: 45, bank: 180 }, // the lake
        { x0: 2530, x1: 2770, depth: 28, bank: 115 }, // the east pool
        { x0: 440, x1: 680, depth: 28, bank: 115 }    // the spring
      ],
      features: [
        { kind: 'grass', x: 310, width: 220, height: 40, seeding: 0.4 },
        { kind: 'reeds', x: 456, width: 50 },
        { kind: 'reeds', x: 664, width: 50 },
        { kind: 'tree', species: 'fruit', x: 800, height: 210, canopy: 90, fruiting: 0.5 },
        { kind: 'rock', x: 990, width: 96, height: 39, warm: 0 },
        { kind: 'log', x: 1265, length: 150 },
        { kind: 'reeds', x: 1625, width: 50 },
        { kind: 'reeds', x: 2097, width: 50 },
        { kind: 'grass', x: 2250, width: 220, height: 40, seeding: 0.4 },
        { kind: 'tree', species: 'mimic', x: 2460, height: 140, canopy: 55, fruiting: 0.4 },
        { kind: 'reeds', x: 2546, width: 50 },
        { kind: 'reeds', x: 2754, width: 50 }
      ],
      ball: 175, spawn: [220, 400]
    }
  };
  const DEFAULT_MAP = 'valley';

  // The landscape of a map (a name in MAPS, or a map object):
  // { width, height, edge, terrain, features, platforms, ballX, spawnX }. `edge` is how far creatures
  // and items stay from the world's ends (at least terrain.cliffs.width); `spawnX()` draws a founder's x.
  // Every rock and log makes a platform, each the walkable top of its feature, named by featureId
  // (renderers draw them as one).
  function buildLandscape(map = DEFAULT_MAP) {
    const m = typeof map === 'string' ? MAPS[map] : map;
    if (!m) throw new Error(`Unknown map: ${map}`);
    const landscape = buildFromSpec(m);
    landscape.platforms = landscape.features.filter(f => FEATURE_KINDS[f.kind].platform)
      .map(f => ({ ...FEATURE_KINDS[f.kind].platform(f), kind: f.kind, featureId: f.id }));
    return landscape;
  }

  Object.assign(Evo, { FEATURE_KINDS, MAPS, DEFAULT_MAP, buildLandscape });
})(globalThis.Evo);
