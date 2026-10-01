// WorldView: the camera, the sprite cache and the frame. Each frame it draws, back to front, the
// parallax backdrop (sky.js), terrain tiles and plants, rocks and logs (painters/*, via Evo.Paint),
// items (item-art.js), creatures (Evo.CreatureArt), ponds (water.js) and weather (weather.js); then
// the day/night light, the sky behind it all, glows, the vignette and the overlays: scent, senses,
// calls, creature cues (cues.js: thought bubbles, reactions, name tags, attention) and the player's
// hand (hand-art.js).
// Reads the world through the contract in docs/WORLD.md and never changes it.
//
// Static art (terrain tiles, plants, rocks, logs, reeds, thorn bushes) is painted once into
// offscreen sprites at a resolution matched to the zoom, per season, and blitted each frame.
// Everything else (water, items, creatures, fruit, shadows, particles, the sky, overlays) is drawn
// every frame.
(function (Evo) {
  'use strict';
  const { TAU, clamp, clamp01, hash2 } = Evo.util;
  const { makeCanvas } = Evo;
  const { rgba } = Evo.color;
  const Paint = Evo.Paint;
  const { seasonPasses } = Evo.Sky;
  const SEASON_COUNT = Evo.SEASON_COUNT;

  const ZOOM_MIN = 0.5, ZOOM_MAX = 2.5;
  const GROUND_AT = 0.72;               // where the ground line sits on screen (fraction of height)
  const SKY_ROOM = 420;                 // world px of scenery kept visible above the ground by default
  const LEVELS = [1, 1.5, 2, 3, 4];     // sprite resolutions, in device px per world px (4: a phone at 3 device px per CSS px, zoomed in)
  const NL = LEVELS.length;
  const TILE = 256;                     // terrain tile size (world px)
  const SPRITE_BUDGET = 24e6;           // cached sprite pixels before old ones are dropped
  const BUILDS_PER_FRAME = 3;           // sprite upgrades per frame (in the current season, one with nothing to stand in is built at once)
  const ALPHA_MIN = 0.002;              // in the season crossfade, sprites fainter than this aren't drawn
  const SOUND_LIFE = Evo.WORLD.SOUND_LIFE; // ticks a call stays visible (world.sounds[].age is in ticks)
  const NOTE_HIGH = '#bff3ff', NOTE_LOW = '#ffe2a8'; // a call's music notes, by pitch
  const NOTE_INK = 'rgba(30,24,44,0.75)';           // their dark outline
  const BODY_CENTRE_OFFSET = 15;        // world px from a creature's feet up to about the middle of its body
  const TREE_FRUIT_RADIUS = 4.3;        // the fruit drawn hanging on trees
  const KIND = { TILE: 0, TREE: 1, GRASS: 2, LOG: 3, ROCK: 4, REEDS: 5, THORN: 6 };
  const FEATURE_KIND = { tree: KIND.TREE, grass: KIND.GRASS, log: KIND.LOG, rock: KIND.ROCK, reeds: KIND.REEDS, thornbush: KIND.THORN };
  // Back-to-front passes over world.features; reeds stand in front of the water
  const BACK_PASSES = [[KIND.TREE], [KIND.LOG, KIND.ROCK], [KIND.THORN], [KIND.GRASS]];
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
      this.fit = { zoom: 1 };
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
      this.fake = { id: 0, type: 'fruit', x: 0, y: 0, radius: TREE_FRUIT_RADIUS, rot: 0, vx: 0, onGround: false };
      this.box = { x0: 0, y0: 0, x1: 0, y1: 0 };
      this.glows = {
        warm: glowSprite([255, 150, 70], 64), lure: glowSprite([255, 120, 190], 64),
        fly: glowSprite([220, 255, 120], 32), egg: glowSprite([255, 220, 150], 64),
      };
      this.weather = new Evo.Weather();
      this.cues = new Evo.CreatureCues();
      this.setWorld(world);
      this.resize();
    }

    // Swap in a different world (a new game). Rebuilds every cache.
    setWorld(world) {
      this.world = world;
      this.heights = null;
      this.tiles = [];
      this._dropCaches();
      this.camReady = false;
      this.weather.clear();
      if (world) this._sync();
    }

    get followed() { return this.target; }

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
        ay = (this.target.y - BODY_CENTRE_OFFSET - this.cam.y) * z0 + this.h / 2;
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
          for (let x = Math.max(0, x0 - Paint.TILE_MARGIN); x <= Math.min(world.width, x1 + Paint.TILE_MARGIN); x += 4) top = Math.min(top, this.info.surf(x));
          const cliff = (x0 < this.info.cliffReach || x1 > world.width - this.info.cliffReach) && y1 > this.info.cliffTop - 50;
          const empty = !cliff && y1 < top - 30;
          this.tiles[j * cols + i] = { kind: KIND.TILE, empty, bx0: x0, by0: j * TILE, bw: TILE, bh: TILE, sp: new Array(SEASON_COUNT * NL).fill(null) };
        }
      }
      this._dropCaches();
      if (this.w > 1) this._computeFit();
    }

    // Forget every sprite and the feature and scent records built from the old terrain
    _dropCaches() {
      for (const sp of this.sprites) sp.canvas.width = sp.canvas.height = 0;
      this.sprites = [];
      this.spritePx = 0;
      this.featRecs = new Map();
      this.scent = null;
      // Feature id -> the platform on top of it (a world's platforms are laid once, with its landscape)
      this.platformOf = new Map();
      if (this.world) for (const p of this.world.platforms) if (!this.platformOf.has(p.featureId)) this.platformOf.set(p.featureId, p);
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

    // Ground line under the middle of the view: the average surface (or pond surface) nearby, on the
    // valley floor (the cliffs rising at the ends would lift it)
    _groundLine(x, halfWidth) {
      const info = this.info, cliff = this.world.terrain.cliffs.width;
      let sum = 0, n = 0;
      for (let k = -4; k <= 4; k++) {
        const xx = clamp(x + (k / 4) * halfWidth, cliff, info.W - cliff);
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
        case KIND.THORN: Paint.paintThorn(g, rec.f, si); break;
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
      const plat = kind === KIND.LOG || kind === KIND.ROCK ? this.platformOf.get(f.id) : null;
      const top = plat ? Math.round(f.y - plat.y) : 0;
      const sig = [f.height, f.canopy, f.width, f.length, f.radius, f.species, top].join();
      let rec = this.featRecs.get(f.id);
      if (rec && rec.sig === sig && rec.kind === kind) { rec.f = f; return rec; }
      rec = { kind, f, sig, top, sp: new Array(SEASON_COUNT * NL).fill(null), data: null, bx0: 0, by0: 0, bw: 1, bh: 1, phase: hash2(f.id | 0, 5) * TAU };
      // The painter's shape function gives the feature's fixed shape and the box its sprite is painted in
      switch (kind) {
        case KIND.TREE: rec.data = Paint.treeStructure(f); break;
        case KIND.GRASS: rec.data = Paint.grassStructure(f); break;
        case KIND.LOG: rec.data = Paint.logShape(f, top, x => this.info.surf(x)); break;
        case KIND.ROCK: rec.data = Paint.rockShape(f, rec.top); break;
        case KIND.REEDS: rec.data = Paint.reedStructure(f); break;
        case KIND.THORN: rec.data = Paint.thornShape(f); break;
      }
      const b = rec.data.box;
      rec.bx0 = b.x0; rec.by0 = b.y0; rec.bw = b.w; rec.bh = b.h;
      this.featRecs.set(f.id, rec);
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
      this.sky.update(world);
      this.wind = 0.65 + 0.35 * Math.sin(t * 0.21) + 0.15 * Math.sin(t * 0.53 + 1);
      this.buildsLeft = BUILDS_PER_FRAME;
      this._preparePoses();

      const g = this.ctx;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
      g.lineCap = 'butt';
      g.lineJoin = 'miter';
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
      this._drawSounds(g);
      this.cues.draw(g, this, t);
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
      const k = this.k;
      seasonPasses(this.ss, (si, a, first) => {
        g.globalAlpha = a;
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const rec = this.tiles[j * cols + i];
            if (rec.empty) continue;
            const sp = this._sprite(rec, si, first);
            if (!sp || a < ALPHA_MIN) continue;
            const dx0 = Math.round(rec.bx0 * k + this.ox), dx1 = Math.round((rec.bx0 + TILE) * k + this.ox);
            const dy0 = Math.round(rec.by0 * k + this.oy), dy1 = Math.round((rec.by0 + TILE) * k + this.oy);
            g.drawImage(sp.canvas, dx0, dy0, dx1 - dx0, dy1 - dy0);
          }
        }
      });
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
        for (let i = 0; i < fs.length; i++) {
          const f = fs[i];
          const kind = FEATURE_KIND[f.kind];
          if (!kinds.includes(kind)) continue;
          const rec = this._featRec(f);
          if (!rec || !this._visible(rec, f.x, f.y, 40)) continue;
          this._drawFeature(g, rec, f, t);
        }
      }
    }

    _drawFeature(g, rec, f, t) {
      let rot = 0, skew = 0;
      const w = this.wind;
      switch (rec.kind) {
        case KIND.TREE: rot = (0.004 + 0.003 * w) * Math.sin(t * 0.8 + rec.phase) + 0.002 * Math.sin(t * 2.1 + rec.phase); break;
        case KIND.GRASS: skew = -(0.05 * w + 0.07 * Math.sin(t * 1.5 + rec.phase) + 0.02 * Math.sin(t * 3.7 + rec.phase)); break;
        case KIND.REEDS: skew = -(0.04 * w + 0.05 * Math.sin(t * 1.2 + rec.phase)); break;
      }
      seasonPasses(this.ss, (si, a, first) => {
        const sp = this._sprite(rec, si, first);
        if (!sp || a < ALPHA_MIN) return;
        this._setLocal(g, f.x, f.y, rot, skew);
        g.globalAlpha = a;
        g.drawImage(sp.canvas, rec.bx0, rec.by0, rec.bw, rec.bh);
      });
      g.globalAlpha = 1;
      // Live parts on top, in the same swaying frame
      if (rec.kind === KIND.TREE && f.fruiting > 0.01) this._drawTreeFruit(g, rec, f, t);
      else if (rec.kind === KIND.GRASS && f.seeding > 0.01) this._drawSeedHeads(g, rec, f);
      else if (rec.kind === KIND.ROCK && f.warm > 0.05) this._drawHeatShimmer(g, rec, f, t);
    }

    _drawTreeFruit(g, rec, f, t) {
      const pts = rec.data.fruit;
      const n = Math.min(pts.length, Math.round(f.fruiting * pts.length));
      const it = this.fake;
      it.type = f.species === 'mimic' ? 'mimic' : 'fruit';
      const lift = Evo.ItemArt.liftOf(it);
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
      const IC = Evo.ItemArt.colors();
      g.strokeStyle = Paint.DETAIL.seedHead[this.ss.cur];
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
      const focused = this.focused();
      for (let i = 0; i < cs.length; i++) {
        const pose = poses[i];
        if (!pose) continue;
        pose.focused = cs[i] === focused;
        pose.hovered = cs[i] === this.hoveredCreature;
      }
    }

    // This frame's pose of a creature (with groundY, focused and hovered), for the card and the
    // strip; creatures off screen get a fresh one
    poseFor(c) {
      const i = this.world.creatures.indexOf(c);
      return (i >= 0 && this.poses[i]) || Evo.poseOf(c, { world: this.world });
    }

    _safePose(c) {
      try { return Evo.poseOf(c, { world: this.world }); } catch (err) { this._artFailed(err); return null; }
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
      const d = Math.hypot(x - c.x, y - (c.y - BODY_CENTRE_OFFSET));
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

    focused() {
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
        if (it.heldBy || it.x < this.vx0 - 20 || it.x > this.vx1 + 20) continue;
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
        if (!!it.heldBy !== held) continue;
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
      if (it.heldBy) return -1;
      const wl = this.info.waterAt(it.x);
      if (wl === null || it.y < wl - 1.5 || it.y > wl + 1.5) return -1;
      const d = this.info.surf(it.x) - wl;
      return d > 2 ? d : -1;
    }

    _drawCreatures(g, t) {
      const cs = this.world.creatures;
      const focused = this.focused();
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
      g.strokeStyle = Evo.theme.rgba('--accent', (0.55 + 0.35 * pulse).toFixed(3));
      g.beginPath();
      g.ellipse(c.x, sy, rx, ry, 0, back ? Math.PI : 0, back ? TAU : Math.PI);
      g.stroke();
      if (back) {
        g.fillStyle = Evo.theme.rgba('--accent', 0.14);
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

    // ---- Light, glow and vignette ----

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
        const w = f.width, h = f.height;
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

    // The scent field as a soft low-resolution image (the world's solid cells are left clear)
    _drawScent(g) {
      const sc = this.world.scent;
      let S = this.scent;
      if (!S || S.cols !== sc.cols || S.rows !== sc.rows || S.cell !== sc.cell || S.nch !== sc.channels.length) {
        const canvas = makeCanvas(sc.cols, sc.rows);
        const cg = canvas.getContext('2d');
        S = this.scent = {
          cols: sc.cols, rows: sc.rows, cell: sc.cell, nch: sc.channels.length, canvas, cg, img: cg.createImageData(sc.cols, sc.rows),
          colors: sc.channels.map((_, ch) => Evo.theme.rgbOf(Evo.SCENTS[ch].token))
        };
      }
      const px = S.img.data, colors = S.colors, chans = sc.channels, solid = this.world.scentSolid, n = sc.cols * sc.rows;
      for (let i = 0; i < n; i++) {
        const o = i * 4;
        if (solid[i]) { px[o + 3] = 0; continue; }
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
      g.imageSmoothingEnabled = true;
      g.globalAlpha = 1;
      g.drawImage(S.canvas, 0, 0, sc.cols * sc.cell, sc.rows * sc.cell);
    }

    _drawSenses(g, t) {
      const c = this.focused();
      if (c && this.onDrawSenses) this.onDrawSenses(g, c, this, t);
      this._setWorldTransform(g);
    }

    // Calls rise as little music notes and fade
    _drawSounds(g) {
      const ss = this.world.sounds;
      for (let i = 0; i < ss.length; i++) {
        const s = ss[i];
        const a = s.age / SOUND_LIFE;
        if (a < 0 || a >= 1 || s.x < this.vx0 - 40 || s.x > this.vx1 + 40) continue;
        const loud = clamp01(s.loudness);
        const alpha = Math.min(1, a * 8) * Math.pow(1 - a, 1.2);
        const high = s.pitch >= 0.5, col = high ? NOTE_HIGH : NOTE_LOW;
        const size = 0.8 + loud * 0.5;
        const x = s.x + Math.sin(a * 6 + (s.sourceId | 0)) * 5;
        const y = s.y - 6 - a * 42;
        this._note(g, x, y, size, high, alpha, col);
        if (loud > 0.45 && a > 0.12) {
          const b = a - 0.12;
          this._note(g, s.x + 9 + Math.sin(b * 6) * 4, s.y - 2 - b * 42, size * 0.8, high, Math.min(1, b * 8) * Math.pow(1 - a, 1.2), col);
        }
      }
      g.globalAlpha = 1;
    }

    _note(g, x, y, s, high, alpha, col) {
      g.globalAlpha = alpha;
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
        g.strokeStyle = pass ? col : NOTE_INK;
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

  Evo.WorldView = WorldView;
})(globalThis.Evo);
