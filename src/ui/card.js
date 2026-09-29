// The creature card (portrait, name, what it is doing and why, its strongest needs, what just
// happened to it, drive bars) and the follow toggle.
(function (Evo) {
  'use strict';
  const $ = id => document.getElementById(id);
  const H = Evo.uiHelpers;

  const EVENT_SHOWN_S = 120;   // An event stays on the card this long (simulated seconds)
  // What an idle creature is about to do, by its busiest muscle (keys are Evo.MOTORS)
  const ABOUT_TO = { eat: 'Trying to eat', grab: 'Reaching for', drink: 'About to drink', call: 'About to call', rest: 'Settling down' };

  // The muscle whose neuron has fired most lately (its current decision), when one clearly leads
  function decision(c) {
    const { lobes, rate } = c.brain, m = lobes.motor;
    let best = -1, most = 0.04, next = 0;
    for (let k = 0; k < m.length; k++) {
      const r = rate[m[k]];
      if (r > most) { next = most; most = r; best = k; } else if (r > next) next = r;
    }
    return best >= 0 && most > next * 1.3 ? Evo.MOTORS[best].key : null;
  }

  // Why it might be doing it: its strongest need, or else how it feels
  function reason(c) {
    const [need] = Evo.needsOf(c, 1, 0.3);
    if (need) return need.word.toLowerCase();
    const mood = c.mood;
    return mood === 'calm' ? '' : mood;
  }

  // "Walking to fruit — hungry"
  function doing(c, world) {
    if (c.dead) return 'Dead';
    if (c.held) return 'Being held';
    if (c.asleep) return c.brain.dream ? 'Asleep, dreaming' : 'Asleep';
    const a = Evo.attentionOf(c, world);
    const what = a ? (a.kind === 'feature' || a.kind === 'water' ? `the ${a.word}` : a.word) : '';
    let verb = Evo.text.ACTION_WORDS[c.action] || c.action;
    if (c.action === 'walking' || c.action === 'running') {
      if (what) verb += (Math.sign(a.x - c.x) === c.facing ? ' to ' : ' away from ') + what;
    } else if (c.action === 'eating' && a && a.kind === 'item') verb = `Eating ${what}`;
    else if (c.action === 'idle') {
      const d = decision(c);
      if (ABOUT_TO[d]) verb = ABOUT_TO[d] + (what && (d === 'eat' || d === 'grab') ? ` ${what}` : '');
      else if (what) verb = `Watching ${what}`;
    }
    const why = reason(c);
    return why ? `${verb} — ${why}` : verb;
  }

  Evo.setupCard = function setupCard(app) {
    const { world, view } = app;
    const portrait = $('portrait'), portraitCtx = portrait.getContext('2d');
    const sizePortrait = () => Evo.fitCanvas(portrait, portraitCtx, 40, 40);
    let portraitSize = sizePortrait();
    window.addEventListener('resize', () => { portraitSize = sizePortrait(); });

    app.syncFollow = () => {
      $('followBtn').setAttribute('aria-pressed', String(app.following && !!app.focus));
      $('followBtn').textContent = app.following ? 'Following' : 'Follow';
    };
    app.toggleFollow = () => {
      app.following = !app.following;
      app.view.follow(app.following ? app.focus : null);
      app.syncFollow();
    };
    $('followBtn').addEventListener('click', app.toggleFollow);

    // Only touch the page when the text changes (the card refreshes several times a second)
    const setHtml = (el, html) => { if (el.innerHTML !== html) el.innerHTML = html; };
    const chip = (cls, icon, text, title = text) =>
      `<span class="${cls}" title="${H.esc(title)}"><span aria-hidden="true">${icon}</span>${H.esc(text)}</span>`;

    app.refreshCard = (force = false) => {
      const c = app.focus;
      $('creatureCard').classList.toggle('empty-card', !c);
      if (!c) {
        $('cardSex').textContent = ''; $('cardName').textContent = 'Nobody';
        $('cardSub').textContent = 'Tap a creature to follow it';
        $('cardDoing').textContent = ''; $('cardNeeds').innerHTML = ''; $('cardEvents').innerHTML = '';
        return;
      }
      const t = Evo.text;
      if (force) {
        $('cardSex').textContent = H.sexGlyph(c.sex);
        $('cardSex').style.color = H.sexColor(c.sex);
        $('cardSex').title = c.sex === 'FEMALE' ? 'Female' : 'Male';
        $('cardName').textContent = c.name;
      }
      $('cardSub').textContent = `${Evo.STAGES[c.stage].word} · gen ${c.generation} · ${t.clock(c.ageTicks)} old`;
      $('cardDoing').textContent = doing(c, world);
      const needs = c.dead ? [] : Evo.needsOf(c, 3);
      setHtml($('cardNeeds'), needs.length
        ? needs.map(n => chip(n.level > 0.6 ? 'need strong' : 'need', n.icon, n.word, `${n.word}: ${H.percentOf(n.level)}%`)).join('')
        : c.dead ? '' : chip('need calm', '🙂', 'No pressing needs'));
      const now = world.clock.tick, recent = view.cues.recent(c).filter(e => now - e.tick < EVENT_SHOWN_S * Evo.TICKS_PER_SECOND);
      setHtml($('cardEvents'), recent.map(e => {
        const look = Evo.EVENT_LOOK[e.key], ago = t.seconds(now - e.tick);
        return chip('event', look.icon, look.word + (e.n > 1 ? ` ×${e.n}` : ''), `${look.word}, ${ago === 'under a second' ? 'just now' : ago + ' ago'}`);
      }).join(''));
      const drives = c.topDrives(3).filter(([, v]) => v > 0.02);
      $('cardDrives').innerHTML = H.bar('Health', c.health, 'var(--protein)') +
        drives.map(([k, v]) => H.bar(t.CHEM_WORDS[k], v, H.chemColor(k))).join('');
    };

    app.drawPortrait = t => {
      const c = app.focus, ctx = portraitCtx, { width: w, height: h } = portraitSize;
      ctx.clearRect(0, 0, w, h);
      if (!c || !Evo.CreatureArt) return;
      try {
        ctx.save();
        Evo.CreatureArt.drawPortrait(ctx, app.view.poseFor(c), w, h, t);
        ctx.restore();
      } catch (e) { ctx.restore(); }
    };
  };
})(globalThis.Evo);
