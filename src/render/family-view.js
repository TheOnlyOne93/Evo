// The family tree in the Family deck: an hourglass around one creature. Its parents and their
// parents stand above it, its brothers and sisters to its left (half ones on a dashed line), its
// mates to its right, and its children and their children below. Every relative is a face with
// its name under it: the living as they look now, the dead as they were last seen, faded. A row
// with nobody in it is left out, and a row too long for the panel ends in "+N" (the lists under
// the chart name everyone). The family itself comes from Evo.kinOf (src/ui/kin.js).
(function (Evo) {
  'use strict';
  const { TAU } = Evo.util;

  const PAD = 12;                               // margin inside the frame
  const R_SELF = 24, R_NEAR = 18, R_FAR = 14;   // face radii: the creature itself; its parents and children; everyone else
  const PITCH_NEAR = 52, PITCH_FAR = 42;        // centre to centre along a row of near or far faces
  const PARENT_DX = 46;                         // each parent's distance from the middle (room for a pair of grandparents over each)
  const SIDE_GAP = 16;                          // between the creature and the first sibling or mate
  const LABEL_H = 16, LINK_H = 18;              // under a face for its name; between rows for the links
  const BAR_UP = 7, BAR_STEP = 6;               // a row's joining bar sits this far above its faces; every other grandchild family's, a step higher
  const LINK_W = 1.5;                           // the lines between relatives
  const DISC = '#16292e';                       // behind a face (as the strip's avatars)
  const FADE = 0.55;                            // how far a dead relative's face is washed out

  const font = (size, weight = '') => `${weight ? weight + ' ' : ''}${size}px ${Evo.theme.color('--ui')}`;
  const sexToken = sex => (sex === 'FEMALE' ? '--female' : '--male');
  const word = (rec, female, male) => (rec.sex === 'FEMALE' ? female : male);

  // Places along a row for things that each want to stand at some x, kept in order, at least a
  // pitch apart and inside [lo, hi]. Neighbours that would crowd each other move together as a
  // block, centred on where its members want to be (the caller asks for no more than fit).
  function spread(wants, pitch, lo, hi) {
    const blocks = [];   // { n members, sum of where each wants the block to start, x it starts at }
    for (const want of wants) {
      let b = { n: 1, sum: want, x: 0 };
      for (;;) {
        b.x = Math.min(Math.max(b.sum / b.n, lo), hi - (b.n - 1) * pitch);
        const prev = blocks[blocks.length - 1];
        if (!prev || prev.x + prev.n * pitch <= b.x) break;
        blocks.pop();
        b = { n: prev.n + b.n, sum: prev.sum + b.sum - b.n * prev.n * pitch, x: 0 };
      }
      blocks.push(b);
    }
    return blocks.flatMap(b => Array.from({ length: b.n }, (_, k) => b.x + k * pitch));
  }

  // As many of a list as fit in `room` places, the last place kept for a "+N" when some are left out
  function fit(list, room) {
    if (list.length <= room) return { shown: list, more: 0 };
    const shown = list.slice(0, Math.max(0, room - 1));
    return { shown, more: list.length - shown.length };
  }

  // Where everything goes in a frame W wide: { nodes: [{ rec, x, y, r, role, self }], chips: [{ x, y, r, n }],
  // links: [{ x0, y0, x1, y1, dashed, layer }], caption: { text, x, y } | null, height }
  function layout(kin, index, W) {
    const cx = W / 2, lo = PAD + R_FAR, hi = W - PAD - R_FAR;
    const nodes = [], chips = [], links = [];
    const node = (rec, x, y, r, role, self = false) => { const n = { rec, x, y, r, role, self }; nodes.push(n); return n; };
    const chip = (x, y, r, n) => chips.push({ x, y, r, n });   // "+n": that many more than the row has room for
    let layer = 0;   // lines of one layer are drawn together; a layer above 0 passes over the lines under it
    const line = (x0, y0, x1, y1, dashed = false) => links.push({ x0, y0, x1, y1, dashed, layer });
    const foot = n => n.y + n.r + LABEL_H;   // under a face's name, where a line down from it starts
    let top = PAD + (kin.outsider ? 14 : 0);   // an outsider has a caption where its parents would be
    const row = r => { const y = top + r; top += r * 2 + LABEL_H + LINK_H; return y; };

    // Parents, with each one's own parents over it
    let mum = null, dad = null;
    if (!kin.outsider) {
      const elders = kin.grandparents.filter(g => g.rec);
      const yG = elders.length ? row(R_FAR) : 0, yP = row(R_NEAR);
      if (kin.mother) mum = node(kin.mother, cx - PARENT_DX, yP, R_NEAR, 'mother');
      if (kin.father) dad = node(kin.father, cx + PARENT_DX, yP, R_NEAR, 'father');
      for (const parent of [mum, dad]) {
        if (!parent) continue;
        const pair = elders.filter(g => g.of === parent.role)
          .map(g => node(g.rec, parent.x + (g.role === 'mother' ? -1 : 1) * PITCH_FAR / 2, yG, R_FAR, `${g.of}'s ${g.role}`));
        if (pair.length === 2) {
          line(pair[0].x + R_FAR, yG, pair[1].x - R_FAR, yG);
          line(parent.x, yG, parent.x, yP - R_NEAR);
        } else if (pair.length) line(pair[0].x, foot(pair[0]), parent.x, yP - R_NEAR);
      }
    }

    // The creature itself, its brothers and sisters to the left and its mates to the right
    const yS = row(R_SELF);
    const self = node(kin.self, cx, yS, R_SELF, '', true);
    if (mum && dad) {
      line(mum.x + R_NEAR, mum.y, dad.x - R_NEAR, dad.y);
      line(cx, mum.y, cx, yS - R_SELF);
    } else if (mum || dad) line((mum || dad).x, foot(mum || dad), cx, yS - R_SELF);
    const firstSide = R_SELF + SIDE_GAP + R_FAR, sideRoom = Math.floor((cx - firstSide - lo) / PITCH_FAR) + 1;
    const sibs = fit(kin.siblings, sideRoom), yBar = yS - R_SELF - BAR_UP;
    const sibPlaces = sibs.shown.length + (sibs.more ? 1 : 0), sibX = k => cx - firstSide - k * PITCH_FAR;
    sibs.shown.forEach((s, k) => {
      node(s.rec, sibX(k), yS, R_FAR, (s.half ? 'half ' : '') + word(s.rec, 'sister', 'brother'));
      line(sibX(k), yBar, sibX(k), yS - R_FAR, s.half);
    });
    if (sibs.more) { chip(sibX(sibPlaces - 1), yS, R_FAR, sibs.more); line(sibX(sibPlaces - 1), yBar, sibX(sibPlaces - 1), yS - R_FAR); }
    if (sibPlaces) line(sibX(sibPlaces - 1), yBar, cx, yBar);
    const mates = fit(kin.mates, sideRoom);
    const matePlaces = mates.shown.length + (mates.more ? 1 : 0), mateX = k => cx + firstSide + k * PITCH_FAR;
    mates.shown.forEach((m, k) => node(m, mateX(k), yS, R_FAR, 'mate'));
    if (mates.more) chip(mateX(matePlaces - 1), yS, R_FAR, mates.more);
    if (matePlaces) for (const dy of [-2, 2]) line(cx + R_SELF, yS + dy, mateX(matePlaces - 1) - R_FAR, yS + dy);

    // Children on a bar under the creature, then each one's own children under it
    if (kin.children.length) {
      const yC = row(R_NEAR), barC = yC - R_NEAR - BAR_UP;
      const kids = fit(kin.children, Math.floor((W - 2 * PAD - 2 * R_NEAR) / PITCH_NEAR) + 1);
      const places = kids.shown.length + (kids.more ? 1 : 0);
      const at = i => cx + (i - (places - 1) / 2) * PITCH_NEAR;
      const shown = kids.shown.map((rec, i) => node(rec, at(i), yC, R_NEAR, word(rec, 'daughter', 'son')));
      if (kids.more) chip(at(places - 1), yC, R_NEAR, kids.more);
      line(cx, foot(self), cx, barC);
      line(Math.min(at(0), cx), barC, Math.max(at(places - 1), cx), barC);
      for (let i = 0; i < places; i++) line(at(i), barC, at(i), yC - R_NEAR);

      // A grandchild whose parents are both this creature's children stands under the first of them
      const seen = new Set();
      const groups = shown.map(parent => ({ parent, all: index.childrenOf(parent.rec.id).filter(h => !seen.has(h) && seen.add(h)) })).filter(g => g.all.length);
      if (groups.length) {
        const yGC = row(R_FAR);
        // Share out the places a group at a time, so every family gets some before any gets all
        const quota = groups.map(() => 0);
        let left = Math.floor((hi - lo) / PITCH_FAR) + 1;
        while (left > 0 && groups.some((g, i) => quota[i] < g.all.length)) {
          for (let i = 0; i < groups.length && left > 0; i++) if (quota[i] < groups[i].all.length) { quota[i]++; left--; }
        }
        const slots = [];   // one per place: a grandchild, or a group's "+N"
        groups.forEach((g, i) => {
          if (!quota[i]) return;
          const part = fit(g.all, quota[i]), n = part.shown.length + (part.more ? 1 : 0);
          // Neighbouring groups join on bars at two heights, so one's bar is never taken for the next one's
          g.bar = yGC - R_FAR - BAR_UP - (i % 2 ? BAR_STEP : 0);
          part.shown.forEach((rec, j) => slots.push({ g, rec, want: g.parent.x + (j - (n - 1) / 2) * PITCH_FAR }));
          if (part.more) slots.push({ g, more: part.more, want: g.parent.x + (n - 1) / 2 * PITCH_FAR });
        });
        const xs = spread(slots.map(s => s.want), PITCH_FAR, lo, hi);
        slots.forEach((s, i) => {
          s.x = xs[i];
          if (s.rec) node(s.rec, s.x, yGC, R_FAR, word(s.rec, 'granddaughter', 'grandson')); else chip(s.x, yGC, R_FAR, s.more);
        });
        // A full row pushes a family out from under its parent, and its lines then cross the
        // next family's: each family's lines are drawn as one layer that passes over the others
        groups.forEach((g, i) => {
          const mine = slots.filter(s => s.g === g);
          if (!mine.length) return;
          const x0 = mine[0].x, x1 = mine[mine.length - 1].x, px = g.parent.x;
          layer = i + 1;
          line(px, foot(g.parent), px, g.bar);
          line(Math.min(x0, px), g.bar, Math.max(x1, px), g.bar);
          for (const s of mine) line(s.x, g.bar, s.x, yGC - R_FAR);
        });
      }
    }
    const caption = kin.outsider ? { text: kin.self.generation > 1 ? 'wandered in from outside' : 'a founder', x: cx, y: PAD } : null;
    return { nodes, chips, links, caption, height: top - LINK_H + PAD };
  }

  // A calm pose for a face nobody can pose any more, from how it was last seen
  const lastPose = (rec, face) => (face ? { id: rec.id, stage: face.stage, sex: rec.sex, looks: face.looks } : null);

  let artFailed = false;   // the art is decoration: a failure is logged once and the disc stays plain

  class FamilyView {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.nodes = [];      // the faces drawn last, for nodeAt
      this.hover = null;    // id of the relative under the pointer
      this.fitted = '';     // the size the canvas was last fitted to
      this.last = null;     // the last render's arguments, for redraw
    }

    // The panel changed size: fit the canvas again at the next render
    resize() { this.fitted = ''; }

    // The face under a point (CSS px in the canvas), or null
    nodeAt(x, y) {
      let best = null, bestD = Infinity;
      for (const n of this.nodes) {
        const d = Math.hypot(x - n.x, y - n.y);
        if (d < n.r + 4 && d < bestD) { bestD = d; best = n; }
      }
      return best;
    }

    redraw() { if (this.last) this.render(...this.last); }

    // Draw a family (kin from Evo.kinOf, index from Evo.kinIndex). who tells the living from the
    // dead and how each looks: { creatureOf(id) -> the living creature or null, poseOf(creature),
    // faces: Map id -> { looks, stage } as last seen }. t = seconds.
    render(kin, index, who, t) {
      this.last = [kin, index, who, t];
      const canvas = this.canvas, g = this.ctx, W = canvas.clientWidth;
      if (W < 2 * (PARENT_DX + PITCH_FAR)) return;   // hidden, or too narrow to draw in
      const L = layout(kin, index, W);
      const dpr = window.devicePixelRatio || 1, size = `${W}x${L.height}@${dpr}`;
      if (size !== this.fitted) {
        canvas.style.height = `${L.height}px`;
        Evo.fitCanvas(canvas, g, 40, 40);
        this.fitted = size;
      }
      this.nodes = L.nodes;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, L.height);
      // The links, a run of like ones at a time. A layer that passes over others first rubs out
      // what lies under its lines, so a crossing shows a gap and doesn't read as a join
      g.lineCap = 'round';
      g.strokeStyle = Evo.theme.color('--faint');
      for (let i = 0; i < L.links.length;) {
        const { layer, dashed } = L.links[i];
        g.beginPath();
        for (; i < L.links.length && L.links[i].layer === layer && L.links[i].dashed === dashed; i++) {
          const l = L.links[i];
          g.moveTo(l.x0, l.y0); g.lineTo(l.x1, l.y1);
        }
        if (layer) {
          g.globalCompositeOperation = 'destination-out';
          g.lineWidth = LINK_W + 5;
          g.stroke();
          g.globalCompositeOperation = 'source-over';
        }
        g.setLineDash(dashed ? [2, 4] : []);
        g.lineWidth = LINK_W;
        g.stroke();
        g.setLineDash([]);
      }
      g.textAlign = 'center';
      g.textBaseline = 'top';
      if (L.caption) {
        g.font = font(11.5);
        g.fillStyle = Evo.theme.color('--muted');
        g.fillText(L.caption.text, L.caption.x, L.caption.y);
      }
      for (const n of L.nodes) this._face(g, n, who, t);
      g.textBaseline = 'middle';
      g.font = font(11.5, '700');
      for (const c of L.chips) {
        g.fillStyle = DISC;
        g.beginPath(); g.arc(c.x, c.y, c.r, 0, TAU); g.fill();
        g.fillStyle = Evo.theme.color('--muted');
        g.fillText(`+${c.n}`, c.x, c.y + 0.5);
      }
    }

    _face(g, n, who, t) {
      const { rec, x, y, r } = n, alive = who.creatureOf(rec.id), hot = this.hover === rec.id && !n.self;
      const pose = alive ? who.poseOf(alive) : lastPose(rec, who.faces.get(rec.id));
      const token = sexToken(rec.sex);
      g.fillStyle = DISC;
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
      if (pose && !artFailed) {
        g.save();
        g.beginPath(); g.arc(x, y, r, 0, TAU); g.clip();
        g.translate(x - r, y - r);
        try { Evo.CreatureArt.drawPortrait(g, pose, r * 2, r * 2, t, 'face'); } catch (e) { artFailed = true; console.error(e); }
        g.restore();
      } else {
        g.font = font(r, '700');
        g.textBaseline = 'middle';
        g.fillStyle = Evo.theme.rgba(token, alive ? 1 : 0.6);
        g.fillText(rec.sex === 'FEMALE' ? '♀' : '♂', x, y + 1);
        g.textBaseline = 'top';
      }
      if (!alive) {
        g.globalAlpha = FADE;
        g.fillStyle = DISC;
        g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
        g.globalAlpha = 1;
      }
      if (n.self) {
        g.strokeStyle = Evo.theme.rgba('--accent', 0.4);
        g.lineWidth = 2;
        g.beginPath(); g.arc(x, y, r + 3.5, 0, TAU); g.stroke();
      }
      g.strokeStyle = Evo.theme.rgba(token, n.self || hot ? 1 : alive ? 0.6 : 0.35);
      g.lineWidth = n.self ? 2.5 : 2;
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke();
      // Its name, cut short to stay clear of its neighbours'
      g.font = font(n.self ? 12.5 : 11, n.self ? '700' : '');
      g.fillStyle = Evo.theme.color(alive ? '--text' : '--muted');
      const room = (n.self ? 2 * (R_SELF + SIDE_GAP + R_FAR) - PITCH_FAR : r === R_NEAR ? PITCH_NEAR : PITCH_FAR) - 4;
      let name = rec.name;
      while (name.length > 1 && g.measureText(name).width > room) name = name.slice(0, -2) + '…';
      g.fillText(name, x, y + r + 3);
    }
  }

  Evo.FamilyView = FamilyView;
})(globalThis.Evo);
