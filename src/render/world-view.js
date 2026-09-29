// The side-view world: sky and parallax scenery (sky.js), terrain, the pond, plants and rocks,
// items (item-art.js), creatures (Evo.CreatureArt), weather, day/night light, overlays and the
// player's hand. Reads the world through the contract in DESIGN.md §6 and never changes it.
//
// Static art (terrain tiles, plants, rocks, platforms) is painted once into offscreen sprites at a
// resolution matched to the zoom, per season, and blitted each frame. Only water, items,
// creatures, particles and overlays are drawn as paths every frame.
(function (Evo) {
  'use strict';
  const { TAU, clamp, clamp01, hash2 } = Evo.util;
  const { makeCanvas, rgb, rgba, scale } = Evo.Sky.util;
  const Paint = Evo.Paint;
  const { WINTER } = Evo.SEASON;
  const SEASON_COUNT = Evo.SEASON_COUNT;

  const ZOOM_MIN = 0.5, ZOOM_MAX = 2.5;
  const GROUND_AT = 0.72;               // where the ground line sits on screen (fraction of height)
  const SKY_ROOM = 420;                 // world px of scenery kept visible above the ground by default
  const LEVELS = [1, 1.5, 2, 3];        // sprite resolutions, in device px per world px
  const NL = LEVELS.length;
  const TILE = 256;                     // terrain tile size (world px)
  const SPRITE_BUDGET = 24e6;           // cached sprite pixels before old ones are dropped
  const BUILDS_PER_FRAME = 3;           // sprite upgrades per frame (missing ones are always built)
  const SOUND_LIFE = 90;                // ticks a call stays visible (world.sounds[].age is in ticks)
  const KIND = { TILE: 0, TREE: 1, GRASS: 2, LOG: 3, ROCK: 4, REEDS: 5, THORN: 6, PLAT_LOG: 7, PLAT_ROCK: 8 };
  const FEATURE_KIND = { tree: KIND.TREE, grass: KIND.GRASS, log: KIND.LOG, rock: KIND.ROCK, reeds: KIND.REEDS, thornbush: KIND.THORN };
  // Back-to-front passes over world.features; reeds stand in front of the water
  const BACK_PASSES = [[KIND.TREE], null /* platforms */, [KIND.LOG, KIND.ROCK], [KIND.THORN], [KIND.GRASS]];
  const FRONT_PASSES = [[KIND.REEDS]];

  // ---------------------------------------------------------------------------------------------
  // Glow sprites for the emissive pass (white core fading to a tint)
  function glowSprite(col, size) {
    const c = makeCanvas(size, size);
    const g = c.getContext('2d');
    const r = size / 2;
    const grd = g.createRadialGradient(r, r, 0, r, r, r);
    grd.addColorStop(0, rgba(col, 1));
    grd.addColorStop(0.25, rgba(col, 0.55));
    grd.addColorStop(1, rgba(col, 0));
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);
    return c;
  }

  // ---------------------------------------------------------------------------------------------
  class WorldView {
    constructor(world, canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.options = { showScent: false, showSenses: false, focused: null, hand: null };
      this.cam = { x: 0, y: 0, zoom: 1 };
      this.fit = { zoom: 1, top: 0, bottom: 900, centerY: 450, horizonY: 650 };
      this.w = 1; this.h = 1; this.dpr = 1;
      this.k = 1; this.ox = 0; this.oy = 0;
      this.minZoom = ZOOM_MIN;
      this.target = null;
      this.panY = 0;
      this.userZoomed = false;
      this.sky = new Evo.Sky();
      this.ss = this.sky.ss;
      this.onDrawSenses = null;          // hook(ctx, creature, view, t) for options.showSenses
      this.hoveredCreature = null;
      this.hoveredItem = null;
      this.frameNo = 0;
      this.lastT = null;
      this.t = 0;
      this.wind = 1;
      this.levelIdx = 1;
      this.buildsLeft = 0;
      this.sprites = [];
      this.spritePx = 0;
      this.poses = [];
      this.fake = { id: 0, type: 'fruit', x: 0, y: 0, radius: 4.2, rot: 0, vx: 0, onGround: false };
      this.box = { x0: 0, y0: 0, x1: 0, y1: 0 };
      this.glows = {
        warm: glowSprite([255, 150, 70], 64), lure: glowSprite([255, 120, 190], 64),
        fly: glowSprite([220, 255, 120], 32), egg: glowSprite([255, 220, 150], 64),
      };
      this.weather = new Evo.Weather();
      this.setWorld(world);
      this.resize();
    }

    // Swap in a different world (a new game). Rebuilds every cache.
    setWorld(world) {
      this.world = world;
      this.heights = null;
      this.featRecs = new Map();
      this.platRecs = [];
      this.tiles = [];
      for (const sp of this.sprites) sp.canvas.width = sp.canvas.height = 0;
      this.sprites = [];
      this.spritePx = 0;
      this.scent = null;
      this.camReady = false;
      this.weather.clear();
      if (world) this._sync();
    }

    get following() { return this.target; }
    get camera() { return this.cam; }

    // Match the canvas to its box
    resize() {
      const { width, height } = Evo.fitCanvas(this.canvas, this.ctx, 160, 160);
      this.w = width;
      this.h = height;
      this.dpr = this.canvas.width / width;
      this.vignette = null;
      if (!this.world) return;
      this._computeFit();
      if (!this.userZoomed) this.cam.zoom = this.fit.zoom;
      this.cam.zoom = clamp(this.cam.zoom, this.minZoom, ZOOM_MAX);
      this._clampCamera();
      this._computeTransform();
    }

    // Camera: follow a creature (smoothly), or null to stop
    follow(creature) {
      this.target = creature || null;
      this.panY = 0;
      if (this.target && !this.camReady && this.info) this._snapToGoal();
    }

    // Pan by a screen distance (CSS px). Taking the camera stops following.
    panBy(dx, dy) {
      this.target = null;
      this.cam.x -= dx / this.cam.zoom;
      this.cam.y -= dy / this.cam.zoom;
      this._clampCamera();
      this._keepHeight();
      this._computeTransform();
    }

    // Remember the camera's height relative to the ground line, so it stays where the user put it
    _keepHeight() {
      if (this.target || !this.info) return;
      const vh = this.h / this.cam.zoom;
      this.panY = this.cam.y - (this._groundLine(this.cam.x, (this.w / this.cam.zoom) * 0.3) - (GROUND_AT - 0.5) * vh);
    }

    zoomAt(factor, sx, sy) {
      const z0 = this.cam.zoom;
      const z1 = clamp(z0 * factor, this.minZoom, ZOOM_MAX);
      if (z1 === z0) return;
      let ax = sx, ay = sy;
      if (this.target) { // keep the followed creature where it is on screen
        ax = (this.target.x - this.cam.x) * z0 + this.w / 2;
        ay = (this.target.y - 15 - this.cam.y) * z0 + this.h / 2;
      }
      const wx = this.cam.x + (ax - this.w / 2) / z0, wy = this.cam.y + (ay - this.h / 2) / z0;
      this.cam.zoom = z1;
      this.cam.x = wx - (ax - this.w / 2) / z1;
      this.cam.y = wy - (ay - this.h / 2) / z1;
      this.userZoomed = true;
      this._clampCamera();
      this._keepHeight();
      this._computeTransform();
    }

    // Back to the default framing
    resetZoom() {
      this.userZoomed = false;
      this.panY = 0;
      this.cam.zoom = this.fit.zoom;
      this._clampCamera();
      this._computeTransform();
    }

    screenToWorld(sx, sy) {
      return { x: (sx * this.dpr - this.ox) / this.k, y: (sy * this.dpr - this.oy) / this.k };
    }

    worldToScreen(x, y) {
      return { x: (x * this.k + this.ox) / this.dpr, y: (y * this.k + this.oy) / this.dpr };
    }

    // The creature under a screen point (CSS px), or null. Touch-friendly padding.
    creatureAt(sx, sy) {
      if (!this.world) return null;
      const cs = this.world.creatures;
      const p = this.screenToWorld(sx, sy);
      const pad = 8 / this.cam.zoom;
      let best = null, bestD = Infinity;
      for (let i = cs.length - 1; i >= 0; i--) {
        const c = cs[i];
        const d = this._creatureHit(c, this._poseFor(c, i), p.x, p.y, pad);
        if (d < bestD) { bestD = d; best = c; }
      }
      return best;
    }

    // The item under a screen point (CSS px), or null
    itemAt(sx, sy) {
      if (!this.world) return null;
      const p = this.screenToWorld(sx, sy);
      return this._itemAtWorld(p.x, p.y, 10 / this.cam.zoom);
    }

    // ------------------------------------------------------------------------------ internals

    _sync() {
      const world = this.world, T = world.terrain;
      if (T.heights === this.heights && world.width === this.info.W && world.height === this.info.H) return;
      this.heights = T.heights;
      this.info = Paint.buildTerrain(world);
      // Terrain tile records; empty ones (all sky) are skipped
      const cols = Math.ceil(world.width / TILE), rows = Math.ceil(world.height / TILE);
      this.tileCols = cols;
      this.tileRows = rows;
      this.tiles = new Array(cols * rows);
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const x0 = i * TILE, x1 = x0 + TILE, y1 = (j + 1) * TILE;
          let top = Infinity;
          for (let x = Math.max(0, x0 - 24); x <= Math.min(world.width, x1 + 24); x += 4) top = Math.min(top, this.info.surf(x));
          const cliff = (x0 < 110 || x1 > world.width - 110) && y1 > this.info.cliffTop - 50;
          const empty = !cliff && y1 < top - 30;
          this.tiles[j * cols + i] = { kind: KIND.TILE, empty, bx0: x0, by0: j * TILE, bw: TILE, bh: TILE, sp: new Array(SEASON_COUNT * NL).fill(null) };
        }
      }
      for (const sp of this.sprites) sp.canvas.width = sp.canvas.height = 0;
      this.sprites = [];
      this.spritePx = 0;
      this.featRecs.clear();
      this.platRecs = [];
      this.scent = null;
      if (this.w > 1) this._computeFit();
    }

    // Default zoom: the view's height holds SKY_ROOM of scenery above the ground line (trees and
    // sky) and a band of soil below it. The camera then rides along the ground.
    _computeFit() {
      const W = this.world.width, info = this.info;
      if (!info) return;
      let tallest = 0;
      for (const f of this.world.features) if (f.kind === 'tree') tallest = Math.max(tallest, f.height + 110);
      const vh = Math.max(SKY_ROOM, tallest) / GROUND_AT;
      this.minZoom = clamp(this.w / W, ZOOM_MIN, ZOOM_MAX);
      const f = this.fit;
      f.zoom = clamp(Math.max(this.h / vh, this.w / W), this.minZoom, ZOOM_MAX);
      f.centerY = info.meanS - (GROUND_AT - 0.5) * this.h / f.zoom; // the default camera height, for parallax
      f.horizonY = info.meanS;
    }

    _clampCamera() {
      const W = this.world.width, H = this.world.height, z = this.cam.zoom;
      const vw = this.w / z, vh = this.h / z;
      this.cam.x = vw >= W ? W / 2 : clamp(this.cam.x, vw / 2, W - vw / 2);
      this.cam.y = vh >= H ? H - vh / 2 : clamp(this.cam.y, vh / 2, H - vh / 2);
    }

    // Ground line under the middle of the view: the average surface (or pond surface) nearby
    _groundLine(x, halfWidth) {
      const info = this.info;
      let sum = 0, n = 0;
      for (let k = -4; k <= 4; k++) {
        const xx = clamp(x + (k / 4) * halfWidth, 0, info.W);
        const wl = info.waterAt(xx);
        const s = info.surf(xx);
        sum += wl !== null && wl < s ? wl : s;
        n++;
      }
      return sum / n;
    }

    // Where the camera wants to be: over the followed creature, or riding the ground line
    _cameraGoal(out) {
      const z = this.cam.zoom, vw = this.w / z, vh = this.h / z;
      const c = this.target;
      if (c) {
        const lead = clamp(c.vx * 14, -vw * 0.1, vw * 0.1) + c.facing * Math.min(36, vw * 0.06);
        out.x = c.x + lead;
        // Mostly the ground under the creature, so jumps don't bob the whole world
        const ground = this._groundLine(c.x, Math.min(160, vw * 0.25));
        out.y = Math.min(c.y, ground * 0.6 + c.y * 0.4) - (GROUND_AT - 0.5) * vh;
      } else {
        out.x = this.cam.x;
        out.y = this._groundLine(this.cam.x, vw * 0.3) - (GROUND_AT - 0.5) * vh + this.panY;
      }
      return out;
    }

    _snapToGoal() {
      const p = this._cameraGoal(this.box);
      this.cam.x = p.x;
      this.cam.y = p.y;
      this._clampCamera();
      this.camReady = true;
    }

    _updateCamera(dt) {
      if (!this.camReady) {
        if (!this.target) this.cam.x = this.world.width / 2;
        this._snapToGoal();
      }
      const p = this._cameraGoal(this.box);
      const k = 1 - Math.exp(-dt * 3.4);
      if (this.target) this.cam.x += (p.x - this.cam.x) * k;
      this.cam.y += (p.y - this.cam.y) * k * 0.7;
      this._clampCamera();
      this._computeTransform();
    }

    _computeTransform() {
      const z = this.cam.zoom, dpr = this.dpr;
      this.k = z * dpr;
      this.ox = Math.round((this.w / 2 - this.cam.x * z) * dpr);
      this.oy = Math.round((this.h / 2 - this.cam.y * z) * dpr);
      this.vx0 = -this.ox / this.k;
      this.vx1 = (this.canvas.width - this.ox) / this.k;
      this.vy0 = -this.oy / this.k;
      this.vy1 = (this.canvas.height - this.oy) / this.k;
      let li = 0;
      while (li < NL - 1 && LEVELS[li] < this.k * 0.92) li++;
      this.levelIdx = li;
    }

    _setWorldTransform(g) { g.setTransform(this.k, 0, 0, this.k, this.ox, this.oy); }

    // Set a local transform at world (x, y), rotated or skewed (for swaying plants)
    _setLocal(g, x, y, rot, skew) {
      const k = this.k;
      if (rot) {
        const c = Math.cos(rot) * k, s = Math.sin(rot) * k;
        g.setTransform(c, s, -s, c, x * k + this.ox, y * k + this.oy);
      } else {
        g.setTransform(k, 0, skew * k, k, x * k + this.ox, y * k + this.oy);
      }
    }

    // ---- Sprite cache: rec.sp[season * NL + level] ----
    _sprite(rec, si, force) {
      const base = si * NL, li = this.levelIdx;
      let sp = rec.sp[base + li];
      if (sp) { sp.used = this.frameNo; return sp; }
      let fb = null;
      for (let d = 1; d < NL && !fb; d++) {
        if (li + d < NL && rec.sp[base + li + d]) fb = rec.sp[base + li + d];
        else if (li - d >= 0 && rec.sp[base + li - d]) fb = rec.sp[base + li - d];
      }
      if (this.buildsLeft > 0 || (force && !fb)) {
        this.buildsLeft--;
        return this._buildSprite(rec, si, li);
      }
      if (fb) fb.used = this.frameNo;
      return fb;
    }

    _buildSprite(rec, si, li) {
      const L = LEVELS[li];
      const canvas = makeCanvas(rec.bw * L, rec.bh * L);
      const g = canvas.getContext('2d');
      g.setTransform(L, 0, 0, L, -rec.bx0 * L, -rec.by0 * L);
      g.lineJoin = 'round';
      switch (rec.kind) {
        case KIND.TILE: Paint.paintTile(g, this.info, rec.bx0, rec.by0, rec.bx0 + rec.bw, rec.by0 + rec.bh, si); break;
        case KIND.TREE: Paint.paintTree(g, rec.f, si, rec); break;
        case KIND.GRASS: Paint.paintGrass(g, rec.f, si, rec); break;
        case KIND.LOG: Paint.paintLog(g, rec.f, si, rec); break;
        case KIND.ROCK: Paint.paintRock(g, rec.f, si, rec); break;
        case KIND.REEDS: Paint.paintReeds(g, rec.f, si, rec); break;
        case KIND.THORN: Paint.paintThorn(g, rec.f, si, rec); break;
        case KIND.PLAT_LOG: Paint.paintPlatformLog(g, rec.f, si, rec); break;
        case KIND.PLAT_ROCK: Paint.paintPlatformRock(g, rec.f, si, rec); break;
      }
      const sp = { canvas, used: this.frameNo, px: canvas.width * canvas.height, rec, idx: si * NL + li };
      rec.sp[sp.idx] = sp;
      this.sprites.push(sp);
      this.spritePx += sp.px;
      if (this.spritePx > SPRITE_BUDGET) this._evict();
      return sp;
    }

    _evict() {
      this.sprites.sort((a, b) => a.used - b.used);
      let i = 0;
      while (this.spritePx > SPRITE_BUDGET * 0.7 && i < this.sprites.length) {
        const sp = this.sprites[i];
        if (sp.used >= this.frameNo - 1) break;
        sp.rec.sp[sp.idx] = null;
        this.spritePx -= sp.px;
        sp.canvas.width = sp.canvas.height = 0;
        i++;
      }
      this.sprites.splice(0, i);
    }

    // Feature record: bounds + fixed structure, rebuilt if the feature's shape changes
    _featRec(f) {
      const kind = FEATURE_KIND[f.kind];
      if (kind === undefined) return null;
      // A rock or log may carry a platform (its walkable top): then it is shaped to that height
      const plat = kind === KIND.LOG || kind === KIND.ROCK ? this._platformOn(f) : null;
      const top = plat ? Math.round(f.y - plat.y) : 0;
      const sig = (f.height || 0) * 7 + (f.canopy || 0) * 13 + (f.width || 0) * 17 + (f.length || 0) * 19 + (f.w || 0) * 23 +
        (f.h || 0) * 29 + (f.radius || 0) * 31 + (f.species === 'mimic' ? 1 : 0) + top * 37;
      let rec = this.featRecs.get(f.id);
      if (rec && rec.sig === sig && rec.kind === kind) { rec.f = f; return rec; }
      rec = { kind, f, sig, top, sp: new Array(SEASON_COUNT * NL).fill(null), data: null, bx0: 0, by0: 0, bw: 1, bh: 1, phase: hash2(f.id | 0, 5) * TAU };
      switch (kind) {
        case KIND.TREE: {
          const s = rec.data = Paint.treeStructure(f);
          rec.bx0 = -s.cr * 1.4; rec.bw = s.cr * 2.8;
          rec.by0 = -s.H - s.cr * 0.2 - 8; rec.bh = -rec.by0 + 10;
          break;
        }
        case KIND.GRASS: {
          const s = rec.data = Paint.grassStructure(f);
          rec.bx0 = -s.w * 0.5 - s.h * 0.6 - 4; rec.bw = s.w + s.h * 1.2 + 8;
          rec.by0 = -s.h * 1.25 - 10; rec.bh = -rec.by0 + 6;
          break;
        }
        case KIND.LOG: {
          const L = f.length, top = rec.top;
          const d = top ? clamp(top + 3, 14, 44) : clamp(L * 0.24, 20, 34);
          // Where the ground falls away under the log, a stone props it up
          const props = [];
          let deepest = 0;
          for (const u of [-0.36, 0.36]) {
            const gap = this.info.surf(f.x + u * L) - f.y;
            if (gap > 3) { props.push({ x: u * L, gap }); deepest = Math.max(deepest, gap); }
          }
          rec.data = { d, props };
          rec.bx0 = -L / 2 - d * 0.4; rec.bw = L + d * 0.8;
          rec.by0 = -d - 12; rec.bh = d + 18 + deepest;
          break;
        }
        case KIND.ROCK: {
          const s = rec.data = Paint.rockShape(f, rec.top);
          rec.bx0 = -s.w / 2 - 10; rec.bw = s.w + 20;
          rec.by0 = -s.h * 1.2 - 10; rec.bh = s.h * 1.2 + 18;
          break;
        }
        case KIND.REEDS: {
          const s = rec.data = Paint.reedStructure(f);
          rec.bx0 = -s.w / 2 - 36; rec.bw = s.w + 72;
          rec.by0 = -110; rec.bh = 116;
          break;
        }
        case KIND.THORN: {
          const r = f.radius;
          rec.bx0 = -r * 1.75 - 6; rec.bw = r * 3.5 + 12;
          rec.by0 = -r * 2.2 - 6; rec.bh = r * 2.2 + 12;
          break;
        }
      }
      this.featRecs.set(f.id, rec);
      return rec;
    }

    // The rock or log feature whose top a platform is, if any
    _platformOn(f) {
      const ps = this.world.platforms;
      const log = f.kind === 'log';
      const reach = log ? f.length / 2 : f.w / 2;
      const height = log ? 60 : f.h * 1.5 + 10;
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i];
        if (Math.abs((p.x0 + p.x1) / 2 - f.x) < 14 && p.x1 - p.x0 <= reach * 2 + 16 && p.y < f.y && p.y > f.y - height) return p;
      }
      return null;
    }

    _platRec(p, i) {
      let rec = this.platRecs[i];
      const fs = this.world.features;
      const sig = p.x0 * 3 + p.x1 * 7 + p.y * 11 + (p.kind === 'rock' ? 1 : 2) + fs.length * 1e7;
      if (rec && rec.sig === sig) { rec.f = p; return rec; }
      // Platforms on top of a rock or log feature are drawn by that feature
      let owned = false;
      for (let k = 0; k < fs.length && !owned; k++) {
        const f = fs[k];
        if ((f.kind === 'rock' || f.kind === 'log') && this._platformOn(f) === p) owned = true;
      }
      const L = p.x1 - p.x0;
      const rock = p.kind === 'rock';
      const gap = rock ? this.info.surf((p.x0 + p.x1) / 2) - p.y : 0;
      rec = { kind: rock ? KIND.PLAT_ROCK : KIND.PLAT_LOG, f: p, sig, owned, sp: new Array(SEASON_COUNT * NL).fill(null), data: { gap } };
      rec.bx0 = rock ? -26 : -10; rec.bw = L + (rock ? 52 : 20);
      rec.by0 = -12; rec.bh = rock ? Math.max(34, gap + 22) : 34;
      this.platRecs[i] = rec;
      return rec;
    }

    // ---------------------------------------------------------------------------- the frame

    // Draw the whole scene. t = seconds.
    render(t) {
      const world = this.world;
      if (!world) return;
      if (t === undefined) t = performance.now() / 1000;
      const dt = this.lastT === null ? 1 / 60 : clamp(t - this.lastT, 0, 0.1);
      this.lastT = t;
      this.t = t;
      this.frameNo++;
      this._sync();
      if (this.w <= 1) this.resize();
      this._updateCamera(dt);
      this.sky.update(world, t);
      this.ss = this.sky.ss;
      this.wind = 0.65 + 0.35 * Math.sin(t * 0.21) + 0.15 * Math.sin(t * 0.53 + 1);
      this.buildsLeft = BUILDS_PER_FRAME;
      this._preparePoses();

      const g = this.ctx;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, this.canvas.width, this.canvas.height);
      g.imageSmoothingEnabled = true;

      // The lit scene, back to front
      this.sky.drawBackdrop(g, this);
      this._drawTerrain(g);
      this._drawFeatures(g, t, false);
      this._setWorldTransform(g);
      this._drawShadows(g);
      this._drawItems(g, t, false);
      this._drawCreatures(g, t);
      this._drawItems(g, t, true);
      Evo.Water.draw(g, this, t);
      this._drawFeatures(g, t, true);
      this.weather.update(this, dt, t);
      this._setWorldTransform(g);
      this.weather.draw(g);
      this._applyLight(g);
      // The sky goes behind everything drawn so far
      this.sky.drawSky(g, this, t);
      // Things that give off light, then the frame
      this._setWorldTransform(g);
      this._drawGlow(g, t);
      this._drawVignette(g);
      // Overlays
      this._setWorldTransform(g);
      if (this.options.showScent) this._drawScent(g);
      if (this.options.showSenses) this._drawSenses(g, t);
      this._drawSounds(g, t);
      this._drawHand(g, t);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }

    _drawTerrain(g) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      const cols = this.tileCols, rows = this.tileRows;
      const i0 = Math.max(0, Math.floor(this.vx0 / TILE)), i1 = Math.min(cols - 1, Math.floor(this.vx1 / TILE));
      const j0 = Math.max(0, Math.floor(this.vy0 / TILE)), j1 = Math.min(rows - 1, Math.floor(this.vy1 / TILE));
      const ss = this.ss, k = this.k;
      for (let pass = 0; pass < 2; pass++) {
        if (pass && ss.blend <= 0.001 && !ss.prefetch) break;
        const si = pass ? ss.next : ss.cur;
        g.globalAlpha = pass ? ss.blend : 1;
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const rec = this.tiles[j * cols + i];
            if (rec.empty) continue;
            const sp = this._sprite(rec, si, !pass);
            if (!sp || g.globalAlpha < 0.002) continue;
            const dx0 = Math.round(rec.bx0 * k + this.ox), dx1 = Math.round((rec.bx0 + TILE) * k + this.ox);
            const dy0 = Math.round(rec.by0 * k + this.oy), dy1 = Math.round((rec.by0 + TILE) * k + this.oy);
            g.drawImage(sp.canvas, dx0, dy0, dx1 - dx0, dy1 - dy0);
          }
        }
      }
      g.globalAlpha = 1;
    }

    _visible(rec, x, y, margin) {
      return x + rec.bx0 + rec.bw > this.vx0 - margin && x + rec.bx0 < this.vx1 + margin &&
        y + rec.by0 + rec.bh > this.vy0 - margin && y + rec.by0 < this.vy1 + margin;
    }

    _drawFeatures(g, t, front) {
      const fs = this.world.features;
      const passes = front ? FRONT_PASSES : BACK_PASSES;
      for (let pi = 0; pi < passes.length; pi++) {
        const kinds = passes[pi];
        if (!kinds) { this._drawPlatforms(g); continue; }
        for (let i = 0; i < fs.length; i++) {
          const f = fs[i];
          const kind = FEATURE_KIND[f.kind];
          if (kind !== kinds[0] && kind !== kinds[1]) continue;
          const rec = this._featRec(f);
          if (!rec || !this._visible(rec, f.x, f.y, 40)) continue;
          this._drawFeature(g, rec, f, t);
        }
      }
    }

    _drawFeature(g, rec, f, t) {
      const ss = this.ss;
      let rot = 0, skew = 0;
      const w = this.wind;
      switch (rec.kind) {
        case KIND.TREE: rot = (0.004 + 0.003 * w) * Math.sin(t * 0.8 + rec.phase) + 0.002 * Math.sin(t * 2.1 + rec.phase); break;
        case KIND.GRASS: skew = -(0.05 * w + 0.07 * Math.sin(t * 1.5 + rec.phase) + 0.02 * Math.sin(t * 3.7 + rec.phase)); break;
        case KIND.REEDS: skew = -(0.04 * w + 0.05 * Math.sin(t * 1.2 + rec.phase)); break;
      }
      for (let pass = 0; pass < 2; pass++) {
        if (pass && ss.blend <= 0.001 && !ss.prefetch) break;
        const si = pass ? ss.next : ss.cur;
        const sp = this._sprite(rec, si, !pass);
        const a = pass ? ss.blend : 1;
        if (!sp || a < 0.002) continue;
        this._setLocal(g, f.x, f.y, rot, skew);
        g.globalAlpha = a;
        g.drawImage(sp.canvas, rec.bx0, rec.by0, rec.bw, rec.bh);
      }
      g.globalAlpha = 1;
      // Live parts on top, in the same swaying frame
      if (rec.kind === KIND.TREE && f.fruiting > 0.01) this._drawTreeFruit(g, rec, f, t);
      else if (rec.kind === KIND.GRASS && f.seeding > 0.01) this._drawSeedHeads(g, rec, f);
      else if (rec.kind === KIND.ROCK && f.warm > 0.05) this._drawHeatShimmer(g, rec, f, t);
    }

    _drawPlatforms(g) {
      const ps = this.world.platforms;
      const ss = this.ss;
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i];
        const rec = this._platRec(p, i);
        if (rec.owned || !this._visible(rec, p.x0, p.y, 20)) continue;
        for (let pass = 0; pass < 2; pass++) {
          if (pass && ss.blend <= 0.001 && !ss.prefetch) break;
          const sp = this._sprite(rec, pass ? ss.next : ss.cur, !pass);
          const a = pass ? ss.blend : 1;
          if (!sp || a < 0.002) continue;
          this._setLocal(g, p.x0, p.y, 0, 0);
          g.globalAlpha = a;
          g.drawImage(sp.canvas, rec.bx0, rec.by0, rec.bw, rec.bh);
        }
        g.globalAlpha = 1;
      }
    }

    _drawTreeFruit(g, rec, f, t) {
      const pts = rec.data.fruit;
      const n = Math.min(pts.length, Math.round(f.fruiting * pts.length));
      const it = this.fake;
      it.type = f.species === 'mimic' ? 'mimic' : 'fruit';
      it.radius = 4.3;
      const lift = it.radius * (Evo.ItemArt.LIFT[it.type] || 1);
      for (let k = 0; k < n; k++) {
        it.id = k;
        it.x = pts[k].x;
        it.y = pts[k].y + lift; // the fruit's centre on the spot
        it.rot = Math.sin(t * 1.3 + k + rec.phase) * 0.12;
        Evo.ItemArt.draw(g, it, t);
      }
    }

    _drawSeedHeads(g, rec, f) {
      const heads = rec.data.heads;
      const n = Math.min(heads.length, Math.round(f.seeding * heads.length));
      if (!n) return;
      const IC = this._itemColors();
      g.strokeStyle = this.ss.cur === WINTER ? '#b5a882' : '#b39a52';
      g.lineWidth = 1;
      g.beginPath();
      for (let k = 0; k < n; k++) {
        const h = heads[k];
        g.moveTo(h.x, 2);
        g.quadraticCurveTo(h.x, -h.h * 0.5, h.x + h.lean * h.h, -h.h);
      }
      g.stroke();
      g.fillStyle = IC.grain;
      g.strokeStyle = IC.grainDark;
      g.lineWidth = 0.6;
      g.beginPath();
      for (let k = 0; k < n; k++) {
        const h = heads[k];
        const tx = h.x + h.lean * h.h, ty = -h.h;
        for (let s = 0; s < 4; s++) {
          const y = ty + s * 2.6 + 1.5, x = tx - h.lean * s * 2.6;
          g.moveTo(x + 0.2, y); g.ellipse(x - 1.2, y, 1.5, 0.95, -0.7, 0, TAU);
          g.moveTo(x + 2.6, y); g.ellipse(x + 1.2, y, 1.5, 0.95, 0.7, 0, TAU);
        }
        g.moveTo(tx + 1, ty - 0.5); g.ellipse(tx, ty - 0.5, 1, 1.6, 0, 0, TAU);
      }
      g.fill();
      g.stroke();
    }

    _itemColors() {
      if (!this.ic) {
        const grain = Evo.theme.color('--grain');
        this.ic = { grain, grainDark: rgb(scale(Evo.theme.hexRgb(grain), 0.6)) };
      }
      return this.ic;
    }

    // Warm air rising off the rock: faint wavering strands that fade as they rise
    _drawHeatShimmer(g, rec, f, t) {
      const s = rec.data, a = clamp01((f.warm - 0.05) / 0.6);
      g.lineWidth = 0.9;
      for (let k = 0; k < 4; k++) {
        const u = (t * 0.45 + k * 0.25) % 1;
        const x0 = (k - 1.5) * s.w * 0.2;
        const y0 = -s.h * 0.95 - u * 26;
        g.strokeStyle = 'rgba(255,238,215,' + (0.3 * a * Math.sin(u * Math.PI)).toFixed(3) + ')';
        g.beginPath();
        for (let j = 0; j <= 6; j++) {
          const y = y0 - j * 2, x = x0 + Math.sin(j * 0.8 + t * 4 + k * 2) * 1.4;
          j ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.stroke();
      }
    }

    // Poses are computed once per frame (culled to the view) and reused for shadows, drawing and hover
    _preparePoses() {
      const cs = this.world.creatures;
      const poses = this.poses;
      poses.length = cs.length;
      // The art draws each posed creature's shadow and focus ring; the view does for placeholders
      const useArt = !this.artBroken;
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i];
        const vis = c.x > this.vx0 - 90 && c.x < this.vx1 + 90 && c.y > this.vy0 - 90 && c.y < this.vy1 + 140;
        const pose = poses[i] = vis && useArt ? this._safePose(c) : null;
        // Where the ground is, so a jumping creature's shadow stays on it (an optional pose field)
        if (pose) pose.groundY = this.world.surfaceBelow(c.x, c.y - 1);
      }
      // Hover under the hand
      this.hoveredCreature = null;
      this.hoveredItem = null;
      const hand = this.options.hand;
      if (hand && hand.x != null) {
        const p = this.screenToWorld(hand.x, hand.y);
        let bestD = Infinity;
        for (let i = 0; i < cs.length; i++) {
          const d = this._creatureHit(cs[i], poses[i], p.x, p.y, 4 / this.cam.zoom);
          if (d < bestD) { bestD = d; this.hoveredCreature = cs[i]; }
        }
        if (!this.hoveredCreature && hand.mode === 'grab' && !hand.holding) this.hoveredItem = this._itemAtWorld(p.x, p.y, 6 / this.cam.zoom);
      }
      const focused = this._focused();
      for (let i = 0; i < cs.length; i++) {
        const pose = poses[i];
        if (!pose) continue;
        pose.focused = cs[i] === focused;
        pose.hovered = cs[i] === this.hoveredCreature;
      }
    }

    _safePose(c) {
      try { return Evo.poseOf(c); } catch (err) { this._artFailed(err); return null; }
    }

    _artFailed(err) {
      if (!this.artBroken) console.warn('WorldView: creature art failed, using placeholders', err);
      this.artBroken = true;
    }

    _poseFor(c, i) {
      const p = this.poses[i];
      if (p && this.world.creatures[i] === c) return p;
      return this.artBroken ? null : this._safePose(c);
    }

    // Distance-like score of a hit (Infinity if missed)
    _creatureHit(c, pose, x, y, pad) {
      if (pose) {
        const b = Evo.CreatureArt.bounds(pose);
        if (x < b.x0 - pad || x > b.x1 + pad || y < b.y0 - pad || y > b.y1 + pad) return Infinity;
        return Math.hypot(x - (b.x0 + b.x1) / 2, y - (b.y0 + b.y1) / 2);
      }
      const r = c.size * 0.6 + pad;
      const d = Math.hypot(x - c.x, y - (c.y - 15));
      return d < r ? d : Infinity;
    }

    _itemAtWorld(x, y, pad) {
      const items = this.world.items;
      let best = null, bestD = Infinity;
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        const r = Math.max(it.radius * 1.5, pad * 1.4) + pad;
        const d = Math.hypot(x - it.x, y - Evo.ItemArt.centerY(it));
        if (d < r && d < bestD) { bestD = d; best = it; }
      }
      return best;
    }

    _focused() {
      const f = this.options.focused;
      if (f == null) return null;
      if (typeof f === 'object') return f;
      const cs = this.world.creatures;
      for (let i = 0; i < cs.length; i++) if (cs[i].id === f) return cs[i];
      return null;
    }

    _drawShadows(g) {
      const items = this.world.items, cs = this.world.creatures;
      g.fillStyle = 'rgba(28,20,36,0.2)';
      g.beginPath();
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.held || it.x < this.vx0 - 20 || it.x > this.vx1 + 20) continue;
        const r = it.radius;
        const sy = this.world.surfaceBelow(it.x, it.y - 1);
        const gap = sy - it.y;
        if (gap > 70 || gap < -r * 2 || this._floatDepth(it) >= 0) continue;
        const k = 1 - clamp01(gap / 70);
        const rx = r * (0.7 + 0.45 * k);
        g.moveTo(it.x + rx, sy);
        g.ellipse(it.x, sy, rx, rx * 0.3, 0, 0, TAU);
      }
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i];
        if (c.x < this.vx0 - 60 || c.x > this.vx1 + 60 || c.held || this.poses[i]) continue;
        const size = c.size;
        const sy = this.world.surfaceBelow(c.x, c.y);
        const gap = sy - c.y;
        if (gap > 120 || gap < -20) continue;
        const k = 1 - clamp01(gap / 120);
        const rx = size * (0.3 + 0.28 * k);
        g.moveTo(c.x + rx, sy);
        g.ellipse(c.x, sy, rx, rx * 0.26, 0, 0, TAU);
      }
      g.fill();
    }

    _drawItems(g, t, held) {
      const items = this.world.items;
      const art = Evo.ItemArt, m = 30;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!!it.held !== held) continue;
        if (it.x < this.vx0 - m || it.x > this.vx1 + m || it.y < this.vy0 - m || it.y > this.vy1 + m) continue;
        if (it === this.hoveredItem) {
          const r = it.radius * 1.9 + 1.5 * Math.sin(t * 5);
          g.strokeStyle = 'rgba(255,255,255,0.8)';
          g.lineWidth = 1.4;
          g.beginPath(); g.arc(it.x, art.centerY(it), r, 0, TAU); g.stroke();
          g.fillStyle = 'rgba(255,255,255,0.14)';
          g.fill();
        }
        // Things floating on a pond sit half in the water and bob
        const float = held ? -1 : this._floatDepth(it);
        art.draw(g, it, t, float >= 0 ? it.radius * 0.55 + Math.sin(t * 1.7 + (it.id | 0)) * 0.9 : 0);
      }
    }

    // >= 0 when an item rests on a pond's surface (how far above the bed), else -1
    _floatDepth(it) {
      if (it.held) return -1;
      const wl = this.info.waterAt(it.x);
      if (wl === null || it.y < wl - 1.5 || it.y > wl + 1.5) return -1;
      const d = this.info.surf(it.x) - wl;
      return d > 2 ? d : -1;
    }

    _drawCreatures(g, t) {
      const cs = this.world.creatures;
      const focused = this._focused();
      const art = Evo.CreatureArt;
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < cs.length; i++) {
          const c = cs[i];
          if ((c === focused) !== (pass === 1)) continue;
          if (c.x < this.vx0 - 90 || c.x > this.vx1 + 90 || c.y < this.vy0 - 90 || c.y > this.vy1 + 140) continue;
          const pose = this.poses[i];
          const ring = c === focused && !pose; // posed creatures get their ring from the art
          if (ring) this._drawFocusRing(g, c, t, true);
          this._setWorldTransform(g);
          if (pose && !this.artBroken) {
            try { art.draw(g, pose, t); } catch (err) { this._artFailed(err); this._drawPlaceholder(g, c); }
          } else {
            this._drawPlaceholder(g, c);
          }
          this._setWorldTransform(g);
          g.globalAlpha = 1;
          if (ring) this._drawFocusRing(g, c, t, false);
        }
      }
    }

    // A glowing ring on the ground under the focused creature: back half behind it, front half in front
    _drawFocusRing(g, c, t, back) {
      const size = c.size;
      const sy = this.world.surfaceBelow(c.x, c.y - 2);
      const rx = size * 0.55 + 6, ry = rx * 0.28;
      const pulse = 0.5 + 0.5 * Math.sin(t * 3);
      g.lineWidth = 2;
      g.strokeStyle = 'rgba(155,227,200,' + (0.55 + 0.35 * pulse).toFixed(3) + ')';
      g.beginPath();
      g.ellipse(c.x, sy, rx, ry, 0, back ? Math.PI : 0, back ? TAU : Math.PI);
      g.stroke();
      if (back) {
        g.fillStyle = 'rgba(155,227,200,0.14)';
        g.beginPath(); g.ellipse(c.x, sy, rx, ry, 0, 0, TAU); g.fill();
      }
    }

    // A simple round critter, drawn instead once Evo.poseOf or Evo.CreatureArt has thrown
    // (see _artFailed), so one bug in the art doesn't blank the world
    _drawPlaceholder(g, c) {
      const size = c.size, dir = c.facing < 0 ? -1 : 1, hue = c.traits.hue;
      const walk = Math.sin(c.x * 0.25);
      g.save();
      g.translate(c.x, c.y);
      g.scale(dir, 1);
      const bw = size * 0.46, bh = size * 0.3, leg = size * 0.22;
      g.strokeStyle = `hsl(${hue},35%,30%)`;
      g.lineWidth = size * 0.07;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(-bw * 0.4, -leg); g.lineTo(-bw * 0.4 + walk * 3, 0);
      g.moveTo(bw * 0.4, -leg); g.lineTo(bw * 0.4 - walk * 3, 0);
      g.stroke();
      g.fillStyle = `hsl(${hue},55%,62%)`;
      g.beginPath(); g.ellipse(0, -leg - bh * 0.8, bw, bh, 0, 0, TAU); g.fill(); g.stroke();
      g.beginPath(); g.arc(bw * 0.85, -leg - bh * 1.6, bh * 0.85, 0, TAU); g.fill(); g.stroke();
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(bw * 1.05, -leg - bh * 1.75, bh * 0.3, 0, TAU); g.fill();
      g.fillStyle = '#222';
      g.beginPath(); g.arc(bw * 1.12, -leg - bh * 1.72, bh * 0.15, 0, TAU); g.fill();
      g.restore();
    }

    // ---- Weather and seasonal particles (pooled, world space) ----

    // Night and twilight: tint everything drawn so far (the sky is painted behind afterwards)
    _applyLight(g) {
      const pal = this.sky.pal;
      if (pal.ambA < 0.004) return;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'source-atop';
      g.globalAlpha = pal.ambA;
      g.fillStyle = pal.ambCss;
      g.fillRect(0, 0, this.canvas.width, this.canvas.height);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }

    // Emissive things, added on top of the lit scene
    _drawGlow(g, t) {
      const pal = this.sky.pal, night = pal.night, gl = this.glows;
      g.globalCompositeOperation = 'lighter';
      // The warm rock
      const fs = this.world.features;
      for (let i = 0; i < fs.length; i++) {
        const f = fs[i];
        if (f.kind !== 'rock' || !(f.warm > 0.03) || f.x < this.vx0 - 100 || f.x > this.vx1 + 100) continue;
        const w = f.w, h = f.h;
        g.globalAlpha = clamp01(f.warm) * (0.22 + 0.4 * night) * (0.9 + 0.1 * Math.sin(t * 2 + i));
        g.drawImage(gl.warm, f.x - w * 0.95, f.y - h * 1.45, w * 1.9, h * 1.9);
      }
      // Lures glow softly, more at night; eggs about to hatch too
      const items = this.world.items;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.x < this.vx0 - 40 || it.x > this.vx1 + 40) continue;
        if (it.type === 'lure') {
          const r = it.radius * 5, cy = Evo.ItemArt.centerY(it);
          g.globalAlpha = (0.12 + 0.4 * night) * (0.8 + 0.2 * Math.sin(t * 2.4 + i));
          g.drawImage(gl.lure, it.x - r, cy - r * 1.1, r * 2, r * 2);
        } else if (it.type === 'egg' && it.progress > 0.8) {
          const r = it.radius * 3, cy = Evo.ItemArt.centerY(it);
          g.globalAlpha = (it.progress - 0.8) * 1.4 * (0.6 + 0.4 * Math.sin(t * 3 + i));
          g.drawImage(gl.egg, it.x - r, cy - r, r * 2, r * 2);
        }
      }
      this.weather.drawFireflies(g, gl.fly, night, t);
      Evo.Water.drawGlints(g, this, t);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }

    _drawVignette(g) {
      const dpr = this.dpr, w = this.w, h = this.h;
      if (!this.vignette) {
        const grd = g.createRadialGradient(w / 2, h * 0.46, Math.min(w, h) * 0.38, w / 2, h * 0.46, Math.hypot(w / 2, h / 2) * 1.1);
        grd.addColorStop(0, 'rgba(12,14,30,0)');
        grd.addColorStop(1, 'rgba(12,14,30,0.6)');
        this.vignette = grd;
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.globalAlpha = 0.45 + 0.4 * this.sky.pal.night;
      g.fillStyle = this.vignette;
      g.fillRect(0, 0, w, h);
      g.globalAlpha = 1;
    }

    // ---- Overlays ----

    // The scent field as a soft low-resolution image (cells under the ground are left clear)
    _drawScent(g) {
      const sc = this.world.scent;
      let S = this.scent;
      if (!S || S.cols !== sc.cols || S.rows !== sc.rows || S.cell !== sc.cell || S.nch !== sc.channels.length) {
        const canvas = makeCanvas(sc.cols, sc.rows);
        const cg = canvas.getContext('2d');
        const colors = [];
        for (let ch = 0; ch < sc.channels.length; ch++) {
          colors.push(Evo.theme.rgb(Evo.SCENTS[ch].token));
        }
        const air = new Uint8Array(sc.cols * sc.rows);
        for (let j = 0; j < sc.rows; j++) {
          for (let i = 0; i < sc.cols; i++) {
            const x = (i + 0.5) * sc.cell, y = (j + 0.5) * sc.cell;
            air[j * sc.cols + i] = y < this.info.surf(x) + sc.cell * 0.3 ? 1 : 0;
          }
        }
        S = this.scent = { cols: sc.cols, rows: sc.rows, cell: sc.cell, nch: sc.channels.length, canvas, cg, img: cg.createImageData(sc.cols, sc.rows), colors, air, frame: -1 };
      }
      if (S.frame !== this.frameNo) {
        S.frame = this.frameNo;
        const px = S.img.data, colors = S.colors, chans = sc.channels, n = sc.cols * sc.rows;
        for (let i = 0; i < n; i++) {
          const o = i * 4;
          if (!S.air[i]) { px[o + 3] = 0; continue; }
          let R = 0, G = 0, B = 0, total = 0;
          for (let ch = 0; ch < chans.length; ch++) {
            const v = chans[ch][i];
            if (v <= 0) continue;
            const c = colors[ch];
            R += c[0] * v; G += c[1] * v; B += c[2] * v; total += v;
          }
          if (total > 0.004) {
            px[o] = R / total; px[o + 1] = G / total; px[o + 2] = B / total;
            px[o + 3] = Math.min(140, Math.sqrt(total) * 105);
          } else {
            px[o + 3] = 0;
          }
        }
        S.cg.putImageData(S.img, 0, 0);
      }
      g.imageSmoothingEnabled = true;
      g.globalAlpha = 1;
      g.drawImage(S.canvas, 0, 0, sc.cols * sc.cell, sc.rows * sc.cell);
    }

    _drawSenses(g, t) {
      const c = this._focused();
      if (c && this.onDrawSenses) this.onDrawSenses(g, c, this, t);
      this._setWorldTransform(g);
    }

    // Calls rise as little music notes and fade
    _drawSounds(g, t) {
      const ss = this.world.sounds;
      for (let i = 0; i < ss.length; i++) {
        const s = ss[i];
        const a = s.age / SOUND_LIFE;
        if (a < 0 || a >= 1 || s.x < this.vx0 - 40 || s.x > this.vx1 + 40) continue;
        const loud = clamp01(s.loudness);
        const alpha = Math.min(1, a * 8) * Math.pow(1 - a, 1.2);
        const high = s.pitch >= 0.5;
        const size = 0.8 + loud * 0.5;
        const x = s.x + Math.sin(a * 6 + (s.sourceId | 0)) * 5;
        const y = s.y - 6 - a * 42;
        this._note(g, x, y, size, high, alpha, high ? '#bff3ff' : '#ffe2a8');
        if (loud > 0.45 && a > 0.12) {
          const b = a - 0.12;
          this._note(g, s.x + 9 + Math.sin(b * 6) * 4, s.y - 2 - b * 42, size * 0.8, high, Math.min(1, b * 8) * Math.pow(1 - a, 1.2), high ? '#bff3ff' : '#ffe2a8');
        }
      }
      g.globalAlpha = 1;
    }

    _note(g, x, y, s, high, alpha, col) {
      g.globalAlpha = alpha;
      g.lineWidth = 1.1 * s;
      g.strokeStyle = 'rgba(30,24,44,0.75)';
      g.fillStyle = col;
      g.lineCap = 'round';
      // Stem and flag
      const draw = pass => {
        g.beginPath();
        g.moveTo(x + 3 * s, y);
        g.lineTo(x + 3 * s, y - 9 * s);
        if (high) g.quadraticCurveTo(x + 7 * s, y - 7 * s, x + 6.5 * s, y - 3 * s);
        else { g.lineTo(x + 10 * s, y - 11 * s); g.lineTo(x + 10 * s, y - 2 * s); }
        g.lineWidth = (pass ? 1.3 : 3) * s;
        g.strokeStyle = pass ? col : 'rgba(30,24,44,0.75)';
        g.stroke();
        g.beginPath();
        g.ellipse(x, y, 3.2 * s, 2.3 * s, -0.35, 0, TAU);
        if (!high) { g.moveTo(x + 10 * s, y - 2 * s); g.ellipse(x + 7 * s, y - 2 * s, 3.2 * s, 2.3 * s, -0.35, 0, TAU); }
        if (pass) g.fill(); else { g.lineWidth = 1.6 * s; g.stroke(); }
      };
      draw(0);
      draw(1);
    }

    _drawHand(g, t) {
      const hand = this.options.hand;
      if (!hand || hand.x == null) return;
      const sx = hand.x, sy = hand.y;
      const dpr = this.dpr;
      // Drop shadow, then the hand
      for (let pass = 0; pass < 2; pass++) {
        g.setTransform(dpr, 0, 0, dpr, (sx + (pass ? 0 : 3)) * dpr, (sy + (pass ? 0 : 4)) * dpr);
        if (!pass) {
          g.globalAlpha = 0.25;
          g.save();
          // The same shape in a flat dark colour
          Evo.HandArt.drawSilhouette(g, hand.mode, hand.holding, t);
          g.restore();
          g.globalAlpha = 1;
        } else {
          Evo.HandArt.draw(g, hand.mode, hand.holding, t);
        }
      }
      g.setTransform(1, 0, 0, 1, 0, 0);
    }
  }

  WorldView.ZOOM_MIN = ZOOM_MIN;
  WorldView.ZOOM_MAX = ZOOM_MAX;
  WorldView.SOUND_LIFE = SOUND_LIFE;
  Evo.WorldView = WorldView;
})(globalThis.Evo);
