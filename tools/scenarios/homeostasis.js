// The body's own loops (body -> drive -> relief): each scenario is seed => the tick it passed, or null.
// See tools/behave.js. No drive is held here (s.hold is never set), so the body is left to do it alone.
// Several of these fail today, on purpose, to show what is broken.
'use strict';

module.exports = ({ Evo, lab, run, trial }) => {
  // The body temperature of a creature left resting for 6000 ticks in cool air, with the given fur
  function restingTemp(seed, insulation) {
    const s = lab(seed);
    s.world.temperatureAt = () => 0.35;
    s.c.traits.insulation = insulation;
    s.c.body.temperature = 0.5;
    run(s, 6000, () => false, (w, c) => { c.restTimer = 90; });   // Keeps it lying down
    return s.c.body.temperature;
  }

  return {
    scenarios: {
      // Tasting the fruit halves hunger at once; this asks whether the meal keeps it down, as the body
      // stores what it ate, a third of a day later
      'no food: hunger rises; one fruit -> still halved 1800 ticks on': seed => {
        const s = lab(seed);
        s.c.body.chem.set('glucose', 0.3); s.c.body.chem.set('glycogen', 0.3);
        if (run(s, 3600, (w, c) => c.body.chem.get('hunger') >= 0.3).at === null) return null;
        const peak = s.c.body.chem.get('hunger');
        s.c.body.ingest(s.world.foodOf({ type: 'fruit' }));
        s.c.stimulate('ate');
        if (run(s, 1800, () => false).died) return null;
        return s.c.body.chem.get('hunger') <= peak / 2 ? 0 : null;
      },
      'six slaps -> fear below 0.2 within a day': seed => {
        const s = lab(seed);
        let highest = 0;
        run(s, 360, (w, c) => { highest = Math.max(highest, c.body.chem.get('fear')); return false; }, (w, c, t) => { if (t % 60 === 0) w.slap(c); });
        if (highest < 0.2) return null;   // The slaps must frighten it first
        return trial(s, Evo.DAY_TICKS, (w, c) => c.body.chem.get('fear') < 0.2);
      },
      'awake by day -> tiredness builds': seed => {
        const s = lab(seed, { phase: 0.3 });   // Morning
        return trial(s, Evo.DAY_TICKS, (w, c) => c.body.chem.get('tiredness') >= 0.3);
      },
      'resting in cool air -> thick fur keeps it warmer than thin': seed => (restingTemp(seed, 0.9) > restingTemp(seed, 0.3) + 0.02 ? 0 : null),
      'a fed baby grows all the way up': seed => {
        const s = lab(seed);
        // It starts 90% grown so the run stays short; the last stretch is where growth stalls today
        const b = s.world.addCreature(Evo.Genome.founder('FEMALE'), s.c.x, { growth: 0.9, reserves: { ...Evo.EGG_CONTENTS } });
        s.world.creatures = [b];
        s.c = b;
        return trial(s, 2 * Evo.DAY_TICKS, (w, c) => c.body.growth >= 0.999, (w, c) => {
          c.body.chem.set('glucose', 0.5); c.body.chem.set('water', 0.8); c.body.chem.set('protein', 0.6);
        });
      }
    }
  };
};
