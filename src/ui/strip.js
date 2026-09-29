// The creature strip: everyone in the world, one tap away, each with a badge for its strongest need.
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
        strip.innerHTML = world.creatures.map(c => `<button class="avatar" data-creature="${c.id}" style="--ring:${H.sexColor(c.sex)}"><canvas width="68" height="68"></canvas><span class="badge" aria-hidden="true"></span></button>`).join('');
      }
      strip.querySelectorAll('.avatar').forEach(b => {
        const c = world.creatureById(Number(b.dataset.creature));
        b.setAttribute('aria-current', String(c === app.focus));
        if (!c) return;
        // A badge with its strongest need (or sleep), and the needs in words on hover
        const needs = c.dead || c.asleep ? [] : Evo.needsOf(c, 3, 0.45);
        const badge = c.dead ? '' : c.asleep ? '💤' : needs.length ? needs[0].icon : '';
        const label = `${c.name} (${c.sex === 'FEMALE' ? 'female' : 'male'})` +
          (c.asleep ? ', asleep' : needs.length ? ': ' + needs.map(n => n.word.toLowerCase()).join(', ') : '');
        if (b.lastChild.textContent !== badge) b.lastChild.textContent = badge;
        if (b.title !== label) { b.title = label; b.setAttribute('aria-label', label); }
        if (!Evo.CreatureArt) return;
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
