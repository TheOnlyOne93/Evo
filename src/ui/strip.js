// The creature strip: everyone in the world, one tap away.
(function (Evo) {
  'use strict';
  const $ = id => document.getElementById(id);
  const H = Evo.uiHelpers;

  Evo.setupStrip = function setupStrip(app) {
    const { world } = app;
    const strip = $('strip');
    let stripIds = '';
    app.refreshStrip = () => {
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
    };
    strip.addEventListener('click', e => {
      const b = e.target.closest('[data-creature]');
      const c = b && world.creatureById(Number(b.dataset.creature));
      if (c) app.select(c);
    });
  };
})(globalThis.Evo);
