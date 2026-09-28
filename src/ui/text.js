// Plain-language words for what's inside a creature and what it is doing (the code keeps its
// technical names).
(function (Evo) {
  'use strict';
  const { LOBE_INFO, VISION_FEATURES, SCENTS, STAGES, CHEMICALS, MOTORS } = Evo;

  const SIDE = { L: 'left', R: 'right' };
  const FEATURE_WORDS = Object.fromEntries(VISION_FEATURES.map(f => [f.key, f.word]));
  const ODOUR_WORDS = Object.fromEntries(SCENTS.map(s => [s.key, s.word]));
  const MOTOR_WORDS = Object.fromEntries(MOTORS.map(m => [m.key, m.word]));
  const CHEM_WORDS = Object.fromEntries(CHEMICALS.map(c => [c.key, c.word]));

  const ACTION_WORDS = {
    idle: 'Standing', walking: 'Walking', running: 'Running', jumping: 'Jumping', eating: 'Eating', drinking: 'Drinking',
    resting: 'Resting', calling: 'Calling', sleeping: 'Asleep', held: 'Being held'
  };
  const DEATH_WORDS = {
    starvation: 'starved', dehydration: 'died of thirst', poison: 'was poisoned', 'old age': 'died of old age',
    injury: 'died of injuries', cold: 'froze', heat: 'overheated', illness: 'fell ill and died'
  };

  function lobeName(n) {
    const word = LOBE_INFO[n.parentLobe].word;
    return n.copyOf !== null ? `${word} copy` : word;
  }

  function neuronName(brain, n) {
    if (n.copyOf !== null) return `Copy of ${neuronName(brain, brain.neurons[n.copyOf]).toLowerCase()}`;
    const m = n.meta;
    switch (m.kind) {
      case 'sight': return `Sees ${FEATURE_WORDS[m.feature]} to the ${SIDE[m.side]}${m.band === 'high' ? ', up high' : ''}`;
      case 'smell': return `Smells ${ODOUR_WORDS[m.odour]} (${SIDE[m.side]} antenna)`;
      case 'hearing': return `Hears a ${m.pitch} call on the ${SIDE[m.side]}`;
      case 'motor': return `${MOTOR_WORDS[m.key]} muscle`;
      case 'cell': return `${LOBE_INFO[n.lobe].cell} ${m.index + 1}`;
      case 'need': {
        const chems = needChemicals(brain, m.index);
        return chems.length ? `Feels ${chems.join(' & ').toLowerCase()}` : `Needs cell ${m.index + 1} (unused)`;
      }
      default: return n.label;
    }
  }

  // Which chemicals drive a Needs cell, according to the creature's receptor genes
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
      return k < MOTORS.length ? `the urge to ${MOTORS[k].word.toLowerCase()}` : `Needs cell ${k + 1}`;
    }
    if (key.startsWith('limbic:')) {
      const k = Number(key.slice(7));
      return k === 0 ? 'the reward cell' : k === 1 ? 'the punishment cell' : `feelings cell ${k + 1}`;
    }
    return TARGET_WORDS[key] || words(key);
  }

  const seconds = ticks => {
    const s = ticks / Evo.TICKS_PER_SECOND;
    return s < 1 ? 'under a second' : s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`;
  };
  const num = (v, d = 2) => (Math.abs(v) >= 100 ? Math.round(v) : Number(v.toFixed(d)));

  // One gene in plain words. Returns { name, group, text }; group is 'body' | 'brain' | 'chemistry' | 'instinct'
  function describeGene(genome, gene, brain = null) {
    const def = Evo.GENES[gene.type], v = genome.decode(gene), name = def.name;
    const lobe = i => LOBE_INFO[Evo.LOBE_ORDER[i]].word;
    const pct = x => `${Math.round(x * 100)}%`;
    switch (name) {
      case 'Reaction': {
        const lhs = [v.a, v.b].filter(Boolean).map(chemName).join(' + ');
        const rhs = [[v.c, v.yieldC], [v.d, v.yieldD]].filter(([c, y]) => c && y > 0).map(([c]) => chemName(c)).join(' + ');
        return { name, group: 'chemistry', text: `${lhs} → ${rhs || 'nothing'}` };
      }
      case 'Emitter': {
        const inv = v.flags & 1;
        return { name, group: 'chemistry', text: `${inv ? 'Too little' : 'Enough'} ${locusName(v.locus)} releases ${chemName(v.chem).toLowerCase()}` };
      }
      case 'Receptor': {
        const inv = v.flags & 1, neg = v.flags & 4;
        return { name, group: 'chemistry', text: `${inv ? 'Lack of' : ''}${inv ? ' ' + chemName(v.chem).toLowerCase() : chemName(v.chem)} ${neg ? 'lowers' : 'raises'} ${targetName(v.target)}` };
      }
      case 'Half-life':
        return { name, group: 'chemistry', text: v.halfLife === Infinity ? `${chemName(v.chem)} never fades` : `${chemName(v.chem)} halves in ${seconds(v.halfLife)}` };
      case 'Initial concentration':
        return { name, group: 'chemistry', text: `Born with ${pct(v.amount)} ${chemName(v.chem).toLowerCase()}` };
      case 'Axon guidance': {
        const src = v.source, map = src.relX || src.relY ? (src.mirrorX ? ', crossed map' : ', mapped') : '';
        return { name, group: 'brain', text: `${lobe(src.lobe)} axons seek (${num(v.tx)}, ${num(v.ty)}, ${num(v.tz)})${map}, ${v.sign > 120 ? 'exciting' : 'inhibiting'}` };
      }
      case 'Region duplication': return { name, group: 'brain', text: `A copy of the ${lobe(v.source).toLowerCase()} region` };
      case 'Pacemaker': return { name, group: 'brain', text: `${lobe(v.lobe)} cells fire on their own (${pct(v.bias)})` };
      case 'Anatomy': return { name, group: 'brain', text: `${lobe(v.region)} region: ${pct(0.5 + v.count * 1.1)} cells, ${pct(0.6 + v.size * 0.9)} size` };
      case 'Neurochemistry': return { name, group: 'brain', text: `${['Reward', 'Stress', 'NO'][v.chem % 3]} chemical spreads ${pct(v.spread)}` };
      case 'Membrane': return { name, group: 'brain', text: `Neurons fire at ${num(-58 + v.threshold * 10, 0)} mV` };
      case 'Plasticity': return { name, group: 'brain', text: `Learns at ${pct(v.rate)}, remembers ${pct(v.memory)}` };
      case 'Reinforcement': return { name, group: 'brain', text: `Feels reward ${pct(v.joy)}, stress ${pct(v.stress)}` };
      case 'Curiosity': return { name, group: 'brain', text: `Gets used to things ${pct(v.habituation)}, loves novelty ${pct(v.novelty)}` };
      case 'Instinct': {
        const L = Evo.LOBE_ORDER;
        const cell = (l, i) => {
          const idx = brain && brain.lobes[L[l]];
          if (i >= 255 || !L[l]) return null;
          return idx && i < idx.length ? neuronName(brain, brain.neurons[idx[i]]).toLowerCase() : `${lobe(l).toLowerCase()} ${i + 1}`;
        };
        const inputs = [cell(v.lobeA, v.indexA), cell(v.lobeB, v.indexB)].filter(Boolean).join(' + ');
        const motor = MOTORS[v.motor % MOTORS.length].word.toLowerCase();
        return { name, group: 'instinct', text: `Dreams: ${inputs || 'nothing'} → ${motor}, feels ${chemName(v.chem).toLowerCase()}` };
      }
      default: {
        const parts = Object.entries(v).slice(0, 4).map(([k, x]) => `${words(k)} ${typeof x === 'number' ? pct(x) : x}`);
        return { name, group: 'body', text: parts.join(', ') };
      }
    }
  }
  const stageName = stage => STAGES[stage].word;

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
  const pct = v => `${Math.round(Math.max(0, Math.min(100, v)))}`;
  const titleCase = s => s.charAt(0) + s.slice(1).toLowerCase();

  Evo.text = {
    lobeName, neuronName, needChemicals, chemName, stageName, clock, timeOfDay, pct, titleCase,
    locusName, targetName, describeGene, seconds,
    ACTION_WORDS, DEATH_WORDS, CHEM_WORDS, MOTOR_WORDS
  };
})(globalThis.Evo);
