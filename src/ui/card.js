// The creature card (name, state, drives, portrait) and the follow toggle.
(function (Evo) {
  'use strict';
  const $ = id => document.getElementById(id);
  const H = Evo.uiHelpers;

  Evo.setupCard = function setupCard(app) {
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

    app.refreshCard = (force = false) => {
      const c = app.focus;
      $('creatureCard').classList.toggle('empty-card', !c);
      if (!c) { $('cardName').textContent = 'Nobody'; $('cardSub').textContent = 'Tap a creature to follow it'; return; }
      const t = Evo.text;
      if (force) {
        $('cardSex').textContent = H.sexGlyph(c.sex);
        $('cardSex').style.color = H.sexColor(c.sex);
        $('cardName').textContent = c.name;
      }
      $('cardSub').textContent = `${Evo.STAGES[c.stage].word} · gen ${c.generation} · ${t.clock(c.ageTicks)} old`;
      $('cardDoing').textContent = `${t.ACTION_WORDS[c.action] || c.action} · ${c.mood}`;
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
        Evo.CreatureArt.drawPortrait(ctx, Evo.poseOf(c), w, h, t);
        ctx.restore();
      } catch (e) { ctx.restore(); }
    };
  };
})(globalThis.Evo);
