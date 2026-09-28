// Shared diffusion step for every chemical field (scent in the world, transmitters in the brain).
(function (Evo) {
  'use strict';

  // One explicit step of 5-point Laplacian diffusion with reflecting edges, followed by decay.
  //   grid, next: planar Float32Arrays of cols*rows (next is scratch space; grid is updated in place)
  //   rate: fraction of the neighbour difference that flows per step (0..1)
  //   keep: fraction that survives decay this step (1 - decay)
  //   eps: values below this snap to zero, so empty space stays exactly empty
  Evo.diffuse = function diffuse(grid, next, cols, rows, rate, keep, eps) {
    const k = 0.25 * rate;
    for (let r = 0; r < rows; r++) {
      const row = r * cols;
      const up = (r > 0 ? r - 1 : 0) * cols;
      const dn = (r < rows - 1 ? r + 1 : r) * cols;
      for (let c = 0; c < cols; c++) {
        const v = grid[row + c];
        const left = grid[row + (c > 0 ? c - 1 : 0)];
        const right = grid[row + (c < cols - 1 ? c + 1 : c)];
        const nv = (v + k * (grid[up + c] + grid[dn + c] + left + right - 4 * v)) * keep;
        next[row + c] = nv < eps ? 0 : nv;
      }
    }
    grid.set(next);
  };
})(globalThis.Evo);
