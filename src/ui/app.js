// The interface: builds the world, views and panels, and runs the main loop.
(function (Evo) {
  'use strict';
  const { clamp, minBy } = Evo.util;
  const { text, RAYS, SMELL_CHANNELS, SENSE_CHANNELS } = Evo;
  const { clock, pct } = text;
  const $ = id => document.getElementById(id);

  function bootApp() {
    const terrariumCanvas = $('terrariumCanvas');
    const brainCanvas = $('brainCanvas');
    const scopeCanvas = $('scopeCanvas');
    const world = new Evo.TerrariumWorld();
    const view = new Evo.TerrariumView(world, terrariumCanvas);
    const brainVis = new Evo.BrainVisualizer(brainCanvas, () => world.focusedOrganism && world.focusedOrganism.brain);
    const scope = new Evo.VoltageScope(scopeCanvas);
    const synth = new Evo.BioSynthesizer();
    Evo.connectAudio(synth, world, org => org === world.focusedOrganism);

    let simSpeed = 1, isPaused = false, currentTool = 'carb', activeDeck = 'brain';
    let genesDirty = true; // Genes change only when the followed creature or its genome changes

    const resizeAll = () => { view.resize(); brainVis.resize(); scope.resize(); };
    const cssPixels = name => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));

    // A short message over the map (e.g. why a button did nothing)
    let toastTimer = 0;
    const toast = message => {
      const el = $('toast');
      el.textContent = message;
      el.classList.remove('hidden');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
    };

    // ---------- Adaptive layout: from the live viewport size, re-evaluated whenever it changes ----------
    const bodyEl = document.body, labPanel = $('labPanel'), labOpenBtn = $('labOpenBtn'), sheetHandle = $('sheetHandle');
    let currentLayout = null;
    const viewportSize = () => {
      const vv = window.visualViewport;
      return { w: vv ? vv.width : window.innerWidth, h: vv ? vv.height : window.innerHeight };
    };
    const pickLayout = ({ w, h }) => {
      if (w >= 1100 && h >= 600) return 'desktop'; // Dock the inside view beside the map
      if (w >= 700 || w > h) return 'drawer';     // Tablets and landscape phones: slide-over drawer
      return 'sheet';                              // Portrait phones: bottom sheet
    };
    const setCardCollapsed = collapsed => {
      $('creatureCard').classList.toggle('collapsed', collapsed);
      $('cardToggle').setAttribute('aria-expanded', String(!collapsed));
    };
    const labVisible = () => bodyEl.classList.contains('lab-open');
    function setLabState(open, stop) {
      bodyEl.classList.toggle('lab-open', open);
      if (bodyEl.dataset.layout === 'sheet' && open) bodyEl.dataset.sheet = stop || 'half';
      else delete bodyEl.dataset.sheet;
      labPanel.style.height = '';
      labOpenBtn.setAttribute('aria-expanded', String(open));
    }
    // The panel animates; size the canvases once it has settled
    labPanel.addEventListener('transitionend', e => { if (e.target === labPanel) resizeAll(); });
    function applyLayout() {
      const size = viewportSize();
      bodyEl.classList.toggle('compact', size.w < 520);
      const layout = pickLayout(size);
      if (layout !== currentLayout) {
        currentLayout = layout;
        bodyEl.dataset.layout = layout;
        setLabState(layout === 'desktop');
        setCardCollapsed(layout === 'sheet' || size.h < 520);
      }
      resizeAll();
    }
    labOpenBtn.addEventListener('click', () => setLabState(true));
    $('labCloseBtn').addEventListener('click', () => setLabState(false));
    $('cardToggle').addEventListener('click', () => setCardCollapsed(!$('creatureCard').classList.contains('collapsed')));

    // Bottom sheet: tap the handle to step through stops, or drag and it snaps to the nearest
    (() => {
      let startY = 0, startH = 0, dragging = false, moved = false;
      const stops = () => {
        const stageH = $('stage').getBoundingClientRect().height;
        return { closed: cssPixels('--peek'), half: stageH * 0.55, full: stageH * 0.92 };
      };
      const cycle = () => {
        const cur = bodyEl.dataset.sheet;
        if (!cur) setLabState(true, 'half');
        else if (cur === 'half') setLabState(true, 'full');
        else setLabState(false);
      };
      sheetHandle.addEventListener('pointerdown', e => {
        if (currentLayout !== 'sheet') return;
        dragging = true; moved = false; startY = e.clientY; startH = labPanel.getBoundingClientRect().height;
        labPanel.classList.add('dragging'); sheetHandle.setPointerCapture(e.pointerId);
      });
      sheetHandle.addEventListener('pointermove', e => {
        if (!dragging) return;
        const dy = e.clientY - startY;
        if (Math.abs(dy) > 6) moved = true;
        const st = stops();
        labPanel.style.height = clamp(startH - dy, st.closed, st.full) + 'px';
      });
      const end = () => {
        if (!dragging) return;
        dragging = false; labPanel.classList.remove('dragging');
        if (!moved) return cycle();
        const hNow = labPanel.getBoundingClientRect().height;
        const [nearest] = minBy(Object.entries(stops()), ([, h]) => Math.abs(h - hNow));
        if (nearest === 'closed') setLabState(false); else setLabState(true, nearest);
      };
      sheetHandle.addEventListener('pointerup', end);
      sheetHandle.addEventListener('pointercancel', end);
      sheetHandle.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cycle(); } });
    })();

    window.addEventListener('resize', applyLayout);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', applyLayout);
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => resizeAll());
      [terrariumCanvas, brainCanvas, scopeCanvas].forEach(el => ro.observe(el));
    }
    applyLayout();

    // ---------- Tabs ----------
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        if (currentLayout === 'sheet' && !labVisible()) setLabState(true, 'half');
        activeDeck = tab.dataset.deck;
        document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t === tab)));
        document.querySelectorAll('.deck').forEach(d => d.classList.toggle('hidden', d.id !== `deck-${activeDeck}`));
        requestAnimationFrame(() => { resizeAll(); renderActiveDeck(); });
      });
    });

    // ---------- Playback, tools, buttons ----------
    const speedBtns = document.querySelectorAll('[data-speed]');
    const syncPause = () => {
      const p = $('pauseBtn');
      p.textContent = isPaused ? '▶' : '⏸';
      p.setAttribute('aria-label', isPaused ? 'Resume' : 'Pause');
      p.setAttribute('aria-pressed', String(isPaused));
    };
    const setSpeed = s => {
      simSpeed = s;
      isPaused = false;
      speedBtns.forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.speed === s)));
      syncPause();
    };
    speedBtns.forEach(b => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));
    $('pauseBtn').addEventListener('click', () => { isPaused = !isPaused; syncPause(); });
    $('scentBtn').addEventListener('click', () => {
      view.showScent = !view.showScent;
      $('scentBtn').setAttribute('aria-pressed', String(view.showScent));
    });
    window.addEventListener('pointerdown', () => synth.init(), { once: true });
    $('soundBtn').addEventListener('click', () => {
      synth.init();
      synth.enabled = !synth.enabled;
      $('soundBtn').textContent = synth.enabled ? '🔊' : '🔇';
      $('soundBtn').setAttribute('aria-label', synth.enabled ? 'Turn sound off' : 'Turn sound on');
    });

    const toolBtns = document.querySelectorAll('[data-tool]');
    toolBtns.forEach(b => b.addEventListener('click', () => {
      currentTool = b.dataset.tool;
      toolBtns.forEach(t => t.setAttribute('aria-pressed', String(t === b)));
    }));

    const addAdult = sex => { if (!world.addAdult(sex)) toast('The terrarium is full.'); };
    $('addFemaleBtn').addEventListener('click', () => addAdult('FEMALE'));
    $('addMaleBtn').addEventListener('click', () => addAdult('MALE'));
    $('seasonBtn').addEventListener('click', () => world.nextSeason());
    $('clearFoodBtn').addEventListener('click', () => world.clearFood());
    world.events.on('season', refreshStatus);

    // Tap a creature to follow it; tap empty ground to drop the selected item
    terrariumCanvas.addEventListener('pointerdown', e => {
      const rect = terrariumCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      const hit = view.organismAt(x, y, e.pointerType === 'touch' ? 20 : 12);
      if (hit) world.focusedOrganism = hit;
      else world.spawnItem(currentTool, x, y);
    });

    // ---------- Brain: probing a neuron ----------
    brainCanvas.addEventListener('pointerdown', e => {
      const rect = brainCanvas.getBoundingClientRect();
      const neuron = brainVis.probeAt(e.clientX - rect.left, e.clientY - rect.top);
      if (neuron) synth.playTone(560, 0.03, 'sine', 0.03);
      renderNeuronCard();
    });
    $('pulseBtn').addEventListener('click', () => {
      if (!brainVis.probedNeuron) return;
      brainVis.probedNeuron.injectCurrent(22.0);
      synth.playTone(880, 0.04, 'sawtooth', 0.04);
    });
    $('clearNeuronBtn').addEventListener('click', () => { brainVis.probedNeuron = null; renderNeuronCard(); });

    function renderNeuronCard() {
      const n = brainVis.probedNeuron;
      const foc = world.focusedOrganism;
      $('neuronEmpty').classList.toggle('hidden', !!n);
      $('neuronDetail').classList.toggle('hidden', !n);
      if (!n) return;
      const incoming = foc.brain.synapses.filter(s => s.target === n);
      const outgoing = n.outgoingSynapses;
      $('neuronName').textContent = text.neuronName(n);
      const ln = text.lobeName(n);
      $('neuronLobe').textContent = /lobe/i.test(ln) ? ln : `${ln} lobe`;
      $('neuronLinkCount').textContent = incoming.length + outgoing.length;
      const links = [
        ...outgoing.map(s => ({ dir: '→', other: s.target, s })),
        ...incoming.map(s => ({ dir: '←', other: s.source, s }))
      ].sort((a, b) => Math.abs(b.s.weight) - Math.abs(a.s.weight)).slice(0, 40);
      $('neuronLinks').innerHTML = links.length
        ? `<p class="note">Strongest first. Arrow shows direction; rose bars hold the other neuron back. Last column is travel time.</p>` +
          links.map(({ dir, other, s }) => {
            const w = Math.min(1, Math.abs(s.weight) / Evo.BRAIN.WEIGHT_MAX) * 100;
            const col = s.weight >= 0 ? 'var(--accent)' : 'var(--stress)';
            const name = text.neuronName(other);
            return `<div class="link"><span class="dir">${dir}</span><span class="who" title="${name}">${name}</span>` +
              `<div class="strength"><span style="left:0;width:${w}%;background:${col}"></span></div><span class="delay">${s.delay}t</span></div>`;
          }).join('')
        : `<p class="empty">This neuron has no connections yet.</p>`;
      refreshNeuronLive();
    }
    function refreshNeuronLive() {
      const n = brainVis.probedNeuron;
      if (!n) return;
      $('neuronRate').textContent = `${Math.round(n.runningFiringRate * 100)}%`;
      $('neuronV').textContent = n.displayVoltage >= 0 ? 'pulsing' : `${Math.round(n.displayVoltage - n.vRest)} of ${Math.round(n.vThreshold - n.vRest)}`;
    }

    // ---------- Brain: what it has learned ----------
    const SMELL_LABELS = { carb: 'Smell of fruit', starch: 'Smell of grain', water: 'Smell of water', toxic: 'Smell of poison', pheromone: 'Scent of a mate', alarm: 'Alarm scent' };
    function renderLearned() {
      const foc = world.focusedOrganism;
      if (!foc) return;
      $('learnedList').innerHTML = SMELL_CHANNELS.map(ch => {
        const label = SMELL_LABELS[ch] || SENSE_CHANNELS[ch].word;
        const mine = foc.brain.cueSynapses.filter(s => s.source.meta.kind === 'smell' && s.source.meta.channel === ch);
        if (!mine.length) return `<div class="learn-row"><span>${label}</span><div class="centered-track"></div><span class="verdict">not wired</span></div>`;
        const avg = mod => { const l = mine.filter(s => s.target.modulator === mod); return l.length ? l.reduce((a, s) => a + s.weight, 0) / l.length : 0; };
        const net = avg('DA') - avg('ST');
        const v = clamp(net, -1, 1);
        const width = Math.abs(v) * 50;
        const bar = v >= 0 ? `left:50%;width:${width}%;background:var(--joy)` : `left:${50 - width}%;width:${width}%;background:var(--stress)`;
        const verdict = net > 0.15 ? 'good news' : net < -0.15 ? 'trouble' : 'no meaning yet';
        return `<div class="learn-row"><span>${label}</span><div class="centered-track"><span style="${bar}"></span></div><span class="verdict">${verdict}</span></div>`;
      }).join('');
    }

    // ---------- Body ----------
    const bar = (label, value, color, num, hint = '') =>
      `<div class="bar"><span>${label}</span><div class="track"><div class="fill" style="width:${pct(value)}%;background:${color}"></div></div>` +
      `<span class="num">${num}</span>${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
    function renderBody() {
      const foc = world.focusedOrganism;
      if (!foc) return;
      const b = foc.body;
      $('lifeLine').innerHTML = `${foc.sex === 'FEMALE' ? 'Female' : 'Male'}, ${clock(b.ageTicks)} old, lives about ${clock(b.maxLifespanTicks)}. <b>${text.breedingStatus(b)}.</b>`;
      $('barsEnergy').innerHTML =
        bar('Stamina', b.stamina, 'var(--energy)', pct(b.stamina), 'Ready to use. Muscles and pulses spend it.') +
        bar('Sugar', b.carbs, 'var(--fruit)', pct(b.carbs), 'Burned to refill stamina.') +
        bar('Grain in gut', b.starches, 'var(--grain)', pct(b.starches), 'Digests slowly into sugar. Needs water.') +
        bar('Fat store', b.fats, 'var(--fat)', pct(b.fats), 'Long-term reserve for lean times.');
      const proteinHint = (b.growth < 1 ? 'Being built into its growing body.' : 'For eggs, healing and muscle upkeep.') + ' Comes from grubs, bugs, carrion and grain.';
      $('barsBuild').innerHTML =
        bar('Protein', b.protein, 'var(--protein)', pct(b.protein), proteinHint) +
        bar('Water', b.water, 'var(--water)', pct(b.water));
      $('barsHealth').innerHTML =
        bar('Poison', b.sickness, 'var(--toxin)', pct(b.sickness)) +
        bar('Injury', b.injury * 100, 'var(--injury)', pct(b.injury * 100), b.injury > 0 ? 'Heals slowly, using protein.' : '');
      $('barsMood').innerHTML =
        bar('Joy', b.joy * 100, 'var(--joy)', pct(b.joy * 100)) +
        bar('Stress', b.stress * 100, 'var(--stress)', pct(b.stress * 100)) +
        bar('Boredom', b.boredom * 100, 'var(--bored)', pct(b.boredom * 100));
      const urge = (label, v, color) => `<div class="bar"><span>${label}</span><span class="num">${pct(v * 100)}</span><div class="track"><div class="fill" style="width:${pct(v * 100)}%;background:${color}"></div></div></div>`;
      $('barsUrges').innerHTML =
        urge('Hunger', b.energyHungerDrive, 'var(--energy)') + urge('Protein hunger', b.proteinHungerDrive, 'var(--protein)') +
        urge('Thirst', b.thirstDrive, 'var(--water)') + urge('Tiredness', b.fatigueDrive, 'var(--muted)') +
        urge('Mating urge', b.mateDrive, foc.sex === 'FEMALE' ? 'var(--female)' : 'var(--male)') + urge('Crowding', b.crowdStress, 'var(--stress)');
    }

    // ---------- Genes ----------
    function renderGenes() {
      const foc = world.focusedOrganism;
      if (!foc) return;
      genesDirty = false;
      const g = foc.genome, t = foc.traits, genes = g.findGenes();
      $('genesSummary').textContent = `${genes.length} active genes in ${g.dna.length} bytes of DNA. ${g.sexChrom === 'Y' ? 'Male (XY)' : 'Female (XX)'}, ${g.mutationCount} mutations in its family line.`;
      const halfLife = Math.round(Math.log(0.5) / Math.log(t.traceDecay));
      const items = [
        ['Body size', t.radius.toFixed(1)], ['Top speed', `${t.speedMult.toFixed(2)}×`],
        ['Sight range', `${Math.round(t.visionRange)} px`], ['Antennae', `${Math.round(t.antennaLength)} px`],
        ['Learning speed', t.learningRate.toFixed(3)], ['Memory span', `${halfLife} ticks`],
        ['Boredom rate', (t.boredomRate * 1000).toFixed(2)], ['Trail scent', `${Math.round(t.trailFraction * 100)}%`],
        ['Earliest adulthood', `${Math.round(t.maturityAgeSeconds)} s`], ['Lifespan', `${Math.round(t.maxLifespanSeconds)} s`],
        ['Gives offspring', `${Math.round(t.parentalDowryRatio * 100)}%`], ['Brain', `${foc.brain.allNeurons.length} neurons`]
      ];
      $('traitList').innerHTML = items.map(([k, v]) => `<div class="trait"><span>${k}</span><b>${v}</b></div>`).join('');
      const counts = Evo.util.countBy(genes, x => Evo.GENES[x.type].name);
      $('geneList').innerHTML = Object.entries(counts).map(([name, c]) => `<span class="gene-tag">${name}${c > 1 ? ` ×${c}` : ''}</span>`).join('');
      const at = new Array(g.dna.length).fill(-1);
      genes.forEach((x, gi) => { for (let k = x.start; k < x.end; k++) at[k] = gi; });
      const palette = ['var(--water)', 'var(--grain)', 'var(--protein)', 'var(--female)', 'var(--toxin)'];
      let html = '';
      for (let i = 0; i < g.dna.length; i += 8) {
        const cells = [];
        for (let k = i; k < Math.min(i + 8, g.dna.length); k++) {
          const hex = g.dna[k].toString(16).padStart(2, '0').toUpperCase();
          const gi = at[k];
          if (gi < 0) cells.push(`<span class="junk">${hex}</span>`);
          else if (k === genes[gi].start) cells.push(`<span class="prom" title="promoter">${hex}</span>`);
          else cells.push(`<span style="color:${palette[gi % palette.length]}" title="${Evo.GENES[genes[gi].type].name}">${hex}</span>`);
        }
        const names = [...new Set(genes.filter(x => x.start >= i && x.start < i + 8).map(x => Evo.GENES[x.type].name))].join(', ');
        html += `<div class="dna-row"><span class="addr">${i.toString(16).padStart(3, '0')}</span><span>${cells.join(' ')}</span><span class="names">${names}</span></div>`;
      }
      $('dnaGrid').innerHTML = html;
    }
    $('mutateBtn').addEventListener('click', () => {
      const foc = world.focusedOrganism;
      if (!foc) return;
      foc.rebuild(foc.genome.cloneWithMutation(0.08, false));
      brainVis.probedNeuron = null;
      synth.playTone(660, 0.06, 'sawtooth', 0.05);
      onFocusChanged();
    });
    $('breedBtn').addEventListener('click', () => {
      const a = world.focusedOrganism;
      if (!a) return;
      if (!a.body.isMature) return toast('Only adults can breed.');
      const partner = world.nearestPartner(a);
      if (!partner) return toast('No adult partner of the other sex.');
      const baby = world.breed(a, partner);
      if (!baby) return toast('The terrarium is full.');
      world.focusedOrganism = baby;
    });

    // ---------- Population ----------
    function renderPopulation() {
      const st = world.stats, d = st.deaths;
      const deaths = Object.values(d).reduce((a, v) => a + v, 0);
      $('tileBirths').textContent = st.births;
      $('tileMeals').textContent = st.meals;
      $('tileMigrants').textContent = st.migrants;
      $('tileDeaths').textContent = deaths;
      const parts = [['starved', d.starvation], ['dried out', d.dehydration], ['injured', d.injury], ['old age', d['old age']]]
        .filter(([, v]) => v).map(([k, v]) => `${v} ${k}`);
      const refounded = st.refoundings ? ` Re-founded from proven breeders ${st.refoundings} time${st.refoundings > 1 ? 's' : ''}.` : '';
      $('deathBreakdown').textContent = (deaths ? `Deaths: ${parts.join(', ')}. Poisoned ${st.poisonings} times, hurt by thorns ${st.injuries} times.` : 'No deaths yet.') + refounded;
      const list = [...world.organisms].sort((a, b) => b.generation - a.generation || b.body.ageTicks - a.body.ageTicks);
      $('roster').innerHTML = list.map(o => {
        const e = Math.min(100, o.body.totalEnergy / 2);
        return `<button class="member" data-id="${o.id}" aria-current="${o === world.focusedOrganism}">` +
          `<span class="sex-dot" style="background:${o.sex === 'FEMALE' ? 'var(--female)' : 'var(--male)'}"></span>` +
          `<span>Creature ${o.id}<br><span class="meta">gen ${o.generation}, ${clock(o.body.ageTicks)} old, ${o.meals} ${o.meals === 1 ? 'meal' : 'meals'}</span></span>` +
          `<div class="track"><div class="fill" style="width:${e}%;background:var(--energy)"></div></div><span class="num">${o.body.growth < 1 ? 'young' : ''}</span></button>`;
      }).join('');
    }
    $('roster').addEventListener('click', e => {
      const btn = e.target.closest('.member');
      if (!btn) return;
      const org = world.organisms.find(o => String(o.id) === btn.dataset.id);
      if (org) world.focusedOrganism = org;
    });

    // ---------- Always-visible bits ----------
    function refreshStatus() {
      $('statPop').textContent = world.organisms.length;
      $('statGen').textContent = world.organisms.reduce((m, o) => Math.max(m, o.generation), 1);
      $('statSeason').textContent = text.titleCase(world.season);
    }
    $('cardRays').textContent = RAYS.length;
    function refreshCard() {
      const foc = world.focusedOrganism;
      if (!foc) return;
      const b = foc.body;
      $('cardSex').style.background = foc.sex === 'FEMALE' ? 'var(--female)' : 'var(--male)';
      $('cardName').textContent = `Creature ${foc.id}`;
      $('cardGen').textContent = `gen ${foc.generation}${b.growth < 1 ? ', young' : ''}`;
      $('cardDoing').textContent = text.ACTION_WORDS[foc.currentAction] || foc.currentAction;
      const setMini = (id, v) => { $(id).style.width = `${pct(v)}%`; $(id + 'N').textContent = pct(v); };
      setMini('miniEnergy', b.stamina);
      setMini('miniProtein', b.protein);
      setMini('miniWater', b.water);
      $('cardAge').textContent = clock(b.ageTicks);
      $('cardLife').textContent = clock(b.maxLifespanTicks);
      const mood = b.stress > 0.3 ? 'stressed' : b.joy > 0.3 ? 'pleased' : b.boredom > 0.7 ? 'bored' : b.injury > 0.2 ? 'hurt' : 'calm';
      $('cardMood').textContent = mood;
      // Rays showing something that looks like food (fruit or grain; water isn't food)
      const sees = foc.lastSenses ? foc.lastSenses.visionRays.filter(r => r.carb + r.starch > 0.1).length : 0;
      $('cardSees').textContent = sees;
      $('cardMeals').textContent = foc.meals;
    }

    // Draw the deck that is showing (genes only when they changed: they are static)
    function renderActiveDeck() {
      if (!world.focusedOrganism) return;
      if (activeDeck === 'brain') { renderNeuronCard(); renderLearned(); }
      else if (activeDeck === 'body') renderBody();
      else if (activeDeck === 'genes') { if (genesDirty) renderGenes(); }
      else if (activeDeck === 'population') renderPopulation();
    }

    // The followed creature changed (tapped, born, died, or its genome was rebuilt): a probed neuron
    // from its old brain would no longer exist, so drop it before anything draws.
    let lastFocus = null, lastBrain = null;
    function onFocusChanged() {
      const foc = world.focusedOrganism;
      lastFocus = foc;
      lastBrain = foc && foc.brain;
      brainVis.probedNeuron = null;
      genesDirty = true;
      refreshStatus();
      refreshCard();
      renderActiveDeck();
    }

    // ---------- Main loop ----------
    let frame = 0;
    function loop() {
      frame++;
      if (!isPaused) for (let s = 0; s < simSpeed; s++) world.step();
      view.render();

      const foc = world.focusedOrganism;
      if (foc !== lastFocus || (foc && foc.brain !== lastBrain)) onFocusChanged();
      if (foc && foc.brain.spikesThisTick) synth.chirpSpike();

      if (labVisible() && activeDeck === 'brain' && foc) {
        brainVis.render();
        const probed = brainVis.probedNeuron;
        const v = probed ? probed.displayVoltage
          : foc.brain.lobe('associative').reduce((a, n) => a + n.displayVoltage, 0) / foc.brain.lobe('associative').length;
        scope.pushSample(v);
        scope.render();
        if (frame % 20 === 0) {
          $('scopeTitle').textContent = probed ? `Pulse monitor: ${text.neuronName(probed).toLowerCase()}` : 'Pulse monitor: thinking lobe average';
          $('brainCounts').textContent = `${foc.brain.allNeurons.length} neurons, ${foc.brain.synapses.length} synapses (${foc.brain.sproutedCount} grown, ${foc.brain.prunedCount} pruned in life)`;
          refreshNeuronLive();
        }
      }

      if (frame % 8 === 0) refreshCard();
      if (frame % 15 === 0 && labVisible() && activeDeck !== 'brain') renderActiveDeck();
      if (frame % 15 === 0 && labVisible() && activeDeck === 'brain') renderLearned();
      if (frame % 30 === 0) refreshStatus();
      requestAnimationFrame(loop);
    }
    onFocusChanged();
    requestAnimationFrame(loop);

    // Handles for debugging from the console (and for the browser tests)
    Evo.app = { world, view, brainVis, scope, synth };
  }

  Evo.bootApp = bootApp;
})(globalThis.Evo);
