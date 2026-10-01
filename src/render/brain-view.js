// The followed creature's brain, drawn as one map: the brain's own map, where every region is a box
// (a faint tint of the region's colour, its name above its top left corner) and every neuron sits
// at its spot in its box. Senses are at the front (top), muscles at the back (bottom), and the
// world's left is on the left; a two-sided region has a box on each side, mirror images of each other.
// The reward and punishment learning signal is a coloured haze under it. Neurons glow as they fire,
// spikes travel along the axons, and only recently used connections are drawn (or all of them).
// Also a small oscilloscope for one neuron's membrane potential.
(function (Evo) {
  'use strict';
  const { LOBE_INFO } = Evo;
  const { TAU } = Evo.util;

  const PAD = 12;         // Map margin left, right and (with the hints) at the bottom
  const TOP = 16;         // Room above the map for the names of the boxes at its top edge
  const HINTS = 18;       // Room under the map for the "left" and "right" hints
  const TRAIL_TICKS = 20; // Ticks a used connection stays drawn
  const SCOPE_V_MIN = -80, SCOPE_V_MAX = 30; // the scope's range (mV): below rest up to a spike's peak

  // A canvas font in the UI's typeface
  const font = (size, weight = '') => `${weight ? weight + ' ' : ''}${size}px ${Evo.theme.color('--ui')}`;

  class BrainView {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.brain = null;
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

    // Brain map coordinates (0 to 1) to the canvas: x across, y (front to back) downward, the map
    // stretched to fill it. Also works out where each region's box(es) fall.
    layout() {
      const b = this.brain;
      if (this.layoutFor === b && this.screen && this.screen.length === b.N * 2) return;
      this.layoutFor = b;
      const m = this.map = { x: PAD, y: TOP, w: this.width - PAD * 2, h: this.height - TOP - HINTS };
      this.screen = new Float32Array(b.N * 2);
      this.colors = new Array(b.N);
      for (const n of b.neurons) {
        this.colors[n.index] = LOBE_INFO[n.lobe].color;
        this.screen[n.index * 2] = m.x + n.pos[0] * m.w;
        this.screen[n.index * 2 + 1] = m.y + n.pos[1] * m.h;
      }
      this.cellR = 1.8;
      // The boxes (the left one first; a two-sided region's right box is its mirror image)
      this.boxes = [];
      for (const lobe of Object.keys(b.lobes)) {
        const [x0, y0, x1, y1] = b.boxes[lobe], info = LOBE_INFO[lobe];
        const rect = (a, z) => ({ lobe, color: info.color, x: m.x + a * m.w, y: m.y + y0 * m.h, w: (z - a) * m.w, h: (y1 - y0) * m.h });
        this.boxes.push(rect(x0, x1));
        if (info.sided) this.boxes.push(rect(1 - x1, 1 - x0));
      }
    }

    // What is at a point: { neuron } or { region } (or null)
    pickAt(x, y) {
      if (!this.brain) return null;
      this.layout();
      let best = -1, bestD = 18;
      for (let i = 0; i < this.brain.N; i++) {
        const d = Math.hypot(this.screen[i * 2] - x, this.screen[i * 2 + 1] - y);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best >= 0) return { neuron: best };
      const bx = this.boxes.find(q => x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h);
      return bx ? { region: bx.lobe } : null;
    }

    // Tap: inspect a neuron or a region (tapping the same one again lets go)
    tapAt(x, y) {
      const hit = this.pickAt(x, y);
      if (hit && hit.neuron !== undefined) { this.probed = hit.neuron === this.probed ? -1 : hit.neuron; this.region = null; }
      else if (hit && hit.region) { this.region = hit.region === this.region ? null : hit.region; this.probed = -1; }
      else { this.probed = -1; this.region = null; }
    }

    // Reward and punishment learning signal as a soft image under the neurons
    drawChemistry(ctx) {
      const b = this.brain, n = Evo.BRAIN.CHEM_SIZE;
      if (!this.chemCanvas) {
        this.chemCanvas = document.createElement('canvas');
        this.chemCanvas.width = n; this.chemCanvas.height = n;
        this.chemCtx = this.chemCanvas.getContext('2d');
        this.chemImage = this.chemCtx.createImageData(n, n);
        this.chemColors = ['--joy', '--stress'].map(t => Evo.theme.rgbOf(t));
      }
      const px = this.chemImage.data, [cDA, cST] = this.chemColors;
      const [DA, ST] = b.chemImages;
      for (let i = 0; i < n * n; i++) {
        const d = DA[i], s = ST[i], total = d + s, o = i * 4;
        if (total > 0.003) {
          for (let k = 0; k < 3; k++) px[o + k] = (cDA[k] * d + cST[k] * s) / total;
          px[o + 3] = Math.min(150, Math.sqrt(total) * 220);
        } else px[o + 3] = 0;
      }
      this.chemCtx.putImageData(this.chemImage, 0, 0);
      ctx.imageSmoothingEnabled = true;
      const m = this.map;
      ctx.drawImage(this.chemCanvas, m.x, m.y, m.w, m.h);
    }

    // Under the cells: the learning haze, every region's box, and the dashed midline
    drawMap(ctx, T) {
      this.drawChemistry(ctx);
      for (const bx of this.boxes) {
        const on = bx.lobe === this.region;
        ctx.fillStyle = bx.color;
        ctx.strokeStyle = bx.color;
        ctx.lineWidth = on ? 1.5 : 1;
        ctx.beginPath();
        ctx.roundRect(bx.x, bx.y, bx.w, bx.h, 4);
        ctx.globalAlpha = on ? 0.2 : 0.09;
        ctx.fill();
        ctx.globalAlpha = on ? 1 : 0.55;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = T.rgba('--muted', 0.35);
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      const mid = this.map.x + this.map.w / 2;
      ctx.beginPath(); ctx.moveTo(mid, 4); ctx.lineTo(mid, this.height - HINTS + 6); ctx.stroke();
      ctx.setLineDash([]);
    }

    // Region names just above the top left corner of each region's (left) box, each on a dark tag so
    // it reads over the glow and the wiring, and the left and right hints
    drawTitles(ctx, T) {
      ctx.font = font(10);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      const named = new Set(), tag = T.rgba('--pond-deep', 0.8);
      for (const bx of this.boxes) {
        if (named.has(bx.lobe)) continue;
        named.add(bx.lobe);
        const name = Evo.text.regionName(this.brain, bx.lobe);
        ctx.fillStyle = tag;
        ctx.beginPath(); ctx.roundRect(bx.x - 3, bx.y - 13.5, ctx.measureText(name).width + 6, 12, 3); ctx.fill();
        ctx.fillStyle = T.rgba('--text', bx.lobe === this.region ? 1 : 0.72);
        ctx.fillText(name, bx.x, bx.y - 4);
      }
      ctx.fillStyle = T.rgba('--text', 0.4);
      ctx.fillText('← left', PAD, this.height - 4);
      ctx.textAlign = 'right'; ctx.fillText('right →', this.width - PAD, this.height - 4);
      ctx.textAlign = 'left';
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
      const { sSrc, sDst, sW, sActiveAt, sFlags } = b;
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
            if (now - sActiveAt[s] > TRAIL_TICKS || m < lo || m >= hi || (w >= 0) !== excite) continue;
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
      ctx.font = font(10.5, 700);
      const w = ctx.measureText(word).width + 8, right = x + r + 3 + w < this.width;
      const lx = right ? x + r + 3 : x - r - 3 - w;
      ctx.fillStyle = T.rgba('--pond-deep', 0.88);
      ctx.beginPath();
      ctx.roundRect(lx, y - 7, w, 14, 7);
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
      this.drawMap(ctx, T);
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
      this.history = new Float32Array(120).fill(Evo.BRAIN.V_REST);
      this.head = 0;
      this.resize();
    }

    resize() {
      const { width, height } = Evo.fitCanvas(this.canvas, this.ctx, 160, 24);
      this.width = width;
      this.height = height;
    }

    clear() {
      this.history.fill(Evo.BRAIN.V_REST);
    }

    push(v) {
      this.history[this.head] = v;
      this.head = (this.head + 1) % this.history.length;
    }

    // SCOPE_V_MIN at the bottom, SCOPE_V_MAX (a spike) at the top; the dashed line is the firing threshold
    render(threshold) {
      const ctx = this.ctx, pad = 3, h = this.height - pad * 2, n = this.history.length;
      const y = v => pad + h - Math.max(0, Math.min(h, ((v - SCOPE_V_MIN) / (SCOPE_V_MAX - SCOPE_V_MIN)) * h));
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
