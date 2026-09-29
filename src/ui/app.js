// The interface: builds the world and its views, wires the controls, and runs the main loop.
(function (Evo) {
  'use strict';
  const { clamp, minBy } = Evo.util;
  const $ = id => document.getElementById(id);
  const H = Evo.uiHelpers;

  // Tools in the toolbar: the hand's three uses, then things to drop into the world
  const HAND_TOOLS = [
    { key: 'grab', word: 'Hand', hint: 'Tap a creature to follow it; drag creatures, eggs and items to carry or throw them' },
    { key: 'pat', word: 'Tickle', hint: 'A gentle touch: most creatures find it pleasant' },
    { key: 'slap', word: 'Slap', hint: 'It hurts: a creature learns to stop doing what it was doing' }
  ];
  const DROP_TOOLS = ['fruit', 'grain', 'dew', 'grub', 'bug', 'mimic', 'lure', 'ball', 'egg', 'thorn'];
  const DROP_HINTS = {
    fruit: 'Sugar', grain: 'Starch and a little protein', dew: 'Water', grub: 'Protein and fat that stays put',
    bug: 'Protein that runs away', mimic: 'Looks and smells like fruit, but it is poisonous', lure: 'Female scent: attracts males',
    ball: 'A toy', egg: 'A new founder egg', thorn: 'A thorn bush: it hurts'
  };
  const SPEEDS = [1, 2, 4, 8];
  const FRAME_BUDGET_MS = 11;   // Simulation time allowed per frame; the speed drops rather than the frame rate

  function bootApp() {
    const canvas = $('worldCanvas');
    const world = new Evo.World();
    const view = new Evo.WorldView(world, canvas);
    const synth = new Evo.BioSynthesizer();
    const app = { world, view, synth, focus: null, following: true, tool: 'grab', speed: 1, paused: false };
    Evo.app = app;
    Evo.connectAudio(synth, world, c => c === app.focus);

    // ---------- Toast and event log ----------
    let toastTimer = 0;
    app.toast = message => {
      const el = $('toast');
      el.textContent = message;
      el.classList.remove('hidden');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => el.classList.add('hidden'), 2800);
    };
    const log = (html, creature = null) => {
      const el = document.createElement(creature ? 'button' : 'div');
      el.className = 'log-line';
      el.innerHTML = html;
      if (creature) el.dataset.creature = creature.id;
      $('log').prepend(el);
      while ($('log').children.length > 5) $('log').lastChild.remove();
      setTimeout(() => el.classList.add('fading'), 9000);
      setTimeout(() => el.remove(), 10000);
    };
    $('log').addEventListener('click', e => {
      const el = e.target.closest('[data-creature]');
      const c = el && world.creatureById(Number(el.dataset.creature));
      if (c) app.select(c);
    });
    const who = c => `<b style="color:${H.sexColor(c.sex)}">${H.esc(c.name)}</b>`;
    const events = world.events;
    events.on('hatch', ({ creature }) => log(`${who(creature)} hatched`, creature));
    events.on('death', ({ creature, cause }) => log(`${who(creature)} ${Evo.text.DEATH_WORDS[cause] || 'died'}`));
    events.on('mate', ({ mother, father }) => log(`${who(mother)} and ${who(father)} mated`, mother));
    events.on('egg', ({ mother }) => log(`${who(mother)} laid an egg`, mother));
    events.on('wanderer', ({ creature }) => log(`${who(creature)} wandered in`, creature));
    events.on('refound', () => log('New founders arrived'));
    events.on('season', ({ season }) => { log(`${Evo.SEASONS[season.index].word} has come`); refreshStatus(); });
    events.on('stage', ({ creature, stage }) => { if (creature === app.focus) log(`${who(creature)} is now ${Evo.STAGES[stage].word.toLowerCase()}`, creature); });

    // ---------- Focus: the creature the card and the inside view are about ----------
    app.select = (c, keepFollowing = false) => {
      if (c !== app.focus) {
        app.focus = c;
        inspector.focusChanged();
        refreshCard(true);
        refreshStrip();
      }
      if (!keepFollowing) app.following = true;
      view.follow(app.following ? c : null);
      syncFollow();
    };
    // When the followed creature dies or leaves, pick the nearest one
    const refocus = () => {
      const old = app.focus;
      if (old && world.creatures.includes(old)) return;
      const next = old ? minBy(world.creatures, c => Math.abs(c.x - old.x)) : world.creatures[0];
      app.select(next || null, true);
      if (!next) view.follow(null);
    };

    // ---------- Adaptive layout (docked panel, drawer, or bottom sheet) ----------
    const bodyEl = document.body, labPanel = $('labPanel'), labOpenBtn = $('labOpenBtn'), sheetHandle = $('sheetHandle');
    let currentLayout = null;
    const cssPixels = name => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
    const resizeAll = () => { view.resize(); inspector.resize(); };
    const viewportSize = () => {
      const vv = window.visualViewport;
      return { w: vv ? vv.width : window.innerWidth, h: vv ? vv.height : window.innerHeight };
    };
    const pickLayout = ({ w, h }) => (w >= 1100 && h >= 600 ? 'desktop' : w >= 700 || w > h ? 'drawer' : 'sheet');
    const labVisible = () => bodyEl.classList.contains('lab-open');
    function setLabState(open, stop) {
      bodyEl.classList.toggle('lab-open', open);
      if (bodyEl.dataset.layout === 'sheet' && open) bodyEl.dataset.sheet = stop || 'half';
      else delete bodyEl.dataset.sheet;
      labPanel.style.height = '';
      labOpenBtn.setAttribute('aria-expanded', String(open));
      requestAnimationFrame(() => inspector.update(true));
    }
    app.openLab = deck => { if (deck) setDeck(deck); setLabState(true); };
    labPanel.addEventListener('transitionend', e => { if (e.target === labPanel) resizeAll(); });
    const setCardCollapsed = collapsed => {
      $('creatureCard').classList.toggle('collapsed', collapsed);
      $('cardToggle').setAttribute('aria-expanded', String(!collapsed));
    };
    function applyLayout() {
      const size = viewportSize();
      bodyEl.classList.toggle('compact', size.w < 560);
      const layout = pickLayout(size);
      if (layout !== currentLayout) {
        currentLayout = layout;
        bodyEl.dataset.layout = layout;
        setLabState(false);
        setCardCollapsed(layout === 'sheet' || size.h < 560);
      }
      resizeAll();
    }
    labOpenBtn.addEventListener('click', () => setLabState(true));
    $('labCloseBtn').addEventListener('click', () => setLabState(false));
    $('cardToggle').addEventListener('click', () => setCardCollapsed(!$('creatureCard').classList.contains('collapsed')));

    // Bottom sheet: tap the handle to step through its stops, or drag it
    (() => {
      let startY = 0, startH = 0, dragging = false, moved = false;
      const stops = () => {
        const stageH = $('stage').getBoundingClientRect().height;
        return { closed: cssPixels('--peek'), half: stageH * 0.55, full: stageH * 0.92 };
      };
      const cycle = () => {
        const cur = bodyEl.dataset.sheet;
        if (!cur) setLabState(true, 'half'); else if (cur === 'half') setLabState(true, 'full'); else setLabState(false);
      };
      sheetHandle.addEventListener('pointerdown', e => {
        if (currentLayout !== 'sheet') return;
        dragging = true; moved = false; startY = e.clientY; startH = labPanel.getBoundingClientRect().height;
        labPanel.classList.add('dragging'); sheetHandle.setPointerCapture(e.pointerId);
      });
      sheetHandle.addEventListener('pointermove', e => {
        if (!dragging) return;
        const dy = e.clientY - startY;
        if (Math.abs(dy) > 6) moved = true;
        const st = stops();
        labPanel.style.height = clamp(startH - dy, st.closed, st.full) + 'px';
      });
      const end = () => {
        if (!dragging) return;
        dragging = false; labPanel.classList.remove('dragging');
        if (!moved) return cycle();
        const hNow = labPanel.getBoundingClientRect().height;
        const [nearest] = minBy(Object.entries(stops()), ([, h]) => Math.abs(h - hNow));
        if (nearest === 'closed') setLabState(false); else setLabState(true, nearest);
      };
      sheetHandle.addEventListener('pointerup', end);
      sheetHandle.addEventListener('pointercancel', end);
      sheetHandle.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cycle(); } });
    })();

    // ---------- Inside view ----------
    const inspector = new Evo.Inspector(app);
    app.inspector = inspector;
    function setDeck(deck) {
      document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.deck === deck)));
      document.querySelectorAll('.deck').forEach(d => d.classList.toggle('hidden', d.id !== `deck-${deck}`));
      inspector.setDeck(deck);
      requestAnimationFrame(() => { resizeAll(); inspector.update(true); });
    }
    document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
      if (currentLayout === 'sheet' && !labVisible()) setLabState(true, 'half');
      setDeck(tab.dataset.deck);
    }));
    $('insideBtn').addEventListener('click', () => setLabState(true));

    window.addEventListener('resize', applyLayout);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', applyLayout);
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => resizeAll());
      [canvas, $('brainCanvas')].forEach(el => ro.observe(el));
    }
    applyLayout();

    // ---------- Playback ----------
    const speedBtns = document.querySelectorAll('[data-speed]');
    const syncPlayback = () => {
      $('pauseBtn').textContent = app.paused ? '▶' : '❚❚';
      $('pauseBtn').setAttribute('aria-label', app.paused ? 'Resume' : 'Pause');
      $('pauseBtn').setAttribute('aria-pressed', String(app.paused));
      speedBtns.forEach(b => b.setAttribute('aria-pressed', String(!app.paused && +b.dataset.speed === app.speed)));
    };
    const setSpeed = s => { app.speed = s; app.paused = false; syncPlayback(); };
    speedBtns.forEach(b => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));
    $('pauseBtn').addEventListener('click', () => { app.paused = !app.paused; syncPlayback(); });
    $('scentBtn').addEventListener('click', () => {
      view.options.showScent = !view.options.showScent;
      $('scentBtn').setAttribute('aria-pressed', String(view.options.showScent));
    });
    window.addEventListener('pointerdown', () => synth.init(), { once: true });
    $('soundBtn').addEventListener('click', () => {
      synth.init();
      synth.enabled = !synth.enabled;
      $('soundBtn').textContent = synth.enabled ? '🔊' : '🔇';
      $('soundBtn').setAttribute('aria-label', synth.enabled ? 'Turn sound off' : 'Turn sound on');
    });
    syncPlayback();

    app.skipSeason = () => {
      const days = Evo.SEASON_DAYS, next = (Math.floor(world.clock.day / days) + 1) * days;
      world.clock.tick = Math.round((next + 0.3 - world.startPhase) * Evo.DAY_TICKS); // Morning of its first day
      world.updateClock();
      refreshStatus();
    };

    // ---------- Toolbar ----------
    const toolbar = $('toolTray');
    const toolButton = (key, label, hint, icon) =>
      `<button class="tool" data-tool="${key}" aria-pressed="${key === app.tool}" title="${H.esc(hint)}">${icon}<span class="tool-text">${label}</span></button>`;
    const HAND_ICONS = { grab: '✋', pat: '🪶', slap: '💥' };
    toolbar.innerHTML =
      HAND_TOOLS.map(t => toolButton(t.key, t.word, t.hint, `<span class="tool-icon">${HAND_ICONS[t.key]}</span>`)).join('') +
      '<span class="divider"></span>' +
      DROP_TOOLS.map(k => toolButton(k, k === 'thorn' ? 'Thorns' : Evo.text.titleCase((Evo.ITEM_TYPES[k] || { word: k }).word.split(' ')[0]), DROP_HINTS[k],
        `<canvas class="tool-art" data-art="${k}" width="44" height="44"></canvas>`)).join('') +
      '<span class="divider"></span>' +
      `<button class="tool" id="addFemaleBtn" title="A grown female arrives"><span class="tool-icon" style="color:var(--female)">♀</span><span class="tool-text">Add</span></button>` +
      `<button class="tool" id="addMaleBtn" title="A grown male arrives"><span class="tool-icon" style="color:var(--male)">♂</span><span class="tool-text">Add</span></button>`;
    // Item icons drawn with the same art as the world
    toolbar.querySelectorAll('canvas[data-art]').forEach(cv => {
      const ctx = cv.getContext('2d'), k = cv.dataset.art;
      ctx.scale(2, 2);
      if (k === 'thorn') {
        ctx.strokeStyle = Evo.theme.color('--toxin'); ctx.lineWidth = 1.6; ctx.lineCap = 'round';
        for (let a = 0; a < 7; a++) { const r = a / 7 * Math.PI * 2; ctx.beginPath(); ctx.moveTo(11, 13); ctx.lineTo(11 + Math.cos(r) * 8, 13 + Math.sin(r) * 7); ctx.stroke(); }
      } else if (Evo.ItemArt && Evo.ItemArt.drawIcon) {
        try { Evo.ItemArt.drawIcon(ctx, k, 11, 11, 20, 0); } catch (e) { /* An icon is decoration */ }
      }
    });
    const toolBtns = toolbar.querySelectorAll('[data-tool]');
    const setTool = key => {
      app.tool = key;
      toolBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === key)));
      canvas.dataset.tool = key;
    };
    toolBtns.forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
    setTool('grab');
    const addAdult = sex => {
      const x = app.focus ? app.focus.x + Evo.randRange(-120, 120) : null;
      const c = world.addAdult(sex, { x });
      if (!c) return app.toast('The world is full.');
      log(`${who(c)} arrived`, c);
    };
    $('addFemaleBtn').addEventListener('click', () => addAdult('FEMALE'));
    $('addMaleBtn').addEventListener('click', () => addAdult('MALE'));

    // ---------- The hand ----------
    const hand = new Evo.HandController(canvas, view, world, {
      getTool: () => app.tool,
      onSelect: (c, keep) => app.select(c, keep),
      onPan: () => { if (app.following) { app.following = false; syncFollow(); } },
      onRelease: () => view.follow(app.following ? app.focus : null),
      onDrop: (tool, x, y) => {
        if (tool === 'egg') {
          if (!world.addEgg(x, y)) app.toast('No room for an egg.');
        } else if (!world.dropItem(tool, x, y)) app.toast('That can’t go there.');
      }
    });

    // ---------- Keyboard ----------
    window.addEventListener('keydown', e => {
      if (e.target.closest && e.target.closest('input, textarea')) return;
      const k = e.key;
      if (k === ' ') { e.preventDefault(); app.paused = !app.paused; syncPlayback(); }
      else if (['ArrowLeft', 'a', 'ArrowRight', 'd', 'ArrowUp', 'w', 'ArrowDown', 's'].includes(k)) {
        e.preventDefault();
        const dx = k === 'ArrowLeft' || k === 'a' ? 90 : k === 'ArrowRight' || k === 'd' ? -90 : 0;
        const dy = k === 'ArrowUp' || k === 'w' ? 60 : k === 'ArrowDown' || k === 's' ? -60 : 0;
        view.panBy(dx, dy);
        if (app.following) { app.following = false; syncFollow(); }
      }
      else if (k === '+' || k === '=') view.zoomAt(1.2, view.w / 2, view.h / 2);
      else if (k === '-' || k === '_') view.zoomAt(1 / 1.2, view.w / 2, view.h / 2);
      else if (k === '0') view.resetZoom();
      else if (k === 'f') toggleFollow();
      else if (k === 'Escape') setTool('grab');
      else if (k >= '1' && k <= '4') setSpeed(SPEEDS[+k - 1]);
      else if (k === 'Tab' && world.creatures.length) {
        e.preventDefault();
        const i = world.creatures.indexOf(app.focus);
        app.select(world.creatures[(i + (e.shiftKey ? world.creatures.length - 1 : 1)) % world.creatures.length]);
      }
    });

    // ---------- Creature card ----------
    const portrait = $('portrait'), portraitCtx = portrait.getContext('2d');
    const sizePortrait = () => Evo.fitCanvas(portrait, portraitCtx, 40, 40);
    let portraitSize = sizePortrait();
    function syncFollow() {
      $('followBtn').setAttribute('aria-pressed', String(app.following && !!app.focus));
      $('followBtn').textContent = app.following ? 'Following' : 'Follow';
    }
    function toggleFollow() {
      app.following = !app.following;
      view.follow(app.following ? app.focus : null);
      syncFollow();
    }
    $('followBtn').addEventListener('click', toggleFollow);

    function refreshCard(force = false) {
      const c = app.focus;
      $('creatureCard').classList.toggle('empty-card', !c);
      if (!c) { $('cardName').textContent = 'Nobody'; $('cardSub').textContent = 'Tap a creature to follow it'; return; }
      const t = Evo.text;
      if (force) {
        $('cardSex').textContent = H.sexGlyph(c.sex);
        $('cardSex').style.color = H.sexColor(c.sex);
        $('cardName').textContent = c.name;
      }
      $('cardSub').textContent = `${Evo.STAGES[c.stage].word} · gen ${c.generation} · ${t.clock(c.ageTicks)} old`;
      $('cardDoing').textContent = c.asleep ? 'Asleep' : `${t.ACTION_WORDS[c.action] || c.action} · ${c.mood}`;
      const drives = c.topDrives(3).filter(([, v]) => v > 0.02);
      $('cardDrives').innerHTML = H.bar('Health', c.health, 'var(--protein)') +
        drives.map(([k, v]) => H.bar(Evo.text.CHEM_WORDS[k], v, H.chemColor(k))).join('');
    }
    function drawPortrait(t) {
      const c = app.focus, ctx = portraitCtx, { width: w, height: h } = portraitSize;
      ctx.clearRect(0, 0, w, h);
      if (!c || !Evo.CreatureArt) return;
      try {
        ctx.save();
        Evo.CreatureArt.drawPortrait(ctx, Evo.poseOf(c), w, h, t);
        ctx.restore();
      } catch (e) { ctx.restore(); }
    }

    // ---------- Creature strip: everyone, one tap away ----------
    const strip = $('strip');
    let stripIds = '';
    function refreshStrip() {
      const ids = world.creatures.map(c => c.id).join(',');
      if (ids !== stripIds) {
        stripIds = ids;
        strip.innerHTML = world.creatures.map(c => `<button class="avatar" data-creature="${c.id}" title="${H.esc(c.name)}" style="--ring:${H.sexColor(c.sex)}"><canvas width="68" height="68"></canvas></button>`).join('');
      }
      strip.querySelectorAll('.avatar').forEach(b => {
        const c = world.creatureById(Number(b.dataset.creature));
        b.setAttribute('aria-current', String(c === app.focus));
        if (!c || !Evo.CreatureArt) return;
        const cv = b.firstChild, ctx = cv.getContext('2d');
        ctx.setTransform(2, 0, 0, 2, 0, 0);
        ctx.clearRect(0, 0, 34, 34);
        try { ctx.save(); Evo.CreatureArt.drawPortrait(ctx, Evo.poseOf(c), 34, 34, performance.now() / 1000, 'face'); ctx.restore(); } catch (e) { ctx.restore(); }
      });
    }
    strip.addEventListener('click', e => {
      const b = e.target.closest('[data-creature]');
      const c = b && world.creatureById(Number(b.dataset.creature));
      if (c) app.select(c);
    });

    // ---------- Status line ----------
    function refreshStatus() {
      const clock = world.clock;
      $('statPop').textContent = world.creatures.length;
      $('statGen').textContent = world.creatures.reduce((m, c) => Math.max(m, c.generation), 1);
      $('statDay').textContent = `Day ${clock.day + 1}`;
      $('statTime').textContent = Evo.text.timeOfDay(clock.phase);
      $('timeIcon').textContent = clock.light > 0.5 ? '☀' : clock.light > 0.2 ? '◐' : '☾';
      $('statSeason').textContent = world.seasonInfo.word;
    }

    // ---------- Main loop ----------
    let frame = 0;
    function loop(now) {
      frame++;
      const t = now / 1000;
      if (!app.paused) {
        const start = performance.now();
        for (let s = 0; s < app.speed; s++) {
          world.step();
          inspector.sample(world);
          if (performance.now() - start > FRAME_BUDGET_MS) break;
        }
      }
      refocus();
      view.options.focused = app.focus;
      view.options.hand = hand.handState();
      view.render(t);
      drawPortrait(t);
      if (labVisible()) inspector.frame();
      if (frame % 10 === 0) refreshCard();
      if (frame % 20 === 0) { refreshStatus(); refreshStrip(); }
      if (frame % 15 === 0 && labVisible()) inspector.update();
      requestAnimationFrame(loop);
    }
    window.addEventListener('resize', () => { portraitSize = sizePortrait(); });
    refocus();
    refreshStatus();
    refreshStrip();
    setDeck('body');
    requestAnimationFrame(loop);
  }

  Evo.bootApp = bootApp;
})(globalThis.Evo);
