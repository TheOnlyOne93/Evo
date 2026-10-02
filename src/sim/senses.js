// The senses: every way the body and the world reach the brain. Each tick they turn what the
// creature sees, smells, hears, touches and tastes, what is at its mouth, and what its chemistry makes
// its Needs and Feelings cells feel into currents for the brain's input cells. They also pass on what
// the body's chemistry sets for the brain's tick: the reward and punishment it learns from, how
// roused it is, noise from toxin, whether there is energy to fire, and sleep. And they notice how new
// a thing looks (novelty), which genes can read.
// They write the brain's input, and the creature's `senses`, `familiar` and `novelty`.
(function (Evo) {
  'use strict';
  const { clamp01 } = Evo.util;
  const { LOCUS, TARGET, SCENTS, N_LIMBIC, TASTES, TOUCH } = Evo;
  const { sightIndex, smellIndex, hearingIndex, SIGHT_CELLS, HEARING_CELLS, SIDES, BANDS } = Evo.BRAIN_BODY_PLAN;

  const NEURAL_GAIN = 30;           // mV per unit of sense or receptor signal
  const HIGH_BAND_SLOPE = 0.35;     // Sight: a thing rising more than this per px of distance (about 20 degrees) is in the high band
  const ODOUR_COUNT = SCENTS.length;
  const FEATURE_KEYS = Evo.VISION_FEATURES.map(f => f.key);
  // For the hot loop: each touch cell's key and whether it gets through to a sleeper (pain,
  // impacts and pats do), and the receptor target driving each Needs and Feelings cell
  const TOUCH_KEYS = TOUCH.map(t => t.key), TOUCH_WAKES = TOUCH.map(t => t.key === 'pain' || t.key === 'back');
  const TASTE_KEYS = TASTES.map(t => t.key);
  const NEED_TARGETS = Array.from({ length: Evo.N_DRIVE_CELLS }, (_, k) => TARGET[`need:${k}`]);
  const FEELING_TARGETS = Array.from({ length: N_LIMBIC }, (_, k) => TARGET[`limbic:${k}`]);
  // Sight and smell respond logarithmically (Weber-Fechner): faint signals register, strong ones still read as stronger
  const logResponse = (x, K, norm) => Math.log1p(x / K) / norm;
  const LOOK_K = 0.005, LOOK_NORM = Math.log1p(1 / LOOK_K);
  const RECEPTOR_K = 0.02, RECEPTOR_NORM = Math.log1p(1 / RECEPTOR_K);
  // Sight cell for each side, band and feature key (a lookup table built from sightIndex, for the hot loop)
  const SIGHT_CELL = {};
  for (const side of SIDES) {
    SIGHT_CELL[side] = {};
    for (const band of BANDS) SIGHT_CELL[side][band] = Object.fromEntries(Evo.VISION_FEATURES.map(f => [f.key, sightIndex(side, band, f.key)]));
  }
  const LEFT = [SIGHT_CELL.L], RIGHT = [SIGHT_CELL.R], BOTH_SIDES = [SIGHT_CELL.L, SIGHT_CELL.R];
  const FAMILIARITY_FADE = 0.9999;  // Per tick, what a creature has grown used to fades back
  const HABITUATION_SCALE = 20;     // The Curiosity gene's habituation x this = how fast looking at a thing makes it familiar
  const NOVELTY_GAIN_MID = 8;       // The Curiosity gene's mid value (genome: noveltyGain = 4 + v.novelty * 8, so 0.5 gives 8)
  const SIGHT_GAIN = 1.4;           // Sight drive relative to the other senses
  const POND_SIGHT_RADIUS = 30;     // A pond is seen as a blue blob of this radius
  const HEARD_CALL_FADE = 0.9;      // Per tick, the share of a heard call the body still feels
  const HEARING_FALLOFF = { x: 200, y: 400 }; // Distance (px) at which a call's loudness halves, sideways and vertically

  // What the brain learns from is whatever receptor genes make its reward and punishment cells feel
  const REWARD = TARGET['limbic:0'], PUNISHMENT = TARGET['limbic:1'];

  // Novelty comes from things: the thing at the mouth, or else the nearest item within 60 px, is
  // new in as far as its look is unfamiliar. Looking at it makes the look familiar (habituation);
  // familiarity fades slowly, so things become interesting again.
  function noticeNovelty(c, world) {
    const fam = c.familiar, T = c.traits;
    for (let f = 0; f < fam.length; f++) fam[f] *= FAMILIARITY_FADE;
    const t = c.thingAtMouth(world);
    let look = null;
    if (t) look = t.kind === 'item' ? world.lookOf(t.item) : world.lookOfCreature(t.creature);
    else {
      let best = 60;
      for (const item of world.items) {
        if (item.heldBy) continue;
        const d = Math.hypot(item.x - c.x, item.y - c.y);
        if (d < best) { best = d; look = world.lookOf(item); }
      }
    }
    let nov = 0;
    if (look) {
      const h = T.habituationRate * HABITUATION_SCALE;
      for (let f = 0; f < fam.length; f++) {
        const v = look[FEATURE_KEYS[f]];
        if (!v) continue;
        nov += v * (1 - fam[f]);
        fam[f] += h * v * (1 - fam[f]);
      }
    }
    c.novelty = clamp01(nov * T.noveltyGain / NOVELTY_GAIN_MID);
    return c.novelty;
  }

  function sense(c, world) {
    const brain = c.brain, T = c.traits, input = c.input;
    input.fill(0);
    const gainScale = c.body.asleep ? 0.15 : 1;
    const light = world.clock.light;
    const see = T.nightVision + (1 - T.nightVision) * light;

    // Sight: each thing in range excites the colour/motion cells of the side it is on, in the
    // low band (up to about 20 degrees above eye level) or the high band (steeper than that). Signal = apparent size.
    const ex = c.headX, ey = c.headY;
    const range = T.visionRange;
    const sight = c.visionBuffer;
    sight.fill(0);
    // Like smell, sight responds logarithmically to apparent size (radius / distance), so a
    // small fruit across a clearing still registers while a nearby creature doesn't swamp it
    const look = (tx, ty, radius, features) => {
      const dx = tx - ex, dy = ty - ey;
      const dist = Math.hypot(dx, dy);
      if (dist > range || dist < 1) return;
      let intensity = logResponse(Math.min(1, radius / Math.max(8, dist)), LOOK_K, LOOK_NORM) * see;
      // Eyes set to the sides of the head see behind, but less well
      if (Math.abs(dx) >= 3 && dx * c.facing < 0) intensity *= T.rearVision;
      const band = dy < -dist * HIGH_BAND_SLOPE ? 'high' : 'low';
      const sides = Math.abs(dx) < 3 ? BOTH_SIDES : dx < 0 ? LEFT : RIGHT;
      for (const f in features) {
        const v = intensity * features[f] / sides.length;
        for (const side of sides) {
          const k = side[band][f];
          if (v > sight[k]) sight[k] = v;
        }
      }
    };
    for (const item of world.items) {
      if (item.heldBy === c.id) continue;
      look(item.x, item.y - item.radius, item.radius, world.lookOf(item));
    }
    for (const other of world.creatures) {
      if (other !== c) look(other.x, other.centerY, other.size * 0.45, world.lookOfCreature(other));
    }
    for (const f of world.features) {
      const l = world.lookOfFeature(f);
      if (l) look(l.x, l.y, l.radius, l.features);
    }
    const pond = world.nearestWater(ex, range);
    if (pond) look(pond.x, pond.y, POND_SIGHT_RADIUS, { blue: 1 });
    const sightGain = NEURAL_GAIN * SIGHT_GAIN * T.opticGain * gainScale;
    const sightIdx = brain.lobes.sight;
    for (let k = 0; k < SIGHT_CELLS; k++) input[sightIdx[k]] = sight[k] * sightGain;

    // Smell: odour at each antenna tip (one reaching left, one right). Receptors respond
    // logarithmically (Weber-Fechner): faint traces register, stronger ones still read as stronger.
    const smellGain = NEURAL_GAIN * T.scentGain * gainScale;
    const smellIdx = brain.lobes.smell;
    const scentsL = [], scentsR = [];
    for (let o = 0; o < ODOUR_COUNT; o++) {
      const l = Math.min(1, world.sampleScent(ex - T.noseReach, ey, o));
      const r = Math.min(1, world.sampleScent(ex + T.noseReach, ey, o));
      scentsL.push(l); scentsR.push(r);
      input[smellIdx[smellIndex('L', o)]] = logResponse(l, RECEPTOR_K, RECEPTOR_NORM) * smellGain;
      input[smellIdx[smellIndex('R', o)]] = logResponse(r, RECEPTOR_K, RECEPTOR_NORM) * smellGain;
    }

    // Hearing: another's call, louder when near, on the side it came from. A call is made in the
    // act phase and ages at the end of the tick, so every listener hears it for two ticks (ages 1
    // and 2; a hearing cell still refractory from the first can't miss it), and the heardCall
    // stimulus fires once, at age 1. A caller doesn't hear itself.
    let heard = 0, heardNew = 0;
    const hear = new Array(HEARING_CELLS).fill(0);
    for (const snd of world.sounds) {
      if (snd.ageTicks < 1 || snd.ageTicks > 2 || snd.sourceId === c.id) continue;
      const dx = snd.x - c.x;
      const v = snd.loudness / (1 + Math.abs(dx) / HEARING_FALLOFF.x + Math.abs(snd.y - c.y) / HEARING_FALLOFF.y);
      const k = hearingIndex(dx < 0 ? 'L' : 'R', snd.pitch < 0.5 ? 'low' : 'high');
      hear[k] = Math.max(hear[k], v);
      heard = Math.max(heard, v);
      if (snd.ageTicks === 1) heardNew = Math.max(heardNew, v);
    }
    c.body.stim.heardCall = Math.max(c.body.stim.heardCall * HEARD_CALL_FADE, heard);
    if (heardNew > 0) c.stimulate('heardCall', heardNew);
    const L = brain.lobes;
    for (let k = 0; k < L.hearing.length; k++) input[L.hearing[k]] = hear[k] * NEURAL_GAIN * gainScale;

    // Touch
    const s = c.body.stim;
    const mouthThing = c.thingAtMouth(world);
    const touch = {
      contactL: Math.max(s.contactL, mouthThing && mouthThing.kind === 'creature' && c.facing < 0 ? 1 : 0),
      contactR: Math.max(s.contactR, mouthThing && mouthThing.kind === 'creature' && c.facing > 0 ? 1 : 0),
      // The mouth feels food and objects, the lips feel water; another creature at the mouth is
      // felt as a touch on that side
      mouthL: c.facing < 0 && mouthThing && mouthThing.kind === 'item' ? 1 : 0,
      mouthR: c.facing > 0 && mouthThing && mouthThing.kind === 'item' ? 1 : 0,
      lips: c.waterAtMouth(world) ? 1 : 0,
      back: s.back, feet: c.onGround ? 1 : 0, pain: Math.min(1, s.impact + c.body.chem.get('pain')),
      gentle: s.gentle, falling: c.body.loci[LOCUS.falling], inWater: c.inWater ? 1 : 0
    };
    for (let k = 0; k < TOUCH_KEYS.length; k++) {
      input[L.touch[k]] = touch[TOUCH_KEYS[k]] * NEURAL_GAIN * (TOUCH_WAKES[k] ? 1 : gainScale);
    }
    for (let k = 0; k < TASTE_KEYS.length; k++) input[L.taste[k]] = c.body.taste[TASTE_KEYS[k]] * NEURAL_GAIN;
    // Up close: how the thing at the mouth looks (Up close cells are in vision feature order)
    const near = !mouthThing ? null : mouthThing.kind === 'item' ? world.lookOf(mouthThing.item) : world.lookOfCreature(mouthThing.creature);
    for (let k = 0; k < L.near.length; k++) input[L.near[k]] = near ? (near[FEATURE_KEYS[k]] || 0) * NEURAL_GAIN * gainScale : 0;

    // Needs and Feelings cells: driven by whichever chemicals receptor genes attached to them
    const fx = c.body.chem.effects;
    for (let k = 0; k < L.needs.length; k++) input[L.needs[k]] = fx[NEED_TARGETS[k]] * NEURAL_GAIN;
    for (let k = 0; k < L.feelings.length; k++) input[L.feelings[k]] = fx[FEELING_TARGETS[k]] * NEURAL_GAIN;

    c.senses = { sight, scentsL, scentsR, hear, touch, mouthThing };
  }

  // What the body's chemistry sets for the brain's tick (its options; see Brain.tick)
  function fromBody(c) {
    const chem = c.body.chem, fx = chem.effects;
    c.brain.outcome[0] = fx[REWARD];
    c.brain.outcome[1] = fx[PUNISHMENT];
    return {
      noise: 0.35 + chem.get('toxin') * 12,
      arousal: chem.effect('arousal'),
      canFire: chem.get('readyEnergy') > 0.0005,
      asleep: c.body.asleep
    };
  }

  Evo.senses = { sense, noticeNovelty, fromBody };
})(globalThis.Evo);
