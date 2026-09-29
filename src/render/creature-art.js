// Creature art (docs/DESIGN.md §7–8): draws one creature from its pose object and nothing else.
// The species, a "tuftkin", is a soft round quadruped: a big head seen in three-quarter view,
// large eyes, long leaf-shaped ears, a pom-pom tail and a head crest whose shape shows the sex
// and which glows in the breeding season. Geometry is built in units (an adult is about 32 units
// from rump to nose; baby proportions differ), facing right with the origin on the ground under
// the body, then scaled by pose.size and mirrored by pose.facing.
(function (Evo) {
  'use strict';
  const { TAU } = Evo.util;
  const PI = Math.PI;
  const { clamp01, clamp, lerp } = Evo.util;
  const smooth = u => Evo.util.smoothstep(0, 1, u);
  const num = (v, d) => (typeof v === 'number' && v === v ? v : d);
  const EMPTY = {};

  const UNITS = 32;                                  // pose.size spans this many units
  const GROWTH = [1, 0, 0.32, 0.58, 0.82, 1, 1, 1];  // toward adult proportions, by stage
  const AGEING = [0, 0, 0, 0, 0, 0, 0.55, 1];        // greying, whiskers, droop, by stage
  const CREST = [1, 0.4, 0.5, 0.66, 0.84, 1, 1, 0.9];
  const TAIL_N = 9;
  // The simulation advances walkPhase by Evo.CREATURE.WALK_PHASE_PER_PX per px walked, whatever the size. The legs step
  // at a cadence (leg radians per walkPhase radian) that is quicker for the young and short-legged
  // and slower in a bounding run
  const PHASE_PER_PX = Evo.CREATURE.WALK_PHASE_PER_PX;
  const CADENCE = [1, 2, 1.65, 1.35, 1.15, 1, 1, 1.05];
  const GRIP_Y = -Evo.WORLD.HOLD_GRIP * UNITS;        // held: the hand is HOLD_GRIP × size above (x, y)

  // ---- Per-creature cache: random layout seeds and colour strings -----------------------------

  const cache = new Map();

  function hashId(id) {
    const s = String(id);
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
    return h >>> 0;
  }

  function entryFor(pose) {
    let e = cache.get(pose.id);
    if (!e) {
      if (cache.size > 300) cache.clear();
      const rnd = Evo.util.mulberry32(hashId(pose.id));
      e = {
        phase: rnd() * TAU, blinkP: 2.8 + rnd() * 2.6, blinkO: rnd() * 10,
        twitchP: 4 + rnd() * 3.5, twitchO: rnd() * 10,
        spots: new Float32Array(30), stripes: new Float32Array(6), patches: new Float32Array(12),
        eyePatch: rnd() < 0.55, key: new Float32Array(8).fill(-1), pal: {}, palVer: 0, wp: 0, legPh: 0,
        bodyG: null, bodyV: -1, bodyK: 0, headG: null, headV: -1, headK: 0
      };
      for (let i = 0; i < 30; i += 3) { e.spots[i] = rnd(); e.spots[i + 1] = rnd(); e.spots[i + 2] = rnd(); }
      for (let i = 0; i < 6; i++) e.stripes[i] = rnd() - 0.5;
      for (let i = 0; i < 12; i++) e.patches[i] = rnd();
      cache.set(pose.id, e);
    }
    return e;
  }

  // ---- Colours ---------------------------------------------------------------------------------

  // Pleasant fur saturation and lightness every 30° of hue (greens and yellows a little darker,
  // blues and violets softer), so every genome gets an attractive coat
  const FUR_S = [58, 64, 62, 52, 42, 40, 44, 50, 46, 42, 44, 52, 58];
  const FUR_L = [66, 64, 61, 58, 56, 56, 58, 62, 66, 68, 68, 67, 66];

  const hueTo = (h, target, u) => { const d = ((target - h + 540) % 360) - 180; return (h + d * u + 360) % 360; };
  const hsl = (h, s, l) => `hsl(${((h % 360) + 360) % 360 | 0},${clamp(s, 0, 100).toFixed(1)}%,${clamp(l, 0, 100).toFixed(1)}%)`;

  // Rebuilds the colour strings only when looks, age or a tint-changing state visibly changes
  function paletteFor(e, pose, r) {
    const L = pose.looks || EMPTY, k = e.key;
    const hue = ((num(L.hue, 28) % 360) + 360) % 360, acc = ((num(L.accentHue, 40) % 360) + 360) % 360;
    const k0 = hue | 0, k1 = acc | 0, k2 = r.stage + (r.female ? 0 : 8), k3 = Math.round(r.sick * 10), k4 = Math.round(r.cold * 10);
    const k5 = Math.round(r.wet * 10), k6 = r.dead ? 1 : 0, k7 = r.heat > 0 ? 1 : 0;
    if (k[0] === k0 && k[1] === k1 && k[2] === k2 && k[3] === k3 && k[4] === k4 && k[5] === k5 && k[6] === k6 && k[7] === k7) return e.pal;
    k[0] = k0; k[1] = k1; k[2] = k2; k[3] = k3; k[4] = k4; k[5] = k5; k[6] = k6; k[7] = k7;
    const sick = k3 / 10, cold = k4 / 10, wet = k5 / 10, ag = AGEING[r.stage];

    const f = hue / 30, i = Math.floor(f) % 12, u = f - Math.floor(f);
    let h = hue, s = lerp(FUR_S[i], FUR_S[i + 1], u), l = lerp(FUR_L[i], FUR_L[i + 1], u);
    let ah = acc, as = 62, al = 84;
    s *= 1 - 0.62 * ag; l = lerp(l, 77, 0.5 * ag); as *= 1 - 0.55 * ag; al = lerp(al, 89, 0.5 * ag);
    if (sick) { h = hueTo(h, 88, 0.45 * sick); s = lerp(s, 36, 0.5 * sick); l -= 5 * sick; ah = hueTo(ah, 80, 0.45 * sick); }
    if (cold) { h = hueTo(h, 210, 0.32 * cold); s *= 1 - 0.3 * cold; l += 3 * cold; ah = hueTo(ah, 205, 0.35 * cold); }
    if (wet) { l -= 14 * wet; s += 6 * wet; al -= 10 * wet; }
    if (k6) { s *= 0.22; l = lerp(l, 60, 0.5); as *= 0.25; al = lerp(al, 80, 0.5); }

    const p = e.pal;
    e.palVer++;
    p.fur = hsl(h, s, l);
    p.hi = hsl(h - 5, s + 6, l + 11);
    p.lo = hsl(h + 8, s - 2, l - 14);
    p.leg = hsl(h + 4, s, l - 5);
    p.far = hsl(h + 8, s - 4, l - 15);
    p.line = hsl(h + 12, Math.min(s + 4, 42), k6 ? 30 : 22);
    p.mark = hsl(h + 10, s + 8, l - 22);
    p.belly = hsl(ah, as, al);
    p.patch = hsl(hueTo(h, ah, 0.35), s * 0.95, l - 17);
    p.inner = hsl(hueTo(ah, 345, 0.3), as + 6, al - 7);
    p.innerFar = hsl(hueTo(ah, 345, 0.3), as, al - 18);
    // From adolescence the crest leans toward the colour of its sex, so the sexes tell apart at a glance
    const ch = r.stage >= 3 ? hueTo(ah, sexHue(r.female), 0.75) : ah;
    p.crest = hsl(ch, (k6 ? 20 : 74) * (1 - 0.45 * ag), k7 ? 66 : 58);
    p.crestHi = hsl(ch, (k6 ? 20 : 86) * (1 - 0.45 * ag), k7 ? 84 : 76);
    p.iris = hsl(hueTo(ah, 30, 0.2), k6 ? 8 : 48, 30);
    p.nose = hsl(hueTo(h, 350, 0.6), k6 ? 10 : 34, 34);
    p.mouth = hsl(352, k6 ? 12 : 48, 26);
    p.tongue = hsl(350, k6 ? 16 : 70, 70);
    p.brow = ag > 0 ? hsl(h, 8, 92) : hsl(h + 12, Math.min(s, 40), 30);
    return p;
  }

  // Hue (degrees) of the --female or --male colour token
  const SEX_HUE = {};
  function sexHue(female) {
    const key = female ? '--female' : '--male';
    if (SEX_HUE[key] === undefined) {
      const [r, g, b] = Evo.theme.rgb(key).map(v => v / 255);
      const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
      const h = !d ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      SEX_HUE[key] = (h * 60 + 360) % 360;
    }
    return SEX_HUE[key];
  }

  // ---- The rig: every point of the current pose, in units ------------------------------------

  const rig = {
    k: 1, facing: 1, stage: 5, g: 1, ag: 0, female: true, dead: false, held: false, asleep: false,
    air: 0, lying: 0, fear: 0, anger: 0, sick: 0, cold: 0, hot: 0, wet: 0, calling: 0, heat: 0,
    offX: 0, sx: 1, sy: 1, swing: 0, shadowY: 0, shadow: 1, ol: 1, lod: 2, pxScale: 1,
    bx: 0, by: 0, ang: 0, rxF: 10, rxB: 11, ryT: 8, ryB: 9, breath: 1, bristle: 0,
    legs: new Float32Array(16), legW: 4, pawRy: 2,
    tail: new Float32Array(TAIL_N * 3),
    hx: 0, hy: 0, hAng: 0, R: 10,
    earLen: 10, earW: 6, earN: 0, earF: 0, crest: 0, crestKind: 0, crestSway: 0,
    eR: 3, closed: 0, eyeMode: 0, px: 0, py: 0, pupil: 0.45, lidTilt: 0,
    smile: 0, mouthOpen: 0, tongue: 0, fang: 0, wavy: 0, blush: 0, browAnger: 0, browWorry: 0,
    pattern: 0, patternScale: 0.5
  };

  // Leg phase, accumulated from walkPhase deltas so the cadence can change with speed without the
  // legs jumping. Only draw() advances it; a backward or huge jump just resynchronises.
  function legPhase(e, walkPhase, cadence, advance) {
    if (advance) {
      const d = walkPhase - e.wp;
      if (d > 0 && d < 30) e.legPh = (e.legPh + d * cadence) % (TAU * 1e4);
      e.wp = walkPhase;
    }
    return e.legPh;
  }

  function computeRig(pose, t, e, r, advance) {
    const L = pose.looks || EMPTY, M = pose.motion || EMPTY, F = pose.face || EMPTY, S = pose.state || EMPTY;
    const stage = clamp(Math.round(num(pose.stage, 5)), 1, 7);
    const g = GROWTH[stage], ag = AGEING[stage], senile = stage === 7 ? 1 : 0, baby = 1 - g;
    const plump = clamp01(num(L.plumpness, 0.5)), legGene = clamp01(num(L.legLength, 0.5));
    const tailGene = clamp01(num(L.tailLength, 0.5)), earGene = clamp01(num(L.earSize, 0.5));
    const eyeGene = clamp01(num(L.eyeSize, 0.5)), crestGene = clamp01(num(L.crest, 0.5));
    const dead = !!S.dead, held = !!S.held && !dead, asleep = !!S.asleep && !dead, live = dead ? 0 : 1;
    const fear = clamp01(num(S.fear, 0)) * live, anger = clamp01(num(S.anger, 0)) * live;
    const sick = clamp01(num(S.sick, 0)), cold = clamp01(num(S.cold, 0)) * live, hot = clamp01(num(S.hot, 0)) * live;
    const wet = clamp01(num(S.wet, 0)), preg = clamp01(num(S.pregnant, 0));
    const flinch = clamp01(num(S.flinch, 0)) * live, calling = asleep ? 0 : clamp01(num(S.calling, 0)) * live;
    const eat = S.eating && !dead && !held && !asleep ? 1 : 0;
    const air = M.airborne && !held && !dead ? 1 : 0;
    const lying = dead ? 1 : held || air ? 0 : clamp01(num(M.lying, asleep ? 1 : 0));
    const stand = 1 - lying;
    const tempo = 1 - 0.18 * ag - 0.2 * senile;
    const ph0 = e.phase;
    const facing = pose.facing < 0 ? -1 : 1;

    r.k = Math.max(4, num(pose.size, 32)) / UNITS; r.facing = facing; r.stage = stage; r.g = g; r.ag = ag;
    r.female = pose.sex !== 'MALE'; r.dead = dead; r.held = held; r.asleep = asleep; r.air = air; r.lying = lying;
    r.fear = fear; r.anger = anger; r.sick = sick; r.cold = cold; r.hot = hot; r.wet = wet; r.calling = calling;
    r.heat = S.inHeat && !dead && stage >= 3 ? 0.62 + 0.38 * Math.sin(t * 3.4 + ph0) : 0;
    r.pattern = Math.round(num(L.pattern, 0)); r.patternScale = clamp01(num(L.patternScale, 0.5));

    // Proportions: babies are mostly head, with stubby legs
    const R = lerp(13.2, 10.8, g);
    const rxF = lerp(9.2, 12, g) * (0.9 + 0.2 * plump);
    const rxB = rxF * (1.05 + 0.07 * plump);
    const ryT = lerp(7.8, 8.4, g) * (0.8 + 0.4 * plump);
    const ryB = ryT * (1.06 + 0.12 * plump + 0.5 * preg);
    const legLen = (2.6 + 5.4 * legGene) * lerp(0.42, 1, g);
    const legW = lerp(4.3, 4.7, g) * (0.88 + 0.24 * plump);
    const pawRy = legW * 0.5, reach = legLen + ryB * 0.58 - pawRy;
    r.R = R; r.rxF = rxF; r.rxB = rxB; r.ryT = ryT; r.ryB = ryB; r.legW = legW; r.pawRy = pawRy;

    // Breathing (slow and deep asleep, fast when panting)
    const breathHz = asleep ? 0.2 : 0.3 + 2.6 * hot * hot;
    r.breath = dead ? 1 : 1 + Math.sin(t * TAU * breathHz * tempo + ph0) * (asleep ? 0.045 : 0.022 + 0.02 * hot);

    // Gait: diagonal walk blending into a bounding run. Speed is judged relative to body size, so
    // a baby's scurry reads as a walk and its sprint as a run
    const speed = Math.abs(num(M.vx, 0)), rel = speed * Math.sqrt(40 / Math.max(8, num(pose.size, 32)));
    const move = held || dead || air ? 0 : smooth(clamp01((speed - 0.04) / 0.3)) * stand;
    const run = smooth(clamp01((rel - 1.45) / 0.9)) * move;
    const cadence = CADENCE[stage] * (1.25 - 0.5 * legGene) * lerp(1, 0.62, run);
    const ph = legPhase(e, num(M.walkPhase, 0), cadence, advance);
    const bob = move * lerp((0.5 - 0.5 * Math.cos(2 * ph)) * (0.5 + 0.5 * legGene), (0.5 - 0.5 * Math.cos(ph - 0.7)) * 2.4, run) * lerp(0.6, 1, g);

    // Body
    let by = -(legLen + ryB) - bob + legLen * (0.45 * fear + 0.12 * sick + 0.1 * ag + 0.25 * cold);
    by = lerp(by, -ryB * 0.9, lying);
    let ang = -0.05 + 0.09 * run + 0.11 * Math.sin(ph) * run + 0.15 * eat - 0.1 * calling + 0.07 * ag - 0.1 * flinch;
    ang = lerp(ang, dead ? 0.02 : 0.03, lying);
    if (air) ang = -0.14;
    let bx = -((rxF * 0.72 + R * 1.12) - rxB) / 2;
    // Held by the scruff: the body hangs straight down below the head
    if (held) { ang = -1.42; bx = -R * 0.12; by = R * 0.5 + rxF * 0.8; }
    r.bx = bx; r.by = by; r.ang = ang;
    r.bristle = anger > 0.2 ? anger : 0;
    const ca = Math.cos(ang), sa = Math.sin(ang);

    // Legs: far hind, far front, near hind, near front (drawing order)
    // Each foot swings forward, then sweeps back on the ground for `duty` of the cycle at the
    // body's speed (it moves 1 / (0.35 × cadence) px per radian), so it stays planted; the
    // stride is capped at what the legs can reach
    const duty = lerp(0.6, 0.42, run);
    const planted = PI * duty / (PHASE_PER_PX * cadence * r.k);
    const stride = Math.min(planted, reach * lerp(0.8, 0.62, g));
    const lift = (1.1 + 0.35 * legLen) * (1 + 0.6 * run);
    const legs = r.legs;
    for (let i = 0; i < 4; i++) {
      const front = i & 1, far = i < 2;
      const lx = (front ? rxF * 0.5 : -rxB * 0.5) + (far ? 1.9 : 0);
      const ly = ryB * (front ? 0.38 : 0.4) - (far ? 0.9 : 0);
      const hx = bx + ca * lx - sa * ly, hy = by + sa * lx + ca * ly;
      const off = front ? (far ? lerp(PI, 0.55, run) : 0) : (far ? lerp(0, PI + 0.55, run) : PI);
      let u = ((ph + off) / TAU) % 1, sweep, up;
      if (u < 0) u += 1;
      if (u < 1 - duty) { const s = u / (1 - duty); sweep = -Math.cos(s * PI); up = Math.sin(s * PI); }
      else { sweep = 1 - 2 * (u - 1 + duty) / duty; up = 0; }
      let fx = hx + 0.3 + sweep * stride * move, fy = -up * lift * move;
      if (air) {
        fx = hx + (front ? reach * 0.6 : -reach * 0.7);
        fy = hy + reach * (front ? 0.78 : 0.68) + pawRy;
      }
      if (lying > 0) {
        const lfx = dead ? hx + (front ? 1 : -1) * (reach + 2.5) : hx + reach * (front ? 0.62 : 0.42) + 1;
        fx = lerp(fx, lfx, lying); fy = lerp(fy, 0, lying);
      }
      if (held) {
        fx = hx + 0.6 + Math.sin(t * 1.9 + i * 1.3) * 0.5;
        fy = hy + reach * 0.96 + pawRy;
      }
      legs[i * 4] = hx; legs[i * 4 + 1] = hy; legs[i * 4 + 2] = fx; legs[i * 4 + 3] = fy;
    }

    // Tail: a chain of puffs from the rump
    const smile = clamp(num(F.smile, 0), -1, 1);
    const happy = clamp01(smile - 0.2) * live * (1 - lying);
    let up = 0.78 - 0.12 * move - 0.45 * run - 0.4 * Math.max(0, -smile) + 0.2 * anger - 0.3 * sick - 0.25 * ag - 0.3 * cold - 0.3 * wet;
    let curl = 1.5 - 0.9 * run + 0.2 * anger - 0.3 * cold - 0.4 * wet;
    up = lerp(up, dead ? 0.02 : 0.1, lying); curl = lerp(curl, dead ? 0.15 : 1.1, lying);
    if (air) { up = 0.35; curl = 0.6; }
    const tLen = (8 + 17 * tailGene) * lerp(0.55, 1, g);
    const tW = (2.3 + 1.1 * plump) * lerp(0.8, 1, g) * (1 + 0.5 * anger) * (1 - 0.3 * wet);
    const wagA = dead ? 0 : (0.06 + 0.2 * happy + 0.06 * move) * (asleep ? 0.3 : 1);
    const wagF = (1.2 + 5 * happy) * tempo;
    let tx = bx + ca * (-rxB * 0.86) - sa * (-ryT * 0.18), ty = by + sa * (-rxB * 0.86) + ca * (-ryT * 0.18);
    let a0 = PI + up * 1.2;
    // Fear tucks the tail down and under the belly
    if (fear > 0) { a0 = lerp(a0, PI * 0.56, fear); curl = lerp(curl, -1.3, fear); }
    if (held) { a0 = PI * 0.5 + 0.15; curl = -0.5; }
    const seg = tLen / (TAIL_N - 1), T = r.tail;
    for (let i = 0; i < TAIL_N; i++) {
      const s = i / (TAIL_N - 1);
      const a = a0 + curl * Math.pow(s, 1.4) + Math.sin(t * wagF + ph0 - i * 0.55) * wagA * (0.3 + s);
      if (i > 0) { tx += Math.cos(a) * seg; ty += Math.sin(a) * seg; }
      if (!held && ty > -tW * 0.9) ty = -tW * 0.9;   // resting tails lie on the ground, not in it
      T[i * 3] = tx; T[i * 3 + 1] = ty;
      T[i * 3 + 2] = tW * (0.6 + 0.62 * Math.pow(s, 0.7) - 0.18 * s * s * s) * (i === TAIL_N - 1 ? 0.84 : 1);
    }

    // Head
    let hx = bx + ca * (rxF * 0.72) - sa * (-ryT * 0.5 - R * 0.55);
    let hy = by + sa * (rxF * 0.72) + ca * (-ryT * 0.5 - R * 0.55);
    let hAng = Math.sin(t * 0.6 * tempo + ph0 * 2) * 0.035 * live + 0.08 * senile + 0.05 * sick;
    hy -= 2.4 * calling; hAng -= 0.42 * calling;
    hx -= 2 * flinch + 1.2 * fear; hy += 1.2 * flinch + 1.6 * fear; hAng -= 0.2 * flinch;
    if (eat) {
      const chew = Math.sin(t * 9);
      hx = lerp(hx, bx + rxF + R * 0.25, 0.85);
      hy = lerp(hy, -R * 0.88 - 0.6 * Math.max(0, chew), 0.85);
      hAng += 0.22 + 0.04 * chew;
    }
    if (lying > 0) {
      const lhx = bx + rxF * 0.9 + R * (dead ? 0.45 : 0.18), lhy = -R * (dead ? 0.86 : 0.93);
      hx = lerp(hx, lhx, lying); hy = lerp(hy, lhy, lying);
      hAng = lerp(hAng, dead ? -0.38 : asleep ? 0.12 : 0.04, lying);
    }
    if (air) { hAng -= 0.1; }
    hy -= (r.breath - 1) * ryT * (1.2 - 0.8 * lying);
    if (held) { hx = 0; hy = 0; hAng = -0.08 + Math.sin(t * 1.3 + ph0) * 0.05; }
    r.hx = hx; r.hy = hy; r.hAng = hAng;

    // Ears: droop from tiredness, illness and age; pinned back by fear and anger
    const droop = clamp01(Math.max(num(F.earDroop, 0), sick * 0.7, 0.3 * ag + 0.35 * senile, asleep ? 0.45 : 0,
      cold * 0.35, hot * 0.3, wet * 0.45, dead ? 1 : 0, 0.15 * baby));
    const tw = (t + e.twitchO) % e.twitchP, twitch = tw < 0.28 && live && !asleep ? Math.sin(tw / 0.28 * PI) * 0.32 : 0;
    const twNear = ((t + e.twitchO) / e.twitchP | 0) & 1;
    const back = 1.0 * fear + 0.42 * anger + 0.35 * run + 0.3 * air + 0.25 * flinch - 0.22 * calling + (held ? 0.3 : 0);
    r.earN = -0.8 - droop * 1.0 - back - (twNear ? twitch : 0);
    r.earF = 0.26 - droop * 1.35 - back * 0.95 - (twNear ? 0 : twitch);
    r.earLen = R * (0.8 + 0.72 * earGene) * lerp(1.05, 1, g);
    r.earW = R * (0.66 + 0.24 * earGene);

    // Crest: a neutral tuft in the young, then a plume (female) or a fan (male)
    r.crest = R * (0.36 + 0.46 * crestGene) * CREST[stage] * (dead ? 0.8 : 1);
    r.crestKind = stage <= 2 ? 0 : r.female ? 1 : 2;
    r.crestSway = Math.sin(t * 1.3 * tempo + ph0) * 0.06 * live - 0.25 * run - 0.2 * air;

    // Eyes
    const blinkT = (t * tempo + e.blinkO) % e.blinkP;
    const blink = blinkT < 0.17 ? Math.sin(blinkT / 0.17 * PI) : 0;
    let closed = Math.max(num(F.eyesClosed, 0), blink, asleep ? 1 : 0, sick * 0.42, senile * 0.3, ag * 0.12, anger * 0.22);
    closed *= 1 - 0.8 * fear;
    r.closed = clamp01(closed);
    r.eyeMode = dead ? 4 : flinch > 0.45 ? 3 : r.closed > 0.86 ? (smile > 0.35 && !asleep ? 2 : 1) : 0;
    r.eR = R * (0.26 + 0.13 * eyeGene) * lerp(1.14, 1, g) * (1 + 0.12 * fear);
    r.px = clamp(num(F.pupilX, 0), -1, 1) * facing;
    r.py = clamp(num(F.pupilY, 0), -1, 1);
    r.pupil = 0.5 + 0.06 * baby - 0.24 * fear;
    r.lidTilt = anger * 0.5 - 0.25 * Math.max(fear, sick * 0.5);

    // Mouth and face
    r.smile = clamp(smile - 0.4 * sick - 0.3 * fear - 0.5 * anger - 0.3 * cold, -1, 1);
    const pant = hot > 0.25 ? (0.35 + 0.15 * Math.sin(t * TAU * 3)) * hot : 0;
    const chewOpen = eat ? 0.12 + 0.38 * Math.max(0, Math.sin(t * 9)) : 0;
    r.mouthOpen = dead ? 0.22 : clamp01(Math.max(num(F.mouthOpen, 0), calling * 0.85, pant, chewOpen, fear * 0.2));
    r.tongue = dead ? 0.6 : hot > 0.25 ? hot : 0;
    r.fang = anger > 0.35 ? anger : 0;
    r.wavy = sick > 0.45 && r.mouthOpen < 0.1 ? 1 : 0;
    r.blush = clamp01(Math.max(num(F.blush, 0), hot * 0.7, 0.28 * baby, cold * 0.4)) * live;
    r.browAnger = anger;
    r.browWorry = Math.max(fear, sick * 0.5, Math.max(0, -smile) * 0.6);

    // Whole-body effects
    r.offX = -2.2 * flinch + Math.sin(t * 53) * 0.35 * fear + Math.sin(t * 61 + 1) * 0.4 * cold;
    r.sx = (1 + 0.12 * flinch) * (air ? 0.95 : 1);
    r.sy = (1 - 0.15 * flinch) * (air ? 1.06 : 1);
    r.swing = held ? Math.sin(t * 2.1 + ph0) * 0.12 : 0;
    r.ol = 0.95 * Math.pow(40 / Math.max(8, num(pose.size, 32)), 0.3);

    // Ground: shadow at the feet; while airborne only if the pose says where the ground is
    const gy = typeof pose.groundY === 'number' ? (pose.groundY - pose.y) / r.k : null;
    r.shadow = held ? 0 : air ? (gy === null ? 0 : clamp01(1 - gy / 60)) : 1;
    r.shadowY = air && gy !== null ? gy : 0;

    if (held) shiftForScruff(r);
  }

  // While held, the hand grips the scruff (the nape, behind the head) 0.7 × size above (x, y), as
  // the simulation places a held creature: move the rig so the scruff sits there
  function shiftForScruff(r) {
    headPoint(r, -r.R * 0.66, r.R * 0.5, P);
    const dx = -P[0], dy = GRIP_Y - P[1];
    r.bx += dx; r.by += dy; r.hx += dx; r.hy += dy;
    for (let i = 0; i < 16; i += 2) { r.legs[i] += dx; r.legs[i + 1] += dy; }
    for (let i = 0; i < TAIL_N * 3; i += 3) { r.tail[i] += dx; r.tail[i + 1] += dy; }
  }

  // ---- Paths -----------------------------------------------------------------------------------

  // Egg-shaped body: rounder rump, belly lower than the back (all four arcs run clockwise)
  function bodyPath(ctx, r) {
    const b = r.breath, rxF = r.rxF, rxB = r.rxB, ryT = r.ryT * b, ryB = r.ryB * (0.5 + 0.5 * b);
    ctx.moveTo(rxF, 0);
    ctx.ellipse(0, 0, rxF, ryB, 0, 0, PI * 0.5);
    ctx.ellipse(0, 0, rxB, ryB, 0, PI * 0.5, PI);
    ctx.ellipse(0, 0, rxB, ryT, 0, PI, PI * 1.5);
    ctx.ellipse(0, 0, rxF, ryT, 0, PI * 1.5, TAU);
    ctx.closePath();
    if (r.bristle) {
      // Raised hackles along the back
      const n = 6, hgt = 1.2 + 2.4 * r.bristle;
      for (let i = 0; i < n; i++) {
        const a = PI * 1.12 + (i / (n - 1)) * PI * 0.62, d = 0.13;
        const rx = a < PI * 1.5 ? rxB : rxF;
        ctx.moveTo(Math.cos(a - d) * rx * 0.97, Math.sin(a - d) * ryT * 0.97);
        ctx.lineTo(Math.cos(a) * (rx + hgt), Math.sin(a) * (ryT + hgt));
        ctx.lineTo(Math.cos(a + d) * rx * 0.97, Math.sin(a + d) * ryT * 0.97);
        ctx.closePath();
      }
    }
    if (r.wet > 0.25) {
      // Wet fur hangs in dripping points under the belly
      const n = 7, hgt = 2.2 * r.wet;
      for (let i = 0; i < n; i++) {
        const a = PI * 0.16 + (i / (n - 1)) * PI * 0.7, d = 0.12, rx = a < PI * 0.5 ? rxF : rxB;
        const l = hgt * (0.7 + 0.3 * Math.sin(i * 2.3));
        ctx.moveTo(Math.cos(a - d) * rx * 0.97, Math.sin(a - d) * ryB * 0.97);
        ctx.lineTo(Math.cos(a) * rx, Math.sin(a) * ryB + l);
        ctx.lineTo(Math.cos(a + d) * rx * 0.97, Math.sin(a + d) * ryB * 0.97);
        ctx.closePath();
      }
    }
  }

  // Round head with a snout and fluffy cheeks (all sub-paths clockwise, so they fill as one)
  function headPath(ctx, r) {
    const R = r.R, cheek = R * (0.2 + 0.06 * (1 - r.g));
    ctx.beginPath();
    ctx.ellipse(0, 0, R * 1.04, R * 0.95, 0, 0, TAU);
    ctx.moveTo(R * 0.78 + R * 0.34, R * 0.3);
    ctx.ellipse(R * 0.78, R * 0.3, R * 0.34, R * 0.29, -0.12, 0, TAU);
    for (let i = 0; i < 3; i++) {
      const a = 1.95 + i * 0.36, cx = Math.cos(a) * R * 0.88, cy = Math.sin(a) * R * 0.82;
      ctx.moveTo(cx + cheek, cy);
      ctx.arc(cx, cy, cheek, 0, TAU);
    }
  }

  function earPath(ctx, len, w) {
    ctx.beginPath();
    ctx.moveTo(-w * 0.5, 0);
    ctx.bezierCurveTo(-w * 0.9, -len * 0.42, -w * 0.56, -len * 0.98, 0, -len);
    ctx.bezierCurveTo(w * 0.52, -len * 0.98, w * 0.82, -len * 0.4, w * 0.5, 0);
  }

  // Legs [from, to) as one stroke each: hip, a slight knee, then the foot pointing forward
  function legPath(ctx, r, from, to) {
    const L = r.legs, h = r.legW * 0.5, foot = r.legW * 0.62;
    ctx.beginPath();
    for (let i = from; i < to; i++) {
      const hx = L[i * 4], hy = L[i * 4 + 1], fx = L[i * 4 + 2], fy = L[i * 4 + 3] - h;
      const bend = i & 1 ? 0.6 : -1.4;
      ctx.moveTo(hx, hy);
      ctx.quadraticCurveTo((hx + fx) / 2 + bend, (hy + fy) / 2, fx, fy);
      ctx.lineTo(fx + foot, fy);
    }
  }

  function tailPath(ctx, r, from, to, grow) {
    const T = r.tail;
    ctx.beginPath();
    for (let i = from; i < to; i++) {
      const x = T[i * 3], y = T[i * 3 + 1], rad = T[i * 3 + 2] + grow;
      ctx.moveTo(x + rad, y);
      ctx.arc(x, y, rad, 0, TAU);
    }
  }

  // ---- Parts -----------------------------------------------------------------------------------

  function drawGround(ctx, r, pose, grad) {
    if (r.shadow > 0) {
      const w = (r.rxB + r.rxF) * (0.62 + 0.18 * r.lying) * (1 - 0.4 * (1 - r.shadow));
      ctx.save();
      ctx.translate(0, r.shadowY);
      ctx.scale(w, w * 0.2);
      ctx.globalAlpha = 0.9 * r.shadow;
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill();
      ctx.restore();
    }
    if ((pose.focused || pose.hovered) && !r.held) {
      // A soft ring on the ground in the accent colour, over a dark edge so it shows on any ground
      const w = (r.rxB + r.rxF) * 0.78 + 3, px = 1 / (r.k * r.pxScale), focused = !!pose.focused;
      ctx.beginPath();
      ctx.ellipse(0, r.shadowY + 0.5, w, w * 0.24, 0, 0, TAU);
      ctx.globalAlpha = focused ? 0.35 : 0.25;
      ctx.strokeStyle = '#06131a'; ctx.lineWidth = (focused ? 4.4 : 3.2) * px; ctx.stroke();
      ctx.globalAlpha = focused ? 1 : 0.6;
      ctx.strokeStyle = token('--accent'); ctx.lineWidth = (focused ? 2.2 : 1.4) * px; ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function drawTail(ctx, r, pal) {
    const n = TAIL_N, ol = r.ol;
    tailPath(ctx, r, 0, n, 0);
    ctx.lineWidth = ol * 2; ctx.strokeStyle = pal.line; ctx.stroke();
    ctx.fillStyle = pal.leg; ctx.fill();
    // Soft highlight along the upper side of each puff
    if (r.lod > 0) {
      const T = r.tail;
      ctx.beginPath();
      for (let i = 1; i < n - 2; i++) {
        const x = T[i * 3] + T[i * 3 + 2] * 0.12, y = T[i * 3 + 1] - T[i * 3 + 2] * 0.28, rad = T[i * 3 + 2] * 0.62;
        ctx.moveTo(x + rad, y);
        ctx.arc(x, y, rad, 0, TAU);
      }
      ctx.fillStyle = pal.fur; ctx.fill();
    }
    if (r.pattern === 1) {
      // Ringed tail
      const T = r.tail;
      ctx.beginPath();
      for (let i = 2; i < n - 2; i += 2) {
        const x = T[i * 3], y = T[i * 3 + 1], rad = T[i * 3 + 2] * 0.92;
        ctx.moveTo(x + rad, y);
        ctx.arc(x, y, rad, 0, TAU);
      }
      ctx.fillStyle = pal.mark; ctx.fill();
    }
    tailPath(ctx, r, n - 2, n, 0);
    ctx.fillStyle = r.pattern === 3 ? pal.patch : pal.belly; ctx.fill();
  }

  function drawFarLegs(ctx, r, pal) {
    const ol = r.ol;
    ctx.strokeStyle = pal.line;
    legPath(ctx, r, 0, 2);
    ctx.lineWidth = r.legW + ol * 2; ctx.stroke();
    ctx.lineWidth = r.legW; ctx.strokeStyle = pal.far; ctx.stroke();
  }

  function drawBody(ctx, r, e, pal) {
    const ol = r.ol;
    // Outline pass: near legs and body together, so they read as one soft shape
    ctx.strokeStyle = pal.line;
    legPath(ctx, r, 2, 4); ctx.lineWidth = r.legW + ol * 2; ctx.stroke();
    ctx.save();
    ctx.translate(r.bx, r.by); ctx.rotate(r.ang);
    ctx.beginPath(); bodyPath(ctx, r);
    ctx.lineWidth = ol * 2; ctx.stroke();
    ctx.restore();
    // Fill pass
    legPath(ctx, r, 2, 4); ctx.lineWidth = r.legW; ctx.strokeStyle = pal.leg; ctx.stroke();
    if (r.lod > 1) toes(ctx, r, pal);

    ctx.save();
    ctx.translate(r.bx, r.by); ctx.rotate(r.ang);
    const rxF = r.rxF, rxB = r.rxB, ryT = r.ryT, ryB = r.ryB;
    // Soft top-lit shading, cached until the colours or proportions change
    if (e.bodyV !== e.palVer || e.bodyK !== rxF + ryT * 1e3) {
      const g = e.bodyG = ctx.createRadialGradient(rxF * 0.2, -ryT * 0.6, 0, rxF * 0.05, -ryT * 0.2, rxB * 1.25);
      g.addColorStop(0, pal.hi); g.addColorStop(0.5, pal.fur); g.addColorStop(1, pal.lo);
      e.bodyV = e.palVer; e.bodyK = rxF + ryT * 1e3;
    }
    ctx.beginPath(); bodyPath(ctx, r);
    ctx.fillStyle = e.bodyG; ctx.fill();
    ctx.clip();
    // Pale belly and chest bib
    ctx.beginPath();
    ctx.ellipse(rxF * 0.05, ryB * 0.8, rxF * 0.95, ryB * 0.55, 0, 0, TAU);
    ctx.moveTo(rxF * 0.8 + ryB * 0.62, ryB * 0.15);
    ctx.arc(rxF * 0.8, ryB * 0.15, ryB * 0.62, 0, TAU);
    ctx.fillStyle = pal.belly; ctx.fill();
    if (r.lod > 0) bodyPattern(ctx, r, e, pal);
    // Haunch: a soft crease that gives the near hind leg a thigh
    ctx.beginPath();
    ctx.ellipse(-rxB * 0.5, ryB * 0.3, rxB * 0.38, ryB * 0.56, -0.2, PI * 1.2, PI * 1.8);
    ctx.lineWidth = ol * 0.8; ctx.globalAlpha = 0.6; ctx.strokeStyle = pal.lo; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.restore();
  }

  function toes(ctx, r, pal) {
    const L = r.legs;
    ctx.beginPath();
    for (let i = 2; i < 4; i++) {
      const w = r.legW, x = L[i * 4 + 2] + w * 0.62, y = L[i * 4 + 3] - w * 0.5;
      ctx.moveTo(x, y - w * 0.12); ctx.lineTo(x + w * 0.06, y + w * 0.4);
      ctx.moveTo(x - w * 0.34, y - w * 0.12); ctx.lineTo(x - w * 0.3, y + w * 0.4);
    }
    ctx.lineWidth = r.ol * 0.6; ctx.strokeStyle = pal.lo; ctx.stroke();
  }

  function bodyPattern(ctx, r, e, pal) {
    const rxF = r.rxF, rxB = r.rxB, ryT = r.ryT, ryB = r.ryB, sc = r.patternScale;
    if (r.pattern === 1) {
      // Tapered stripes down from the back, like a tabby
      const n = Math.round(lerp(6, 3, sc)), w = lerp(1.4, 2.8, sc);
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = lerp(-rxB * 0.78, rxF * 0.35, n === 1 ? 0.5 : i / (n - 1)) + e.stripes[i] * 1.5;
        const bend = -1.6 - e.stripes[5 - i] * 1.2;
        ctx.moveTo(x - w, -ryT - 1);
        ctx.lineTo(x + w, -ryT - 1);
        ctx.quadraticCurveTo(x + w * 0.6 + bend, -ryT * 0.2, x + bend * 1.3, ryB * (0.22 + 0.1 * sc));
        ctx.quadraticCurveTo(x - w * 0.6 + bend, -ryT * 0.25, x - w, -ryT - 1);
      }
      ctx.fillStyle = pal.mark; ctx.fill();
    } else if (r.pattern === 2) {
      // Spots over the back and flank
      const n = Math.round(lerp(10, 5, sc)), rad = lerp(1.0, 2.3, sc);
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const u = e.spots[i * 3], v = e.spots[i * 3 + 1], s = e.spots[i * 3 + 2];
        const x = lerp(-rxB * 0.85, rxF * 0.5, u), y = lerp(-ryT * 0.85, ryB * 0.15, v), rr = rad * (0.65 + 0.6 * s);
        ctx.moveTo(x + rr, y);
        ctx.ellipse(x, y, rr, rr * 0.86, 0, 0, TAU);
      }
      ctx.fillStyle = pal.mark; ctx.fill();
    } else if (r.pattern === 3) {
      // Two soft patches (each a cluster of blobs) on the rump and shoulder
      const P = e.patches, size = lerp(3.6, 6.4, sc);
      ctx.beginPath();
      for (let j = 0; j < 2; j++) {
        const cx = j ? rxF * (0.1 + 0.3 * P[0]) : -rxB * (0.35 + 0.3 * P[1]), cy = -ryT * (0.35 + 0.35 * P[2 + j]);
        for (let i = 0; i < 3; i++) {
          const a = P[4 + j * 3 + i] * TAU, d = size * 0.55, rr = size * (0.62 + 0.3 * P[(5 + i + j) % 12]);
          const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.7;
          ctx.moveTo(x + rr, y);
          ctx.arc(x, y, rr, 0, TAU);
        }
      }
      ctx.fillStyle = pal.patch; ctx.fill();
    }
  }

  const EAR_N = -2.2, EAR_F = -0.92;   // where the ears sit on the head (angle from the centre)

  function drawEar(ctx, r, pal, near) {
    const R = r.R, len = r.earLen * (near ? 1 : 0.9), w = r.earW * (near ? 1 : 0.88);
    const a = near ? EAR_N : EAR_F;
    ctx.save();
    ctx.translate(Math.cos(a) * R * 0.72, Math.sin(a) * R * 0.72);
    ctx.rotate(near ? r.earN : r.earF);
    earPath(ctx, len, w);
    ctx.fillStyle = near ? pal.fur : pal.far; ctx.fill();
    ctx.lineWidth = r.ol; ctx.strokeStyle = pal.line; ctx.stroke();
    if (r.lod > 0) {
      ctx.save();
      ctx.translate(0, -len * 0.1);
      earPath(ctx, len * 0.74, w * 0.54);
      ctx.fillStyle = near ? pal.inner : pal.innerFar; ctx.fill();
      ctx.restore();
    }
    if (!r.female && r.stage >= 3) {
      // Male ear-tip tufts
      ctx.beginPath();
      ctx.moveTo(-w * 0.12, -len * 0.95);
      ctx.quadraticCurveTo(-w * 0.04, -len * 1.16, -w * 0.26, -len * 1.32);
      ctx.quadraticCurveTo(w * 0.1, -len * 1.14, w * 0.1, -len * 0.96);
      ctx.fillStyle = pal.line; ctx.fill();
    }
    ctx.restore();
  }

  // Crest fronds as [lean angle, length, width] triples, in units of the crest size
  const FRONDS_F = [0.05, 1.12, 0.46, -0.57, 0.86, 0.46];
  const FRONDS_M = [0.12, 1.02, 0.3, -0.32, 1.22, 0.3, -0.76, 0.9, 0.3];

  function drawCrest(ctx, r, pal) {
    const cs = r.crest;
    if (cs < 0.6) return;
    const R = r.R, ol = r.ol;
    ctx.save();
    ctx.translate(R * 0.04, -R * 0.9);
    ctx.rotate(-0.2 + r.crestSway);
    if (r.heat > 0) {
      // Breeding display: the crest glows in the colour of its sex
      ctx.save();
      ctx.translate(0, -cs * 0.7); ctx.scale(cs * 2.3, cs * 2.3);
      ctx.globalAlpha = r.heat;
      ctx.fillStyle = gradients(ctx)[r.female ? 'female' : 'male'];
      ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill();
      ctx.restore();
    }
    const fill = r.heat > 0 ? pal.crestHi : pal.crest;
    ctx.strokeStyle = pal.line;
    if (r.crestKind === 0) {
      // Baby tuft: three soft curls
      ctx.beginPath();
      for (let i = -1; i <= 1; i++) {
        ctx.moveTo(i * cs * 0.18, cs * 0.1);
        ctx.quadraticCurveTo(i * cs * 0.35, -cs * 0.7, i * cs * 0.3 + cs * 0.28, -cs * (0.95 - 0.15 * Math.abs(i)));
      }
      ctx.lineWidth = ol * 2.8; ctx.stroke();
      ctx.lineWidth = ol * 1.3; ctx.strokeStyle = fill; ctx.stroke();
    } else {
      // Female: soft round-tipped fronds; male: a spiky fan swept back like a cockatiel's
      const fem = r.crestKind === 1, F = fem ? FRONDS_F : FRONDS_M;
      ctx.beginPath();
      for (let i = 0; i < F.length; i += 3) {
        ctx.save(); frond(ctx, F[i], F[i + 1] * cs, F[i + 2] * cs, fem); ctx.restore();
      }
      ctx.lineWidth = ol * 2; ctx.stroke();
      ctx.fillStyle = fill; ctx.fill();
      if (r.lod > 0) {
        // Midribs
        ctx.beginPath();
        for (let i = 0; i < F.length; i += 3) {
          const l = F[i + 1] * cs;
          ctx.save(); ctx.rotate(F[i]);
          ctx.moveTo(0, -l * 0.12); ctx.quadraticCurveTo(-l * 0.02, -l * 0.5, -l * (fem ? 0.1 : 0.16), -l * 0.78);
          ctx.restore();
        }
        ctx.lineWidth = ol * 0.9; ctx.strokeStyle = pal.crestHi; ctx.stroke();
      }
    }
    if (r.heat > 0.7 && r.lod > 0) sparkle(ctx, cs * 0.95, -cs * 1.35, cs * 0.26 * (r.heat - 0.6) * 2.5, '#ffffff');
    ctx.restore();
  }

  // One crest frond, base at the origin, leaning by angle a; tips bend backwards
  function frond(ctx, a, l, w, round) {
    ctx.rotate(a);
    ctx.moveTo(-w * 0.5, 0);
    if (round) {
      ctx.bezierCurveTo(-w * 0.95, -l * 0.5, -w * 0.8, -l, -l * 0.1, -l);
      ctx.bezierCurveTo(w * 0.5, -l, w * 0.85, -l * 0.45, w * 0.5, 0);
    } else {
      ctx.quadraticCurveTo(-w * 0.45, -l * 0.62, -l * 0.22, -l);
      ctx.quadraticCurveTo(w * 0.75, -l * 0.5, w * 0.5, 0);
    }
    ctx.closePath();
  }

  function sparkle(ctx, x, y, s, color) {
    ctx.beginPath();
    ctx.moveTo(x, y - s); ctx.quadraticCurveTo(x, y, x + s, y); ctx.quadraticCurveTo(x, y, x, y + s);
    ctx.quadraticCurveTo(x, y, x - s, y); ctx.quadraticCurveTo(x, y, x, y - s);
    ctx.fillStyle = color; ctx.fill();
  }

  function drawHead(ctx, r, e, pal) {
    const R = r.R, ol = r.ol;
    ctx.save();
    ctx.translate(r.hx, r.hy);
    ctx.rotate(r.hAng);
    drawEar(ctx, r, pal, false);

    headPath(ctx, r);
    ctx.lineWidth = ol * 2; ctx.strokeStyle = pal.line; ctx.stroke();
    if (e.headV !== e.palVer || e.headK !== R) {
      const g = e.headG = ctx.createRadialGradient(R * 0.25, -R * 0.45, 0, R * 0.1, -R * 0.1, R * 1.25);
      g.addColorStop(0, pal.hi); g.addColorStop(0.55, pal.fur); g.addColorStop(1, pal.lo);
      e.headV = e.palVer; e.headK = R;
    }
    ctx.fillStyle = e.headG; ctx.fill();
    ctx.save();
    ctx.clip();
    // Pale muzzle and chin
    ctx.beginPath();
    ctx.ellipse(R * 0.76, R * 0.4, R * 0.46, R * 0.34, -0.1, 0, TAU);
    ctx.moveTo(R * 0.4 + R * 0.42, R * 0.78);
    ctx.ellipse(R * 0.4, R * 0.78, R * 0.42, R * 0.26, 0, 0, TAU);
    ctx.fillStyle = pal.belly; ctx.fill();
    if (r.lod > 0) headPattern(ctx, r, e, pal);
    if (r.sick > 0.2) {
      // Queasy green wash over the lower face
      ctx.beginPath(); ctx.ellipse(R * 0.3, R * 0.55, R * 1.1, R * 0.62, 0, 0, TAU);
      ctx.globalAlpha = 0.4 * r.sick; ctx.fillStyle = '#7fcf5a'; ctx.fill(); ctx.globalAlpha = 1;
    }
    ctx.restore();

    drawEar(ctx, r, pal, true);
    drawCrest(ctx, r, pal);
    drawFace(ctx, r, pal);
    ctx.restore();
  }

  function headPattern(ctx, r, e, pal) {
    const R = r.R, sc = r.patternScale;
    if (r.pattern === 1) {
      // Forehead stripes
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const x = R * (-0.1 + i * 0.26), w = R * lerp(0.06, 0.1, sc);
        ctx.moveTo(x - w, -R);
        ctx.lineTo(x + w, -R);
        ctx.quadraticCurveTo(x + w * 0.4, -R * 0.72, x + R * 0.04, -R * (0.5 + 0.08 * Math.abs(i - 1)));
        ctx.closePath();
      }
      ctx.fillStyle = pal.mark; ctx.fill();
    } else if (r.pattern === 2) {
      // A few spots on the brow and cheek
      const rr = R * lerp(0.07, 0.11, sc);
      ctx.beginPath();
      ctx.moveTo(-R * 0.08 + rr, -R * 0.62); ctx.arc(-R * 0.08, -R * 0.62, rr, 0, TAU);
      ctx.moveTo(R * 0.14 + rr, -R * 0.7); ctx.arc(R * 0.14, -R * 0.7, rr * 0.8, 0, TAU);
      ctx.moveTo(-R * 0.5 + rr, R * 0.1); ctx.arc(-R * 0.5, R * 0.1, rr * 0.9, 0, TAU);
      ctx.moveTo(-R * 0.62 + rr, -R * 0.14); ctx.arc(-R * 0.62, -R * 0.14, rr * 0.7, 0, TAU);
      ctx.fillStyle = pal.mark; ctx.fill();
    } else if (r.pattern === 3) {
      // A patch over the ear-side of the head, sometimes around the eye
      ctx.beginPath();
      if (e.eyePatch) ctx.ellipse(R * 0.02, -R * 0.1, R * lerp(0.38, 0.5, sc), R * lerp(0.36, 0.46, sc), -0.3, 0, TAU);
      else ctx.ellipse(-R * 0.55, -R * 0.55, R * lerp(0.45, 0.6, sc), R * 0.5, 0.5, 0, TAU);
      ctx.fillStyle = pal.patch; ctx.fill();
    }
  }

  function drawFace(ctx, r, pal) {
    const R = r.R, g = r.g, eR = r.eR;
    const nx = R * 0.1, ny = R * (0.02 + 0.1 * (1 - g)), fx = R * 0.68, fy = R * (-0.02 + 0.08 * (1 - g));
    const E = EYES;
    E[0] = nx; E[1] = ny; E[2] = eR * 0.92; E[3] = eR; E[4] = 1;
    E[5] = fx; E[6] = fy; E[7] = eR * 0.56; E[8] = eR * 0.93; E[9] = -1;
    drawEyes(ctx, r, pal);
    if (r.lod > 0) drawBrows(ctx, r, pal, nx, ny, fx, fy);

    // Blush
    if (r.blush > 0.02) {
      ctx.globalAlpha = r.blush * 0.6;
      ctx.fillStyle = '#ff7f9e';
      ctx.beginPath();
      ctx.ellipse(-R * 0.08, R * 0.5, R * 0.22, R * 0.12, 0, 0, TAU);
      ctx.moveTo(R * 0.68, R * 0.46);
      ctx.ellipse(R * 0.58, R * 0.46, R * 0.1, R * 0.08, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Nose
    const nX = R * 1.03, nY = R * 0.2;
    ctx.beginPath();
    ctx.moveTo(nX - R * 0.17, nY - R * 0.07);
    ctx.quadraticCurveTo(nX - R * 0.02, nY - R * 0.15, nX + R * 0.12, nY - R * 0.06);
    ctx.quadraticCurveTo(nX + R * 0.08, nY + R * 0.1, nX - R * 0.03, nY + R * 0.11);
    ctx.quadraticCurveTo(nX - R * 0.16, nY + R * 0.05, nX - R * 0.17, nY - R * 0.07);
    ctx.fillStyle = pal.nose; ctx.fill();
    if (r.lod > 0) {
      ctx.beginPath(); ctx.ellipse(nX - R * 0.05, nY - R * 0.05, R * 0.05, R * 0.03, -0.2, 0, TAU);
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fill();
    }
    drawMouth(ctx, r, pal);
    if (r.ag > 0 && r.lod > 0) whiskers(ctx, r);
  }

  // Both eyes, layer by layer (whites, irises, pupils, shine, lids, outlines), so each layer is a
  // single fill. The far eye is foreshortened. EYES holds x, y, rx, ry, side for the near and far eye.
  const EYES = new Float32Array(10);

  function drawEyes(ctx, r, pal) {
    const ol = r.ol, mode = r.eyeMode, E = EYES;
    ctx.strokeStyle = pal.line;
    ctx.beginPath();
    if (mode) {
      for (let i = 0; i < 10; i += 5) {
        const x = E[i], y = E[i + 1], rx = E[i + 2], ry = E[i + 3], side = E[i + 4];
        if (mode === 4) {
          // X: dead
          const s = ry * 0.6, sx = s * rx / ry;
          ctx.moveTo(x - sx, y - s); ctx.lineTo(x + sx, y + s);
          ctx.moveTo(x + sx, y - s); ctx.lineTo(x - sx, y + s);
        } else if (mode === 3) {
          // Squeezed shut: > <
          ctx.moveTo(x - side * rx * 0.75, y - ry * 0.55); ctx.lineTo(x + side * rx * 0.6, y); ctx.lineTo(x - side * rx * 0.75, y + ry * 0.55);
        } else if (mode === 2) {
          // Happy arcs
          ctx.moveTo(x - rx * 0.85, y + ry * 0.2); ctx.quadraticCurveTo(x, y - ry * 0.75, x + rx * 0.85, y + ry * 0.2);
        } else {
          // Sleepy arcs
          ctx.moveTo(x - rx * 0.88, y); ctx.quadraticCurveTo(x, y + ry * 0.62, x + rx * 0.88, y);
        }
      }
      ctx.lineWidth = ol * 1.5; ctx.stroke();
      return;
    }
    eyePath(ctx, 0, 1, 1, 0, 0); eyePath(ctx, 5, 1, 1, 0, 0);
    ctx.fillStyle = '#fffcf4'; ctx.fill();
    // Iris and pupil follow the gaze
    const gx = r.px * 0.2, gy = r.py * 0.18, p = r.pupil;
    ctx.beginPath(); eyePath(ctx, 0, 0.8, 0.8, gx, gy); eyePath(ctx, 5, 0.8, 0.8, gx, gy);
    ctx.fillStyle = pal.iris; ctx.fill();
    ctx.beginPath(); eyePath(ctx, 0, p, p * 1.05, gx * 1.25, gy); eyePath(ctx, 5, p, p * 1.05, gx * 1.25, gy);
    ctx.fillStyle = '#17121c'; ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < 10; i += 5) {
      const rx = E[i + 2], ry = E[i + 3], ix = E[i] + gx * rx, iy = E[i + 1] + gy * ry;
      ctx.moveTo(ix + rx * 0.02, iy - ry * 0.3);
      ctx.ellipse(ix - rx * 0.24, iy - ry * 0.3, rx * 0.26, ry * 0.26, 0, 0, TAU);
      if (r.lod > 0) { ctx.moveTo(ix + rx * 0.37, iy + ry * 0.3); ctx.ellipse(ix + rx * 0.26, iy + ry * 0.3, rx * 0.11, ry * 0.11, 0, 0, TAU); }
    }
    ctx.fillStyle = '#ffffff'; ctx.fill();
    if (r.closed > 0.03 || Math.abs(r.lidTilt) > 0.05) {
      for (let i = 0; i < 10; i += 5) lid(ctx, r, pal, E[i], E[i + 1], E[i + 2], E[i + 3], E[i + 4]);
    }
    ctx.beginPath(); eyePath(ctx, 0, 1, 1, 0, 0); eyePath(ctx, 5, 1, 1, 0, 0);
    ctx.lineWidth = ol; ctx.stroke();
    // Lashes (female), at the outer corners
    if (r.female && r.stage >= 3 && r.lod > 0) {
      ctx.beginPath();
      for (let i = 0; i < 10; i += 5) {
        const rx = E[i + 2], ry = E[i + 3], side = E[i + 4];
        const ox = E[i] - side * rx * 0.72, oy = E[i + 1] - ry * 0.62 + 1.6 * ry * r.closed;
        ctx.moveTo(ox, oy);
        ctx.quadraticCurveTo(ox - side * rx * 0.3, oy - ry * 0.1, ox - side * rx * 0.5, oy - ry * 0.4);
      }
      ctx.lineWidth = ol * 1.1; ctx.stroke();
    }
  }

  // Eye i (0 near, 5 far) scaled by (sx, sy) and shifted by gx, gy of its size (the gaze)
  function eyePath(ctx, i, sx, sy, gx, gy) {
    const E = EYES, rx = E[i + 2], ry = E[i + 3], x = E[i] + gx * rx, y = E[i + 1] + gy * ry;
    ctx.moveTo(x + rx * sx, y);
    ctx.ellipse(x, y, rx * sx, ry * sy, 0, 0, TAU);
  }

  // Upper lid: fur coming down over the eye, tilted by anger or worry
  function lid(ctx, r, pal, x, y, rx, ry, side) {
    const tilt = r.lidTilt * side, lidY = y - ry + 2 * ry * r.closed;
    const ly0 = lidY + Math.max(0, -tilt) * ry * 0.9, ly1 = lidY + Math.max(0, tilt) * ry * 0.9;
    const my = (ly0 + ly1) / 2 + ry * 0.18;
    ctx.save();
    ctx.beginPath(); ctx.ellipse(x, y, rx * 1.02, ry * 1.02, 0, 0, TAU); ctx.clip();
    ctx.beginPath();
    ctx.moveTo(x - rx * 1.1, y - ry * 1.2);
    ctx.lineTo(x + rx * 1.1, y - ry * 1.2);
    ctx.lineTo(x + rx * 1.1, ly1);
    ctx.quadraticCurveTo(x, my, x - rx * 1.1, ly0);
    ctx.closePath();
    ctx.fillStyle = pal.fur; ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + rx * 1.1, ly1);
    ctx.quadraticCurveTo(x, my, x - rx * 1.1, ly0);
    ctx.lineWidth = r.ol * 1.2; ctx.stroke();
    ctx.restore();
  }

  function drawBrows(ctx, r, pal, nx, ny, fx, fy) {
    const a = r.browAnger, w = r.browWorry, old = r.ag;
    if (a < 0.08 && w < 0.12 && old === 0) return;
    const eR = r.eR, lift = eR * 1.25;
    ctx.beginPath();
    // Near brow (inner end towards the nose, on the right)
    const tn = (a - w) * eR * 0.5;
    ctx.moveTo(nx - eR * 0.7, ny - lift - tn * 0.3);
    ctx.quadraticCurveTo(nx, ny - lift - eR * 0.25, nx + eR * 0.7, ny - lift + tn);
    // Far brow (inner end on the left)
    ctx.moveTo(fx + eR * 0.35, fy - lift * 0.95 - tn * 0.3);
    ctx.quadraticCurveTo(fx, fy - lift - eR * 0.2, fx - eR * 0.45, fy - lift * 0.95 + tn);
    if (old > 0) {
      ctx.lineWidth = r.ol * (1.6 + 1.2 * old); ctx.strokeStyle = pal.brow;
    } else {
      ctx.lineWidth = r.ol * 1.3; ctx.strokeStyle = pal.line;
    }
    ctx.stroke();
  }

  function drawMouth(ctx, r, pal) {
    const R = r.R, s = r.smile, o = r.mouthOpen, ol = r.ol;
    const cx = R * 0.98, cy = R * 0.44, wn = R * 0.26, wf = R * 0.11, cornerY = cy - s * R * 0.1;
    ctx.strokeStyle = pal.line; ctx.lineWidth = ol;
    if (o > 0.06) {
      const h = R * (0.08 + 0.34 * o);
      openMouthPath(ctx, cx, cy, cornerY, wn, wf, h, R);
      ctx.fillStyle = pal.mouth; ctx.fill();
      ctx.save(); ctx.clip();
      ctx.beginPath(); ctx.ellipse(cx - wn * 0.3, cy + h * 0.95, wn * 0.62, h * 0.45, 0, 0, TAU);
      ctx.fillStyle = pal.tongue; ctx.fill();
      ctx.restore();
      openMouthPath(ctx, cx, cy, cornerY, wn, wf, h, R);
      ctx.moveTo(R * 1.01, R * 0.29); ctx.lineTo(cx, cy - R * 0.04);
      ctx.stroke();
      if (r.tongue > 0) {
        // Tongue out: panting, or limp when dead
        const tl = R * (0.16 + 0.2 * r.tongue), tx = cx - wn * 0.25, tw = R * 0.15;
        ctx.beginPath();
        ctx.moveTo(tx - tw, cy + h * 0.55);
        ctx.bezierCurveTo(tx - tw * 1.05, cy + h + tl, tx + tw * 1.05, cy + h + tl, tx + tw, cy + h * 0.55);
        ctx.fillStyle = pal.tongue; ctx.fill();
        ctx.lineWidth = ol * 0.8; ctx.stroke();
      }
    } else {
      ctx.beginPath();
      ctx.moveTo(R * 1.01, R * 0.29); ctx.lineTo(cx, cy - R * 0.02);
      if (r.wavy) {
        ctx.moveTo(cx - wn, cy + R * 0.04);
        ctx.quadraticCurveTo(cx - wn * 0.66, cy - R * 0.06, cx - wn * 0.33, cy + R * 0.04);
        ctx.quadraticCurveTo(cx, cy + R * 0.12, cx + wf, cy);
      } else {
        // Small cat-like mouth: two curves meeting under the nose
        const dip = R * (0.07 + 0.05 * Math.max(0, s));
        ctx.moveTo(cx - wn, cornerY);
        ctx.quadraticCurveTo(cx - wn * 0.45, cy + dip, cx, cy);
        ctx.quadraticCurveTo(cx + wf * 0.5, cy + dip * 0.8, cx + wf, cornerY);
      }
      ctx.stroke();
    }
    if (r.fang > 0 && o > 0.06) {
      ctx.beginPath();
      ctx.moveTo(cx - wn * 0.5, cornerY + R * 0.02);
      ctx.lineTo(cx - wn * 0.38, cornerY + R * (0.1 + 0.08 * r.fang));
      ctx.lineTo(cx - wn * 0.26, cornerY + R * 0.03);
      ctx.fillStyle = '#ffffff'; ctx.fill();
    }
  }

  function openMouthPath(ctx, cx, cy, cornerY, wn, wf, h, R) {
    ctx.beginPath();
    ctx.moveTo(cx - wn, cornerY);
    ctx.quadraticCurveTo(cx, cy - R * 0.05, cx + wf, cornerY);
    ctx.bezierCurveTo(cx + wf, cy + h, cx - wn, cy + h * 1.1, cx - wn, cornerY);
  }

  function whiskers(ctx, r) {
    const R = r.R, droop = 0.12 + 0.2 * (r.stage === 7 ? 1 : 0);
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = -0.28 + i * 0.26 + droop, l = R * (0.55 + 0.1 * i);
      ctx.moveTo(R * 1.02, R * 0.36 + i * R * 0.04);
      ctx.quadraticCurveTo(R * 1.02 + Math.cos(a) * l * 0.6, R * 0.36 + Math.sin(a) * l * 0.5, R * 1.02 + Math.cos(a + droop) * l, R * 0.36 + Math.sin(a + droop) * l);
    }
    for (let i = 0; i < 2; i++) {
      const y = R * (0.42 + i * 0.1);
      ctx.moveTo(R * 0.5, y);
      ctx.quadraticCurveTo(R * 0.1, y - R * 0.04, -R * (0.2 + 0.05 * i), y + R * (0.06 + droop * 0.4));
    }
    ctx.lineWidth = r.ol * 0.6; ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'; ctx.stroke();
  }

  // ---- Effects (sound, sleep, weather on the fur) ------------------------------------------------

  // A point in head space (after the head's rotation) mapped to rig space
  function headPoint(r, x, y, out) {
    const c = Math.cos(r.hAng), s = Math.sin(r.hAng);
    out[0] = r.hx + x * c - y * s; out[1] = r.hy + x * s + y * c;
    return out;
  }
  const P = new Float32Array(2);

  function drawEffects(ctx, r, pal, t, e) {
    const R = r.R, ol = r.ol;
    if (r.calling > 0.05) {
      // Sound arcs from the mouth
      headPoint(r, R * 1.2, R * 0.4, P);
      const dir = r.hAng - 0.25;
      for (let i = 0; i < 3; i++) {
        const u = (t * 1.6 + i / 3) % 1, rad = R * (0.25 + 0.9 * u);
        ctx.beginPath(); ctx.arc(P[0], P[1], rad, dir - 0.7, dir + 0.7);
        ctx.globalAlpha = r.calling * (1 - u);
        ctx.lineWidth = ol * 2.6; ctx.strokeStyle = pal.line; ctx.stroke();
        ctx.lineWidth = ol * 1.2; ctx.strokeStyle = '#fff6d8'; ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    if (r.asleep) {
      // Drifting z's, never mirrored
      headPoint(r, R * 0.5, -R * 1.0, P);
      for (let i = 0; i < 3; i++) {
        const u = (t * 0.32 + i / 3) % 1, s = R * (0.16 + 0.22 * u);
        const x = P[0] + R * 0.6 * u + Math.sin(t * 1.5 + i) * R * 0.1, y = P[1] - R * 1.3 * u;
        ctx.save();
        ctx.translate(x, y); ctx.scale(r.facing, 1);
        ctx.beginPath(); ctx.moveTo(-s, -s); ctx.lineTo(s, -s); ctx.lineTo(-s, s); ctx.lineTo(s, s);
        ctx.globalAlpha = Math.sin(u * PI) * 0.95;
        ctx.lineWidth = ol * 2.8; ctx.strokeStyle = pal.line; ctx.stroke();
        ctx.lineWidth = ol * 1.3; ctx.strokeStyle = '#eaf2ff'; ctx.stroke();
        ctx.restore();
      }
    }
    if (r.wet > 0.05) {
      // Drips from the belly, chin and tail
      const water = token('--water');
      for (let i = 0; i < 3; i++) {
        const u = (t * 1.25 + i * 0.37 + e.phase) % 1;
        let x, y;
        if (i === 0) { x = r.bx + r.rxF * 0.1; y = r.by + r.ryB * 0.95; }
        else if (i === 1) { headPoint(r, R * 0.55, R * 0.95, P); x = P[0]; y = P[1]; }
        else { const j = (TAIL_N - 1) * 3; x = r.tail[j]; y = r.tail[j + 1] + r.tail[j + 2]; }
        y += u * u * 9;
        const s = R * 0.15 * (0.7 + 0.4 * r.wet);
        ctx.globalAlpha = r.wet * (u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85);
        drop(ctx, x, y, s, water, pal.line, ol);
      }
      ctx.globalAlpha = 1;
    }
    if (r.hot > 0.3) {
      // A bead of sweat sliding down the back of the head
      const u = (t * 0.7 + e.phase) % 1;
      headPoint(r, -R * 0.62, -R * 0.35 + u * R * 0.5, P);
      ctx.globalAlpha = (r.hot - 0.3) * 1.4 * Math.sin(u * PI);
      drop(ctx, P[0], P[1], R * 0.13, '#bfeaff', pal.line, ol);
      ctx.globalAlpha = 1;
    }
    if (r.cold > 0.3) {
      // Breath clouds from the nose
      headPoint(r, R * 1.2, R * 0.28, P);
      for (let i = 0; i < 2; i++) {
        const u = (t * 0.6 + i * 0.5) % 1;
        ctx.globalAlpha = (r.cold - 0.2) * 0.8 * Math.sin(u * PI);
        ctx.beginPath();
        const x = P[0] + u * R * 0.9, y = P[1] - u * R * 0.35, s = R * (0.1 + 0.18 * u);
        ctx.arc(x, y, s, 0, TAU); ctx.arc(x + s * 0.9, y - s * 0.3, s * 0.8, 0, TAU);
        ctx.fillStyle = '#f4f8ff'; ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    if (r.anger > 0.45 && r.lod > 0) {
      // A cross-shaped "vein" beside the head
      headPoint(r, -R * 0.62, -R * 0.78, P);
      const s = R * 0.2 * (0.9 + 0.15 * Math.sin(t * 8));
      ctx.save();
      ctx.translate(P[0], P[1]);
      ctx.globalAlpha = Math.min(1, (r.anger - 0.45) * 3);
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = i * PI / 2 + PI / 4;
        const cx = Math.cos(a) * s * 0.9, cy = Math.sin(a) * s * 0.9;
        ctx.moveTo(cx + Math.cos(a + 2.2) * s * 0.55, cy + Math.sin(a + 2.2) * s * 0.55);
        ctx.quadraticCurveTo(cx - Math.cos(a) * s * 0.35, cy - Math.sin(a) * s * 0.35, cx + Math.cos(a - 2.2) * s * 0.55, cy + Math.sin(a - 2.2) * s * 0.55);
      }
      ctx.lineWidth = ol * 1.4; ctx.strokeStyle = '#e8364f'; ctx.stroke();
      ctx.restore();
    }
  }

  function drop(ctx, x, y, s, fill, line, ol) {
    ctx.beginPath();
    ctx.moveTo(x, y - s * 1.8);
    ctx.quadraticCurveTo(x + s * 1.1, y - s * 0.2, x, y + s);
    ctx.quadraticCurveTo(x - s * 1.1, y - s * 0.2, x, y - s * 1.8);
    ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = ol * 0.7; ctx.strokeStyle = line; ctx.stroke();
  }

  // ---- Public API ------------------------------------------------------------------------------

  // Colour tokens from styles/app.css (Evo.theme)
  const token = name => Evo.theme.color(name);

  // Unit-circle gradients shared by every creature: the ground shadow and the breeding glows
  const shared = new WeakMap();
  function gradients(ctx) {
    let g = shared.get(ctx);
    if (!g) {
      const radial = stops => {
        const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        for (let i = 0; i < stops.length; i += 2) grad.addColorStop(stops[i], stops[i + 1]);
        return grad;
      };
      const glow = tok => {
        const c = a => Evo.theme.rgba(tok, a);
        return radial([0, c(0.8), 0.45, c(0.32), 1, c(0)]);
      };
      g = {
        shadow: radial([0, 'rgba(0, 0, 0, 0.32)', 0.6, 'rgba(0, 0, 0, 0.2)', 1, 'rgba(0, 0, 0, 0)']),
        female: glow('--female'), male: glow('--male')
      };
      shared.set(ctx, g);
    }
    return g;
  }

  // world: drawn in the world (ground ring, advancing gait) rather than on a card
  function render(ctx, pose, t, world) {
    const e = entryFor(pose), r = rig;
    computeRig(pose, t, e, r, world);
    const pal = paletteFor(e, pose, r);
    const m = ctx.getTransform();
    r.pxScale = Math.sqrt(m.a * m.a + m.b * m.b) || 1;
    const px = r.pxScale * r.k;                  // device pixels per unit
    r.ol = Math.max(r.ol, 0.8 / px);
    r.lod = px * UNITS >= 30 ? 2 : px * UNITS >= 16 ? 1 : 0;

    ctx.save();
    ctx.translate(pose.x, pose.y);
    ctx.scale(r.k, r.k);
    if (world) drawGround(ctx, r, pose, gradients(ctx).shadow);
    else if (r.shadow > 0) drawGround(ctx, r, EMPTY, gradients(ctx).shadow);
    ctx.scale(r.facing, 1);
    if (r.swing) { ctx.translate(0, GRIP_Y); ctx.rotate(r.swing); ctx.translate(0, -GRIP_Y); }
    ctx.translate(r.offX, 0);
    if (r.sx !== 1 || r.sy !== 1) ctx.scale(r.sx, r.sy);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    drawTail(ctx, r, pal);
    drawFarLegs(ctx, r, pal);
    drawBody(ctx, r, e, pal);
    drawHead(ctx, r, e, pal);
    drawEffects(ctx, r, pal, t, e);
    ctx.restore();
  }

  function draw(ctx, pose, t) {
    render(ctx, pose, t || 0, true);
  }

  // Extent of the current rig, in units: [x0, y0, x1, y1]
  const EXT = new Float32Array(4);
  function grow(x, y, rad) {
    if (x - rad < EXT[0]) EXT[0] = x - rad;
    if (x + rad > EXT[2]) EXT[2] = x + rad;
    if (y - rad < EXT[1]) EXT[1] = y - rad;
    if (y + rad > EXT[3]) EXT[3] = y + rad;
  }
  function headExtent(r) {
    const R = r.R;
    headPoint(r, R * 0.3, 0, P); grow(P[0], P[1], R * 1.1);
    headPoint(r, R * 1.15, R * 0.3, P); grow(P[0], P[1], R * 0.2);
    for (let i = 0; i < 2; i++) {
      const a = i ? EAR_N : EAR_F, rot = i ? r.earN : r.earF, len = r.earLen * (i ? 0.9 : 0.81);
      headPoint(r, Math.cos(a) * R * 0.72 + Math.sin(rot) * len, Math.sin(a) * R * 0.72 - Math.cos(rot) * len, P);
      grow(P[0], P[1], r.earW * 0.3);
    }
    if (r.crest >= 0.6) { headPoint(r, R * 0.04 - r.crest * 0.25, -R * 0.9 - r.crest, P); grow(P[0], P[1], r.crest * 0.3); }
  }
  function rigExtent(r) {
    EXT[0] = EXT[1] = Infinity; EXT[2] = EXT[3] = -Infinity;
    const ca = Math.cos(r.ang), sa = Math.sin(r.ang), bw = Math.max(r.rxB, r.ryB) * 0.75;
    grow(r.bx + ca * r.rxF * 0.6, r.by + sa * r.rxF * 0.6, bw);
    grow(r.bx - ca * r.rxB * 0.6, r.by - sa * r.rxB * 0.6, bw);
    headExtent(r);
    for (let i = 0; i < TAIL_N; i++) grow(r.tail[i * 3], r.tail[i * 3 + 1], r.tail[i * 3 + 2]);
    for (let i = 0; i < 4; i++) grow(r.legs[i * 4 + 2] + r.legW * 0.3, r.legs[i * 4 + 3] - r.pawRy, r.legW * 0.9);
    EXT[0] += r.offX; EXT[2] += r.offX;
    if (r.held) { EXT[0] -= 3; EXT[2] += 3; }   // room for the swing
    return EXT;
  }

  function bounds(pose) {
    const e = entryFor(pose), r = rig;
    computeRig(pose, 0, e, r);
    const x = rigExtent(r), k = r.k;
    const a = pose.x + (r.facing > 0 ? x[0] : -x[2]) * k, b = pose.x + (r.facing > 0 ? x[2] : -x[0]) * k;
    return { x0: a, y0: pose.y + x[1] * k, x1: b, y1: pose.y + x[3] * k };
  }

  // A calm copy of a pose for UI cards, standing (or resting) and facing right, looking out at
  // the viewer. It keeps the face and the states (sick, wet, asleep…) but not walking, being
  // held or the head-down eating pose.
  const still = { looks: null, motion: { vx: 0, airborne: false, walkPhase: 0, lying: 0 }, face: {}, state: {} };
  const calm = { looks: null, motion: still.motion, face: EMPTY, state: { dead: false, asleep: false, pregnant: 0 } };
  function portraitPose(pose, t, phase) {
    const F = pose.face || EMPTY, S = pose.state || EMPTY, M = pose.motion || EMPTY;
    still.id = pose.id; still.stage = pose.stage; still.sex = pose.sex; still.looks = pose.looks;
    still.x = 0; still.y = 0; still.facing = 1; still.size = UNITS; still.focused = false; still.hovered = false;
    still.motion.lying = S.dead ? 1 : num(M.lying, S.asleep ? 1 : 0);
    const f = still.face;
    f.eyesClosed = F.eyesClosed; f.mouthOpen = F.mouthOpen; f.smile = F.smile; f.earDroop = F.earDroop; f.blush = F.blush;
    // Mostly look at the viewer, with the occasional glance at what it was watching (pupilX is in
    // world terms, and the card always faces right)
    const glance = Math.sin(t * 0.37 + phase) > 0.55 ? 0.6 : 0;
    const lookX = num(F.pupilX, 0) * (pose.facing < 0 ? -1 : 1);
    f.pupilX = lerp(-0.45, lookX, glance); f.pupilY = lerp(0.05, num(F.pupilY, 0), glance);
    const s = still.state;
    for (const key in s) s[key] = undefined;
    for (const key in S) s[key] = S[key];
    s.held = false; s.eating = false;
    // The framing comes from the calm pose alone, so a call or a flinch doesn't zoom the card
    calm.id = pose.id; calm.stage = pose.stage; calm.sex = pose.sex; calm.looks = pose.looks;
    calm.size = UNITS; calm.facing = 1; calm.x = 0; calm.y = 0;
    calm.state.dead = !!S.dead; calm.state.asleep = !!S.asleep; calm.state.pregnant = S.pregnant;
    return still;
  }

  // framing: 'body' (the whole creature), 'face' (head and shoulders, cropped at the box edge) or
  // 'auto' (the default: the face in boxes under 100 px, where a whole body would be too small)
  function drawPortrait(ctx, pose, w, h, t, framing) {
    t = t || 0;
    const e = entryFor(pose), p = portraitPose(pose, t, e.phase), r = rig;
    computeRig(calm, 0, e, r);
    const face = framing === 'face' || (framing !== 'body' && Math.min(w, h) < 100);
    let scale;
    if (face) {
      EXT[0] = EXT[1] = Infinity; EXT[2] = EXT[3] = -Infinity;
      headExtent(r);
      const x = EXT, bh = x[3] + r.R * 0.35 - x[1];
      scale = Math.min(w * 0.94 / (x[2] - x[0]), h * 0.94 / bh);
      p.x = w / 2 - (x[0] + x[2]) / 2 * scale;
      p.y = h * 0.05 - x[1] * scale;
    } else {
      const x = rigExtent(r), bw = x[2] - x[0], bh = Math.max(x[3], 0) - x[1];
      scale = Math.min(w * 0.86 / bw, h * 0.84 / bh);
      p.x = w / 2 - (x[0] + x[2]) / 2 * scale;
      p.y = h / 2 + (bh / 2 - Math.max(x[3], 0)) * scale + h * 0.04;
    }
    p.size = UNITS * scale;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
    render(ctx, p, t, false);
    ctx.restore();
  }

  Evo.CreatureArt = { draw, drawPortrait, bounds };
})(globalThis.Evo);
