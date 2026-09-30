// Colours for the canvas renderers, read from the CSS custom properties in styles/app.css so the
// map, the bars and the brain always use the same colour for the same thing. Also the small
// [r, g, b] array helpers the renderers share (Evo.color).
(function (Evo) {
  'use strict';
  const cache = new Map();

  function color(token) {
    if (!cache.has(token)) {
      const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
      cache.set(token, value || '#ff00ff'); // Magenta makes a missing token obvious
    }
    return cache.get(token);
  }

  // [r, g, b] for a #rgb or #rrggbb colour
  function hexRgb(hex) {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    const n = parseInt(full, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // [r, g, b] for a token (Evo.color.rgb turns an array into a CSS string)
  const rgbOf = token => hexRgb(color(token));

  // A token's colour at an alpha, as a CSS string
  const rgba = (token, alpha) => Evo.color.rgba(rgbOf(token), alpha);

  // Helpers on [r, g, b] arrays; mixInto writes into `out` so per-frame code need not allocate
  function mixInto(out, a, b, t) {
    out[0] = a[0] + (b[0] - a[0]) * t;
    out[1] = a[1] + (b[1] - a[1]) * t;
    out[2] = a[2] + (b[2] - a[2]) * t;
    return out;
  }
  Evo.color = {
    rgb: c => 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')',
    rgba: (c, a) => 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')',
    mix: (a, b, t) => mixInto([0, 0, 0], a, b, t),
    mixInto,
    scale: (c, k) => [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)],
  };

  // The dark edge under a light stroke (the focus ring, attention brackets), so it shows on any ground
  const INK_EDGE = '#06131a';

  Evo.theme = { color, hexRgb, rgbOf, rgba, INK_EDGE };
})(globalThis.Evo);
