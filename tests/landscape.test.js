'use strict';

// Guards for hand-authored maps: each test runs over every map in Evo.MAPS, so an edit that breaks
// the layout fails here by name.

const specMaps = Evo => Object.entries(Evo.MAPS).map(([name, spec]) => ({ name, spec, land: Evo.buildLandscape(spec) }));

// The largest |slope| of the ground over [x0, x1], sampled every px
function steepest(terrain, x0, x1) {
  let m = 0;
  for (let x = x0; x <= x1; x++) m = Math.max(m, Math.abs(terrain.slopeAt(x)));
  return m;
}

test('landscape: the game\'s map exists, and its walkable edge keeps creatures off the cliffs', (Evo, assert) => {
  assert.ok(Evo.MAPS[Evo.DEFAULT_MAP], `the default map ${Evo.DEFAULT_MAP}`);
  for (const { name, spec } of specMaps(Evo)) assert.ok(spec.edge >= spec.cliffs.width, `${name}: edge ${spec.edge} is inside the cliffs (${spec.cliffs.width})`);
});

test('landscape: every feature stands on dry land in reach of a creature, none on a cliff', (Evo, assert) => {
  for (const { name, land } of specMaps(Evo)) {
    const { width, edge, terrain, features } = land, cliff = terrain.cliffs.width;
    for (const f of features) {
      const what = `${name}: ${f.kind} #${f.id} at ${f.x}`;
      assert.strictEqual(terrain.waterLevelAt(f.x), null, `${what} is over water`);
      if (f.kind === 'thornbush') {
        // A bush may stand past the walkable edge, as long as a creature at the edge is still inside it
        assert.ok(f.x >= edge - f.radius && f.x <= width - edge + f.radius, `${what} is out of reach`);
      } else {
        assert.ok(f.x >= cliff && f.x <= width - cliff, `${what} is on a cliff`);
      }
    }
  }
});

test('landscape: trees, grass, rocks and logs stand on level ground', (Evo, assert) => {
  for (const { name, land } of specMaps(Evo)) {
    for (const f of land.features) {
      if (!['tree', 'grass', 'rock', 'log'].includes(f.kind)) continue;
      const reach = Evo.FEATURE_KINDS[f.kind].extent(f);
      const slope = steepest(land.terrain, f.x - reach, f.x + reach);
      assert.ok(slope <= 0.05, `${name}: ${f.kind} #${f.id} at ${f.x} stands on a slope of ${slope.toFixed(3)}`);
    }
  }
});

test('landscape: ponds hold water, are held in by the ground, deep enough to drink from, with banks a creature can climb', (Evo, assert) => {
  for (const { name, land } of specMaps(Evo)) {
    const t = land.terrain;
    assert.ok(t.ponds.length > 0, `${name} has water`);
    for (const p of t.ponds) {
      const what = `${name}: the pond at ${p.x0}..${p.x1}`;
      assert.ok(p.bed > p.level, `${what} holds no water`);
      assert.ok(p.bed - p.level > 17, `${what} is only ${(p.bed - p.level).toFixed(1)} px deep`);
      assert.ok(Math.max(t.groundY(p.x0), t.groundY(p.x1)) < p.level + 4, `${what}: the water stands above its shore`);
      const bank = steepest(t, p.x0 - 60, p.x1 + 60);
      assert.ok(bank <= 0.4, `${what} has a bank of slope ${bank.toFixed(3)}`);
    }
  }
});

test('landscape: wanderers arrive on dry ground, clear of any thorn bush', (Evo, assert) => {
  for (const { name, land } of specMaps(Evo)) {
    for (const x of [land.edge + 30, land.width - land.edge - 30]) {
      assert.strictEqual(land.terrain.waterLevelAt(x), null, `${name}: arrival at ${x} is in water`);
      for (const f of land.features) if (f.kind === 'thornbush') assert.ok(Math.abs(x - f.x) >= f.radius, `${name}: arrival at ${x} is in the thorn bush at ${f.x}`);
    }
  }
});

test('landscape: no thorn bush stands between other features, so none blocks the way from one to the next', (Evo, assert) => {
  for (const { name, land } of specMaps(Evo)) {
    for (const b of land.features.filter(f => f.kind === 'thornbush')) {
      const others = land.features.filter(f => f !== b);
      assert.ok(others.every(f => f.x > b.x) || others.every(f => f.x < b.x), `${name}: the thorn bush at ${b.x} is between other features`);
    }
  }
});

test('landscape: a mimic tree stands at least 500 px from every fruit tree', (Evo, assert) => {
  for (const { name, land } of specMaps(Evo)) {
    const trees = land.features.filter(f => f.kind === 'tree');
    for (const fruit of trees.filter(t => t.species === 'fruit')) {
      for (const mimic of trees.filter(t => t.species === 'mimic')) {
        assert.ok(Math.abs(fruit.x - mimic.x) >= 500, `${name}: the mimic tree at ${mimic.x} is only ${Math.abs(fruit.x - mimic.x)} px from the fruit tree at ${fruit.x}`);
      }
    }
  }
});

// How far the span [a0, a1] is from the span [b0, b1] (0 where they overlap)
const gapBetween = (a0, a1, b0, b1) => Math.max(0, a0 - b1, b0 - a1);

// A thirsty creature should see water from every station, and creatures gather at the world's ends, so
// something useful (water) must be there. Sight is a founder's (306 px); a station's reach is its
// extent (FEATURE_KINDS), measured to the nearest edge of a pond's water
test('landscape: every tree, grass patch, rock and log is within a founder\'s sight of water', (Evo, assert) => {
  const sight = Evo.Genome.founder('FEMALE').develop().visionRange;
  for (const { name, land } of specMaps(Evo)) {
    for (const f of land.features) {
      if (!['tree', 'grass', 'rock', 'log'].includes(f.kind)) continue;
      const reach = Evo.FEATURE_KINDS[f.kind].extent(f);
      const near = Math.min(...land.terrain.ponds.map(p => gapBetween(f.x - reach, f.x + reach, p.x0, p.x1)));
      assert.ok(near <= sight, `${name}: ${f.kind} #${f.id} at ${f.x} is ${Math.round(near)} px from the nearest water (a founder sees ${Math.round(sight)})`);
    }
  }
});

test('landscape: each end of the world has water within a founder\'s sight of where wanderers arrive', (Evo, assert) => {
  const sight = Evo.Genome.founder('FEMALE').develop().visionRange;
  for (const { name, land } of specMaps(Evo)) {
    for (const x of [land.edge + 30, land.width - land.edge - 30]) {
      const near = Math.min(...land.terrain.ponds.map(p => gapBetween(x, x, p.x0, p.x1)));
      assert.ok(near <= sight, `${name}: the nearest water is ${Math.round(near)} px from the arrival spot ${x} (a founder sees ${Math.round(sight)})`);
    }
  }
});
