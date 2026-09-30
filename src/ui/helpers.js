// Small shared helpers for the interface: escaping, bars, colours and word lookups.
(function (Evo) {
  'use strict';
  const { clamp01 } = Evo.util;
  const CHEM_BY_KEY = Object.fromEntries(Evo.CHEMICALS.map(c => [c.key, c]));

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // 0..1 -> whole number 0..100
  const percentOf = v => Math.round(clamp01(v) * 100);
  const percent = v => `${percentOf(v)}%`;
  // '1 meal', '3 meals'
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const chemToken = key => (CHEM_BY_KEY[key] || {}).token || '--muted';
  const chemColor = key => `var(${chemToken(key)})`;
  const sexColor = sex => (sex === 'FEMALE' ? 'var(--female)' : 'var(--male)');
  const sexGlyph = sex => (sex === 'FEMALE' ? '♀' : '♂');
  const sexWord = sex => (sex === 'FEMALE' ? 'Female' : 'Male');
  const bar = (label, value, color, num = percentOf(value)) =>
    `<div class="bar"><span>${esc(label)}</span><div class="track"><div class="fill" style="width:${percentOf(value)}%;background:${color}"></div></div><span class="num">${num}</span></div>`;

  // A creature's face or portrait on a canvas the caller sized. Art is decoration: a failure is logged once.
  let faceFailed = false;
  const drawCreatureFace = (ctx, view, c, w, h, t, framing) => {
    try {
      ctx.save();
      Evo.CreatureArt.drawPortrait(ctx, view.poseFor(c), w, h, t, framing);
      ctx.restore();
    } catch (e) {
      ctx.restore();
      if (!faceFailed) { faceFailed = true; console.error(e); }
    }
  };

  // Replace an element's contents only when the markup changed. Lists that refresh several times a
  // second keep their buttons, so a tap that lands between two refreshes still counts.
  const shown = new WeakMap();
  const setHtml = (el, html) => { if (shown.get(el) !== html) { shown.set(el, html); el.innerHTML = html; } };

  Evo.uiHelpers = { esc, bar, setHtml, drawCreatureFace, percentOf, percent, plural, sexColor, sexGlyph, sexWord, chemToken, chemColor };
})(globalThis.Evo);
