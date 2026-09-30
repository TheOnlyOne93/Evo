// Size a canvas's drawing buffer to its on-screen size at the device's pixel ratio, so drawing is
// sharp and never stretched. Returns the size in CSS pixels. Every canvas goes through this.
// Also an offscreen canvas maker and the small path helpers every renderer shares (Evo.Paint,
// which the painters add to in painters/palette.js).
(function (Evo) {
  'use strict';
  const { TAU } = Evo.util;

  Evo.fitCanvas = function fitCanvas(canvas, ctx, minWidth = 1, minHeight = 1) {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(minWidth, canvas.clientWidth);
    const height = Math.max(minHeight, canvas.clientHeight);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width, height };
  };

  // An offscreen canvas of at least 1 × 1 device px (sprites, icons, pixel images)
  Evo.makeCanvas = function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  };

  // A circle as a subpath (for batching many into one fill)
  function circle(g, x, y, r) { g.moveTo(x + r, y); g.arc(x, y, r, 0, TAU); }

  // A four-pointed twinkle of radius s as a new path (the caller fills it)
  function sparkle(g, x, y, s) {
    g.beginPath();
    g.moveTo(x, y - s); g.quadraticCurveTo(x, y, x + s, y); g.quadraticCurveTo(x, y, x, y + s);
    g.quadraticCurveTo(x, y, x - s, y); g.quadraticCurveTo(x, y, x, y - s);
  }

  Evo.Paint = { circle, sparkle };
})(globalThis.Evo);
