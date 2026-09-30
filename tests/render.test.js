// Render contract: Evo.poseOf yields every field docs/RENDERING.md (Creature pose) documents, with the right types.
'use strict';

test('render: poseOf returns the documented pose fields with valid types and ranges', (Evo, assert) => {
  const world = new Evo.World();
  const c = world.creatures[0];
  assert.ok(c, 'a founder creature exists');
  const pose = Evo.poseOf(c);
  const num = (o, k) => assert.ok(typeof o[k] === 'number' && Number.isFinite(o[k]), `${k} is a finite number`);
  const unit = (o, k) => { num(o, k); assert.ok(o[k] >= 0 && o[k] <= 1, `${k} in 0..1 (got ${o[k]})`); };
  const bool = (o, k) => assert.strictEqual(typeof o[k], 'boolean', `${k} is boolean`);

  assert.ok(pose.id !== undefined, 'id');
  ['x', 'y', 'size'].forEach(k => num(pose, k));
  assert.ok(pose.facing === 1 || pose.facing === -1, 'facing is 1 or -1');
  assert.ok(Number.isInteger(pose.stage) && pose.stage >= 1 && pose.stage <= 7, 'stage 1..7');
  assert.ok(pose.sex === 'FEMALE' || pose.sex === 'MALE', 'sex');

  ['hue', 'accentHue'].forEach(k => { num(pose.looks, k); assert.ok(pose.looks[k] >= 0 && pose.looks[k] <= 360, k + ' in 0..360'); });
  num(pose.looks, 'pattern');
  assert.ok(pose.looks.pattern >= 0 && pose.looks.pattern <= 3, 'pattern in 0..3');
  ['patternScale', 'earSize', 'tailLength', 'eyeSize', 'plumpness', 'legLength', 'crest'].forEach(k => unit(pose.looks, k));

  num(pose.motion, 'vx'); bool(pose.motion, 'airborne'); num(pose.motion, 'walkPhase'); unit(pose.motion, 'lying');

  ['eyesClosed', 'mouthOpen', 'earDroop', 'blush', 'happy', 'worry', 'yawn', 'lick'].forEach(k => unit(pose.face, k));
  ['pupilX', 'pupilY', 'smile'].forEach(k => { num(pose.face, k); assert.ok(pose.face[k] >= -1 && pose.face[k] <= 1, k + ' in -1..1'); });

  ['asleep', 'held', 'dead', 'eating', 'inHeat'].forEach(k => bool(pose.state, k));
  ['calling', 'flinch', 'fear', 'anger', 'pain', 'sick', 'cold', 'hot', 'wet', 'pregnant'].forEach(k => unit(pose.state, k));

  assert.strictEqual(typeof pose.focused, 'boolean');
  assert.strictEqual(typeof pose.hovered, 'boolean');
  assert.strictEqual(Evo.poseOf(c, { focused: true }).focused, true);
});
