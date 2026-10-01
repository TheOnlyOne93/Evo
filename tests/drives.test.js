'use strict';

test('drives: a stimulus releases exactly amount x strength of each chemical, clamped to 0..1', (Evo, assert) => {
  const { CHEM, STIMULUS } = Evo;
  const b = new Evo.Biochemistry();
  b.configure({ reactions: [], emitters: [], receptors: [], halfLives: {},
    stimuli: [{ stimulus: STIMULUS.patted, chem1: CHEM.reward, amount1: 0.2, chem2: CHEM.fear, amount2: -0.1 },
      { stimulus: STIMULUS.slapped, chem1: 0, amount1: 0.4, chem2: CHEM.pain, amount2: 0.3 }] });
  b.set('fear', 0.5);
  b.stimulate(STIMULUS.patted, 0.5);
  assert.ok(Math.abs(b.get('reward') - 0.1) < 1e-6 && Math.abs(b.get('fear') - 0.45) < 1e-6);
  b.stimulate(STIMULUS.patted, 10);
  assert.strictEqual(b.get('reward'), 1, 'clamped at 1');
  assert.strictEqual(b.get('fear'), 0, 'clamped at 0');
  b.stimulate(STIMULUS.slapped);
  assert.ok(Math.abs(b.get('pain') - 0.3) < 1e-6, 'chemical slot 0 is nothing');
  b.stimulate(STIMULUS.woke);
  assert.ok(Math.abs(b.get('pain') - 0.3) < 1e-6, 'a stimulus without genes does nothing');
});

test('drives: a stimulus gene survives encoding and decodes to its event and amounts', (Evo, assert) => {
  const spec = { gene: 'Stimulus', stimulus: Evo.STIMULUS.wasShoved, chem1: 'anger', amount1: 0.1, chem2: 'fear', amount2: -0.05 };
  const traits = new Evo.Genome([0, ...Evo.encodeGene(spec), 0], 'X').develop();
  assert.strictEqual(traits.stimuli.length, 1);
  const s = traits.stimuli[0];
  assert.strictEqual(Evo.STIMULI[s.stimulus], 'wasShoved');
  assert.strictEqual(s.chem1, Evo.CHEM.anger); assert.strictEqual(s.chem2, Evo.CHEM.fear);
  assert.ok(Math.abs(s.amount1 - 0.1) < 0.002 && Math.abs(s.amount2 + 0.05) < 0.002);
});

test('drives: each thing the world does raises its stimulus on the right creature', (Evo, assert) => {
  const world = new Evo.World();
  const [a, b] = world.creatures;
  const seen = [];
  for (const c of [a, b]) c.stimulate = function (key) { seen.push(`${c === a ? 'a' : 'b'}:${key}`); };
  world.pat(a); world.slap(a); world.nuzzle(a, b); world.shove(b, a); world.makeSound(a);
  const ball = world.spawnItem('ball', a.x, undefined, { hue: 0 });
  world.pickUpItem(a, ball); world.dropCarried(a);
  assert.deepStrictEqual(seen, ['a:patted', 'a:slapped', 'a:nuzzled', 'b:wasNuzzled', 'b:shoved', 'a:wasShoved', 'a:called', 'a:grabbed', 'a:played', 'a:dropped']);
});

test('drives: walking through a thornbush pricks, and the founder feels it as pain', (Evo, assert) => {
  const world = new Evo.World();
  world.creatures.length = 1;
  // The map has no thorn bush: the player's thorn tool plants one (on open ground, where the ball starts)
  const c = world.creatures[0], bush = world.dropItem('thorn', world.ballX, 0);
  let pricks = 0;
  const stimulate = c.stimulate;
  c.stimulate = function (key, s) { if (key === 'pricked') pricks++; return stimulate.call(this, key, s); };
  c.body.asleep = false;
  Object.assign(c, { x: bush.x, y: bush.y, vx: 1 });
  c.body.chem.set('pain', 0);
  world.prickCreatures();
  assert.strictEqual(pricks, 1, 'pricked on contact');
  assert.ok(c.body.chem.get('pain') > 0.1, `pain ${c.body.chem.get('pain').toFixed(3)}`);
  world.prickCreatures();
  assert.strictEqual(pricks, 1, 'not again until the cooldown ends');
  c.prickCooldown = 0; c.vx = 0;
  world.prickCreatures();
  assert.strictEqual(pricks, 1, 'standing still in it does not prick');
});

// One founder, alone, eats an item of this type with hunger h; returns the reward peak within 10
// ticks and the summed reward and punishment over 30 ticks
function taste(Evo, type, h) {
  const world = new Evo.World();
  const c = world.creatures[0];
  for (const k of Evo.DRIVES) c.body.chem.set(k, 0);
  c.body.chem.set('hunger', h);
  c.body.ingest(world.foodOf({ type }));
  let peak = 0, reward = 0, punishment = 0;
  for (let t = 0; t < 30; t++) {
    c.body.readings(c, world); c.body.chem.step(c.body.loci); c.body.fade();
    if (t < 10) peak = Math.max(peak, c.body.chem.get('reward'));
    reward += c.body.chem.get('reward'); punishment += c.body.chem.get('punishment');
  }
  return { peak, reward, punishment };
}

