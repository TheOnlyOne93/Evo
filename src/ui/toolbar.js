// Playback controls (pause, speed, scent, sound) and the tool tray (hand tools, things to drop, arrivals).
(function (Evo) {
  'use strict';
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
  const HAND_ICONS = { grab: '✋', pat: '🪶', slap: '💥' };
  const SPEEDS = [1, 2, 4, 8];

  function setupPlayback(app) {
    const { view, synth } = app;
    app.SPEEDS = SPEEDS;
    const speedBtns = document.querySelectorAll('[data-speed]');
    app.syncPlayback = () => {
      $('pauseBtn').textContent = app.paused ? '▶' : '❚❚';
      $('pauseBtn').setAttribute('aria-label', app.paused ? 'Resume' : 'Pause');
      $('pauseBtn').setAttribute('aria-pressed', String(app.paused));
      speedBtns.forEach(b => b.setAttribute('aria-pressed', String(!app.paused && +b.dataset.speed === app.speed)));
    };
    app.setSpeed = s => { app.speed = s; app.paused = false; app.syncPlayback(); };
    speedBtns.forEach(b => b.addEventListener('click', () => app.setSpeed(+b.dataset.speed)));
    $('pauseBtn').addEventListener('click', () => { app.paused = !app.paused; app.syncPlayback(); });
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
    const toolbar = $('toolTray');
    const toolButton = (key, label, hint, icon) =>
      `<button class="tool" data-tool="${key}" aria-pressed="${key === app.tool}" title="${H.esc(hint)}">${icon}<span class="tool-text">${label}</span></button>`;
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
    app.setTool = key => {
      app.tool = key;
      toolBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === key)));
      canvas.dataset.tool = key;
    };
    toolBtns.forEach(b => b.addEventListener('click', () => app.setTool(b.dataset.tool)));
    app.setTool('grab');
    const addAdult = sex => {
      const x = app.focus ? app.focus.x + Evo.randRange(-120, 120) : null;
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
