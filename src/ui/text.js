// Plain-language words for what's inside a creature and what it is doing (the code keeps its
// technical names). Pure functions, no page access: tests load this file in Node.
(function (Evo) {
  'use strict';
  const { clamp } = Evo.util;
  const { LOBE_INFO, VISION_FEATURES, SCENTS, STAGES, CHEMICALS, MOTORS, TRAIT_RANGES: R } = Evo;

  const SIDE = { L: 'left', R: 'right' };
  const FEATURE_WORDS = Object.fromEntries(VISION_FEATURES.map(f => [f.key, f.word]));
  const ODOUR_WORDS = Object.fromEntries(SCENTS.map(s => [s.key, s.word]));
  const MOTOR_WORDS = Object.fromEntries(MOTORS.map(m => [m.key, m.word]));
  const CHEM_WORDS = Object.fromEntries(CHEMICALS.map(c => [c.key, c.word]));
  // Where a sight cell (or what the creature attends to) looks: 'on the left, up high'
  const whereSeen = (m, prep = 'on') => `${prep} the ${SIDE[m.side]}${m.band === 'high' ? ', up high' : ''}`;

  const ACTION_WORDS = {
    idle: 'Standing', walking: 'Walking', running: 'Running', jumping: 'Jumping', eating: 'Eating', drinking: 'Drinking',
    resting: 'Resting', calling: 'Calling', sleeping: 'Asleep', held: 'Being held'
  };
  const DEATH_WORDS = {
    starvation: 'starved', dehydration: 'died of thirst', poison: 'was poisoned', 'old age': 'died of old age',
    injury: 'died of injuries', cold: 'froze', heat: 'overheated', illness: 'fell ill and died'
  };
  // A stimulus (Evo.STIMULI) that has just happened
  const STIMULUS_PAST = {
    ate: 'ate', drank: 'drank', patted: 'was tickled', slapped: 'was slapped', nuzzled: 'nuzzled another', wasNuzzled: 'was nuzzled',
    shoved: 'shoved another', wasShoved: 'was shoved', called: 'called', heardCall: 'heard a call', grabbed: 'picked something up',
    dropped: 'dropped something', bumped: 'bumped into something', fell: 'landed hard', woke: 'woke up', fellAsleep: 'fell asleep',
    mated: 'mated', played: 'played', pricked: 'was pricked by thorns'
  };

  // ---------- Brain regions and neurons ----------
  // The sight copy whose cells compete (Lobe dynamics) is what the creature attends with
  const isAttention = (brain, lobe) => !!(brain && brain.duplicatesOf && (brain.duplicatesOf.sight || [])[0] === lobe &&
    brain.dynamics && brain.dynamics.some(d => d.lobe === lobe));
  const dynamicsOf = (brain, lobe) => (brain && brain.dynamics ? brain.dynamics.find(d => d.lobe === lobe) : null) || null;

  // A region of this brain by its id in brain.lobes (duplicates: 'dup1_sight' and so on)
  function regionName(brain, lobe) {
    if (LOBE_INFO[lobe]) return LOBE_INFO[lobe].word;
    if (isAttention(brain, lobe)) return 'Attention';
    const parent = lobe.replace(/^dup\d+_/, '');
    return `${LOBE_INFO[parent] ? LOBE_INFO[parent].word : parent} copy`;
  }

  // What a region is for, in a sentence
  const REGION_ABOUT = {
    sight: 'What its eyes see: each colour (and other creatures, and movement) on the left or right, low or high.',
    smell: 'What its two antennae smell, left and right.',
    hearing: 'Calls heard on the left or right, low or high.',
    touch: 'Touch on each side, its mouth, lips, back and feet; pain; falling; being in water.',
    taste: 'The taste of what it is eating or drinking.',
    near: 'The look of whatever is right at its mouth.',
    needs: 'One cell per drive (hunger, thirst, fear…), driven by whichever chemicals its receptor genes attach.',
    feelings: 'The reward and punishment cells fire on surprises (better or worse than expected); that is what it learns from.',
    cortex: 'General cells that associate senses and drives.',
    side: 'General cells, one group on each side.',
    central: 'General cells in the middle.',
    motor: 'One cell per muscle. The busiest one is what it is doing.',
    stem: 'General cells at the back of the brain.'
  };
  function regionAbout(brain, lobe) {
    if (isAttention(brain, lobe)) return 'A copy of sight whose cells compete, so it settles on one thing at a time; what it needs biases which.';
    const dyn = dynamicsOf(brain, lobe);
    let text = REGION_ABOUT[lobe] || `A copy of the ${regionName(brain, lobe.replace(/^dup\d+_/, '')).toLowerCase()} region: each cell is fed by its original.`;
    if (dyn && lobe === 'cortex' && dyn.persistence > 1) text = 'Working memory: a cell that starts firing keeps going for a while, so what it just saw outlasts the sight.';
    else if (dyn && lobe === 'motor') text += ' The muscles compete, so one action wins and is held until it tires.';
    return text;
  }

  function lobeName(brain, n) {
    return n.copyOf !== null ? regionName(brain, n.lobe) : LOBE_INFO[n.parentLobe].word;
  }

  function neuronName(brain, n) {
    if (n.copyOf !== null) {
      const original = neuronName(brain, brain.neurons[n.copyOf]);
      return isAttention(brain, n.lobe) ? `Attends: ${original.toLowerCase()}` : `Copy of ${original.toLowerCase()}`;
    }
    const m = n.meta;
    switch (m.kind) {
      case 'sight': return `Sees ${FEATURE_WORDS[m.feature]} ${whereSeen(m, 'to')}`;
      case 'smell': return `Smells ${ODOUR_WORDS[m.odour]} (${SIDE[m.side]} antenna)`;
      case 'near': return `Sees ${FEATURE_WORDS[m.feature]} up close`;
      case 'hearing': return `Hears a ${m.pitch} call on the ${SIDE[m.side]}`;
      case 'motor': return `${MOTOR_WORDS[m.key]} muscle`;
      case 'cell': return `${LOBE_INFO[n.lobe].cell} ${m.index + 1}`;
      case 'need': {
        const chems = needChemicals(brain, m.index);
        return chems.length ? `Feels ${chems.join(' & ').toLowerCase()}` : `Drives cell ${m.index + 1} (unused)`;
      }
      default: return n.label;
    }
  }

  // What one neuron does, in a sentence (for the neuron card)
  function neuronRole(brain, n) {
    const m = n.meta;
    if (brain.modulator[n.index] === 0) return 'Fires when things turn out better than expected. Its inputs learn to predict reward, and its signal is what makes the brain learn.';
    if (brain.modulator[n.index] === 1) return 'Fires when things turn out worse than expected. Its inputs learn to predict trouble, and its signal teaches the brain to avoid it.';
    if (isAttention(brain, n.lobe)) return 'An attention cell. It competes with the others in its region; when it wins, this is what the creature is looking at.';
    if (n.copyOf !== null) return 'A copy of another cell, fed by it. Its own wiring can grow in a different direction.';
    switch (m.kind) {
      case 'sight': case 'smell': case 'hearing': case 'near': return 'A sense cell: the world drives it directly.';
      case 'need': return 'A drive cell: the chemicals named above push current into it, so it fires more the stronger the drive.';
      case 'motor': return dynamicsOf(brain, n.lobe)
        ? 'A muscle cell. When it fires the creature does this; the muscles compete, and the busiest one wins.'
        : 'A muscle cell. When it fires the creature does this.';
      case 'cell': {
        const dyn = dynamicsOf(brain, n.lobe);
        if (dyn && dyn.persistence > 1) return 'Working memory: once started it keeps firing for a while. Its role comes from its wiring and from learning.';
        return 'A general-purpose cell. Its role comes from its wiring and from learning.';
      }
      default: return n.lobe === 'touch' || n.lobe === 'taste' ? 'A sense cell: the body drives it directly.' : 'A feelings cell: receptor genes can drive it, and emitter genes can read it.';
    }
  }

  // Which chemicals drive a Drives cell, according to the creature's receptor genes
  function needChemicals(brain, k) {
    const target = Evo.TARGET[`need:${k}`];
    const receptors = (brain.traits && brain.traits.receptors) || [];
    return [...new Set(receptors.filter(r => r.target === target).map(r => (Evo.CHEM_BY_ID[r.chem] ? Evo.CHEM_BY_ID[r.chem].word : `chemical ${r.chem}`)))];
  }

  const chemName = id => (Evo.CHEM_BY_ID[id] ? Evo.CHEM_BY_ID[id].word : `Chemical ${id}`);

  // camelCase key -> 'camel case'
  const words = key => key.replace(/([a-z])([A-Z0-9])/g, '$1 $2').toLowerCase();

  // What a body locus (an emitter gene's input) is, in words
  const LOCUS_WORDS = {
    always: 'always', bodyTemp: 'body heat', heatGain: 'warming up', heatLoss: 'cooling down', darkness: 'darkness',
    exertion: 'exertion', awake: 'being awake', asleep: 'being asleep', resting: 'resting', injury: 'injury',
    health: 'health', impact: 'a knock', gentleTouch: 'a gentle touch', touchingFriend: 'touching a friend',
    company: 'company', crowding: 'crowding', novelty: 'novelty', falling: 'falling', inWater: 'being in water',
    held: 'being held', gutFullness: 'a full belly', mated: 'mating', pregnant: 'pregnancy', heardCall: 'hearing a call',
    growth: 'growth', starving: 'starving'
  };
  const locusName = l => {
    if (l.chem !== undefined) return chemName(l.chem).toLowerCase();
    const key = Evo.BODY_LOCI[l.body];
    if (key.startsWith('taste')) return `a ${words(key.slice(5))} taste`;
    if (key.startsWith('limbic')) return `feelings cell ${Number(key.slice(6)) + 1}`;
    return LOCUS_WORDS[key] || words(key);
  };

  // What a receptor target is, in words
  const TARGET_WORDS = {
    muscle: 'muscle strength', arousal: 'alertness', sleep: 'sleep pressure', damage: 'bodily harm', healing: 'healing',
    fertility: 'fertility', growth: 'growth', scentSex: 'courtship scent', scentAlarm: 'alarm scent',
    metabolism: 'metabolic rate', thermogenesis: 'shivering', cooling: 'panting'
  };
  function targetName(target) {
    const key = Evo.TARGETS[target];
    if (key.startsWith('need:')) {
      const k = Number(key.slice(5));
      return Evo.DRIVES[k] ? `the ${CHEM_WORDS[Evo.DRIVES[k]].toLowerCase()} cell` : `drives cell ${k + 1}`;
    }
    if (key.startsWith('limbic:')) {
      const k = Number(key.slice(7));
      return k === 0 ? 'the reward cell' : k === 1 ? 'the punishment cell' : `feelings cell ${k + 1}`;
    }
    return TARGET_WORDS[key] || words(key);
  }

  const duration = ticks => {
    const s = ticks / Evo.TICKS_PER_SECOND;
    return s < 1 ? 'under a second' : s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`;
  };
  // How long ago, for an event: 'just now', '5 s ago'
  const ago = ticks => {
    const s = duration(ticks);
    return s === 'under a second' ? 'just now' : s + ' ago';
  };
  const num = (v, d = 2) => (Math.abs(v) >= 100 ? Math.round(v) : Number(v.toFixed(d)));
  const percent = x => `${Math.round(x * 100)}%`;   // A 0..1 fraction as a percentage
  const signed = (v, d = 2) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(d)}`;
  // A value on a scale lo..hi as one of a few words (low to high)
  const level = (v, lo, hi, names) => names[clamp(Math.floor((v - lo) / (hi - lo) * names.length), 0, names.length - 1)];
  // A trait on its range (genome.js TRAIT_RANGES) as one of a few words
  const graded = (v, range, names) => level(v, range.lo, range.hi, names);
  // How a region's cells work together (Lobe dynamics), in words: { compete, persist }
  const dynamicsWords = dyn => ({
    compete: graded(dyn.competition, R.competition, ['weakly', 'moderately', 'strongly']),
    persist: graded(dyn.persistence, R.persistence, ['briefly', 'for a while', 'for long'])
  });

  // Word helpers for the gene words below (DESCRIBE)
  function geneWords(brain) {
    const lobe = i => LOBE_INFO[Evo.LOBE_ORDER[i]].word;
    // An instinct's input cell by lobe and index (null for "no input")
    const cell = (l, i) => {
      const L = Evo.LOBE_ORDER;
      if (i >= Evo.GENE_NONE || !L[l]) return null;
      const idx = brain && brain.lobes[L[l]];
      return idx && i < idx.length ? neuronName(brain, brain.neurons[idx[i]]).toLowerCase() : `${lobe(l).toLowerCase()} ${i + 1}`;
    };
    return { chem: chemName, locus: locusName, target: targetName, lobe, cell, percent, num, duration };
  }

  // ---------- Genes ----------
  const hueWord = h => ['red', 'orange', 'yellow', 'lime', 'green', 'teal', 'cyan', 'blue', 'indigo', 'violet', 'magenta', 'pink'][Math.round(((h % 360) + 360) % 360 / 30) % 12];
  const PATTERNS = ['plain', 'stripes', 'spots', 'patches'];
  const speedWord = perSecond => (perSecond < 0.05 ? 'a trickle' : perSecond < 0.3 ? 'slowly' : perSecond < 1.2 ? 'steadily' : 'quickly');
  const rateWord = k => graded(Math.log10(k), R.rate, ['very slowly', 'slowly', 'at a moderate pace', 'fast', 'very fast']);
  // When an emitter or receptor acts, with a leading space: below its threshold (inverted), above it,
  // or '' at any level
  const thresholdWord = (invert, t) => (invert ? ` below ${percent(t)}` : t > 0.005 ? ` above ${percent(t)}` : '');

  // Which cells an axon guidance gene reaches in this brain: the same chemical match the brain grows
  // by (brain.growTracts), without the chance. Returns { from, to } in words, or null without a brain.
  function guidanceReach(brain, x) {
    if (!brain) return null;
    const sources = brain.tractSources(x);
    const hits = new Map(), cells = new Set(), senders = new Set();
    for (const s of sources) {
      const targets = brain.tractTargets(x, s);
      for (const [d] of targets) {
        cells.add(d.index);
        hits.set(d.lobe, (hits.get(d.lobe) || 0) + 1);
      }
      if (targets.length) senders.add(s.index);
    }
    // Leave out copies whose original is in the set too (a duplicate region inherits its parent's wiring)
    const originals = set => [...set].map(i => brain.neurons[i]).filter(n => n.copyOf === null || !set.has(n.copyOf));
    // Name the sending cells when only some of the region sends: by what they sense, or one by one
    const lobeWord = LOBE_INFO[Evo.LOBE_ORDER[x.source.lobe]].word, sending = originals(senders);
    const what = s => (s.meta.feature ? `seeing ${FEATURE_WORDS[s.meta.feature]}` : s.meta.odour ? `the smell of ${ODOUR_WORDS[s.meta.odour]}` : neuronName(brain, s).toLowerCase());
    const kinds = [...new Set(sending.map(what))];
    const from = !senders.size ? `${lobeWord} (no cells match)`
      : senders.size === sources.length && !x.srcWindow ? lobeWord
        : kinds.length <= 2 ? kinds.join(' and ') : `${sending.length} ${lobeWord.toLowerCase()} cells`;
    const reached = originals(cells);
    const cellWord = d => (isAttention(brain, d.lobe) ? `attention to ${FEATURE_WORDS[d.meta.feature]} on the ${SIDE[d.meta.side]}` : neuronName(brain, d).toLowerCase());
    const names = [...new Set(reached.map(cellWord))];
    const regions = [...hits.entries()].filter(([l]) => !/^dup\d+_/.test(l) || !hits.has(l.replace(/^dup\d+_/, '')))
      .sort((a, b) => b[1] - a[1]).slice(0, 2).map(([l]) => regionName(brain, l));
    const to = !cells.size ? 'nothing it can find' : names.length <= 2 ? names.join(' and ') : regions.join(' and ');
    return { from, to };
  }

  // An instinct (an Instinct gene's decoded values, or brain.dream.instinct) in words:
  // 'inputs → action, feels chemical'
  function describeInstinct(v, brain = null) {
    const w = geneWords(brain);
    const inputs = [w.cell(v.lobeA, v.indexA), w.cell(v.lobeB, v.indexB)].filter(Boolean).join(' + ');
    const motor = MOTORS[v.motor % MOTORS.length].word.toLowerCase();
    return `${inputs || 'nothing'} → ${motor}, feels ${w.chem(v.chem).toLowerCase()}`;
  }

  // Each gene in plain words, by name: (v decoded, x expressed, w word helpers, brain) -> text.
  // (Emitters and receptors that name no chemical express nothing, so those read the decoded bytes.)
  const DESCRIBE = {
    // Body
    Appearance: (v, x) => `${hueWord(x.hue)} fur with ${hueWord(x.accentHue)} markings, ${PATTERNS[x.pattern]}; ` +
      `${level(x.earSize, 0, 1, ['small', 'medium', 'big'])} ears, ${level(x.tailLength, 0, 1, ['short', 'medium', 'long'])} tail`,
    Morphology: (v, x) => `Grows to ${Math.round(x.adultSize)} px, ${level(x.legLength, 0, 1, ['short', 'medium', 'long'])} legs, reaches ${num(x.mouthReach, 0)} px with its mouth`,
    Eyes: (v, x) => `Sees ${Math.round(x.visionRange)} px, ${level(x.nightVision, 0, 1, ['poorly', 'fairly', 'well'])} at night`,
    Nose: (v, x) => `Smells ${Math.round(x.noseReach)} px around it, sensitivity ×${num(x.scentGain, 1)}`,
    Muscle: (v, x) => `Walks at ${num(x.walkSpeed)}, runs ×${num(x.runBoost, 1)}, jumps ${num(x.jumpPower, 1)}`,
    'Life history': (v, x, w) => `Lives about ${w.duration(x.lifespanTicks)}; carries an egg for ${w.duration(x.gestationTicks)}`,
    Voice: (v, x) => `A ${x.voicePitch > 0.5 ? 'high' : 'low'}, ${level(x.voiceLoudness, 0.4, 1, ['soft', 'clear', 'loud'])} voice`,
    Insulation: (v, x) => `${graded(x.insulation, R.fur, ['Thin', 'Medium', 'Thick'])} fur (${percent(x.insulation)}), ${level(x.bodyHeat, 0, 1, ['cool', 'warm', 'hot'])}-blooded`,
    Reproduction: (v, x, w) => `Fills each egg to ${w.percent(Evo.eggShare(x))} of a standard egg, which hatches in about ${w.duration(x.incubationTicks)}`,
    // Brain
    Membrane: (v, x, w) => `Neurons fire at ${w.num(x.baseThreshold, 0)} mV`,
    Plasticity: (v, x, w) => `Learns at rate ${w.num(x.learningRate, 3)}; a memory trace halves in ${w.num(Math.log(0.5) / Math.log(x.traceDecay), 0)} ticks`,
    Reinforcement: (v, x, w) => `Feels reward ×${w.num(x.joyGain)}, punishment ×${w.num(x.stressGain)}`,
    Curiosity: (v, x, w) => `Gets used to things at rate ${w.num(x.habituationRate, 4)}, loves novelty ×${w.num(x.noveltyGain, 1)}`,
    Anatomy: (v, x, w) => `${w.lobe(v.region)} region: ${w.percent(x.count)} cells, ${w.percent(x.size)} size`,
    'Region duplication': (v, x, w) => `A copy of the ${w.lobe(v.source).toLowerCase()} region`,
    'Lobe dynamics'(v, x, w, brain) {
      const parent = Evo.LOBE_ORDER[x.lobeIdx];
      const lobe = x.copy ? brain && (brain.duplicatesOf[parent] || [])[x.copy - 1] : parent;
      const region = lobe ? regionName(brain, lobe) : `${LOBE_INFO[parent].word} copy ${x.copy} (not there)`;
      const { compete, persist } = dynamicsWords(x);
      return `${region}: cells compete ${compete}, and one that fires keeps going ${persist} (about ${duration(1 / (1 - x.keep))})`;
    },
    Pacemaker: (v, x, w) => `${w.lobe(x.lobeIdx)} cells fire on their own (+${w.num(x.bias)} mV)`,
    Neurochemistry: (v, x, w) => `${Evo.NEUROCHEMS.find(n => n.key === x.neurochem).word} chemical spreads ${w.percent(x.spread)}`,
    'Axon guidance'(v, x, w, brain) {
      const src = x.source, reach = guidanceReach(brain, x), excites = x.weightSign > 0;
      if (!reach) { // No brain to trace it in: where the axons look
        const [tx, ty, tz] = x.target.map(t => w.num(t)), map = src.relX || src.relY ? (src.mirrorX ? ', crossed map' : ', mapped') : '';
        return `${w.lobe(src.lobe)} axons seek (${tx}, ${ty}, ${tz})${map}, ${excites ? 'exciting' : 'inhibiting'}${x.srcWindow ? ', from a window of cells' : ''}`;
      }
      const map = src.relX || src.relY ? (src.mirrorX ? ', each cell to the opposite side' : ', each cell to its match') : '';
      return `${capitalize(reach.from)} → ${reach.to}: ${excites ? 'excites' : 'inhibits'}${map}`;
    },
    // Chemistry
    Stimulus(v, x, w) {
      const parts = [[v.chem1, v.amount1], [v.chem2, v.amount2]].filter(([c, a]) => c && a).map(([c, a]) => `${w.chem(c).toLowerCase()} ${signed(a)}`);
      return `When it ${Evo.STIMULUS_WORDS[Evo.STIMULI[x.stimulus]]}: ${parts.join(', ') || 'nothing'}`;
    },
    Emitter(v, x, w) {
      const reading = w.locus(v.locus), out = w.chem(v.chem).toLowerCase(), { invert, digital } = Evo.flagsOf(v.flags);
      if (Evo.BODY_LOCI[v.locus.body] === 'always') return `Always makes ${out}, ${speedWord(v.gain * Evo.TICKS_PER_SECOND)}`;
      return `${capitalize(reading)}${thresholdWord(invert, v.threshold)} → makes ${out}${digital ? ' (all or nothing)' : `, ${speedWord(v.gain * Evo.TICKS_PER_SECOND)}`}`;
    },
    Receptor(v, x, w) {
      const { invert, negative } = Evo.flagsOf(v.flags);
      return `${w.chem(v.chem)}${thresholdWord(invert, v.threshold)} ${negative ? 'lowers' : 'raises'} ${w.target(v.target)} (×${num(v.gain, 1)})`;
    },
    Reaction(v, x, w) {
      const ins = [v.a, v.b].filter(Boolean), outs = [[v.c, v.yieldC], [v.d, v.yieldD]].filter(([c, y]) => c && y > 0);
      const side = pairs => pairs.map(([c, y]) => `${Math.abs(y - 1) > 0.05 ? `${num(y, 1)} ` : ''}${w.chem(c).toLowerCase()}`).join(' + ');
      // A chemical on both sides is not used up: it drives the reaction ("Insulin turns blood sugar into glycogen")
      const cat = ins.find(c => outs.some(([o]) => o === c));
      if (cat && ins.length === 2) {
        const other = w.chem(ins.find(c => c !== cat) || cat).toLowerCase(), made = outs.filter(([o]) => o !== cat);
        return `${w.chem(cat)} ${made.length ? `turns ${other} into ${side(made)}` : `uses up ${other}`}, ${rateWord(v.rate)}`;
      }
      const lhs = ins.map(c => w.chem(c).toLowerCase()).join(' + ');
      const text = `${lhs || 'nothing'} → ${side(outs) || 'nothing'}, ${rateWord(v.rate)}`;
      return capitalize(text);
    },
    'Half-life': (v, x, w) => (v.halfLife === Infinity ? `${w.chem(v.chem)} never fades` : `${w.chem(v.chem)} halves in ${w.duration(v.halfLife)}`),
    // A copy that switches on after birth sets its chemical when the creature reaches that stage
    'Initial concentration': (v, x, w, brain, gene) => (gene.stage > 1
      ? `${w.chem(v.chem)} set to ${w.percent(v.amount)} on reaching the ${STAGES[gene.stage].word.toLowerCase()} stage`
      : `Born with ${w.percent(v.amount)} ${w.chem(v.chem).toLowerCase()}`),
    // Instinct
    Instinct: (v, x, w, brain) => `Dreams: ${describeInstinct(v, brain)}`
  };

  // The headings genes are listed under within their group (GENES group in genome.js), in order,
  // each with the genes it holds and a note shown under it
  const GENE_KINDS = {
    brain: [
      { kind: 'How neurons work', genes: ['Membrane', 'Plasticity', 'Reinforcement', 'Curiosity', 'Neurochemistry'] },
      { kind: 'Regions', genes: ['Anatomy', 'Region duplication', 'Lobe dynamics', 'Pacemaker'] },
      { kind: 'Wiring', genes: ['Axon guidance'], note: 'Axon guidance genes: which cells grow connections to which.' }
    ],
    chemistry: [
      { kind: 'What events do', genes: ['Stimulus'], note: 'Stimulus genes: what each thing that happens to it releases.' },
      { kind: 'What the body makes', genes: ['Emitter'], note: 'Emitter genes: a body reading (or a chemical) above or below a level makes a chemical.' },
      { kind: 'What chemicals act on', genes: ['Receptor'], note: 'Receptor genes: a chemical pushes on the body or on one brain cell.' },
      { kind: 'Reactions', genes: ['Reaction'], note: 'Reaction genes: one chemical turns into another.' },
      { kind: 'How fast chemicals fade', genes: ['Half-life'] },
      { kind: 'Starting levels', genes: ['Initial concentration'] }
    ]
  };
  const GENE_KIND = Object.fromEntries(Object.values(GENE_KINDS).flat().flatMap(k => k.genes.map(name => [name, k.kind])));

  // One gene in plain words. Returns { name, kind, group, text }; group is 'body' | 'brain' |
  // 'chemistry' | 'instinct' (GENES in genome.js), kind a heading within the group (GENE_KINDS).
  function describeGene(genome, gene, brain = null) {
    const def = Evo.GENES[gene.type];
    let text = DESCRIBE[def.name](genome.decode(gene), genome.expressed(gene), geneWords(brain), brain, gene);
    // The brain is built once, at birth: a brain-building gene that switches on later does nothing
    if (def.birthOnly && gene.stage > 1) text += ' (only works from birth, so this late copy has no effect)';
    return { name: def.name, kind: GENE_KIND[def.name] || '', group: def.group, text };
  }

  // ---------- Mutations ----------
  // Each gene's identity: its stage and type byte plus payload
  const signature = (genome, gene) => Array.prototype.join.call(genome.dna.subarray(gene.start + 1, gene.end), ',');

  // Gene fields whose code name says little
  const FIELD_WORDS = {
    tx: 'target left–right', ty: 'target front–back', tz: 'target depth', sx: 'senders left–right', sy: 'senders front–back',
    sr: 'senders spread', radius: 'target spread', a: 'input', b: 'second input', c: 'output', d: 'second output',
    yieldC: 'output amount', yieldD: 'second output amount', chem1: 'chemical', amount1: 'amount', chem2: 'second chemical',
    amount2: 'second amount', lobeA: 'input region', indexA: 'input cell', lobeB: 'second input region', indexB: 'second input cell',
    motor: 'action', flags: 'switches', tau: 'holding time', chemShift: 'chemical shift', stimulus: 'event'
  };
  const fieldWord = key => FIELD_WORDS[key] || words(key);

  // One field's value in words, for a before → after line
  function fieldValue(codec, value) {
    const C = Evo.CODEC;
    if (codec === C.chem) return value ? chemName(value).toLowerCase() : 'nothing';
    if (codec === C.locus) return locusName(value);
    if (codec === C.target) return targetName(value);
    if (codec === C.halfLife) return value === Infinity ? 'never' : duration(value);
    if (codec === C.lobe) return LOBE_INFO[Evo.LOBE_ORDER[value]].word.toLowerCase();
    if (typeof value === 'number') return value === Infinity ? 'never' : String(num(value, 2));
    return '…';
  }

  // What differs between a gene and the gene it came from: [{ field, before, after }]
  function fieldChanges(genome, gene, refGenome, refGene) {
    const out = [];
    if (gene.stage !== refGene.stage) out.push({ field: 'switches on', before: STAGES[Math.max(1, refGene.stage)].word.toLowerCase(), after: STAGES[Math.max(1, gene.stage)].word.toLowerCase() });
    Evo.GENES[gene.type].fields.forEach(([key, codec], k) => {
      const a = refGenome.dna[refGene.start + 2 + k], b = genome.dna[gene.start + 2 + k];
      if (a !== b) out.push({ field: fieldWord(key), before: fieldValue(codec, codec.decode(a)), after: fieldValue(codec, codec.decode(b)) });
    });
    return out;
  }

  // How a genome differs from reference genomes (its parents, or the founders): genes that match
  // none of them, each paired with the most similar reference gene of its kind when there is one
  // ('changed'), else 'new' (or 'copy' when it is an extra copy of a gene they have); and genes that
  // every reference has but it lacks ('lost'). skip: gene names to leave out.
  // Returns [{ kind, gene, ref: { genome, gene } | null }], gene = null for 'lost'.
  function geneChanges(genome, refs, skip = []) {
    const skipTypes = new Set(skip.map(n => Evo.GENE_INDEX[n]));
    const listed = g => g.findGenes().filter(x => !skipTypes.has(x.type)).map(x => ({ gene: x, sig: signature(g, x), genome: g }));
    const mine = listed(genome), theirs = refs.map(listed);
    const count = list => list.reduce((m, x) => m.set(x.sig, (m.get(x.sig) || 0) + 1), new Map());
    const myCount = count(mine), theirCounts = theirs.map(count);
    const most = sig => Math.max(0, ...theirCounts.map(m => m.get(sig) || 0));
    const out = [], used = new Set(), seen = new Map();
    // Reference genes the child has no exact copy of: what a changed gene may have come from
    const orphans = theirs.flat().filter(x => !myCount.has(x.sig));
    for (const x of mine) {
      const n = (seen.get(x.sig) || 0) + 1;
      seen.set(x.sig, n);
      if (n <= most(x.sig)) continue;
      if (most(x.sig) > 0) { out.push({ kind: 'copy', gene: x.gene, ref: null }); continue; }
      let best = null, bestD = Infinity;
      const a = genome.dna, len = x.gene.end - x.gene.start;
      for (const o of orphans) {
        if (o.gene.type !== x.gene.type || used.has(o)) continue;
        let d = 0;
        for (let k = 1; k < len; k++) if (a[x.gene.start + k] !== o.genome.dna[o.gene.start + k]) d++;
        if (d < bestD) { bestD = d; best = o; }
      }
      if (best && bestD <= Math.ceil((len - 1) / 2)) {
        used.add(best);
        for (const o of orphans) if (o.sig === best.sig) used.add(o); // The same gene in the other parent
        out.push({ kind: 'changed', gene: x.gene, ref: { genome: best.genome, gene: best.gene } });
      } else out.push({ kind: 'new', gene: x.gene, ref: null });
    }
    // Lost: in every reference (so it could not simply have been left out by recombination)
    const lostSeen = new Set();
    for (const o of theirs[0] || []) {
      if (used.has(o) || lostSeen.has(o.sig) || myCount.has(o.sig)) continue;
      if (theirCounts.every(m => m.has(o.sig))) { lostSeen.add(o.sig); out.push({ kind: 'lost', gene: null, ref: { genome: o.genome, gene: o.gene } }); }
    }
    return out;
  }

  // The founders' genes as one reference genome (no junk DNA), with the given sex chromosome
  let founderBytes = null;
  function founderGenome(sexChrom) {
    if (!founderBytes) founderBytes = Uint8Array.from(Evo.FOUNDER_GENOME.flatMap(spec => Evo.encodeGene(spec)));
    return new Evo.Genome(founderBytes, sexChrom);
  }

  // ---------- Traits ----------
  // What a creature's genes built, as [label, words, exact value]
  function traitWords(tr) {
    return [
      ['Adult size', graded(tr.adultSize, R.size, ['small', 'medium', 'large']), `${Math.round(tr.adultSize)} px`],
      ['Walking', graded(tr.walkSpeed, R.walk, ['slow', 'steady', 'brisk', 'fast']), num(tr.walkSpeed)],
      ['Jumping', graded(tr.jumpPower, R.jump, ['weak', 'fair', 'good', 'springy']), num(tr.jumpPower, 1)],
      ['Eyesight', graded(tr.visionRange, R.eyes, ['short', 'medium', 'long']), `${Math.round(tr.visionRange)} px`],
      ['Night sight', level(tr.nightVision, 0, 1, ['poor', 'some', 'good']), percent(tr.nightVision)],
      ['Nose', graded(tr.noseReach, R.nose, ['short', 'medium', 'keen']), `${Math.round(tr.noseReach)} px`],
      ['Lifespan', duration(tr.lifespanTicks), clock(tr.lifespanTicks)],
      ['Egg takes', duration(tr.gestationTicks), clock(tr.gestationTicks)],
      ['Hatches in', duration(tr.incubationTicks), clock(tr.incubationTicks)],
      ['Fur', graded(tr.insulation, R.fur, ['thin', 'medium', 'thick']), percent(tr.insulation)],
      ['Learning', graded(tr.learningRate, R.learning, ['slow', 'average', 'quick']), num(tr.learningRate, 3)],
      ['Voice', tr.voicePitch > 0.5 ? 'high' : 'low', percent(tr.voiceLoudness) + ' loud']
    ];
  }

  // Simulated time: ticks as minutes:seconds
  const clock = ticks => {
    const s = Math.max(0, Math.floor(ticks / Evo.TICKS_PER_SECOND));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  // Time of day from the world clock's phase (0 = midnight)
  const timeOfDay = phase => {
    const minutes = Math.floor(phase * 24 * 60);
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  };
  const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);

  Evo.text = {
    lobeName, neuronName, neuronRole, regionName, regionAbout, clock, timeOfDay,
    describeGene, describeInstinct, duration, ago, signed, level, dynamicsWords, GENE_KINDS,
    geneChanges, fieldChanges, founderGenome, traitWords, isAttention,
    ACTION_WORDS, DEATH_WORDS, CHEM_WORDS, MOTOR_WORDS, FEATURE_WORDS, ODOUR_WORDS, whereSeen, STIMULUS_PAST
  };
})(globalThis.Evo);
