// Palettes and small helpers shared by the static-art painters (src/render/painters/*). Each
// painter draws in world units into an offscreen sprite; WorldView caches and blits the result.
// Evo.Paint collects the painters so WorldView can reach them.
(function (Evo) {
  'use strict';
  const { TAU } = Evo.util;

  // Seasonal palettes for the ground and plants (index: 0 spring, 1 summer, 2 autumn, 3 winter)
  const GROUND = [
    { grass: [118, 194, 82], dark: [70, 142, 56], light: [178, 226, 118], tufts: ['#6cbc4c', '#8fd162', '#58a444'], flowers: ['#fff7f0', '#ffd85e', '#f7a8c8', '#c9b8ff'] },
    { grass: [86, 166, 64], dark: [48, 114, 46], light: [146, 204, 92], tufts: ['#4f9f3e', '#6fb84e', '#3f8a36'], flowers: ['#ffe066', '#ffffff', '#8ab8ff', '#ff9f6b'] },
    { grass: [168, 158, 76], dark: [112, 104, 50], light: [212, 198, 112], tufts: ['#b8a150', '#9c9446', '#d0b664'], litter: ['#d8742e', '#c2452d', '#e2a93b', '#a8552a'] },
    { grass: [150, 150, 122], dark: [110, 108, 90], light: [190, 186, 150], tufts: ['#c9b98a', '#ad9f74'] },
  ];
  const SNOW = { top: '#f8fbff', body: '#e8f0f7', shade: '#bfd0e2', sparkle: '#ffffff' };
  const ROCK_TONES = [[160, 154, 146], [170, 150, 128], [150, 150, 156]];

  // A circle as a subpath (for batching many into one fill)
  function circle(g, x, y, r) { g.moveTo(x + r, y); g.arc(x, y, r, 0, TAU); }

  Evo.Paint = { GROUND, SNOW, ROCK_TONES, circle };
})(globalThis.Evo);
