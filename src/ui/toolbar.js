// Playback controls (pause, speed, scent, sound) and the tool tray, in groups: hand tools, food,
// toys and other things to drop, and new arrivals.
(function (Evo) {
  'use strict';
  const $ = id => document.getElementById(id);
  const H = Evo.uiHelpers;
  const ICON = 22; // a tool icon canvas's CSS size (styles/app.css)

  // The tool tray, in groups: the hand's three uses, food, other things to drop, and arrivals
  const HAND_TOOLS = [
    { key: 'grab', word: 'Hand', hint: 'Hand: tap a creature to follow it; drag creatures, eggs and items to carry or throw them (Esc)' },
    { key: 'pat', word: 'Tickle', hint: 'Tickle: a gentle touch that most creatures enjoy. Rewards what it was doing' },
    { key: 'slap', word: 'Slap', hint: 'Slap: it hurts. Punishes what it was doing, so it learns to stop' }
  ];
  const DROP_GROUPS = [
    { key: 'food', word: 'Food', tools: ['fruit', 'grain', 'dew', 'grub', 'bug', 'mimic'] },
    { key: 'more', word: 'Toys & more', short: 'More', tools: ['ball', 'lure', 'egg', 'thorn'] }
  ];
  // What each thing to drop is called on its button, and what it is (the hint is "label: about")
  const DROP_TOOLS = {
    fruit: { label: 'Fruit', about: 'sugar' },
    grain: { label: 'Grain', about: 'starch and a little protein' },
    dew: { label: 'Dew', about: 'water' },
    grub: { label: 'Grub', about: 'protein and fat that crawls slowly' },
    bug: { label: 'Bug', about: 'protein that runs away' },
    mimic: { label: 'Mimic', about: 'looks and smells like fruit, but it is poisonous' },
    lure: { label: 'Lure', about: 'female scent that attracts males' },
    ball: { label: 'Ball', about: 'a toy to play with' },
    egg: { label: 'Egg', about: 'a new founder egg' },
    thorn: { label: 'Thorns', about: 'a thorn bush that pricks' }
  };
  const HAND_ICONS = { grab: '✋', pat: '🪶', slap: '💥' };

  function setupPlayback(app) {
    const { view, synth } = app;
    const speedBtns = document.querySelectorAll('[data-speed]');
    app.SPEEDS = [...speedBtns].map(b => +b.dataset.speed);
    app.syncPlayback = () => {
      $('pauseBtn').textContent = app.paused ? '▶' : '❚❚';
      $('pauseBtn').setAttribute('aria-label', app.paused ? 'Resume' : 'Pause');
      $('pauseBtn').setAttribute('aria-pressed', String(app.paused));
      speedBtns.forEach(b => b.setAttribute('aria-pressed', String(!app.paused && +b.dataset.speed === app.speed)));
    };
    app.setSpeed = s => { app.speed = s; app.paused = false; app.syncPlayback(); };
    speedBtns.forEach(b => b.addEventListener('click', () => app.setSpeed(+b.dataset.speed)));
    app.togglePause = () => { app.paused = !app.paused; app.syncPlayback(); };
    $('pauseBtn').addEventListener('click', app.togglePause);
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
    app.syncPlayback();
  }

  function setupTools(app) {
    const { world } = app;
    const canvas = $('worldCanvas');
    const tray = $('toolTray');
    const toolButton = (key, label, hint, icon) =>
      `<button class="tool" data-tool="${key}" aria-pressed="${key === app.tool}" title="${H.esc(hint)}">${icon}<span class="tool-text">${label}</span></button>`;
    const art = k => `<canvas class="tool-art" data-art="${k}"></canvas>`;
    // A group: a caption and its buttons. On narrow screens the caption becomes a button that opens
    // the group's buttons in a flyout above the tray.
    const group = (key, word, short, icon, items) =>
      `<div class="tool-group" role="group" aria-label="${H.esc(word)}" data-group="${key}">` +
      `<span class="group-label" aria-hidden="true">${H.esc(word)}</span>` +
      (icon ? `<button class="tool group-toggle" aria-expanded="false" title="${H.esc(word)}">${icon}<span class="tool-text">${H.esc(short)}</span></button>` : '') +
      `<div class="group-items">${items}</div></div>`;
    tray.innerHTML =
      group('hand', 'Hand', '', '', HAND_TOOLS.map(t => toolButton(t.key, t.word, t.hint, `<span class="tool-icon">${HAND_ICONS[t.key]}</span>`)).join('')) +
      DROP_GROUPS.map(g => group(g.key, g.word, g.short || g.word, `<canvas class="tool-art"></canvas>`,
        g.tools.map(k => toolButton(k, DROP_TOOLS[k].label, `${DROP_TOOLS[k].label}: ${DROP_TOOLS[k].about}`, art(k))).join(''))).join('') +
      group('add', 'Add a creature', 'Add', '<span class="tool-icon">＋</span>',
        '<button class="tool" id="addFemaleBtn" title="Add a grown female"><span class="tool-icon" style="color:var(--female)">♀</span><span class="tool-text">Female</span></button>' +
        '<button class="tool" id="addMaleBtn" title="Add a grown male"><span class="tool-icon" style="color:var(--male)">♂</span><span class="tool-text">Male</span></button>');
    // An item icon on a canvas, drawn with the same art as the world
    const drawToolIcon = (cv, k) => {
      const ctx = cv.getContext('2d');
      Evo.fitCanvas(cv, ctx, ICON, ICON);   // also clears
      if (k === 'thorn') {
        ctx.strokeStyle = Evo.theme.color('--toxin'); ctx.lineWidth = 1.6; ctx.lineCap = 'round';
        for (let a = 0; a < 7; a++) { const r = a / 7 * Evo.util.TAU; ctx.beginPath(); ctx.moveTo(11, 13); ctx.lineTo(11 + Math.cos(r) * 8, 13 + Math.sin(r) * 7); ctx.stroke(); }
      } else {
        try { Evo.ItemArt.drawIcon(ctx, k, 11, 11, 20, 0); } catch (e) { console.error(e); }   // An icon is decoration
      }
    };
    tray.querySelectorAll('canvas[data-art]').forEach(cv => drawToolIcon(cv, cv.dataset.art));
    // On mid-width screens the tray scrolls sideways; an edge with tools hidden past it fades out
    const markHidden = () => {
      const max = tray.scrollWidth - tray.clientWidth;
      tray.classList.toggle('more-left', tray.scrollLeft > 1);
      tray.classList.toggle('more-right', tray.scrollLeft < max - 1);
    };
    tray.addEventListener('scroll', markHidden, { passive: true });
    if (window.ResizeObserver) new ResizeObserver(markHidden).observe(tray);
    // A group's toggle shows the icon of its chosen tool, or else its first
    const groups = [...tray.querySelectorAll('.tool-group')];
    const syncToggle = g => {
      const toggle = g.querySelector('.group-toggle'), cv = toggle && toggle.querySelector('canvas');
      if (!toggle) return;
      const chosen = g.querySelector('.group-items [aria-pressed="true"]');
      toggle.setAttribute('aria-pressed', String(!!chosen));
      if (!cv) return;
      drawToolIcon(cv, (chosen || g.querySelector('.group-items [data-tool]')).dataset.tool);
    };
    const setGroupOpen = (g, open) => {
      g.classList.toggle('open', open);
      const t = g.querySelector('.group-toggle');
      if (t) t.setAttribute('aria-expanded', String(open));
    };
    const closeGroups = except => groups.forEach(g => { if (g !== except) setGroupOpen(g, false); });
    tray.querySelectorAll('.group-toggle').forEach(t => t.addEventListener('click', () => {
      const g = t.closest('.tool-group'), open = !g.classList.contains('open');
      closeGroups(g);
      setGroupOpen(g, open);
    }));
    document.addEventListener('pointerdown', e => { if (!e.target.closest('.tool-group')) closeGroups(); });

    const toolBtns = tray.querySelectorAll('[data-tool]');
    app.setTool = key => {
      app.tool = key;
      toolBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === key)));
      canvas.dataset.tool = key;
      groups.forEach(syncToggle);
      closeGroups();
    };
    toolBtns.forEach(b => b.addEventListener('click', () => app.setTool(b.dataset.tool)));
    app.setTool('grab');
    const addAdult = sex => {
      closeGroups();
      // Near the creature being followed, else near where the first of its sex stood
      const x = (app.focus ? app.focus.x : world.founderX[sex]) + Evo.randRange(-120, 120);
      const c = world.addAdult(sex, { x });
      if (!c) return app.toast('The world is full.');
      app.log(`${app.who(c)} arrived`, c);
    };
    $('addFemaleBtn').addEventListener('click', () => addAdult('FEMALE'));
    $('addMaleBtn').addEventListener('click', () => addAdult('MALE'));

    // Dropping tools: what the hand does with them when released on the world
    app.dropTool = (tool, x, y) => {
      if (tool === 'egg') {
        if (!world.addEgg(x, y)) app.toast('No room for an egg.');
      } else if (!world.dropItem(tool, x, y)) app.toast('That can’t go there.');
    };
  }

  Evo.setupToolbar = function setupToolbar(app) {
    setupPlayback(app);
    setupTools(app);
  };
})(globalThis.Evo);