test('drives: eating rewards at once, in proportion to hunger; bitter punishes', (Evo, assert) => {
  const hungry = taste(Evo, 'fruit', 0.7), sated = taste(Evo, 'fruit', 0);
  assert.ok(hungry.peak >= 0.15, `hungry fruit: reward peak ${hungry.peak}`);
  assert.ok(sated.peak < 0.03, `sated fruit: reward peak ${sated.peak}`);
  const mimic = taste(Evo, 'mimic', 0.7);
  assert.ok(mimic.punishment > mimic.reward, `mimic: punishment ${mimic.punishment} vs reward ${mimic.reward}`);
});

test('drives: the Up close cells report the look of what is at the mouth', (Evo, assert) => {
  const world = new Evo.World();
  const c = world.creatures[0];
  world.items = []; world.creatures = [c];
  Object.assign(c, { facing: 1, asleep: false });
  const near = () => { c.sense(world); return Object.fromEntries(c.brain.lobes.near.map((i, k) => [Evo.VISION_FEATURES[k].key, c.input[i]])); };
  assert.ok(Object.values(near()).every(v => v === 0), 'nothing at the mouth');
  world.spawnItem('mimic', c.mouthX + 2, c.y);
  const d = near(), N = Evo.CREATURE.NEURAL_GAIN, look = Evo.ITEM_TYPES.mimic.look;
  for (const k in d) assert.ok(Math.abs(d[k] - (look[k] || 0) * N) < 1e-6, `${k}: ${d[k]}`);
  assert.ok(Object.keys(look).length > 0 && Object.keys(look).every(k => d[k] > 0), JSON.stringify(d));
});

test('drives: founder instincts name real cells, and none knows the mimic', (Evo, assert) => {
  const traits = Evo.Genome.founder('FEMALE').develop();
  const brain = new Evo.Brain(traits);
  const lobeOf = i => Evo.LOBE_ORDER[i];
  for (const inst of traits.instincts) {
    assert.ok(inst.indexA < brain.lobes[lobeOf(inst.lobeA)].length, `input A of ${JSON.stringify(inst)}`);
    assert.ok(inst.indexB === Evo.GENE_NONE || inst.indexB < brain.lobes[lobeOf(inst.lobeB)].length, `input B of ${JSON.stringify(inst)}`);
    const violetUpClose = [[inst.lobeA, inst.indexA], [inst.lobeB, inst.indexB]]
      .some(([l, i]) => lobeOf(l) === 'near' && Evo.VISION_FEATURES[i] && Evo.VISION_FEATURES[i].key === 'violet');
    assert.ok(!violetUpClose, 'no instinct about violet things up close');
  }
});

test('drives: novelty comes from new-looking things near the creature and habituates', (Evo, assert) => {
  const world = new Evo.World();
  const c = world.creatures[0];
  world.items = []; world.creatures = [c];
  assert.strictEqual(c.noticeNovelty(world), 0, 'nothing near: nothing new');
  const fruit = world.spawnItem('fruit', c.x + 30, c.y);
  const first = c.noticeNovelty(world);
  assert.ok(first > 0.9, `a first fruit is new (${first})`);
  for (let t = 0; t < 150; t++) c.noticeNovelty(world);
  assert.ok(c.noticeNovelty(world) < 0.2, `…and becomes familiar (${c.noticeNovelty(world)})`);
  fruit.x = c.x + 200;
  world.spawnItem('dew', c.x - 30, c.y);
  assert.ok(c.noticeNovelty(world) > 0.6, 'a blue dew drop is new again');
});

test('drives: falling asleep rewards a sleepy creature once, not all night', (Evo, assert) => {
  const world = new Evo.World();
  const c = world.creatures[0];
  world.creatures = [c];
  for (const k of Evo.DRIVES) c.body.chem.set(k, 0);
  c.body.chem.set('reward', 0);
  c.body.chem.set('sleepiness', 0.7);
  c.body.fallAsleep(c, world);
  let early = 0, late = 0;
  for (let t = 0; t < 400; t++) {
    c.body.chem.set('sleepiness', 0.7);
    c.body.readings(c, world); c.body.chem.step(c.body.loci);
    if (t < 30) early = Math.max(early, c.body.chem.get('reward')); else if (t >= 300) late = Math.max(late, c.body.chem.get('reward'));
  }
  assert.ok(early > 0.05, `dozing off rewards (${early})`);
  assert.ok(late < 0.01, `staying asleep does not (${late})`);
});

// Every brain cell starts life at its own resting activity, so a new creature's Feelings cells don't
// start out firing and give it a burst of fear
test('drives: a founder starts life without a burst of fear', (Evo, assert) => {
  const { quietWorld } = require('./helpers');
  const { world, c } = quietWorld(Evo, 1);
  for (const k of Evo.DRIVES) c.body.chem.set(k, 0);
  let worst = 0;
  for (let t = 0; t < 600; t++) {
    c.body.chem.set('glucose', 0.5); c.body.chem.set('water', 0.8); // Fed and watered; nothing else is touched
    world.step();
    worst = Math.max(worst, c.body.chem.get('fear'));
  }
  assert.ok(worst < 0.01, `the highest fear was ${worst}`);
});
