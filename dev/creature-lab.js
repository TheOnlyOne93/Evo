// Creature lab: an animated preview of Evo.CreatureArt, for tuning the creature art by eye.
// Open dev/creature-lab.html straight from disk. Nothing here is used by the game.
(function (Evo) {
  'use strict';
  const Art = Evo.CreatureArt;
  const TAU = Math.PI * 2;
  const SIZES = [0, 18, 23, 29, 35, 42, 42, 40];
  const PHASE_PER_PX = Evo.CREATURE.WALK_PHASE_PER_PX;   // as the simulation advances walkPhase
  const STAGES = ['', 'Baby', 'Child', 'Adolescent', 'Youth', 'Adult', 'Old', 'Senile'];

  // URL options: ?seed=N picks the random looks, ?t=S freezes time at S seconds (for screenshots),
  // ?bounds outlines the picking boxes
  const params = new URLSearchParams(location.search);

  // Seeded random looks, so a reroll is reproducible
  let seed = +params.get('seed') || 11;
  let rnd = mulberry(seed);
  function mulberry(a) {
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function randomLooks() {
    return {
      hue: rnd() * 360, accentHue: rnd() * 360, pattern: Math.floor(rnd() * 4), patternScale: rnd(),
      earSize: rnd(), tailLength: rnd(), eyeSize: rnd(), plumpness: rnd(), legLength: rnd(), crest: rnd()
    };
  }

  let nextId = 1;
  function makePose(stage, sex, looks) {
    return {
      id: nextId++, x: 0, y: 0, facing: 1, size: SIZES[stage], stage, sex, looks: looks || randomLooks(),
      motion: { vx: 0, airborne: false, walkPhase: 0, lying: 0 },
      face: { eyesClosed: 0, pupilX: 0, pupilY: 0, mouthOpen: 0, smile: 0.2, earDroop: 0, blush: 0 },
      state: {
        asleep: false, held: false, dead: false, eating: false, calling: 0, flinch: 0, fear: 0, anger: 0,
        sick: 0, cold: 0, hot: 0, wet: 0, pregnant: 0, inHeat: false
      },
      focused: false, hovered: false
    };
  }

  // Idle eyes wander a little, like a creature looking about
  function wander(p, t) {
    const k = p.id * 1.7;
    p.face.pupilX = Math.sin(t * 0.55 + k) * 0.8 * (Math.sin(t * 0.21 + k) > -0.3 ? 1 : -1);
    p.face.pupilY = Math.sin(t * 0.43 + k * 2) * 0.4;
  }

  // ---- Scenes ----------------------------------------------------------------------------------

  const scenes = [];
  let showBounds = params.has('bounds'), paused = params.has('t'), pauseT = +params.get('t') || 0, pauseAt = 0;

  function scene(id, build, paint) {
    const canvas = document.getElementById(id), ctx = canvas.getContext('2d');
    const s = { id, canvas, ctx, paint, w: 0, h: 0, poses: [] };
    s.rebuild = () => { s.poses = []; build(s); };
    s.resize = () => { const d = Evo.fitCanvas(canvas, ctx); s.w = d.width; s.h = d.height; };
    s.rebuild();
    s.resize();
    canvas.addEventListener('mousemove', ev => pick(s, ev, false));
    canvas.addEventListener('mouseleave', () => { for (const p of s.poses) p.hovered = false; });
    canvas.addEventListener('click', ev => pick(s, ev, true));
    scenes.push(s);
    return s;
  }

  // Picking through Art.bounds in world coordinates (each scene records its world transform)
  function pick(s, ev, click) {
    const rect = s.canvas.getBoundingClientRect();
    const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
    let hit = null;
    for (const p of s.poses) {
      if (!p._view) continue;
      const v = p._view, wx = (sx - v.tx) / v.z, wy = (sy - v.ty) / v.z;
      const b = Art.bounds(p);
      if (wx >= b.x0 && wx <= b.x1 && wy >= b.y0 && wy <= b.y1) hit = p;
    }
    for (const p of s.poses) {
      p.hovered = p === hit;
      if (click) p.focused = p === hit ? !p.focused : false;
    }
  }

  // Draw one pose through a world view (translate, zoom) and remember the view for picking
  function put(ctx, p, t, tx, ty, z) {
    p._view = p._view || {};
    p._view.tx = tx; p._view.ty = ty; p._view.z = z;
    ctx.save();
    ctx.translate(tx, ty);
    ctx.scale(z, z);
    Art.draw(ctx, p, t);
    if (showBounds) {
      const b = Art.bounds(p);
      ctx.strokeStyle = 'rgba(255, 60, 200, 0.8)'; ctx.lineWidth = 1 / z;
      ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      ctx.fillStyle = 'rgba(255, 60, 200, 0.9)';
      ctx.fillRect(p.x - 1.5 / z, p.y - 1.5 / z, 3 / z, 3 / z);
    }
    ctx.restore();
  }

  function dayBackdrop(ctx, x, y, w, h, groundY) {
    const sky = ctx.createLinearGradient(0, y, 0, y + h);
    sky.addColorStop(0, '#bfe0ea'); sky.addColorStop(1, '#e6efd9');
    ctx.fillStyle = sky; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#9cc47a'; ctx.fillRect(x, groundY, w, y + h - groundY);
    ctx.fillStyle = '#86b066'; ctx.fillRect(x, groundY, w, 3);
  }

  function label(ctx, text, x, y, color, align) {
    ctx.font = '600 12px "Atkinson Hyperlegible", system-ui, sans-serif';
    ctx.textAlign = align || 'center';
    ctx.fillStyle = color || '#35524c';
    ctx.fillText(text, x, y);
  }

  // 1. Life stages × sexes
  scene('stages', s => {
    for (let sexI = 0; sexI < 2; sexI++) {
      for (let st = 1; st <= 7; st++) s.poses.push(makePose(st, sexI ? 'MALE' : 'FEMALE'));
    }
  }, (s, t) => {
    const { ctx, w, h } = s, cw = w / 7, rh = h / 2, z = 2;
    s.poses.forEach((p, i) => {
      const col = i % 7, row = i / 7 | 0, gy = row * rh + rh - 26;
      dayBackdrop(ctx, col * cw, row * rh, cw, rh, gy);
      wander(p, t);
      put(ctx, p, t, col * cw + cw / 2, gy, z);
      label(ctx, STAGES[p.stage] + (row ? ' ♂' : ' ♀'), col * cw + cw / 2, gy + 18);
    });
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    for (let c = 1; c < 7; c++) { ctx.beginPath(); ctx.moveTo(c * cw, 0); ctx.lineTo(c * cw, h); ctx.stroke(); }
  });

  // Close-up: faces and fur at the largest on-screen size
  scene('closeup', s => {
    s.poses.push(makePose(5, 'FEMALE'), makePose(5, 'MALE'), makePose(1, 'FEMALE'), makePose(4, 'MALE'));
    s.poses[3].walk = true;
  }, (s, t) => {
    const { ctx, w, h } = s, cw = w / 4, z = 4.5, gy = h - 30;
    s.poses.forEach((p, i) => {
      dayBackdrop(ctx, i * cw, 0, cw, h, gy);
      if (p.walk) { p.motion.vx = 1.3; p.motion.walkPhase = t * 60 * 1.3 * PHASE_PER_PX; }
      wander(p, t);
      put(ctx, p, t, i * cw + cw / 2, gy, z);
    });
  });

  // 2. States
  const STATE_LIST = ['asleep', 'held', 'dead', 'eating', 'calling', 'flinch', 'fear', 'anger', 'sick',
    'cold', 'hot', 'wet', 'pregnant', 'inHeat', 'lying', 'happy', 'sad', 'looking', 'patted', 'pain', 'worried', 'yawn', 'lick'];
  scene('states', s => {
    STATE_LIST.forEach((name, i) => {
      const p = makePose(5, i % 2 ? 'MALE' : 'FEMALE');
      p.label = name;
      const S = p.state, F = p.face;
      if (name === 'asleep') { S.asleep = true; p.motion.lying = 1; F.eyesClosed = 1; }
      else if (name === 'held') S.held = true;
      else if (name === 'dead') { S.dead = true; p.motion.lying = 1; }
      else if (name === 'eating') S.eating = true;
      else if (name === 'calling') S.calling = 1;
      else if (name === 'lying') p.motion.lying = 1;
      else if (name === 'inHeat') { S.inHeat = true; F.smile = 0.5; }
      else if (name === 'pregnant') { S.pregnant = 1; p.sex = 'FEMALE'; }
      else if (name === 'happy') { F.smile = 1; F.blush = 0.9; F.eyesClosed = 0.95; }
      else if (name === 'sad') { F.smile = -0.9; F.earDroop = 0.8; }
      else if (name === 'patted') { F.happy = 1; F.blush = 1; F.smile = 0.6; }
      else if (name === 'pain') { S.pain = 0.8; F.smile = -0.8; F.worry = 0.8; }
      else if (name === 'worried') { F.worry = 1; F.earDroop = 0.5; }
      else if (name === 'yawn') { F.yawn = 1; F.mouthOpen = 1; F.eyesClosed = 1; }
      else if (name === 'lick') F.lick = 1;
      else if (name !== 'looking' && name !== 'flinch') S[name] = 1;
      s.poses.push(p);
    });
  }, (s, t) => {
    const { ctx, w, h } = s, per = 12, cw = w / per, rh = h / 2, z = 2;
    s.poses.forEach((p, i) => {
      const col = i % per, row = i / per | 0, gy = row * rh + rh - 30;
      dayBackdrop(ctx, col * cw, row * rh, cw, rh, gy);
      if (p.label === 'flinch') p.state.flinch = Math.max(0, 1 - ((t * 0.8) % 1) * 2.2);
      if (p.label === 'looking') { p.face.pupilX = Math.sin(t * 1.3); p.face.pupilY = Math.cos(t * 0.9) * 0.8; }
      else if (p.label !== 'happy' && p.label !== 'asleep') wander(p, t);
      if (p.label === 'held') {
        // The hand grips the scruff; the simulation puts a held creature's (x, y) 0.7 × size below it
        const hx = col * cw + cw / 2 - 10, hy = row * rh + 70;
        ctx.fillStyle = '#f1d3b8'; ctx.strokeStyle = '#6b4b3a'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.roundRect(hx - 8, row * rh - 8, 16, hy - row * rh + 4, 7); ctx.fill(); ctx.stroke();
        put(ctx, p, t, hx, hy + 0.7 * p.size * z, z);
        ctx.fillStyle = '#f1d3b8';
        ctx.beginPath(); ctx.ellipse(hx + 3, hy + 1, 6, 4.5, 0.5, 0, TAU); ctx.fill(); ctx.stroke();
      } else {
        put(ctx, p, t, col * cw + cw / 2, gy, z);
      }
      label(ctx, p.label, col * cw + cw / 2, gy + 20);
    });
  });

  // 3. Motion strips at three zoom levels
  const ZOOMS = [0.6, 1, 2.5];
  scene('motion', s => {
    for (let zi = 0; zi < 3; zi++) {
      const kinds = zi === 2 ? ['walk', 'run', 'jump'] : ['walk', 'run', 'jump', 'baby', 'walk', 'run', 'jump', 'baby'];
      kinds.forEach((kind, i) => {
        const p = makePose(kind === 'baby' ? 1 : i % 3 === 0 ? 4 : 5, i % 2 ? 'MALE' : 'FEMALE');
        p.kind = kind; p.zi = zi;
        p.speed = kind === 'run' ? 2.4 : kind === 'jump' ? 1.6 : kind === 'baby' ? 0.8 : 1.3;
        p.facing = i % 2 ? -1 : 1;
        p.u = (i + 0.5) / kinds.length;
        p.jumpT = i * 0.7;
        s.poses.push(p);
      });
    }
  }, (s, t, dt) => {
    const { ctx, w } = s;
    const heights = [110, 150, 300];
    let y0 = 0;
    for (let zi = 0; zi < 3; zi++) {
      const z = ZOOMS[zi], sh = heights[zi], gy = y0 + sh - 22;
      dayBackdrop(ctx, 0, y0, w, sh, gy);
      label(ctx, 'zoom ' + z, 12, y0 + 18, '#35524c', 'left');
      const worldW = w / z;
      for (const p of s.poses) {
        if (p.zi !== zi) continue;
        if (p.x === 0) p.x = p.u * worldW;
        const step = p.speed * p.facing * dt * 60;
        p.x += step;
        if (p.x < 30 && p.facing < 0) p.facing = 1;
        if (p.x > worldW - 30 && p.facing > 0) p.facing = -1;
        p.motion.vx = p.speed * p.facing;
        // Advance the gait with distance so the feet stay planted
        p.motion.walkPhase += Math.abs(step) * PHASE_PER_PX;
        p.y = 0; p.motion.airborne = false; p.groundY = undefined;
        if (p.kind === 'jump') {
          const u = ((t + p.jumpT) % 2.2) / 0.75;
          if (u < 1) { p.y = -p.size * 1.1 * 4 * u * (1 - u); p.motion.airborne = true; p.groundY = 0; }
        }
        wander(p, t);
        put(ctx, p, t, 0, gy, z);
      }
      y0 += sh + 1;
    }
  });

  // 4. Portraits: 160 px cards frame the whole body; under 100 px 'auto' framing shows the face
  scene('portraits', s => {
    const card = (size, x, y, stage, sex, extra, framing) => {
      const p = makePose(stage, sex);
      const S = p.state, F = p.face;
      if (extra === 'heat') S.inHeat = true;
      if (extra === 'asleep') { S.asleep = true; p.motion.lying = 1; F.eyesClosed = 1; }
      if (extra === 'dead') { S.dead = true; p.motion.lying = 1; F.eyesClosed = 1; }
      if (extra === 'happy') { F.smile = 1; F.blush = 0.9; }
      if (extra === 'sick' || extra === 'wet' || extra === 'cold' || extra === 'anger' || extra === 'fear') S[extra] = 1;
      if (extra === 'sick') F.earDroop = 0.7;
      p.card = { size, x, y, framing, label: extra || STAGES[stage] + (sex === 'MALE' ? ' ♂' : ' ♀') };
      s.poses.push(p);
    };
    card(160, 14, 20, 5, 'FEMALE'); card(160, 186, 20, 1, 'MALE'); card(160, 358, 20, 6, 'FEMALE');
    [[5, 'MALE', 'heat'], [2, 'FEMALE'], [3, 'MALE'], [7, 'FEMALE'], [4, 'MALE'], [5, 'FEMALE', 'asleep']]
      .forEach(([st, sex, x], i) => card(72, 544 + (i % 3) * 84, 20 + (i / 3 | 0) * 104, st, sex, x));
    ['sick', 'wet', 'dead', 'cold', 'happy', 'anger'].forEach((x, i) =>
      card(72, 810 + (i % 3) * 84, 20 + (i / 3 | 0) * 104, 5, i % 2 ? 'MALE' : 'FEMALE', x));
    for (let i = 0; i < 8; i++) card(48, 1076 + (i % 4) * 58, 20 + (i / 4 | 0) * 80, 1 + (i % 7), i % 2 ? 'MALE' : 'FEMALE');
    card(72, 1076, 190, 5, 'FEMALE', null, 'body'); card(72, 1160, 190, 5, 'FEMALE', null, 'face');
    s.poses[s.poses.length - 2].looks = s.poses[s.poses.length - 1].looks;
    s.poses[s.poses.length - 2].card.label = "72 'body'";
    s.poses[s.poses.length - 1].card.label = "72 'face'";
  }, (s, t) => {
    const { ctx } = s;
    for (const p of s.poses) {
      const { size, x, y, framing, label: text } = p.card;
      if (!p.state.asleep && !p.state.dead) wander(p, t);
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = '#1b3136';
      ctx.beginPath(); ctx.roundRect(0, 0, size, size, size > 60 ? 12 : 8); ctx.fill();
      ctx.strokeStyle = '#29444a'; ctx.stroke();
      ctx.clip();
      Art.drawPortrait(ctx, p, size, size, t, framing);
      ctx.restore();
      if (size > 48) label(ctx, text, x + size / 2, y + size + 15, '#9ab0aa');
    }
  });

  // 5. Night
  scene('night', s => {
    const setups = ['walk', 'asleep', 'calling', 'heat', 'idle', 'baby', 'eat', 'walk'];
    setups.forEach((kind, i) => {
      const p = makePose(kind === 'baby' ? 1 : 5, i % 2 ? 'MALE' : 'FEMALE');
      p.kind = kind; p.u = (i + 0.5) / setups.length; p.facing = i % 3 ? 1 : -1;
      if (kind === 'asleep') { p.state.asleep = true; p.motion.lying = 1; }
      if (kind === 'calling') p.state.calling = 1;
      if (kind === 'heat') p.state.inHeat = true;
      if (kind === 'eat') p.state.eating = true;
      if (kind === 'idle') p.focused = true;
      s.poses.push(p);
    });
  }, (s, t, dt) => {
    const { ctx, w, h } = s, z = 1.5, gy = h - 40;
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#050d18'); sky.addColorStop(1, '#0f2130');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(220, 235, 255, 0.7)';
    for (let i = 0; i < 60; i++) ctx.fillRect((i * 97.3) % w, (i * 53.1) % (gy - 40), 1.2, 1.2);
    ctx.fillStyle = '#132a22'; ctx.fillRect(0, gy, w, h - gy);
    ctx.fillStyle = '#1d3a2e'; ctx.fillRect(0, gy, w, 2);
    const worldW = w / z;
    for (const p of s.poses) {
      if (!p.x) p.x = p.u * worldW;
      if (p.kind === 'walk' || p.kind === 'baby') {
        const sp = p.kind === 'baby' ? 0.8 : 1.3, step = sp * p.facing * dt * 60;
        p.x += step;
        if (p.x < 30) p.facing = 1;
        if (p.x > worldW - 30) p.facing = -1;
        p.motion.vx = sp * p.facing;
        p.motion.walkPhase += Math.abs(step) * PHASE_PER_PX;
      }
      if (p.kind !== 'asleep') wander(p, t);
      put(ctx, p, t, 0, gy, z);
    }
  });

  // 6. Variety
  scene('variety', s => {
    for (let i = 0; i < 16; i++) s.poses.push(makePose(5, i % 2 ? 'MALE' : 'FEMALE'));
  }, (s, t) => {
    const { ctx, w, h } = s, cw = w / 8, rh = h / 2, z = 2;
    s.poses.forEach((p, i) => {
      const col = i % 8, row = i / 8 | 0, gy = row * rh + rh - 22;
      dayBackdrop(ctx, col * cw, row * rh, cw, rh, gy);
      wander(p, t);
      put(ctx, p, t, col * cw + cw / 2, gy, z);
    });
  });

  // 7. Gene extremes
  const GENES = ['earSize', 'tailLength', 'eyeSize', 'plumpness', 'legLength', 'crest', 'patternScale'];
  scene('extremes', s => {
    for (let hi = 0; hi < 2; hi++) {
      GENES.forEach((gene, i) => {
        const looks = { hue: 20 + i * 50, accentHue: 200 + i * 40, pattern: gene === 'patternScale' ? 1 + hi : 0 };
        for (const g of GENES) looks[g] = 0.5;
        looks[gene] = hi;
        const p = makePose(5, i % 2 ? 'MALE' : 'FEMALE', looks);
        p.label = gene + ' ' + hi;
        s.poses.push(p);
      });
    }
  }, (s, t) => {
    const { ctx, w, h } = s, cw = w / 7, rh = h / 2, z = 2;
    s.poses.forEach((p, i) => {
      const col = i % 7, row = i / 7 | 0, gy = row * rh + rh - 26;
      dayBackdrop(ctx, col * cw, row * rh, cw, rh, gy);
      wander(p, t);
      put(ctx, p, t, col * cw + cw / 2, gy, z);
      label(ctx, p.label, col * cw + cw / 2, gy + 18);
    });
  });

  // ---- Loop and controls -------------------------------------------------------------------------

  // A frozen time (?t=) first plays the moving scenes up to that moment
  if (paused) {
    for (const s of scenes) {
      if (s.id !== 'motion' && s.id !== 'night') continue;
      for (let i = 0; i < pauseT * 60; i++) s.paint(s, i / 60, 1 / 60);
    }
  }

  let last = performance.now() / 1000;
  function frame() {
    const now = performance.now() / 1000;
    const dt = paused ? 0 : Math.min(0.05, now - last);
    last = now;
    const t = paused ? pauseT : now - pauseAt;
    for (const s of scenes) {
      s.ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
      s.ctx.clearRect(0, 0, s.w, s.h);
      s.paint(s, t, dt);
    }
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', () => scenes.forEach(s => s.resize()));
  document.getElementById('rerollBtn').addEventListener('click', () => {
    seed++; rnd = mulberry(seed);
    scenes.forEach(s => s.rebuild());
  });
  const pauseBtn = document.getElementById('pauseBtn');
  pauseBtn.addEventListener('click', () => {
    paused = !paused;
    const now = performance.now() / 1000;
    if (paused) pauseT = now - pauseAt; else pauseAt = now - pauseT;
    pauseBtn.setAttribute('aria-pressed', String(paused));
    pauseBtn.textContent = paused ? 'Play' : 'Pause';
  });
  const boundsChk = document.getElementById('boundsChk');
  boundsChk.checked = showBounds;
  boundsChk.addEventListener('change', ev => { showBounds = ev.target.checked; });

  // Benchmark: 20 creatures in mixed states, walking, drawn `frames` times on a 1280×720 canvas.
  // "flushed" reads one pixel back each frame, which forces the drawing to actually rasterise.
  function bench(frames = 600, n = 20) {
    const canvas = document.createElement('canvas');
    canvas.width = 1280; canvas.height = 720;
    const ctx = canvas.getContext('2d');
    const poses = [];
    for (let i = 0; i < n; i++) {
      const p = makePose(1 + (i % 7), i % 2 ? 'MALE' : 'FEMALE');
      p.x = 40 + (i % 10) * 120; p.y = 300 + (i / 10 | 0) * 300; p.motion.vx = (i % 3) * 1.2; p.facing = i % 4 ? 1 : -1;
      if (i === 3) p.state.calling = 1;
      if (i === 5) { p.state.asleep = true; p.motion.lying = 1; }
      if (i === 7) p.state.wet = 1;
      if (i === 9) p.state.inHeat = true;
      poses.push(p);
    }
    const run = flush => {
      const t0 = performance.now();
      for (let f = 0; f < frames; f++) {
        const t = f / 60;
        ctx.setTransform(1.25, 0, 0, 1.25, 0, 0);
        ctx.clearRect(0, 0, 1280, 720);
        for (const p of poses) { p.motion.walkPhase += p.motion.vx * PHASE_PER_PX; Art.draw(ctx, p, t); }
        if (flush) ctx.getImageData(0, 0, 1, 1);
      }
      ctx.getImageData(0, 0, 1, 1);
      return (performance.now() - t0) / frames;
    };
    run(false);   // warm up
    const plain = run(false), flushed = run(true);
    return { creatures: n, frames, msPerFrame: +plain.toFixed(3), msPerFrameFlushed: +flushed.toFixed(3) };
  }
  window.creatureBench = bench;
  document.getElementById('benchBtn').addEventListener('click', () => {
    const r = bench();
    document.getElementById('benchOut').textContent =
      `${r.creatures} creatures: ${r.msPerFrame} ms/frame (${r.msPerFrameFlushed} ms flushed)`;
  });

  requestAnimationFrame(frame);
})(globalThis.Evo);
