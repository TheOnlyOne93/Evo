'use strict';

// A world with no creatures (and none arriving), for testing its own machinery
function emptyWorld(Evo) {
  const world = new Evo.World();
  world.creatures = [];
  world.found = () => {};
  world.maybeWanderer = () => {};
  return world;
}

// Make a creature an adult ready to mate (the receptor gene's verdict is overridden)
function fertile(c, Evo) {
  c.ageTicks = Math.floor(c.lifespan * 0.5);
  c.stage = Evo.STAGE.ADULT;
  Object.defineProperty(c, 'fertile', { value: true, configurable: true });
  c.mateCooldown = 0;
}

test('world: runs headless for a while with everything finite and inside the world', (Evo, assert) => {
  const world = new Evo.World();
  for (let i = 0; i < 2400; i++) world.step();
  assert.ok(world.creatures.length > 0);
  for (const c of world.creatures) {
    for (const k of ['x', 'y', 'vx', 'vy', 'bodyTemp', 'health', 'growth']) assert.ok(Number.isFinite(c[k]), `${c.name}.${k} = ${c[k]}`);
    for (let i = 1; i < Evo.N_CHEM; i++) assert.ok(c.chem.c[i] >= 0 && c.chem.c[i] <= 1, `chemical ${i}`);
    assert.ok(c.x >= world.edge && c.x <= world.width - world.edge, `${c.name} at x ${c.x}`);
    assert.ok(c.y <= world.terrain.groundY(c.x) + c.size, `${c.name} is not underground`);
  }
  for (const item of world.items) {
    assert.ok(Number.isFinite(item.x) && Number.isFinite(item.y));
    assert.ok(item.x >= world.edge && item.x <= world.width - world.edge);
  }
});

test('world: ponds hold water only over their own span, below the rims', (Evo, assert) => {
  const t = new Evo.World().terrain;
  assert.strictEqual(t.ponds.length, 2);
  for (const p of t.ponds) {
    const mid = (p.x0 + p.x1) / 2;
    assert.strictEqual(t.waterLevelAt(mid), p.level);
    assert.ok(t.groundY(mid) > p.level + 10, 'the pond has depth');
    assert.strictEqual(t.waterLevelAt(p.x0 - 30), null);
    assert.strictEqual(t.waterLevelAt(p.x1 + 30), null);
  }
});

test('world: the clock runs day and night, and the seasons turn in order', (Evo, assert) => {
  const world = emptyWorld(Evo);
  const seen = [];
  world.events.on('season', e => seen.push(e.season.key));
  for (let day = 0; day <= Evo.SEASON_DAYS * 4; day++) {
    world.setTime(day, 0);    // Midnight
    assert.ok(world.clock.light < 0.2, 'dark at midnight');
    world.setTime(day, 0.5);  // Noon
    assert.ok(world.clock.light > 0.9, 'light at noon');
  }
  assert.deepStrictEqual(seen, ['SUMMER', 'AUTUMN', 'WINTER', 'SPRING']);
});

test('world: it is colder in winter, at night, and in the water', (Evo, assert) => {
  const world = emptyWorld(Evo);
  const pond = world.terrain.ponds[0];
  const open = world.width * 0.45;
  const at = (day, phase, x, y) => {
    world.setTime(day, phase);
    return world.temperatureAt(x, y === undefined ? world.terrain.groundY(x) - 10 : y);
  };
  const summerNoon = at(2 * Evo.SEASON_DAYS - 1, 0.5, open), summerNight = at(2 * Evo.SEASON_DAYS - 1, 0, open);
  const winterNoon = at(4 * Evo.SEASON_DAYS - 1, 0.5, open);
  assert.ok(summerNoon > summerNight && summerNoon > winterNoon);
  assert.ok(at(1, 0.5, (pond.x0 + pond.x1) / 2, pond.level + 10) < at(1, 0.5, (pond.x0 + pond.x1) / 2, pond.level - 20));
});

test('world: scent spreads through the air but never into the ground', (Evo, assert) => {
  const world = emptyWorld(Evo);
  world.items = [];
  const x = world.width * 0.45, y = world.terrain.groundY(x) - 40;
  for (let t = 0; t < 120; t++) { world.depositScent(x, y, Evo.SCENT.sweet, 0.1); world.step(); }
  assert.ok(world.sampleScent(x + 90, y, Evo.SCENT.sweet) > 0.01, 'spreads sideways');
  assert.ok(world.sampleScent(x + 90, y, Evo.SCENT.sweet) < world.sampleScent(x, y, Evo.SCENT.sweet), 'fades with distance');
  const g = world.scent.channels[Evo.SCENT.sweet];
  for (let i = 0; i < g.length; i++) if (world.scentSolid[i]) assert.strictEqual(g[i], 0);
});

test('world: mating, pregnancy, an egg and a hatchling that knows its family', (Evo, assert) => {
  const world = new Evo.World();
  world.maybeWanderer = () => {};
  const mother = world.creatures.find(c => c.sex === 'FEMALE');
  const father = world.creatures.find(c => c.sex === 'MALE');
  world.creatures = [mother, father];
  fertile(mother, Evo); fertile(father, Evo);
  father.x = mother.x + 5; father.y = mother.y;
  for (let i = 0; i < 500 && !mother.pregnancy; i++) world.tryMating();
  assert.ok(mother.pregnancy, 'she is pregnant');
  assert.strictEqual(world.stats.matings, 1);
  assert.strictEqual(world.seedBank.length, 2, 'both parents are banked');

  mother.pregnancy.progress = 1;
  mother.onGround = true;
  mother.physiology(world);
  const egg = world.items.find(i => i.type === 'egg');
  assert.ok(egg && !mother.pregnancy, 'the egg is laid');
  assert.ok(egg.reserves.water > 0, 'the egg carries her reserves');

  let baby = null;
  world.events.on('hatch', e => { baby = e.creature; });
  egg.progress = 1;
  world.moveItems();
  assert.ok(baby, 'it hatches');
  assert.strictEqual(baby.stage, Evo.STAGE.BABY);
  assert.strictEqual(baby.motherId, mother.id);
  assert.strictEqual(baby.fatherId, father.id);
  assert.strictEqual(baby.generation, 2);
  assert.ok(world.history.some(h => h.id === baby.id));
});

