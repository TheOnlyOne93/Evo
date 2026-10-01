// The player's hand on the world canvas. With the hand tool: tap a creature to follow it, drag a
// creature, egg or item to carry it and let go to drop or fling it, drag empty ground to pan. With
// tickle or slap: touch a creature (stroke it to keep tickling). With an item tool: tap to drop one
// there. The wheel and a two-finger pinch zoom.
(function (Evo) {
  'use strict';
  const DRAG = 6;           // px a pointer must move before a press becomes a drag
  const PAT_TICKS = 15;     // sim ticks between pats while stroking (250 ms at 60 ticks/s)
  const FLING_WINDOW_MS = 100;  // ms: only hand movement this recent counts towards a throw

  class HandController {
    // opts: { getTool(), onSelect(creature, keepFollowing), onDrop(tool, x, y), onPan(), onRelease(),
    //         msPerTick() } msPerTick: wall ms one sim tick currently takes (0 while paused)
    constructor(canvas, view, world, opts) {
      this.canvas = canvas;
      this.view = view;
      this.world = world;
      this.opts = opts;
      this.pointers = new Map();  // Active pointers: id -> { x, y }
      this.press = null;          // What the current press is doing
      this.pinch = null;
      this.hover = null;          // Last mouse position over the canvas (screen px)
      canvas.addEventListener('pointerdown', e => this.down(e));
      canvas.addEventListener('pointermove', e => this.move(e));
      canvas.addEventListener('pointerup', e => this.up(e));
      canvas.addEventListener('pointercancel', e => this.up(e, true));
      canvas.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !this.press) this.hover = null; });
      canvas.addEventListener('wheel', e => {
        e.preventDefault();
        const p = this.local(e);
        this.view.zoomAt(Math.exp(-Math.sign(e.deltaY) * Math.min(0.25, Math.abs(e.deltaY) / 400)), p.x, p.y);
      }, { passive: false });
      canvas.addEventListener('contextmenu', e => e.preventDefault());
    }

    local(e) {
      const r = this.canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    down(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return; // Only the primary button presses
      const p = this.local(e);
      this.canvas.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, p);
      if (this.pointers.size === 2) return this.startPinch();
      if (this.pointers.size > 2) return;
      const tool = this.opts.getTool(), view = this.view;
      const creature = view.creatureAt(p.x, p.y);
      const item = creature ? null : view.itemAt(p.x, p.y);
      this.press = { id: e.pointerId, tool, creature, item, start: p, last: p, moved: false, holding: false, samples: [], lastPatTick: -Infinity };
      if (tool === 'pat' && creature) this.pat(creature, this.press);
      if (tool === 'slap' && creature) this.world.slap(creature);
      this.hover = p;
    }

    move(e) {
      const p = this.local(e);
      if (e.pointerType === 'mouse') this.hover = p;
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, p);
      if (this.pinch) return this.movePinch();
      const pr = this.press;
      if (!pr || pr.id !== e.pointerId) return;
      this.hover = p;
      if (!pr.moved && Math.hypot(p.x - pr.start.x, p.y - pr.start.y) > DRAG) pr.moved = true;
      const w = this.view.screenToWorld(p.x, p.y);
      if (pr.moved) {
        const carry = pr.tool === 'grab' && (pr.creature || pr.item);
        if (carry) {
          if (!pr.holding) {
            this.view.follow(null); // Hold the camera still while carrying, or the world slides under the hand
            this.world.grab(pr.creature ? { creature: pr.creature } : { item: pr.item }, w.x, w.y);
            pr.holding = true;
          }
          this.world.moveHand(w.x, w.y);
          pr.samples.push({ x: w.x, y: w.y, t: performance.now() });
          if (pr.samples.length > 6) pr.samples.shift();
        } else if (pr.tool === 'pat') {
          // Stroking: keep tickling whatever is under the hand
          const c = this.view.creatureAt(p.x, p.y);
          if (c) this.pat(c, pr);
          else this.pan(p, pr);
        } else {
          this.pan(p, pr);
        }
      }
      pr.last = p;
    }

    up(e, cancelled = false) {
      this.pointers.delete(e.pointerId);
      if (this.pinch) {
        if (this.pointers.size < 2) this.pinch = null;
        this.press = null;
        return;
      }
      const pr = this.press;
      if (!pr || pr.id !== e.pointerId) return;
      this.press = null;
      if (e.pointerType !== 'mouse') this.hover = null;
      if (pr.holding) {
        // Let go: whatever was carried keeps the hand's recent velocity (a fling)
        // Only samples from the last moment count: a hand that paused before letting go drops it
        const now = performance.now();
        const s = pr.samples.filter(m => now - m.t <= FLING_WINDOW_MS), a = s[0], b = s[s.length - 1];
        // px per wall ms x wall ms per tick = px per tick: the thing leaves at the hand's on-screen
        // speed at any sim speed. Paused, no tick passes, so it is dropped with no velocity.
        const msPerTick = this.opts.msPerTick();
        const ticks = b && a && b.t > a.t && msPerTick > 0 ? (b.t - a.t) / msPerTick : 0;
        this.world.releaseHand(ticks ? (b.x - a.x) / ticks : 0, ticks ? (b.y - a.y) / ticks : 0);
        this.opts.onRelease();
        return;
      }
      if (cancelled || pr.moved) return;
      const w = this.view.screenToWorld(pr.start.x, pr.start.y);
      if (pr.tool === 'grab' && pr.creature) this.opts.onSelect(pr.creature);
      else if (pr.tool === 'pat' || pr.tool === 'slap') { if (pr.creature) this.opts.onSelect(pr.creature, true); }
      else if (pr.tool !== 'grab') this.opts.onDrop(pr.tool, w.x, w.y);
    }

    pan(p, pr) {
      this.view.panBy(p.x - pr.last.x, p.y - pr.last.y);
      this.opts.onPan();
    }

    pat(c, pr) {
      const tick = this.world.clock.tick;
      if (tick - pr.lastPatTick < PAT_TICKS) return;
      pr.lastPatTick = tick;
      this.world.pat(c);
    }

    startPinch() {
      // A second finger: stop anything the first was doing and zoom instead
      if (this.press && this.press.holding) { this.world.releaseHand(0, 0); this.opts.onRelease(); }
      this.press = null;
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    }

    movePinch() {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      this.view.panBy(mx - this.pinch.mx, my - this.pinch.my);
      this.opts.onPan();
      this.view.zoomAt(d / this.pinch.d, mx, my);
      this.pinch = { d, mx, my };
    }

    // What the view should draw for the hand this frame
    handState() {
      const tool = this.opts.getTool();
      const p = this.hover;
      if (!p) return null;
      const mode = tool === 'pat' || tool === 'slap' ? tool : 'grab';
      return { x: p.x, y: p.y, mode, holding: !!this.world.hand.holding, tool };
    }
  }

  HandController.DRAG = DRAG;  // The bottom sheet's handle uses the same threshold
  Evo.HandController = HandController;
})(globalThis.Evo);
