// The interface: builds the world and its views, wires the controls (see the setup* files
// beside this one), and runs the main loop.
(function (Evo) {
  'use strict';
  const { minBy } = Evo.util;
  const $ = id => document.getElementById(id);

  const FRAME_BUDGET_MS = 11;   // Simulation time allowed per frame; the speed drops rather than the frame rate
  // Panel refreshes, in wall time (these were every 10 / 20 / 15 frames at 60 fps)
  const CARD_EVERY_MS = 1000 * 10 / 60;
  const STATUS_EVERY_MS = 1000 * 20 / 60;
  const LAB_EVERY_MS = 1000 * 15 / 60;

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
      onDrop: app.dropTool,
      // Wall ms one tick takes at the speed actually achieved; 0 while paused (nothing moves in sim time)
      msPerTick: () => app.paused ? 0 : 1000 / (Evo.TICKS_PER_SECOND * app.frameClock.achievedSpeed())
    });

    const clock = app.frameClock = new Evo.FrameClock();
    let last = null, cardAt = 0, statusAt = 0, labAt = 0;
    // One tick plus everything that watches each tick; the loop and single-step both use it
    const tick = () => {
      world.step();
      inspector.sample(world);
      view.cues.track(world, performance.now() / 1000);
      inspector.scopeTick();
    };
    app.stepOnce = () => {
      tick();
      app.refreshCard();
      app.refreshStatus();
      app.refreshStrip();
    };
    function loop(now) {
      const t = now / 1000;
      // The first frame has no previous timestamp; hidden-tab gaps are capped by the clock
      const ticks = clock.advance(last === null ? 0 : now - last, app.speed, app.paused);
      last = now;
      let ran = 0;
      const start = performance.now();
      while (ran < ticks) {
        tick();
        ran++;
        if (performance.now() - start > FRAME_BUDGET_MS) break;
      }
      clock.report(ran);
      inspector.brainView.ticksRun = Math.max(1, ran);   // the brain map lights what fired in any of them
      refocus();
      view.options.focused = app.focus;
      view.options.hand = hand.handState();
      view.render(t);
      app.drawPortrait(t);
      if (app.labVisible()) inspector.frame();
      if (now - cardAt >= CARD_EVERY_MS) { cardAt = now; app.refreshCard(); }
      if (now - statusAt >= STATUS_EVERY_MS) { statusAt = now; app.refreshStatus(); app.refreshStrip(); }
      if (now - labAt >= LAB_EVERY_MS && app.labVisible()) { labAt = now; inspector.update(); }
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
