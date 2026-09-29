// The inside view: what is going on inside the followed creature (body chemistry, brain, genes,
// family) and in the world as a whole. Each deck renders from the simulation on demand: the app
// calls update() a few times a second for the visible deck, frame() every frame (the brain map and
// charge trace) and sample() every simulation tick (history, and what the brain is up to).
(function (Evo) {
  'use strict';
  const { clamp } = Evo.util;
  const T = Evo.text;
  const $ = id => document.getElementById(id);
  const { esc, bar, percentOf, sexColor, sexGlyph, chemToken, chemColor, VISION_BY_KEY, SCENT_BY_KEY } = Evo.uiHelpers;
  const chemBar = (c, key) => bar(T.CHEM_WORDS[key], c.chem.get(key), chemColor(key));

  // Chemical groups for the Body deck
  const FEELINGS = ['reward', 'punishment', 'endorphin', 'adrenaline'];
  const NUTRIENTS = ['glucose', 'glycogen', 'fat', 'protein', 'water', 'gutSugar', 'gutStarch', 'gutProtein', 'gutFat', 'toxin'];
  const HORMONES = ['insulin', 'glucagon', 'melatonin', 'adenosine', 'growthHormone', 'sexHormone', 'liverEnzyme', 'ageing'];
  // Drives drawn in the history chart
  const HISTORY = ['hunger', 'thirst', 'tiredness', 'sleepiness', 'loneliness', 'boredom', 'coldness', 'fear', 'reward', 'punishment'];
  const HISTORY_LEN = 240, HISTORY_EVERY = 30; // Two minutes of simulated time at 1×
  const ERROR_FADE = 0.99;   // Per tick: how quickly a shown prediction error fades (about a second)
  const RECENT = 30;         // Ticks within which a connection counts as just used

  const FEATURE_WORD = Object.fromEntries(Evo.VISION_FEATURES.map(f => [f.key, f.word]));
  const SIDE_WORD = { L: 'left', R: 'right' };

  class Inspector {
    constructor(app) {
      this.app = app;
      this.deck = 'body';
      this.brainView = new Evo.BrainView($('brainCanvas'));
      this.scope = new Evo.VoltageScope($('scopeCanvas'));
      this.genesFor = null;
      this.history = null;
      this.population = [];
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
      this.update(true);
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
      if (tick % 600 === 0) {
        this.population.push(world.creatures.length);
        if (this.population.length > 400) this.population.shift();
      }
    }

    // Prediction errors are single-tick blips: keep each channel's latest big one, fading. And which
    // muscle is winning: the busiest cell of the Movement region, held until another takes over.
    sampleMind(b, tick) {
      const m = this.mind;
      for (let ch = 0; ch < 2; ch++) {
        const d = b.delta[ch], faded = m.error[ch] * ERROR_FADE;
        m.error[ch] = Math.abs(d) > Math.abs(faded) ? d : faded;
      }
      const g = b.dynamics.find(x => x.lobe === 'motor');
      let best = -1, most = g ? 0.5 : 0.02;
      if (g) { for (let k = 0; k < g.cells.length; k++) if (g.activity[k] > most) { most = g.activity[k]; best = g.cells[k]; } }
      else for (const i of b.lobes.motor) if (b.rate[i] > most) { most = b.rate[i]; best = i; }
      if (best >= 0) {
        m.idle = 0;
        if (best !== m.winner) { m.winner = best; m.since = tick; }
      } else if (++m.idle > 60) m.winner = -1;
      m.tick = tick;
    }

    update(force = false) {
      const c = this.app.focus;
      const has = !!c;
      document.querySelectorAll('.needs-creature').forEach(el => el.classList.toggle('hidden', !has));
      document.querySelectorAll('.no-creature').forEach(el => el.classList.toggle('hidden', has));
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
      this.scope.push(b.vShow[i]);
      this.scope.render(b.thr[i]);
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
      const t = T, st = Evo.STAGES[c.stage];
      const bits = [`<b>${c.sex === 'FEMALE' ? 'Female' : 'Male'}</b>`, st.word.toLowerCase(), `${t.clock(c.ageTicks)} old (lives about ${t.clock(c.lifespan)})`, `generation ${c.generation}`, `${c.meals} ${c.meals === 1 ? 'meal' : 'meals'}`];
      let status = c.dead ? 'Dead.' : c.asleep ? 'Asleep.' : `${t.ACTION_WORDS[c.action] || c.action}, feeling ${c.mood}.`;
      if (c.pregnancy) status += ` Carrying an egg (${percentOf(c.pregnancy.progress)}% formed).`;
      if (c.carrying) status += ` Holding ${Evo.ITEM_TYPES[c.carrying.type].word}.`;
      $('lifeLine').innerHTML = `${bits.join(', ')}. ${esc(status)}`;

      const temp = c.bodyTemp;
      const tempColor = temp < 0.35 ? 'var(--water)' : temp > 0.65 ? 'var(--fruit)' : 'var(--accent)';
      $('barsVitals').innerHTML =
        bar('Health', c.health, 'var(--protein)') +
        bar('Injury', c.injury, 'var(--injury)') +
        bar('Body heat', temp, tempColor, temp < 0.3 ? 'cold' : temp > 0.7 ? 'hot' : 'fine') +
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
      $('historyLegend').innerHTML = HISTORY.map(k => `<span><i style="background:${chemColor(k)}"></i>${T.CHEM_WORDS[k]}</span>`).join('');
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
          : att ? `<b>${esc(FEATURE_WORD[att.feature])}</b> on the ${SIDE_WORD[att.side]}${att.band === 'high' ? ', up high' : ''}`
            : '<span class="muted">nothing in particular</span>');

      // Decision
      const w = m.winner;
      const doing = w >= 0 ? `<b>${esc(T.MOTOR_WORDS[b.neurons[w].meta.key] || T.neuronName(b, b.neurons[w]))}</b>, for ${T.seconds(tick - m.since)}` : '<span class="muted">nothing yet</span>';
      row('Decided to', `${doing} <span class="muted">· body: ${esc((T.ACTION_WORDS[c.action] || c.action).toLowerCase())}</span>`);

      // Prediction errors: how things turned out against what it expected
      const surprise = (ch, label, good, bad) => {
        const e = m.error[ch], v = clamp(e, -1, 1), width = Math.abs(v) * 50;
        const color = (ch === 0) === (e >= 0) ? 'var(--joy)' : 'var(--stress)';
        const style = v >= 0 ? `left:50%;width:${width}%;background:${color}` : `left:${50 - width}%;width:${width}%;background:${color}`;
        const verdict = e > 0.1 ? good : e < -0.1 ? bad : 'as expected';
        const expects = T.level(b.value[ch], 0, 1.6, ['expects nothing much', 'expects a little', 'expects some', 'expects a lot']);
        rows.push(`<div class="mind-row"><span class="mind-k">${label}</span><span class="mind-v mind-meter"><span class="centered-track" title="Prediction error ${T.signed(e)}"><span style="${style}"></span></span>` +
          `<span>${verdict} <span class="muted">· ${expects}</span></span></span></div>`);
      };
      surprise(0, 'Reward', 'better than expected', 'less than expected');
      surprise(1, 'Punishment', 'worse than expected', 'not as bad as feared');

      // Working memory: thinking cells that keep going
      const cortex = b.lobes.cortex || [];
      let on = 0, left = 0;
      for (const i of cortex) if (b.rate[i] > 0.04) { on++; if (b.neurons[i].pos[0] < 0.5) left++; }
      const side = on < 2 ? '' : left > on * 0.65 ? ', mostly the left side' : left < on * 0.35 ? ', mostly the right side' : ', both sides';
      row('Thinking', on ? `${on} of ${cortex.length} cells busy${side}` : '<span class="muted">quiet</span>');

      // Sleep and dreams
      let sleep;
      if (!c.asleep) sleep = `awake <span class="muted">· ${b.episodes.length} surprising ${b.episodes.length === 1 ? 'moment' : 'moments'} saved to dream about</span>`;
      else if (!b.dream) sleep = 'asleep, not dreaming';
      else if (b.dream.instinct) {
        const inst = b.dream.instinct, text = Evo.GENES[Evo.GENE_INDEX.Instinct].describe(inst, inst, T.geneWords(b)).text.replace(/^Dreams: /, '');
        sleep = `<b>dreaming</b> an instinct: ${esc(text)}`;
      } else {
        const ep = b.dream.episode, cue = ep.inputs.length ? T.neuronName(b, b.neurons[ep.inputs[0]]).toLowerCase() : 'nothing much';
        const act = ep.motor >= 0 ? `, ${T.MOTOR_WORDS[b.neurons[ep.motor].meta.key].toLowerCase()}` : '';
        sleep = `<b>reliving</b> a ${ep.value > 0 ? 'good' : 'bad'} moment: ${esc(cue)}${esc(act)}`;
      }
      row('Sleep', sleep, c.asleep && b.dream ? ' dreaming' : '');

      // The last thing that happened to it
      const ls = c.lastStimulus;
      row('Last event', ls ? `${esc(T.STIMULUS_PAST[ls.key] || ls.key)} <span class="muted">· ${T.seconds(c.ageTicks - ls.tick)} ago</span>` : '<span class="muted">nothing yet</span>');
      if (b.seizures || b.brake) row('Seizures', `${b.brake ? '<b>brake on now</b> · ' : ''}the brake has come on ${b.seizures} ${b.seizures === 1 ? 'time' : 'times'}`, ' alert');
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
      for (const i of cells) { if (b.rate[i] > 0.04) busy++; if (b.hist[i] & 0xF) firing++; }
      $('regionName').textContent = T.regionName(b, lobe);
      $('regionSize').textContent = `${cells.length} cells`;
      $('regionAbout').textContent = T.regionAbout(b, lobe);
      const dyn = b.dynamics.find(d => d.lobe === lobe);
      const facts = [`<span><b>${busy}</b> busy</span>`, `<span><b>${firing}</b> firing now</span>`];
      if (dyn) {
        facts.push(`<span>Cells compete <b>${T.level(dyn.competition, 0, 8, ['weakly', 'moderately', 'strongly'])}</b></span>`,
          `<span>and keep firing <b>${T.level(dyn.persistence, 0, 4, ['briefly', 'for a while', 'for long'])}</b></span>`);
      }
      $('regionFacts').innerHTML = facts.join('');
    }

    renderNeuron(b, i) {
      const n = b.neurons[i], now = b.tickCount;
      $('neuronName').textContent = T.neuronName(b, n);
      $('neuronLobe').textContent = T.lobeName(n, b);
      $('neuronRole').textContent = T.neuronRole(b, n);
      const h = b.hist[i], last = h ? 31 - Math.clz32(h & -h) : -1;
      const ins = [], outs = [];
      for (let s = 0; s < b.S; s++) {
        if (b.sSrc[s] === i) outs.push(s);
        else if (b.sDst[s] === i) ins.push(s);
      }
      $('neuronFacts').innerHTML = [
        `<span>Fires <b>${Math.round(b.rate[i] * 100)}%</b> of the time</span>`,
        `<span>Last fired <b>${last < 0 ? 'over half a second ago' : last === 0 ? 'just now' : `${last} ticks ago`}</b></span>`,
        `<span>Charge <b>${b.vShow[i] > 0 ? 'firing' : `${Math.max(0, Math.round(b.thr[i] - b.vShow[i]))} mV below firing`}</b></span>`,
        `<span><b>${ins.length}</b> in, <b>${outs.length}</b> out</span>`
      ].join('');
      const list = (title, syns, otherEnd) => {
        if (!syns.length) return '';
        syns.sort((x, y) => Math.abs(b.sW[y]) - Math.abs(b.sW[x]));
        const rows = syns.slice(0, 8).map(s => {
          const w = b.sW[s], width = Math.sqrt(Math.min(1, Math.abs(w) / Evo.BRAIN.WEIGHT_MAX)) * 100, other = otherEnd(s); // Most are weak: a square root spreads them out
          const name = T.neuronName(b, b.neurons[other]);
          const grown = b.sFlags[s] & Evo.BRAIN.SPROUTED ? '<i class="grown" title="grown in life"></i>' : '';
          const active = now - b.sActive[s] < RECENT ? ' active' : '';
          return `<button class="link${active}" data-neuron="${other}" title="${esc(name)}"><span class="who">${grown}${esc(name)}</span>` +
            `<span class="strength"><span style="left:0;width:${width}%;background:${w >= 0 ? 'var(--water)' : 'var(--stress)'}"></span></span><span class="delay">${b.sDelay[s]}t</span></button>`;
        }).join('');
        const more = syns.length > 8 ? `<p class="note">and ${syns.length - 8} weaker</p>` : '';
        return `<div class="link-list"><h4>${title}</h4>${rows}${more}</div>`;
      };
      const predicts = b.modulator[i] >= 0;
      const html = list(predicts ? 'Predicts from' : 'Listens to', ins, s => b.sSrc[s]) + list('Sends to', outs, s => b.sDst[s]);
      $('neuronLinks').innerHTML = html
        ? `<p class="note">Strongest first; tap one to go there. Blue excites, rose holds back; a green dot marks a connection grown in life, a glow one just used. Last column: travel time in ticks.</p>${html}`
        : '<p class="empty">No connections yet.</p>';
    }

    stimulate() {
      const c = this.app.focus, i = this.brainView.probed;
      if (!c || i < 0) return;
      for (let k = 1; k <= 6; k += 2) c.brain.inject(i, 40, k);
    }

    // What each sight and smell has come to predict, from the cue synapses onto the reward and
    // punishment cells (they start equal, so any difference was learned)
    renderLearned(c) {
      const b = c.brain, rows = new Map();
      for (let s = 0; s < b.S; s++) {
        if (!(b.sFlags[s] & Evo.BRAIN.CUE)) continue;
        const src = b.neurons[b.sSrc[s]], m = src.meta;
        const key = m.kind === 'sight' ? `Seeing ${VISION_BY_KEY[m.feature].word}` : `Smelling ${SCENT_BY_KEY[m.odour].word}`;
        const row = rows.get(key) || { good: 0, bad: 0, n: 0 };
        if (b.modulator[b.sDst[s]] === 0) row.good += b.sW[s]; else row.bad += b.sW[s];
        row.n++;
        rows.set(key, row);
      }
      const list = [...rows.entries()].map(([k, r]) => [k, (r.good - r.bad) / Math.max(1, r.n / 2)]).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])).slice(0, 10);
      $('learnedList').innerHTML = list.length ? list.map(([label, net]) => {
        const v = clamp(net * 2, -1, 1), width = Math.abs(v) * 50;
        const style = v >= 0 ? `left:50%;width:${width}%;background:var(--joy)` : `left:${50 - width}%;width:${width}%;background:var(--stress)`;
        const verdict = net > 0.05 ? 'good news' : net < -0.05 ? 'trouble' : 'no meaning yet';
        return `<div class="learn-row"><span>${esc(label)}</span><div class="centered-track"><span style="${style}"></span></div><span class="verdict">${verdict}</span></div>`;
      }).join('') : '<p class="empty">No senses are wired to its feelings.</p>';
    }

    renderMuscles(c) {
      const b = c.brain, w = this.mind ? this.mind.winner : -1;
      $('barsMuscles').innerHTML = Evo.MOTORS.map((m, k) => {
        const i = b.lobes.motor[k];
        return bar(i === w ? `${m.word} ◂` : m.word, Math.min(1, b.rate[i] * 8), i === w ? 'var(--energy)' : b.hist[i] & 1 ? 'var(--pulse)' : 'var(--accent)', `${Math.round(b.rate[i] * 100)}%`);
      }).join('');
    }

    // ---------- Genes ----------
    renderGenes(c) {
      this.genesFor = c;
      this.genesStage = c.stage;
      const g = c.genome, genes = g.findGenes(), t = T, tr = c.traits;
      $('genesSummary').textContent = `${genes.length} genes in ${g.dna.length} bytes of DNA. ${g.sexChrom === 'Y' ? 'Male (XY)' : 'Female (XX)'}. ${g.mutationCount} mutations in its family line.`;
      const traits = [
        ['Adult size', `${Math.round(tr.adultSize)} px`], ['Walking speed', tr.walkSpeed.toFixed(2)], ['Jump', tr.jumpPower.toFixed(1)],
        ['Sight', `${Math.round(tr.visionRange)} px`], ['Night sight', `${Math.round(tr.nightVision * 100)}%`], ['Nose', `${Math.round(tr.noseReach)} px`],
        ['Lifespan', t.clock(tr.lifespanTicks)], ['Egg takes', t.clock(tr.gestationTicks)], ['Hatches in', t.clock(tr.incubationTicks)],
        ['Fur', `${Math.round(tr.insulation * 100)}%`], ['Learning', tr.learningRate.toFixed(3)], ['Voice', tr.voicePitch > 0.5 ? 'high' : 'low']
      ];
      $('traitList').innerHTML = traits.map(([k, v]) => `<div class="trait"><span>${k}</span><b>${esc(v)}</b></div>`).join('');
      const groups = { body: [], brain: [], chemistry: [], instinct: [] };
      for (const gene of genes) {
        const d = t.describeGene(g, gene, c.brain);
        const later = gene.stage > Math.max(1, c.stage);
        const when = gene.stage > 1 ? `<span class="stage-tag${later ? ' later' : ''}">${later ? 'from' : 'since'} ${Evo.STAGES[gene.stage].word.toLowerCase()}</span>` : '';
        groups[d.group].push(`<div class="gene${later ? ' dormant' : ''}"><span class="gene-name">${esc(d.name)}</span><span class="gene-text">${esc(d.text)}</span>${when}</div>`);
      }
      for (const k in groups) {
        $(`genes-${k}`).innerHTML = groups[k].join('') || '<p class="empty">None.</p>';
        $(`genes-${k}-count`).textContent = groups[k].length;
      }
      this.renderDNA(g, genes);
    }

    renderDNA(g, genes) {
      const at = new Int32Array(g.dna.length).fill(-1);
      genes.forEach((x, gi) => { for (let k = x.start; k < x.end; k++) at[k] = gi; });
      const palette = ['var(--water)', 'var(--grain)', 'var(--protein)', 'var(--female)', 'var(--toxin)'];
      let html = '';
      for (let i = 0; i < g.dna.length; i += 16) {
        const cells = [];
        for (let k = i; k < Math.min(i + 16, g.dna.length); k++) {
          const hex = g.dna[k].toString(16).padStart(2, '0').toUpperCase(), gi = at[k];
          if (gi < 0) cells.push(`<span class="junk">${hex}</span>`);
          else if (k === genes[gi].start) cells.push(`<span class="prom">${hex}</span>`);
          else cells.push(`<span style="color:${palette[gi % palette.length]}">${hex}</span>`);
        }
        html += `<div class="dna-row"><span class="addr">${i.toString(16).padStart(3, '0')}</span><span>${cells.join(' ')}</span></div>`;
      }
      $('dnaGrid').innerHTML = html;
    }

    // ---------- Family ----------
    renderFamily(c) {
      const world = this.app.world, hist = world.history;
      const rec = id => hist.find(h => h.id === id);
      const person = h => {
        if (!h) return '<span class="muted">unknown</span>';
        const alive = world.creatureById(h.id);
        const fate = alive ? (alive === c ? 'this one' : 'alive') : h.died !== null ? T.DEATH_WORDS[h.cause] || 'died' : 'gone';
        return `<button class="member" ${alive ? `data-creature="${h.id}"` : 'disabled'}><span class="sex-glyph" style="color:${sexColor(h.sex)}">${sexGlyph(h.sex)}</span>` +
          `<span>${esc(h.name)} <span class="meta">gen ${h.generation}</span></span><span class="meta">${esc(fate)}</span></button>`;
      };
      const mother = rec(c.motherId), father = rec(c.fatherId);
      $('familyParents').innerHTML = c.motherId === null
        ? `<p class="note">${c.generation > 1 ? 'It wandered in from outside: its parents never lived here.' : 'A founder: it came into the world grown, with no parents here.'}</p>`
        : person(mother) + person(father);
      const siblings = c.motherId === null ? [] : hist.filter(h => h.id !== c.id && h.motherId === c.motherId && h.fatherId === c.fatherId);
      $('familySiblings').innerHTML = siblings.map(person).join('') || '<p class="note">None.</p>';
      const children = hist.filter(h => h.motherId === c.id || h.fatherId === c.id);
      $('familyChildren').innerHTML = children.map(person).join('') || `<p class="note">None yet.${c.pregnancy ? ' One is on the way.' : ''}</p>`;
      const grand = children.flatMap(ch => hist.filter(h => h.motherId === ch.id || h.fatherId === ch.id));
      $('familyLine').textContent = `Generation ${c.generation}. ${children.length} ${children.length === 1 ? 'child' : 'children'}, ${grand.length} ${grand.length === 1 ? 'grandchild' : 'grandchildren'}. Mated ${c.timesMated} ${c.timesMated === 1 ? 'time' : 'times'}.`;
    }

    // ---------- World ----------
    renderWorld() {
      const world = this.app.world, st = world.stats, t = T, clock = world.clock;
      const deaths = Object.values(st.deaths).reduce((a, v) => a + v, 0);
      const temp = world.temperatureAt(world.width / 2, world.terrain.groundY(world.width / 2) - 20);
      $('worldLine').textContent = `Day ${clock.day + 1}, ${t.timeOfDay(clock.phase)}. ${world.seasonInfo.word}, ${temp < 0.3 ? 'cold' : temp > 0.62 ? 'hot' : temp < 0.42 ? 'cool' : 'mild'}. ${world.foodCount} bits of food about.`;
      const tile = (v, label) => `<div class="tile"><b>${v}</b><span>${label}</span></div>`;
      $('worldTiles').innerHTML = tile(world.creatures.length, 'living') + tile(st.hatched, 'hatched') + tile(st.eggsLaid, 'eggs laid') + tile(st.matings, 'matings') +
        tile(st.meals, 'meals') + tile(st.poisonings, 'poisonings') + tile(st.wanderers, 'wanderers') + tile(deaths, 'deaths');
      const causes = Object.entries(st.deaths).filter(([, v]) => v).map(([k, v]) => `${v} ${t.DEATH_WORDS[k] || k}`);
      $('deathBreakdown').textContent = (causes.length ? `Of the dead: ${causes.join(', ')}.` : 'No deaths yet.') + (st.refoundings ? ` Re-founded ${st.refoundings} times from proven breeders.` : '');
      const list = [...world.creatures].sort((a, b) => b.generation - a.generation || b.ageTicks - a.ageTicks);
      $('roster').innerHTML = list.map(c => {
        const need = c.topDrives(1)[0];
        return `<button class="member" data-creature="${c.id}" aria-current="${c === this.app.focus}">` +
          `<span class="sex-glyph" style="color:${sexColor(c.sex)}">${sexGlyph(c.sex)}</span>` +
          `<span>${esc(c.name)}<br><span class="meta">${Evo.STAGES[c.stage].word}, gen ${c.generation}, ${esc(t.ACTION_WORDS[c.action] || c.action).toLowerCase()}</span></span>` +
          `<span class="meta">${need && need[1] > 0.2 ? esc(T.CHEM_WORDS[need[0]].toLowerCase()) : ''}</span></button>`;
      }).join('') || '<p class="empty">Nobody lives here now.</p>';
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
