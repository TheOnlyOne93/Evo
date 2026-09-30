// The world's landscape as data: the terrain (a height field with ponds and cliffs), the features
// standing on it (trees, rocks, logs...) and the platforms some of them make, built from a map.
// Pure: it never touches the page. Random draws come from Evo.random, so a seed gives one landscape.
(function (Evo) {
  'use strict';
  const { clamp, TAU } = Evo.util;

  // A pond's water stands belowRim px below its lower rim and is at least minDepth px deep (a shallow
  // dip is dug deeper, up to digPasses times)
  const POND = { belowRim: 6, minDepth: 18, digPasses: 4 };

  // ---------- Terrain: a height field with ponds and cliffs ----------
  class Terrain {
    // cliffs = { width, rise }: at each end of the world the land falls by up to `rise` px over the
    // last `width` px (World.edge must be at least `width`)
    constructor(width, layout, cliffs) {
      this.spacing = 8;
      this.cliffs = cliffs;
      const n = Math.ceil(width / this.spacing) + 1;
      this.heights = new Float32Array(n);
      const ph = [Evo.random() * TAU, Evo.random() * TAU, Evo.random() * TAU];
      for (let i = 0; i < n; i++) {
        const x = i * this.spacing;
        let h = 640 + 30 * Math.sin(x / 1400 * TAU + ph[0]) + 18 * Math.sin(x / 520 * TAU + ph[1]) + 7 * Math.sin(x / 170 * TAU + ph[2]);
        // The hill with the warm rock
        const hill = (x - layout.hill) / 260;
        h -= 70 * Math.exp(-hill * hill);
        // Cliffs at both ends; the walkable edge (World.edge) keeps creatures off them
        const edge = Math.min(x, width - x);
        if (edge < cliffs.width) h -= cliffs.rise * (1 - edge / cliffs.width) ** 2;
        this.heights[i] = h;
      }
      // Ponds: smooth dips that fill with water up to just below their lower rim. Where the land
      // around a dip leaves too little water, its bed is dug deeper, in the same shape
      this.ponds = layout.ponds.map(([x0, x1, depth]) => {
        const dig = d => {
          for (let i = 0; i < n; i++) {
            const x = i * this.spacing;
            if (x > x0 && x < x1) this.heights[i] += d * Math.pow(Math.sin(Math.PI * (x - x0) / (x1 - x0)), 0.8);
          }
        };
        dig(depth);
        let level;
        for (let pass = 0; ; pass++) {
          level = Math.max(this.groundY(x0), this.groundY(x1)) + POND.belowRim;
          let bed = -Infinity;
          for (let i = Math.ceil(x0 / this.spacing); i * this.spacing < x1; i++) bed = Math.max(bed, this.heights[i]);
          const short = POND.minDepth - (bed - level);
          if (short <= 0 || pass === POND.digPasses) break;
          dig(short);
        }
        let a = x0, b = x1;
        while (a < x1 && this.groundY(a) < level) a += 2;
        while (b > x0 && this.groundY(b) < level) b -= 2;
        return { x0: a, x1: b, level };
      });
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

  // ---------- Maps ----------
  // For now a map is { build() }, returning { width, height, edge, terrain, features, ballX, spawnX }.
  const MAPS = {
    // Temporary: the pre-redesign world, kept only as the before-picture for the terrain redesign
    // and deleted once the new map is accepted.
    classic: {
      build() {
        const W = 3600, H = 900;
        const jitter = f => (f + Evo.randRange(-0.015, 0.015)) * W;
        const big = jitter(0.58), small = jitter(0.06);
        const layout = { hill: jitter(0.31), ponds: [[big, big + 420, 80], [small, small + 170, 45]] };
        const terrain = new Terrain(W, layout, { width: 140, rise: 260 });
        const t = terrain;
        const at = x => ({ x, y: t.groundY(x) });
        let id = 0;
        const feature = (kind, x, props) => ({ id: ++id, kind, ...at(x), ...props });
        // A tree's species decides the item type it yields (renderers draw by species)
        const tree = (x, species, props) => feature('tree', x, { species, yields: species, ...props });
        const features = [
          feature('thornbush', jitter(0.125), { radius: 22 }),
          tree(jitter(0.16), 'fruit', { height: 210, canopy: 85, fruiting: 0.5 }),
          tree(jitter(0.235), 'mimic', { height: 140, canopy: 55, fruiting: 0.4 }),
          feature('rock', layout.hill + 30, { width: 96, height: 52, warm: 0 }),
          feature('grass', jitter(0.41), { width: 230, height: 40, seeding: 0.4 }),
          feature('log', jitter(0.49), { length: 150 }),
          ...terrain.ponds.flatMap(p => [feature('reeds', p.x0 - 20, { width: 50 }), feature('reeds', p.x1 + 20, { width: 50 })]),
          tree(jitter(0.79), 'fruit', { height: 230, canopy: 95, fruiting: 0.5 }),
          feature('thornbush', jitter(0.84), { radius: 20 }),
          feature('grass', jitter(0.905), { width: 210, height: 40, seeding: 0.4 }),
          feature('thornbush', jitter(0.70), { radius: 18 })
        ];
        return { width: W, height: H, edge: 150, terrain, features, ballX: 0.45 * W, spawnX: () => Evo.randRange(0.2, 0.8) * W };
      }
    }
  };
  const DEFAULT_MAP = 'classic';

  // The landscape of a map (a name in MAPS, or a map object):
  // { width, height, edge, terrain, features, platforms, ballX, spawnX }. `edge` is how far creatures
  // and items stay from the world's ends (at least terrain.cliffs.width); `spawnX()` draws a founder's x.
  // Every rock and log makes a platform, each the walkable top of its feature, named by featureId
  // (renderers draw them as one).
  function buildLandscape(map = DEFAULT_MAP) {
    const m = typeof map === 'string' ? MAPS[map] : map;
    if (!m) throw new Error(`Unknown map: ${map}`);
    const landscape = m.build();
    landscape.platforms = landscape.features.filter(f => FEATURE_KINDS[f.kind].platform)
      .map(f => ({ ...FEATURE_KINDS[f.kind].platform(f), kind: f.kind, featureId: f.id }));
    return landscape;
  }

  Object.assign(Evo, { FEATURE_KINDS, MAPS, DEFAULT_MAP, buildLandscape });
})(globalThis.Evo);