test('world: a hatching egg does not make the next item skip its tick', (Evo, assert) => {
  const world = emptyWorld(Evo);
  world.items = [];
  const egg = world.spawnItem('egg', world.width / 2, undefined, { genome: Evo.Genome.founder(), reserves: { ...Evo.EGG_CONTENTS }, parents: null, generation: 1, progress: 1, incubationTicks: 5000 });
  const ball = world.spawnItem('ball', world.width / 2 + 40, undefined, { hue: 0 });
  world.moveItems();
  assert.ok(!world.items.includes(egg) && world.creatures.length === 1, 'the egg hatched');
  assert.strictEqual(ball.age, 1, 'the item after the egg still moved this tick');
});

test('world: the population cap holds for adults and hatchlings', (Evo, assert) => {
  const world = new Evo.World();
  while (world.creatures.length < Evo.LIMITS.MAX_POPULATION) assert.ok(world.addAdult('FEMALE'));
  assert.strictEqual(world.addAdult('MALE'), null, 'a full world refuses newcomers');
  const egg = world.spawnItem('egg', world.width / 2, undefined, { genome: Evo.Genome.founder(), reserves: { ...Evo.EGG_CONTENTS }, parents: null, generation: 1, progress: 1, incubationTicks: 5000 });
  world.moveItems();
  assert.ok(world.items.includes(egg), 'the egg waits');
  assert.strictEqual(world.creatures.length, Evo.LIMITS.MAX_POPULATION);
});

test('world: a death leaves carrion and a record, and an empty world is re-founded', (Evo, assert) => {
  const world = new Evo.World();
  world.maybeWanderer = () => {};
  const c = world.creatures[0];
  world.bankGenome(c);
  c.health = -0.001;
  c.damageLog = { poison: 0.5, cold: 0.1 };
  c.physiology(world);
  assert.ok(c.dead);
  assert.strictEqual(c.causeOfDeath, 'poison', 'named after the worst recent damage');
  world.handleDeath(c);
  assert.ok(!world.creatures.includes(c));
  assert.ok(world.items.some(i => i.type === 'carrion' && i.contents.gutProtein > 0));
  const rec = world.history.find(h => h.id === c.id);
  assert.ok(rec.died !== null && rec.cause);
  assert.strictEqual(world.stats.deaths[rec.cause], 1);

  world.creatures = [];
  world.items = world.items.filter(i => i.type !== 'egg');
  world.step();
  assert.strictEqual(world.creatures.length, 2, 'a founding pair returns');
  assert.strictEqual(world.stats.refoundings, 1);
});

test('world: the hand pats, slaps, carries and throws', (Evo, assert) => {
  const world = new Evo.World();
  const c = world.creatures[0];
  world.pat(c);
  assert.strictEqual(c.stim.gentle, 1);
  const injury = c.injury;
  world.slap(c);
  assert.strictEqual(c.stim.impact, 1);
  assert.ok(c.injury > injury);

  world.grab({ creature: c }, 1000, 300);
  assert.ok(c.held);
  world.moveHand(1200, 250);
  assert.strictEqual(c.x, 1200);
  world.step();
  assert.strictEqual(c.x, 1200, 'a held creature stays in the hand');
  world.releaseHand(3, -2);
  assert.ok(!c.held && c.vx === 3 && world.hand.holding === null);

  const fruit = world.dropItem('fruit', 5, 100);
  assert.strictEqual(fruit.x, world.edge, 'dropped items land inside the world');
  world.grab({ item: fruit }, 900, 200);
  assert.strictEqual(fruit.held, 'hand');
  world.removeItem(fruit);
  assert.strictEqual(world.hand.holding, null, 'eaten or rotted items leave the hand');
});

test('world: food grows back on the plants', (Evo, assert) => {
  const world = emptyWorld(Evo);
  world.items = [];
  for (let t = 0; t < Evo.DAY_TICKS / 2; t++) world.step();
  const kinds = new Set(world.items.map(i => i.type));
  for (const k of ['fruit', 'grain']) assert.ok(kinds.has(k), `${k} grew`);
});

test('world: a life-history gene that switches on later changes the lifespan without undoing the stage', (Evo, assert) => {
  const world = emptyWorld(Evo);
  const genes = [...Evo.FOUNDER_GENOME, { gene: 'Life history', stage: Evo.STAGE.ADULT, lifespan: 1, gestation: 0.4 }];
  const genome = Evo.Genome.founder('X', genes);
  const before = genome.develop(Evo.STAGE.YOUTH).lifespanTicks;
  const c = world.addCreature(genome, world.width / 2, { ageTicks: Math.ceil(before * Evo.STAGES[Evo.STAGE.YOUTH].until) - 2, growth: 1 });
  assert.strictEqual(c.stage, Evo.STAGE.YOUTH);
  for (let t = 0; t < 10; t++) c.step(world);
  assert.strictEqual(c.stage, Evo.STAGE.ADULT, 'it grew up and stayed grown up');
  assert.ok(c.lifespan > before, 'the later gene lengthened its life');
  assert.strictEqual(c.lifespan, c.traits.lifespanTicks);
});
