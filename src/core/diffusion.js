// Shared diffusion step for every chemical field (scent in the world, transmitters in the brain).
(function (Evo) {
  'use strict';

  // One explicit step of 5-point Laplacian diffusion with reflecting edges, followed by decay.
  //   grid, next: planar Float32Arrays of cols*rows (next is scratch space; grid is updated in place)
  //   rate: fraction of the neighbour difference that flows per step (0..1)
  //   keep: fraction that survives decay this step (1 - decay)
  //   eps: values below this snap to zero, so empty space stays exactly empty
  //   solid (optional): Uint8Array, 1 where a cell is solid ground. Nothing flows into solid cells
  //   (they reflect, like the grid's edges) and they stay empty.
  Evo.diffuse = function diffuse(grid, next, cols, rows, rate, keep, eps, solid = null) {
    const k = 0.25 * rate;
    for (let r = 0; r < rows; r++) {
      const row = r * cols;
      const up = (r > 0 ? r - 1 : 0) * cols;
      const dn = (r < rows - 1 ? r + 1 : r) * cols;
      for (let c = 0; c < cols; c++) {
        const i = row + c;
        if (solid && solid[i]) { next[i] = 0; continue; }
        const v = grid[i];
        const iu = up + c, id = dn + c, il = row + (c > 0 ? c - 1 : 0), ir = row + (c < cols - 1 ? c + 1 : c);
        let sum;
        if (solid) {
          sum = (solid[iu] ? v : grid[iu]) + (solid[id] ? v : grid[id]) + (solid[il] ? v : grid[il]) + (solid[ir] ? v : grid[ir]);
        } else {
          sum = grid[iu] + grid[id] + grid[il] + grid[ir];
        }
        const nv = (v + k * (sum - 4 * v)) * keep;
        next[i] = nv < eps ? 0 : nv;
      }
    }
    grid.set(next);
  };
})(globalThis.Evo);
