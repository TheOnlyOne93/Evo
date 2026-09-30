// The diffusion step for scent in the world's air (one grid per odour channel).
(function (Evo) {
  'use strict';

  // One explicit step of 5-point Laplacian diffusion with reflecting edges, followed by decay.
  //   grid, next: planar Float32Arrays of cols*rows (next is scratch space; grid is updated in place)
  //   rate: fraction of the neighbour difference that flows per step (0..1)
  //   keep: fraction that survives decay this step (1 - decay)
  //   eps: values below this snap to zero, so empty space stays exactly empty
  //   solid: Uint8Array, 1 where a cell is solid ground. Nothing flows into solid cells
  //   (they reflect, like the grid's edges) and they stay empty.
  //   box: { r0, r1, c0, c1 }, inclusive rows and columns holding every non-zero cell, or null when
  //   the grid is all zero. Only the box and a one-cell margin are swept: a cell further out has
  //   only zero neighbours, so it would stay exactly zero anyway.
  // Returns the box of what is left (the same object, updated), or null when nothing is.
  Evo.diffuse = function diffuse(grid, next, cols, rows, rate, keep, eps, solid, box) {
    if (!box) return null;
    const k = 0.25 * rate;
    const r0 = Math.max(0, box.r0 - 1), r1 = Math.min(rows - 1, box.r1 + 1);
    const c0 = Math.max(0, box.c0 - 1), c1 = Math.min(cols - 1, box.c1 + 1);
    let nr0 = rows, nr1 = -1, nc0 = cols, nc1 = -1;
    for (let r = r0; r <= r1; r++) {
      const row = r * cols;
      const up = (r > 0 ? r - 1 : 0) * cols;
      const dn = (r < rows - 1 ? r + 1 : r) * cols;
      for (let c = c0; c <= c1; c++) {
        const i = row + c;
        if (solid[i]) { next[i] = 0; continue; }
        const v = grid[i];
        const iu = up + c, id = dn + c, il = row + (c > 0 ? c - 1 : 0), ir = row + (c < cols - 1 ? c + 1 : c);
        const sum = (solid[iu] ? v : grid[iu]) + (solid[id] ? v : grid[id]) + (solid[il] ? v : grid[il]) + (solid[ir] ? v : grid[ir]);
        const nv = (v + k * (sum - 4 * v)) * keep;
        if (nv < eps) { next[i] = 0; continue; }
        next[i] = nv;
        if (r < nr0) nr0 = r;
        nr1 = r;
        if (c < nc0) nc0 = c;
        if (c > nc1) nc1 = c;
      }
    }
    // Write back only after the sweep: each cell above read its neighbours' old values
    for (let r = r0; r <= r1; r++) {
      for (let i = r * cols + c0, end = r * cols + c1; i <= end; i++) grid[i] = next[i];
    }
    if (nr1 < 0) return null;
    box.r0 = nr0; box.r1 = nr1; box.c0 = nc0; box.c1 = nc1;
    return box;
  };
})(globalThis.Evo);
