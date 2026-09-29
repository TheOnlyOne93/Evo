// Creature lab: an animated preview of the creature art, for tuning it by eye. Every creature is a
// real one (Evo.Creature from a founder genome, as World.addAdult makes them), posed by Evo.poseOf
// and drawn by Evo.CreatureArt; states are set on the creature (its chemistry, timers and flags)
// and read back through poseOf. The page loads the same src/ scripts as index.html, in the same
// order. Open dev/creature-lab.html straight from disk. Nothing here is used by the game.
(function (Evo) {
  'use strict';
  const Art = Evo.CreatureArt;
  const TAU = Math.PI * 2;
  const PHASE_PER_PX = Evo.CREATURE.WALK_PHASE_PER_PX;   // as the simulation advances walkPhase
  const { STAGES } = Evo;

  // URL options: ?seed=N seeds the genomes (as in index.html; read by src/core/evo.js), ?t=S
  // freezes time at S seconds (for screenshots), ?bounds outlines the picking boxes
  const params = new URLSearchParams(location.search);
  let seed = params.has('seed') ? +params.get('seed') : Evo.DEFAULT_SEED;

  // A real world, used only as the source of founder genomes (World.founderGenome gives each
  // founder its own looks and voice); its own creatures aren't shown
  const world = new Evo.World();

  // A creature at the middle of a life stage. Growth is a stand-in: in the game a body grows with
  // its growth hormone as it lives, so a creature made at an age gets roughly the growth it would
  // have reached (World.addAdult gives adults 1, a hatchling starts at 0).
  const GROWTH = [0, 0.05, 0.3, 0.6, 0.85, 1, 1, 1];
  function makeCreature(stage, sex, genome) {
    genome = genome ? genome.clone() : world.founderGenome(sex);
    const age = (STAGES[stage - 1].until + Math.min(1, STAGES[stage].until)) / 2;
    const c = new Evo.Creature(genome, 0, 0, { ageTicks: Math.floor(genome.develop().lifespanTicks * age), growth: GROWTH[stage] });
    c.onGround = true;
    c.facing = 1;
    return c;
  }

  // What a scene shows: a creature plus the lab's own fields (label, motion kind, picking view)
  function subject(stage, sex, genome) {
    const c = makeCreature(stage, sex, genome);
    return { c, age0: c.ageTicks, pose: null, view: null, focused: false, hovered: false };
  }

  // This frame's pose. The creature's age runs with the lab's clock (60 ticks per second), so
  // poseOf eases and times its gestures per tick as in the game.
  function poseOf(sub, ticks) {
    sub.c.ageTicks = sub.age0 + ticks;
    return (sub.pose = Evo.poseOf(sub.c, { focused: sub.focused, hovered: sub.hovered }));
  }

  // Without a world there is nothing to look at, so idle eyes wander a little, like a creature
  // looking about (a lab override of the pose)
  function wander(p, t) {
    const k = p.id * 1.7;
    p.face.pupilX = Math.sin(t * 0.55 + k) * 0.8 * (Math.sin(t * 0.21 + k) > -0.3 ? 1 : -1);
    p.face.pupilY = Math.sin(t * 0.43 + k * 2) * 0.4;
  }

  // Being in heat is a receptor effect of the chemistry (fertility), not a value the lab can set,
  // so it is set on the pose instead
  function inHeat(p) { p.state.inHeat = true; }

  // ---- Scenes ----------------------------------------------------------------------------------

  const scenes = [];
  let showBounds = params.has('bounds'), paused = params.has('t'), pauseT = +params.get('t') || 0, pauseAt = 0;

  function scene(id, build, paint) {
    const canvas = document.getElementById(id), ctx = canvas.getContext('2d');
    const s = { id, canvas, ctx, paint, w: 0, h: 0, subs: [] };
    s.rebuild = () => { s.subs = []; build(s); };
    s.resize = () => { const d = Evo.fitCanvas(canvas, ctx); s.w = d.width; s.h = d.height; };
    s.rebuild();
    s.resize();
    canvas.addEventListener('mousemove', ev => pick(s, ev, false));
    canvas.addEventListener('mouseleave', () => { for (const sub of s.subs) sub.hovered = false; });
    canvas.addEventListener('click', ev => pick(s, ev, true));
    scenes.push(s);
    return s;
  }

  // Picking through Art.bounds in world coordinates (each subject records its world transform)
  function pick(s, ev, click) {
    const rect = s.canvas.getBoundingClientRect();
    const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
    let hit = null;
    for (const sub of s.subs) {
      if (!sub.view || !sub.pose) continue;
      const v = sub.view, wx = (sx - v.tx) / v.z, wy = (sy - v.ty) / v.z;
      const b = Art.bounds(sub.pose);
      if (wx >= b.x0 && wx <= b.x1 && wy >= b.y0 && wy <= b.y1) hit = sub;
    }
    for (const sub of s.subs) {
      sub.hovered = sub === hit;
      if (click) sub.focused = sub === hit ? !sub.focused : false;
    }
  }

  // Draw a subject's pose through a world view (translate, zoom) and remember the view for picking
  function put(ctx, sub, t, tx, ty, z) {
    const p = sub.pose;
    sub.view = { tx, ty, z };
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

  // A state set on the creature itself, so poseOf reads it as it would in the world
  function setState(sub, name) {
    const c = sub.c, chem = (k, v) => c.chem.set(k, v);
    if (name === 'asleep') c.asleep = true;
    else if (name === 'held') c.held = true;
    else if (name === 'dead') c.dead = true;
    else if (name === 'eating') sub.eating = true;                 // the mouth timer runs in animate()
    else if (name === 'flinch') sub.flinch = true;                 // replayed in animate()
    else if (name === 'calling') c.callTimer = 40;
    else if (name === 'lying') c.restTimer = 31;                   // resting: lying down awake
    else if (name === 'wet') c.inWater = true;
    else if (name === 'pregnant') c.pregnancy = { progress: 0.8 }; // only its progress is drawn
    else if (name === 'inHeat') sub.heat = true;
    else if (name === 'happy') { chem('reward', 1); chem('endorphin', 0.9); }
    else if (name === 'sad') { chem('punishment', 0.3); chem('loneliness', 1); }
    else if (name === 'patted') c.stim.gentle = 1;
    else if (name === 'pain') chem('pain', 0.8);
    else if (name === 'worried') { chem('boredom', 1); chem('loneliness', 0.8); }
    else if (name === 'yawn') chem('sleepiness', 0.7);             // it yawns every few seconds
    else if (name === 'lick') chem('hunger', 0.8);                 // it licks its lips every few seconds
    else if (name === 'sick') chem('nausea', 1);
    else if (name === 'cold') chem('coldness', 1);
    else if (name === 'hot') chem('hotness', 1);
    else if (name === 'fear' || name === 'anger') chem(name, 1);
  }

  // This frame's pose, with the timers and stimuli that would run down in the world kept going
  function animate(sub, t, ticks) {
    if (sub.eating) sub.c.mouthTimer = 30 - ticks % 30;
    if (sub.flinch) sub.c.stim.flinch = Math.max(0, 1 - ((t * 0.8) % 1) * 2.2);
    const p = poseOf(sub, ticks);
    if (sub.heat) inHeat(p);
    return p;
  }

  // 1. Life stages × sexes
  scene('stages', s => {
    for (let sexI = 0; sexI < 2; sexI++) {
      for (let st = 1; st <= 7; st++) s.subs.push(subject(st, sexI ? 'MALE' : 'FEMALE'));
    }
  }, (s, t, dt, ticks) => {
    const { ctx, w, h } = s, cw = w / 7, rh = h / 2, z = 2;
    s.subs.forEach((sub, i) => {
      const col = i % 7, row = i / 7 | 0, gy = row * rh + rh - 26;
      dayBackdrop(ctx, col * cw, row * rh, cw, rh, gy);
      wander(poseOf(sub, ticks), t);
      put(ctx, sub, t, col * cw + cw / 2, gy, z);
      label(ctx, STAGES[sub.c.stage].word + (row ? ' ♂' : ' ♀'), col * cw + cw / 2, gy + 18);
    });
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    for (let c = 1; c < 7; c++) { ctx.beginPath(); ctx.moveTo(c * cw, 0); ctx.lineTo(c * cw, h); ctx.stroke(); }
  });

  // Close-up: faces and fur at the largest on-screen size
  scene('closeup', s => {
    s.subs.push(subject(5, 'FEMALE'), subject(5, 'MALE'), subject(1, 'FEMALE'), subject(4, 'MALE'));
    s.subs[3].walk = true;
  }, (s, t, dt, ticks) => {
    const { ctx, w, h } = s, cw = w / 4, z = 4.5, gy = h - 30;
    s.subs.forEach((sub, i) => {
      dayBackdrop(ctx, i * cw, 0, cw, h, gy);
      if (sub.walk) { sub.c.vx = 1.3; sub.c.walkPhase = t * 60 * 1.3 * PHASE_PER_PX; }
      wander(poseOf(sub, ticks), t);
      put(ctx, sub, t, i * cw + cw / 2, gy, z);
    });
  });

  // 2. States
  const STATE_LIST = ['asleep', 'held', 'dead', 'eating', 'calling', 'flinch', 'fear', 'anger', 'sick',
    'cold', 'hot', 'wet', 'pregnant', 'inHeat', 'lying', 'happy', 'sad', 'looking', 'patted', 'pain', 'worried', 'yawn', 'lick'];
  scene('states', s => {
    STATE_LIST.forEach((name, i) => {
      const sub = subject(5, name === 'pregnant' || i % 2 === 0 ? 'FEMALE' : 'MALE');
      sub.label = name;
      setState(sub, name);
      s.subs.push(sub);
    });
  }, (s, t, dt, ticks) => {
    const { ctx, w, h } = s, per = 12, cw = w / per, rh = h / 2, z = 2;
    s.subs.forEach((sub, i) => {
      const col = i % per, row = i / per | 0, gy = row * rh + rh - 30;
      dayBackdrop(ctx, col * cw, row * rh, cw, rh, gy);
      const p = animate(sub, t, ticks);
      if (sub.label === 'looking') { p.face.pupilX = Math.sin(t * 1.3); p.face.pupilY = Math.cos(t * 0.9) * 0.8; }
      else if (sub.label !== 'happy' && sub.label !== 'asleep') wander(p, t);
      if (sub.label === 'held') {
        // The hand grips the scruff; the simulation puts a held creature's (x, y) HOLD_GRIP × size below it
        const hx = col * cw + cw / 2 - 10, hy = row * rh + 70;
        ctx.fillStyle = '#f1d3b8'; ctx.strokeStyle = '#6b4b3a'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.roundRect(hx - 8, row * rh - 8, 16, hy - row * rh + 4, 7); ctx.fill(); ctx.stroke();
        put(ctx, sub, t, hx, hy + Evo.WORLD.HOLD_GRIP * p.size * z, z);
        ctx.fillStyle = '#f1d3b8';
        ctx.beginPath(); ctx.ellipse(hx + 3, hy + 1, 6, 4.5, 0.5, 0, TAU); ctx.fill(); ctx.stroke();
      } else {
        put(ctx, sub, t, col * cw + cw / 2, gy, z);
      }
      label(ctx, sub.label, col * cw + cw / 2, gy + 20);
    });
  });

  // 3. Motion strips at three zoom levels
  const ZOOMS = [0.6, 1, 2.5];
  scene('motion', s => {
    for (let zi = 0; zi < 3; zi++) {
      const kinds = zi === 2 ? ['walk', 'run', 'jump'] : ['walk', 'run', 'jump', 'baby', 'walk', 'run', 'jump', 'baby'];
      kinds.forEach((kind, i) => {
        const sub = subject(kind === 'baby' ? 1 : i % 3 === 0 ? 4 : 5, i % 2 ? 'MALE' : 'FEMALE');
        sub.kind = kind; sub.zi = zi;
        sub.speed = kind === 'run' ? 2.4 : kind === 'jump' ? 1.6 : kind === 'baby' ? 0.8 : 1.3;
        sub.c.facing = i % 2 ? -1 : 1;
        sub.u = (i + 0.5) / kinds.length;
        sub.jumpT = i * 0.7;
        s.subs.push(sub);
      });
    }
  }, (s, t, dt, ticks) => {
    const { ctx, w } = s;
    const heights = [110, 150, 300];
    let y0 = 0;
    for (let zi = 0; zi < 3; zi++) {
      const z = ZOOMS[zi], sh = heights[zi], gy = y0 + sh - 22;
      dayBackdrop(ctx, 0, y0, w, sh, gy);
      label(ctx, 'zoom ' + z, 12, y0 + 18, '#35524c', 'left');
      const worldW = w / z;
      for (const sub of s.subs) {
        if (sub.zi !== zi) continue;
        const c = sub.c;
        if (c.x === 0) c.x = sub.u * worldW;
        const step = sub.speed * c.facing * dt * 60;
        c.x += step;
        if (c.x < 30 && c.facing < 0) c.facing = 1;
        if (c.x > worldW - 30 && c.facing > 0) c.facing = -1;
        c.vx = sub.speed * c.facing;
        // Advance the gait with distance so the feet stay planted
        c.walkPhase += Math.abs(step) * PHASE_PER_PX;
        c.y = 0; c.onGround = true;
        let jumping = false;
        if (sub.kind === 'jump') {
          const u = ((t + sub.jumpT) % 2.2) / 0.75;
          if (u < 1) { c.y = -c.size * 1.1 * 4 * u * (1 - u); c.onGround = false; jumping = true; }
        }
        const p = poseOf(sub, ticks);
        if (jumping) p.groundY = 0;   // where its shadow stays (the world view fills this in)
        wander(p, t);
        put(ctx, sub, t, 0, gy, z);
      }
      y0 += sh + 1;
    }
  });

  // 4. Portraits: 160 px cards frame the whole body; under 100 px 'auto' framing shows the face
  scene('portraits', s => {
    const card = (size, x, y, stage, sex, extra, framing, genome) => {
      const sub = subject(stage, sex, genome);
      if (extra === 'heat') sub.heat = true;
      else if (extra) setState(sub, extra);
      sub.card = { size, x, y, framing, label: extra || STAGES[stage].word + (sex === 'MALE' ? ' ♂' : ' ♀') };
      s.subs.push(sub);
      return sub;
    };
    card(160, 14, 20, 5, 'FEMALE'); card(160, 186, 20, 1, 'MALE'); card(160, 358, 20, 6, 'FEMALE');
    [[5, 'MALE', 'heat'], [2, 'FEMALE'], [3, 'MALE'], [7, 'FEMALE'], [4, 'MALE'], [5, 'FEMALE', 'asleep']]
      .forEach(([st, sex, x], i) => card(72, 544 + (i % 3) * 84, 20 + (i / 3 | 0) * 104, st, sex, x));
    ['sick', 'wet', 'dead', 'cold', 'happy', 'anger'].forEach((x, i) =>
      card(72, 810 + (i % 3) * 84, 20 + (i / 3 | 0) * 104, 5, i % 2 ? 'MALE' : 'FEMALE', x));
    for (let i = 0; i < 8; i++) card(48, 1076 + (i % 4) * 58, 20 + (i / 4 | 0) * 80, 1 + (i % 7), i % 2 ? 'MALE' : 'FEMALE');
    const body = card(72, 1076, 190, 5, 'FEMALE', null, 'body');
    const face = card(72, 1160, 190, 5, 'FEMALE', null, 'face', body.c.genome);   // the same genome, so the same looks
    body.card.label = "72 'body'";
    face.card.label = "72 'face'";
  }, (s, t, dt, ticks) => {
    const { ctx } = s;
    for (const sub of s.subs) {
      const { size, x, y, framing, label: text } = sub.card;
      const p = animate(sub, t, ticks);
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
      const sub = subject(kind === 'baby' ? 1 : 5, i % 2 ? 'MALE' : 'FEMALE');
      sub.kind = kind; sub.u = (i + 0.5) / setups.length; sub.c.facing = i % 3 ? 1 : -1;
      if (kind === 'asleep' || kind === 'calling') setState(sub, kind);
      if (kind === 'heat') sub.heat = true;
      if (kind === 'eat') sub.eating = true;
      if (kind === 'idle') sub.focused = true;
      s.subs.push(sub);
    });
  }, (s, t, dt, ticks) => {
    const { ctx, w, h } = s, z = 1.5, gy = h - 40;
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#050d18'); sky.addColorStop(1, '#0f2130');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(220, 235, 255, 0.7)';
    for (let i = 0; i < 60; i++) ctx.fillRect((i * 97.3) % w, (i * 53.1) % (gy - 40), 1.2, 1.2);
    ctx.fillStyle = '#132a22'; ctx.fillRect(0, gy, w, h - gy);
    ctx.fillStyle = '#1d3a2e'; ctx.fillRect(0, gy, w, 2);
    const worldW = w / z;
    for (const sub of s.subs) {
      const c = sub.c;
      if (!c.x) c.x = sub.u * worldW;
      if (sub.kind === 'walk' || sub.kind === 'baby') {
        const sp = sub.kind === 'baby' ? 0.8 : 1.3, step = sp * c.facing * dt * 60;
        c.x += step;
        if (c.x < 30) c.facing = 1;
        if (c.x > worldW - 30) c.facing = -1;
        c.vx = sp * c.facing;
        c.walkPhase += Math.abs(step) * PHASE_PER_PX;
      }
      const p = animate(sub, t, ticks);
      if (sub.kind !== 'asleep') wander(p, t);
      put(ctx, sub, t, 0, gy, z);
    }
  });

  // 6. Variety
  scene('variety', s => {
    for (let i = 0; i < 16; i++) s.subs.push(subject(5, i % 2 ? 'MALE' : 'FEMALE'));
  }, (s, t, dt, ticks) => {
    const { ctx, w, h } = s, cw = w / 8, rh = h / 2, z = 2;
    s.subs.forEach((sub, i) => {
      const col = i % 8, row = i / 8 | 0, gy = row * rh + rh - 22;
      dayBackdrop(ctx, col * cw, row * rh, cw, rh, gy);
      wander(poseOf(sub, ticks), t);
      put(ctx, sub, t, col * cw + cw / 2, gy, z);
    });
  });

  // 7. Gene extremes. The looks are set on the developed traits, which poseOf reads: finding gene
  // bytes that express an exact value isn't cheap, so this is a lab override.
  const GENES = ['earSize', 'tailLength', 'eyeSize', 'plumpness', 'legLength', 'crest', 'patternScale'];
  scene('extremes', s => {
    for (let hi = 0; hi < 2; hi++) {
      GENES.forEach((gene, i) => {
        const sub = subject(5, i % 2 ? 'MALE' : 'FEMALE'), T = sub.c.traits;
        Object.assign(T, { hue: 20 + i * 50, accentHue: 200 + i * 40, pattern: gene === 'patternScale' ? 1 + hi : 0 });
        for (const g of GENES) T[g] = 0.5;
        T[gene] = hi;
        sub.label = gene + ' ' + hi;
        s.subs.push(sub);
      });
    }
  }, (s, t, dt, ticks) => {
    const { ctx, w, h } = s, cw = w / 7, rh = h / 2, z = 2;
    s.subs.forEach((sub, i) => {
      const col = i % 7, row = i / 7 | 0, gy = row * rh + rh - 26;
      dayBackdrop(ctx, col * cw, row * rh, cw, rh, gy);
      wander(poseOf(sub, ticks), t);
      put(ctx, sub, t, col * cw + cw / 2, gy, z);
      label(ctx, sub.label, col * cw + cw / 2, gy + 18);
    });
  });

  // ---- Loop and controls -------------------------------------------------------------------------

  const ticksAt = t => Math.floor(t * Evo.TICKS_PER_SECOND);

  // A frozen time (?t=) first plays the moving scenes up to that moment
  if (paused) {
    for (const s of scenes) {
      if (s.id !== 'motion' && s.id !== 'night') continue;
      for (let i = 0; i < pauseT * 60; i++) s.paint(s, i / 60, 1 / 60, ticksAt(i / 60));
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
      s.paint(s, t, dt, ticksAt(t));
    }
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', () => scenes.forEach(s => s.resize()));
  document.getElementById('rerollBtn').addEventListener('click', () => {
    Evo.seed(++seed);
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
      const sub = subject(1 + (i % 7), i % 2 ? 'MALE' : 'FEMALE'), c = sub.c;
      c.x = 40 + (i % 10) * 120; c.y = 300 + (i / 10 | 0) * 300; c.vx = (i % 3) * 1.2; c.facing = i % 4 ? 1 : -1;
      if (i === 3) setState(sub, 'calling');
      if (i === 5) setState(sub, 'asleep');
      if (i === 7) setState(sub, 'wet');
      const p = poseOf(sub, 0);
      if (i === 9) inHeat(p);
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
