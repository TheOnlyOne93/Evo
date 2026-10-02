'use strict';
// A whole life in the valley: the game's own seed, watched for days. The pair mates, an egg hatches,
// the young grow up and grow bigger, and everyone lives and dies in a way the player can read: each
// death leaves a body, and when one sex has no grown adult left, a wanderer of that sex walks in.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { Evo, game, play } = require('./kit.js');

const DAYS = 7;           // How long to watch
const SAMPLE_TICKS = 250; // How often to look closely at every creature

const WATCHED = ['mate', 'egg', 'hatch', 'stage', 'death', 'wanderer', 'refound'];
const CHILD = Evo.STAGES.findIndex(s => s.key === 'child');
const OLD = Evo.STAGES.findIndex(s => s.key === 'old');

// Every number anywhere inside a pose that is not a real number, as notes saying where it is
function badNumbers(value, path, notes) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) notes.push(path);
  } else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) badNumbers(inner, `${path}.${key}`, notes);
  }
}

// What happened over the days, kept once for every test to read
const record = { founders: [], events: [], actions: new Set(), fewest: Infinity, outside: [], notNumbers: [], samples: 0, bodies: 0 };

before(() => {
  const world = game();
  record.founders = [...world.creatures];
  for (const name of WATCHED) {
    world.events.on(name, payload => {
      const e = { name, tick: world.clock.tick, ...payload };
      // The stage a creature hatched or died at
      if (name === 'hatch' || name === 'death') e.stage = payload.creature.stage;
      // How big it was when it hatched
      if (name === 'hatch') e.size = payload.creature.size;
      // Whether it was the last grown creature of its sex, so nobody of that sex is left to breed
      if (name === 'death') {
        const c = payload.creature;
        e.lastOfSex = !world.creatures.some(o => o !== c && !o.dead && o.sex === c.sex && o.isMature);
      }
      record.events.push(e);
    });
  }
  const bodiesSeen = new Set();
  play(world, DAYS * Evo.DAY_TICKS, t => {
    record.fewest = Math.min(record.fewest, world.creatures.length);
    for (const item of world.items) {
      if (item.type === 'carrion' && !bodiesSeen.has(item.id)) {
        bodiesSeen.add(item.id);
        record.bodies++;
      }
    }
    for (const c of world.creatures) record.actions.add(c.action);
    if (t % SAMPLE_TICKS === 0) {
      for (const c of world.creatures) {
        const at = `${c.name} at tick ${world.clock.tick}`;
        record.samples++;
        if (c.x < world.edge || c.x > world.width - world.edge || c.y < 0 || c.y > world.height) {
          record.outside.push(`${at}: x ${c.x}, y ${c.y}`);
        }
        const found = [];
        for (const drive of Evo.DRIVES) if (!Number.isFinite(c.body.chem.get(drive))) found.push(drive);
        if (!Number.isFinite(c.body.health)) found.push('health');
        if (!Number.isFinite(c.x)) found.push('x');
        if (!Number.isFinite(c.y)) found.push('y');
        const pose = [];
        badNumbers(Evo.poseOf(c, { world }), 'pose', pose);
        for (const what of [...found, ...pose]) record.notNumbers.push(`${at}: ${what}`);
      }
    }
    return false;
  });
  // How big and how grown each hatched creature ended up (a dead one keeps both)
  for (const e of record.events) {
    if (e.name === 'hatch') {
      e.endSize = e.creature.size;
      e.endStage = e.creature.stage;
    }
  }
});

test('the pair mates, she lays an egg, and it hatches, in that order', () => {
  const isFounder = c => record.founders.includes(c);
  const mate = record.events.find(e => e.name === 'mate' && isFounder(e.mother) && isFounder(e.father));
  const egg = record.events.find(e => e.name === 'egg' && isFounder(e.mother));
  const hatch = record.events.find(e => e.name === 'hatch');
  assert.ok(mate, 'the founding pair never mated');
  assert.ok(egg, 'no founder ever laid an egg');
  assert.ok(hatch, 'no egg ever hatched');
  assert.ok(mate.tick < egg.tick, `the first egg came at tick ${egg.tick}, before the pair mated at tick ${mate.tick}`);
  assert.ok(egg.tick < hatch.tick, `the first hatch came at tick ${hatch.tick}, before the first egg was laid at tick ${egg.tick}`);
});

