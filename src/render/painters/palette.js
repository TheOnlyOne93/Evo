// Palettes and small helpers shared by the static-art painters (src/render/painters/*). Each
// painter draws in world units into an offscreen sprite; WorldView caches and blits the result.
// Evo.Paint (started in canvas.js) collects the painters so WorldView can reach them.
(function (Evo) {
  'use strict';
  const { TAU } = Evo.util;
  const { circle } = Evo.Paint;

  // Seasonal palettes for the ground and plants, indexed by Evo.SEASON (spring, summer, autumn, winter)
  const GROUND = [
    { grass: [118, 194, 82], dark: [70, 142, 56], light: [178, 226, 118], tufts: ['#6cbc4c', '#8fd162', '#58a444'], flowers: ['#fff7f0', '#ffd85e', '#f7a8c8', '#c9b8ff'] },
    { grass: [86, 166, 64], dark: [48, 114, 46], light: [146, 204, 92], tufts: ['#4f9f3e', '#6fb84e', '#3f8a36'], flowers: ['#ffe066', '#ffffff', '#8ab8ff', '#ff9f6b'] },
    { grass: [168, 158, 76], dark: [112, 104, 50], light: [212, 198, 112], tufts: ['#b8a150', '#9c9446', '#d0b664'], litter: ['#d8742e', '#c2452d', '#e2a93b', '#a8552a'] },
    { grass: [150, 150, 122], dark: [110, 108, 90], light: [190, 186, 150], tufts: ['#c9b98a', '#ad9f74'] },
  ];
  // Moss on wood and stone, per season (null in winter, when snow covers it)
  const MOSS = {
    log: ['#79b04a', '#5f9a3e', '#8f8a3c', null],                   // the grub log
    rock: ['rgba(96,150,62,0.8)', 'rgba(96,150,62,0.8)', 'rgba(150,140,60,0.75)', null],
  };
  // Colours of small details, per season (null in a season that doesn't draw the detail)
  const DETAIL = {
    pondWeed: ['#3f7a4a', '#3f7a4a', '#6f7a3a', null],
    cliffStone: [[166, 150, 130], [166, 150, 130], [166, 150, 130], [156, 152, 152]],
    cliffVine: ['#4f8c3e', '#4f8c3e', '#a0703a', null],
    cliffVineLeaf: ['#6cae4e', '#6cae4e', '#c8783a', null],
    cliffFern: ['#5a9a48', '#5a9a48', '#a88a3e', null],
    cliffBush: [[[62, 128, 64], [96, 162, 80]], [[62, 128, 64], [96, 162, 80]], [[176, 96, 48], [214, 150, 64]], [[120, 108, 100], [140, 128, 118]]],
    cattail: ['#7a4a2a', '#7a4a2a', '#7a4a2a', '#9a7a5c'],
    thornLeaf: [                                                    // [dark, mid, light]; bare in winter
      [[44, 38, 60], [74, 58, 96], [126, 102, 158]], [[44, 38, 60], [74, 58, 96], [126, 102, 158]],
      [[84, 30, 52], [134, 46, 70], [196, 96, 104]], null,
    ],
    lilyPad: ['#3f8f4a', '#3f8f4a', '#a8a04a', null],              // thawing ponds show spring's
    lilyPadLight: ['#62b060', '#62b060', '#c6b85c', null],
    lilyFlower: ['#ffd3e4', '#fff5fa', null, null],
    seedHead: ['#b39a52', '#b39a52', '#b39a52', '#b5a882'],
  };
  const SNOW = { top: '#f8fbff', body: '#e8f0f7', shade: '#bfd0e2' };
  const ROCK_TONES = [[160, 154, 146], [170, 150, 128], [150, 150, 156]];

  // Spring and summer: flowers, sprouts, pollen and fireflies
  const isWarm = si => si <= Evo.SEASON.SUMMER;

  // A five-petalled flower as circle subpaths: petals of radius pr, r from (x, y), the first at
  // angle a0 and the rest evenly spaced around it.
  function flower(g, x, y, r, pr, a0 = 0) {
    for (let q = 0; q < 5; q++) {
      const a = a0 + q * (TAU / 5);
      circle(g, x + Math.cos(a) * r, y + Math.sin(a) * r, pr);
    }
  }

  Object.assign(Evo.Paint, { GROUND, MOSS, DETAIL, SNOW, ROCK_TONES, isWarm, flower });
})(globalThis.Evo);
