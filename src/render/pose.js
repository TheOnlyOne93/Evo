// Evo.poseOf(creature): turn simulation state into the plain pose object the creature artist draws
// from (docs/DESIGN.md §7). Smooths a few values between frames so poses don't flicker.
// Evo.attentionOf(creature, world): the thing in the world the creature is attending to.
(function (Evo) {
  'use strict';
  const { clamp, clamp01 } = Evo.util;
  // creature -> values eased per sim tick (weakly held: forgotten once the creature is gone)
  const smooth = new WeakMap();
  // Gestures, in ticks: the mouth is open for the first half of a call; a yawn or a lick of the
  // lips lasts `len` every `period` while its cause lasts, each creature on its own beat (`salt`)
  const CALL_HALF = Evo.CREATURE.CALL_TICKS / 2;
  const YAWN = { period: 420, len: 54, salt: 131 }, LICK = { period: 260, len: 26, salt: 71 };

  // Moves state[key] toward target by `rate` per sim tick; state.n is the ticks since the state
  // last eased (0: nothing moves, so several calls in one frame or a paused world change nothing)
  function ease(state, key, target, rate) {
    state[key] = state[key] === undefined ? target : state[key] + (target - state[key]) * (1 - Math.pow(1 - rate, state.n));
    return state[key];
  }

  // Where the creature is looking (pupilX: -1 left, +1 right, in world terms; pupilY: -1 up): at
  // the thing it is attending to when there is one, otherwise toward the strongest thing its eyes
  // report (the sight reading is in the brain's sight-cell order)
  function gaze(c, target) {
    if (target) {
      const dx = target.x - c.headX, dy = target.y - c.headY, d = Math.hypot(dx, dy) || 1;
      return [clamp(dx / 30, -1, 1), clamp(dy / d, -0.9, 0.9)];
    }
    const sight = c.senses && c.senses.sight;
    if (!sight) return [0, 0];
    let best = 0, k = -1;
    for (let i = 0; i < sight.length; i++) if (sight[i] > best) { best = sight[i]; k = i; }
    if (k < 0 || best < 0.05) return [0, 0];
    const cell = Evo.BRAIN_BODY_PLAN.sightCell(k);
    return [cell.side === 'L' ? -1 : 1, cell.band === 'high' ? -0.8 : 0.2];
  }

  // What a creature is attending to, as a thing in the world. The brain's attended() gives a side
  // and a vision feature; the thing on that side, within sight, that shows that feature most (by
  // apparent size, as the eye weighs it) is taken to be it. Returns
  // { kind: 'item' | 'creature' | 'feature' | 'water', ref, x, y, radius, word } or null. Resolved again
  // every few ticks; in between, the position follows a moving target.
  const attention = new WeakMap();
  const RESOLVE_EVERY = 6;   // ticks
  function attentionOf(c, world) {
    if (!world || !c.brain || !c.brain.attended || c.dead || c.asleep || c.held) return null;
    const tick = world.clock.tick;
    let a = attention.get(c);
    if (!a || tick < a.tick || tick - a.tick >= RESOLVE_EVERY) {
      if (!a) attention.set(c, a = { tick, target: null });
      a.tick = tick;
      const att = c.brain.attended();
      a.target = att ? resolve(c, world, att) : null;
    }
    const t = a.target;
    if (!t) return null;
    if (t.kind === 'item') {
      if (!world.items.includes(t.ref)) return (a.target = null);
      t.x = t.ref.x; t.y = t.ref.y - t.ref.radius;
    } else if (t.kind === 'creature') {
      if (t.ref.dead || !world.creatures.includes(t.ref)) return (a.target = null);
      t.x = t.ref.x; t.y = t.ref.y - t.ref.size * 0.4;
    }
    return t;
  }

  function resolve(c, world, { side, feature }) {
    const ex = c.headX, ey = c.headY, range = c.traits.visionRange;
    let best = null, most = 0;
    const consider = (kind, ref, x, y, radius, look, word) => {
      const w = look && look[feature];
      if (!w) return;
      const dx = x - ex, dist = Math.hypot(dx, y - ey);
      if (dist > range || (side === 'L' ? dx > 3 : dx < -3)) return;
      const score = w * Math.min(1, radius / (dist + 8));
      if (score > most) { most = score; best = { kind, ref, x, y, radius, word }; }
    };
    for (const it of world.items) {
      if (it.held === c.id) continue;
      consider('item', it, it.x, it.y - it.radius, it.radius, world.lookOf(it), (Evo.ITEM_TYPES[it.type] || { word: it.type }).word);
    }
    for (const o of world.creatures) {
      if (o !== c) consider('creature', o, o.x, o.y - o.size * 0.4, o.size * 0.45, world.lookOfCreature(o), o.name);
    }
    for (const f of world.features) {
      const l = world.lookOfFeature(f);
      if (l) consider('feature', f, l.x, l.y, l.radius, l.features, f.kind === 'thornbush' ? 'thorn bush' : f.kind === 'tree' ? 'fruit tree' : f.kind);
    }
    const pond = world.nearestWater(ex, range);
    if (pond) consider('water', null, pond.x, pond.y, 30, { blue: 1 }, 'water');
    return best;
  }
  Evo.attentionOf = attentionOf;

  // A short gesture repeated every `period` ticks while its cause lasts: 0 → 1 → 0 over `len`
  // ticks, each creature on its own beat
  function every(c, period, len, salt) {
    const u = (c.ageTicks + c.id * salt) % period;
    return u < len ? Math.sin(u / len * Math.PI) : 0;
  }

  // world (optional): lets the eyes follow what the creature is attending to
  Evo.poseOf = function poseOf(c, { focused = false, hovered = false, world = null } = {}) {
    let s = smooth.get(c);
    if (!s) smooth.set(c, s = {});
    // Ticks since this creature's pose last eased: world ticks when there is a world (a dead
    // creature's ageTicks stops, but its eyes still have to close), else its own age. The clock
    // is remembered so a call with the other kind counts as one tick rather than a bogus gap.
    const clock = world ? 'world' : 'age', now = world ? world.clock.tick : c.ageTicks;
    s.n = s.clock === clock && now >= s.tick ? now - s.tick : 1;
    s.clock = clock; s.tick = now;
    const ch = c.chem;
    const get = k => ch.get(k);
    const [gx, gy] = gaze(c, attentionOf(c, world));
    const T = c.traits;
    const mouth = Math.max(c.mouthTimer, c.drinkTimer || 0);
    const awake = !c.asleep && !c.dead && !c.held;
    // Yawning when sleepy or tired; licking its lips when hungry or thirsty
    const yawn = awake && !mouth && Math.max(get('sleepiness'), get('tiredness')) > 0.55 ? every(c, YAWN.period, YAWN.len, YAWN.salt) : 0;
    const lick = awake && !mouth && !yawn && Math.max(get('hunger'), get('thirst'), get('proteinHunger'), get('fatHunger')) > 0.55 ? every(c, LICK.period, LICK.len, LICK.salt) : 0;
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
        eyesClosed: ease(s, 'eyes', c.asleep || c.dead ? 1 : clamp01(Math.max(get('sleepiness') * 0.6, get('tiredness') * 0.4, yawn)), 0.2),
        pupilX: ease(s, 'px', gx, 0.1), pupilY: ease(s, 'py', gy, 0.1),
        mouthOpen: c.callTimer > CALL_HALF ? 0.8 : mouth > 0 ? 0.3 + 0.5 * Math.abs(Math.sin(mouth * 0.8)) : yawn,
        smile: ease(s, 'smile', clamp((get('reward') - get('punishment')) * 3 - get('pain') - get('nausea') * 0.5 + get('endorphin'), -1, 1), 0.1),
        earDroop: ease(s, 'droop', clamp01(Math.max(get('tiredness'), get('nausea'), get('loneliness') * 0.6)), 0.05), // the art droops old ears itself
        blush: ease(s, 'blush', clamp01(c.stim.gentle + get('endorphin')), 0.1),
        happy: ease(s, 'happy', awake ? clamp01(c.stim.gentle * 1.5 - c.stim.flinch * 2) : 0, 0.2),
        worry: ease(s, 'worry', awake ? clamp01(Math.max(get('pain'), get('loneliness') * 0.8, get('boredom') * 0.4)) : 0, 0.08),
        yawn, lick
      },
      state: {
        asleep: c.asleep, held: c.held, dead: c.dead, eating: mouth > 0, // Eating or drinking: the mouth is at work
        calling: clamp01((c.callTimer - CALL_HALF) / CALL_HALF), flinch: c.stim.flinch,
        fear: get('fear'), anger: get('anger'), pain: get('pain'), sick: clamp01(get('nausea') + get('toxin')),
        cold: get('coldness'), hot: get('hotness'),
        wet: ease(s, 'wet', c.inWater ? 1 : 0, c.inWater ? 0.2 : 0.004),
        pregnant: c.pregnancy ? c.pregnancy.progress : 0, inHeat: c.fertile
      },
      focused, hovered
    };
  };
})(globalThis.Evo);
