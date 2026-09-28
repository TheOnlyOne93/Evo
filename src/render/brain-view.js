// Connectome and oscilloscope views of the followed organism's brain.
(function (Evo) {
  'use strict';
  const { LOBE_INFO } = Evo;
  const theme = () => Evo.theme;

  // Regions named along the edges of the brain map: organism-left edge on top, right along the bottom
  const EDGE_LABELS = [
    ['vision', 'top'], ['memory', 'top'], ['motor', 'top'],
    ['olfactory', 'bottom'], ['associative', 'bottom'], ['metabolic', 'bottom'], ['efference', 'bottom']
  ];

  class BrainVisualizer {
    constructor(canvas, getBrain) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.getBrain = getBrain;
      this.probedNeuron = null;
      this.neuronScreenPositions = new Map();
      this.resize();
    }

    resize() {
      const { width, height } = Evo.fitCanvas(this.canvas, this.ctx, 260, 180);
      this.width = width;
      this.height = height;
    }

    probeAt(x, y) {
      let nearest = null, minDist = 22;
      this.neuronScreenPositions.forEach((pos, neuron) => {
        const d = Math.hypot(pos.x - x, pos.y - y);
        if (d < minDist) { minDist = d; nearest = neuron; }
      });
      this.probedNeuron = nearest;
      return nearest;
    }

    // The brain is drawn from above with the head facing right (like the organism heading east):
    // front of the brain on the right, the organism's left side at the top.
    toScreen(pos) {
      const padX = 18, padY = 14;
      return {
        x: padX + (1 - pos[1]) * (this.width - padX * 2),
        y: padY + pos[0] * (this.height - padY * 2)
      };
    }

    // Brain chemistry underlay: reward chemical, stress chemical and NO gas, in their theme colours
    renderChemistry(ctx, chem, c, rx, ry) {
      const n = chem.size;
      if (!this.chemCanvas || this.chemCanvas.width !== n) {
        this.chemCanvas = document.createElement('canvas');
        this.chemCanvas.width = n; this.chemCanvas.height = n;
        this.chemCtx = this.chemCanvas.getContext('2d');
        this.chemImage = this.chemCtx.createImageData(n, n);
        this.chemColors = ['--joy', '--stress', '--gas'].map(t => theme().rgb(t));
      }
      const px = this.chemImage.data;
      const [cDA, cST, cNO] = this.chemColors;
      const [DA, ST, NO] = chem.grid;
      // Image column = depth reversed (head on the right), image row = left-to-right across the body
      for (let row = 0; row < n; row++) {
        for (let col = 0; col < n; col++) {
          const i = (n - 1 - col) * n + row; // grid index: y = depth, x = lateral
          const d = DA[i], st = ST[i], no = NO[i] * 0.4;
          const total = d + st + no;
          const o = (row * n + col) * 4;
          if (total > 0.002) {
            for (let k = 0; k < 3; k++) px[o + k] = (cDA[k] * d + cST[k] * st + cNO[k] * no) / total;
            px[o + 3] = Math.min(170, Math.sqrt(total) * 260);
          } else {
            px[o + 3] = 0;
          }
        }
      }
      this.chemCtx.putImageData(this.chemImage, 0, 0);
      const tl = this.toScreen([0, 1]), br = this.toScreen([1, 0]);
      ctx.save();
      ctx.beginPath(); ctx.ellipse(c.x, c.y, rx, ry, 0, 0, Math.PI * 2); ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.chemCanvas, tl.x, tl.y, br.x - tl.x, br.y - tl.y);
      ctx.restore();
    }

    render() {
      const brain = this.getBrain();
      if (!brain) return;
      const ctx = this.ctx, T = theme();
      ctx.clearRect(0, 0, this.width, this.height);

      // Silhouette: two hemispheres around the midline, brainstem at the back
      const c = this.toScreen([0.5, 0.5]);
      const rx = (this.width - 36) * 0.54, ry = (this.height - 28) * 0.56;
      ctx.save();
      ctx.fillStyle = 'rgba(19, 30, 52, 0.45)';
      ctx.strokeStyle = 'rgba(56, 76, 110, 0.7)';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.ellipse(c.x, c.y, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      const mA = this.toScreen([0.5, 0.26]), mB = this.toScreen([0.5, 0.6]);
      ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(mA.x, mA.y); ctx.lineTo(mB.x, mB.y); ctx.stroke();
      ctx.restore();

      this.renderChemistry(ctx, brain.chemistry, c, rx, ry);

      this.neuronScreenPositions.clear();
      const copyColor = T.color('--copy');
      for (const n of brain.allNeurons) {
        const p = this.toScreen(n.pos);
        this.neuronScreenPositions.set(n, { x: p.x, y: p.y, color: n.copyOf ? copyColor : LOBE_INFO[n.parentLobe].color });
      }

      // Axons
      const probe = this.probedNeuron;
      const drawn = [];
      for (const syn of brain.synapses) {
        const pSrc = this.neuronScreenPositions.get(syn.source);
        const pDst = this.neuronScreenPositions.get(syn.target);
        const isOutgoing = syn.source === probe, isIncoming = syn.target === probe;
        if (probe && !isOutgoing && !isIncoming) continue;
        drawn.push([syn, pSrc, pDst]);
        if (probe) {
          ctx.strokeStyle = isOutgoing ? T.rgba('--energy', 0.85) : T.rgba('--water', 0.85);
          ctx.lineWidth = 1.4;
        } else {
          ctx.strokeStyle = syn.isSprouted ? T.rgba('--accent', 0.6) : (syn.weight > 0 ? T.rgba('--water', 0.10) : T.rgba('--stress', 0.12));
          ctx.lineWidth = syn.isSprouted ? 1.2 : 0.5;
        }
        ctx.beginPath(); ctx.moveTo(pSrc.x, pSrc.y); ctx.lineTo(pDst.x, pDst.y); ctx.stroke();
      }

      // Spikes in flight: a dot for every spike still travelling down an axon
      ctx.fillStyle = T.color('--pulse');
      for (const [syn, pSrc, pDst] of drawn) {
        const h = syn.source.history;
        if (!h) continue;
        for (let k = 1; k < syn.delay; k++) {
          if ((h >>> k) & 1) {
            const t = k / syn.delay;
            ctx.beginPath();
            ctx.arc(pSrc.x + (pDst.x - pSrc.x) * t, pSrc.y + (pDst.y - pSrc.y) * t, 1.4, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // Neurons
      this.neuronScreenPositions.forEach((pos, neuron) => {
        const isProbed = neuron === probe;
        const r = neuron.spiked ? 3.8 : (isProbed ? 4.2 : 2.3);
        ctx.fillStyle = neuron.spiked ? '#ffffff' : pos.color;
        ctx.beginPath(); ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2); ctx.fill();
        if (isProbed) {
          ctx.strokeStyle = T.color('--energy'); ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.arc(pos.x, pos.y, r + 3, 0, Math.PI * 2); ctx.stroke();
        }
      });

      // Region names along the edges
      ctx.font = "11px 'Atkinson Hyperlegible', system-ui, sans-serif";
      ctx.fillStyle = T.rgba('--text', 0.6);
      ctx.textAlign = 'center';
      for (const [lobe, edge] of EDGE_LABELS) {
        const neurons = brain.lobe(lobe);
        const depth = neurons.reduce((a, n) => a + n.pos[1], 0) / neurons.length;
        const name = LOBE_INFO[lobe].word;
        const p = this.toScreen([0.5, depth]);
        const w = ctx.measureText(name).width;
        ctx.fillText(name, Math.max(4 + w / 2, Math.min(this.width - 4 - w / 2, p.x)), edge === 'top' ? 10 : this.height - 4);
      }
    }
  }

  class VoltageScope {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.history = new Array(70).fill(-70);
      this.resize();
    }

    resize() {
      const { width, height } = Evo.fitCanvas(this.canvas, this.ctx, 200, 24);
      this.width = width;
      this.height = height;
    }

    pushSample(v) {
      this.history.shift();
      this.history.push(v);
    }

    // Voltage from -80 mV (bottom) to +30 mV (top)
    render() {
      const ctx = this.ctx, pad = 3, h = this.height - pad * 2;
      ctx.clearRect(0, 0, this.width, this.height);
      ctx.strokeStyle = Evo.theme.color('--water');
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const step = this.width / Math.max(1, this.history.length - 1);
      this.history.forEach((v, i) => {
        const y = pad + h - Math.max(0, Math.min(h, ((v + 80) / 110) * h));
        if (i === 0) ctx.moveTo(0, y);
        else ctx.lineTo(i * step, y);
      });
      ctx.stroke();
    }
  }

  Object.assign(Evo, { BrainVisualizer, VoltageScope });
})(globalThis.Evo);
