'use strict';
// The valley's layout: a player meets these rules only by chance, so they are checked directly.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Evo } = require('./kit.js');

const land = Evo.buildLandscape(Evo.MAPS[Evo.DEFAULT_MAP]);
const { terrain, features } = land;
const STATIONS = ['tree', 'grass', 'rock', 'log'];
// The steepest the ground gets over [x0, x1]
const steepest = (x0, x1) => {
  let m = 0;
  for (let x = x0; x <= x1; x++) m = Math.max(m, Math.abs(terrain.slopeAt(x)));
  return m;
};
// How far the span [a0, a1] is from the span [b0, b1] (0 where they overlap)
const gap = (a0, a1, b0, b1) => Math.max(0, a0 - b1, b0 - a1);
const sight = Evo.Genome.founder('FEMALE').develop().visionRange;
const nearestWater = (x0, x1) => Math.min(...terrain.ponds.map(p => gap(x0, x1, p.x0, p.x1)));

test('every feature stands on dry, level ground a creature can reach', () => {
  assert.ok(land.edge >= terrain.cliffs.width, 'the walkable edge keeps creatures off the cliffs');
  for (const f of features) {
    const what = `${f.kind} at ${f.x}`;
    assert.equal(terrain.waterLevelAt(f.x), null, `${what} is in water`);
    assert.ok(f.x >= land.edge && f.x <= land.width - land.edge, `${what} is out of reach`);
    if (STATIONS.includes(f.kind)) {
      const reach = Evo.FEATURE_KINDS[f.kind].extent(f);
      assert.ok(steepest(f.x - reach, f.x + reach) <= 0.05, `${what} stands on a slope`);
    }
  }
});

test('each founder starts on dry, level ground, apart from the other', () => {
  const spots = land.founderX;
  assert.notEqual(spots.FEMALE, spots.MALE);
  for (const [sex, x] of Object.entries(spots)) {
    assert.ok(x >= land.edge && x <= land.width - land.edge, `${sex} is out of reach`);
    assert.equal(terrain.waterLevelAt(x), null, `${sex} starts in water`);
    assert.ok(steepest(x - 30, x + 30) <= 0.05, `${sex} starts on a slope`);
  }
});

test('ponds are deep enough to drink from, held in by the ground, with banks a creature can climb', () => {
  assert.ok(terrain.ponds.length > 0);
  for (const p of terrain.ponds) {
    const what = `the pond at ${p.x0}..${p.x1}`;
    assert.ok(p.bed - p.level > 17, `${what} is too shallow`);
    assert.ok(Math.max(terrain.groundY(p.x0), terrain.groundY(p.x1)) < p.level + 4, `${what} stands above its shore`);
    assert.ok(steepest(p.x0 - 60, p.x1 + 60) <= 0.4, `${what} has a bank too steep to climb`);
  }
});

test('water is in sight of every feature and of each end of the world, where wanderers arrive', () => {
  for (const f of features.filter(f => STATIONS.includes(f.kind))) {
    const reach = Evo.FEATURE_KINDS[f.kind].extent(f);
    assert.ok(nearestWater(f.x - reach, f.x + reach) <= sight, `${f.kind} at ${f.x}`);
  }
  for (const x of [land.edge + 30, land.width - land.edge - 30]) {
    assert.equal(terrain.waterLevelAt(x), null, `arrival at ${x} is in water`);
    assert.ok(nearestWater(x, x) <= sight, `arrival at ${x}`);
  }
});

test('the mimic trees stand well away from the fruit trees, so the two can be told apart by place', () => {
  const trees = features.filter(f => f.kind === 'tree');
  for (const fruit of trees.filter(t => t.species === 'fruit')) {
    for (const mimic of trees.filter(t => t.species === 'mimic')) assert.ok(Math.abs(fruit.x - mimic.x) >= 500, `mimic at ${mimic.x}, fruit at ${fruit.x}`);
  }
});
