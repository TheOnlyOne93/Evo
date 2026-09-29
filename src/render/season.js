// Season indices by name, taken from Evo.SEASONS (src/sim/constants.js): Evo.SEASON.SPRING is 0,
// SUMMER 1, AUTUMN 2, WINTER 3, the order world.season.index follows. Renderers index their
// seasonal palettes by these and compare `si === WINTER` rather than a bare number.
(function (Evo) {
  'use strict';
  Evo.SEASON = Object.freeze(Object.fromEntries(Evo.SEASONS.map((s, i) => [s.key, i])));
  Evo.SEASON_COUNT = Evo.SEASONS.length;
})(globalThis.Evo);
