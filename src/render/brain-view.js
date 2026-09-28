// The followed creature's brain, drawn as a map: senses along the top, muscles along the bottom, the
// left of the world on the left. Neurons glow as they fire, spikes travel down the axons, and the
// reward (DA), stress (ST) and NO chemistry diffusing through the tissue shows as a coloured haze.
// Also a small oscilloscope for one neuron's membrane potential.
(function (Evo) {
  'use strict';
  const { LOBE_INFO } = Evo;
  const TAU = Math.PI * 2;

  // Regions labelled on the map (the rest are identified by tapping a neuron)
  const LABELLED = ['sight', 'smell', 'touch', 'needs', 'feelings', 'cortex', 'side', 'central', 'motor', 'stem'];
  const GUTTER = 74; // Room for the region names on the left

  class BrainView {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.brain = null;
      this.probed = -1;       // Index of the neuron being inspected, or -1
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
      this.layoutFor = null;
    }

    // Brain coordinates to the canvas: x across, y (front to back) downward
    layout() {
      const b = this.brain;
      if (this.layoutFor === b && this.screen && this.screen.length === b.N * 2) return;
      this.layoutFor = b;
      const pad = 16, w = this.width - pad * 2 - GUTTER, h = this.height - pad * 2 - 10;
      this.screen = new Float32Array(b.N * 2);
      this.colors = new Array(b.N);
      const copy = Evo.theme.color('--copy');
      for (const n of b.neurons) {
        this.screen[n.index * 2] = GUTTER + pad + n.pos[0] * w;
        this.screen[n.index * 2 + 1] = pad + 8 + n.pos[1] * h;
        this.colors[n.index] = n.copyOf !== null ? copy : LOBE_INFO[n.parentLobe].color;
      }
      // Region names in the left margin, level with each region's middle, nudged apart so they never overlap
      this.labels = LABELLED.filter(l => b.lobes[l]).map(l => {
        const idx = b.lobes[l];
        let y = 0;
        for (const i of idx) y += this.screen[i * 2 + 1];
        return { text: LOBE_INFO[l].word, y: y / idx.length, color: LOBE_INFO[l].color };
      }).sort((a, z) => a.y - z.y);
      for (let k = 1; k < this.labels.length; k++) this.labels[k].y = Math.max(this.labels[k].y, this.labels[k - 1].y + 13);
    }

    probeAt(x, y) {
      if (!this.brain) return -1;
      this.layout();
      let best = -1, bestD = 18;
      for (let i = 0; i < this.brain.N; i++) {
        const d = Math.hypot(this.screen[i * 2] - x, this.screen[i * 2 + 1] - y);
        if (d < bestD) { bestD = d; best = i; }
      }
      this.probed = best;
      return best;
    }

    // Reward, stress and NO chemistry as a soft image under the neurons
    drawChemistry(ctx) {
      const b = this.brain, n = Evo.BRAIN.CHEM_SIZE;
      if (!this.chemCanvas) {
        this.chemCanvas = document.createElement('canvas');
        this.chemCanvas.width = n; this.chemCanvas.height = n;
        this.chemCtx = this.chemCanvas.getContext('2d');
        this.chemImage = this.chemCtx.createImageData(n, n);
        this.chemColors = ['--joy', '--stress', '--gas'].map(t => Evo.theme.rgb(t));
      }
      const px = this.chemImage.data, [cDA, cST, cNO] = this.chemColors;
      const [DA, ST, NO] = b.chem;
      for (let i = 0; i < n * n; i++) {
        const d = DA[i], s = ST[i], no = NO[i] * 0.35, total = d + s + no, o = i * 4;
        if (total > 0.003) {
          for (let k = 0; k < 3; k++) px[o + k] = (cDA[k] * d + cST[k] * s + cNO[k] * no) / total;
          px[o + 3] = Math.min(150, Math.sqrt(total) * 220);
        } else px[o + 3] = 0;
      }
      this.chemCtx.putImageData(this.chemImage, 0, 0);
      const pad = 16;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.chemCanvas, GUTTER + pad, pad + 8, this.width - pad * 2 - GUTTER, this.height - pad * 2 - 10);
    }

    render() {
      const b = this.brain, ctx = this.ctx, T = Evo.theme;
      ctx.clearRect(0, 0, this.width, this.height);
      if (!b) return;
      this.layout();
      const S = this.screen, probe = this.probed;

      // Tissue: a rounded outline with the midline between the hemifields
      const pad = 10;
      ctx.fillStyle = 'rgba(20, 38, 44, 0.55)';
      ctx.strokeStyle = 'rgba(64, 96, 104, 0.6)';
      ctx.lineWidth = 1;
      const x0 = GUTTER + pad, mid = (x0 + this.width - pad) / 2;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x0, pad, this.width - pad - x0, this.height - pad * 2, 26) : ctx.rect(x0, pad, this.width - pad - x0, this.height - pad * 2);
      ctx.fill(); ctx.stroke();
      ctx.setLineDash([3, 5]);
      ctx.beginPath(); ctx.moveTo(mid, pad + 4); ctx.lineTo(mid, this.height - pad - 4); ctx.stroke();
      ctx.setLineDash([]);
      this.drawChemistry(ctx);

      // Axons: every synapse faintly (batched by kind), or only the probed neuron's
      if (b.adjacencyDirty) b.rebuildAdjacency();
      const { sSrc, sDst, sW, sDelay, sFlags, hist } = b;
      const batches = [
        { style: T.rgba('--water', 0.07), width: 0.6, test: s => sW[s] > 0 && !(sFlags[s] & Evo.BRAIN.SPROUTED) },
        { style: T.rgba('--stress', 0.09), width: 0.6, test: s => sW[s] < 0 && !(sFlags[s] & Evo.BRAIN.SPROUTED) },
        { style: T.rgba('--accent', 0.45), width: 1.1, test: s => !!(sFlags[s] & Evo.BRAIN.SPROUTED) }
      ];
      if (probe < 0) {
        for (const batch of batches) {
          ctx.strokeStyle = batch.style; ctx.lineWidth = batch.width;
          ctx.beginPath();
          for (let s = 0; s < b.S; s++) {
            if (!batch.test(s)) continue;
            ctx.moveTo(S[sSrc[s] * 2], S[sSrc[s] * 2 + 1]); ctx.lineTo(S[sDst[s] * 2], S[sDst[s] * 2 + 1]);
          }
          ctx.stroke();
        }
      } else {
        for (let s = 0; s < b.S; s++) {
          if (sSrc[s] !== probe && sDst[s] !== probe) continue;
          const w = sW[s];
          ctx.strokeStyle = w >= 0 ? T.rgba(sSrc[s] === probe ? '--energy' : '--water', 0.35 + Math.min(0.6, Math.abs(w) * 0.5)) : T.rgba('--stress', 0.35 + Math.min(0.6, Math.abs(w) * 0.5));
          ctx.lineWidth = 0.6 + Math.min(2.4, Math.abs(w) * 1.6);
          ctx.beginPath(); ctx.moveTo(S[sSrc[s] * 2], S[sSrc[s] * 2 + 1]); ctx.lineTo(S[sDst[s] * 2], S[sDst[s] * 2 + 1]); ctx.stroke();
        }
      }

      // Spikes in flight: a dot for each spike still travelling down an axon
      ctx.fillStyle = T.color('--pulse');
      ctx.beginPath();
      for (let s = 0; s < b.S; s++) {
        if (probe >= 0 && sSrc[s] !== probe && sDst[s] !== probe) continue;
        const h = hist[sSrc[s]], d = sDelay[s];
        if (!(h & ((1 << d) - 2))) continue;
        const x0 = S[sSrc[s] * 2], y0 = S[sSrc[s] * 2 + 1], x1 = S[sDst[s] * 2], y1 = S[sDst[s] * 2 + 1];
        for (let k = 1; k < d; k++) {
          if ((h >>> k) & 1) { const t = k / d; ctx.rect(x0 + (x1 - x0) * t - 1, y0 + (y1 - y0) * t - 1, 2, 2); }
        }
      }
      ctx.fill();

      // Neurons: lobe colour, white when firing, bigger when busy
      for (let i = 0; i < b.N; i++) {
        const fired = hist[i] & 1;
        const r = fired ? 3.6 : 1.8 + Math.min(1.6, b.rate[i] * 6);
        ctx.fillStyle = fired ? '#ffffff' : this.colors[i];
        ctx.globalAlpha = fired ? 1 : 0.55 + Math.min(0.45, b.rate[i] * 4);
        ctx.beginPath(); ctx.arc(S[i * 2], S[i * 2 + 1], r, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (probe >= 0) {
        ctx.strokeStyle = T.color('--energy'); ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.arc(S[probe * 2], S[probe * 2 + 1], 7, 0, TAU); ctx.stroke();
      }

      // Region names
      ctx.font = "11px 'Atkinson Hyperlegible', system-ui, sans-serif";
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      for (const l of this.labels) {
        ctx.fillStyle = l.color;
        ctx.beginPath(); ctx.arc(8, l.y, 3, 0, TAU); ctx.fill();
        ctx.fillStyle = T.rgba('--text', 0.7);
        ctx.fillText(l.text, 15, l.y);
      }
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = T.rgba('--text', 0.4);
      ctx.textAlign = 'left'; ctx.fillText('← left', GUTTER + 14, this.height - 4);
      ctx.textAlign = 'right'; ctx.fillText('right →', this.width - 14, this.height - 4);
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
