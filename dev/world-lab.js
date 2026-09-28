// The world lab: the real WorldView drawing the mock world, with controls for time, season,
// overlays and the hand. URL options:
//   ?creatures=16&items=80&seed=11&speed=4   world size and clock speed
//   &phase=0.5&season=2                      start time of day (0..1) and season (0..3)
//   &paused=1  &ui=0  &scent=1               freeze the clock, hide the panel, show scent
//   &art=1                                   also load ../src/render/creature-art.js if present
//   &art=<path>                              ... or the creature art at that path
(function (Evo) {
  'use strict';
  const params = new URLSearchParams(location.search);
  const num = (k, d) => (params.has(k) ? Number(params.get(k)) : d);

  function loadScript(src) {
    return new Promise(resolve => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
  }

  async function start() {
    const art = params.get('art');
    if (art) await loadScript(art === '1' ? '../src/render/creature-art.js' : art);
    Evo.MockCreatures.install();
    if (params.get('ui') === '0') document.body.classList.add('noui');

    const world = new Evo.MockWorld({ creatures: num('creatures', 7), items: num('items', 72), seed: num('seed', 11), speed: num('speed', 4) });
    if (params.has('season')) world.setSeason(num('season', 0));
    if (params.has('phase')) world.setPhase(num('phase', 0.5));
    const canvas = document.getElementById('world');
    const view = new Evo.WorldView(world, canvas);
    const hand = { x: null, y: null, mode: 'grab', holding: false };
    const state = { paused: params.get('paused') === '1', speed: world.speed };
    view.options.hand = hand;
    view.options.showScent = params.get('scent') === '1';
    view.onDrawSenses = (g, c) => { // a stand-in for the senses overlay: the two hemifields
      g.strokeStyle = 'rgba(155,227,200,0.5)';
      g.setLineDash([4, 5]);
      g.lineWidth = 1.2;
      g.beginPath();
      g.arc(c.x, c.y - c.size * 0.6, 160, Math.PI * 0.55, Math.PI * 1.45);
      g.moveTo(c.x + 160 * Math.cos(-Math.PI * 0.45), c.y - c.size * 0.6 + 160 * Math.sin(-Math.PI * 0.45));
      g.arc(c.x, c.y - c.size * 0.6, 160, -Math.PI * 0.45, Math.PI * 0.45);
      g.stroke();
      g.setLineDash([]);
    };

    // ---- Panel
    const $ = s => document.querySelector(s);
    const setPressed = (sel, test) => document.querySelectorAll(sel).forEach(b => b.setAttribute('aria-pressed', String(test(b))));
    const refresh = () => {
      setPressed('[data-season]', b => Number(b.dataset.season) === world.season.index);
      setPressed('[data-speed]', b => (state.paused ? b.dataset.speed === '0' : Number(b.dataset.speed) === world.speed));
      setPressed('[data-hand]', b => b.dataset.hand === (hand.holding ? 'hold' : hand.mode));
      $('#scentBtn').setAttribute('aria-pressed', String(!!view.options.showScent));
      $('#sensesBtn').setAttribute('aria-pressed', String(!!view.options.showSenses));
      $('#followBtn').setAttribute('aria-pressed', String(!!view.following));
    };
    document.querySelectorAll('[data-phase]').forEach(b => b.addEventListener('click', () => world.setPhase(Number(b.dataset.phase))));
    document.querySelectorAll('[data-season]').forEach(b => b.addEventListener('click', () => { world.setSeason(Number(b.dataset.season)); refresh(); }));
    document.querySelectorAll('[data-speed]').forEach(b => b.addEventListener('click', () => {
      const s = Number(b.dataset.speed);
      state.paused = s === 0;
      if (s) world.speed = s;
      refresh();
    }));
    document.querySelectorAll('[data-hand]').forEach(b => b.addEventListener('click', () => {
      hand.holding = b.dataset.hand === 'hold';
      hand.mode = hand.holding ? 'grab' : b.dataset.hand;
      refresh();
    }));
    $('#scentBtn').addEventListener('click', () => { view.options.showScent = !view.options.showScent; refresh(); });
    $('#sensesBtn').addEventListener('click', () => { view.options.showSenses = !view.options.showSenses; refresh(); });
    $('#followBtn').addEventListener('click', () => toggleFollow());
    $('#fitBtn').addEventListener('click', () => view.resetZoom());
    $('#collapse').addEventListener('click', () => $('#panel').classList.toggle('collapsed'));

    function focus(c) {
      view.options.focused = c;
      view.follow(c);
      refresh();
    }
    function toggleFollow() {
      if (view.following) view.follow(null);
      else focus(view.options.focused || world.creatures[0]);
      refresh();
    }

    // ---- Pointer: drag to pan, click to follow, wheel/pinch to zoom
    const pointers = new Map();
    let downAt = null, dragged = false, pinch = 0;
    const local = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    canvas.addEventListener('pointerdown', e => {
      canvas.setPointerCapture(e.pointerId);
      const p = local(e);
      pointers.set(e.pointerId, p);
      downAt = p;
      dragged = false;
      if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
    });
    canvas.addEventListener('pointermove', e => {
      const p = local(e);
      if (e.pointerType !== 'touch') { hand.x = p.x; hand.y = p.y; }
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      pointers.set(e.pointerId, p);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0) view.zoomAt(d / pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
        pinch = d;
        dragged = true;
        return;
      }
      if (!dragged && Math.hypot(p.x - downAt.x, p.y - downAt.y) > 5) dragged = true;
      if (dragged) { view.panBy(p.x - prev.x, p.y - prev.y); refresh(); }
    });
    const up = e => {
      const p = local(e);
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = 0;
      if (!dragged && downAt && pointers.size === 0) {
        const c = view.creatureAt(p.x, p.y);
        if (c) focus(c);
        else {
          const it = view.itemAt(p.x, p.y);
          if (it) console.info('item', it.type, it);
          else { view.options.focused = null; refresh(); }
        }
      }
      if (pointers.size === 0) downAt = null;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', () => { hand.x = null; });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const p = local(e);
      view.zoomAt(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
    }, { passive: false });
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
      else if (k >= '1' && k <= '4') world.setSeason(Number(k) - 1);
      else return;
      refresh();
    });
    window.addEventListener('resize', () => view.resize());

    // ---- Loop, with an fps readout
    let last = performance.now(), fpsAvg = 60, renderAvg = 0, shown = 0;
    let measuring = null;
    function frame(now) {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!state.paused) world.update(dt);
      const t0 = performance.now();
      view.render(now / 1000);
      if (measuring && measuring.flush) view.ctx.getImageData(0, 0, 1, 1); // make the raster work count
      const ms = performance.now() - t0;
      renderAvg += (ms - renderAvg) * 0.05;
      if (dt > 0) fpsAvg += (1 / dt - fpsAvg) * 0.05;
      if (measuring) {
        measuring.render.push(ms);
        measuring.frame.push(dt * 1000);
        if (measuring.render.length >= measuring.n) { const m = measuring; measuring = null; m.done(); }
      }
      if (now - shown > 500) { shown = now; $('#fps').textContent = `${Math.round(fpsAvg)} fps · ${renderAvg.toFixed(1)} ms`; }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    refresh();

    // For scripted checks (Playwright)
    window.lab = {
      world, view, state, hand, focus, refresh,
      setPhase: p => world.setPhase(p),
      setSeason: s => { world.setSeason(s); refresh(); },
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
