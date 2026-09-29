// Drive-to-action scenarios: each drive, held on its own, and what the creature does about it;
// and what stimuli release. See tools/behave.js for the shape.
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
      other.step = () => {};   // A friend standing still at its mouth
      let nuzzles = 0;
      s.world.events.on('nuzzle', e => { if (e.from === s.c) nuzzles++; });
      return avoids(s, 900, () => nuzzles > 3);
    },
    // Stimulus genes: the hand's pat and slap release reward and punishment at once
    'patted -> reward >= 0.15 next tick': seed => {
      const s = lab(seed);
      s.world.step();
      s.world.pat(s.c);
      return trial(s, 1, (w, c) => c.chem.get('reward') >= 0.15);
    },
    'slapped -> punishment >= 0.2 next tick': seed => {
      const s = lab(seed);
      s.world.step();
      s.world.slap(s.c);
      return trial(s, 1, (w, c) => c.chem.get('punishment') >= 0.2);
    }
  },
  reports: {
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
