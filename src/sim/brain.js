// A recurrent spiking brain: leaky integrate-and-fire neurons with physical axons (conduction
// delays), grown from the genome and shaped by three-factor learning driven by reward prediction errors.
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
  const { LOBE_ORDER, SENSORY_LOBES, VISION_FEATURES, SCENTS, MOTORS, N_NEEDS, N_LIMBIC, LIMITS, NEUROCHEMS, DRIVE_CELL_TAGS } = Evo;

  const MAX_DELAY = 20;              // Longest axonal delay, in ticks (spike history holds 32)
  const SLOTS = MAX_DELAY + 1;       // Ring buffer of future input per neuron
  const SYNAPTIC_GAIN = 20.0;        // mV delivered per unit of synaptic weight
  const WEIGHT_MIN = -1.8, WEIGHT_MAX = 2.0;
  const V_REST = -70, V_RESET = -72;
  const SPROUTED = 1, CUE = 2, INHIBITORY = 4; // Synapse flags. CUE: a sight or smell value synapse (what the UI lists as learned)
  const ELIG_MAX = 2.0;              // Largest eligibility trace a synapse can hold

  // Modulatory channels (Evo.NEUROCHEMS order): 0 reward (DA), 1 stress (ST). The third, NO, once let
  // active neighbours share credit; it is retired, and a Neurochemistry gene that picks it does nothing.
  // brain.chem holds one CHEM_SIZE² image per channel, for display only: the learning signal where
  // each neuron sits (reward, stress; the NO image stays empty).
  const CHEM_CHANNELS = NEUROCHEMS.map(n => n.key);
  const CHEM_SIZE = 20;
  // The brain regrows and prunes its wiring every this many brain ticks
  const MORPHOGENESIS_EVERY = 80;
  const N_MOD = 2;                   // Reward and stress
  const GAMMA = 0.98;                // Temporal-difference discount per tick
  const OUTCOME_MEMORY = 120;        // Ticks over which an outcome becomes the expected baseline
  const ERROR_DRIVE = 60;            // mV a positive prediction error drives into its modulator cell
  const VALUE_RATE = 0.03;           // Step size of value (TD) learning
  const RATE_ALPHA = 0.012;          // Firing-rate smoothing per tick
  const SEIZURE_SHARE = 0.25, SEIZURE_TICKS = 3, SEIZURE_BRAKE = 10; // See tick()
  const LEARN_EVERY = 4;             // Ticks between weight updates (the signal is summed in between)
  const EPISODES = 8;                // Remembered moments of surprise, replayed in sleep

  // Soft bounds: changes shrink as a weight nears its limit, so weights don't pile up at the rails.
  // A synapse keeps the sign it was born with (Dale's law): learning can silence an excitatory
  // synapse, but never turn it inhibitory, so an innate reflex can fade but not invert.
  function softBounded(w, dw, inhibitory) {
    const lo = inhibitory ? WEIGHT_MIN : 0, hi = inhibitory ? 0 : WEIGHT_MAX;
    const room = dw > 0 ? (hi - w) : (w - lo);
    const nw = w + dw * room / (hi - lo);
    return nw < lo ? lo : nw > hi ? hi : nw;
  }

  function hardBounded(w, dw, inhibitory) {
    const nw = w + dw;
    return inhibitory ? (nw < WEIGHT_MIN ? WEIGHT_MIN : nw > 0 ? 0 : nw) : (nw < 0 ? 0 : nw > WEIGHT_MAX ? WEIGHT_MAX : nw);
  }

  // ---- The body plan's fixed neurons ----
  const SIDES = ['L', 'R'];
  const BANDS = ['low', 'high'];
  const HEARING = [['L', 'low'], ['L', 'high'], ['R', 'low'], ['R', 'high']];
  const NF = VISION_FEATURES.length, NO = SCENTS.length;
  const FEATURE_INDEX = Object.fromEntries(VISION_FEATURES.map((f, i) => [f.key, i]));
  const ODOUR_INDEX = Object.fromEntries(SCENTS.map((s, i) => [s.key, i]));
  const SIGHT_CELLS = SIDES.length * BANDS.length * NF, SMELL_CELLS = SIDES.length * NO;
  // Where a cell sits within its sensory lobe. Sight: [left low, left high, right low, right high]
  // × features; smell: [left antenna, right antenna] × odours; hearing: HEARING order. side is
  // 'L' | 'R', band 'low' | 'high', feature and odour a key or an index.
  const sideIndex = side => (side === 'R' ? 1 : 0);
  const sightIndex = (side, band, feature) =>
    (sideIndex(side) * BANDS.length + (band === 'high' ? 1 : 0)) * NF + (typeof feature === 'number' ? feature : FEATURE_INDEX[feature]);
  const smellIndex = (side, odour) => sideIndex(side) * NO + (typeof odour === 'number' ? odour : ODOUR_INDEX[odour]);
  const hearingIndex = (side, pitch) => sideIndex(side) * 2 + (pitch === 'high' ? 1 : 0);
  // …and back: what the sight / smell cell at index k within its lobe reports
  const sightCell = k => ({ side: SIDES[Math.floor(k / (BANDS.length * NF))], band: BANDS[Math.floor(k / NF) % BANDS.length], feature: VISION_FEATURES[k % NF].key });
  const smellCell = k => ({ side: SIDES[Math.floor(k / NO)], odour: SCENTS[k % NO].key });
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
      this.seizures = 0;      // Times the seizure brake has come on (shown in the brain view)
      this.overdrive = 0;     // Consecutive ticks with too many neurons firing
      this.brake = 0;         // mV held back from every central neuron this tick
      this.awake = true;
      this.dream = null;      // The instinct or episode being dreamt: { instinct | episode, t }
      this.episodes = [];     // Up to EPISODES recent surprises: { inputs, motor, value, tick }
      this.replayOutcome = new Float32Array(N_MOD); // Outcome a replayed episode adds this tick
      // The outcome each modulatory channel learns to predict (0 reward, 1 punishment); the creature sets it
      // before each tick from whatever receptor genes drive the first two feelings cells
      this.outcome = new Float32Array(N_MOD);
      this.outcomeMean = new Float32Array(N_MOD); // The expected outcome: only a rise above it counts
      this.value = new Float32Array(N_MOD);       // What the value synapses currently predict
      this.delta = new Float32Array(N_MOD);       // Prediction error this tick
      this.deltaSum = new Float32Array(N_MOD);    // …summed since the last weight update
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

      // Sight: two eyes' fields (left, right) × low/high × features; a map across the front.
      // Cells are added in sightIndex order.
      for (let k = 0; k < SIGHT_CELLS; k++) {
        const { side, band, feature } = sightCell(k), fi = FEATURE_INDEX[feature], b = band === 'high' ? 1 : 0;
        const x = side === 'R' ? 0.60 + fi * 0.045 : 0.40 - fi * 0.045;
        add('sight', `see_${side}_${band}_${feature}`, `See ${feature} ${side} ${band}`,
          [sideX(side), (fi + 0.5) / NF, 0.2 + b * 0.04], [x, 0.05 + b * 0.05],
          { kind: 'sight', side, band, feature });
      }
      // Smell: one bulb per antenna, each on its own side (in smellIndex order)
      for (let k = 0; k < SMELL_CELLS; k++) {
        const { side, odour } = smellCell(k), o = ODOUR_INDEX[odour];
        const x = side === 'R' ? 0.60 + (o % 5) * 0.05 : 0.40 - (o % 5) * 0.05;
        add('smell', `smell_${side}_${odour}`, `Smell ${odour} ${side}`,
          [sideX(side), (o + 0.5) / NO, 0.4], [x, 0.16 + Math.floor(o / 5) * 0.04],
          { kind: 'smell', side, odour });
      }
      HEARING.forEach(([side, pitch], k) => add('hearing', `hear_${side}_${pitch}`, `Hear ${pitch} ${side}`,
        [sideX(side), pitch === 'low' ? 0.35 : 0.65, 0.3], [side === 'L' ? 0.08 : 0.92, 0.26 + (k % 2) * 0.04],
        { kind: 'hearing', side, pitch }));
      TOUCH.forEach(t => add('touch', `touch_${t.key}`, t.word, [...t.tag, 0.6], t.pos, { kind: 'touch', key: t.key }));
      TASTES.forEach((t, k) => add('taste', `taste_${t.key}`, t.word, [...t.tag, 0.5], [0.40 + k * 0.04, 0.24], { kind: 'taste', key: t.key }));
      // Up close: what the thing at the mouth looks like, one cell per vision feature (in feature order)
      VISION_FEATURES.forEach((f, fi) => add('near', `near_${f.key}`, `Up close: ${f.key}`, [0.5, (fi + 0.5) / NF, 0.45], [0.36 + fi * 0.04, 0.29], { kind: 'near', feature: f.key }));
      for (let k = 0; k < N_NEEDS; k++) {
        add('needs', `need_${k}`, `Needs cell ${k + 1}`, [...DRIVE_CELL_TAGS[k], 0.8], ring(0.5, 0.74, 0.05, k, N_NEEDS), { kind: 'need', index: k });
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
      this.lateral = f32(); this.vFired = f32();
      this.posX = f32(); this.posY = f32();
      this.refr = new Uint8Array(N); this.refrPeriod = new Uint8Array(N);
      this.hist = new Uint32Array(N);
      this.isSensory = new Uint8Array(N); this.homeo = new Uint8Array(N); this.fast = new Uint8Array(N);
      this.modulator = new Int8Array(N).fill(-1);
      this.cell = new Int32Array(N);
      this.inbox = new Float32Array(N * SLOTS);
      // Synapses
      this.S = 0;
      this.sSrc = new Int32Array(S); this.sDst = new Int32Array(S); this.sW = new Float32Array(S);
      this.sDelay = new Uint8Array(S); this.sCue = new Float32Array(S); this.sX = new Float32Array(S);
      this.sElig = new Float32Array(S); this.sEligAt = new Int32Array(S); // Eligibility as of tick sEligAt (it decays lazily)
      this.sActive = new Int32Array(S); this.sBorn = new Int32Array(S); this.sFlags = new Uint8Array(S);
      this.keys = new Set();
      this.adjacencyDirty = true;
      // Display images of the learning signal, and each modulator's learning field
      this.chem = CHEM_CHANNELS.map(() => new Float32Array(CHEM_SIZE * CHEM_SIZE));
      this.field = Array.from({ length: N_MOD }, () => new Float32Array(N).fill(1));
      this.fieldKey = new Array(N_MOD).fill('');
      this.valueIn = Array.from({ length: N_MOD }, () => new Int32Array(0));
    }

    initNeurons() {
      const T = this.traits;
      for (const n of this.neurons) {
        const i = n.index;
        const sensory = SENSORY_LOBES.includes(n.lobe);
        this.isSensory[i] = sensory ? 1 : 0;
        this.v[i] = V_REST; this.vShow[i] = V_REST;
        this.rate[i] = 0.12; this.targetRate[i] = 0.12;
        this.posX[i] = n.pos[0]; this.posY[i] = n.pos[1];
        this.cell[i] = clamp(Math.floor(n.pos[1] * CHEM_SIZE), 0, CHEM_SIZE - 1) * CHEM_SIZE + clamp(Math.floor(n.pos[0] * CHEM_SIZE), 0, CHEM_SIZE - 1);
        this.adaptKeep[i] = 0.95;
        if (sensory) {
          this.thr[i] = T.baseThreshold - 3.0;
          this.tau[i] = 0.78;
          this.fast[i] = 1;
          // Receptors adapt slowly to a constant stimulus, so what is unchanging fades and what is new stands out
          if (n.lobe !== 'needs') { this.adaptInc[i] = 0.12; this.adaptKeep[i] = 0.996; }
        } else {
          // The genome's membrane gene applies to every central neuron
          this.thr[i] = T.baseThreshold;
          this.tau[i] = n.lobe === 'motor' ? 0.85 : T.tauLeak;
          this.homeo[i] = 1;
          this.adaptInc[i] = n.lobe === 'motor' ? 0.3 : 0.15; // A muscle that keeps working tires (Lobe dynamics set how slowly)
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
      // Modulatory cells: the first two feelings cells signal reward / punishment prediction errors.
      // They fire only on a positive error (better than expected for reward, worse for punishment),
      // so they don't tune toward tonic firing, and like real dopamine cells they adapt quickly.
      this.modulatorCells = this.lobes.feelings.slice(0, N_MOD);
      this.modulatorCells.forEach((i, c) => { this.modulator[i] = c; this.homeo[i] = 0; this.adaptInc[i] = 0.8; });

      // Pacemaker genes give a whole lobe a steady depolarizing current (spontaneous activity),
      // and raise the lobe's homeostatic set point so homeostasis doesn't simply cancel it
      this.applyPacemakers(T.pacemakers);

      // Lobe dynamics genes: competition and self-sustaining activity within a region (see
      // applyDynamics). Several genes for one region: the last one wins.
      const groups = new Map();
      for (const g of T.lobeDynamics) {
        const parent = LOBE_ORDER[g.lobeIdx];
        const lobe = g.copy ? (this.duplicatesOf[parent] || [])[g.copy - 1] : parent;
        if (!lobe || !this.lobes[lobe]) continue;
        const cells = Int32Array.from(this.lobes[lobe]);
        for (const i of cells) this.adaptKeep[i] = g.adaptKeep;
        groups.set(lobe, { lobe, cells, competition: g.competition, persistence: g.persistence, keep: g.keep,
          activity: new Float32Array(cells.length), drive: new Float32Array(cells.length), fired: new Int32Array(cells.length) });
      }
      this.dynamics = [...groups.values()];
    }

    // Within a region with Lobe dynamics the cells compete: each cell's recent firing (activity)
    // inhibits the others, and cells that cross threshold in the same tick are resolved at once, the
    // strongest first, each later one held back by the competition current of those already firing
    // (fast inhibition, which also stops rivals locking into step). Each spike adds a slowly fading
    // self-sustaining current (persistence, up to 3 spikes' worth). So the most strongly driven cell wins, silences its
    // rivals and keeps going until it tires (adaptation) or a clearly stronger input takes over:
    // decisions persist and attention settles on one thing, from the region's own dynamics.
    // Sets the current for the coming tick.
    applyDynamics() {
      const { hist, lateral, vFired, v, vShow, thr, rate, adapt, adaptInc, refr } = this;
      for (const g of this.dynamics) {
        const { cells, activity, drive, competition, persistence, keep, fired } = g, most = 3 * persistence;
        let n = 0;
        for (let k = 0; k < cells.length; k++) if (hist[cells[k]] & 1) fired[n++] = k;
        if (n > 1) {
          const order = Array.from(fired.subarray(0, n)).sort((a, b) => (vFired[cells[b]] - thr[cells[b]]) - (vFired[cells[a]] - thr[cells[a]]));
          let winners = 0;
          for (const k of order) {
            const i = cells[k], held = vFired[i] - competition * winners;
            if (held >= thr[i]) { winners++; continue; }
            // Held back: undo the spike
            hist[i] = (hist[i] & ~1) >>> 0;
            this.spikesThisTick--;
            rate[i] -= RATE_ALPHA;
            adapt[i] -= adaptInc[i];
            refr[i] = 0;
            v[i] = held;
            vShow[i] = held;
          }
        }
        let pool = 0;
        for (let k = 0; k < cells.length; k++) {
          const f = hist[cells[k]] & 1;
          activity[k] = activity[k] * 0.8 + f;
          const p = drive[k] * keep + persistence * f;
          drive[k] = p > most ? most : p;
          pool += activity[k];
        }
        for (let k = 0; k < cells.length; k++) lateral[cells[k]] = drive[k] - competition * (pool - activity[k]);
      }
    }

    // What the sight copy is attending to: { side, band, feature } of its most active cell, or null
    // when it has no Lobe dynamics or nothing there is active
    attended() {
      const copy = (this.duplicatesOf.sight || [])[0];
      const g = copy && this.dynamics.find(d => d.lobe === copy);
      if (!g) return null;
      let best = -1, most = 0.5;
      for (let k = 0; k < g.cells.length; k++) if (g.activity[k] > most) { most = g.activity[k]; best = k; }
      if (best < 0) return null;
      const { side, band, feature } = this.neurons[g.cells[best]].meta;
      return { side, band, feature };
    }

    // What it has decided to do: the index (into Evo.MOTORS) of the muscle whose cell is winning the
    // Movement region's competition (its Lobe dynamics gene), or -1. Without that gene, the busiest
    // muscle cell.
    decided() {
      const g = this.dynamics.find(d => d.lobe === 'motor');
      let best = -1, most = g ? 0.5 : 0.02;
      if (g) { for (let k = 0; k < g.cells.length; k++) if (g.activity[k] > most) { most = g.activity[k]; best = k; } }
      else this.lobes.motor.forEach((i, k) => { if (this.rate[i] > most) { most = this.rate[i]; best = k; } });
      return best;
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
      this.sElig[s] = 0; this.sEligAt[s] = this.tickCount; this.sCue[s] = 0; this.sX[s] = 0;
      this.sActive[s] = this.tickCount; this.sBorn[s] = this.tickCount;
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
        this.sDelay[s] = this.sDelay[last]; this.sElig[s] = this.sElig[last]; this.sEligAt[s] = this.sEligAt[last];
        this.sCue[s] = this.sCue[last]; this.sX[s] = this.sX[last];
        this.sActive[s] = this.sActive[last]; this.sBorn[s] = this.sBorn[last]; this.sFlags[s] = this.sFlags[last];
      }
      this.adjacencyDirty = true;
    }

    // Outgoing synapses per neuron (compressed rows) that deliver current, and each modulator's value
    // synapses. Every synapse onto a modulator cell is a value synapse: it carries a prediction, not
    // current (a modulator's own spikes predict nothing, so synapses between modulators are silent).
    rebuildAdjacency() {
      const { N, S, sSrc, sDst, modulator } = this;
      const start = new Int32Array(N + 1);
      for (let s = 0; s < S; s++) if (modulator[sDst[s]] < 0) start[sSrc[s] + 1]++;
      for (let i = 0; i < N; i++) start[i + 1] += start[i];
      const fill = start.slice(0, N);
      const list = new Int32Array(start[N]);
      const value = Array.from({ length: N_MOD }, () => []);
      for (let s = 0; s < S; s++) {
        const m = modulator[sDst[s]];
        if (m < 0) list[fill[sSrc[s]]++] = s;
        else if (modulator[sSrc[s]] < 0) value[m].push(s);
      }
      this.outStart = start;
      this.outList = list;
      this.valueIn = value.map(v => Int32Array.from(v));
      // Incoming plastic synapses per neuron: those that deliver current and don't come from a
      // modulator cell (the modulators' own wiring stays as the genome built it)
      const inStart = new Int32Array(N + 1);
      for (let s = 0; s < S; s++) if (modulator[sDst[s]] < 0 && modulator[sSrc[s]] < 0) inStart[sDst[s] + 1]++;
      for (let i = 0; i < N; i++) inStart[i + 1] += inStart[i];
      const inFill = inStart.slice(0, N), inList = new Int32Array(inStart[N]);
      for (let s = 0; s < S; s++) if (modulator[sDst[s]] < 0 && modulator[sSrc[s]] < 0) inList[inFill[sDst[s]]++] = s;
      this.inStart = inStart;
      this.inList = inList;
      this.adjacencyDirty = false;
      this.buildLearningFields();
    }

    // Where each modulator's signal reaches: a Gaussian around each of its axon terminals (and a
    // little around the cell itself), normalised to a peak of 1. So where learning happens depends on
    // where its axons grew: a focused projection teaches a small area, a broad one a large area. The
    // Neurochemistry gene sets how far the signal spreads from a terminal. No terminals: everywhere.
    buildLearningFields() {
      const { N, posX, posY, sDst, outStart, outList } = this;
      this.modulatorCells.forEach((m, c) => {
        const a = outStart[m], b = outStart[m + 1], n = b - a;
        const terminals = Array.from(outList.subarray(a, b), s => sDst[s]);
        const key = terminals.join(',');
        if (key === this.fieldKey[c]) return;
        this.fieldKey[c] = key;
        const F = this.field[c];
        if (!n) { F.fill(1); return; }
        const sigma = 0.05 + 0.2 * this.traits.neurochem[CHEM_CHANNELS[c]], k = 1 / (2 * sigma * sigma);
        let max = 0;
        for (let i = 0; i < N; i++) {
          const x = posX[i], y = posY[i];
          let f = 0.3 * Math.exp(-((x - posX[m]) ** 2 + (y - posY[m]) ** 2) * k);
          for (const t of terminals) f += 0.7 / n * Math.exp(-((x - posX[t]) ** 2 + (y - posY[t]) ** 2) * k);
          F[i] = f;
          if (f > max) max = f;
        }
        for (let i = 0; i < N; i++) F[i] /= max;
      });
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
        const r = rule.affinityRadius, win = rule.srcWindow;
        for (const lobe of lobes) {
          for (const si of this.lobes[lobe]) {
            const s = neurons[si];
            if (win && Math.hypot(s.tag[0] - win.x, s.tag[1] - win.y) > win.r) continue;
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
        if ((w < T.pruningRate && this.tickCount - this.sActive[s] > 800) || (this.tickCount - this.sBorn[s] > 1500 && w < 0.14)) {
          this.removeSynapse(s);
          this.prunedCount++;
        }
      }
      // 2. Sprouting: an active neuron grows a short collateral toward its most depolarized neighbour
      const { hist, rate, vShow, isSensory, posX, posY, N } = this;
      let best = -1, bestDst = -1, bestAffinity = 0;
      for (let si = 0; si < N; si++) {
        const spiked = hist[si] & 1;
        if (!spiked && rate[si] <= 0.16) continue;
        for (let di = 0; di < N; di++) {
          const depol = vShow[di] - V_REST;
          if (depol <= T.sproutingThreshold || isSensory[di] || di === si) continue;
          const dx = posX[si] - posX[di], dy = posY[si] - posY[di], d2 = dx * dx + dy * dy;
          if (d2 > 0.09) continue;
          const affinity = depol * (spiked ? 2.0 : 1.0) * Math.exp(-d2 / 0.04);
          if (affinity > bestAffinity && !this.hasSynapse(si, di)) { bestAffinity = affinity; best = si; bestDst = di; }
        }
      }
      this.scaleSynapses();
      if (best >= 0) {
        // Nascent spines are weak; reward-driven learning decides whether they grow up
        const s = this.addSynapse(best, bestDst, (0.05 + Evo.random() * 0.06) * (Evo.chance(0.7) ? 1 : -1), { sprouted: true, conduction: 0.10 });
        if (s >= 0) { this.sElig[s] = 0.35; this.sproutedCount++; } // (eligible as of now: addSynapse set sEligAt)
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
    // opts: { noise, arousal, canFire, asleep }. Returns the number of spikes.
    tick(drive, opts) {
      if (this.adjacencyDirty) this.rebuildAdjacency();
      const now = ++this.tickCount;
      const slot = now % SLOTS;
      const N = this.N;
      const { v, vShow, thr, thrBase, thrDrop, tau, bias, adapt, adaptInc, adaptKeep, refr, refrPeriod, hist, rate, targetRate, inbox, homeo, fast, isSensory, modulator, lateral } = this;
      const noise = opts.noise, arousal = opts.arousal, canFire = opts.canFire, brake = this.brake;
      this.awake = !opts.asleep;
      if (this.awake) this.dream = null;

      // 1. Every neuron integrates what arrived this tick. With conduction delays there is no
      // hand-ordered pipeline: where and how far activity travels comes from the wiring itself.
      let spikes = 0;
      for (let i = 0; i < N; i++) {
        const k = i * SLOTS + slot;
        // A modulator cell is driven only by its prediction error (see learn), not by the body
        let I = inbox[k] + (modulator[i] < 0 ? drive[i] : 0) + lateral[i];
        inbox[k] = 0;
        adapt[i] *= adaptKeep[i];
        let fired = 0;
        if (refr[i] > 0) {
          refr[i]--;
          v[i] = V_RESET;
          vShow[i] = V_RESET;
        } else {
          I += (Evo.random() - 0.5) * noise + (isSensory[i] ? 0 : arousal - brake);
          const nv = V_REST + (v[i] - V_REST) * tau[i] + I + bias[i] - adapt[i];
          if (nv >= thr[i] && canFire) {
            fired = 1;
            spikes++;
            this.vFired[i] = nv;
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
        rate[i] += RATE_ALPHA * (fired - rate[i]);
        // Intrinsic homeostatic plasticity: overactive neurons get harder to fire, silent ones easier
        if (homeo[i]) {
          let t = thr[i] + 0.03 * (rate[i] - targetRate[i]);
          const lo = thrBase[i] - thrDrop[i], hi = thrBase[i] + 10;
          t = t < lo ? lo : t > hi ? hi : t;
          thr[i] = t < V_REST + 2 ? V_REST + 2 : t;
        }
      }
      this.spikesThisTick = spikes;
      this.applyDynamics();
      // Seizure brake: when more than a quarter of the brain fires for three ticks running (runaway
      // recurrent excitation, e.g. in working memory), every central neuron is held back next tick
      this.overdrive = this.spikesThisTick > SEIZURE_SHARE * N ? this.overdrive + 1 : 0;
      this.brake = this.overdrive >= SEIZURE_TICKS ? SEIZURE_BRAKE : 0;
      if (this.overdrive === SEIZURE_TICKS) this.seizures++;

      // 2. New spikes depart along their axons
      const { sDst, sW, sDelay, sActive, outStart, outList } = this;
      for (let i = 0; i < N; i++) {
        if (!(hist[i] & 1)) continue;
        for (let k = outStart[i], end = outStart[i + 1]; k < end; k++) {
          const s = outList[k];
          inbox[sDst[s] * SLOTS + (now + sDelay[s]) % SLOTS] += sW[s] * SYNAPTIC_GAIN;
          sActive[s] = now;
        }
      }

      this.learn();
      return spikes;
    }

    // A surprise worth dreaming about (value: + good, - bad): the senses active just then and the
    // action under way. At most one every 20 ticks; the oldest is forgotten.
    rememberEpisode(value) {
      const now = this.tickCount, last = this.episodes[this.episodes.length - 1];
      if (last && now - last.tick < 20) return;
      const { rate, isSensory, modulator } = this;
      const inputs = [];
      for (let i = 0; i < this.N; i++) if (isSensory[i] && modulator[i] < 0 && rate[i] > 0.05) inputs.push(i);
      inputs.sort((a, b) => rate[b] - rate[a]);
      let motor = -1, most = 0.01;
      for (const i of this.lobes.motor) if (rate[i] > most) { most = rate[i]; motor = i; }
      this.episodes.push({ inputs: inputs.slice(0, 24), motor, value: Math.sign(value) * Math.min(1, Math.abs(value)), tick: now });
      if (this.episodes.length > EPISODES) this.episodes.shift();
    }

    // Asleep, called before each tick. Now and then a dream starts: half the time (when there are
    // any) a remembered surprise is replayed (its senses, then its action, then its outcome), and
    // otherwise an instinct gene (its inputs, then its action, then its chemical, put into the body's
    // biochemistry). The ordinary learning rule does the rest.
    sleepStep(instincts, chem) {
      if (!this.dream) {
        if (Evo.chance(1 / 150)) {
          if (this.episodes.length && Evo.chance(0.5)) this.dream = { episode: Evo.pick(this.episodes), t: 0 };
          else if (instincts.length) this.dream = { instinct: Evo.pick(instincts), t: 0 };
        }
        return;
      }
      const d = this.dream, t = d.t;
      if (d.episode) {
        const { inputs, motor, value } = d.episode;
        if (t < 20) for (const i of inputs) this.inject(i, 25, 1);
        if (t >= 8 && t < 20 && motor >= 0) this.inject(motor, 40, 1);
        if (t === 18) this.replayOutcome[value > 0 ? 0 : 1] += 0.5 * Math.abs(value);
      } else {
        const inst = d.instinct;
        const neuronOf = (lobeIdx, index) => {
          const lobe = this.lobes[LOBE_ORDER[lobeIdx]];
          return index < lobe.length ? lobe[index] : -1;
        };
        if (t < 30) {
          const a = neuronOf(inst.lobeA, inst.indexA), b = neuronOf(inst.lobeB, inst.indexB);
          if (a >= 0) this.inject(a, 35, 1);
          if (b >= 0) this.inject(b, 35, 1);
        }
        if (t >= 10 && t < 30) this.inject(this.lobes.motor[inst.motor % MOTORS.length], 45, 1);
        if (t === 26 && inst.chem) chem.c[inst.chem] = Math.min(1, chem.c[inst.chem] + inst.amount);
      }
      if (++d.t >= 40) this.dream = null;
    }

    // Deliver mV of input to neuron i, arriving delayTicks ticks from now (1 = on the next tick)
    inject(i, mV, delayTicks = 1) {
      const d = clamp(Math.round(delayTicks), 1, MAX_DELAY);
      this.inbox[i * SLOTS + (this.tickCount + d) % SLOTS] += mV;
    }

    learn() {
      const T = this.traits;
      const { hist, field, sSrc, sW, sDelay, sElig, sEligAt, sCue, sX, sActive, sFlags, N } = this;
      const now = this.tickCount;

      // 1. Reward prediction errors. Each modulator channel's value V is what its value synapses
      // currently predict; its outcome counts only as far as it rises above what has lately been
      // usual (phasic, like a real dopamine response). The error is outcome + discounted new
      // prediction - old prediction: a cue that reliably comes before food is good news in itself, a
      // meal that was fully expected teaches little, and a cue that stops paying off fades.
      const lambda = T.traceDecay;
      if (lambda !== this.decayOf) {
        // Powers of the trace decay, for eligibility that decays lazily
        this.decayOf = lambda;
        this.decayPow = Float32Array.from({ length: 1024 }, (_, k) => lambda ** k);
      }
      const decayPow = this.decayPow;
      for (let c = 0; c < N_MOD; c++) {
        const O = this.outcome[c], mean = this.outcomeMean[c];
        const r = (O > mean ? O - mean : 0) + this.replayOutcome[c];
        this.outcomeMean[c] += (O - mean) / OUTCOME_MEMORY;
        this.replayOutcome[c] = 0;
        const list = this.valueIn[c];
        let V = 0;
        for (let k = 0; k < list.length; k++) {
          const s = list[k];
          const arrived = (hist[sSrc[s]] >>> sDelay[s]) & 3;
          if (arrived & 1) sActive[s] = now;
          sX[s] = sX[s] * 0.7 + (arrived ? 0.3 : 0); // Input in the last two ticks (senses pulse every other tick), smoothed
          V += sW[s] * sX[s];
        }
        if (V < 0) V = 0;
        const d = clamp(r + GAMMA * V - this.value[c], -1, 1);
        this.value[c] = V;
        this.delta[c] = d;
        this.deltaSum[c] += d;
        // TD(λ): the error credits the inputs that made the previous prediction (their trace, before
        // this tick's input joins it), so a cue's own onset doesn't reinforce itself
        for (let k = 0; k < list.length; k++) {
          const s = list[k];
          // Plain (not soft-bounded) steps: TD needs increases and decreases to weigh the same
          if (d !== 0 && sCue[s] > 1e-4) sW[s] = hardBounded(sW[s], VALUE_RATE * d * sCue[s], sFlags[s] & INHIBITORY);
          sCue[s] = sCue[s] * lambda + (1 - lambda) * sX[s]; // A running average of the input
        }
        // A positive error makes the modulator cell fire (on the next tick)
        if (d > 0) this.inject(this.modulatorCells[c], ERROR_DRIVE * d, 1);
        if (this.awake && (d > 0.2 || d < -0.2)) this.rememberEpisode((c === 0 ? 1 : -1) * d);
      }

      // 2. Eligibility, event-driven and causal: when a neuron fires, each input that arrived in the
      // few ticks before (delay-matched: the axon's own delay) becomes eligible. It then decays with
      // the memory gene's half-life, computed lazily from the tick it was last touched.
      const { inStart, inList } = this;
      for (let i = 0; i < N; i++) {
        if (!(hist[i] & 1)) continue;
        for (let k = inStart[i], end = inStart[i + 1]; k < end; k++) {
          const s = inList[k];
          if (!((hist[sSrc[s]] >>> sDelay[s]) & 0xF)) continue;
          const age = now - sEligAt[s];
          const e = sElig[s] * (age < 1024 ? decayPow[age] : 0) + 1;
          sElig[s] = e > ELIG_MAX ? ELIG_MAX : e;
          sEligAt[s] = now;
        }
      }

      // 3. Three-factor plasticity every few ticks. The learning signal at each neuron is each
      // channel's summed error, weighted by that channel's learning field there and by the
      // sensitivity genes: eligibility × signal at the synapse's target. Skipped when nothing happened.
      if (now % LEARN_EVERY) return;
      const sumR = this.deltaSum[0] * T.joyGain, sumP = this.deltaSum[1] * T.stressGain, FR = field[0], FP = field[1];
      this.deltaSum.fill(0);
      // The display images: where the signal is now
      const [imgR, imgP, imgN] = this.chem, cell = this.cell, fade = 0.9 ** LEARN_EVERY;
      for (let k = 0; k < imgR.length; k++) { imgR[k] *= fade; imgP[k] *= fade; imgN[k] *= fade; }
      if (Math.abs(sumR) + Math.abs(sumP) < 1e-3) return;
      const eta = 0.25 * T.learningRate;
      for (let i = 0; i < N; i++) {
        const m = sumR * FR[i] - sumP * FP[i];
        if (m > 0) imgR[cell[i]] += m; else imgP[cell[i]] -= m;
        if (m > -1e-4 && m < 1e-4) continue;
        for (let k = inStart[i], end = inStart[i + 1]; k < end; k++) {
          const s = inList[k];
          if (sElig[s] === 0) continue;
          const age = now - sEligAt[s];
          if (age >= 1024) { sElig[s] = 0; continue; }
          const e = sElig[s] * decayPow[age];
          if (e > 1e-3) sW[s] = softBounded(sW[s], eta * m * e, sFlags[s] & INHIBITORY);
        }
      }
    }
  }

  Object.assign(Evo, {
    Brain, BRAIN: { WEIGHT_MIN, WEIGHT_MAX, V_REST, SPROUTED, CUE, INHIBITORY, CHEM_SIZE, MORPHOGENESIS_EVERY },
    BRAIN_BODY_PLAN: {
      TOUCH, TASTES, SIDES, BANDS, SIGHT_CELLS, SMELL_CELLS,
      sightIndex, smellIndex, hearingIndex, sightCell, smellCell
    }
  });
})(globalThis.Evo);
