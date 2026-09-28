'use strict';

function readyToBreed(org) {
  Object.assign(org.body, { reproductionCooldown: 0, sickness: 0, crowdStress: 0, libido: 1, carbs: 100, fats: 100, protein: 80, water: 90, stamina: 90 });
  org.body.ageTicks = Math.max(org.body.ageTicks, org.body.maturityTicks);
  org.body.growth = 1;
}

test('world: runs headless for a while without NaN', (Evo, assert) => {
  const world = new Evo.TerrariumWorld(600, 600);
  for (let i = 0; i < 3000; i++) world.step();
  for (const o of world.organisms) {
    for (const k of ['x', 'y', 'angle', 'speed']) assert.ok(Number.isFinite(o[k]), `${k}`);
    for (const k of ['stamina', 'carbs', 'fats', 'water', 'protein', 'joy', 'stress']) assert.ok(Number.isFinite(o.body[k]), `body.${k}`);
  }
  assert.ok(world.organisms.length > 0);
});

test('world: breeding respects the population cap and banks both parents', (Evo, assert) => {
  const world = new Evo.TerrariumWorld(600, 600);
  const [a, b] = [world.organisms.find(o => o.sex === 'FEMALE'), world.organisms.find(o => o.sex === 'MALE')];
  let born = 0;
  for (let i = 0; i < 60; i++) {
    readyToBreed(a); readyToBreed(b);
    if (world.breed(a, b)) born++;
  }
  assert.strictEqual(world.organisms.length, Evo.LIMITS.MAX_POPULATION);
  assert.strictEqual(world.stats.births, born);
  assert.ok(world.seedBank.length > 0);
  assert.strictEqual(world.addAdult('FEMALE'), null, 'full world refuses new adults');
});

test('world: juveniles cannot breed', (Evo, assert) => {
  const world = new Evo.TerrariumWorld(600, 600);
  const f = world.organisms.find(o => o.sex === 'FEMALE'), m = world.organisms.find(o => o.sex === 'MALE');
  readyToBreed(f); readyToBreed(m);
  const child = world.breed(f, m);
  assert.ok(child);
  assert.strictEqual(world.breed(child, child.sex === 'FEMALE' ? m : f), null);
});

test('world: breeding status explains the real reason', (Evo, assert) => {
  const world = new Evo.TerrariumWorld(600, 600);
  const b = world.organisms[0].body;
  readyToBreed(world.organisms[0]);
  assert.strictEqual(b.breedingBlocker(), null);
  assert.ok(b.canReproduce());
  b.stamina = 30;
  assert.strictEqual(b.breedingBlocker(), 'stamina');
  assert.strictEqual(Evo.text.breedingStatus(b), 'Too tired to breed');
  assert.ok(!b.canReproduce());
});

test('world: migrants keep their family line mutation count', (Evo, assert) => {
  const world = new Evo.TerrariumWorld(600, 600);
  const parent = world.organisms[0];
  parent.genome.mutationCount = 40;
  world.bankGenome(parent);
  world.organisms.length = 1; // Make room
  const migrant = world.addMigrant('MALE');
  assert.ok(migrant.genome.mutationCount >= 40);
  assert.strictEqual(world.stats.migrants, 1);
});

test('world: clearing food keeps lures, and carrion and lures rot', (Evo, assert) => {
  const world = new Evo.TerrariumWorld(600, 600);
  world.spawnItem('pheromone', 100, 100);
  world.spawnItem('carrion', 200, 200, { carbs: 5, protein: 5, bulk: 10 });
  world.clearFood();
  assert.deepStrictEqual(world.items.map(i => i.type), ['pheromone']);
  world.spawnItem('carrion', 200, 200, { carbs: 5, protein: 5, bulk: 10 });
  world.organisms = [];
  world.seedPrimordialPopulation = () => {}; // Keep the world empty
  for (let i = 0; i < 4000; i++) world.step();
  assert.ok(!world.items.some(i => i.type === 'pheromone' || i.type === 'carrion'));
});

test('world: seasons always change, and announce it', (Evo, assert) => {
  const world = new Evo.TerrariumWorld(600, 600);
  world.organisms = [];
  world.seedPrimordialPopulation = () => {}; // Only the clock matters here
  const seen = [];
  world.events.on('season', e => seen.push(e.season));
  let prev = world.season;
  for (let i = 0; i < Evo.SEASON_LENGTH * 4; i++) {
    world.step();
    if (world.season !== prev) prev = world.season;
  }
  assert.strictEqual(seen.length, 4);
  for (let i = 1; i < seen.length; i++) assert.notStrictEqual(seen[i], seen[i - 1]);
});

test('world: action labels match the physics', (Evo, assert) => {
  const L = (a, straight) => Evo.describeAction(a, straight);
  assert.strictEqual(L({ thrustL: true, thrustR: true }, true), 'Axial Forward');
  assert.strictEqual(L({ hopFwd: true, thrustL: true, thrustR: true }, true), 'Axial Forward');
  assert.strictEqual(L({ hopFwd: true, thrustL: true }, false), 'Left-Arc Propulsion');
  assert.strictEqual(L({ thrustR: true }, false), 'Steer Right');
});
