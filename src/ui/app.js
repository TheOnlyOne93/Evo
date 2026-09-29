// The interface: builds the world and its views, wires the controls (see the setup* files
// beside this one), and runs the main loop.
(function (Evo) {
  'use strict';
  const { minBy } = Evo.util;
  const $ = id => document.getElementById(id);

  const FRAME_BUDGET_MS = 11;   // Simulation time allowed per frame; the speed drops rather than the frame rate

  function bootApp() {
    const canvas = $('worldCanvas');
    const world = new Evo.World();
    const view = new Evo.WorldView(world, canvas);
    const synth = new Evo.BioSynthesizer();
    const app = { world, view, synth, focus: null, following: true, tool: 'grab', speed: 1, paused: false };
    Evo.app = app;
    Evo.connectAudio(synth, world, c => c === app.focus);
    app.inspector = new Evo.Inspector(app);
    const { inspector } = app;

    // Focus: the creature the card and the inside view are about
    app.select = (c, keepFollowing = false) => {
      if (c !== app.focus) {
        app.focus = c;
        inspector.focusChanged();
        app.refreshCard(true);
        app.refreshStrip();
      }
      if (!keepFollowing) app.following = true;
      view.follow(app.following ? c : null);
      app.syncFollow();
    };
    // When the followed creature dies or leaves, pick the nearest one
    const refocus = () => {
      const old = app.focus;
      if (old && world.creatures.includes(old)) return;
      const next = old ? minBy(world.creatures, c => Math.abs(c.x - old.x)) : world.creatures[0];
      app.select(next || null, true);
      if (!next) view.follow(null);
    };

    // Each setup registers its functions on the app (toast, refreshStatus, refreshCard, setTool, ...)
    Evo.setupStatus(app);
    Evo.setupCard(app);
    Evo.setupStrip(app);
    Evo.setupLayout(app);
    Evo.setupToolbar(app);
    Evo.setupKeyboard(app);

    const hand = new Evo.HandController(canvas, view, world, {
      getTool: () => app.tool,
      onSelect: (c, keep) => app.select(c, keep),
      onPan: () => { if (app.following) { app.following = false; app.syncFollow(); } },
      onRelease: () => view.follow(app.following ? app.focus : null),
      onDrop: app.dropTool
    });

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
      app.drawPortrait(t);
      if (app.labVisible()) inspector.frame();
      if (frame % 10 === 0) app.refreshCard();
      if (frame % 20 === 0) { app.refreshStatus(); app.refreshStrip(); }
      if (frame % 15 === 0 && app.labVisible()) inspector.update();
      requestAnimationFrame(loop);
    }
    refocus();
    app.refreshStatus();
    app.refreshStrip();
    app.setDeck('body');
    requestAnimationFrame(loop);
  }

  Evo.bootApp = bootApp;
})(globalThis.Evo);
