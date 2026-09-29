'use strict';

const founderTraits = (Evo, sex = 'X') => Evo.Genome.founder(sex).develop();

test('drives: every drive has exactly one receptor into its own Drives cell, and no cell is shared', (Evo, assert) => {
  const traits = founderTraits(Evo);
  const needTargets = traits.receptors.filter(r => Evo.TARGETS[r.target].startsWith('need:'));
  for (const key of Evo.DRIVES) {
    const mine = needTargets.filter(r => r.chem === Evo.CHEM[key]);
    assert.strictEqual(mine.length, 1, `${key}: ${mine.length} receptors`);
    assert.strictEqual(Evo.TARGETS[mine[0].target], `need:${Evo.driveCell(key)}`, key);
  }
  const cells = needTargets.map(r => r.target);
  assert.strictEqual(new Set(cells).size, cells.length, 'no two receptors share a Drives cell');
});

test('drives: Drives cells have their own addresses, apart from every muscle', (Evo, assert) => {
  const tags = Evo.DRIVE_CELL_TAGS;
  assert.strictEqual(tags.length, Evo.N_NEEDS);
  for (let a = 0; a < tags.length; a++) {
    for (let b = a + 1; b < tags.length; b++) assert.ok(Math.hypot(tags[a][0] - tags[b][0], tags[a][1] - tags[b][1]) > 0.15);
  }
});
