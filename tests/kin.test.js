'use strict';
// Evo.kinOf: a creature's family read from history records.

// Ada and Bo are founders; Cy wandered in. Eva and Gus are Ada's by Bo, Ivy is Ada's by Cy.
// Hal is Eva's by Cy, Kit is Ivy's by Gus, and Lu is Kit's by Hal (so Lu descends from Ada twice).
function family() {
  const rec = (id, name, sex, generation, motherId = null, fatherId = null) => ({ id, name, sex, generation, born: id * 100, died: null, cause: null, motherId, fatherId });
  return [
    rec(1, 'Ada', 'FEMALE', 1), rec(2, 'Bo', 'MALE', 1), rec(3, 'Cy', 'MALE', 2),
    rec(4, 'Eva', 'FEMALE', 2, 1, 2), rec(5, 'Gus', 'MALE', 2, 1, 2), rec(6, 'Ivy', 'FEMALE', 3, 1, 3),
    rec(7, 'Hal', 'MALE', 3, 4, 3), rec(8, 'Kit', 'FEMALE', 4, 6, 5), rec(9, 'Lu', 'FEMALE', 5, 8, 7)
  ];
}
const names = list => list.map(h => h.name).join(' ');

test('kin: parents, brothers and sisters (full ones first), mates and children', (Evo, assert) => {
  const eva = Evo.kinOf(Evo.kinIndex(family()), 4);
  assert.strictEqual(eva.self.name, 'Eva');
  assert.strictEqual(eva.outsider, false);
  assert.strictEqual(eva.mother.name, 'Ada');
  assert.strictEqual(eva.father.name, 'Bo');
  assert.deepStrictEqual(eva.siblings.map(s => [s.rec.name, s.half]), [['Gus', false], ['Ivy', true]]);
  assert.strictEqual(names(eva.mates), 'Cy');
  assert.strictEqual(names(eva.children), 'Hal');
  assert.strictEqual(names(eva.grandchildren), 'Lu');
  assert.strictEqual(names(eva.descendants), 'Hal Lu');
  assert.deepStrictEqual(eva.grandparents, [], 'her parents were founders: no grandparents here');
});

test('kin: grandparents by side, and a parent from outside has none', (Evo, assert) => {
  const index = Evo.kinIndex(family());
  const lu = Evo.kinOf(index, 9);
  assert.deepStrictEqual(lu.grandparents.map(g => `${g.of}'s ${g.role}: ${g.rec.name}`),
    ["mother's mother: Ivy", "mother's father: Gus", "father's mother: Eva", "father's father: Cy"]);
  assert.deepStrictEqual(lu.siblings, []);
  // Hal's father Cy wandered in, so only his mother's parents lived here
  assert.deepStrictEqual(Evo.kinOf(index, 7).grandparents.map(g => `${g.of}'s ${g.role}: ${g.rec.name}`), ["mother's mother: Ada", "mother's father: Bo"]);
});

test('kin: founders and wanderers have no parents here; descendants and grandchildren count once each', (Evo, assert) => {
  const index = Evo.kinIndex(family());
  const ada = Evo.kinOf(index, 1);
  assert.strictEqual(ada.outsider, true);
  assert.strictEqual(ada.mother, undefined);
  assert.deepStrictEqual(ada.siblings, []);
  assert.strictEqual(names(ada.mates), 'Bo Cy');
  assert.strictEqual(names(ada.children), 'Eva Gus Ivy');
  assert.strictEqual(names(ada.grandchildren), 'Hal Kit', 'Kit is a grandchild through Gus and through Ivy, listed once');
  assert.strictEqual(ada.descendants.length, 6, 'Lu is reached through Hal and through Kit, counted once');
  assert.strictEqual(Evo.kinOf(index, 3).outsider, true, 'a wanderer');
  assert.strictEqual(Evo.kinOf(index, 99), null, 'nobody with that id lived here');
});