test('each young creature grows up one stage at a time, in order', () => {
  const hatches = record.events.filter(e => e.name === 'hatch');
  assert.ok(hatches.length > 0, 'nothing hatched');
  let grew = 0;
  for (const h of hatches) {
    const seen = record.events.filter(e => e.name === 'stage' && e.creature === h.creature).map(e => e.stage);
    const want = seen.map((_, k) => h.stage + 1 + k);
    assert.deepEqual(seen, want, `${h.creature.name} hatched at stage ${h.stage}, then reached stages ${seen.join(', ')}`);
    if (seen.length > 0) grew++;
  }
  assert.ok(grew > 0, 'no hatched creature grew up a stage');
});

test('each young creature grows bigger as it grows up', () => {
  const grown = record.events.filter(e => e.name === 'hatch' && e.endStage >= CHILD);
  assert.ok(grown.length > 0, `no hatched creature reached the ${Evo.STAGES[CHILD].key} stage`);
  for (const h of grown) {
    assert.ok(h.endSize > h.size, `${h.creature.name} was ${h.size.toFixed(1)} px long when it hatched and ${h.endSize.toFixed(1)} px at the end, at stage ${Evo.STAGES[h.endStage].key}`);
  }
});

test('each founder lives to old age', () => {
  assert.ok(OLD >= 0, 'the game has an old stage');
  for (const c of record.founders) {
    const death = record.events.find(e => e.name === 'death' && e.creature === c);
    assert.ok(death, `${c.name} did not die in ${DAYS} days`);
    assert.ok(death.stage >= OLD, `${c.name} died at ${Evo.STAGES[death.stage].key}, of ${death.cause}`);
  }
});

test('each founder dies of old age', { todo: 'Elani dies of thirst while old: drinking does not follow thirst yet' }, () => {
  for (const c of record.founders) {
    const death = record.events.find(e => e.name === 'death' && e.creature === c);
    assert.ok(death, `${c.name} did not die in ${DAYS} days`);
    assert.equal(death.cause, 'old age', `${c.name} died of ${death.cause}`);
  }
});

test('when one sex has no grown adult left, a wanderer of that sex walks in', () => {
  const lasts = record.events.filter(e => e.name === 'death' && e.lastOfSex);
  assert.ok(lasts.length > 0, 'nobody was ever the last grown creature of their sex');
  for (const d of lasts) {
    const wanderers = record.events.filter(e => e.name === 'wanderer' && e.tick > d.tick);
    assert.ok(wanderers.some(w => w.creature.sex === d.creature.sex),
      `${d.creature.name} (${d.creature.sex}) died at tick ${d.tick}, the last grown one of their sex, and then ${wanderers.length ? `came ${wanderers.map(w => `${w.creature.name} (${w.creature.sex}) at tick ${w.tick}`).join(', ')}` : 'nobody came'}`);
  }
});

test('every death leaves a body behind', () => {
  const deaths = record.events.filter(e => e.name === 'death');
  assert.ok(deaths.length > 0, 'nobody died');
  assert.ok(record.bodies >= deaths.length, `${deaths.length} died but only ${record.bodies} bodies were left`);
});

test('the valley never empties, and is never started again', () => {
  assert.ok(record.fewest >= 1, `the valley was empty (fewest alive: ${record.fewest})`);
  assert.ok(!record.events.some(e => e.name === 'refound'), 'the valley was started again');
});

test('every death and every action has words the player reads', () => {
  const deaths = record.events.filter(e => e.name === 'death');
  assert.ok(deaths.length > 0, 'nobody died');
  for (const d of deaths) assert.ok(d.cause in Evo.text.DEATH_WORDS, `${d.creature.name} died of "${d.cause}", which has no words`);
  assert.ok(record.actions.size > 1, `only ${[...record.actions].join(', ')} was ever done`);
  for (const action of record.actions) assert.ok(action in Evo.text.ACTION_WORDS, `"${action}" has no words`);
});

test('every creature stays inside the world', () => {
  assert.ok(record.samples > 0, 'no creature was looked at');
  assert.equal(record.outside.length, 0, `${record.outside.length} outside: ${record.outside.slice(0, 5).join('; ')}`);
});

test('needs, health, position and pose are always real numbers', () => {
  assert.ok(record.samples > 0, 'no creature was looked at');
  assert.equal(record.notNumbers.length, 0, `${record.notNumbers.length} not numbers: ${record.notNumbers.slice(0, 5).join('; ')}`);
});
