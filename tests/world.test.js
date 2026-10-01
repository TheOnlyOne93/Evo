'use strict';

// A world with no creatures (and none arriving), for testing its own machinery
function emptyWorld(Evo) {
  const world = new Evo.World();
  world.creatures = [];
  world.found = () => {};
  world.maybeWanderer = () => {};
  return world;
}

// A ready-to-hatch founder egg at x
function eggAt(world, Evo, x) {
  return world.spawnItem('egg', x, undefined, { genome: Evo.Genome.founder(), reserves: { ...Evo.EGG_CONTENTS }, parents: null, generation: 1, progress: 1, incubationTicks: 5000 });
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
    for (const k of ['x', 'y', 'vx', 'vy']) assert.ok(Number.isFinite(c[k]), `${c.name}.${k} = ${c[k]}`);
    for (const k of ['temperature', 'health', 'growth']) assert.ok(Number.isFinite(c.body[k]), `${c.name}.body.${k} = ${c.body[k]}`);
    for (let i = 1; i < Evo.N_CHEM; i++) assert.ok(c.body.chem.c[i] >= 0 && c.body.chem.c[i] <= 1, `chemical ${i}`);
    assert.ok(c.x >= world.edge && c.x <= world.width - world.edge, `${c.name} at x ${c.x}`);
    assert.ok(c.y <= world.terrain.groundY(c.x) + 1, `${c.name} is not underground`);
  }
  for (const item of world.items) {
    assert.ok(Number.isFinite(item.x) && Number.isFinite(item.y));
    assert.ok(item.x >= world.edge && item.x <= world.width - world.edge);
  }
});

test('world: ponds hold water only over their own span, below the rims', (Evo, assert) => {
  const t = new Evo.World().terrain;
  assert.ok(t.ponds.length > 0);
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
  const keys = Evo.SEASONS.map(s => s.key), from = keys.indexOf('SUMMER');
  assert.deepStrictEqual(seen, keys.map((_, i) => keys[(from + i) % keys.length]));
});

test('world: it is colder in winter, at night, and in the water', (Evo, assert) => {
  const world = emptyWorld(Evo);
  const pond = world.terrain.ponds[0];
  const open = world.ballX; // Open ground: nothing stands there
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
  const x = world.ballX, y = world.terrain.groundY(x) - 40;
  for (let t = 0; t < 120; t++) { world.depositScent(x, y, Evo.SCENT.sweet, 0.1); world.step(); }
  assert.ok(world.sampleScent(x + 90, y, Evo.SCENT.sweet) > 0.01, 'spreads sideways');
  assert.ok(world.sampleScent(x + 90, y, Evo.SCENT.sweet) < world.sampleScent(x, y, Evo.SCENT.sweet), 'fades with distance');
  const g = world.scent.channels[Evo.SCENT.sweet];
  for (let i = 0; i < g.length; i++) if (world.scentSolid[i]) assert.strictEqual(g[i], 0);
});

test('world: a nose reads only the air, so the ground beside it does not dim the scent', (Evo, assert) => {
  const world = emptyWorld(Evo);
  const ch = Evo.SCENT.sweet, g = world.scent.channels[ch];
  for (let i = 0; i < g.length; i++) g[i] = world.scentSolid[i] ? 0 : 1;
  // Air everywhere is 1, however close to the ground and whatever the slope there
  for (let x = 0; x <= world.width; x += 7) {
    const ground = world.terrain.groundY(x);
    for (const y of [ground - 30, ground - 10, ground]) assert.ok(Math.abs(world.sampleScent(x, y, ch) - 1) < 1e-6, `air at ${x}, ${Math.round(y)}`);
  }
  assert.strictEqual(world.sampleScent(world.width / 2, world.height - 5, ch), 0, 'deep in the ground there is none');
});

