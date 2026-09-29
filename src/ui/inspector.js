// The inside view: what is going on inside the followed creature (body chemistry, brain, genes,
// family) and in the world as a whole. Each deck renders from the simulation on demand; the app
// calls update() a few times a second for the visible deck, and every frame for the brain map.
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

  class Inspector {
    constructor(app) {
      this.app = app;
      this.deck = 'body';
      this.brainView = new Evo.BrainView($('brainCanvas'));
      this.scope = new Evo.VoltageScope($('scopeCanvas'));
      this.genesFor = null;
      this.history = null;
      this.population = [];
      this.chart = $('historyCanvas');
      this.chartCtx = this.chart.getContext('2d');
      this.popChart = $('popCanvas');
      this.popCtx = this.popChart.getContext('2d');

      $('brainCanvas').addEventListener('pointerdown', e => {
        const r = e.currentTarget.getBoundingClientRect();
        this.brainView.probeAt(e.clientX - r.left, e.clientY - r.top);
        this.renderNeuron();
      });
      $('stimulateBtn').addEventListener('click', () => this.stimulate());
      $('clearNeuronBtn').addEventListener('click', () => { this.brainView.probed = -1; this.renderNeuron(); });
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
      this.update(true);
    }

    // Every tick: sample the drive history and the population
    sample(world) {
      const c = this.app.focus;
      if (c && this.history && world.clock.tick % HISTORY_EVERY === 0) {
        const h = this.history, k = h.n % HISTORY_LEN;
        HISTORY.forEach((key, i) => { h.data[i][k] = c.chem.get(key); });
        h.n++;
      }
      if (world.clock.tick % 600 === 0) {
        this.population.push(world.creatures.length);
        if (this.population.length > 400) this.population.shift();
      }
    }

    update(force = false) {
      const c = this.app.focus;
      const has = !!c;
      document.querySelectorAll('.needs-creature').forEach(el => el.classList.toggle('hidden', !has));
      document.querySelectorAll('.no-creature').forEach(el => el.classList.toggle('hidden', has));
      if (this.deck === 'world') return this.renderWorld();
      if (!c) return;
      if (this.deck === 'body') this.renderBody(c);
      else if (this.deck === 'brain') { this.renderLearned(c); this.renderMuscles(c); this.renderNeuron(); this.renderBrainCounts(c); }
      else if (this.deck === 'genes') { if (force || this.genesFor !== c || this.genesStage !== c.stage) this.renderGenes(c); }
      else if (this.deck === 'family') this.renderFamily(c);
    }

    // Every frame while the brain deck shows
    frame() {
      const c = this.app.focus;
      if (!c || this.deck !== 'brain') return;
      this.brainView.setBrain(c.brain);
      this.brainView.render();
      const b = c.brain, i = this.brainView.probed;
      if (i >= 0 && i < b.N) this.scope.push(b.vShow[i]);
      else this.scope.push(b.vShow[b.lobes.motor[0]]);
      this.scope.render(i >= 0 && i < b.N ? b.thr[i] : b.thr[b.lobes.motor[0]]);
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
      $('brainCounts').textContent = `${b.N} neurons, ${b.S} synapses (${b.sproutedCount} grown and ${b.prunedCount} pruned in life)`;
    }

    renderNeuron() {
      const c = this.app.focus, i = this.brainView.probed;
      const b = c && c.brain;
      const show = !!(b && i >= 0 && i < b.N);
      $('neuronEmpty').classList.toggle('hidden', show);
      $('neuronDetail').classList.toggle('hidden', !show);
      if (!show) return;
      const n = b.neurons[i], t = T;
      $('neuronName').textContent = t.neuronName(b, n);
      $('neuronLobe').textContent = t.lobeName(n);
      $('neuronRate').textContent = `${Math.round(b.rate[i] * 100)}%`;
      $('neuronV').textContent = b.vShow[i] > 0 ? 'firing' : `${Math.round(b.vShow[i] - Evo.BRAIN.V_REST)} of ${Math.round(b.thr[i] - Evo.BRAIN.V_REST)} mV`;
      const links = [];
      for (let s = 0; s < b.S; s++) {
        if (b.sSrc[s] === i) links.push({ dir: '→', other: b.sDst[s], s });
        else if (b.sDst[s] === i) links.push({ dir: '←', other: b.sSrc[s], s });
      }
      $('neuronLinkCount').textContent = links.length;
      links.sort((x, y) => Math.abs(b.sW[y.s]) - Math.abs(b.sW[x.s]));
      $('neuronLinks').innerHTML = links.length
        ? '<p class="note">Strongest first. Blue excites, rose holds back; a green dot marks a connection grown in life. Last column: travel time.</p>' +
          links.slice(0, 40).map(({ dir, other, s }) => {
            const w = b.sW[s], width = Math.min(1, Math.abs(w) / Evo.BRAIN.WEIGHT_MAX) * 100;
            const name = t.neuronName(b, b.neurons[other]);
            const grown = b.sFlags[s] & Evo.BRAIN.SPROUTED ? '<i class="grown" title="grown in life"></i>' : '';
            return `<div class="link"><span class="dir">${dir}</span><span class="who" title="${esc(name)}">${grown}${esc(name)}</span>` +
              `<div class="strength"><span style="left:0;width:${width}%;background:${w >= 0 ? 'var(--water)' : 'var(--stress)'}"></span></div><span class="delay">${b.sDelay[s]}t</span></div>`;
          }).join('')
        : '<p class="empty">No connections yet.</p>';
      $('scopeTitle').textContent = `Charge: ${t.neuronName(b, n).toLowerCase()}`;
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
      const b = c.brain;
      $('barsMuscles').innerHTML = Evo.MOTORS.map((m, k) => {
        const i = b.lobes.motor[k];
        return bar(m.word, Math.min(1, b.rate[i] * 8), b.hist[i] & 1 ? 'var(--pulse)' : 'var(--accent)', `${Math.round(b.rate[i] * 100)}%`);
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
      $('familyParents').innerHTML = c.motherId === null ? '<p class="note">A founder: it came into the world grown, with no parents here.</p>' : person(mother) + person(father);
      const siblings = c.motherId === null ? [] : hist.filter(h => h.id !== c.id && h.motherId === c.motherId && h.fatherId === c.fatherId);
      $('familySiblings').innerHTML = siblings.map(person).join('') || '<p class="note">None.</p>';
      const children = hist.filter(h => h.motherId === c.id || h.fatherId === c.id);
      $('familyChildren').innerHTML = children.map(person).join('') || `<p class="note">None yet.${c.pregnancy ? ' One is on the way.' : ''}</p>`;
      const grand = children.flatMap(ch => hist.filter(h => h.motherId === ch.id || h.fatherId === ch.id));
      $('familyLine').textContent = `Generation ${c.generation}. ${children.length} ${children.length === 1 ? 'child' : 'children'}, ${grand.length} grandchildren. Mated ${c.timesMated} ${c.timesMated === 1 ? 'time' : 'times'}.`;
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
