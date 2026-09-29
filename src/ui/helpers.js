// Small shared helpers for the interface: escaping, bars, colours and word lookups.
(function (Evo) {
  'use strict';
  const { clamp } = Evo.util;
  const byKey = list => Object.fromEntries(list.map(x => [x.key, x]));
  const CHEM_BY_KEY = byKey(Evo.CHEMICALS);
  const VISION_BY_KEY = byKey(Evo.VISION_FEATURES);
  const SCENT_BY_KEY = byKey(Evo.SCENTS);

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // 0..1 -> whole number 0..100
  const percentOf = v => Math.round(clamp(v, 0, 1) * 100);
  const chemToken = key => (CHEM_BY_KEY[key] || {}).token || '--muted';
  const chemColor = key => `var(${chemToken(key)})`;
  const sexColor = sex => (sex === 'FEMALE' ? 'var(--female)' : 'var(--male)');
  const sexGlyph = sex => (sex === 'FEMALE' ? '♀' : '♂');
  const bar = (label, value, color, num = percentOf(value), title = '') =>
    `<div class="bar"${title ? ` title="${esc(title)}"` : ''}><span>${esc(label)}</span><div class="track"><div class="fill" style="width:${percentOf(value)}%;background:${color}"></div></div><span class="num">${num}</span></div>`;

  Evo.uiHelpers = { esc, bar, percentOf, sexColor, sexGlyph, chemToken, chemColor, VISION_BY_KEY, SCENT_BY_KEY };
})(globalThis.Evo);
