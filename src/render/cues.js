// Creature cues: what the world view draws over creatures to show what is going on inside them,
// Creatures-style. A thought bubble with the strongest need (or, asleep, what it is dreaming of),
// hearts after a pat, a nuzzle or mating, a burst after a slap, thorns or a hard fall, a name tag under the
// followed and the hovered creature, and brackets around what the followed creature is attending
// to. Also keeps each creature's recent events (patted, slapped, ate...) for the creature card.
// Drawn in screen space (CSS px) so the cues stay readable at every zoom.
(function (Evo) {
  'use strict';
  const { TAU, clamp, clamp01 } = Evo.util;
  const { circle, sparkle } = Evo.Paint;

  const HEARTS = { patted: 3, wasNuzzled: 2, mated: 4 };
  const BURSTS = { slapped: '#ffe27a', pricked: '#f28bc0', fell: '#e8dcc8' };
  const FX_LIFE = 1.3;          // s hearts stay on screen
  const BURST_LIFE = 0.7;       // s a burst stays on screen
  const REPEAT_TICKS = 600;     // the same event again within this many ticks adds to the last entry
  const DREAM_HOLD = 2.5;       // s a dream bubble stays up after the dream (which is brief)
  const BUBBLE_PERIOD = 8;      // s: a need bubble shows for part of each period
  const INK = 'rgba(30, 24, 44, 0.7)';
  const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

  // How each drive reads at a glance, for thought bubbles and the creature card: an icon and a
  // word for "feels ..." (keys are Evo.DRIVES)
  Evo.DRIVE_LOOK = {
    hunger: { icon: '🍎', word: 'Hungry' }, proteinHunger: { icon: '🐛', word: 'Craving protein' },
    fatHunger: { icon: '🥜', word: 'Craving fat' }, thirst: { icon: '💧', word: 'Thirsty' },
    tiredness: { icon: '🥱', word: 'Tired' }, sleepiness: { icon: '🌙', word: 'Sleepy' },
    pain: { icon: '🤕', word: 'Hurting' }, coldness: { icon: '❄️', word: 'Cold' }, hotness: { icon: '🥵', word: 'Hot' },
    loneliness: { icon: '💔', word: 'Lonely' }, crowdedness: { icon: '👥', word: 'Crowded' },
    fear: { icon: '😨', word: 'Scared' }, anger: { icon: '💢', word: 'Angry' }, boredom: { icon: '💭', word: 'Bored' },
    sexDrive: { icon: '💕', word: 'Wants a mate' }, nausea: { icon: '🤢', word: 'Queasy' }
  };
  // Things that happen to a creature that the card lists (keys are Evo.STIMULI)
  Evo.EVENT_LOOK = {
    patted: { icon: '🪶', word: 'Tickled' }, slapped: { icon: '💥', word: 'Slapped' }, pricked: { icon: '🌵', word: 'Pricked by thorns' },
    fell: { icon: '🤕', word: 'Fell hard' }, wasShoved: { icon: '😠', word: 'Shoved' }, wasNuzzled: { icon: '🤗', word: 'Nuzzled' },
    ate: { icon: '🍽️', word: 'Ate' }, drank: { icon: '💧', word: 'Drank' }, played: { icon: '⚽', word: 'Played' },
    mated: { icon: '💞', word: 'Mated' }, fellAsleep: { icon: '💤', word: 'Fell asleep' }, woke: { icon: '☀️', word: 'Woke up' }
  };
  // Its strongest needs, strongest first: [{ key, level, icon, word }] for drives above `min`
  Evo.needsOf = (c, n = 3, min = 0.25) => c.topDrives(n).filter(([, v]) => v > min)
    .map(([key, level]) => ({ key, level, ...(Evo.DRIVE_LOOK[key] || { icon: '•', word: key }) }));
  // Icons for actions (keys are Evo.MOTORS), shown in dreams
  Evo.MOTOR_ICON = { walkL: '👣', walkR: '👣', jump: '🦘', eat: '🍎', grab: '✊', rest: '💤', call: '🎵', run: '💨', drink: '💧' };

  class CreatureCues {
    constructor() {
      this.recs = new WeakMap();   // creature -> { last, fx: [{ key, t0 }], log: [{ key, tick, n }], dreamUntil, dreamIcon }
      this.icons = new Map();      // emoji -> pre-rendered canvas
    }

    rec(c) {
      let r = this.recs.get(c);
      if (!r) this.recs.set(c, r = { seen: c.stimCount || 0, fx: [], log: [], dreamUntil: 0, dreamIcon: '' });
      return r;
    }

    // Recent events for the card, newest first: [{ key, tick, n }] (tick: world clock)
    recent(c) { return this.rec(c).log; }

    // Note new stimuli and dreams: called every tick (t: seconds, real time) so none is missed at speed;
    // drawing calls it too, which is harmless
    track(world, t) {
      const cs = world.creatures;
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i];
        if (!c.chem) continue;   // a stand-in creature (dev labs)
        const r = this.rec(c), ring = c.recentStimuli;
        // Entries of the ring not seen yet (entry j has sequence number stimCount - length + j + 1)
        for (let j = Math.max(0, ring.length - (c.stimCount - r.seen)); j < ring.length; j++) {
          const s = ring[j];
          const prev = r.fx[r.fx.length - 1];
          if ((HEARTS[s.key] || BURSTS[s.key]) && !(prev && prev.key === s.key && t - prev.t0 < 0.4)) {
            r.fx.push({ key: s.key, t0: t });
            if (r.fx.length > 4) r.fx.shift();
          }
          if (Evo.EVENT_LOOK[s.key]) {
            const top = r.log[0], tick = world.clock.tick;
            if (top && top.key === s.key && tick - top.tick < REPEAT_TICKS) { top.n++; top.tick = tick; }
            else { r.log.unshift({ key: s.key, tick, n: 1 }); if (r.log.length > 3) r.log.pop(); }
          }
        }
        r.seen = c.stimCount;
        const d = c.brain && c.brain.dream;
        if (c.asleep && d) {
          r.dreamUntil = t + DREAM_HOLD;
          r.dreamIcon = dreamIcon(c, d);
        } else if (!c.asleep) r.dreamUntil = 0;
      }
    }

    draw(g, view, t) {
      const world = view.world;
      this.track(world, t);
      const cs = world.creatures, dpr = view.dpr, z = clamp(view.cam.zoom, 0.75, 1.4);
      const focused = view._focused(), hovered = view.hoveredCreature;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.lineCap = 'round'; g.lineJoin = 'round';
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i];
        if (!view.poses[i] || !c.chem) continue;
        const r = this.rec(c);
        const head = view.worldToScreen(c.x + c.facing * c.size * 0.3, c.y - c.size * (c.lying ? 0.7 : 1.05));
        this._reactions(g, r, head, z, t);
        if (!c.held && !c.dead) this._bubble(g, c, r, head, z, t, c === focused);
      }
      if (focused && focused.chem) {
        const a = Evo.attentionOf(focused, world);
        if (a) this._brackets(g, view, a, t);
      }
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i];
        if ((c === focused || c === hovered) && view.poses[i] && !c.held) this._nameTag(g, view, c, z, c === hovered ? 1 : 0.85);
      }
      g.globalAlpha = 1;
    }

    // Hearts rise after a pat, a nuzzle or mating; a burst flashes after a slap, thorns or a hard fall
    _reactions(g, r, head, z, t) {
      for (let k = r.fx.length - 1; k >= 0; k--) {
        const fx = r.fx[k], age = t - fx.t0;
        if (age > FX_LIFE || age < 0) { r.fx.splice(k, 1); continue; }
        const n = HEARTS[fx.key];
        if (n) {
          for (let j = 0; j < n; j++) {
            const u = (age - j * 0.14) / (FX_LIFE - 0.3);
            if (u <= 0 || u >= 1) continue;
            const x = head.x + (j - (n - 1) / 2) * 9 * z + Math.sin(u * 7 + j) * 3 * z, y = head.y - 6 * z - u * 34 * z;
            g.globalAlpha = Math.min(1, u * 5) * (1 - u * u);
            heart(g, x, y, (4.5 + 1.5 * Math.sin(u * 3.1)) * z);
          }
        } else if (age < BURST_LIFE) {
          const u = age / BURST_LIFE, s = (7 + 9 * Math.sqrt(u)) * z;
          g.globalAlpha = 1 - u * u;
          burst(g, head.x - 6 * z, head.y + 2 * z, s, BURSTS[fx.key]);
        }
      }
      g.globalAlpha = 1;
    }

    // Asleep: a dream bubble while it dreams. Awake: its strongest need, for part of each period
    // (most of it for the followed creature), when the need is strong enough to matter
    _bubble(g, c, r, head, z, t, focused) {
      let icon = null, alpha = 0, dream = false;
      if (c.asleep) {
        if (r.dreamUntil > t) { icon = r.dreamIcon; dream = true; alpha = clamp01((r.dreamUntil - t) / 0.4); }
      } else {
        let best = null, v = focused ? 0.45 : 0.6;
        for (const k of Evo.DRIVES) { const x = c.chem.get(k); if (x > v) { v = x; best = k; } }
        if (best) {
          const on = focused ? 6 : 4, u = (t + c.id * 2.3) % BUBBLE_PERIOD;
          alpha = u < on ? Math.min(1, u / 0.35, (on - u) / 0.35) : 0;
          icon = Evo.DRIVE_LOOK[best] && Evo.DRIVE_LOOK[best].icon;
        }
      }
      if (!icon || alpha <= 0.01) return;
      // Dreams rise behind the head, clear of the z's drifting up in front
      const side = dream ? -c.facing : c.facing, R = 13 * z;
      const bx = head.x + side * 12 * z, by = head.y - 26 * z;
      g.globalAlpha = alpha;
      g.fillStyle = dream ? '#e6ecff' : '#fffdf7';
      g.strokeStyle = INK; g.lineWidth = 1.4;
      // Trailing puffs toward the head, then the bubble
      for (let j = 0; j < 2; j++) {
        const k = j ? 0.62 : 0.3, pr = (j ? 2.1 : 3.2) * z;
        g.beginPath(); g.arc(head.x + (bx - head.x) * k * 0.6, head.y + (by + R - head.y) * k + 2 * z, pr, 0, TAU); g.fill(); g.stroke();
      }
      g.beginPath();
      if (dream) {
        // A cloud: a few overlapping puffs
        for (let j = 0; j < 6; j++) { const a = j / 6 * TAU; circle(g, bx + Math.cos(a) * R * 0.62, by + Math.sin(a) * R * 0.5, R * 0.46); }
        g.stroke(); g.fill();
      } else {
        g.arc(bx, by, R, 0, TAU); g.fill(); g.stroke();
      }
      const bob = Math.sin(t * 2.2 + c.id) * 0.8 * z, s = R * 1.25;
      g.drawImage(this._icon(icon), bx - s / 2, by - s / 2 + bob, s, s);
      if (dream) {
        g.fillStyle = '#fff4b0';
        for (let j = 0; j < 2; j++) { sparkle(g, bx + (j ? -1 : 1) * R * 0.95, by - R * (j ? 0.5 : 0.75), (1.8 + Math.sin(t * 4 + j * 2)) * z); g.fill(); }
      }
      g.globalAlpha = 1;
    }

    // Soft corner brackets around what the followed creature is attending to
    _brackets(g, view, a, t) {
      const p = view.worldToScreen(a.x, a.y);
      const h = clamp(a.radius * view.cam.zoom * 1.2 + 5, 9, 42) + Math.sin(t * 3) * 1.2, l = Math.max(4, h * 0.45);
      g.beginPath();
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          g.moveTo(p.x + sx * h, p.y + sy * (h - l)); g.lineTo(p.x + sx * h, p.y + sy * h); g.lineTo(p.x + sx * (h - l), p.y + sy * h);
        }
      }
      g.globalAlpha = 0.45; g.strokeStyle = '#06131a'; g.lineWidth = 3.6; g.stroke();
      g.globalAlpha = 0.9; g.strokeStyle = Evo.theme.color('--accent'); g.lineWidth = 1.8; g.stroke();
      g.globalAlpha = 1;
    }

    // "♀ Name" in a small pill under the feet
    _nameTag(g, view, c, z, alpha) {
      const p = view.worldToScreen(c.x, c.y);
      const glyph = c.sex === 'FEMALE' ? '♀' : '♂', name = c.name;
      g.font = `700 ${Math.round(11.5 * Math.min(z, 1.15))}px ${Evo.theme.color('--ui')}`;
      const gw = g.measureText(glyph + ' ').width, w = gw + g.measureText(name).width + 14, hh = 18 * Math.min(z, 1.15);
      const x = p.x - w / 2, y = p.y + 9 * z;
      g.globalAlpha = alpha * 0.9;
      g.fillStyle = 'rgba(15, 30, 34, 0.85)';
      g.beginPath(); g.roundRect(x, y, w, hh, hh / 2); g.fill();
      g.globalAlpha = alpha;
      g.textBaseline = 'middle'; g.textAlign = 'left';
      g.fillStyle = Evo.theme.color(c.sex === 'FEMALE' ? '--female' : '--male');
      g.fillText(glyph, x + 7, y + hh / 2 + 0.5);
      g.fillStyle = Evo.theme.color('--text');
      g.fillText(name, x + 7 + gw, y + hh / 2 + 0.5);
      g.globalAlpha = 1;
    }

    // An emoji drawn once into a small canvas, then blitted
    _icon(ch) {
      let cv = this.icons.get(ch);
      if (!cv) {
        cv = Evo.makeCanvas(64, 64);
        const x = cv.getContext('2d');
        x.font = `46px ${EMOJI_FONT}`;
        x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillText(ch, 32, 35);
        this.icons.set(ch, cv);
      }
      return cv;
    }
  }

  // What a dream is about: the action it replays
  function dreamIcon(c, d) {
    let k = -1;
    if (d.episode) k = c.brain.lobes.motor.indexOf(d.episode.motor);
    else if (d.instinct && d.instinct.motor !== undefined) k = d.instinct.motor % Evo.MOTORS.length;
    const m = Evo.MOTORS[k];
    return (m && Evo.MOTOR_ICON[m.key]) || '✨';
  }

  function heart(g, x, y, s) {
    g.beginPath();
    g.moveTo(x, y + s * 0.9);
    g.bezierCurveTo(x - s * 1.5, y - s * 0.1, x - s * 0.8, y - s * 1.3, x, y - s * 0.45);
    g.bezierCurveTo(x + s * 0.8, y - s * 1.3, x + s * 1.5, y - s * 0.1, x, y + s * 0.9);
    g.fillStyle = '#ff7fa6'; g.fill();
    g.strokeStyle = INK; g.lineWidth = 1.3; g.stroke();
  }

  function burst(g, x, y, s, fill) {
    g.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * TAU - 0.2, rr = i & 1 ? s * 0.5 : s;
      g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.closePath();
    g.fillStyle = fill; g.fill();
    g.strokeStyle = INK; g.lineWidth = 1.6; g.stroke();
  }

  Evo.CreatureCues = CreatureCues;
})(globalThis.Evo);
