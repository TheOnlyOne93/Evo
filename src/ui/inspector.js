// The inside view: what is going on inside the followed creature (body chemistry, brain, genes,
// family) and in the world as a whole. Each deck renders from the simulation on demand: the app
// calls update() a few times a second for the visible deck, frame() every frame (the brain map and
// charge trace) and sample() every simulation tick (history, and what the brain is up to).
(function (Evo) {
  'use strict';
  const { clamp } = Evo.util;
  const T = Evo.text;
  const $ = id => document.getElementById(id);
  const { esc, bar, setHtml, percent, plural, sexColor, sexGlyph, sexWord, chemToken, chemColor } = Evo.uiHelpers;
  const chemBar = (c, key) => bar(T.CHEM_WORDS[key], c.chem.get(key), chemColor(key));

  // Chemical groups for the Body deck
  const FEELINGS = ['reward', 'punishment', 'endorphin', 'adrenaline'];
  const NUTRIENTS = ['glucose', 'glycogen', 'fat', 'protein', 'water', 'gutSugar', 'gutStarch', 'gutProtein', 'gutFat', 'toxin'];
  const HORMONES = ['insulin', 'glucagon', 'melatonin', 'adenosine', 'growthHormone', 'sexHormone', 'liverEnzyme', 'ageing'];
  // Drives drawn in the history chart
  const HISTORY = ['hunger', 'thirst', 'tiredness', 'sleepiness', 'loneliness', 'boredom', 'coldness', 'fear', 'reward', 'punishment'];
  const HISTORY_LEN = 240, HISTORY_EVERY = 30; // Two minutes of simulated time at 1×
  // Genes left out of the comparison with the founders: every founder gets its own looks and voice
  const FOUNDER_VARIES = ['Appearance', 'Voice'];
  const GENOME_MEMORY = 400; // Genomes remembered by creature id, so a child can be compared with its parents
  const ERROR_FADE = 0.99;   // Per tick: how quickly a shown prediction error fades (about a second)
  const GLOW_TICKS = 30;     // Ticks within which a connection counts as just used: outlasts two list refreshes (every 15 ticks at 1x)
  const MUTATIONS_SHOWN = 8;   // Differences listed before the rest fold away
  const FAMILY_SHOWN = 12;     // Relatives in one list before the rest fold away
  const SYNAPSES_SHOWN = 8;    // Connections listed for a cell before 'and N weaker'
  const REMEMBER_EVERY = Evo.TICKS_PER_SECOND;    // Ticks between noting every living creature's genome
  const POP_EVERY = 10 * Evo.TICKS_PER_SECOND;    // Ticks between population chart samples
  const POP_LEN = 400;                            // Population samples kept
  const WINNER_HOLD = Evo.TICKS_PER_SECOND;       // Undecided ticks before the winning muscle is dropped
  const STIM_MV = 40;          // mV each pulse of Stimulate injects into the probed cell
  const MUSCLE_GAIN = 8;       // A muscle bar fills at this multiple of the cell's firing rate
  const BUSY_RATE = 0.04;      // A cell firing faster than this counts as busy
  const CHANGE_WORDS = { changed: 'changed', new: 'new', copy: 'extra copy', lost: 'lost' };
  // The fill of a bar that grows left or right from its middle: v in -1..1
  const centeredBar = (v, color) => {
    const width = Math.abs(v) * 50;
    return `<span style="${v >= 0 ? 'left:50%' : `left:${50 - width}%`};width:${width}%;background:${color}"></span>`;
  };
  // Body heat in words: what the creature feels (its coldness or hotness drive, at the level the card shows a need)
  const tempWord = c => {
    const cold = c.chem.get('coldness'), hot = c.chem.get('hotness'), shown = Evo.DRIVE_SHOWN.shown;
    return cold > shown && cold >= hot ? 'cold' : hot > shown ? 'hot' : 'fine';
  };

  class Inspector {
    constructor(app) {
      this.app = app;
      this.deck = 'body';
      this.brainView = new Evo.BrainView($('brainCanvas'));
      this.scope = new Evo.VoltageScope($('scopeCanvas'));
      this.genesFor = null;
      this.history = null;
      this.population = [];
      this.genomes = new Map(); // Creature id -> genome, for comparing children with their parents
      this.mind = null;         // What the followed creature's brain is up to (see sample)
      this.chart = $('historyCanvas');
      this.chartCtx = this.chart.getContext('2d');
      this.popChart = $('popCanvas');
      this.popCtx = this.popChart.getContext('2d');

      $('brainCanvas').addEventListener('pointerdown', e => {
        const r = e.currentTarget.getBoundingClientRect();
        this.brainView.tapAt(e.clientX - r.left, e.clientY - r.top);
        this.renderProbe();
      });
      $('stimulateBtn').addEventListener('click', () => this.stimulate());
      $('clearNeuronBtn').addEventListener('click', () => { this.brainView.probed = -1; this.renderProbe(); });
      $('clearRegionBtn').addEventListener('click', () => { this.brainView.region = null; this.renderProbe(); });
      document.querySelectorAll('[data-brain-mode]').forEach(btn => btn.addEventListener('click', () => {
        this.brainView.setMode(btn.dataset.brainMode);
        document.querySelectorAll('[data-brain-mode]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
        $('deck-brain').classList.toggle('anatomy', btn.dataset.brainMode === 'anatomy');
      }));
      $('wiringBtn').addEventListener('click', e => {
        this.brainView.allWiring = !this.brainView.allWiring;
        e.currentTarget.setAttribute('aria-pressed', String(this.brainView.allWiring));
      });
      $('neuronLinks').addEventListener('click', e => {
        const el = e.target.closest('[data-neuron]');
        if (!el) return;
        this.brainView.probed = Number(el.dataset.neuron);
        this.renderProbe();
      });
      $('geneFilter').addEventListener('input', () => this.filterGenes());
      // Links to other creatures anywhere in the panel
      $('labInner').addEventListener('click', e => {
        const el = e.target.closest('[data-creature]');
        if (!el) return;
        const c = this.app.world.creatureById(Number(el.dataset.creature));
        if (c) this.app.select(c);
      });
      $('skipSeasonBtn').addEventListener('click', () => this.app.skipSeason());
    }

    resize() {
      this.brainView.resize();
      this.scope.resize();
      for (const [canvas, ctx] of [[this.chart, this.chartCtx], [this.popChart, this.popCtx]]) Evo.fitCanvas(canvas, ctx, 200, 60);
    }

    setDeck(deck) {
      this.deck = deck;
      this.update(true);
    }

    // The followed creature changed
    focusChanged() {
      const c = this.app.focus;
      this.brainView.setBrain(c ? c.brain : null);
      this.genesFor = null;
      this.history = c ? { id: c.id, data: HISTORY.map(() => new Float32Array(HISTORY_LEN)), n: 0 } : null;
      this.mind = c ? { error: [0, 0], winner: -1, since: 0, idle: 0 } : null;
      if (c) this.remember(c);
      this.update(true);
    }

    remember(c) {
      if (this.genomes.has(c.id)) return;
      this.genomes.set(c.id, c.genome);
      if (this.genomes.size > GENOME_MEMORY) this.genomes.delete(this.genomes.keys().next().value);
    }

    // Every tick: sample the drive history, what the brain is up to, and the population
    sample(world) {
      const c = this.app.focus, tick = world.clock.tick;
      if (c && this.history && tick % HISTORY_EVERY === 0) {
        const h = this.history, k = h.n % HISTORY_LEN;
        HISTORY.forEach((key, i) => { h.data[i][k] = c.chem.get(key); });
        h.n++;
      }
      if (c && this.mind) this.sampleMind(c.brain, tick);
      if (tick % REMEMBER_EVERY === 0) for (const x of world.creatures) this.remember(x);
      if (tick % POP_EVERY === 0 || !this.population.length) {
        this.population.push(world.creatures.length);
        if (this.population.length > POP_LEN) this.population.shift();
      }
    }

    // Prediction errors are single-tick blips: keep each channel's latest big one, fading. And which
    // muscle cell is winning (brain.decided()), held until another takes over.
    sampleMind(b, tick) {
      const m = this.mind;
      for (let ch = 0; ch < Evo.BRAIN.N_MOD; ch++) {
        const d = b.delta[ch], faded = m.error[ch] * ERROR_FADE;
        m.error[ch] = Math.abs(d) > Math.abs(faded) ? d : faded;
      }
      const k = b.decided(), best = k >= 0 ? b.lobes.motor[k] : -1;
      if (best >= 0) {
        m.idle = 0;
        if (best !== m.winner) { m.winner = best; m.since = tick; }
      } else if (++m.idle > WINNER_HOLD) m.winner = -1;
      m.tick = tick;
    }

    update(force = false) {
      const c = this.app.focus;
      const has = !!c;
      document.querySelectorAll('.needs-creature').forEach(el => el.classList.toggle('hidden', !has));
      document.querySelectorAll('.no-creature').forEach(el => el.classList.toggle('hidden', has || this.deck === 'world'));
      if (this.deck === 'world') return this.renderWorld();
      if (!c) return;
      if (this.deck === 'body') this.renderBody(c);
      else if (this.deck === 'brain') { this.renderMind(c); this.renderLearned(c); this.renderMuscles(c); this.renderProbe(); this.renderBrainCounts(c); }
      else if (this.deck === 'genes') { if (force || this.genesFor !== c || this.genesStage !== c.stage) this.renderGenes(c); }
      else if (this.deck === 'family') this.renderFamily(c);
    }

    // Every frame while the brain deck shows
    frame() {
      const c = this.app.focus;
      if (!c || this.deck !== 'brain') return;
      this.brainView.setBrain(c.brain);
      this.brainView.render();
      const b = c.brain, i = this.scopeCell(b);
      if (i !== this.scopeFor) { this.scope.clear(); this.scopeFor = i; } // Don't join one cell's trace to another's
      this.scope.render(b.thr[i]);
    }

    // Every tick while the brain deck shows: one charge sample, so the trace is the last 120 ticks at
    // any speed and stands still while paused. (Ticks run with the deck closed leave a gap; the scope
    // is only ever looked at with it open, and it is cleared on the way in below.)
    scopeTick() {
      const c = this.app.focus;
      if (!c || this.deck !== 'brain' || !this.app.labVisible()) { this.scopeOpen = false; return; }
      const b = c.brain, i = this.scopeCell(b);
      if (i !== this.scopeFor || !this.scopeOpen) { this.scope.clear(); this.scopeFor = i; this.scopeOpen = true; }
      this.scope.push(b.vShow[i]);
    }

    // The neuron the charge trace follows: the tapped one, else the winning muscle
    scopeCell(b) {
      const i = this.brainView.probed;
      if (i >= 0 && i < b.N) return i;
      const w = this.mind ? this.mind.winner : -1;
      return w >= 0 ? w : b.lobes.motor[0];
    }

    // ---------- Body ----------
    renderBody(c) {
      const st = Evo.STAGES[c.stage];
      const bits = [`<b>${sexWord(c.sex)}</b>`, st.word.toLowerCase(), `${T.clock(c.ageTicks)} old (lives about ${T.clock(c.lifespan)})`, `generation ${c.generation}`, plural(c.meals, 'meal', 'meals')];
      let status = c.dead ? 'Dead.' : c.asleep ? 'Asleep.' : `${T.ACTION_WORDS[c.action] || c.action}, feeling ${c.mood}.`;
      if (c.pregnancy) status += ` Carrying an egg (${percent(c.pregnancy.progress)} formed).`;
      if (c.carrying) status += ` Holding ${Evo.ITEM_TYPES[c.carrying.type].word}.`;
      $('lifeLine').innerHTML = `${bits.join(', ')}. ${esc(status)}`;

      const temp = c.bodyTemp;
      const word = tempWord(c);
      const tempColor = word === 'cold' ? 'var(--water)' : word === 'hot' ? 'var(--fruit)' : 'var(--accent)';
      $('barsVitals').innerHTML =
        bar('Health', c.health, 'var(--protein)') +
        bar('Injury', c.injury, 'var(--injury)') +
        bar('Body heat', temp, tempColor, word) +
        bar('Grown', c.growth, 'var(--grain)');
      const drives = Evo.DRIVES.map(k => [k, c.chem.get(k)]).sort((a, b) => b[1] - a[1]);
      $('barsDrives').innerHTML = drives.map(([k]) => chemBar(c, k)).join('');
      $('barsFeelings').innerHTML = FEELINGS.map(k => chemBar(c, k)).join('');
      $('barsNutrients').innerHTML = NUTRIENTS.map(k => chemBar(c, k)).join('');
      $('barsHormones').innerHTML = HORMONES.map(k => chemBar(c, k)).join('');
      // Chemicals with no name: only mutation can have put anything there
      const other = [];
      for (let i = 1; i < Evo.N_CHEM; i++) if (!Evo.CHEM_BY_ID[i] && c.chem.c[i] > 0.005) other.push(bar(`Chemical ${i}`, c.chem.c[i], 'var(--copy)'));
      $('barsOther').innerHTML = other.join('') || '<p class="note">None. Mutations can make new chemicals appear here.</p>';
      this.renderHistory();
    }

    renderHistory() {
      const h = this.history, ctx = this.chartCtx;
      const legend = $('historyLegend');
      if (!legend.firstChild) legend.innerHTML = HISTORY.map(k => `<span><i style="background:${chemColor(k)}"></i>${T.CHEM_WORDS[k]}</span>`).join('');
      const w = this.chart.clientWidth, hh = this.chart.clientHeight;
      ctx.clearRect(0, 0, w, hh);
      if (!h || h.n < 2) return;
      const n = Math.min(h.n, HISTORY_LEN), start = h.n - n;
      HISTORY.forEach((key, i) => {
        ctx.strokeStyle = Evo.theme.color(chemToken(key));
        ctx.lineWidth = key === 'reward' || key === 'punishment' ? 1 : 1.6;
        ctx.globalAlpha = key === 'reward' || key === 'punishment' ? 0.6 : 0.9;
        ctx.beginPath();
        for (let j = 0; j < n; j++) {
          const v = h.data[i][(start + j) % HISTORY_LEN];
          const x = (j + HISTORY_LEN - n) / (HISTORY_LEN - 1) * w, y = hh - 2 - v * (hh - 4);
          if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
    }

    // ---------- Brain ----------
    renderBrainCounts(c) {
      const b = c.brain;
      $('brainCounts').textContent = `${b.N} neurons and ${b.S} connections, grown from its genes. ` +
        `${b.sproutedCount} connections grown and ${b.prunedCount} pruned in its life.`;
    }

    // The attention region's cell for what it is attending to, or -1
    attendedCell(b, att) {
      const lobe = (b.duplicatesOf.sight || [])[0];
      if (!att || !lobe) return -1;
      const i = b.lobes[lobe].find(k => { const m = b.neurons[k].meta; return m.side === att.side && m.band === att.band && m.feature === att.feature; });
      return i === undefined ? -1 : i;
    }

    // A readout of what the brain is doing right now, like a lab instrument panel
    renderMind(c) {
      const b = c.brain, m = this.mind, rows = [];
      const row = (k, v, cls = '') => rows.push(`<div class="mind-row${cls}"><span class="mind-k">${k}</span><span class="mind-v">${v}</span></div>`);
      const tick = this.app.world.clock.tick;

      // Attention
      const att = b.attended(), hasAttention = (b.duplicatesOf.sight || []).some(l => T.isAttention(b, l));
      row('Looking at', !hasAttention ? '<span class="muted">nothing: it has no attention region (a gene is missing)</span>'
        : c.asleep ? '<span class="muted">nothing (asleep)</span>'
          : att ? `<b>${esc(T.FEATURE_WORDS[att.feature])}</b> ${T.whereSeen(att)}`
            : '<span class="muted">nothing in particular</span>');

      // Decision
      const w = m.winner;
      const doing = w >= 0 ? `<b>${esc(T.MOTOR_WORDS[b.neurons[w].meta.key] || T.neuronName(b, b.neurons[w]))}</b>, for ${T.duration(tick - m.since)}` : '<span class="muted">nothing yet</span>';
      row('Decided to', `${doing} <span class="muted">· body: ${esc((T.ACTION_WORDS[c.action] || c.action).toLowerCase())}</span>`);

      // Prediction errors: how things turned out against what it expected
      const surprise = (ch, label, good, bad) => {
        const e = m.error[ch];
        const color = (ch === 0) === (e >= 0) ? 'var(--joy)' : 'var(--stress)';
        const verdict = e > 0.1 ? good : e < -0.1 ? bad : 'as expected';
        const expects = T.level(b.value[ch], 0, 1.6, ['expects nothing much', 'expects a little', 'expects some', 'expects a lot']);
        rows.push(`<div class="mind-row"><span class="mind-k">${label}</span><span class="mind-v mind-meter"><span class="centered-track" title="Prediction error ${T.signed(e)}">${centeredBar(clamp(e, -1, 1), color)}</span>` +
          `<span>${verdict} <span class="muted">· ${expects}</span></span></span></div>`);
      };
      surprise(0, 'Reward', 'better than expected', 'less than expected');
      surprise(1, 'Punishment', 'worse than expected', 'not as bad as feared');

      // Working memory: thinking cells that keep going
      const cortex = b.lobes.cortex || [];
      let on = 0, left = 0;
      for (const i of cortex) if (b.rate[i] > BUSY_RATE) { on++; if (b.neurons[i].pos[0] < 0.5) left++; }
      const side = on < 2 ? '' : left > on * 0.65 ? ', mostly the left side' : left < on * 0.35 ? ', mostly the right side' : ', both sides';
      row('Thinking', on ? `${on} of ${cortex.length} cells busy${side}` : '<span class="muted">quiet</span>');

      // Sleep and dreams
      let sleep;
      if (!c.asleep) sleep = `awake <span class="muted">· ${b.episodes.length} surprising ${b.episodes.length === 1 ? 'moment' : 'moments'} saved to dream about</span>`;
      else if (!b.dream) sleep = 'asleep, not dreaming';
      else if (b.dream.instinct) {
        sleep = `<b>dreaming</b> an instinct: ${esc(T.describeInstinct(b.dream.instinct, b))}`;
      } else {
        const ep = b.dream.episode, cue = ep.inputs.length ? T.neuronName(b, b.neurons[ep.inputs[0]]).toLowerCase() : 'nothing much';
        const act = ep.motor >= 0 ? `, ${T.MOTOR_WORDS[b.neurons[ep.motor].meta.key].toLowerCase()}` : '';
        sleep = `<b>reliving</b> a ${ep.value > 0 ? 'good' : 'bad'} moment: ${esc(cue)}${esc(act)}`;
      }
      row('Sleep', sleep, c.asleep && b.dream ? ' dreaming' : '');

      // The last thing that happened to it
      const ls = c.lastStimulus;
      row('Last event', ls ? `${esc(T.STIMULUS_PAST[ls.key] || ls.key)} <span class="muted">· ${T.ago(c.ageTicks - ls.age)}</span>` : '<span class="muted">nothing yet</span>');
      if (b.seizures || b.brake) row('Seizures', `${b.brake ? '<b>brake on now</b> · ' : ''}the brake has come on ${plural(b.seizures, 'time', 'times')}`, ' alert');
      $('mindRows').innerHTML = rows.join('');
      this.brainView.marks.attended = this.attendedCell(b, att);
      this.brainView.marks.winner = w;
    }

    // The tapped neuron or region
    renderProbe() {
      const c = this.app.focus, b = c && c.brain, view = this.brainView;
      const neuron = !!(b && view.probed >= 0 && view.probed < b.N), region = !!(b && !neuron && view.region && b.lobes[view.region]);
      $('neuronEmpty').classList.toggle('hidden', neuron || region);
      $('neuronDetail').classList.toggle('hidden', !neuron);
      $('regionDetail').classList.toggle('hidden', !region);
      const scoped = b ? b.neurons[this.scopeCell(b)] : null;
      $('scopeTitle').textContent = scoped ? `Charge: ${T.neuronName(b, scoped).toLowerCase()}` : 'Charge';
      if (neuron) this.renderNeuron(b, view.probed);
      else if (region) this.renderRegion(b, view.region);
    }

    renderRegion(b, lobe) {
      const cells = b.lobes[lobe];
      let busy = 0, firing = 0;
      for (const i of cells) { if (b.rate[i] > BUSY_RATE) busy++; if (b.hist[i] & 0xF) firing++; }
      $('regionName').textContent = T.regionName(b, lobe);
      $('regionSize').textContent = `${cells.length} cells`;
      $('regionAbout').textContent = T.regionAbout(b, lobe);
      const dyn = b.dynamics.find(d => d.lobe === lobe);
      const facts = [`<span><b>${busy}</b> busy</span>`, `<span><b>${firing}</b> firing now</span>`];
      if (dyn) {
        const { compete, persist } = T.dynamicsWords(dyn);
        facts.push(`<span>Cells compete <b>${compete}</b></span>`, `<span>and keep firing <b>${persist}</b></span>`);
      }
      $('regionFacts').innerHTML = facts.join('');
    }

    renderNeuron(b, i) {
      const n = b.neurons[i], now = b.tickCount;
      $('neuronName').textContent = T.neuronName(b, n);
      $('neuronLobe').textContent = T.lobeName(b, n);
      $('neuronRole').textContent = T.neuronRole(b, n);
      const h = b.hist[i], last = h ? 31 - Math.clz32(h & -h) : -1;
      const ins = [], outs = [];
      for (let s = 0; s < b.S; s++) {
        if (b.sSrc[s] === i) outs.push(s);
        else if (b.sDst[s] === i) ins.push(s);
      }
      $('neuronFacts').innerHTML = [
        `<span>Fires <b>${percent(b.rate[i])}</b> of the time</span>`,
        `<span>Last fired <b>${last < 0 ? 'over half a second ago' : last === 0 ? 'just now' : `${last} ticks ago`}</b></span>`,
        `<span>Charge <b>${b.vShow[i] > 0 ? 'firing' : `${Math.max(0, Math.round(b.thr[i] - b.vShow[i]))} mV below firing`}</b></span>`,
        `<span><b>${ins.length}</b> in, <b>${outs.length}</b> out</span>`
      ].join('');
      const list = (title, syns, otherEnd) => {
        if (!syns.length) return '';
        syns.sort((x, y) => Math.abs(b.sW[y]) - Math.abs(b.sW[x]));
        const rows = syns.slice(0, SYNAPSES_SHOWN).map(s => {
          const w = b.sW[s], width = Math.round(Math.sqrt(Math.min(1, Math.abs(w) / Evo.BRAIN.WEIGHT_MAX)) * 100), other = otherEnd(s); // Most are weak: a square root spreads them out
          const name = T.neuronName(b, b.neurons[other]);
          const grown = b.sFlags[s] & Evo.BRAIN.SPROUTED ? '<i class="grown" title="grown in life"></i>' : '';
          return `<button class="link" data-neuron="${other}" data-syn="${s}" title="${esc(name)}"><span class="who">${grown}${esc(name)}</span>` +
            `<span class="strength"><span style="left:0;width:${width}%;background:${w >= 0 ? 'var(--water)' : 'var(--stress)'}"></span></span><span class="delay">${b.sDelay[s]}t</span></button>`;
        }).join('');
        const more = syns.length > SYNAPSES_SHOWN ? `<p class="note">and ${syns.length - SYNAPSES_SHOWN} weaker</p>` : '';
        return `<div class="link-list"><h4>${title}</h4>${rows}${more}</div>`;
      };
      const predicts = b.modulator[i] >= 0;
      const html = list(predicts ? 'Predicts from' : 'Listens to', ins, s => b.sSrc[s]) + list('Sends to', outs, s => b.sDst[s]);
      const links = $('neuronLinks');
      setHtml(links, html
        ? `<p class="note">Strongest first; tap one to go there. Blue excites, rose holds back; a green dot marks a connection grown in life, a glow one just used. Last column: travel time in ticks.</p>${html}`
        : '<p class="empty">No connections yet.</p>');
      // The glow changes every refresh: set it in place, so the buttons stay put under a finger
      for (const el of links.querySelectorAll('[data-syn]')) el.classList.toggle('active', now - b.sActive[+el.dataset.syn] < GLOW_TICKS);
    }

    stimulate() {
      const c = this.app.focus, i = this.brainView.probed;
      if (!c || i < 0) return;
      for (let k = 1; k <= 6; k += 2) c.brain.inject(i, STIM_MV, k);
    }

    // What each sight and smell has come to predict, from the cue synapses onto the reward and
    // punishment cells (they start equal, so any difference was learned)
    renderLearned(c) {
      const b = c.brain, rows = new Map();
      for (let s = 0; s < b.S; s++) {
        if (!(b.sFlags[s] & Evo.BRAIN.CUE)) continue;
        const src = b.neurons[b.sSrc[s]], m = src.meta;
        const key = m.kind === 'sight' ? `Seeing ${T.FEATURE_WORDS[m.feature]}` : `Smelling ${T.ODOUR_WORDS[m.odour]}`;
        const row = rows.get(key) || { good: 0, bad: 0, n: 0 };
        if (b.modulator[b.sDst[s]] === 0) row.good += b.sW[s]; else row.bad += b.sW[s];
        row.n++;
        rows.set(key, row);
      }
      const list = [...rows.entries()].map(([k, r]) => [k, (r.good - r.bad) / Math.max(1, r.n / 2)]).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])).slice(0, 10);
      $('learnedList').innerHTML = list.length ? list.map(([label, net]) => {
        const v = clamp(net * 2, -1, 1);
        const verdict = net > 0.05 ? 'good news' : net < -0.05 ? 'trouble' : 'no meaning yet';
        return `<div class="learn-row"><span>${esc(label)}</span><div class="centered-track">${centeredBar(v, v >= 0 ? 'var(--joy)' : 'var(--stress)')}</div><span class="verdict">${verdict}</span></div>`;
      }).join('') : '<p class="empty">No senses are wired to its feelings.</p>';
    }

    renderMuscles(c) {
      const b = c.brain, w = this.mind ? this.mind.winner : -1;
      $('barsMuscles').innerHTML = Evo.MOTORS.map((m, k) => {
        const i = b.lobes.motor[k];
        return bar(i === w ? `${m.word} ◂` : m.word, Math.min(1, b.rate[i] * MUSCLE_GAIN), i === w ? 'var(--energy)' : b.hist[i] & 1 ? 'var(--pulse)' : 'var(--accent)', percent(b.rate[i]));
      }).join('');
    }

    // ---------- Genes ----------
    renderGenes(c) {
      this.genesFor = c;
      this.genesStage = c.stage;
      const g = c.genome, genes = g.findGenes();
      $('genesSummary').textContent = `${genes.length} genes in ${g.dna.length} bytes of DNA. ${g.sexChrom === 'Y' ? 'Male (XY)' : 'Female (XX)'}. ` +
        `${plural(g.mutationCount, 'mutation', 'mutations')} in its family line since the founders.`;
      $('traitList').innerHTML = T.traitWords(c.traits).map(([k, v, exact]) =>
        `<div class="trait"><span>${k}</span><b title="${esc(exact)}">${esc(v)} <span class="exact">${esc(exact)}</span></b></div>`).join('');
      const marked = this.renderMutations(c);

      const groups = { body: [], brain: [], chemistry: [], instinct: [] };
      for (const gene of genes) {
        const d = T.describeGene(g, gene, c.brain);
        const later = gene.stage > Math.max(1, c.stage);
        const when = gene.stage > 1 ? `<span class="stage-tag${later ? ' later' : ''}">${later ? 'from' : 'since'} ${Evo.STAGES[gene.stage].word.toLowerCase()}</span>` : '';
        const mut = marked.get(gene.start);
        const tag = mut ? `<span class="mut-tag ${mut}">${mut === 'copy' ? 'extra copy' : mut}</span>` : '';
        // Chemistry and instinct genes go under headings that already name them, so they drop the name
        const bare = d.group === 'chemistry' || d.group === 'instinct';
        const text = d.group === 'instinct' ? T.describeInstinct(g.decode(gene), c.brain) : d.text;
        groups[d.group].push({ kind: d.kind, sortBy: text, html: `<div class="gene${later ? ' dormant' : ''}${bare ? ' bare' : ''}" data-find="${esc(`${d.name} ${d.text}`.toLowerCase())}">` +
          `${bare ? '' : `<span class="gene-name">${esc(d.name)}</span>`}<span class="gene-text">${esc(text)}</span><span class="gene-tags">${tag}${when}</span></div>` });
      }
      for (const k in groups) {
        const kinds = T.GENE_KINDS[k];
        // Grouped by kind where the group has kinds (then only genes of a listed kind show, and count)
        const list = kinds ? groups[k].filter(x => kinds.some(({ kind }) => kind === x.kind)) : groups[k];
        let html;
        if (!kinds) html = list.map(x => x.html).join('');
        else {
          // Chemistry genes sorted by what they say, so genes about one chemical sit together
          html = kinds.map(({ kind, note }) => {
            const own = list.filter(x => x.kind === kind);
            if (k === 'chemistry') own.sort((a, z) => a.sortBy.localeCompare(z.sortBy));
            if (!own.length) return '';
            return `<details class="gene-kind"${k === 'brain' && kind !== 'Wiring' ? ' open' : ''}><summary>${kind} <span class="count">${own.length}</span></summary>` +
              `${note ? `<p class="note">${note}</p>` : ''}${own.map(x => x.html).join('')}</details>`;
          }).join('');
        }
        $(`genes-${k}`).innerHTML = html || '<p class="empty">None.</p>';
        $(`genes-${k}-count`).textContent = list.length;
      }
      this.renderDNA(g, genes);
      this.filterGenes();
    }

    // Changes against its parents (when their genes are known) and against the founders. Returns
    // gene start -> kind of change, for tagging the gene lists (against the parents if known).
    renderMutations(c) {
      const g = c.genome, hist = this.app.world.history, marked = new Map();
      const varies = new Set(FOUNDER_VARIES.map(n => Evo.GENE_INDEX[n]));
      let parentVaries = 0; // Changes from the parents in genes left out of the founder comparison
      const parents = [c.motherId, c.fatherId].filter(id => id !== null).map(id => ({ id, genome: this.genomes.get(id), rec: hist.find(h => h.id === id) }));
      const known = parents.filter(p => p.genome);
      const sections = [];
      if (c.motherId === null) {
        sections.push(`<p class="note">${c.generation > 1 ? 'It wandered in from outside, so its parents are not known here.' : 'A founder: it has no parents here.'}</p>`);
      } else if (known.length) {
        const names = known.map(p => (p.rec ? esc(p.rec.name) : 'a parent')).join(' and ');
        const changes = T.geneChanges(g, known.map(p => p.genome));
        for (const ch of changes) if (ch.gene) marked.set(ch.gene.start, ch.kind);
        parentVaries = changes.filter(ch => ch.gene && varies.has(ch.gene.type)).length;
        sections.push(this.changeList(c, changes, `Compared with its parents, ${names}`,
          'Exactly as inherited: every gene is one of its parents\' genes, mixed by recombination.'));
      } else sections.push('<p class="note">Its parents lived before you started watching, so their genes are not known.</p>');
      const founders = T.geneChanges(g, [T.founderGenome(g.sexChrom)], FOUNDER_VARIES);
      const tagged = marked.size;
      if (!tagged) for (const ch of founders) if (ch.gene) marked.set(ch.gene.start, ch.kind);
      // Children of founders: the two lists would say the same thing (but for looks and voice)
      const fromParents = marked.size - parentVaries;
      const same = tagged && founders.length === fromParents && founders.every(ch => ch.gene && marked.get(ch.gene.start) === ch.kind);
      if (same) sections.push('<p class="note">Its parents were founders, so these are also its differences from the first creatures.</p>');
      else {
        sections.push(this.changeList(c, founders, 'Compared with the first creatures',
          'The same genes as the founders (only looks and voice, which every founder gets its own of, can differ).'));
      }
      $('mutationList').innerHTML = sections.join('');
      return marked;
    }

    changeList(c, changes, title, none) {
      if (!changes.length) return `<div class="mut-block"><h4>${title}</h4><p class="note">${none}</p></div>`;
      const order = { changed: 0, new: 1, copy: 2, lost: 3 };
      const rows = changes.slice().sort((a, z) => order[a.kind] - order[z.kind]).map(ch => {
        const gene = ch.gene || ch.ref.gene, genome = ch.gene ? c.genome : ch.ref.genome;
        const d = T.describeGene(genome, gene, c.brain);
        let body = `<span class="mut-text">${esc(d.text)}</span>`;
        if (ch.kind === 'changed') {
          const before = T.describeGene(ch.ref.genome, ch.ref.gene, c.brain).text;
          const fields = T.fieldChanges(c.genome, ch.gene, ch.ref.genome, ch.ref.gene)
            .map(f => `${esc(f.field)} <s>${esc(f.before)}</s> → <b>${esc(f.after)}</b>`).join(' · ');
          body = before !== d.text ? `<span class="mut-text"><s>${esc(before)}</s><br>${esc(d.text)}</span>` : body;
          if (fields) body += `<span class="mut-fields">${fields}</span>`;
        }
        return `<div class="mut"><span class="mut-tag ${ch.kind}">${CHANGE_WORDS[ch.kind]}</span><span class="mut-name">${esc(d.name)}</span>${body}</div>`;
      });
      const shown = rows.slice(0, MUTATIONS_SHOWN).join(''), rest = rows.length > MUTATIONS_SHOWN ? `<details class="mut-more"><summary>${rows.length - MUTATIONS_SHOWN} more</summary>${rows.slice(MUTATIONS_SHOWN).join('')}</details>` : '';
      return `<div class="mut-block"><h4>${title}: ${plural(changes.length, 'difference', 'differences')}</h4>${shown}${rest}</div>`;
    }

    // Show only genes whose name or words contain the search text (opening the groups they are in)
    filterGenes() {
      const q = $('geneFilter').value.trim().toLowerCase();
      let n = 0;
      document.querySelectorAll('#deck-genes .gene').forEach(el => {
        const hit = !q || el.dataset.find.includes(q);
        el.classList.toggle('hidden', !hit);
        if (hit) n++;
      });
      if (q) {
        document.querySelectorAll('#deck-genes details.gene-group, #deck-genes details.gene-kind').forEach(d => {
          const any = !!d.querySelector('.gene:not(.hidden)');
          d.classList.toggle('hidden', !any);
          if (any) d.open = true;
        });
      } else document.querySelectorAll('#deck-genes details.gene-group, #deck-genes details.gene-kind').forEach(d => d.classList.remove('hidden'));
      $('geneFilterCount').textContent = q ? plural(n, 'gene', 'genes') : '';
    }

    renderDNA(g, genes) {
      const at = new Int32Array(g.dna.length).fill(-1);
      genes.forEach((x, gi) => { for (let k = x.start; k < x.end; k++) at[k] = gi; });
      const palette = ['var(--water)', 'var(--grain)', 'var(--protein)', 'var(--female)', 'var(--toxin)'];
      const digits = Math.max(3, (g.dna.length - 1).toString(16).length); // Every address as wide as the last
      let html = '';
      for (let i = 0; i < g.dna.length; i += 16) {
        const cells = [];
        for (let k = i; k < Math.min(i + 16, g.dna.length); k++) {
          const hex = g.dna[k].toString(16).padStart(2, '0').toUpperCase(), gi = at[k];
          if (gi < 0) cells.push(`<span class="junk">${hex}</span>`);
          else if (k === genes[gi].start) cells.push(`<span class="prom">${hex}</span>`);
          else cells.push(`<span style="color:${palette[gi % palette.length]}">${hex}</span>`);
        }
        html += `<div class="dna-row"><span class="addr">${i.toString(16).padStart(digits, '0')}</span><span>${cells.join(' ')}</span></div>`;
      }
      $('dnaGrid').innerHTML = html;
    }

    // ---------- Family ----------
    // Its family from world.history (everyone who has lived here): parents, grandparents, brothers
    // and sisters (half ones marked), children and grandchildren. The living can be selected; the
    // dead say when they lived.
    renderFamily(c) {
      const world = this.app.world;
      const kin = Evo.kinOf(Evo.kinIndex(world.history), c.id);
      if (!kin) return;
      const day = tick => Math.floor((tick + world.startPhase * Evo.DAY_TICKS) / Evo.DAY_TICKS) + 1;
      const person = (h, note = '') => {
        if (!h) return '<span class="muted">unknown</span>';
        const alive = world.creatureById(h.id);
        const who = `<span class="sex-glyph" style="color:${sexColor(h.sex)}">${sexGlyph(h.sex)}</span>` +
          `<span>${esc(h.name)} <span class="meta">gen ${h.generation}${note ? ` · ${note}` : ''}</span></span>`;
        if (alive) return `<button class="member" data-creature="${h.id}">${who}<span class="meta">${alive === c ? 'this one' : 'alive'}</span></button>`;
        const came = `${h.motherId === null ? 'Arrived' : 'Hatched'} on day ${day(h.born)}`;
        const fate = h.died !== null ? T.DEATH_WORDS[h.cause] || 'died' : 'gone';
        const title = h.died !== null ? `${came}; ${fate} on day ${day(h.died)}` : came;
        return `<div class="member gone" title="${esc(title)}">${who}<span class="meta">${esc(fate)}${h.died !== null ? `, day ${day(h.died)}` : ''}</span></div>`;
      };
      // A list of people, the rest folded away past FAMILY_SHOWN
      const list = (people, none, note = () => '') => {
        if (!people.length) return `<p class="note">${none}</p>`;
        const rows = people.map(h => person(h, note(h)));
        return rows.slice(0, FAMILY_SHOWN).join('') + (rows.length > FAMILY_SHOWN
          ? `<details class="family-more"><summary>${rows.length - FAMILY_SHOWN} more</summary>${rows.slice(FAMILY_SHOWN).join('')}</details>` : '');
      };

      const { outsider, children, grandchildren, descendants } = kin;
      setHtml($('familyParents'), outsider
        ? `<p class="note">${c.generation > 1 ? 'It wandered in from outside: its parents never lived here.' : 'A founder: it came into the world grown, with no parents here.'}</p>`
        : person(kin.mother, 'mother') + person(kin.father, 'father'));
      setHtml($('familyGrandparents'), kin.grandparents.map(g => person(g.rec, `${g.of}'s ${g.role}`)).join('') ||
        `<p class="note">${outsider ? 'Its family lived somewhere else.' : 'Its parents came from outside, so their parents never lived here.'}</p>`);
      const half = new Set(kin.siblings.filter(s => s.half).map(s => s.rec));
      setHtml($('familySiblings'), list(kin.siblings.map(s => s.rec), 'None.', h => (half.has(h) ? 'half' : '')));
      setHtml($('familyChildren'), list(children, `None yet.${c.pregnancy ? ' One is on the way.' : ''}`));
      setHtml($('familyGrandchildren'), list(grandchildren, 'None yet.'));
      const living = descendants.filter(h => world.creatureById(h.id)).length;
      $('familyLine').textContent = `Generation ${c.generation}. ${plural(children.length, 'child', 'children')}, ${plural(grandchildren.length, 'grandchild', 'grandchildren')}` +
        (descendants.length > children.length + grandchildren.length ? `, ${plural(descendants.length, 'descendant', 'descendants')} in all` : '') +
        (descendants.length ? `; ${living} of them alive` : '') + `. Mated ${plural(c.timesMated, 'time', 'times')}.`;
    }

    // ---------- World ----------
    renderWorld() {
      const world = this.app.world, st = world.stats, clock = world.clock;
      const deaths = Object.values(st.deaths).reduce((a, v) => a + v, 0);
      const temp = world.temperatureAt(world.width / 2, world.terrain.groundY(world.width / 2) - 20);
      $('worldLine').textContent = `Day ${clock.day + 1}, ${T.timeOfDay(clock.phase)}. ${world.seasonInfo.word}, ${temp < 0.3 ? 'cold' : temp > 0.62 ? 'hot' : temp < 0.42 ? 'cool' : 'mild'}. ${world.foodCount} bits of food about.`;
      const tile = (v, label) => `<div class="tile"><b>${v}</b><span>${label}</span></div>`;
      $('worldTiles').innerHTML = tile(world.creatures.length, 'living') + tile(st.hatched, 'hatched') + tile(st.eggsLaid, 'eggs laid') + tile(st.matings, 'matings') +
        tile(st.meals, 'meals') + tile(st.poisonings, 'poisonings') + tile(st.wanderers, 'wanderers') + tile(deaths, 'deaths');
      const causes = Object.entries(st.deaths).filter(([, v]) => v).map(([k, v]) => `${v} ${T.DEATH_WORDS[k] || k}`);
      $('deathBreakdown').textContent = (causes.length ? `Of the dead: ${causes.join(', ')}.` : 'No deaths yet.') + (st.refoundings ? ` Re-founded ${st.refoundings} times from proven breeders.` : '');
      const list = [...world.creatures].sort((a, b) => b.generation - a.generation || b.ageTicks - a.ageTicks);
      setHtml($('roster'), list.map(c => {
        const need = c.topDrives(1)[0];
        return `<button class="member" data-creature="${c.id}" aria-current="${c === this.app.focus}">` +
          `<span class="sex-glyph" style="color:${sexColor(c.sex)}">${sexGlyph(c.sex)}</span>` +
          `<span>${esc(c.name)}<br><span class="meta">${Evo.STAGES[c.stage].word}, gen ${c.generation}, ${esc(T.ACTION_WORDS[c.action] || c.action).toLowerCase()}</span></span>` +
          `<span class="meta">${need && need[1] > Evo.DRIVE_SHOWN.shown ? esc(T.CHEM_WORDS[need[0]].toLowerCase()) : ''}</span></button>`;
      }).join('') || '<p class="empty">Nobody lives here now.</p>');
      this.renderPopulation();
    }

    renderPopulation() {
      const ctx = this.popCtx, w = this.popChart.clientWidth, h = this.popChart.clientHeight, data = this.population;
      ctx.clearRect(0, 0, w, h);
      if (data.length < 2) return;
      const max = Math.max(Evo.LIMITS.MAX_POPULATION, ...data);
      ctx.strokeStyle = Evo.theme.color('--accent'); ctx.lineWidth = 1.6;
      ctx.fillStyle = Evo.theme.rgba('--accent', 0.12);
      ctx.beginPath();
      data.forEach((v, i) => { const x = i / (data.length - 1) * w, y = h - 2 - v / max * (h - 6); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke();
      ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();
    }
  }

  Evo.Inspector = Inspector;
})(globalThis.Evo);
