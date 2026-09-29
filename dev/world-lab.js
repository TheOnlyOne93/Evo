// The world lab: the game's own world (Evo.World at the game's seed) drawn by the game's WorldView,
// with lab controls on top for time of day, season, speed, overlays and the hand. The page loads
// the same src/ scripts as index.html, in the same order, and the controls act on the world only
// through its public API (setTime, step, addAdult; the hand is the game's HandController).
// URL options:
//   ?seed=11                 the world's seed, as in index.html (read by src/core/evo.js)
//   &speed=4  &paused=1      clock speed (60 ticks per second × speed), or start paused
//   &phase=0.5&season=2      jump to a time of day (0 midnight, 0.5 noon) and a season (0..3)
//   &creatures=4             add that many adults (world.addAdult) to the founders
//   &ui=0  &scent=1          hide the panel, show scent
(function (Evo) {
  'use strict';
  const params = new URLSearchParams(location.search);
  const num = (k, d) => (params.has(k) ? Number(params.get(k)) : d);
  const FRAME_BUDGET_MS = 11;   // Sim time allowed per frame, as in src/ui/app.js
  const YEAR_DAYS = Evo.SEASON_DAYS * Evo.SEASONS.length;

  function start() {
    if (params.get('ui') === '0') document.body.classList.add('noui');

    const world = new Evo.World();
    for (let i = 0; i < num('creatures', 0); i++) world.addAdult(i % 2 ? 'MALE' : 'FEMALE');
    // The clock moves only through world.setTime(day, phase). A season is SEASON_DAYS days, so
    // choosing one moves the day into it, keeping the year, the day within the season and the
    // time of day. Either may turn the clock back; the lab allows it, the game never does.
    const setPhase = p => world.setTime(world.clock.day, p);
    const setSeason = s => {
      const d = world.clock.day;
      world.setTime(Math.floor(d / YEAR_DAYS) * YEAR_DAYS + s * Evo.SEASON_DAYS + d % Evo.SEASON_DAYS, world.clock.phase);
    };
    if (params.has('season')) setSeason(num('season', 0));
    if (params.has('phase')) setPhase(num('phase', 0.5));

    const canvas = document.getElementById('world');
    const view = new Evo.WorldView(world, canvas);
    const clock = new Evo.FrameClock();
    const state = { paused: params.get('paused') === '1', speed: num('speed', 1), tool: 'grab', following: false };
    view.options.showScent = params.get('scent') === '1';
    // The senses overlay: the two hemifields of the eyes, out to the creature's vision range
    view.onDrawSenses = (g, c) => {
      const r = c.traits.visionRange, x = c.headX, y = c.headY;
      g.strokeStyle = 'rgba(155,227,200,0.5)';
      g.setLineDash([4, 5]);
      g.lineWidth = 1.2;
      g.beginPath();
      g.arc(x, y, r, Math.PI * 0.55, Math.PI * 1.45);
      g.moveTo(x + r * Math.cos(-Math.PI * 0.45), y + r * Math.sin(-Math.PI * 0.45));
      g.arc(x, y, r, -Math.PI * 0.45, Math.PI * 0.45);
      g.stroke();
      g.setLineDash([]);
    };

    // One tick, and what watches each tick in the game (the cues); the loop and lab.step use it
    const tick = () => {
      world.step();
      view.cues.track(world, performance.now() / 1000);
    };

    // ---- The hand: the game's controller (tap to follow, drag a creature or item to carry it,
    // drag the ground to pan, wheel or pinch to zoom; tickle and slap touch a creature)
    const hand = new Evo.HandController(canvas, view, world, {
      getTool: () => state.tool,
      onSelect: (c, keep) => focus(c, keep),
      onPan: () => { state.following = false; refresh(); },
      onRelease: () => view.follow(state.following ? view.options.focused : null),
      onDrop: () => {},   // The lab has no item tools
      msPerTick: () => (state.paused ? 0 : 1000 / (Evo.TICKS_PER_SECOND * clock.achievedSpeed()))
    });

    // ---- Panel
    const $ = s => document.querySelector(s);
    const setPressed = (sel, test) => document.querySelectorAll(sel).forEach(b => b.setAttribute('aria-pressed', String(test(b))));
    const refresh = () => {
      setPressed('[data-season]', b => Number(b.dataset.season) === world.season.index);
      setPressed('[data-speed]', b => (state.paused ? b.dataset.speed === '0' : Number(b.dataset.speed) === state.speed));
      setPressed('[data-hand]', b => b.dataset.hand === state.tool);
      $('#scentBtn').setAttribute('aria-pressed', String(!!view.options.showScent));
      $('#sensesBtn').setAttribute('aria-pressed', String(!!view.options.showSenses));
      $('#followBtn').setAttribute('aria-pressed', String(!!view.following));
    };
    document.querySelectorAll('[data-phase]').forEach(b => b.addEventListener('click', () => { setPhase(Number(b.dataset.phase)); refresh(); }));
    document.querySelectorAll('[data-season]').forEach(b => b.addEventListener('click', () => { setSeason(Number(b.dataset.season)); refresh(); }));
    document.querySelectorAll('[data-speed]').forEach(b => b.addEventListener('click', () => {
      const s = Number(b.dataset.speed);
      state.paused = s === 0;
      if (s) state.speed = s;
      refresh();
    }));
    document.querySelectorAll('[data-hand]').forEach(b => b.addEventListener('click', () => { state.tool = b.dataset.hand; refresh(); }));
    $('#scentBtn').addEventListener('click', () => { view.options.showScent = !view.options.showScent; refresh(); });
    $('#sensesBtn').addEventListener('click', () => { view.options.showSenses = !view.options.showSenses; refresh(); });
    $('#followBtn').addEventListener('click', () => toggleFollow());
    $('#fitBtn').addEventListener('click', () => view.resetZoom());
    $('#collapse').addEventListener('click', () => $('#panel').classList.toggle('collapsed'));

    function focus(c, keepFollowing = false) {
      view.options.focused = c;
      if (!keepFollowing) state.following = true;
      view.follow(state.following ? c : null);
      refresh();
    }
    function toggleFollow() {
      state.following = !view.following;
      if (state.following) focus(view.options.focused || world.creatures[0] || null);
      else view.follow(null);
      refresh();
    }

    // ---- Keys. The camera keys pan and zoom by their own steps, not the game's (keyboard.js).
    window.addEventListener('keydown', e => {
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'a') view.panBy(60, 0);
      else if (k === 'ArrowRight' || k === 'd') view.panBy(-60, 0);
      else if (k === 'ArrowUp' || k === 'w') view.panBy(0, 60);
      else if (k === 'ArrowDown' || k === 's') view.panBy(0, -60);
      else if (k === '+' || k === '=') view.zoomAt(1.15, view.w / 2, view.h / 2);
      else if (k === '-' || k === '_') view.zoomAt(1 / 1.15, view.w / 2, view.h / 2);
      else if (k === 'f') toggleFollow();
      else if (k === ' ') { state.paused = !state.paused; e.preventDefault(); }
      else if (k >= '1' && k <= '4') setSeason(Number(k) - 1);
      else return;
      if (k.startsWith('Arrow') || 'adws'.includes(k)) state.following = false;
      refresh();
    });
    window.addEventListener('resize', () => view.resize());

    // ---- Loop, as in src/ui/app.js: the frame clock turns wall time into whole ticks, and ticks
    // the frame budget can't fit are dropped (the achieved speed shows in the readout)
    let last = null, fpsAvg = 60, renderAvg = 0, shown = 0;
    let measuring = null;
    function frame(now) {
      const dtMs = last === null ? 0 : now - last;
      last = now;
      const ticks = clock.advance(dtMs, state.speed, state.paused);
      let ran = 0;
      const start = performance.now();
      while (ran < ticks) {
        tick();
        ran++;
        if (performance.now() - start > FRAME_BUDGET_MS) break;
      }
      clock.report(ran);
      // A focused creature that died or left: let it go
      if (view.options.focused && !world.creatures.includes(view.options.focused)) { view.options.focused = null; view.follow(null); refresh(); }
      view.options.hand = hand.handState();
      const t0 = performance.now();
      view.render(now / 1000);
      if (measuring && measuring.flush) view.ctx.getImageData(0, 0, 1, 1); // make the raster work count
      const ms = performance.now() - t0;
      renderAvg += (ms - renderAvg) * 0.05;
      if (dtMs > 0) fpsAvg += (1000 / dtMs - fpsAvg) * 0.05;
      if (measuring) {
        measuring.render.push(ms);
        measuring.frame.push(dtMs);
        if (measuring.render.length >= measuring.n) { const m = measuring; measuring = null; m.done(); }
      }
      if (now - shown > 500) {
        shown = now;
        const speed = state.paused ? 'paused' : `${+clock.achievedSpeed().toFixed(1)}×`;
        $('#fps').textContent = `${Math.round(fpsAvg)} fps · ${renderAvg.toFixed(1)} ms · ${speed}`;
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    refresh();

    // For scripted checks (Playwright)
    window.lab = {
      world, view, state, hand, clock, focus, refresh, setPhase,
      setSeason: s => { setSeason(s); refresh(); },
      step(n = 1) { for (let i = 0; i < n; i++) tick(); },
      measure(n = 600, opts = {}) {
        return new Promise(resolve => {
          measuring = {
            n, flush: !!opts.flush, render: [], frame: [], done() {
              const avg = a => a.reduce((s, v) => s + v, 0) / a.length;
              const p95 = a => [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.95)];
              resolve({ frames: this.render.length, renderAvg: avg(this.render), renderP95: p95(this.render), frameAvg: avg(this.frame.slice(1)) });
            },
          };
        });
      },
    };
  }

  start();
})(globalThis.Evo);
