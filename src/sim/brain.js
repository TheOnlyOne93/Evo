// A recurrent spiking brain: leaky integrate-and-fire neurons with physical axons (conduction
// delays), grown from the genome and shaped by three-factor learning.
//
// Brain coordinates: x runs from the creature's left (0) to its right (1) *in the world* (the side
// view has two hemifields: what is to the left and what is to the right); y runs from the front
// (senses, 0) to the back (muscles, 1). A spike travels along the axon and arrives after a delay
// set by axon length and myelination.
//
// Neuron state lives in typed arrays (one entry per neuron) and synapses in parallel typed arrays,
// so a brain of ~250 neurons and ~3000 synapses costs a few hundredths of a millisecond per tick.
// brain.neurons[i] describes neuron i (id, lobe, position, receptor tag) for the UI.
(function (Evo) {
  'use strict';
  const { clamp, mean } = Evo.util;
  const { LOBE_ORDER, SENSORY_LOBES, VISION_FEATURES, SCENTS, MOTORS, N_NEEDS, N_LIMBIC, LIMITS } = Evo;

  const MAX_DELAY = 20;              // Longest axonal delay, in ticks (spike history holds 32)
  const SLOTS = MAX_DELAY + 1;       // Ring buffer of future input per neuron
  const SYNAPTIC_GAIN = 20.0;        // mV delivered per unit of synaptic weight
  const WEIGHT_MIN = -1.8, WEIGHT_MAX = 2.0;
  const V_REST = -70, V_RESET = -72;
  const SPROUTED = 1, CUE = 2, INHIBITORY = 4; // Synapse flags
  const ELIG_MAX = 2.0;              // Largest eligibility trace a synapse can hold

  // Volume transmission: chemicals diffusing through the brain tissue. DA = dopamine-like reward,
  // ST = stress chemical, NO = nitric-oxide-like gas that lets active neighbours share credit.
  const CHEM_CHANNELS = ['DA', 'ST', 'NO'];
  const BCHEM = { DA: 0, ST: 1, NO: 2 };
  const CHEM_SIZE = 20;

  // Soft bounds: changes shrink as a weight nears its limit, so weights don't pile up at the rails.
  // A synapse keeps the sign it was born with (Dale's law): learning can silence an excitatory
  // synapse, but never turn it inhibitory, so an innate reflex can fade but not invert.
  function softBounded(w, dw, inhibitory) {
    const lo = inhibitory ? WEIGHT_MIN : 0, hi = inhibitory ? 0 : WEIGHT_MAX;
    const room = dw > 0 ? (hi - w) : (w - lo);
    const nw = w + dw * room / (hi - lo);
    return nw < lo ? lo : nw > hi ? hi : nw;
  }

  // ---- The body plan's fixed neurons ----
  const SIDES = ['L', 'R'];
  const BANDS = ['low', 'high'];
  const HEARING = [['L', 'low'], ['L', 'high'], ['R', 'low'], ['R', 'high']];
  // Touch cells. A receptor tag that matches a muscle's address lets topographic guidance wire
  // it to that muscle (the mouth cells to Eat, the pain cell to Run).
  const TOUCH = [
    { key: 'contactL', word: 'Touch on its left', tag: [0.10, 0.92], pos: [0.06, 0.40] },
    { key: 'contactR', word: 'Touch on its right', tag: [0.90, 0.92], pos: [0.94, 0.40] },
    { key: 'mouthL', word: 'Something at its mouth (left)', tag: [0.50, 0.30], pos: [0.30, 0.30] },
    { key: 'mouthR', word: 'Something at its mouth (right)', tag: [0.50, 0.30], pos: [0.70, 0.30] },
    { key: 'lips', word: 'Water at its lips', tag: [0.50, 0.12], pos: [0.50, 0.26] },
    { key: 'back', word: 'Touch on its back', tag: [0.50, 0.86], pos: [0.50, 0.36] },
    { key: 'feet', word: 'Ground under its feet', tag: [0.30, 0.97], pos: [0.50, 0.97] },
    { key: 'pain', word: 'Pain', tag: [0.20, 0.70], pos: [0.44, 0.38] },
    { key: 'gentle', word: 'Gentle touch', tag: [0.62, 0.90], pos: [0.56, 0.38] },
    { key: 'falling', word: 'Falling', tag: [0.80, 0.97], pos: [0.62, 0.97] },
    { key: 'inWater', word: 'In water', tag: [0.97, 0.97], pos: [0.38, 0.97] }
  ];
  const TASTES = [
    { key: 'sweet', word: 'Tastes sweet', tag: [0.50, 0.30] }, { key: 'starch', word: 'Tastes starchy', tag: [0.50, 0.30] },
    { key: 'savory', word: 'Tastes savoury', tag: [0.50, 0.30] }, { key: 'fat', word: 'Tastes fatty', tag: [0.50, 0.30] },
    { key: 'bitter', word: 'Tastes bitter', tag: [0.50, 0.96] }, { key: 'water', word: 'Tastes water', tag: [0.50, 0.30] }
  ];
  // The first Needs cells share an address with one muscle each (same order as MOTORS); the rest
  // address nothing in particular
  const NEED_TAGS = [
    ...MOTORS.map(m => m.tag),
    [0.15, 0.04], [0.38, 0.04], [0.62, 0.04], [0.85, 0.04], [0.15, 0.97], [0.38, 0.97], [0.62, 0.97], [0.85, 0.97], [0.5, 0.97]
  ].slice(0, N_NEEDS);
  // Feelings cells: 0 releases the reward chemical, 1 the stress chemical. Cell 2's address matches
  // the alarm odour's, so a topographic smell gene can make alarm scent excite it.
  const FEELING_TAGS = [[0.2, 0.9], [0.9, 0.2], [0.5, (SCENTS.findIndex(s => s.key === 'alarm') + 0.5) / SCENTS.length],
    [0.3, 0.5], [0.7, 0.5], [0.5, 0.15], [0.1, 0.3], [0.9, 0.7]];

  // The lookup-set key of the synapse src -> dst (neuron counts stay far below 4096)
  const synapseKey = (src, dst) => src * 4096 + dst;

  const ring = (cx, cy, r, i, n) => [cx + r * Math.cos(i * 2 * Math.PI / n), cy + r * Math.sin(i * 2 * Math.PI / n)];
  const mirror = (x, right) => (right ? 1.0 - x : x);

  class Brain {
    constructor(traits) {
      this.traits = traits;
      this.tickCount = 0;
      this.sproutedCount = 0;
      this.prunedCount = 0;
      this.spikesThisTick = 0;
      this.novelty = 0;
      // The outcome each modulatory channel predicts (reward for DA, punishment for ST); the creature
      // sets it from its biochemistry before each tick
      this.outcome = new Float32Array(2);
      this.grownGenes = new Set(); // Guidance genes that have already grown their tracts
      this.buildNeurons();
      this.allocate();
      this.initNeurons();
      this.growTracts(traits.axonGuidance, true);
    }

    // ---------- Anatomy ----------
    buildNeurons() {
      const T = this.traits, A = T.anatomy;
      const neurons = this.neurons = [];
      const lobes = this.lobes = {};
      const add = (lobe, id, label, tag, pos, meta = {}) => {
        const n = { index: neurons.length, id, label, lobe, parentLobe: lobe, tag, pos, meta, copyOf: null };
        neurons.push(n);
        (lobes[lobe] = lobes[lobe] || []).push(n.index);
        return n;
      };
      const sideX = s => (s === 'L' ? 0.1 : 0.9);

      // Sight: two eyes' fields (left, right) × low/high × features; a map across the front
      SIDES.forEach((side, s) => BANDS.forEach((band, b) => VISION_FEATURES.forEach((f, fi) => {
        const x = s ? 0.60 + fi * 0.045 : 0.40 - fi * 0.045;
        add('sight', `see_${side}_${band}_${f.key}`, `See ${f.key} ${side} ${band}`,
          [sideX(side), (fi + 0.5) / VISION_FEATURES.length, 0.2 + b * 0.04], [x, 0.05 + b * 0.05],
          { kind: 'sight', side, band, feature: f.key });
      })));
      // Smell: one bulb per antenna, each on its own side
      SIDES.forEach((side, s) => SCENTS.forEach((sc, o) => {
        const x = s ? 0.60 + (o % 5) * 0.05 : 0.40 - (o % 5) * 0.05;
        add('smell', `smell_${side}_${sc.key}`, `Smell ${sc.key} ${side}`,
          [sideX(side), (o + 0.5) / SCENTS.length, 0.4], [x, 0.16 + Math.floor(o / 5) * 0.04],
          { kind: 'smell', side, odour: sc.key });
      }));
      HEARING.forEach(([side, pitch], k) => add('hearing', `hear_${side}_${pitch}`, `Hear ${pitch} ${side}`,
        [sideX(side), pitch === 'low' ? 0.35 : 0.65, 0.3], [side === 'L' ? 0.08 : 0.92, 0.26 + (k % 2) * 0.04],
        { kind: 'hearing', side, pitch }));
      TOUCH.forEach(t => add('touch', `touch_${t.key}`, t.word, [...t.tag, 0.6], t.pos, { kind: 'touch', key: t.key }));
      TASTES.forEach((t, k) => add('taste', `taste_${t.key}`, t.word, [...t.tag, 0.5], [0.40 + k * 0.04, 0.24], { kind: 'taste', key: t.key }));
      for (let k = 0; k < N_NEEDS; k++) {
        add('needs', `need_${k}`, `Needs cell ${k + 1}`, [...NEED_TAGS[k], 0.8], ring(0.5, 0.74, 0.05, k, N_NEEDS), { kind: 'need', index: k });
      }
      for (let k = 0; k < N_LIMBIC; k++) {
        add('feelings', `feel_${k}`, k === 0 ? 'Reward cell' : k === 1 ? 'Punishment cell' : `Feelings cell ${k + 1}`,
          [...FEELING_TAGS[k], 0.1], ring(0.5, 0.62, 0.04, k, N_LIMBIC), { kind: 'feeling', index: k });
      }

      // Anatomy genes grow or shrink the interior regions (always an even count for paired ones)
      const countFor = (lobe, base, paired) => {
        const c = Math.round(base * (A[lobe] ? A[lobe].count : 1.0));
        return paired ? Math.max(4, c - (c % 2)) : Math.max(3, c);
      };
      const general = (lobe, prefix, count, cols, z, posFor) => {
        for (let i = 0; i < count; i++) {
          add(lobe, `${prefix}_${i}`, `${prefix} #${i + 1}`, [(i % cols) / cols, Math.floor(i / cols) / Math.ceil(count / cols), z], posFor(i, count), { kind: 'cell', index: i });
        }
      };
      general('cortex', 'cortex', countFor('cortex', 30, true), 10, 0.5, (i, n) => {
        const half = n / 2, k = i % half;
        return [mirror(0.14 + (k % 5) * 0.065, i >= half), 0.33 + Math.floor(k / 5) * 0.055];
      });
      general('side', 'side', countFor('side', 24, true), 8, 0.7, (i, n) => {
        const half = n / 2, k = i % half, t = k / (half - 1);
        return [mirror(0.20 + 0.06 * Math.sin(t * Math.PI), i >= half), 0.50 + t * 0.22];
      });
      general('central', 'central', countFor('central', 20, false), 5, 0.6, i => [0.36 + (i % 5) * 0.07, 0.46 + Math.floor(i / 5) * 0.035]);
      MOTORS.forEach(m => add('motor', `motor_${m.key}`, m.word, [...m.tag, 0.9], m.pos, { kind: 'motor', key: m.key }));
      general('stem', 'stem', countFor('stem', 16, false), 4, 0.8, (i, n) => [0.2 + i * (0.6 / Math.max(1, n - 1)), 0.975]);

      // Anatomy genes reshape the body plan: each region can shift forward/back, widen or narrow
      // (mirrored, so the brain stays bilateral) and stretch front-to-back about its centre.
      for (const lobe of LOBE_ORDER) {
        const g = A[lobe];
        if (!g) continue;
        const members = lobes[lobe].map(i => neurons[i]);
        const cy = mean(members.map(n => n.pos[1]));
        for (const n of members) {
          n.pos = [clamp(0.5 + (n.pos[0] - 0.5) * g.lateral, 0.01, 0.99), clamp(cy + g.shift + (n.pos[1] - cy) * g.size, 0.005, 0.995)];
        }
      }

      // Region duplications: each copy keeps its parent's layout and chemistry (shifted), sits at a new
      // depth, and is a central (non-sensory) region. Its parent's guidance genes also grow its axons.
      this.duplicatesOf = {};
      this.duplicateLobes = [];
      T.duplications.forEach((d, k) => {
        const parentId = LOBE_ORDER[d.sourceLobeIdx];
        const lobeId = `dup${k}_${parentId}`;
        const parent = lobes[parentId].map(i => neurons[i]);
        const cy = mean(parent.map(n => n.pos[1]));
        for (const src of parent) {
          const tag = [src.tag[0], src.tag[1], clamp(src.tag[2] + d.chemShift, 0, 1)];
          const pos = [clamp(0.5 + (src.pos[0] - 0.5) * d.lateral, 0.01, 0.99), clamp(d.depth + (src.pos[1] - cy), 0.005, 0.995)];
          const n = add(lobeId, `${lobeId}_${src.id}`, `Copy: ${src.label}`, tag, pos, src.meta);
          n.copyOf = src.index;
          n.parentLobe = parentId;
          n.copyWeight = d.inputWeight;
        }
        (this.duplicatesOf[parentId] = this.duplicatesOf[parentId] || []).push(lobeId);
        this.duplicateLobes.push(lobeId);
      });
      this.N = neurons.length;
    }

    allocate() {
      const N = this.N, S = LIMITS.SYNAPSE_CAP;
      const f32 = () => new Float32Array(N);
      this.v = f32(); this.vShow = f32(); this.thr = f32(); this.thrBase = f32(); this.tau = f32();
      this.bias = f32(); this.adapt = f32(); this.adaptInc = f32(); this.adaptKeep = f32(); this.rate = f32(); this.targetRate = f32();
      this.thrDrop = f32(); // How far homeostasis may lower each threshold
      this.habit = f32(); this.tol = f32(); this.lDA = f32(); this.lST = f32(); this.lNO = f32(); this.signal = f32();
      this.cueDrive = f32(); this.prediction = f32(); this.tdError = f32();
      this.refr = new Uint8Array(N); this.refrPeriod = new Uint8Array(N);
      this.hist = new Uint32Array(N);
      this.isSensory = new Uint8Array(N); this.homeo = new Uint8Array(N); this.fast = new Uint8Array(N);
      this.modulator = new Int8Array(N).fill(-1);
      this.cell = new Int32Array(N);
      this.inbox = new Float32Array(N * SLOTS);
      // Synapses
      this.S = 0;
      this.sSrc = new Int32Array(S); this.sDst = new Int32Array(S); this.sW = new Float32Array(S);
      this.sDelay = new Uint8Array(S); this.sElig = new Float32Array(S); this.sCue = new Float32Array(S);
      this.sIdle = new Uint16Array(S); this.sBorn = new Int32Array(S); this.sFlags = new Uint8Array(S);
      this.keys = new Set();
      this.adjacencyDirty = true;
      // Chemistry
      this.chem = CHEM_CHANNELS.map(() => new Float32Array(CHEM_SIZE * CHEM_SIZE));
      this.chemScratch = new Float32Array(CHEM_SIZE * CHEM_SIZE);
    }

    initNeurons() {
      const T = this.traits;
      const nc = T.neurochem;
      this.chemRate = CHEM_CHANNELS.map(c => 0.10 + 0.14 * nc[c]);
      this.chemKeep = CHEM_CHANNELS.map(c => 1.0 - (0.20 - 0.18 * nc[c]));
      this.senseIndices = [];
      for (const n of this.neurons) {
        const i = n.index;
        const sensory = SENSORY_LOBES.includes(n.lobe);
        this.isSensory[i] = sensory ? 1 : 0;
        this.v[i] = V_REST; this.vShow[i] = V_REST;
        this.rate[i] = 0.12; this.targetRate[i] = 0.12;
        this.cell[i] = clamp(Math.floor(n.pos[1] * CHEM_SIZE), 0, CHEM_SIZE - 1) * CHEM_SIZE + clamp(Math.floor(n.pos[0] * CHEM_SIZE), 0, CHEM_SIZE - 1);
        this.adaptKeep[i] = 0.95;
        if (sensory) {
          this.thr[i] = T.baseThreshold - 3.0;
          this.tau[i] = 0.78;
          this.fast[i] = 1;
          // Receptors adapt slowly to a constant stimulus, so what is unchanging fades and what is new stands out
          if (n.lobe !== 'needs') { this.adaptInc[i] = 0.12; this.adaptKeep[i] = 0.996; }
          if (n.lobe !== 'needs') this.senseIndices.push(i);
        } else {
          // The genome's membrane gene applies to every central neuron
          this.thr[i] = T.baseThreshold;
          this.tau[i] = n.lobe === 'motor' ? 0.85 : T.tauLeak;
          this.homeo[i] = 1;
          this.adaptInc[i] = n.lobe === 'motor' ? 0.25 : 0.15;
          // Muscles are mostly quiet unless driven: a low set point keeps them excitable (so the
          // creature fidgets, explores and babbles) without acting all the time
          if (n.lobe === 'motor') this.targetRate[i] = 0.004;
          // …and disuse makes a muscle only slightly twitchier, so a weak input alone never becomes an action
          this.thrDrop[i] = n.lobe === 'motor' ? 3 : 14;
          this.refrPeriod[i] = clamp(T.refractoryTicks, 1, 3);
          this.fast[i] = n.lobe === 'motor' ? 1 : 0;
        }
        this.thrBase[i] = this.thr[i];
      }
      // Modulatory cells: the first two feelings cells release reward / stress chemical at their
      // axon terminals. They fire phasically, so they don't tune toward tonic firing, and like real
      // dopamine cells they adapt quickly and fire mainly at increases.
      const [rewardCell, punishCell] = this.lobes.feelings;
      this.modulator[rewardCell] = BCHEM.DA;
      this.modulator[punishCell] = BCHEM.ST;
      for (const i of [rewardCell, punishCell]) { this.homeo[i] = 0; this.adaptInc[i] = 0.8; }
      this.modulatorCells = [rewardCell, punishCell];

      // Pacemaker genes give a whole lobe a steady depolarizing current (spontaneous activity),
      // and raise the lobe's homeostatic set point so homeostasis doesn't simply cancel it
      this.applyPacemakers(T.pacemakers);
    }

    applyPacemakers(pacemakers) {
      for (const pm of pacemakers) {
        for (const i of this.lobes[LOBE_ORDER[pm.lobeIdx]]) {
          this.bias[i] = Math.min(3.0, this.bias[i] + pm.bias);
          this.targetRate[i] = Math.min(0.35, this.targetRate[i] * (1 + pm.bias * 0.5));
        }
      }
    }

    // ---------- Synapses: the only way they are made or removed ----------
    addSynapse(src, dst, weight, { sprouted = false, cap = LIMITS.SYNAPSE_CAP, conduction = 0.12 } = {}) {
      const key = synapseKey(src, dst);
      if (this.keys.has(key) || this.S >= cap || src === dst) return -1;
      const a = this.neurons[src].pos, b = this.neurons[dst].pos;
      const s = this.S++;
      this.sSrc[s] = src; this.sDst[s] = dst; this.sW[s] = weight;
      this.sDelay[s] = clamp(1 + Math.round(Math.hypot(a[0] - b[0], a[1] - b[1]) / conduction), 1, MAX_DELAY);
      this.sElig[s] = 0; this.sCue[s] = 0; this.sIdle[s] = 0; this.sBorn[s] = this.tickCount;
      const lobe = this.neurons[src].lobe;
      this.sFlags[s] = (sprouted ? SPROUTED : 0) | (weight < 0 ? INHIBITORY : 0) | (this.modulator[dst] >= 0 && (lobe === 'sight' || lobe === 'smell') ? CUE : 0);
      this.keys.add(key);
      this.adjacencyDirty = true;
      return s;
    }

    hasSynapse(src, dst) { return this.keys.has(synapseKey(src, dst)); }

    // Remove synapse s by moving the last synapse into its place
    removeSynapse(s) {
      this.keys.delete(synapseKey(this.sSrc[s], this.sDst[s]));
      const last = --this.S;
      if (s !== last) {
        this.sSrc[s] = this.sSrc[last]; this.sDst[s] = this.sDst[last]; this.sW[s] = this.sW[last];
        this.sDelay[s] = this.sDelay[last]; this.sElig[s] = this.sElig[last]; this.sCue[s] = this.sCue[last];
        this.sIdle[s] = this.sIdle[last]; this.sBorn[s] = this.sBorn[last]; this.sFlags[s] = this.sFlags[last];
      }
      this.adjacencyDirty = true;
    }

    // Outgoing synapses per neuron (compressed rows), and the list of cue synapses
    rebuildAdjacency() {
      const N = this.N, S = this.S;
      const start = new Int32Array(N + 1);
      for (let s = 0; s < S; s++) start[this.sSrc[s] + 1]++;
      for (let i = 0; i < N; i++) start[i + 1] += start[i];
      const fill = start.slice(0, N);
      const list = new Int32Array(S);
      const cues = [];
      for (let s = 0; s < S; s++) {
        list[fill[this.sSrc[s]]++] = s;
        if (this.sFlags[s] & CUE) cues.push(s);
      }
      this.outStart = start;
      this.outList = list;
      this.cueList = Int32Array.from(cues);
      this.adjacencyDirty = false;
    }

    outgoing(i) {
      if (this.adjacencyDirty) this.rebuildAdjacency();
      return Array.from(this.outList.subarray(this.outStart[i], this.outStart[i + 1]));
    }

    incoming(i) {
      const out = [];
      for (let s = 0; s < this.S; s++) if (this.sDst[s] === i) out.push(s);
      return out;
    }

    // ---------- Growing the wiring ----------
    // PURE BOTTOM-UP WIRING. Each guidance gene sends the axons of one lobe looking for a chemical
    // receptor match. The target may be fixed, or relative to each source cell's own tag (so every
    // cell finds its own partner: a topographic map), and axons can only grow so far: a good match
    // within reach almost always connects, and beyond it the growth cones soon give out. Sensory cells are driven by the body and world, so central axons
    // never target them. Candidates from all genes compete fairly for the budget, leaving headroom
    // for activity-dependent sprouting. Genes that switch on later in life grow their tracts then.
    growTracts(rules, atBirth = false) {
      const fresh = rules.filter(r => !this.grownGenes.has(r.gene));
      if (!fresh.length && !atBirth) return;
      const budget = atBirth ? LIMITS.INNATE_BUDGET : LIMITS.SYNAPSE_CAP;
      const neurons = this.neurons;
      const central = neurons.filter(n => !this.isSensory[n.index]);
      const candidates = [];

      // A fresh duplicate is wired in register: each original neuron feeds its own copy
      if (atBirth) {
        for (const lobe of this.duplicateLobes) {
          for (const i of this.lobes[lobe]) this.addSynapse(neurons[i].copyOf, i, neurons[i].copyWeight, { cap: budget, conduction: 0.3 });
        }
      }

      for (const rule of fresh) {
        this.grownGenes.add(rule.gene);
        const src = rule.source;
        const parentId = LOBE_ORDER[src.lobe];
        // Duplicated regions inherit their parent's developmental program
        const lobes = [parentId, ...(this.duplicatesOf[parentId] || [])];
        const r = rule.affinityRadius;
        for (const lobe of lobes) {
          for (const si of this.lobes[lobe]) {
            const s = neurons[si];
            const tx = src.relX ? (src.mirrorX ? 1 - s.tag[0] : s.tag[0]) + rule.target[0] - 0.5 : rule.target[0];
            const ty = src.relY ? s.tag[1] + rule.target[1] - 0.5 : rule.target[1];
            const tz = rule.target[2];
            for (const d of central) {
              if (d === s) continue;
              const chemDist = Math.hypot(d.tag[0] - tx, d.tag[1] - ty, d.tag[2] - tz);
              if (chemDist >= r) continue;
              const chemMatch = (1.0 - chemDist / r) ** 2;
              const dist = Math.hypot(s.pos[0] - d.pos[0], s.pos[1] - d.pos[1]);
              if (Evo.chance(chemMatch * Math.exp(-((dist / rule.reach) ** 4)))) {
                candidates.push([si, d.index, (0.3 + Evo.random() * 0.2) * rule.weightSign, rule.conduction]);
              }
            }
          }
        }
      }
      for (const [s, d, w, cond] of Evo.shuffle(candidates)) this.addSynapse(s, d, w, { cap: budget, conduction: cond });

      // Local background wiring (at birth): neighbours are likelier to connect (unmyelinated, slow)
      if (atBirth) {
        for (const s of neurons) {
          for (const d of central) {
            if (s === d) continue;
            const dist = Math.hypot(s.pos[0] - d.pos[0], s.pos[1] - d.pos[1]);
            if (Evo.chance(0.03 * Math.exp(-((dist / 0.18) ** 2)))) {
              this.addSynapse(s.index, d.index, (Evo.random() - 0.5) * 0.25, { cap: budget + 150, conduction: 0.10 });
            }
          }
        }
      }
      this.rebuildAdjacency();
    }

    // Use it or lose it, and grow where activity is
    runMorphogenesis() {
      const T = this.traits;
      // 1. Pruning: an idle weak sprout dies, and so does one that learning never strengthened
      //    within its trial period. Innate tracts are protected.
      for (let s = this.S - 1; s >= 0; s--) {
        if (!(this.sFlags[s] & SPROUTED)) continue;
        const w = Math.abs(this.sW[s]);
        if ((w < T.pruningRate && this.sIdle[s] > 800) || (this.tickCount - this.sBorn[s] > 1500 && w < 0.14)) {
          this.removeSynapse(s);
          this.prunedCount++;
        }
      }
      // 2. Sprouting: an active neuron grows a short collateral toward its most depolarized neighbour
      let best = -1, bestDst = -1, bestAffinity = 0;
      for (const src of this.neurons) {
        const si = src.index;
        const spiked = this.hist[si] & 1;
        if (!spiked && this.rate[si] <= 0.16) continue;
        for (const dst of this.neurons) {
          const di = dst.index;
          if (this.isSensory[di] || di === si) continue;
          const d = Math.hypot(src.pos[0] - dst.pos[0], src.pos[1] - dst.pos[1]);
          if (d > 0.3) continue;
          const depol = this.vShow[di] - V_REST;
          if (depol <= T.sproutingThreshold || this.hasSynapse(si, di)) continue;
          const affinity = depol * (spiked ? 2.0 : 1.0) * Math.exp(-((d / 0.2) ** 2));
          if (affinity > bestAffinity) { bestAffinity = affinity; best = si; bestDst = di; }
        }
      }
      this.scaleSynapses();
      if (best >= 0) {
        // Nascent spines are weak; reward-driven learning decides whether they grow up
        const s = this.addSynapse(best, bestDst, (0.05 + Evo.random() * 0.06) * (Evo.chance(0.7) ? 1 : -1), { sprouted: true, conduction: 0.10 });
        if (s >= 0) { this.sElig[s] = 0.35; this.sproutedCount++; }
      }
      if (this.adjacencyDirty) this.rebuildAdjacency();
    }

    // Homeostatic synaptic scaling: a neuron still firing far too much once its threshold is as high
    // as it can go has its excitatory inputs scaled down; one that has fallen silent, scaled up.
    // This keeps learning from running away into seizures or silence.
    scaleSynapses() {
      const { sDst, sW, rate, targetRate, thr, thrBase, isSensory, modulator } = this;
      for (let s = 0; s < this.S; s++) {
        const d = sDst[s];
        if (isSensory[d] || modulator[d] >= 0 || sW[s] <= 0) continue;
        if (rate[d] > targetRate[d] * 4 + 0.05 && thr[d] >= thrBase[d] + 9.5) sW[s] *= 0.95;
        else if (rate[d] < targetRate[d] * 0.2 && sW[s] < 0.45) sW[s] *= 1.01;
      }
    }

    // ---------- One tick ----------
    // drive: Float32Array (one per neuron) of external current: senses, needs, dreams.
    // opts: { noise, arousal, canFire }. Returns the number of spikes.
    tick(drive, opts) {
      if (this.adjacencyDirty) this.rebuildAdjacency();
      const T = this.traits;
      const now = ++this.tickCount;
      const slot = now % SLOTS;
      const N = this.N;
      const { v, vShow, thr, thrBase, thrDrop, tau, bias, adapt, adaptInc, adaptKeep, refr, refrPeriod, hist, rate, targetRate, inbox, homeo, fast, isSensory } = this;
      const noise = opts.noise, arousal = opts.arousal, canFire = opts.canFire;

      // 1. Every neuron integrates what arrived this tick. With conduction delays there is no
      // hand-ordered pipeline: where and how far activity travels comes from the wiring itself.
      let spikes = 0;
      const ALPHA = 0.012;
      for (let i = 0; i < N; i++) {
        const k = i * SLOTS + slot;
        let I = inbox[k] + drive[i];
        inbox[k] = 0;
        adapt[i] *= adaptKeep[i];
        let fired = 0;
        if (refr[i] > 0) {
          refr[i]--;
          v[i] = V_RESET;
          vShow[i] = V_RESET;
        } else {
          I += (Evo.random() - 0.5) * noise + (isSensory[i] ? 0 : arousal);
          const nv = V_REST + (v[i] - V_REST) * tau[i] + I + bias[i] - adapt[i];
          if (nv >= thr[i] && canFire) {
            fired = 1;
            spikes++;
            vShow[i] = 25;
            v[i] = V_RESET;
            adapt[i] += adaptInc[i];
            refr[i] = fast[i] ? 1 : refrPeriod[i];
          } else {
            v[i] = nv < -90 ? -90 : nv;
            vShow[i] = v[i];
          }
        }
        hist[i] = ((hist[i] << 1) | fired) >>> 0;
        rate[i] += ALPHA * (fired - rate[i]);
        // Intrinsic homeostatic plasticity: overactive neurons get harder to fire, silent ones easier
        if (homeo[i]) {
          let t = thr[i] + 0.03 * (rate[i] - targetRate[i]);
          const lo = thrBase[i] - thrDrop[i], hi = thrBase[i] + 10;
          t = t < lo ? lo : t > hi ? hi : t;
          thr[i] = t < V_REST + 2 ? V_REST + 2 : t;
        }
      }
      this.spikesThisTick = spikes;

      // Novelty: senses habituate to what they keep reporting, so a spike from a usually quiet
      // neuron is surprising. The body reads the lack of surprise as boredom.
      let surprise = 0;
      const habRate = T.habituationRate;
      for (const i of this.senseIndices) {
        const fired = hist[i] & 1;
        if (fired) surprise += Math.max(0, 1.0 - this.habit[i] * 5.0);
        this.habit[i] += (fired - this.habit[i]) * habRate;
      }
      this.novelty = Math.min(1.0, (surprise / this.senseIndices.length) * T.noveltyGain);

      // 2. New spikes depart along their axons
      const { sDst, sW, sDelay, outStart, outList } = this;
      for (let i = 0; i < N; i++) {
        if (!(hist[i] & 1)) continue;
        for (let k = outStart[i], end = outStart[i + 1]; k < end; k++) {
          const s = outList[k];
          inbox[sDst[s] * SLOTS + (now + sDelay[s]) % SLOTS] += sW[s] * SYNAPTIC_GAIN;
        }
      }

      this.volumeTransmission();
      this.learn();
      return spikes;
    }

    // Every firing neuron puffs a little NO gas where it sits. The reward and stress cells release
    // their chemical at the ends of their axons, once each spike has arrived (bit `delay` of the
    // firing history), so WHERE learning happens depends on where those axons grew: a broad
    // projection spreads a fixed release thinly, a focused one teaches a small area strongly.
    volumeTransmission() {
      const { hist, cell, chem, sDst, sDelay, outStart, outList } = this;
      const NO = chem[BCHEM.NO];
      for (let i = 0; i < this.N; i++) {
        if (hist[i] & 1) NO[cell[i]] = Math.min(4, NO[cell[i]] + 0.06);
      }
      for (const m of this.modulatorCells) {
        const grid = chem[this.modulator[m]];
        const n = outStart[m + 1] - outStart[m];
        // Some release happens from the cell's own dendrites (as real dopamine cells do)
        if (hist[m] & 1) grid[cell[m]] = Math.min(4, grid[cell[m]] + (n === 0 ? 1.0 : 0.3));
        for (let k = outStart[m]; k < outStart[m + 1]; k++) {
          const s = outList[k];
          if ((hist[m] >>> sDelay[s]) & 1) { const c = cell[sDst[s]]; grid[c] = Math.min(4, grid[c] + 0.7 / n); }
        }
      }
      for (let ch = 0; ch < 3; ch++) Evo.diffuse(chem[ch], this.chemScratch, CHEM_SIZE, CHEM_SIZE, this.chemRate[ch], this.chemKeep[ch], 0.0005);
    }

    learn() {
      const T = this.traits;
      const { hist, v, cell, chem, lDA, lST, lNO, tol, signal, modulator, rate, sSrc, sDst, sW, sDelay, sElig, sCue, sIdle, sFlags, S } = this;
      const DA = chem[BCHEM.DA], ST = chem[BCHEM.ST], NO = chem[BCHEM.NO];

      // Each neuron reads the chemistry bathing it; receptors desensitize under sustained exposure
      // (tolerance), which slows, though does not fully prevent, a brain rewarding itself.
      // Three-factor learning signal: reward minus stress chemical, scaled by the sensitivity genes.
      const CHEM_GAIN = 12.0;
      for (let i = 0; i < this.N; i++) {
        const c = cell[i];
        lDA[i] = DA[c]; lST[i] = ST[c]; lNO[i] = NO[c];
        tol[i] += ((lDA[i] + lST[i]) - tol[i]) * 0.003;
        signal[i] = CHEM_GAIN * (lDA[i] * T.joyGain - lST[i] * T.stressGain) / (1.0 + 2.0 * tol[i]);
      }

      // Temporal-difference learning for cues. Each modulatory cell's prediction V is what its sensory
      // cues are currently signalling; the error is outcome now + (discounted) new prediction - old
      // prediction. So a smell that grows stronger on the way to food is good news in itself, a meal
      // that was fully expected teaches little, and a cue that stops paying off fades.
      const GAMMA = 0.98;
      const cues = this.cueList;
      for (const m of this.modulatorCells) {
        let cue = 0;
        for (let k = 0; k < cues.length; k++) {
          const s = cues[k];
          if (sDst[s] === m && ((hist[sSrc[s]] >>> sDelay[s]) & 1)) cue += sW[s];
        }
        // Smooth like a membrane: sensory cells pulse every other tick, and an unsmoothed prediction
        // would flicker, producing alternating errors that cancel out
        this.cueDrive[m] = this.cueDrive[m] * 0.8 + cue * 0.2;
        const V = clamp(this.cueDrive[m] * 2.0, 0, 1.5);
        this.tdError[m] = this.outcome[modulator[m]] + GAMMA * V - this.prediction[m];
        this.prediction[m] = V;
      }
      for (let k = 0; k < cues.length; k++) {
        const s = cues[k];
        sCue[s] = sCue[s] * T.traceDecay + ((hist[sSrc[s]] >>> sDelay[s]) & 1);
        sW[s] = softBounded(sW[s], 0.004 * sCue[s] * this.tdError[sDst[s]], this.sFlags[s] & INHIBITORY);
      }

      // Three-factor plasticity with LOCAL modulation. NO spillover lets synapses from recently
      // active neighbours share in the credit. The modulatory cells' synapses never learn from the
      // chemical they themselves cause (so a brain can't talk itself into reward): sensory cues onto
      // them learn by TD error, above; their other inputs and their outputs stay as the genome built them.
      const eta = T.learningRate * 0.05, decay = T.traceDecay, NO_SPILL = 0.5;
      for (let s = 0; s < S; s++) {
        const src = sSrc[s], dst = sDst[s];
        const pre = (hist[src] >>> sDelay[s]) & 1;
        const post = (hist[dst] & 1) ? 20 : Math.max(0, v[dst] + 70);
        if (pre || post > 5) sIdle[s] = 0; else if (sIdle[s] < 65535) sIdle[s]++;
        let e = sElig[s];
        if (pre && post > 4) e += Math.min(1.5, post * 0.08);
        e *= decay;
        if (e > ELIG_MAX) e = ELIG_MAX; // Traces saturate: steady co-activity doesn't make a synapse hypersensitive
        sElig[s] = e < 0.0001 ? 0 : e;
        if (modulator[dst] >= 0 || modulator[src] >= 0) continue;
        const sig = signal[dst];
        if (sig === 0) continue;
        const r = rate[src] * 5;
        const elig = sElig[s] + NO_SPILL * lNO[dst] * (r < 1 ? r : 1);
        if (elig <= 0.0001) continue;
        sW[s] = softBounded(sW[s], eta * elig * sig, sFlags[s] & INHIBITORY);
      }
    }

    // ---------- Read-outs ----------
    spiked(i) { return (this.hist[i] & 1) === 1; }
    lobe(key) { return this.lobes[key]; }
    motor(key) { return this.hist[this.lobes.motor[MOTORS.findIndex(m => m.key === key)]] & 1; }
  }

  Object.assign(Evo, {
    Brain, BRAIN: { MAX_DELAY, SYNAPTIC_GAIN, WEIGHT_MIN, WEIGHT_MAX, V_REST, SPROUTED, CUE, INHIBITORY, CHEM_SIZE, CHEM_CHANNELS },
    BRAIN_BODY_PLAN: { TOUCH, TASTES, HEARING, NEED_TAGS, FEELING_TAGS }
  });
})(globalThis.Evo);
