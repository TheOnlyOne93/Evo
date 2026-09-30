// Basic drive behaviours: each scenario is seed => the tick it passed, or null. See tools/behave.js.
'use strict';

module.exports = ({ lab, trial, avoids }) => ({
  scenarios: {
    'hungry, food at mouth -> eats': seed => {
      const s = lab(seed);
      s.hold = { hunger: 0.7 };
      s.world.spawnItem('fruit', s.c.mouthX + 3);
      return trial(s, 600, w => !w.items.length);
    },
    'sated, food at mouth -> leaves it': seed => {
      const s = lab(seed);
      s.world.spawnItem('fruit', s.c.mouthX + 3);
      return avoids(s, 600, w => !w.items.length);
    },
    'hungry, fruit 150px left -> reaches and eats it': seed => {
      const s = lab(seed);
      s.hold = { hunger: 0.7 };
      s.c.facing = 1;
      s.world.spawnItem('fruit', s.c.x - 150);
      return trial(s, 1800, w => !w.items.length);
    },
    'hungry, fruit 150px right -> reaches and eats it': seed => {
      const s = lab(seed);
      s.hold = { hunger: 0.7 };
      s.world.spawnItem('fruit', s.c.x + 150);
      return trial(s, 1800, w => !w.items.length);
    },
    'thirsty at the pond -> drinks': seed => {
      const s = lab(seed);
      const p = s.world.terrain.ponds[0];
      Object.assign(s.c, { x: p.x0 + 12, facing: 1 });
      s.c.y = s.world.terrain.groundY(s.c.x);
      s.hold = { thirst: 0.7 };
      let drank = false;
      s.world.events.on('drink', () => { drank = true; });
      return trial(s, 900, () => drank);
    },
    'not thirsty at the pond -> rarely drinks': seed => {
      const s = lab(seed);
      const p = s.world.terrain.ponds[0];
      Object.assign(s.c, { x: p.x0 + 12, facing: 1 });
      s.c.y = s.world.terrain.groundY(s.c.x);
      let drinks = 0;
      s.world.events.on('drink', () => { drinks++; });
      // A sip or two is fine; more than 8 in 900 ticks is drinking without thirst
      return avoids(s, 900, () => drinks > 8);
    },
    'sleepy at night -> falls asleep': seed => {
      const s = lab(seed, { phase: 0.95 });
      s.hold = { sleepiness: 0.7, tiredness: 0.3 };
      return trial(s, 1800, (w, c) => c.asleep);
    },
    'rested by day -> stays awake': seed => {
      const s = lab(seed);
      return avoids(s, 1200, (w, c) => c.asleep);
    },
    'in pain -> runs': seed => {
      const s = lab(seed);
      s.hold = { pain: 0.6 };
      return trial(s, 600, (w, c) => c.runTimer > 0);
    },
    'lonely -> calls': seed => {
      const s = lab(seed);
      s.hold = { loneliness: 0.8 };
      return trial(s, 900, (w, c) => c.callTimer > 0);
    },
    'thorn bush 120px right -> keeps away': seed => {
      const s = lab(seed);
      const bush = s.world.addThornbush(s.c.x + 120);
      // Fails if it ever walks up to the bush (within 35 px of its centre)
      return avoids(s, 1200, (w, c) => c.x > bush.x - 35);
    }
  }
});
