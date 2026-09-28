// Colours for the canvas renderers, read from the CSS custom properties in styles/app.css so the
// map, the bars and the brain always use the same colour for the same thing.
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

  // [r, g, b] for a #rrggbb token
  function rgb(token) {
    const hex = color(token).replace('#', '');
    const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex;
    const n = parseInt(full, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgba(token, alpha) {
    const [r, g, b] = rgb(token);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  Evo.theme = { color, rgb, rgba };
})(globalThis.Evo);