test('world: mating, pregnancy, an egg and a hatchling that knows its family', (Evo, assert) => {
  const world = new Evo.World();
  world.maybeWanderer = () => {};
  const mother = world.creatures.find(c => c.sex === 'FEMALE');
  const father = world.creatures.find(c => c.sex === 'MALE');
  world.creatures = [mother, father];
  fertile(mother, Evo); fertile(father, Evo);
  father.x = mother.x + 5; father.y = mother.y;
  for (let i = 0; i < 500 && !mother.body.pregnancy; i++) world.tryMating();
  assert.ok(mother.body.pregnancy, 'she is pregnant');
  assert.strictEqual(world.stats.matings, 1);
  assert.strictEqual(world.seedBank.length, 2, 'both parents are banked');

  mother.body.pregnancy.progress = 1;
  mother.onGround = true;
  mother.body.physiology(mother, world);
  assert.ok(!world.items.some(i => i.type === 'egg'), 'the egg waits until every body has run');
  world.applyQueuedWrites();
  const egg = world.items.find(i => i.type === 'egg');
  assert.ok(egg && !mother.body.pregnancy, 'the egg is laid');
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

test('world: an egg the player places is filled as a mother of its genome would fill it', (Evo, assert) => {
  const world = emptyWorld(Evo);
  const genome = Evo.Genome.founder('FEMALE'), x = world.width / 2;
  const egg = world.addEgg(x, world.terrain.groundY(x) - 40, { genome });
  const share = Evo.eggShare(genome.develop());
  assert.ok(share < 1, 'a founder fills an egg to less than a standard egg');
  for (const [k, v] of Object.entries(Evo.EGG_CONTENTS)) assert.ok(Math.abs(egg.reserves[k] - v * share) < 1e-12, `${k}: ${egg.reserves[k]} vs ${v * share}`);
});

test('world: a hatching egg does not make the next item skip its tick', (Evo, assert) => {
  const world = emptyWorld(Evo);
  world.items = [];
  const egg = eggAt(world, Evo, world.width / 2);
  const ball = world.spawnItem('ball', world.width / 2 + 40, undefined, { hue: 0 });
  world.moveItems();
  assert.ok(!world.items.includes(egg) && world.creatures.length === 1, 'the egg hatched');
  assert.strictEqual(ball.age, 1, 'the item after the egg still moved this tick');
});

test('world: the population cap holds for adults and hatchlings', (Evo, assert) => {
  const world = new Evo.World();
  while (world.creatures.length < Evo.LIMITS.MAX_POPULATION) assert.ok(world.addAdult('FEMALE'));
  assert.strictEqual(world.addAdult('MALE'), null, 'a full world refuses newcomers');
  const egg = eggAt(world, Evo, world.width / 2);
  world.moveItems();
  assert.ok(world.items.includes(egg), 'the egg waits');
  assert.strictEqual(world.creatures.length, Evo.LIMITS.MAX_POPULATION);
});

test('world: a death leaves carrion and a record, and an empty world is re-founded', (Evo, assert) => {
  const world = new Evo.World();
  world.maybeWanderer = () => {};
  const c = world.creatures[0];
  world.bankGenome(c);
  c.body.health = -0.001;
  c.body.damageLog = { poison: 0.5, cold: 0.1 };
  c.tickBody(world);
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
  assert.strictEqual(c.body.stim.gentle, 1);
  const injury = c.body.injury;
  world.slap(c);
  assert.strictEqual(c.body.stim.impact, 1);
  assert.ok(c.body.injury > injury);

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
  assert.strictEqual(fruit.heldBy, 'hand');
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
  const genes = [...Evo.FOUNDER_GENOMES.FEMALE, { gene: 'Life history', stage: Evo.STAGE.ADULT, lifespan: 1, gestation: 0.4 }];
  const genome = Evo.Genome.founder('FEMALE', genes);
  const before = genome.develop(Evo.STAGE.YOUTH).lifespanTicks;
  const c = world.addCreature(genome, world.width / 2, { ageTicks: Math.ceil(before * Evo.STAGES[Evo.STAGE.YOUTH].until) - 2, growth: 1 });
  assert.strictEqual(c.stage, Evo.STAGE.YOUTH);
  for (let t = 0; t < 10; t++) c.step(world);
  assert.strictEqual(c.stage, Evo.STAGE.ADULT, 'it grew up and stayed grown up');
  assert.ok(c.lifespan > before, 'the later gene lengthened its life');
  assert.strictEqual(c.lifespan, c.traits.lifespanTicks);
});

test('world: a brain-building gene that switches on after birth has no effect, even in a creature that starts grown', (Evo, assert) => {
  const world = emptyWorld(Evo);
  // Count 1 would make about 1.6 times the thinking cells if it took effect
  const late = { gene: 'Anatomy', stage: Evo.STAGE.ADULT, region: 'cortex', shift: 0.5, lateral: 0.5, size: 0.5, count: 1 };
  const genome = Evo.Genome.founder('FEMALE', [...Evo.FOUNDER_GENOMES.FEMALE, late]);
  const baby = world.addCreature(genome, world.width / 2);
  const adult = world.addCreature(genome, world.width / 2, { ageTicks: Math.floor(baby.lifespan * 0.5), growth: 1 });
  assert.ok(adult.stage >= Evo.STAGE.ADULT, `stage ${adult.stage}`);
  const plain = new Evo.Brain(Evo.Genome.founder('FEMALE').develop()).lobes.cortex.length;
  for (const c of [baby, adult]) assert.strictEqual(c.brain.lobes.cortex.length, plain);
});

// Two adults side by side in a world of their own; swap puts the second one first in the array.
// Long timers keep them from calling, grabbing or jumping by themselves.
function pair(Evo, swap) {
  Evo.seed(1);
  const world = emptyWorld(Evo);
  const a = world.addAdult('FEMALE', { x: world.width / 2 }), b = world.addAdult('MALE', { x: world.width / 2 + 20 });
  if (swap) world.creatures.reverse();
  for (const c of [a, b]) c.callTimer = c.grabCooldown = c.jumpCooldown = 1e6;
  return { world, a, b };
}

// Run fn(world) at the end of c's act phase in the next tick
function onNextAct(world, c, fn) {
  const tick = world.clock.tick + 1, act = c.act;
  c.act = w => { act.call(c, w); if (w.clock.tick === tick) fn(w); };
}

test('world: two creatures hear each other\'s calls for two ticks each, whatever their order', (Evo, assert) => {
  for (const swap of [false, true]) {
    const { world, a, b } = pair(Evo, swap);
    for (const c of [a, b]) onNextAct(world, c, w => w.makeSound(c));
    const heard = { a: 0, b: 0 };
    for (let t = 0; t < 6; t++) {
      world.step();
      for (const [k, c] of Object.entries({ a, b })) if (c.senses.hear.some(v => v > 0)) heard[k]++;
    }
    assert.deepStrictEqual(heard, { a: 2, b: 2 }, swap ? 'swapped' : 'in order');
  }
});

test('world: a nuzzle and a shove reach their targets in the tick they happen, whatever the order', (Evo, assert) => {
  const felt = [false, true].map(swap => {
    const { world, a, b } = pair(Evo, swap);
    onNextAct(world, a, () => world.nuzzle(a, b));
    onNextAct(world, b, () => world.shove(b, a));
    world.step();
    return { gentle: b.body.stim.gentle, flinch: a.body.stim.flinch, vy: a.vy, airborne: !a.onGround };
  });
  assert.deepStrictEqual(felt[0], felt[1]);
  assert.ok(felt[0].gentle > 0 && felt[0].gentle < 0.5 && felt[0].flinch > 0 && felt[0].flinch < 1, 'felt, then faded once, in the same tick');
  assert.ok(felt[0].vy < 0 && felt[0].airborne, 'the shoved one is already off the ground');
});

test('world: a carried item sits at its carrier\'s mouth after the carrier moves', (Evo, assert) => {
  const { world, a } = pair(Evo, false);
  const ball = world.spawnItem('ball', a.mouthX, undefined, { hue: 0 });
  world.pickUpItem(a, ball);
  const x0 = a.x;
  a.vx = 2;
  world.step();
  assert.ok(a.x !== x0, 'the carrier moved');
  assert.strictEqual(ball.x, a.mouthX + a.facing * ball.radius * 0.5);
  assert.strictEqual(ball.y, a.mouthY + ball.radius);
});

test('world: scent a body gives off reaches every creature\'s nose in the same tick, whatever the order', (Evo, assert) => {
  const alarm = Evo.SCENT.alarm;
  for (const swap of [false, true]) {
    const { world, a, b } = pair(Evo, swap);
    b.x = a.x; b.facing = a.facing;
    // Only a gives off alarm scent
    for (const c of [a, b]) {
      const effect = c.body.chem.effect.bind(c.body.chem);
      c.body.chem.effect = k => (k === 'scentAlarm' ? (c === a ? 1 : 0) : effect(k));
    }
    assert.strictEqual(Math.max(...world.scent.channels[alarm]), 0);
    world.step();
    for (const c of [a, b]) assert.ok(Math.max(c.senses.scentsL[alarm], c.senses.scentsR[alarm]) > 0, `${c === a ? 'a' : 'b'} smells it${swap ? ' (swapped)' : ''}`);
  }
});

// What makes a first pair the same in every world: the DNA, the wiring of the brain, the name, the
// place, the age and which way each one faces
function firstPair(Evo, seed) {
  Evo.seed(seed);
  const world = new Evo.World();
  return world.creatures.map(c => ({
    sex: c.sex, name: c.name, stage: c.stage, x: c.x, ageTicks: c.ageTicks, facing: c.facing, dna: Array.from(c.genome.dna),
    wiring: Object.fromEntries(['sSrc', 'sDst', 'sW'].map(k => [k, Array.from(c.brain[k].subarray(0, c.brain.S))]))
  }));
}

test('world: the first pair is the same in every world, and they face each other', (Evo, assert) => {
  const a = firstPair(Evo, 1), b = firstPair(Evo, 5);
  assert.deepStrictEqual(a, b, 'the same DNA, wiring, names, places, ages and facing on two seeds');
  assert.deepStrictEqual(a.map(c => c.sex), ['FEMALE', 'MALE']);
  assert.deepStrictEqual(a.map(c => c.name), ['Elani', 'Fenro']);
  assert.ok(a.every(c => c.stage === Evo.STAGE.ADULT), 'both arrive grown, old enough to mate');
  assert.ok(a[0].wiring.sSrc.length > 1000, 'a grown brain');
  assert.deepStrictEqual(a.map(c => c.dna), ['FEMALE', 'MALE'].map(sex => Array.from(Evo.Genome.founder(sex).dna)), 'the starting genomes');
  const land = Evo.buildLandscape();
  assert.deepStrictEqual(a.map(c => c.x), [land.founderX.FEMALE, land.founderX.MALE]);
  assert.deepStrictEqual(a.map(c => c.facing), [1, -1], 'she is left of him and looks right, he looks left');
  const lifespan = Evo.Genome.founder('FEMALE').develop().lifespanTicks;
  assert.strictEqual(a[0].ageTicks, Math.floor(lifespan * Evo.WORLD.ADULT_ARRIVAL_AGE));
});

test('world: an adult can be given the syllables of its name and the way it faces; left out, they are chance', (Evo, assert) => {
  const world = emptyWorld(Evo);
  const given = world.addAdult('FEMALE', { syllables: ['ka', 'mi'], facing: -1 });
  assert.strictEqual(given.name, 'Kami');
  assert.deepStrictEqual(given.syllables, ['ka', 'mi']);
  assert.strictEqual(given.facing, -1);
  const seen = new Set();
  for (let i = 0; i < 12; i++) {
    const c = world.addAdult('MALE');
    assert.strictEqual(c.syllables.length, 2);
    assert.strictEqual(c.name.toLowerCase(), c.syllables.join(''));
    seen.add(c.facing);
  }
  assert.deepStrictEqual([...seen].sort(), [-1, 1], 'it faces either way');
});

test('world: a new world stays at two grown adults until babies arrive, as newcomers come only to rescue a sex', (Evo, assert) => {
  const world = new Evo.World();
  const pair = [...world.creatures];
  world.maybeWanderer();
  assert.strictEqual(world.creatures.length, 2, 'one of each sex is enough');
  for (let t = 0; t < 2 * 1800 + 100; t++) world.step(); // more than two wanderer intervals (WANDER_INTERVAL)
  assert.ok(pair.every(c => world.creatures.includes(c)), 'both founders are still alive');
  assert.strictEqual(world.stats.wanderers, 0);
});

// Two banked genomes of each sex, each changed by heavy mutation so that they differ from each other
// and from the starting genome
function bankedGenomes(Evo) {
  return ['FEMALE', 'MALE'].flatMap(sex => [1, 2].map(n => ({ genome: Evo.Genome.founder(sex).cloneWithMutation(0.05), generation: 3 + n })));
}

test('world: a wanderer is an exact copy of a banked genome of its sex, never a changed one', (Evo, assert) => {
  const world = new Evo.World();
  const banked = world.seedBank = bankedGenomes(Evo);
  for (const sex of ['FEMALE', 'MALE']) {
    const same = banked.filter(b => b.genome.develop().sex === sex);
    for (let i = 0; i < 6; i++) {
      world.creatures = [world.addAdult(sex === 'FEMALE' ? 'MALE' : 'FEMALE')]; // only the other sex is left
      world.maybeWanderer();
      const c = world.creatures[world.creatures.length - 1];
      assert.strictEqual(c.sex, sex);
      const source = same.find(b => Buffer.from(b.genome.dna).equals(Buffer.from(c.genome.dna)));
      assert.ok(source, 'its DNA is a banked one, byte for byte');
      assert.notStrictEqual(c.genome, source.genome, 'a copy, not the banked genome itself');
      assert.strictEqual(c.generation, source.generation);
    }
  }
  assert.strictEqual(world.stats.wanderers, 12);
});

test('world: with no banked genome of its sex, a wanderer has the starting genome', (Evo, assert) => {
  const world = new Evo.World();
  world.creatures = [world.creatures.find(c => c.sex === 'MALE')];
  world.seedBank = [];
  world.maybeWanderer();
  assert.deepStrictEqual(world.creatures[1].genome.dna, Evo.Genome.founder('FEMALE').dna, 'an empty bank');
  assert.strictEqual(world.creatures[1].generation, 1);
  world.creatures = [world.creatures[0]];
  world.seedBank = bankedGenomes(Evo).filter(b => b.genome.sexChrom === 'Y');
  world.maybeWanderer();
  assert.deepStrictEqual(world.creatures[1].genome.dna, Evo.Genome.founder('FEMALE').dna, 'a bank of males only');
});

test('world: a world started again after everyone died has exact copies of banked genomes', (Evo, assert) => {
  const world = new Evo.World();
  const banked = world.seedBank = bankedGenomes(Evo);
  world.creatures = [];
  world.items = world.items.filter(i => i.type !== 'egg');
  world.step();
  assert.strictEqual(world.stats.refoundings, 1);
  assert.deepStrictEqual(world.creatures.map(c => c.sex), ['FEMALE', 'MALE']);
  for (const c of world.creatures) {
    const source = banked.find(b => Buffer.from(b.genome.dna).equals(Buffer.from(c.genome.dna)) && b.genome.sexChrom === c.genome.sexChrom);
    assert.ok(source, `${c.sex}: its DNA is a banked one, byte for byte`);
    assert.strictEqual(c.generation, source.generation);
  }
});

test('world: a world started again with nothing banked has the starting pair, named and facing each other', (Evo, assert) => {
  const world = new Evo.World();
  const first = firstPair(Evo, 12345);
  world.creatures = [];
  world.step();
  assert.strictEqual(world.stats.refoundings, 0, 'nothing was banked');
  assert.deepStrictEqual(world.creatures.map(c => [c.sex, c.name, c.x, c.facing]), first.map(c => [c.sex, c.name, c.x, c.facing]));
  assert.deepStrictEqual(world.creatures.map(c => Array.from(c.genome.dna)), first.map(c => c.dna));
});
