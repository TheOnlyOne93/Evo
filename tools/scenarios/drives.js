// Drive-to-action scenarios: each drive, held on its own, and what the creature does about it.
// See tools/behave.js for the shape.
'use strict';

module.exports = ({ lab, trial, avoids }) => ({
  scenarios: {
    'nauseous -> lies down': seed => {
      const s = lab(seed);
      s.hold = { nausea: 0.5 };
      return trial(s, 900, (w, c) => c.restTimer > 0);
    },
    'sated, creature at mouth -> rarely nuzzles': seed => {
      const s = lab(seed);
      const other = s.world.addAdult('MALE', { x: s.c.mouthX + 12 });
      for (const phase of ['tickBody', 'mind', 'act', 'settle']) other[phase] = () => {}; // A friend standing still at its mouth
      const nuzzles = s.count('nuzzle', e => e.from === s.c);
      // A friendly nuzzle or two is fine; more than 3 in 900 ticks is nuzzling without a need
      return avoids(s, 900, () => nuzzles() > 3);
    },
    // The small pond (ponds[1], the east pool) lies near the world's east end: a thirsty creature placed at
    // the edge beside it, facing it, must still drink
    'thirsty, at the world edge beside the small pond -> drinks': seed => {
      const s = lab(seed);
      s.placeAt(s.world.width - s.world.edge, -1);
      s.hold = { thirst: 0.7 };
      const drinks = s.count('drink');
      return trial(s, 1800, () => drinks() > 0);
    }
  },
  reports: {
    'thirsty, 200px inland of the small pond -> drinks within 1800 ticks': seed => {
      const s = lab(seed);
      const p = s.world.terrain.ponds[1];
      s.placeAt(p.x0 - 200, 1);
      s.hold = { thirst: 0.7 };
      const drinks = s.count('drink');
      return trial(s, 1800, () => drinks() > 0) === null ? 0 : 1;
    },
    // Novelty comes from things: a bored creature with a ball nearby (share of seeds that touch it)
    'bored, ball 60 px -> touches or grabs it within 1800 ticks': seed => {
      const s = lab(seed);
      s.hold = { boredom: 0.6 };
      const ball = s.world.spawnItem('ball', s.c.x + 60, undefined, { hue: 200 });
      const at = trial(s, 1800, (w, c) => { const t = c.thingAtMouth(w); return !!t && t.item === ball; });
      return at === null ? 0 : 1;
    }
  }
});
