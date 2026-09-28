// Draws the terrarium. Reads the world; never changes the simulation.
(function (Evo) {
  'use strict';
  const { SCENTS, ITEM_TYPES, RAYS } = Evo;
  const theme = () => Evo.theme;

  class TerrariumView {
    constructor(world, canvas) {
      this.world = world;
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.showScent = true;
      this.resize();
    }

    // Match the canvas to its box and give the world the same size
    resize() {
      const { width, height } = Evo.fitCanvas(this.canvas, this.ctx, 160, 160);
      this.width = width;
      this.height = height;
      this.world.resize(width, height);
    }

    // The real diffusion field, drawn as a smooth low-resolution image
    renderScentField(ctx) {
      const g = this.world.scentGrid;
      if (!this.scentCanvas) {
        this.scentCanvas = document.createElement('canvas');
        this.scentCanvas.width = g.cols;
        this.scentCanvas.height = g.rows;
        this.scentCtx = this.scentCanvas.getContext('2d');
        this.scentImage = this.scentCtx.createImageData(g.cols, g.rows);
        this.scentColors = SCENTS.map(s => theme().rgb(s.token));
      }
      const px = this.scentImage.data, colors = this.scentColors;
      for (let i = 0; i < g.cols * g.rows; i++) {
        let R = 0, G = 0, B = 0, total = 0;
        for (let ch = 0; ch < g.channels.length; ch++) {
          const v = g.channels[ch][i];
          if (v <= 0) continue;
          R += colors[ch][0] * v; G += colors[ch][1] * v; B += colors[ch][2] * v; total += v;
        }
        const o = i * 4;
        if (total > 0.004) {
          px[o] = R / total; px[o + 1] = G / total; px[o + 2] = B / total;
          px[o + 3] = Math.min(150, Math.sqrt(total) * 110);
        } else {
          px[o + 3] = 0;
        }
      }
      this.scentCtx.putImageData(this.scentImage, 0, 0);
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.scentCanvas, 0, 0, this.width, this.height);
      ctx.restore();
    }

    render() {
      const ctx = this.ctx, world = this.world, T = theme();
      ctx.clearRect(0, 0, this.width, this.height);

      // Laboratory grid
      ctx.strokeStyle = 'rgba(26, 40, 69, 0.35)';
      ctx.lineWidth = 1;
      const gridSize = 28;
      ctx.beginPath();
      for (let x = 0; x < this.width; x += gridSize) { ctx.moveTo(x, 0); ctx.lineTo(x, this.height); }
      for (let y = 0; y < this.height; y += gridSize) { ctx.moveTo(0, y); ctx.lineTo(this.width, y); }
      ctx.stroke();

      // Places where food grows, tinted with the colour of what grows there
      for (const src of world.sources) {
        ctx.fillStyle = T.rgba(ITEM_TYPES[src.yields].color, 0.11);
        ctx.beginPath(); ctx.arc(src.pos[0] * this.width, src.pos[1] * this.height, 46, 0, Math.PI * 2); ctx.fill();
      }

      if (this.showScent) this.renderScentField(ctx);

      // Thorn bushes
      for (const h of world.hazards) {
        const [hx, hy] = world.hazardXY(h);
        ctx.save();
        ctx.strokeStyle = T.color('--toxin'); ctx.lineWidth = 1.4; ctx.fillStyle = T.rgba('--mimic-spot', 0.55);
        ctx.beginPath(); ctx.arc(hx, hy, h.radius * 0.6, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath();
        for (let k = 0; k < 10; k++) {
          const a = k * Math.PI / 5;
          ctx.moveTo(hx + Math.cos(a) * h.radius * 0.5, hy + Math.sin(a) * h.radius * 0.5);
          ctx.lineTo(hx + Math.cos(a) * h.radius, hy + Math.sin(a) * h.radius);
        }
        ctx.stroke();
        ctx.restore();
      }

      for (const item of world.items) this.drawItem(ctx, item);
      for (const org of world.organisms) this.drawOrganism(ctx, org, org === world.focusedOrganism);
    }

    drawItem(ctx, item) {
      const def = ITEM_TYPES[item.type], T = theme();
      item.pulse += 0.05;
      const p = Math.sin(item.pulse) * 1.5;
      ctx.save();
      ctx.shadowColor = T.color(def.color); ctx.shadowBlur = 11;
      ctx.fillStyle = T.color(def.color);
      ctx.beginPath(); ctx.arc(item.x, item.y, item.radius + p, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      if (def.mobile) {
        ctx.strokeStyle = T.color('--text'); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(item.x, item.y); ctx.lineTo(item.x + item.vx * 8, item.y + item.vy * 8); ctx.stroke();
      }
      if (def.spot) { // The mimic's tell: a small dark spot
        ctx.fillStyle = T.color(def.spot);
        ctx.beginPath(); ctx.arc(item.x + 2, item.y - 2, 1.8, 0, Math.PI * 2); ctx.fill();
      }
      if (item.type === 'carrion') {
        ctx.strokeStyle = T.color('--text'); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(item.x - 4, item.y - 4); ctx.lineTo(item.x + 4, item.y + 4);
        ctx.moveTo(item.x + 4, item.y - 4); ctx.lineTo(item.x - 4, item.y + 4); ctx.stroke();
      }
      ctx.restore();
    }

    drawOrganism(ctx, org, isFocused) {
      const T = theme();
      const isFem = org.sex === 'FEMALE';
      const sexToken = isFem ? '--female' : '--male';
      const r = org.currentRadius;
      ctx.save();

      // The seven vision rays, coloured by what each one sees
      if (isFocused && org.lastSenses) {
        const rayStyles = [['toxic', '--toxin', 1.6], ['pheromone', '--female', 1.6], ['carb', '--fruit', 1.5], ['starch', '--grain', 1.4], ['water', '--water', 1.4]];
        org.lastSenses.visionRays.forEach((ray, rIdx) => {
          const angle = org.angle + RAYS[rIdx].angle;
          const endX = org.x + Math.cos(angle) * ray.hitDist;
          const endY = org.y + Math.sin(angle) * ray.hitDist;
          const seen = rayStyles.find(([ch]) => ray[ch] > 0.15);
          const strokeCol = seen ? T.rgba(seen[1], 0.8) : T.rgba('--water', 0.15);
          let lineW = seen ? seen[2] : 0.8;
          if (RAYS[rIdx].angle === 0) lineW += 0.6; // Centre focal ray emphasis
          ctx.strokeStyle = strokeCol;
          ctx.lineWidth = lineW;
          ctx.beginPath(); ctx.moveTo(org.x, org.y); ctx.lineTo(endX, endY); ctx.stroke();
          if (ray.hitDist < org.traits.visionRange - 10) {
            ctx.fillStyle = strokeCol;
            ctx.beginPath(); ctx.arc(endX, endY, 2.5, 0, Math.PI * 2); ctx.fill();
          }
        });
      }

      // Antennae (the same length the organism smells with)
      const antLen = org.antennaLength, spread = org.traits.antennaSpread;
      const tips = [-spread, spread].map(a => [org.x + Math.cos(org.angle + a) * antLen, org.y + Math.sin(org.angle + a) * antLen]);
      ctx.strokeStyle = T.rgba(sexToken, 0.7);
      ctx.lineWidth = isFem ? 1.4 : 1.8;
      ctx.beginPath();
      for (const [tx, ty] of tips) { ctx.moveTo(org.x, org.y); ctx.lineTo(tx, ty); }
      ctx.stroke();
      // Scent tips glow
      ctx.fillStyle = T.color(sexToken);
      for (const [tx, ty] of tips) { ctx.beginPath(); ctx.arc(tx, ty, 2.8, 0, Math.PI * 2); ctx.fill(); }

      // Male claspers
      if (!isFem && org.body.isMature) {
        ctx.strokeStyle = T.color('--energy');
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(org.x - Math.cos(org.angle) * r * 0.8, org.y - Math.sin(org.angle) * r * 0.8, 4, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Tail
      org.tailSegments.forEach((seg, i) => {
        ctx.fillStyle = i % 2 === 0 ? '#131e34' : '#080e1a';
        ctx.strokeStyle = T.color(sexToken);
        ctx.beginPath(); ctx.arc(seg.x, seg.y, Math.max(2.5, r * (1.0 - (i + 1) * 0.18)), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      });

      // Body, with its genetically evolved coat hue as a glow
      ctx.shadowColor = org.body.canReproduce() ? T.color(sexToken) : (isFocused ? T.color('--accent') : `hsl(${org.traits.coatColorHue}, 70%, 50%)`);
      ctx.shadowBlur = isFocused ? 16 : 8;
      ctx.fillStyle = org.body.isMature ? '#080e1a' : '#0d1829'; // Juveniles slightly lighter
      ctx.strokeStyle = T.color(sexToken);
      ctx.lineWidth = isFocused ? 2.8 : (org.body.isMature ? 2.0 : 1.4);
      ctx.beginPath(); ctx.arc(org.x, org.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

      // Jaws
      const mouthLen = r + (org.mouthOpen ? 7 : 3);
      const mouthSpread = org.mouthOpen ? 0.45 : 0.20;
      ctx.shadowBlur = 0;
      ctx.strokeStyle = org.mouthOpen ? T.color('--stress') : T.color('--accent');
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(org.x + Math.cos(org.angle - mouthSpread) * mouthLen, org.y + Math.sin(org.angle - mouthSpread) * mouthLen);
      ctx.lineTo(org.x + Math.cos(org.angle) * (r * 0.7), org.y + Math.sin(org.angle) * (r * 0.7));
      ctx.lineTo(org.x + Math.cos(org.angle + mouthSpread) * mouthLen, org.y + Math.sin(org.angle + mouthSpread) * mouthLen);
      ctx.stroke();

      ctx.restore();
    }

    // The organism under a screen point, if any (touch gets a bigger target)
    organismAt(x, y, reach) {
      return this.world.organisms.find(o => Math.hypot(o.x - x, o.y - y) < o.currentRadius + reach) || null;
    }
  }

  Evo.TerrariumView = TerrariumView;
})(globalThis.Evo);
