// Spiking neurons with physical axons (LIF + conduction delays) in a bilateral brain.
// Every neuron has a position. Brain coordinates: x runs from the organism's left (0) to its
// right (1); y runs from the front of the head (0) to the back (1). A spike travels along the
// axon and arrives after a delay set by axon length and myelination.
(function (Evo) {
  'use strict';
  const { clamp, mean } = Evo.util;
  const { LOBE_ORDER, LOBE_COUNT, SENSORY_LOBES, VISION_CHANNELS, SMELL_CHANNELS, RAYS, NOSES, LIMITS } = Evo;

  const MAX_DELAY = 20;              // Longest axonal delay, in ticks (spike history holds 32)
  const INBOX_SLOTS = MAX_DELAY + 1; // Ring buffer of future input per neuron
  const SYNAPTIC_GAIN = 20.0;        // mV delivered per unit of synaptic weight
  const WEIGHT_MIN = -1.8, WEIGHT_MAX = 2.8;

  // Chemicals diffusing through the brain tissue (volume transmission). Coordinates are brain
  // coordinates in [0, 1]. DA = dopamine-like reward, ST = stress chemical, NO = nitric-oxide-like gas.
  const CHEM_CHANNELS = ['DA', 'ST', 'NO'];
  const CHEM = { DA: 0, ST: 1, NO: 2 };

  class BrainChemistry {
    constructor(neurochem, size = 20) {
      this.size = size;
      this.grid = CHEM_CHANNELS.map(() => new Float32Array(size * size));
      this.next = new Float32Array(size * size);
      // One gene per chemical: "spread" trades lifetime and diffusion together
      this.diffusion = CHEM_CHANNELS.map(c => 0.10 + 0.14 * neurochem[c]);
      this.keep = CHEM_CHANNELS.map(c => 1.0 - (0.20 - 0.18 * neurochem[c]));
    }
    cell(pos) {
      const n = this.size;
      return clamp(Math.floor(pos[1] * n), 0, n - 1) * n + clamp(Math.floor(pos[0] * n), 0, n - 1);
    }
    deposit(ch, pos, amount) {
      const i = this.cell(pos);
      this.grid[ch][i] = Math.min(4.0, this.grid[ch][i] + amount);
    }
    sample(ch, pos) {
      return this.grid[ch][this.cell(pos)];
    }
    step() {
      for (let ch = 0; ch < this.grid.length; ch++) {
        Evo.diffuse(this.grid[ch], this.next, this.size, this.size, this.diffusion[ch], this.keep[ch], 0.0005);
      }
    }
  }

  function brainDistance(a, b) {
    return Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1]);
  }

  // Mean front-to-back position of a group of neurons
  const meanDepth = neurons => mean(neurons.map(n => n.pos[1]));

  // Soft bounds: changes shrink as a weight nears its limit, so weights don't pile up at the rails
  function softBounded(weight, dw) {
    const room = dw > 0 ? (WEIGHT_MAX - weight) : (weight - WEIGHT_MIN);
    return clamp(weight + dw * room / (WEIGHT_MAX - WEIGHT_MIN), WEIGHT_MIN, WEIGHT_MAX);
  }

  class Synapse {
    constructor(source, target, weight, delay, isSprouted, bornTick) {
      this.source = source;
      this.target = target;
      this.weight = weight;
      this.delay = delay;
      this.eligibilityTrace = 0.0;
      this.cueTrace = 0.0;
      this.isSprouted = isSprouted;
      this.idleTicks = 0;
      this.bornTick = bornTick;
    }

    // Did a spike sent `delay` ticks ago arrive at the target this tick?
    get preArrived() {
      return ((this.source.history >>> this.delay) & 1) === 1;
    }

    updateTrace(preArrived, postDepolOrSpike, traceDecay) {
      if (preArrived || postDepolOrSpike > 5.0) this.idleTicks = 0;
      else this.idleTicks++;

      // Hebbian coincidence: a spike arrived and the target genuinely responded (not just noise)
      if (preArrived && postDepolOrSpike > 4.0) {
        this.eligibilityTrace += Math.min(1.5, postDepolOrSpike * 0.08);
      }

      this.eligibilityTrace *= traceDecay;
      if (this.eligibilityTrace < 0.0001) this.eligibilityTrace = 0.0;
    }

    nudge(dw) {
      this.weight = softBounded(this.weight, dw);
    }

    applyPlasticity(neuromodulator, learningRate, spillover = 0.0) {
      const eligibility = this.eligibilityTrace + spillover;
      if (eligibility <= 0.0001 || neuromodulator === 0) return;
      this.nudge(learningRate * eligibility * neuromodulator);
    }
  }

  class LIFNeuron {
    // meta describes what the neuron is for (used for naming and read-outs), e.g.
    // { kind: 'vision', ray: 'farL', channel: 'carb' } or { kind: 'cell', index: 3 }
    constructor(id, label, lobeId, isSensory, receptorTag, pos, meta = {}) {
      this.id = id;
      this.label = label;
      this.lobeId = lobeId;
      this.parentLobe = lobeId;       // For duplicated regions: the region it was copied from
      this.isSensory = isSensory;
      this.receptorTag = receptorTag; // Chemical identity used by axon guidance
      this.pos = pos;                 // Physical position in the brain
      this.meta = meta;
      this.copyOf = null;

      this.vRest = -70.0;
      this.vThreshold = -52.0;
      this.vReset = -72.0;
      this.tau = isSensory ? 0.78 : 0.85;

      this.voltage = this.vRest;
      this.displayVoltage = this.vRest;
      this.spiked = false;
      this.refractoryTicks = 0;
      this.inputCurrent = 0.0;
      this.inbox = new Float32Array(INBOX_SLOTS); // Spikes already travelling toward this neuron
      this.history = 0;                             // Bit k = fired k ticks ago (bit 0 = this tick)

      // Intrinsic properties
      this.bias = 0.0;           // Pacemaker current from the genome
      this.adaptation = 0.0;     // Spike-frequency adaptation (fatigue after firing)
      this.adaptInc = 0.0;
      this.homeostatic = false;  // Central neurons slowly tune their threshold toward a target rate
      this.baseThreshold = this.vThreshold;
      this.refractoryPeriod = 2; // Central neurons: set by the membrane gene

      // Volume transmission
      this.modulator = null;     // 'DA' or 'ST' for modulatory cells, which release at their axon terminals
      this.localDA = 0.0;        // Chemical concentrations bathing this neuron
      this.localST = 0.0;
      this.localNO = 0.0;
      this.tolerance = 0.0;      // Receptor desensitization from sustained exposure
      this.prediction = 0.0;     // Modulatory cells: how strongly their inputs currently predict an outcome
      this.cueDrive = 0.0;
      this.tdError = 0.0;
      this.habituation = 0.0;    // Sensory cells: how used to firing this neuron is

      this.runningFiringRate = 0.12;
      this.targetFiringRate = 0.12;
      this.outgoingSynapses = [];
    }

    injectCurrent(current) {
      this.inputCurrent += current;
    }

    // A presynaptic spike that will arrive `delay` ticks from `now`
    receive(amount, delay, now) {
      this.inbox[(now + delay) % INBOX_SLOTS] += amount;
    }

    tick(body, now) {
      const slot = now % INBOX_SLOTS;
      this.inputCurrent += this.inbox[slot];
      this.inbox[slot] = 0.0;
      this.spiked = false;
      this.adaptation *= 0.95;

      if (this.refractoryTicks > 0) {
        this.refractoryTicks--;
        this.voltage = this.vReset;
        this.displayVoltage = this.vReset;
        this.inputCurrent = 0.0;
        this.history = (this.history << 1) >>> 0;
        this.updateFiringRate(false);
        return false;
      }

      this.inputCurrent += (Evo.random() - 0.5) * body.traits.membraneNoise;
      if (body.sickness > 4.0) {
        this.inputCurrent += (Evo.random() - 0.5) * (body.sickness * 0.14);
      }

      this.voltage = this.vRest + (this.voltage - this.vRest) * this.tau + this.inputCurrent + this.bias - this.adaptation;
      this.inputCurrent = 0.0;

      if (this.voltage >= this.vThreshold) {
        if (body.deductSpikeCost()) {
          this.spiked = true;
          this.displayVoltage = 25.0;
          this.voltage = this.vReset;
          this.adaptation += this.adaptInc;
          this.refractoryTicks = (this.isSensory || this.lobeId === 'motor') ? 1 : this.refractoryPeriod;
        } else {
          this.voltage = this.vRest + 1.5; // Not enough energy to fire
          this.displayVoltage = this.voltage;
        }
      } else {
        this.displayVoltage = this.voltage;
      }

      this.history = ((this.history << 1) | (this.spiked ? 1 : 0)) >>> 0;
      this.updateFiringRate(this.spiked);
      return this.spiked;
    }

    updateFiringRate(fired) {
      const alpha = 0.012;
      this.runningFiringRate = (1 - alpha) * this.runningFiringRate + alpha * (fired ? 1.0 : 0.0);
      // Intrinsic homeostatic plasticity: overactive neurons get harder to fire, silent ones easier
      if (this.homeostatic) {
        this.vThreshold += 0.03 * (this.runningFiringRate - this.targetFiringRate);
        this.vThreshold = Math.max(this.vRest + 2.0, clamp(this.vThreshold, this.baseThreshold - 14.0, this.baseThreshold + 10.0));
      }
    }
  }

  // ---- Fixed parts of the body plan: each sense or drive neuron is defined with what drives it ----
  // input(body, senses) returns the current injected every tick.
  const SOMATO = [
    { id: 'som_bump_fwd', label: 'Snout Contact', tag: [0.5, 0.1, 0.6], pos: [0.50, 0.30], input: (b, s) => s.bumpFwd * 32 },
    { id: 'som_bump_l', label: 'Bumper Left', tag: [0.2, 0.1, 0.6], pos: [0.06, 0.42], input: (b, s) => s.bumpLeft * 28 },
    { id: 'som_bump_r', label: 'Bumper Right', tag: [0.8, 0.1, 0.6], pos: [0.94, 0.42], input: (b, s) => s.bumpRight * 28 },
    { id: 'som_wall_dist', label: 'Wall Proximity', tag: [0.5, 0.3, 0.6], pos: [0.46, 0.37], input: (b, s) => s.wallDist * 22 },
    // Nociceptor: impacts, fresh pain from thorns, and a lingering ache from injury
    { id: 'som_shock', label: 'Pain / Shock', tag: [0.5, 0.5, 0.6], pos: [0.54, 0.37], input: (b, s) => (s.bumpShock ? 34 : 0) + b.pain * 34 + b.injury * 12 },
    { id: 'som_gut_pain', label: 'Visceral Spasm', tag: [0.5, 0.7, 0.6], pos: [0.40, 0.79], input: b => b.toxinDrive * 30 },
    { id: 'som_tail_touch', label: 'Tail Contact', tag: [0.5, 0.8, 0.6], pos: [0.50, 0.995], input: (b, s) => s.tailTouch * 18 },
    { id: 'som_speed_drag', label: 'Kinetic Drag', tag: [0.5, 0.9, 0.6], pos: [0.60, 0.79], input: (b, s) => s.kineticSpeed * 16 }
  ];
  // Hypothalamus: interoceptive drives, a ring on the ventral midline
  const METABOLIC = [
    { id: 'met_energy_hunger', label: 'Energy Hunger', tag: [0.2, 0.8, 0.8], input: b => b.energyHungerDrive * 30 },
    { id: 'met_protein_hunger', label: 'Protein Hunger', tag: [0.4, 0.8, 0.8], input: b => b.proteinHungerDrive * 30 },
    { id: 'met_fat_low', label: 'Lipid Deficit', tag: [0.6, 0.8, 0.8], input: b => b.lipidDeficitDrive * 26 },
    { id: 'met_thirst', label: 'Osmotic Thirst', tag: [0.8, 0.8, 0.8], input: b => b.thirstDrive * 30 },
    { id: 'met_exhaustion', label: 'Fatigue Debt', tag: [0.3, 0.3, 0.8], input: b => b.fatigueDrive * 24 },
    { id: 'met_toxic_nausea', label: 'Toxin Alarm', tag: [0.9, 0.9, 0.8], input: b => b.toxinDrive * 30 },
    { id: 'met_libido', label: 'Libido Courtship', tag: [0.7, 0.5, 0.8], input: b => b.mateDrive * 34 },
    { id: 'met_crowd_panic', label: 'Crowd Stress Alarm', tag: [0.8, 0.2, 0.8], input: b => b.crowdStress * 30 },
    { id: 'met_starve_panic', label: 'Starve Panic', tag: [0.1, 0.9, 0.8], input: b => (b.carbs < 10 && b.fats < 20) ? 32 : 0 },
    { id: 'met_digest_busy', label: 'Satiety Calm', tag: [0.5, 0.2, 0.8], input: b => b.leptin * 24 }
  ];
  // Limbic system: affect, just above the hypothalamus
  const AFFECTIVE = [
    { id: 'aff_joy_surge', label: 'Joy (relief)', tag: [0.2, 0.9, 0.1], input: b => b.joy * 30, modulator: 'DA' },
    { id: 'aff_stress_alarm', label: 'Stress (distress)', tag: [0.9, 0.2, 0.1], input: b => b.stress * 30, modulator: 'ST' },
    { id: 'aff_curiosity', label: 'Curiosity / Boredom', tag: [0.4, 0.7, 0.1], input: b => b.boredom * 28 }, // Restlessness when nothing is new
    // No body signal drives these three directly; what they come to mean depends on how evolution wires them
    { id: 'aff_cell_4', label: 'Feelings cell 4', tag: [0.8, 0.4, 0.1] },
    { id: 'aff_cell_5', label: 'Feelings cell 5', tag: [0.6, 0.8, 0.1] },
    { id: 'aff_cell_6', label: 'Feelings cell 6', tag: [0.9, 0.9, 0.1] }
  ];
  // Motor nuclei: at the back, left muscle on the left, right muscle on the right. `action` is the
  // flag the body reads.
  const MOTOR = [
    { id: 'm_thrust_l', action: 'thrustL', label: 'Left Lateral Muscle', tag: [0.1, 0.5, 0.9], pos: [0.22, 0.86] },
    { id: 'm_thrust_r', action: 'thrustR', label: 'Right Lateral Muscle', tag: [0.9, 0.5, 0.9], pos: [0.78, 0.86] },
    { id: 'm_hop_fwd', action: 'hopFwd', label: 'Axial Forward Thrust', tag: [0.5, 0.2, 0.9], pos: [0.50, 0.80] },
    { id: 'm_reverse', action: 'reverse', label: 'Axial Retractor', tag: [0.5, 0.8, 0.9], pos: [0.50, 0.92] },
    { id: 'm_burst', action: 'burst', label: 'Fast-Twitch Sprint', tag: [0.5, 0.5, 0.9], pos: [0.50, 0.84] },
    { id: 'm_bite_ingest', action: 'biteIngest', label: 'Oral Mandibles (Jaws)', tag: [0.5, 0.1, 0.9], pos: [0.50, 0.88] },
    { id: 'm_groom_rest', action: 'groomRest', label: 'Groom / Rest', tag: [0.5, 0.9, 0.9], pos: [0.38, 0.90] },
    { id: 'm_caudal_whip', action: 'caudalWhip', label: 'Caudal Tail Flexor', tag: [0.5, 0.7, 0.9], pos: [0.62, 0.90] }
  ];

  const ring = (cx, cy, r, i, n) => [cx + r * Math.cos(i * 2 * Math.PI / n), cy + r * Math.sin(i * 2 * Math.PI / n)];
  const mirror = (x, right) => (right ? 1.0 - x : x);

  class NeuralBrain {
    constructor(body, traits) {
      this.body = body;
      this.traits = traits;
      this.allNeurons = [];
      this.synapses = [];
      this.synapseKeys = new Set(); // Fast lookup: "srcId->dstId"
      this.sproutedCount = 0;
      this.prunedCount = 0;
      this.tickCount = 0;
      this.spikesThisTick = 0;
      this.novelty = 0.0;

      this.buildLobes();
      this.growConnectomeFromGRN();
      this.indexLearningCells();
    }

    // Cue synapses (sight and smell onto the joy/stress cells) learn what a sight or smell predicts;
    // modulator cells release reward/stress chemicals. Re-indexed whenever synapses change.
    indexLearningCells() {
      this.cueSynapses = this.synapses.filter(s => s.target.modulator && (s.source.lobeId === 'vision' || s.source.lobeId === 'olfactory'));
      this.modulatorCells = this.allNeurons.filter(n => n.modulator);
    }

    // The only way synapses are created: keeps the list, the lookup set and each neuron's outgoing list in step
    addSynapse(src, dst, weight, { sprouted = false, cap = LIMITS.SYNAPSE_CAP, conduction = 0.12 } = {}) {
      const key = `${src.id}->${dst.id}`;
      if (this.synapseKeys.has(key) || this.synapses.length >= cap) return null;

      // Travel time grows with axon length; faster (myelinated) tracts conduct further per tick
      const delay = clamp(1 + Math.round(brainDistance(src, dst) / conduction), 1, MAX_DELAY);
      const syn = new Synapse(src, dst, weight, delay, sprouted, this.tickCount);
      this.synapses.push(syn);
      this.synapseKeys.add(key);
      src.outgoingSynapses.push(syn);
      return syn;
    }

    // The only way synapses are removed (by index into this.synapses)
    removeSynapseAt(idx) {
      const syn = this.synapses[idx];
      this.synapseKeys.delete(`${syn.source.id}->${syn.target.id}`);
      const outs = syn.source.outgoingSynapses;
      const outIdx = outs.indexOf(syn);
      if (outIdx !== -1) outs.splice(outIdx, 1);
      this.synapses.splice(idx, 1);
    }

    lobe(key) {
      return this.lobesMap[key];
    }

    buildLobes() {
      const T = this.traits;
      const A = T.anatomy;
      const sensor = (id, label, lobe, tag, pos, meta) => {
        const n = new LIFNeuron(id, label, lobe, true, tag, pos, meta);
        n.vThreshold = T.baseThreshold - 3.0;
        return n;
      };

      // Optic tectum: 7 rays arc across the front of the head, left rays on the left
      const vision = [];
      RAYS.forEach((ray, rIdx) => {
        VISION_CHANNELS.forEach((ch, cIdx) => {
          const x = 0.10 + rIdx * (0.80 / (RAYS.length - 1));
          const y = 0.14 + 0.07 * ((x - 0.5) / 0.4) ** 2 + cIdx * 0.017;
          const tag = [(rIdx + 1) / 8.0, (cIdx + 1) / 6.0, 0.2];
          const n = sensor(`v_${ray.key}_${ch}`, `Vis ${ray.key} ${ch}`, 'vision', tag, [x, y], { kind: 'vision', ray: ray.key, channel: ch });
          n.tau = T.tauLeak * 0.95;
          vision.push(n);
        });
      });

      // Olfactory bulbs: the most anterior structures, one per antenna plus snout and core.
      // Each antenna's bulb sits on its own side of the head (as insect antennal lobes do)
      const olfactory = [];
      const bulbs = [[0.14, 0.05], [0.86, 0.05], [0.50, 0.015], [0.50, 0.075]];
      const nodeX = [0.2, 0.8, 0.5, 0.5];
      NOSES.forEach((node, nIdx) => {
        SMELL_CHANNELS.forEach((ch, sIdx) => {
          const pos = [bulbs[nIdx][0] + (sIdx - 2.5) * 0.015, bulbs[nIdx][1]];
          const tag = [nodeX[nIdx], Math.min(0.98, (sIdx + 1) / 6.0), 0.4];
          olfactory.push(sensor(`olf_${node.key}_${ch}`, `Scent ${node.key} ${ch}`, 'olfactory', tag, pos, { kind: 'smell', nose: node.key, channel: ch }));
        });
      });

      // Somatosensory map: left bumper on the left, right on the right, tail at the back
      const somato = SOMATO.map(d => { const n = new LIFNeuron(d.id, d.label, 'somato', true, d.tag, d.pos, { def: d }); return n; });
      // Hypothalamus: a ring on the ventral midline
      const metabolic = METABOLIC.map((d, i) =>
        new LIFNeuron(d.id, d.label, 'metabolic', true, d.tag, ring(0.5, 0.73, 0.045, i, METABOLIC.length), { def: d }));
      // Limbic system, just above the hypothalamus
      const affective = AFFECTIVE.map((d, i) => {
        const n = new LIFNeuron(d.id, d.label, 'affective', false, d.tag, ring(0.5, 0.63, 0.038, i, AFFECTIVE.length), { def: d });
        n.modulator = d.modulator || null;
        return n;
      });

      // Anatomy genes can grow or shrink the interior regions (always an even count for paired ones)
      const countFor = (lobe, base, paired) => {
        const c = Math.round(base * (A[lobe] ? A[lobe].count : 1.0));
        return paired ? Math.max(4, c - (c % 2)) : Math.max(3, c);
      };
      // A general-purpose region: `cols` sets how receptor tags are laid out, `z` its chemical family
      const makeLobe = (key, prefix, count, cols, z, posFor) => Array.from({ length: count }, (_, i) =>
        new LIFNeuron(`${prefix}_${i}`, `${prefix} #${i + 1}`, key, false,
          [(i % cols) / cols, Math.floor(i / cols) / Math.ceil(count / cols), z], posFor(i, count), { kind: 'cell', index: i }));

      // Association cortex: two hemispheres
      const associative = makeLobe('associative', 'assoc', countFor('associative', 30, true), 10, 0.5, (i, n) => {
        const half = n / 2, k = i % half;
        return [mirror(0.14 + (k % 5) * 0.065, i >= half), 0.33 + Math.floor(k / 5) * 0.055];
      });
      // Side lobes: a curved arc of general-purpose cells in each hemisphere. (Internally still called
      // 'memory'; no special memory mechanism is built in, only position differs from other regions.)
      const memory = makeLobe('memory', 'mem', countFor('memory', 24, true), 8, 0.7, (i, n) => {
        const half = n / 2, k = i % half, t = k / (half - 1);
        return [mirror(0.20 + 0.06 * Math.sin(t * Math.PI), i >= half), 0.50 + t * 0.22];
      });
      // Central lobe: general-purpose cells between the hemispheres (internally 'planning'; no built-in role)
      const planning = makeLobe('planning', 'plan', countFor('planning', 20, false), 5, 0.6,
        i => [0.36 + (i % 5) * 0.07, 0.46 + Math.floor(i / 5) * 0.035]);
      // Motor nuclei: at the back, left muscle on the left, right muscle on the right
      const motor = MOTOR.map(d => new LIFNeuron(d.id, d.label, 'motor', false, d.tag, d.pos, { def: d }));
      // Brainstem: a row of general-purpose cells behind the motor nuclei. They have no special role
      // built in; genes decide what (if anything) wires to them. (The efference copy of movement
      // commands is a duplicated copy of the motor lobe, grown by a founder gene.)
      const efference = makeLobe('efference', 'eff', countFor('efference', 16, false), 4, 0.8,
        (i, n) => [0.2 + i * (0.6 / Math.max(1, n - 1)), 0.965]);

      this.lobesMap = { vision, olfactory, somato, metabolic, affective, associative, memory, planning, motor, efference };

      // Anatomy genes reshape the default body plan: each region can shift forward/back, widen or
      // narrow (mirrored, so the brain stays bilateral) and stretch front-to-back about its centre.
      LOBE_ORDER.forEach(lobe => {
        const g = A[lobe];
        if (!g) return;
        const neurons = this.lobesMap[lobe];
        const cy = meanDepth(neurons);
        neurons.forEach(n => {
          const x = 0.5 + (n.pos[0] - 0.5) * g.lateral;
          const y = cy + g.shift + (n.pos[1] - cy) * g.size;
          n.pos = [clamp(x, 0.01, 0.99), clamp(y, 0.005, 0.995)];
        });
      });

      // Region duplications: each copy keeps its parent's layout and chemistry (shifted), sits at a new
      // depth, and is a central (non-sensory) region. Its parent's guidance genes also grow its axons.
      this.duplicatesOf = {};
      this.duplicateLobes = [];
      T.duplications.forEach((d, k) => {
        const parentId = LOBE_ORDER[d.sourceLobeIdx];
        const parent = this.lobesMap[parentId];
        const lobeId = `dup${k}_${parentId}`;
        const cy = meanDepth(parent);
        const copy = parent.map(src => {
          const tag = [src.receptorTag[0], src.receptorTag[1], clamp(src.receptorTag[2] + d.chemShift, 0, 1)];
          const pos = [clamp(0.5 + (src.pos[0] - 0.5) * d.lateral, 0.01, 0.99), clamp(d.depth + (src.pos[1] - cy), 0.005, 0.995)];
          const n = new LIFNeuron(`${lobeId}_${src.id}`, `Copy: ${src.label}`, lobeId, false, tag, pos, src.meta);
          n.copyOf = src;
          n.parentLobe = parentId;
          return n;
        });
        copy.inputWeight = d.inputWeight;
        this.lobesMap[lobeId] = copy;
        (this.duplicatesOf[parentId] = this.duplicatesOf[parentId] || []).push(copy);
        this.duplicateLobes.push(lobeId);
      });

      this.allNeurons = [];
      LOBE_ORDER.forEach(lobe => this.allNeurons.push(...this.lobesMap[lobe]));
      this.duplicateLobes.forEach(lobe => this.allNeurons.push(...this.lobesMap[lobe]));

      this.allNeurons.forEach(n => {
        if (!SENSORY_LOBES.includes(n.lobeId)) {
          // The genome's membrane gene applies to every central neuron
          n.vThreshold = T.baseThreshold;
          if (n.lobeId !== 'motor') n.tau = T.tauLeak;
          n.homeostatic = true;
          n.adaptInc = n.lobeId === 'motor' ? 0.25 : 0.15;
          n.refractoryPeriod = clamp(T.refractoryTicks, 1, 3);
        }
        n.baseThreshold = n.vThreshold;
      });
      this.centralNeurons = this.allNeurons.filter(n => !SENSORY_LOBES.includes(n.lobeId));
      this.senseNeurons = [...vision, ...olfactory, ...somato];

      // Modulatory cells: the limbic joy and stress neurons release chemicals at their axon terminals.
      // They fire phasically on the body's affect, so they don't homeostatically tune toward tonic
      // firing, and like real dopamine cells they adapt quickly and fire mainly at increases.
      affective.filter(n => n.modulator).forEach(n => {
        n.homeostatic = false;
        n.adaptInc = 0.8;
      });
      this.chemistry = new BrainChemistry(T.neurochem);

      // Pacemaker genes give a whole lobe a steady depolarizing current (spontaneous activity)
      // (it also raises the lobe's homeostatic set point, otherwise homeostasis would simply cancel it out)
      T.pacemakers.forEach(pm => {
        this.lobesMap[LOBE_ORDER[pm.lobeIdx]].forEach(n => {
          n.bias = Math.min(3.0, n.bias + pm.bias);
          n.targetFiringRate = Math.min(0.35, n.targetFiringRate + pm.bias * 0.06);
        });
      });
    }

    growConnectomeFromGRN() {
      // PURE BOTTOM-UP WIRING. Each guidance gene sends the axons of one lobe looking for a chemical
      // receptor match (targetVector), but axons can only grow so far (reach), so physically closer
      // targets are far more likely. Sensory transducers are driven by the body and world, so central
      // axons never target them. Candidates from all genes compete fairly for the innate budget, and
      // headroom is left so activity-dependent sprouting can still add synapses.
      const BUDGET = LIMITS.INNATE_BUDGET;
      const candidates = [];

      // A fresh duplicate is wired in register: each original neuron feeds its own copy
      this.duplicateLobes.forEach(lobe => {
        const copy = this.lobesMap[lobe];
        copy.forEach(n => this.addSynapse(n.copyOf, n, copy.inputWeight, { cap: BUDGET, conduction: 0.3 }));
      });

      this.traits.axonGuidanceTags.forEach(rule => {
        const parentId = LOBE_ORDER[rule.sourceLobeIdx];
        // Duplicated regions inherit their parent's developmental program
        const srcLobe = [this.lobesMap[parentId], ...(this.duplicatesOf[parentId] || [])].flat();

        srcLobe.forEach(src => {
          this.centralNeurons.forEach(dst => {
            if (src === dst) return;
            const chemDist = Math.hypot(
              dst.receptorTag[0] - rule.targetVector[0],
              dst.receptorTag[1] - rule.targetVector[1],
              dst.receptorTag[2] - rule.targetVector[2]);
            if (chemDist >= rule.affinityRadius) return;

            const chemMatch = (1.0 - chemDist / rule.affinityRadius) ** 2;
            const spatialReach = Math.exp(-((brainDistance(src, dst) / rule.reach) ** 2));
            if (Evo.chance(chemMatch * spatialReach)) {
              candidates.push({ src, dst, weight: (0.15 + Evo.random() * 0.35) * rule.weightSign, conduction: rule.conduction });
            }
          });
        });
      });

      Evo.shuffle(candidates).forEach(c => this.addSynapse(c.src, c.dst, c.weight, { cap: BUDGET, conduction: c.conduction }));

      // Local background wiring: neighbours are likelier to connect (unmyelinated, slow)
      this.allNeurons.forEach(src => {
        this.centralNeurons.forEach(dst => {
          if (src === dst) return;
          if (Evo.chance(0.03 * Math.exp(-((brainDistance(src, dst) / 0.18) ** 2)))) {
            this.addSynapse(src, dst, (Evo.random() - 0.5) * 0.25, { cap: BUDGET + 150, conduction: 0.10 });
          }
        });
      });
    }

    runMorphogenesis() {
      // 1. Pruning: use it or lose it. An idle weak spine dies, and so does a sprout that learning
      // never strengthened within its trial period. Innate GRN tracts are protected.
      const pruneCutoff = this.traits.pruningRate;
      for (let idx = this.synapses.length - 1; idx >= 0; idx--) {
        const syn = this.synapses[idx];
        if (!syn.isSprouted) continue;
        const age = this.tickCount - syn.bornTick;
        const idleAndWeak = Math.abs(syn.weight) < pruneCutoff && syn.idleTicks > 800;
        const failedTrial = age > 1500 && Math.abs(syn.weight) < 0.14;
        if (idleAndWeak || failedTrial) {
          this.removeSynapseAt(idx);
          this.prunedCount++;
        }
      }

      // 2. Sprouting: an active neuron grows a short local collateral toward its most depolarized neighbour
      const SPROUT_RANGE = 0.3;
      let best = null, bestAffinity = 0;
      for (const src of this.allNeurons) {
        if (!src.spiked && src.runningFiringRate <= 0.16) continue;
        for (const dst of this.centralNeurons) {
          if (src === dst) continue;
          const d = brainDistance(src, dst);
          if (d > SPROUT_RANGE) continue;
          const depol = Math.max(0, dst.displayVoltage - dst.vRest);
          if (depol <= this.traits.sproutingThreshold || this.synapseKeys.has(`${src.id}->${dst.id}`)) continue;
          const affinity = depol * (src.spiked ? 2.0 : 1.0) * Math.exp(-((d / 0.2) ** 2));
          if (affinity > bestAffinity) { bestAffinity = affinity; best = { src, dst }; }
        }
      }
      if (best) {
        // Nascent spines are weak; reward-driven learning decides whether they grow up
        const initialW = (0.05 + Evo.random() * 0.06) * (Evo.chance(0.7) ? 1 : -1);
        const newSyn = this.addSynapse(best.src, best.dst, initialW, { sprouted: true, conduction: 0.10 });
        if (newSyn) {
          newSyn.eligibilityTrace = 0.35;
          this.sproutedCount++;
        }
      }
      this.indexLearningCells();
    }

    tick(senses) {
      const now = ++this.tickCount;
      const body = this.body;
      const T = this.traits;
      const L = this.lobesMap;

      // 1. Transduction: the body and world drive the sensory neurons directly
      const sightGain = 34.0 * T.opticGain;
      const nV = VISION_CHANNELS.length;
      senses.visionRays.forEach((ray, rIdx) => {
        VISION_CHANNELS.forEach((ch, cIdx) => L.vision[rIdx * nV + cIdx].injectCurrent(ray[ch] * sightGain));
      });

      // Olfactory receptors respond logarithmically (Weber-Fechner), like real chemoreceptors:
      // faint traces register, and stronger concentrations still read as stronger
      const smellGain = 30.0 * T.scentGain;
      const RECEPTOR_K = 0.02;
      const transduce = c => Math.log1p(c / RECEPTOR_K) / Math.log1p(1.0 / RECEPTOR_K);
      const nS = SMELL_CHANNELS.length;
      senses.scents.forEach((node, nIdx) => {
        SMELL_CHANNELS.forEach((ch, sIdx) => L.olfactory[nIdx * nS + sIdx].injectCurrent(transduce(node[ch]) * smellGain));
      });

      for (const lobe of [L.somato, L.metabolic, L.affective]) {
        for (const n of lobe) if (n.meta.def.input) n.injectCurrent(n.meta.def.input(body, senses));
      }

      // 2. Every neuron integrates what arrived this tick. With conduction delays there is no
      // hand-ordered pipeline: where and how far activity travels comes from the wiring itself.
      const all = this.allNeurons;
      let spikes = 0;
      for (let i = 0; i < all.length; i++) if (all[i].tick(body, now)) spikes++;
      this.spikesThisTick = spikes;

      // Novelty: senses habituate to what they keep reporting, so a spike from a neuron that is
      // usually quiet is surprising. The body feels a lack of surprise as boredom.
      const habRate = T.habituationRate;
      let surprise = 0;
      for (const n of this.senseNeurons) {
        if (n.spiked) surprise += Math.max(0, 1.0 - n.habituation * 5.0);
        n.habituation += ((n.spiked ? 1 : 0) - n.habituation) * habRate;
      }
      this.novelty = Math.min(1.0, (surprise / this.senseNeurons.length) * 8.0);
      body.novelty = this.novelty;

      // 3. New spikes depart along their axons
      for (let i = 0; i < all.length; i++) {
        const n = all[i];
        if (!n.spiked) continue;
        const outs = n.outgoingSynapses;
        for (let j = 0; j < outs.length; j++) {
          outs[j].target.receive(outs[j].weight * SYNAPTIC_GAIN, outs[j].delay, now);
        }
      }

      // 4. Motor read-out: each muscle flag is simply whether its motor neuron fired
      const action = {};
      for (const n of L.motor) action[n.meta.def.action] = n.spiked;

      // 5. Volume transmission. Every firing neuron puffs a little NO gas where it sits. The joy and
      // stress cells release dopamine / stress chemical at the ends of their axons, so WHERE learning
      // happens depends on where those axons grew, which is genetic. A broad projection spreads a
      // fixed release thinly; a focused one teaches a small area strongly.
      const chem = this.chemistry;
      for (let i = 0; i < all.length; i++) {
        if (all[i].spiked) chem.deposit(CHEM.NO, all[i].pos, 0.06);
      }
      // Modulatory cells release where each spike actually arrives: at the terminal, once the
      // axon delay has elapsed (bit `delay` of the firing history)
      for (const n of this.modulatorCells) {
        const ch = CHEM[n.modulator];
        const outs = n.outgoingSynapses;
        // Some release happens from the cell's own dendrites (as real dopamine cells do); the rest
        // at the axon terminals
        const somaShare = outs.length === 0 ? 1.0 : 0.3;
        if (n.spiked) chem.deposit(ch, n.pos, somaShare);
        for (let j = 0; j < outs.length; j++) {
          if (outs[j].preArrived) chem.deposit(ch, outs[j].target.pos, 0.7 / outs.length);
        }
      }
      chem.step();

      // Each neuron reads the chemistry bathing it; receptors desensitize under sustained exposure
      // (tolerance), which slows, though does not fully prevent, a brain rewarding itself
      for (let i = 0; i < all.length; i++) {
        const n = all[i];
        n.localDA = chem.sample(CHEM.DA, n.pos);
        n.localST = chem.sample(CHEM.ST, n.pos);
        n.localNO = chem.sample(CHEM.NO, n.pos);
        n.tolerance += ((n.localDA + n.localST) - n.tolerance) * 0.003;
      }

      // Temporal-difference learning for cues. Each joy/stress cell's prediction V is what its sensory
      // cues are currently signalling. The error is: outcome now + (discounted) new prediction - old
      // prediction. So a smell that grows stronger on the way to food is good news in itself, a meal
      // that was fully expected teaches little, and a cue that stops paying off fades.
      const GAMMA = 0.98;
      for (const m of this.modulatorCells) {
        let cue = 0;
        for (const syn of this.cueSynapses) {
          if (syn.target === m && syn.preArrived) cue += syn.weight;
        }
        // Smooth the cue drive the way a membrane integrates input: sensory cells pulse every other tick,
        // and an unsmoothed prediction would flicker, producing alternating errors that cancel out
        m.cueDrive = m.cueDrive * 0.8 + cue * 0.2;
        const V = clamp(m.cueDrive * 2.0, 0, 1.5);
        const outcome = m.modulator === 'DA' ? body.joy : body.stress;
        m.tdError = outcome + GAMMA * V - m.prediction;
        m.prediction = V;
      }
      for (const syn of this.cueSynapses) {
        // Presynaptic trace: which cues were present recently, whether or not the cell fired
        syn.cueTrace = syn.cueTrace * T.traceDecay + (syn.preArrived ? 1 : 0);
        syn.nudge(0.004 * syn.cueTrace * syn.target.tdError);
      }

      // 6. Three-factor plasticity with LOCAL modulation: each synapse learns from the dopamine
      // minus stress chemical at its own location, scaled by the joy/stress sensitivity genes.
      // NO spillover lets synapses from recently active neighbours share in the credit.
      const eta = T.learningRate * 0.25; // Applied every tick a signal lasts
      const CHEM_GAIN = 12.0, NO_SPILL = 0.5;
      for (let sIdx = 0; sIdx < this.synapses.length; sIdx++) {
        const syn = this.synapses[sIdx];
        const post = syn.target;
        const postActivity = post.spiked ? 20.0 : Math.max(0, post.voltage - post.vRest);
        // Credit the spike that actually reached the target this tick (sent `delay` ticks ago)
        syn.updateTrace(syn.preArrived, postActivity, T.traceDecay);

        // Inputs to the joy/stress cells never learn from the dopamine they themselves cause (so a
        // brain can't talk itself into reward). Sensory cues onto them learn by TD error, above;
        // other inputs to them stay as the genome built them.
        if (post.modulator) continue;

        const signal = CHEM_GAIN * (post.localDA * T.joyGain - post.localST * T.stressGain) / (1.0 + 2.0 * post.tolerance);
        if (signal === 0) continue;
        const spillover = NO_SPILL * post.localNO * Math.min(1.0, syn.source.runningFiringRate * 5.0);
        syn.applyPlasticity(signal, eta, spillover);
      }

      return action;
    }
  }

  Object.assign(Evo, {
    NeuralBrain, LIFNeuron, Synapse, BrainChemistry, CHEM_CHANNELS, CHEM,
    BRAIN: { MAX_DELAY, SYNAPTIC_GAIN, WEIGHT_MIN, WEIGHT_MAX }
  });
})(globalThis.Evo);
