// The player's hand: a friendly cartoon hand drawn in screen space (CSS px) with its origin at the
// pointer, in four poses (open to grab, a fist while holding, patting, slapping), plus a flat
// silhouette of the same shape for its drop shadow.
(function (Evo) {
  'use strict';
  const { TAU } = Evo.util;

  const SKIN = '#f6d6b6', SKIN_SHADE = '#e2b48f', INK = '#6e4535', CUFF = '#9be3c8', CUFF_DARK = '#4fa586';
  const OUTLINE = 2.6;     // the ink outline (and the shadow) is this much wider than each finger
  const SLAP_TILT = -0.42; // the slapping hand (and its shadow) tilts by this angle
  // The patting hand bobs up and down
  const patBob = t => -2.5 - Math.abs(Math.sin(t * 5)) * 3;

  function handOutlineAndFill(g, parts, palm) {
    // parts: [x0, y0, x1, y1, width] capsules; palm: [x, y, w, h, r]
    g.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
      g.strokeStyle = pass ? SKIN : INK;
      for (let i = 0; i < parts.length; i += 5) {
        g.lineWidth = parts[i + 4] + (pass ? 0 : OUTLINE);
        g.beginPath(); g.moveTo(parts[i], parts[i + 1]); g.lineTo(parts[i + 2], parts[i + 3]); g.stroke();
      }
      if (palm) {
        g.fillStyle = pass ? SKIN : INK;
        const e = pass ? 0 : 1.3;
        g.beginPath();
        g.roundRect(palm[0] - e, palm[1] - e, palm[2] + e * 2, palm[3] + e * 2, palm[4] + e);
        g.fill();
      }
    }
  }

  function drawCuff(g, x, y, w, h, rot) {
    g.save();
    g.translate(x, y);
    if (rot) g.rotate(rot);
    g.fillStyle = CUFF;
    g.strokeStyle = INK;
    g.lineWidth = 1.3;
    g.beginPath(); g.roundRect(-w / 2, -h / 2, w, h, 3); g.fill(); g.stroke();
    g.strokeStyle = CUFF_DARK;
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(-w / 2 + 2, h / 2 - 2.2); g.lineTo(w / 2 - 2, h / 2 - 2.2); g.stroke();
    g.restore();
  }

  const OPEN_HAND = [-6.4, -4, -7.8, -16.5, 4.6, -2.1, -5, -2.3, -19.5, 4.8, 2.2, -5, 3.1, -18, 4.6, 6.3, -3.8, 8.4, -13.8, 4.1, -8.2, 3, -14.4, -4.2, 5.2];
  const FIST_THUMB = [-8.6, 1.5, -1.5, -1.8, 5];
  const SLAP_HAND = [-4.6, -4, -5.4, -18, 4.7, -0.8, -5, -1, -20, 4.9, 3, -5, 3.4, -18.6, 4.7, 6.6, -3.6, 7.6, -14.8, 4.2, -8.6, 2, -14.6, -3, 5];

  function drawHandShape(g, mode, holding, t) {
    if (mode === 'pat') {
      // Palm down, fingers to the left; bobs as if patting
      g.translate(0, patBob(t));
      drawCuff(g, 14.5, -6, 7, 13, 0);
      handOutlineAndFill(g, [-2, -11.2, 3.5, -11.5, 5.2], [-19, -9, 28, 9, 4.5]);
      g.strokeStyle = SKIN_SHADE;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(-17, -3); g.lineTo(-8, -3);
      g.moveTo(-17.5, -5.5); g.lineTo(-10, -5.5);
      g.stroke();
      g.fillStyle = 'rgba(226,180,143,0.6)';
      g.beginPath(); g.ellipse(-1, -1.8, 9, 1.6, 0, 0, TAU); g.fill();
      return;
    }
    if (mode === 'slap') {
      g.rotate(SLAP_TILT);
      drawCuff(g, 0, 16, 18, 7, 0);
      handOutlineAndFill(g, SLAP_HAND, [-9.5, -6.5, 19, 16, 6]);
      g.strokeStyle = SKIN_SHADE;
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(-3, -1); g.quadraticCurveTo(1, 3, 5, 0); g.stroke();
      g.rotate(-SLAP_TILT);
      // Motion lines
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.lineWidth = 2;
      g.lineCap = 'round';
      const k = 0.6 + 0.4 * Math.sin(t * 9);
      g.beginPath();
      g.moveTo(14, -18); g.lineTo(14 + 7 * k, -22);
      g.moveTo(17, -10); g.lineTo(17 + 8 * k, -12);
      g.moveTo(17, -2); g.lineTo(17 + 7 * k, -2);
      g.stroke();
      return;
    }
    drawCuff(g, 0, 16, 18, 7, 0);
    if (holding) {
      handOutlineAndFill(g, FIST_THUMB, [-9.5, -9.5, 19, 19, 7]);
      // Folded fingers
      g.strokeStyle = SKIN_SHADE;
      g.lineWidth = 1.1;
      g.beginPath();
      for (let k = -1; k <= 1; k++) { g.moveTo(k * 4.4, -9); g.lineTo(k * 4.4, -3.5); }
      g.moveTo(-8.5, -3); g.quadraticCurveTo(0, -1.5, 8.5, -3.2);
      g.stroke();
      g.strokeStyle = SKIN;
      g.lineWidth = 5;
      g.beginPath(); g.moveTo(FIST_THUMB[0], FIST_THUMB[1]); g.lineTo(FIST_THUMB[2], FIST_THUMB[3]); g.stroke();
      return;
    }
    handOutlineAndFill(g, OPEN_HAND, [-9.5, -6.5, 19, 16, 6]);
    g.strokeStyle = SKIN_SHADE;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(-3.5, 0); g.quadraticCurveTo(0.5, 3.5, 5.5, 0.5);
    g.moveTo(-4.3, -6.5); g.lineTo(-4.2, -8.5);
    g.moveTo(0.1, -6.8); g.lineTo(0.2, -9);
    g.moveTo(4.4, -6.3); g.lineTo(4.6, -8.3);
    g.stroke();
  }

  // The hand's outline in one flat colour, for the drop shadow
  function drawHandSilhouette(g, mode, holding, t) {
    g.fillStyle = '#1a1020';
    g.strokeStyle = '#1a1020';
    g.lineCap = 'round';
    if (mode === 'pat') {
      g.translate(0, patBob(t));
      g.beginPath(); g.roundRect(-20, -10, 38, 11, 5); g.fill();
      return;
    }
    if (mode === 'slap') g.rotate(SLAP_TILT);
    g.beginPath(); g.roundRect(-10.5, -8, 21, 26, 7); g.fill();
    if (!holding) {
      const parts = mode === 'slap' ? SLAP_HAND : OPEN_HAND;
      for (let i = 0; i < parts.length; i += 5) {
        g.lineWidth = parts[i + 4] + OUTLINE;
        g.beginPath(); g.moveTo(parts[i], parts[i + 1]); g.lineTo(parts[i + 2], parts[i + 3]); g.stroke();
      }
    }
  }

  Evo.HandArt = { draw: drawHandShape, drawSilhouette: drawHandSilhouette };
})(globalThis.Evo);
