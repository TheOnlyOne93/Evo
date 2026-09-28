// Size a canvas's drawing buffer to its on-screen size at the device's pixel ratio, so drawing is
// sharp and never stretched. Returns the size in CSS pixels. Every canvas goes through this.
(function (Evo) {
  'use strict';
  Evo.fitCanvas = function fitCanvas(canvas, ctx, minWidth = 1, minHeight = 1) {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(minWidth, canvas.clientWidth);
    const height = Math.max(minHeight, canvas.clientHeight);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width, height };
  };
})(globalThis.Evo);
