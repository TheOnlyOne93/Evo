// The status chips in the header, the toast at the top of the stage, and the event log along the bottom.
(function (Evo) {
  'use strict';
  const $ = id => document.getElementById(id);
  const H = Evo.uiHelpers;

  Evo.setupStatus = function setupStatus(app) {
    const { world } = app;

    let toastTimer = 0;
    app.toast = message => {
      const el = $('toast');
      el.textContent = message;
      el.classList.remove('hidden');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => el.classList.add('hidden'), 2800);
    };

    app.who = c => `<b style="color:${H.sexColor(c.sex)}">${H.esc(c.name)}</b>`;
    app.log = (html, creature = null) => {
      const el = document.createElement(creature ? 'button' : 'div');
      el.className = 'log-line';
      el.innerHTML = html;
      if (creature) el.dataset.creature = creature.id;
      $('log').prepend(el);
      while ($('log').children.length > 5) $('log').lastChild.remove();
      setTimeout(() => el.classList.add('fading'), 9000);
      setTimeout(() => el.remove(), 10000);
    };
    $('log').addEventListener('click', e => {
      const el = e.target.closest('[data-creature]');
      const c = el && world.creatureById(Number(el.dataset.creature));
      if (c) app.select(c);
    });

    app.refreshStatus = () => {
      const clock = world.clock;
      $('statPop').textContent = world.creatures.length;
      $('statGen').textContent = world.creatures.reduce((m, c) => Math.max(m, c.generation), 1);
      $('statDay').textContent = `Day ${clock.day + 1}`;
      $('statTime').textContent = Evo.text.timeOfDay(clock.phase);
      $('timeIcon').textContent = clock.light > 0.5 ? '☀' : clock.light > 0.2 ? '◐' : '☾';
      $('statSeason').textContent = world.seasonInfo.word;
      app.refreshSpeed();
    };

    // Shown only while the computer can't keep up: "8× (running 5×)"
    app.refreshSpeed = () => {
      const running = Math.round(app.frameClock.achievedSpeed() * 10) / 10;
      const short = !app.paused && running < app.speed * 0.9;
      $('statSpeedChip').classList.toggle('hidden', !short);
      if (short) $('statSpeed').textContent = `${app.speed}× (running ${running}×)`;
    };

    app.skipSeason = () => {
      const days = Evo.SEASON_DAYS, next = (Math.floor(world.clock.day / days) + 1) * days;
      world.clock.tick = Math.round((next + 0.3 - world.startPhase) * Evo.DAY_TICKS); // Morning of its first day
      world.updateClock();
      app.refreshStatus();
    };

    const { who, log } = app;
    const events = world.events;
    events.on('hatch', ({ creature }) => log(`${who(creature)} hatched`, creature));
    events.on('death', ({ creature, cause }) => log(`${who(creature)} ${Evo.text.DEATH_WORDS[cause] || 'died'}`));
    events.on('mate', ({ mother, father }) => log(`${who(mother)} and ${who(father)} mated`, mother));
    events.on('egg', ({ mother }) => log(`${who(mother)} laid an egg`, mother));
    events.on('wanderer', ({ creature }) => log(`${who(creature)} wandered in`, creature));
    events.on('refound', () => log('New founders arrived'));
    events.on('season', ({ season }) => { log(`${Evo.SEASONS[season.index].word} has come`); app.refreshStatus(); });
    events.on('stage', ({ creature, stage }) => { if (creature === app.focus) log(`${who(creature)} is now ${Evo.STAGES[stage].word.toLowerCase()}`, creature); });
  };
})(globalThis.Evo);
