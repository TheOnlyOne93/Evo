// Weather and seasonal particles: snow in winter, falling leaves in autumn, blossom petals in
// spring, pollen motes by day and fireflies on summer nights. A pooled struct of arrays in world
// space, spawned around the WorldView's visible area each frame.
(function (Evo) {
  'use strict';
  const { TAU, clamp } = Evo.util;
  const { SPRING, SUMMER, AUTUMN, WINTER } = Evo.SEASON;

  const MAX_PARTICLES = 360;
  const LEAF_COLORS = ['#d8742e', '#c2452d', '#e2a93b', '#a8552a', '#f2c9dc', '#ffffff']; // falling leaves + petals

  class Weather {
    constructor() {
      const N = MAX_PARTICLES;
      this.p = {
        n: 0, x: new Float32Array(N), y: new Float32Array(N), vx: new Float32Array(N), vy: new Float32Array(N),
        rot: new Float32Array(N), vr: new Float32Array(N), life: new Float32Array(N), size: new Float32Array(N),
        ph: new Float32Array(N), kind: new Uint8Array(N), col: new Uint8Array(N), rest: new Uint8Array(N),
      };
      this.season = -1;     // the season the particles belong to
      this.spawnTimer = 0;  // seconds of leaf and petal spawning owed
    }

    // Drop every particle (a new world)
    clear() { this.p.n = 0; }

    spawn(kind, x, y, col) {
      const P = this.p;
      if (P.n >= MAX_PARTICLES) return -1;
      const i = P.n++;
      const R = Math.random;
      P.kind[i] = kind; P.x[i] = x; P.y[i] = y; P.col[i] = col; P.rest[i] = 0;
      P.rot[i] = R() * TAU; P.vr[i] = (R() - 0.5) * 4; P.ph[i] = R() * TAU;
      P.vx[i] = 0; P.vy[i] = 0;
      switch (kind) {
        case 0: P.size[i] = 2.4 + R() * 1.4; P.life[i] = 30; break;        // leaf
        case 1: P.size[i] = 0.7 + R() * 1.6; P.life[i] = 60; break;        // snow
        case 2: P.size[i] = 1.8 + R() * 0.9; P.life[i] = 25; break;        // petal
        case 3: P.size[i] = 0.6 + R() * 0.7; P.life[i] = 6 + R() * 6; break; // pollen
        case 4: P.size[i] = 1.2 + R() * 0.6; P.life[i] = 10 + R() * 12; break; // firefly
      }
      return i;
    }

    // Spawn, move and retire particles for this frame. v is the WorldView (view bounds, season, wind).
    update(v, dt, t) {
      const P = this.p, ss = v.ss, pal = v.sky.pal, R = Math.random;
      const si = ss.blend > 0.5 ? ss.next : ss.cur;
      const x0 = v.vx0, x1 = v.vx1, y0 = v.vy0, y1 = v.vy1;
      const vw = x1 - x0, vh = y1 - y0;
      const area = clamp((vw * vh) / (1100 * 650), 0.25, 2.5);
      const fresh = si !== this.season;
      this.season = si;
      if (fresh) { // drop the last season's weather at once
        for (let i = 0; i < P.n; i++) {
          const k = P.kind[i];
          const keep = (k === 1 && si === WINTER) || (k === 0 && si === AUTUMN) || (k === 2 && si === SPRING) || ((k === 3 || k === 4) && si <= SUMMER);
          if (!keep) this.kill(i--);
        }
      }
      // Spawning
      const wind = v.wind;
      if (si === WINTER) { // snow: keep a density in view, heavier now and then
        const target = Math.round(area * (110 + 70 * Math.sin(t * 0.05)));
        let count = 0;
        for (let i = 0; i < P.n; i++) if (P.kind[i] === 1) count++;
        let need = target - count;
        while (need-- > 0) {
          const i = this.spawn(1, x0 - 60 + R() * (vw + 120), fresh ? y0 + R() * vh : y0 - 10 - R() * 40, 5);
          if (i < 0) break;
        }
      } else if (si === AUTUMN || si === SPRING) { // leaves from the trees in autumn, petals in spring
        const kind = si === AUTUMN ? 0 : 2;
        this.spawnTimer += dt;
        const fs = v.world.features || [];
        if (this.spawnTimer > 0.12) {
          const steps = Math.min(8, Math.floor(this.spawnTimer / 0.12));
          this.spawnTimer -= steps * 0.12;
          for (let s = 0; s < steps; s++) {
            for (let k = 0; k < fs.length; k++) {
              const f = fs[k];
              if (f.kind !== 'tree') continue;
              const rec = v.featRecs.get(f.id);
              if (!rec || f.x < x0 - 200 || f.x > x1 + 200) continue;
              if (R() > (si === AUTUMN ? 0.26 : 0.1)) continue;
              const d = rec.data;
              const a = R() * TAU;
              this.spawn(kind, f.x + Math.cos(a) * d.cr * 0.9, f.y + d.cy + Math.sin(a) * d.cr * 0.6, kind === 0 ? (R() * 4) | 0 : 4 + ((R() * 2) | 0));
            }
            if (si === AUTUMN && R() < 0.35) this.spawn(0, x0 - 40 + R() * (vw + 80), y0 - 10, (R() * 4) | 0);
          }
        }
      }
      if (si === SPRING || si === SUMMER) { // pollen motes by day, fireflies on summer nights
        let pollen = 0, flies = 0;
        for (let i = 0; i < P.n; i++) { if (P.kind[i] === 3) pollen++; else if (P.kind[i] === 4) flies++; }
        const wantPollen = Math.round(area * 18 * pal.day);
        for (let k = pollen; k < wantPollen; k++) this.spawn(3, x0 + R() * vw, v.info.meanS - 20 - R() * 160, 0);
        const wantFlies = si === SUMMER ? Math.round(area * 26 * pal.night) : 0;
        for (let k = flies; k < wantFlies; k++) {
          const x = x0 + R() * vw;
          this.spawn(4, x, v.info.surf(x) - 8 - R() * 70, 0);
        }
      }
      // Motion
      for (let i = 0; i < P.n; i++) {
        const kind = P.kind[i];
        let dead = false;
        P.life[i] -= dt;
        if (P.rest[i]) {
          if (P.life[i] <= 0) dead = true;
        } else {
          const ph = P.ph[i];
          switch (kind) {
            case 0: case 2: {
              const light = kind === 2 ? 0.7 : 1;
              P.vx[i] = wind * 22 * light + Math.sin(t * 2.1 + ph) * 16;
              P.vy[i] = (15 + Math.sin(t * 3.3 + ph) * 9) * light;
              P.rot[i] += P.vr[i] * dt * (1 + Math.sin(t * 2 + ph));
              break;
            }
            case 1:
              P.vx[i] = wind * 12 + Math.sin(t * 1.3 + ph) * 7;
              P.vy[i] = 20 + P.size[i] * 10;
              break;
            case 3:
              P.vx[i] = wind * 7 + Math.sin(t * 0.7 + ph) * 5;
              P.vy[i] = Math.sin(t * 0.9 + ph * 2) * 4 - 1;
              break;
            case 4:
              P.vx[i] += (Math.sin(t * 1.1 + ph * 3) * 14 - P.vx[i]) * dt;
              P.vy[i] += (Math.cos(t * 0.8 + ph * 5) * 9 - P.vy[i]) * dt;
              break;
          }
          P.x[i] += P.vx[i] * dt;
          P.y[i] += P.vy[i] * dt;
          if (kind <= 2) {
            const gy = v._surfaceBelow(P.x[i], P.y[i] - 2);
            if (P.y[i] >= gy - 1) {
              const wl = v.info.waterAt(P.x[i]);
              if (kind === 1 || (wl !== null && gy > wl)) dead = true; // snow melts in; leaves sink
              else { P.y[i] = gy - 1; P.rest[i] = 1; P.life[i] = 3 + R() * 4; }
            }
          }
          if (P.life[i] <= 0) dead = true;
        }
        if (P.x[i] < x0 - 150 || P.x[i] > x1 + 150 || P.y[i] > y1 + 60 || P.y[i] < y0 - 300) dead = true;
        if (kind === 1 && si !== WINTER && R() < dt * 0.5) dead = true;
        if (kind === 4 && pal.night < 0.2 && R() < dt) dead = true;
        if (dead) this.kill(i--);
      }
    }

    kill(i) {
      const P = this.p, j = --P.n;
      if (i === j) return;
      P.x[i] = P.x[j]; P.y[i] = P.y[j]; P.vx[i] = P.vx[j]; P.vy[i] = P.vy[j]; P.rot[i] = P.rot[j]; P.vr[i] = P.vr[j];
      P.life[i] = P.life[j]; P.size[i] = P.size[j]; P.ph[i] = P.ph[j]; P.kind[i] = P.kind[j]; P.col[i] = P.col[j]; P.rest[i] = P.rest[j];
    }

    draw(g) {
      const P = this.p;
      if (!P.n) return;
      // Leaves and petals, batched by colour
      for (let c = 0; c < LEAF_COLORS.length; c++) {
        let any = false;
        for (let i = 0; i < P.n; i++) {
          const k = P.kind[i];
          if ((k !== 0 && k !== 2) || P.col[i] !== c) continue;
          if (!any) { g.beginPath(); any = true; }
          const s = P.size[i];
          const flip = Math.abs(Math.cos(P.rot[i] * 0.7)) * 0.7 + 0.3; // tumbling
          g.moveTo(P.x[i] + s, P.y[i]);
          g.ellipse(P.x[i], P.y[i], s, s * 0.5 * flip, P.rot[i], 0, TAU);
        }
        if (any) {
          g.fillStyle = LEAF_COLORS[c];
          g.globalAlpha = 1;
          g.fill();
        }
      }
      // Snow, in two sizes
      for (let pass = 0; pass < 2; pass++) {
        let any = false;
        for (let i = 0; i < P.n; i++) {
          if (P.kind[i] !== 1 || (P.size[i] > 1.4) !== !!pass) continue;
          if (!any) { g.beginPath(); any = true; }
          g.moveTo(P.x[i] + P.size[i], P.y[i]);
          g.arc(P.x[i], P.y[i], P.size[i], 0, TAU);
        }
        if (any) {
          g.fillStyle = pass ? 'rgba(255,255,255,0.95)' : 'rgba(240,246,255,0.8)';
          g.fill();
        }
      }
      // Pollen motes
      let any = false;
      for (let i = 0; i < P.n; i++) {
        if (P.kind[i] !== 3) continue;
        if (!any) { g.beginPath(); any = true; }
        g.moveTo(P.x[i] + P.size[i], P.y[i]);
        g.arc(P.x[i], P.y[i], P.size[i], 0, TAU);
      }
      if (any) { g.fillStyle = 'rgba(255,244,190,0.7)'; g.fill(); }
      g.globalAlpha = 1;
    }

    // Fireflies: blinking glow sprites, added in the emissive pass
    drawFireflies(g, sprite, night, t) {
    const P = this.p;
    for (let i = 0; i < P.n; i++) {
      if (P.kind[i] !== 4) continue;
      const blink = Math.max(0, Math.sin(t * 2.2 + P.ph[i] * 3));
      const a = blink * blink * night * Math.min(1, P.life[i]);
      if (a < 0.02) continue;
      g.globalAlpha = a;
      const r = 7 * P.size[i];
      g.drawImage(sprite, P.x[i] - r, P.y[i] - r, r * 2, r * 2);
    }
    }
  }

  Evo.Weather = Weather;
})(globalThis.Evo);
