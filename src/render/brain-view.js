// The followed creature's brain, drawn two ways. "Regions": each brain region as a labelled box of
// its cells (senses at the top, muscles at the bottom, left cells on the left), like a lab chart.
// "Anatomy": every neuron where it really sits (senses at the front, the world's left on the left),
// with the reward and punishment learning signal as a coloured haze. Either way neurons glow as they
// fire, spikes travel along the axons, and only recently used connections are drawn (or all of them).
// Also a small oscilloscope for one neuron's membrane potential.
(function (Evo) {
  'use strict';
  const { LOBE_INFO } = Evo;
  const { TAU } = Evo.util;

  // Regions labelled on the anatomy map (the rest are identified by tapping a neuron)
  const LABELLED = ['sight', 'smell', 'touch', 'needs', 'feelings', 'cortex', 'side', 'central', 'motor', 'stem'];
  const GUTTER = 74; // Room for the region names on the left of the anatomy map
  const PAD = 16;    // Anatomy map margin

  // Regions view: which band of rows each region goes in, how many rows of cells it has, and which
  // regions keep their cells in gene order (the rest are laid out by where the cells sit: left on the left)
  const BAND = { sight: 0, smell: 0, hearing: 0, touch: 0, taste: 0, near: 0, needs: 1, feelings: 1, cortex: 2, side: 2, central: 2, motor: 3, stem: 3 };
  const ROWS = { sight: 2, smell: 2, hearing: 2, touch: 1, taste: 1, near: 1, needs: 3, feelings: 2, cortex: 3, side: 2, central: 4, motor: 1, stem: 2 };
  const IN_ORDER = new Set(['needs', 'feelings', 'taste', 'near']);
  const RECENT = 20; // Ticks a used connection stays drawn

  const parentOf = lobe => lobe.replace(/^dup\d+_/, '');
  const bandOf = lobe => {
    if (LOBE_INFO[lobe]) return BAND[lobe];
    const p = parentOf(lobe);
    return LOBE_INFO[p] && LOBE_INFO[p].sensory ? 1 : p === 'motor' || p === 'stem' ? 3 : 2;
  };

  class BrainView {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.brain = null;
      this.mode = 'regions';  // 'regions' | 'anatomy'
      this.allWiring = false; // Draw every connection, not just recently used ones
      this.ticksRun = 1;      // Ticks run since the last frame: a neuron is lit if it fired in any of them
      this.probed = -1;       // Index of the neuron being inspected, or -1
      this.region = null;     // Region (lobe id) being inspected, or null
      this.marks = { attended: -1, winner: -1 }; // Cells to point out: what it looks at, what it does
      this.screen = null;     // Float32Array of screen x, y per neuron
      this.resize();
    }

    resize() {
      const { width, height } = Evo.fitCanvas(this.canvas, this.ctx, 240, 180);
      this.width = width;
      this.height = height;
      this.layoutFor = null;
    }

    setBrain(brain) {
      if (brain === this.brain) return;
      this.brain = brain;
      this.probed = -1;
      this.region = null;
      this.layoutFor = null;
    }

    setMode(mode) {
      this.mode = mode;
      this.layoutFor = null;
    }

    layout() {
      const b = this.brain;
      if (this.layoutFor === b && this.layoutMode === this.mode && this.screen && this.screen.length === b.N * 2) return;
      this.layoutFor = b;
      this.layoutMode = this.mode;
      this.screen = new Float32Array(b.N * 2);
      this.colors = new Array(b.N);
      const copy = Evo.theme.color('--copy');
      for (const n of b.neurons) this.colors[n.index] = n.copyOf !== null ? copy : LOBE_INFO[n.parentLobe].color;
      if (this.mode === 'anatomy') this.layoutAnatomy(); else this.layoutRegions();
    }

    // Brain coordinates to the canvas: x across, y (front to back) downward
    layoutAnatomy() {
      const b = this.brain, w = this.width - PAD * 2 - GUTTER, h = this.height - PAD * 2 - 10;
      for (const n of b.neurons) {
        this.screen[n.index * 2] = GUTTER + PAD + n.pos[0] * w;
        this.screen[n.index * 2 + 1] = PAD + 8 + n.pos[1] * h;
      }
      this.cellR = 1.8;
      // Region names in the left margin, level with each region's middle, nudged apart so they never overlap
      const attention = (b.duplicatesOf.sight || []).filter(l => Evo.text.isAttention(b, l));
      this.labels = [...LABELLED, ...attention].filter(l => b.lobes[l]).map(l => {
        const idx = b.lobes[l];
        let y = 0;
        for (const i of idx) y += this.screen[i * 2 + 1];
        return { lobe: l, text: Evo.text.regionName(b, l), y: y / idx.length, color: LOBE_INFO[l] ? LOBE_INFO[l].color : Evo.theme.color('--copy') };
      }).sort((a, z) => a.y - z.y);
      for (let k = 1; k < this.labels.length; k++) this.labels[k].y = Math.max(this.labels[k].y, this.labels[k - 1].y + 13);
      this.boxes = null;
    }

    // Each region as a box of cells in rows; boxes flow into four bands (senses; drives, feelings
    // and attention; thinking; movement), with the cell spacing chosen so everything fits
    layoutRegions() {
      const b = this.brain, ctx = this.ctx;
      ctx.font = "10.5px 'Atkinson Hyperlegible', system-ui, sans-serif";
      const regions = Object.keys(b.lobes).map(lobe => {
        const cells = b.lobes[lobe].slice(), parent = parentOf(lobe);
        const rows = Math.max(1, Math.min(ROWS[parent] || 2, cells.length)), cols = Math.ceil(cells.length / rows);
        let order = cells;
        if (!IN_ORDER.has(parent)) {
          const P = i => b.neurons[i].pos;
          const byY = cells.sort((i, j) => P(i)[1] - P(j)[1]);
          order = [];
          for (let r = 0; r < rows; r++) order.push(...byY.slice(r * cols, (r + 1) * cols).sort((i, j) => P(i)[0] - P(j)[0]));
        }
        const name = Evo.text.regionName(b, lobe);
        return { lobe, name, order, rows, cols, band: bandOf(lobe), textW: ctx.measureText(name).width + 18,
          color: LOBE_INFO[lobe] ? LOBE_INFO[lobe].color : Evo.theme.color('--copy') };
      }).sort((a, z) => a.band - z.band);
      const W = this.width - 8, H = this.height - 6, GAP = 6, TITLE = 15;
      const pack = p => {
        let x = 0, y = 0, rowH = 0, band = -1, row = [];
        const rowsOut = [];
        const flush = () => { if (row.length) rowsOut.push({ boxes: row, width: x - GAP }); row = []; y += rowH + (rowH ? GAP : 0); x = 0; rowH = 0; };
        for (const r of regions) {
          const w = Math.max(r.cols * p + 8, r.textW), h = TITLE + r.rows * p + 5;
          if (r.band !== band || (x > 0 && x + w > W)) { flush(); band = r.band; }
          row.push({ ...r, x, y, w, h });
          x += w + GAP;
          rowH = Math.max(rowH, h);
        }
        flush();
        return { rows: rowsOut, height: y - GAP, fits: rowsOut.every(rw => rw.width <= W) };
      };
      let p = 18, packed = pack(p);
      while (p > 5 && (packed.height > H || !packed.fits)) { p -= 0.5; packed = pack(p); }
      // Spread the bands down the canvas and centre each row
      const spare = Math.max(0, H - packed.height) / Math.max(1, packed.rows.length + 1);
      this.boxes = [];
      packed.rows.forEach((row, k) => {
        const dx = 4 + (W - row.width) / 2, dy = 3 + spare * (k + 1);
        for (const bx of row.boxes) {
          bx.x += dx; bx.y += dy;
          const cx = bx.x + (bx.w - bx.cols * p) / 2;
          bx.order.forEach((i, c) => {
            this.screen[i * 2] = cx + ((c % bx.cols) + 0.5) * p;
            this.screen[i * 2 + 1] = bx.y + TITLE + (Math.floor(c / bx.cols) + 0.5) * p;
          });
          this.boxes.push(bx);
        }
      });
      this.cellR = Math.min(4, p * 0.28);
      this.labels = null;
    }

    // What is at a point: { neuron } or { region } (or null)
    pickAt(x, y) {
      if (!this.brain) return null;
      this.layout();
      let best = -1, bestD = this.mode === 'regions' ? 12 : 18;
      for (let i = 0; i < this.brain.N; i++) {
        const d = Math.hypot(this.screen[i * 2] - x, this.screen[i * 2 + 1] - y);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best >= 0) return { neuron: best };
      if (this.boxes) {
        const bx = this.boxes.find(q => x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h);
        return bx ? { region: bx.lobe } : null;
      }
      if (this.labels && x < GUTTER) {
        const l = this.labels.find(q => Math.abs(q.y - y) < 8);
        return l ? { region: l.lobe } : null;
      }
      return null;
    }

    // Tap: inspect a neuron or a region (tapping the same one again lets go)
    tapAt(x, y) {
      const hit = this.pickAt(x, y);
      if (hit && hit.neuron !== undefined) { this.probed = hit.neuron === this.probed ? -1 : hit.neuron; this.region = null; }
      else if (hit && hit.region) { this.region = hit.region === this.region ? null : hit.region; this.probed = -1; }
      else { this.probed = -1; this.region = null; }
    }

    // Reward and punishment learning signal as a soft image under the neurons (anatomy only)
    drawChemistry(ctx) {
      const b = this.brain, n = Evo.BRAIN.CHEM_SIZE;
      if (!this.chemCanvas) {
        this.chemCanvas = document.createElement('canvas');
        this.chemCanvas.width = n; this.chemCanvas.height = n;
        this.chemCtx = this.chemCanvas.getContext('2d');
        this.chemImage = this.chemCtx.createImageData(n, n);
        this.chemColors = ['--joy', '--stress'].map(t => Evo.theme.rgb(t));
      }
      const px = this.chemImage.data, [cDA, cST] = this.chemColors;
      const [DA, ST] = b.chem;
      for (let i = 0; i < n * n; i++) {
        const d = DA[i], s = ST[i], total = d + s, o = i * 4;
        if (total > 0.003) {
          for (let k = 0; k < 3; k++) px[o + k] = (cDA[k] * d + cST[k] * s) / total;
          px[o + 3] = Math.min(150, Math.sqrt(total) * 220);
        } else px[o + 3] = 0;
      }
      this.chemCtx.putImageData(this.chemImage, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.chemCanvas, GUTTER + PAD, PAD + 8, this.width - PAD * 2 - GUTTER, this.height - PAD * 2 - 10);
    }

    drawTissue(ctx) {
      const pad = 10, x0 = GUTTER + pad, mid = (x0 + this.width - pad) / 2;
      ctx.fillStyle = 'rgba(20, 38, 44, 0.55)';
      ctx.strokeStyle = 'rgba(64, 96, 104, 0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x0, pad, this.width - pad - x0, this.height - pad * 2, 26) : ctx.rect(x0, pad, this.width - pad - x0, this.height - pad * 2);
      ctx.fill(); ctx.stroke();
      ctx.setLineDash([3, 5]);
      ctx.beginPath(); ctx.moveTo(mid, pad + 4); ctx.lineTo(mid, this.height - pad - 4); ctx.stroke();
      ctx.setLineDash([]);
      this.drawChemistry(ctx);
    }

    drawBoxes(ctx, T) {
      for (const bx of this.boxes) {
        const on = bx.lobe === this.region;
        ctx.fillStyle = on ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.025)';
        ctx.strokeStyle = on ? bx.color : T.rgba('--line', 1);
        ctx.lineWidth = on ? 1.5 : 1;
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(bx.x, bx.y, bx.w, bx.h, 7) : ctx.rect(bx.x, bx.y, bx.w, bx.h);
        ctx.fill(); ctx.stroke();
      }
    }

    drawTitles(ctx, T) {
      ctx.font = "10.5px 'Atkinson Hyperlegible', system-ui, sans-serif";
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      if (this.boxes) {
        for (const bx of this.boxes) {
          ctx.fillStyle = bx.color;
          ctx.beginPath(); ctx.arc(bx.x + 7, bx.y + 8, 2.6, 0, TAU); ctx.fill();
          ctx.fillStyle = T.rgba('--text', bx.lobe === this.region ? 1 : 0.72);
          ctx.fillText(bx.name, bx.x + 13, bx.y + 8.5);
        }
      } else {
        ctx.font = "11px 'Atkinson Hyperlegible', system-ui, sans-serif";
        for (const l of this.labels) {
          ctx.fillStyle = l.color;
          ctx.beginPath(); ctx.arc(8, l.y, 3, 0, TAU); ctx.fill();
          ctx.fillStyle = T.rgba('--text', l.lobe === this.region ? 1 : 0.7);
          ctx.fillText(l.text, 15, l.y);
        }
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = T.rgba('--text', 0.4);
        ctx.textAlign = 'left'; ctx.fillText('← left', GUTTER + 14, this.height - 4);
        ctx.textAlign = 'right'; ctx.fillText('right →', this.width - 14, this.height - 4);
      }
      ctx.textBaseline = 'alphabetic';
    }

    // With a region picked, only connections touching it are shown (the recent-use view and its spikes)
    touchesRegion(s) {
      if (!this.region) return true;
      const { sSrc, sDst } = this.brain, ns = this.brain.neurons;
      return ns[sSrc[s]].lobe === this.region || ns[sDst[s]].lobe === this.region;
    }

    // Connections: the probed neuron's, else recently used ones (or all), fading with time since use
    drawWiring(ctx, T) {
      const b = this.brain, S = this.screen, probe = this.probed, now = b.tickCount;
      const { sSrc, sDst, sW, sActive, sFlags } = b;
      const line = s => { ctx.moveTo(S[sSrc[s] * 2], S[sSrc[s] * 2 + 1]); ctx.lineTo(S[sDst[s] * 2], S[sDst[s] * 2 + 1]); };
      if (probe >= 0) {
        for (let s = 0; s < b.S; s++) {
          if (sSrc[s] !== probe && sDst[s] !== probe) continue;
          const w = sW[s], a = 0.35 + Math.min(0.6, Math.abs(w) * 0.5);
          ctx.strokeStyle = w >= 0 ? T.rgba(sSrc[s] === probe ? '--energy' : '--water', a) : T.rgba('--stress', a);
          ctx.lineWidth = 0.6 + Math.min(2.4, Math.abs(w) * 1.6);
          ctx.beginPath(); line(s); ctx.stroke();
        }
        return;
      }
      if (this.allWiring) {
        const batches = [
          [T.rgba('--water', 0.07), 0.6, s => sW[s] > 0 && !(sFlags[s] & Evo.BRAIN.SPROUTED)],
          [T.rgba('--stress', 0.09), 0.6, s => sW[s] < 0 && !(sFlags[s] & Evo.BRAIN.SPROUTED)],
          [T.rgba('--accent', 0.45), 1.1, s => !!(sFlags[s] & Evo.BRAIN.SPROUTED)]
        ];
        for (const [style, width, test] of batches) {
          ctx.strokeStyle = style; ctx.lineWidth = width;
          ctx.beginPath();
          for (let s = 0; s < b.S; s++) if (test(s)) line(s);
          ctx.stroke();
        }
        return;
      }
      // Recently used connections in three strengths × excitatory / inhibitory, one path each: most
      // are weak, so only the strong ones stand out (with a region picked, only the ones touching it)
      const bins = [[0.4, Infinity, 0.6, 1.3], [0.15, 0.4, 0.26, 0.9], [0, 0.15, 0.07, 0.7]];
      for (const [lo, hi, alpha, width] of bins) {
        for (const excite of [true, false]) {
          ctx.strokeStyle = T.rgba(excite ? '--water' : '--stress', alpha);
          ctx.lineWidth = width;
          ctx.beginPath();
          for (let s = 0; s < b.S; s++) {
            const w = sW[s], m = w < 0 ? -w : w;
            if (now - sActive[s] > RECENT || m < lo || m >= hi || (w >= 0) !== excite) continue;
            if (!this.touchesRegion(s)) continue;
            line(s);
          }
          ctx.stroke();
        }
      }
    }

    // A ring around a cell with a short word beside it
    mark(ctx, T, i, token, word) {
      if (i < 0) return;
      const x = this.screen[i * 2], y = this.screen[i * 2 + 1], r = this.cellR + 4.5;
      ctx.strokeStyle = T.color(token); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
      if (!word) return;
      ctx.font = "700 10.5px 'Atkinson Hyperlegible', system-ui, sans-serif";
      const w = ctx.measureText(word).width + 8, right = x + r + 3 + w < this.width;
      const lx = right ? x + r + 3 : x - r - 3 - w;
      ctx.fillStyle = 'rgba(10, 22, 25, 0.88)';
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(lx, y - 7, w, 14, 7) : ctx.rect(lx, y - 7, w, 14);
      ctx.fill();
      ctx.fillStyle = T.color(token);
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(word, lx + 4, y + 0.5);
      ctx.textBaseline = 'alphabetic';
    }

    render() {
      const b = this.brain, ctx = this.ctx, T = Evo.theme;
      ctx.clearRect(0, 0, this.width, this.height);
      if (!b) return;
      this.layout();
      const S = this.screen, probe = this.probed;
      if (this.boxes) this.drawBoxes(ctx, T); else this.drawTissue(ctx);
      if (b.adjacencyDirty) b.rebuildAdjacency();
      this.drawWiring(ctx, T);

      // Spikes in flight: a dot for each spike still travelling down an axon (all of them when every
      // connection is drawn, else those on the connections drawn above)
      const { sSrc, sDst, sDelay, sW, hist } = b, weak = this.allWiring ? -1 : 0.15;
      ctx.fillStyle = T.color('--pulse');
      ctx.beginPath();
      for (let s = 0; s < b.S; s++) {
        if (probe >= 0 ? sSrc[s] !== probe && sDst[s] !== probe
          : Math.abs(sW[s]) < weak || !this.allWiring && !this.touchesRegion(s)) continue;
        const h = hist[sSrc[s]], d = sDelay[s];
        if (!(h & ((1 << d) - 2))) continue;
        const x0 = S[sSrc[s] * 2], y0 = S[sSrc[s] * 2 + 1], x1 = S[sDst[s] * 2], y1 = S[sDst[s] * 2 + 1];
        for (let k = 1; k < d; k++) {
          if ((h >>> k) & 1) { const t = k / d; ctx.rect(x0 + (x1 - x0) * t - 1, y0 + (y1 - y0) * t - 1, 2, 2); }
        }
      }
      ctx.fill();

      // Neurons: region colour, white when firing, bigger when busy; outside a picked region, dimmed
      const base = this.cellR, region = this.region;
      // Lit if it fired in any tick since the last frame (bit 0 of hist is this tick)
      const firedMask = (1 << Math.min(Math.max(1, this.ticksRun), 31)) - 1;
      for (let i = 0; i < b.N; i++) {
        const fired = hist[i] & firedMask;
        const r = fired ? base * 1.9 : base + Math.min(base * 0.9, b.rate[i] * 6);
        ctx.fillStyle = fired ? '#ffffff' : this.colors[i];
        ctx.globalAlpha = (fired ? 1 : 0.5 + Math.min(0.5, b.rate[i] * 4)) * (region && b.neurons[i].lobe !== region ? 0.3 : 1);
        ctx.beginPath(); ctx.arc(S[i * 2], S[i * 2 + 1], r, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
      this.drawTitles(ctx, T);
      this.mark(ctx, T, this.marks.attended, '--accent', 'looking');
      this.mark(ctx, T, this.marks.winner, '--energy', 'doing');
      if (probe >= 0) this.mark(ctx, T, probe, '--text', '');
    }
  }

  // One neuron's membrane potential over the last couple of seconds
  class VoltageScope {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.history = new Float32Array(120).fill(-70);
      this.head = 0;
      this.resize();
    }

    resize() {
      const { width, height } = Evo.fitCanvas(this.canvas, this.ctx, 160, 24);
      this.width = width;
      this.height = height;
    }

    clear() {
      this.history.fill(-70);
    }

    push(v) {
      this.history[this.head] = v;
      this.head = (this.head + 1) % this.history.length;
    }

    // -80 mV at the bottom, +30 mV (a spike) at the top; the dashed line is the firing threshold
    render(threshold) {
      const ctx = this.ctx, pad = 3, h = this.height - pad * 2, n = this.history.length;
      const y = v => pad + h - Math.max(0, Math.min(h, ((v + 80) / 110) * h));
      ctx.clearRect(0, 0, this.width, this.height);
      if (threshold !== undefined) {
        ctx.strokeStyle = Evo.theme.rgba('--muted', 0.5); ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, y(threshold)); ctx.lineTo(this.width, y(threshold)); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.strokeStyle = Evo.theme.color('--water');
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let k = 0; k < n; k++) {
        const v = this.history[(this.head + k) % n], px = k * this.width / (n - 1);
        if (k === 0) ctx.moveTo(px, y(v)); else ctx.lineTo(px, y(v));
      }
      ctx.stroke();
    }
  }

  Object.assign(Evo, { BrainView, VoltageScope });
})(globalThis.Evo);
