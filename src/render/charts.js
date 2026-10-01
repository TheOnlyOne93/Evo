// Small charts for the inside view, drawn in CSS px on a canvas that Evo.fitCanvas sized. They
// only draw what they are given; the inspector keeps the samples.
(function (Evo) {
  'use strict';

  // Lines of values from 0 to 1, one per series, kept in ring buffers of `len` slots: the newest
  // `n` samples, the oldest at slot `start % len`, drawn with the newest at the right edge.
  // series: [{ data, color, width, alpha }]
  function ringLines(ctx, w, h, series, len, n, start) {
    ctx.clearRect(0, 0, w, h);
    if (n < 2) return;
    for (const s of series) {
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width; ctx.globalAlpha = s.alpha;
      ctx.beginPath();
      for (let j = 0; j < n; j++) {
        const v = s.data[(start + j) % len];
        const x = (j + len - n) / (len - 1) * w, y = h - 2 - v * (h - 4);
        if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // One line of values from 0 to max, the oldest at the left edge, with the area under it filled
  function area(ctx, w, h, data, max, color, fill) {
    ctx.clearRect(0, 0, w, h);
    if (data.length < 2) return;
    ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.fillStyle = fill;
    ctx.beginPath();
    data.forEach((v, i) => { const x = i / (data.length - 1) * w, y = h - 2 - v / max * (h - 6); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.stroke();
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();
  }

  Evo.Charts = { ringLines, area };
})(globalThis.Evo);
