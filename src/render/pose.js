// Evo.poseOf(creature): turn simulation state into the plain pose object the creature artist draws
// from (docs/DESIGN.md §7). Smooths a few values between frames so poses don't flicker.
(function (Evo) {
  'use strict';
  const { clamp, clamp01 } = Evo.util;
  // creature -> values eased between frames (weakly held: forgotten once the creature is gone)
  const smooth = new WeakMap();

  function ease(state, key, target, rate) {
    state[key] = state[key] === undefined ? target : state[key] + (target - state[key]) * rate;
    return state[key];
  }

  // Where the creature is looking: toward the strongest thing its eyes report (pupilX: -1 left,
  // +1 right, in world terms; pupilY: -1 up). The sight reading is in the brain's sight-cell order.
  function gaze(c) {
    const sight = c.senses && c.senses.sight;
    if (!sight) return [0, 0];
    let best = 0, k = -1;
    for (let i = 0; i < sight.length; i++) if (sight[i] > best) { best = sight[i]; k = i; }
    if (k < 0 || best < 0.05) return [0, 0];
    const cell = Evo.BRAIN_BODY_PLAN.sightCell(k);
    return [cell.side === 'L' ? -1 : 1, cell.band === 'high' ? -0.8 : 0.2];
  }

  Evo.poseOf = function poseOf(c, { focused = false, hovered = false } = {}) {
    let s = smooth.get(c);
    if (!s) smooth.set(c, s = {});
    const ch = c.chem;
    const get = k => ch.get(k);
    const [gx, gy] = gaze(c);
    const T = c.traits;
    const mouth = Math.max(c.mouthTimer, c.drinkTimer || 0);
    return {
      id: c.id, x: c.x, y: c.y, facing: c.facing, size: c.size, stage: c.stage, sex: c.sex,
      looks: {
        hue: T.hue, accentHue: T.accentHue, pattern: T.pattern, patternScale: T.patternScale, earSize: T.earSize,
        tailLength: T.tailLength, eyeSize: T.eyeSize, plumpness: T.plumpness, legLength: T.legLength, crest: T.crest
      },
      motion: {
        vx: c.vx, airborne: !c.onGround && !c.held, walkPhase: c.walkPhase,
        lying: ease(s, 'lying', c.lying ? 1 : 0, 0.08)
      },
      face: {
        eyesClosed: ease(s, 'eyes', c.asleep || c.dead ? 1 : clamp01(get('sleepiness') * 0.6), 0.15),
        pupilX: ease(s, 'px', gx, 0.1), pupilY: ease(s, 'py', gy, 0.1),
        mouthOpen: c.callTimer > 20 ? 0.8 : mouth > 0 ? 0.3 + 0.5 * Math.abs(Math.sin(mouth * 0.8)) : 0,
        smile: ease(s, 'smile', clamp((get('reward') - get('punishment')) * 3 - get('pain') - get('nausea') * 0.5 + get('endorphin'), -1, 1), 0.1),
        earDroop: ease(s, 'droop', clamp01(Math.max(get('tiredness'), get('nausea'), c.stage >= Evo.STAGE.SENILE ? 0.6 : 0)), 0.05),
        blush: ease(s, 'blush', clamp01(c.stim.gentle + get('endorphin')), 0.1)
      },
      state: {
        asleep: c.asleep, held: c.held, dead: c.dead, eating: mouth > 0, // Eating or drinking: the mouth is at work
        calling: clamp01((c.callTimer - 20) / 20), flinch: c.stim.flinch,
        fear: get('fear'), anger: get('anger'), sick: clamp01(get('nausea') + get('toxin')), cold: get('coldness'), hot: get('hotness'),
        wet: ease(s, 'wet', c.inWater ? 1 : 0, c.inWater ? 0.2 : 0.004),
        pregnant: c.pregnancy ? c.pregnancy.progress : 0, inHeat: c.fertile
      },
      focused, hovered
    };
  };
})(globalThis.Evo);
