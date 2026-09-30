// Small shared helpers for the interface: escaping, bars, colours and word lookups.
(function (Evo) {
  'use strict';
  const { clamp } = Evo.util;
  const CHEM_BY_KEY = Object.fromEntries(Evo.CHEMICALS.map(c => [c.key, c]));

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // 0..1 -> whole number 0..100
  const percentOf = v => Math.round(clamp(v, 0, 1) * 100);
  const chemToken = key => (CHEM_BY_KEY[key] || {}).token || '--muted';
  const chemColor = key => `var(${chemToken(key)})`;
  const sexColor = sex => (sex === 'FEMALE' ? 'var(--female)' : 'var(--male)');
  const sexGlyph = sex => (sex === 'FEMALE' ? '♀' : '♂');
  const bar = (label, value, color, num = percentOf(value), title = '') =>
    `<div class="bar"${title ? ` title="${esc(title)}"` : ''}><span>${esc(label)}</span><div class="track"><div class="fill" style="width:${percentOf(value)}%;background:${color}"></div></div><span class="num">${num}</span></div>`;

  // Replace an element's contents only when the markup changed. Lists that refresh several times a
  // second keep their buttons, so a tap that lands between two refreshes still counts.
  const shown = new WeakMap();
  const setHtml = (el, html) => { if (shown.get(el) !== html) { shown.set(el, html); el.innerHTML = html; } };

  Evo.uiHelpers = { esc, bar, setHtml, percentOf, sexColor, sexGlyph, chemToken, chemColor };
})(globalThis.Evo);
