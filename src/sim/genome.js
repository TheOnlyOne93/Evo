// Permissive bytecode genome (evo-devo grammar).
// A gene is expressed only where a promoter byte sits in front of it:
//
//   A5  HH  payload…      type = HH % 32 (row in GENES), stage = HH >> 5 (life stage it switches on at)
//
// Everything else is silent junk DNA that mutates freely. A point mutation can create a promoter
// (switching on a brand-new gene) or destroy one. A frameshift garbles only the gene it lands in.
// Every decoded value is clamped by construction, so a broken gene makes a bad creature, never a
// broken simulation. Sex is carried on its own chromosome (X or Y), outside the mutable gene string.
(function (Evo) {
  'use strict';
  const { mean, clamp, hash2, fixedNumber } = Evo.util;
  const { LOBE_ORDER, LOBE_COUNT, N_CHEM, CHEM, LOCUS, BODY_LOCI, TARGET, TARGETS, NEUROCHEMS, STIMULI } = Evo;

  const PROMOTER = 0xA5;
  const TYPE_SLOTS = 32;
  const MIN_LENGTH = 256;
  const MAX_LENGTH = 8192;
  const GENOME_LIMITS = { MIN_LENGTH, MAX_LENGTH };
  // Per-copy mutation: a point mutation per byte at `rate` (mostly a small step, else a new byte), then
  // chances of duplicating a gene, losing a gene, and one small insertion or deletion
  const MUTATION = { rate: 0.001, smallStepShare: 0.8, stepWidth: 48, duplication: 0.03, deletion: 0.02, indel: 0.02 };

  // span: a 0..1 field read as lo .. lo + width (decode), and back for founder values (encode)
  const span = (lo, width) => ({ lo, width, decode: v => lo + v * width, encode: x => (x - lo) / width });
  // Trait ranges: a gene reads its 0..1 field as lo .. lo + width (express below; the rate codec reads
  // its byte the same way), and text.js grades the trait in words over lo..hi. hi is lo + width
  // written out (for size it also counts the female's extra 2 px), so the words keep their exact cut-offs (0.3 + 0.6 is not 0.9 in floating point).
  const ranged = (lo, width, hi) => ({ ...span(lo, width), hi });
  const TRAIT_RANGES = {
    size: { ...ranged(30, 16, 48), female: 2 }, // Adult body length, px: 30..46 for males, 32..48 for females
    walk: ranged(0.8, 1.0, 1.8),
    jump: ranged(3.5, 3.5, 7),
    eyes: ranged(180, 280, 460),                // Vision range, px
    nose: ranged(14, 30, 44),                   // Smell reach, px
    learning: ranged(0.018, 0.045, 0.063),
    fur: ranged(0.3, 0.6, 0.9),                 // Insulation
    rate: ranged(-6, 5, -1),                    // A reaction's rate constant per tick, as a power of ten
    competition: ranged(0, 8, 8),               // Lobe dynamics, mV
    persistence: ranged(0, 4, 4)
  };

  // ---- Codecs: how one payload byte decodes to a value, and how a founder value encodes to a byte ----
  const byte = v => clamp(Math.round(v), 0, 255);
  const CODEC = {
    unit: { decode: b => b / 255, encode: v => byte(v * 255) },
    raw: { decode: b => b, encode: v => byte(v) },
    // A chemical slot (0 = nothing). Founder genes name chemicals; mutation can reach any slot.
    chem: { decode: b => b % N_CHEM, encode: v => (v === null ? 0 : CHEM[v]) },
    // What an emitter reads: a body locus (codes < 128) or a chemical (codes >= 128)
    locus: {
      decode: b => (b < 128 ? { body: b % BODY_LOCI.length } : { chem: (b - 128) % N_CHEM }),
      encode: v => (v.startsWith('chem:') ? 128 + CHEM[v.slice(5)] : LOCUS[v])
    },
    target: { decode: b => b % TARGETS.length, encode: v => TARGET[v] },
    lobe: { decode: b => b % LOBE_COUNT, encode: v => LOBE_ORDER.indexOf(v) },
    // Reaction rate constant per tick, logarithmic from 1e-6 to 0.1
    rate: {
      decode: b => Math.pow(10, TRAIT_RANGES.rate.lo + TRAIT_RANGES.rate.width * b / 255),
      encode: k => byte((Math.log10(k) - TRAIT_RANGES.rate.lo) / TRAIT_RANGES.rate.width * 255)
    },
    // Product yield, 0..~4
    yield: { decode: b => b / 64, encode: v => byte(v * 64) },
    // Emitter output per tick at full signal, 0..0.05 (quadratic, for fine control of small rates)
    emit: { decode: b => (b / 255) ** 2 * 0.05, encode: v => byte(Math.sqrt(v / 0.05) * 255) },
    // Receptor gain, 0..4
    gain: { decode: b => b / 64, encode: v => byte(v * 64) },
    // A signed amount, -0.5..0.5 (128 = zero)
    signed: { decode: b => (b - 128) / 256, encode: v => byte(v * 256 + 128) },
    // Half-life in ticks: 2^(b/16) (1 tick .. ~16 minutes); 255 = never decays
    halfLife: { decode: b => (b === 255 ? Infinity : Math.pow(2, b / 16)), encode: t => (t === Infinity ? 255 : byte(Math.log2(t) * 16)) }
  };
  // An emitter's or receptor's flags byte: bit 0 inverts the reading, bit 1 makes it all or nothing,
  // bit 2 makes a receptor lower its target instead of raising it
  const FLAG = { INVERT: 1, DIGITAL: 2, NEGATIVE: 4 };
  const flagsOf = b => ({ invert: !!(b & FLAG.INVERT), digital: !!(b & FLAG.DIGITAL), negative: !!(b & FLAG.NEGATIVE) });
  const GENE_NONE = 255; // An instinct input index that matches no neuron
  const u = key => [key, CODEC.unit];

  // Axon guidance source byte: bits 0-3 the source region; then which side of the target region the
  // axons aim at, as seen from the source cell: bit 4 its own side, bit 5 the other side, bit 6 the
  // right side (none of the three: the left side)
  const guidanceSource = {
    decode: b => ({ lobe: (b & 15) % LOBE_COUNT, side: b & 16 ? 'same' : b & 32 ? 'other' : b & 64 ? 'right' : 'left' }),
    encode: v => LOBE_ORDER.indexOf(v.lobe) | ({ same: 16, other: 32, right: 64, left: 0 })[v.side]
  };
  // Axon guidance values from their decoded fields (decode), and back for founder.js wire() (encode)
  const GUIDANCE = {
    radius: span(0.04, 0.76),     // Affinity radius around the spot sought
    reach: span(0.15, 2.85),      // How far the axons can grow, in map heights (0.15 to 3.0: the top reaches anywhere on the map)
    conduction: span(0.08, 0.5),  // Myelination: distance per tick
    window: span(0.02, 0.5),      // Radius of the source window
    // Sign and strength from the raw sign byte: bytes above 120 are excitatory, 120 and below inhibitory,
    // stronger the further from 120 they are (0.2 .. 1.0 either way)
    weight: {
      decode: b => (b > 120 ? 1 : -1) * Math.min(1.0, 0.2 + Math.abs(b - 120) / 100),
      encode: w => (w > 0 ? 120 + Math.max(1, (w - 0.2) * 100) : 120 - (-w - 0.2) * 100)
    }
  };

  // One row per gene type. fields: [name, codec] per payload byte, in order.
  // express(v, d): what the gene builds from its decoded values v.
  //   d.set(trait, value) votes for a trait (several copies of a gene average: co-dominance);
  //   d.add(list, entry) appends to a list trait; d.F is true for females.
  // group: where the genome view lists it ('body' | 'brain' | 'chemistry' | 'instinct'); its words
  //   are in text.js (describeGene).
  // birthOnly: the brain reads these traits only when it is built, so a copy that switches on at
  //   a later life stage has no effect.
  const R = TRAIT_RANGES;
  const GENES = [
    { name: 'Appearance', group: 'body', fields: [u('hue'), u('accentHue'), u('pattern'), u('patternScale'), u('earSize'), u('tailLength'), u('eyeSize'), u('plumpness')],
      express(v, d) {
        d.set('hue', v.hue * 360); d.set('accentHue', v.accentHue * 360); d.set('pattern', Math.min(3, Math.floor(v.pattern * 4)));
        for (const k of ['patternScale', 'earSize', 'tailLength', 'eyeSize', 'plumpness']) d.set(k, v[k]);
      } },
    { name: 'Morphology', group: 'body', fields: [u('size'), u('legLength'), u('mouthReach'), u('crest')],
      express(v, d) {
        d.set('adultSize', (d.F ? R.size.lo + R.size.female : R.size.lo) + v.size * R.size.width);
        d.set('legLength', v.legLength);
        d.set('mouthReach', 4 + v.mouthReach * 8);
        d.set('crest', v.crest);
      } },
    { name: 'Eyes', group: 'body', fields: [u('range'), u('gain'), u('night')],
      express(v, d) { d.set('visionRange', R.eyes.decode(v.range)); d.set('opticGain', 0.6 + v.gain); d.set('nightVision', v.night); } },
    { name: 'Nose', group: 'body', fields: [u('reach'), u('gain')],
      express(v, d) { d.set('noseReach', R.nose.decode(v.reach)); d.set('scentGain', 0.6 + v.gain); } },
    { name: 'Membrane', group: 'brain', fields: [u('threshold'), u('leak'), u('refractory')],
      express(v, d) { d.set('baseThreshold', -58 + v.threshold * 10); d.set('tauLeak', 0.72 + v.leak * 0.19); d.set('refractoryTicks', 1 + v.refractory * 2); },
      birthOnly: true },
    { name: 'Plasticity', group: 'brain', fields: [u('rate'), u('memory'), u('sprouting'), u('pruning')],
      express(v, d) {
        d.set('learningRate', R.learning.decode(v.rate));
        d.set('traceDecay', 0.5 ** (1 / (14 * 10 ** v.memory))); // Eligibility half-life 14 to 140 ticks (0.95 to 0.995 per tick)
        d.set('sproutingThreshold', 3 + v.sprouting * 7);
        d.set('pruningRate', 0.02 + v.pruning * 0.03);
      } },
    { name: 'Reinforcement', group: 'brain', fields: [u('joy'), u('stress')],
      express(v, d) { d.set('joyGain', 0.9 + v.joy * 1.3); d.set('stressGain', 1.1 + v.stress * 1.6); } },
    { name: 'Muscle', group: 'body', fields: [u('speed'), u('jump'), u('run')],
      express(v, d) { d.set('walkSpeed', R.walk.decode(v.speed)); d.set('jumpPower', R.jump.decode(v.jump)); d.set('runBoost', 1.2 + v.run * 0.8); } },
    { name: 'Life history', group: 'body', fields: [u('lifespan'), u('gestation')],
      express(v, d) { d.set('lifespanTicks', (20 + v.lifespan * 24) * 60 * Evo.TICKS_PER_SECOND); d.set('gestationTicks', 3000 + v.gestation * 6000); } },
    { name: 'Voice', group: 'body', fields: [u('pitch'), u('loudness')],
      express(v, d) { d.set('voicePitch', v.pitch); d.set('voiceLoudness', 0.4 + v.loudness * 0.6); } },
    { name: 'Curiosity', group: 'brain', fields: [u('habituation'), u('novelty')],
      express(v, d) { d.set('habituationRate', 0.0005 + v.habituation * 0.004); d.set('noveltyGain', 4 + v.novelty * 8); } },
    { name: 'Anatomy', group: 'brain', fields: [['region', CODEC.lobe], u('shift'), u('lateral'), u('size'), u('count')],
      express(v, d) {
        d.anatomy(LOBE_ORDER[v.region], { shift: (v.shift - 0.5) * 0.3, lateral: 0.6 + v.lateral * 0.8, size: 0.6 + v.size * 0.9, count: 0.5 + v.count * 1.1 });
      },
      birthOnly: true },
    { name: 'Axon guidance', group: 'brain', fields: [['source', guidanceSource], ['region', CODEC.lobe], u('tu'), u('tv'), u('radius'), ['sign', CODEC.raw], u('reach'), u('conduction'), u('sx'), u('sy'), u('sr')],
      express(v, d) {
        d.add('axonGuidance', {
          source: v.source,                  // The region the axons leave, and which side of the target they aim at
          // Only source cells whose spot lies within r of (x, y) send axons (sr = 0: every cell does)
          srcWindow: v.sr === 0 ? null : { x: v.sx, y: v.sy, r: GUIDANCE.window.decode(v.sr) },
          targetRegion: v.region,
          target: [v.tu, v.tv],              // The spot sought in the target region
          affinityRadius: GUIDANCE.radius.decode(v.radius),
          weightSign: GUIDANCE.weight.decode(v.sign),
          reach: GUIDANCE.reach.decode(v.reach),
          conduction: GUIDANCE.conduction.decode(v.conduction)
        });
      } },
    { name: 'Pacemaker', group: 'brain', fields: [['lobe', CODEC.lobe], u('bias')],
      express(v, d) { d.add('pacemakers', { lobeIdx: v.lobe, bias: v.bias * 3.0 }); } },
    { name: 'Neurochemistry', group: 'brain', fields: [['chem', CODEC.raw], u('spread')],
      express(v, d) { d.neurochem(NEUROCHEMS[v.chem % NEUROCHEMS.length].key, v.spread); },
      birthOnly: true },
    { name: 'Reaction', group: 'chemistry', fields: [['a', CODEC.chem], ['b', CODEC.chem], ['c', CODEC.chem], ['d', CODEC.chem], ['rate', CODEC.rate], ['yieldC', CODEC.yield], ['yieldD', CODEC.yield]],
      express(v, d) { if (v.a) d.add('reactions', v); } },
    { name: 'Emitter', group: 'chemistry', fields: [['locus', CODEC.locus], ['chem', CODEC.chem], u('threshold'), ['gain', CODEC.emit], ['flags', CODEC.raw]],
      express(v, d) { if (v.chem) d.add('emitters', { ...v, ...flagsOf(v.flags) }); } },
    { name: 'Receptor', group: 'chemistry', fields: [['chem', CODEC.chem], ['target', CODEC.target], u('threshold'), ['gain', CODEC.gain], ['flags', CODEC.raw]],
      express(v, d) { if (v.chem && v.target) d.add('receptors', { ...v, ...flagsOf(v.flags) }); } },
    { name: 'Half-life', group: 'chemistry', fields: [['chem', CODEC.chem], ['halfLife', CODEC.halfLife]],
      express(v, d) { if (v.chem) d.halfLife(v.chem, v.halfLife); } },
    { name: 'Initial concentration', group: 'chemistry', fields: [['chem', CODEC.chem], u('amount')],
      express(v, d) { if (v.chem) d.add('initial', v); } },
    { name: 'Instinct', group: 'instinct', fields: [['lobeA', CODEC.lobe], ['indexA', CODEC.raw], ['lobeB', CODEC.lobe], ['indexB', CODEC.raw], ['motor', CODEC.raw], ['chem', CODEC.chem], u('amount')],
      express(v, d) { d.add('instincts', v); } },
    { name: 'Insulation', group: 'body', fields: [u('insulation'), u('bodyHeat')],
      express(v, d) { d.set('insulation', R.fur.decode(v.insulation)); d.set('bodyHeat', v.bodyHeat); } },
    { name: 'Reproduction', group: 'body', fields: [u('investment'), u('incubation')],
      express(v, d) { d.set('eggInvestment', 0.2 + v.investment * 0.4); d.set('incubationTicks', 3000 + v.incubation * 6000); } },
    // What a stimulus (Evo.STIMULI) releases: up to two chemicals, each by a signed amount
    { name: 'Stimulus', group: 'chemistry', fields: [['stimulus', CODEC.raw], ['chem1', CODEC.chem], ['amount1', CODEC.signed], ['chem2', CODEC.chem], ['amount2', CODEC.signed]],
      express(v, d) { d.add('stimuli', { stimulus: v.stimulus % STIMULI.length, chem1: v.chem1, amount1: v.amount1, chem2: v.chem2, amount2: v.amount2 }); } },
    // How a region's cells work together: they compete (each is held back by the others' recent
    // firing), and a cell that fires keeps itself going for a while, until it tires.
    { name: 'Lobe dynamics', group: 'brain', fields: [['lobe', CODEC.lobe], u('competition'), u('persistence'), u('tau'), u('fatigue')],
      express(v, d) {
        d.add('lobeDynamics', {
          lobeIdx: v.lobe,
          competition: R.competition.decode(v.competition), // mV of inhibition per unit of the others' activity
          persistence: R.persistence.decode(v.persistence), // mV of self-sustaining current added per spike (up to 3 spikes' worth)
          keep: 1 - 1 / (5 + 200 * v.tau),                  // How long that current lasts (per tick)
          adaptKeep: 0.95 + 0.049 * v.fatigue               // How slowly the cells recover from tiring
        });
      },
      birthOnly: true },
    // What a kind of cell is like when nothing drives it. rest: the share of ticks a cell of this
    // region fires on its own, which its balancing aims for (0.001 to about 0.3, on a log scale).
    // twitch: how many mV easier to fire a quiet cell may become (0 to 16). The last gene for a
    // region wins.
    { name: 'Cell type', group: 'brain', fields: [['lobe', CODEC.lobe], u('rest'), u('twitch')],
      express(v, d) { d.add('cellTypes', { lobeIdx: v.lobe, restingRate: 10 ** (-3 + 2.5 * v.rest), thrDrop: v.twitch * 16 }); },
      birthOnly: true }
  ];
  GENES.forEach(g => { g.payload = g.fields.length; });
  const GENE_INDEX = Object.fromEntries(GENES.map((g, i) => [g.name, i]));

  // Fallbacks for any trait whose gene is missing. These are not the founder's values (the founder
  // gene sets its own; e.g. learningRate here is 0.038, the founder's is 0.033)
  function defaultTraits(F) {
    return {
      hue: 30, accentHue: 45, pattern: 0, patternScale: 0.5, earSize: 0.5, tailLength: 0.5, eyeSize: 0.5, plumpness: 0.5,
      adultSize: F ? 40 : 38, legLength: 0.5, mouthReach: 8, crest: 0.5,
      visionRange: 300, opticGain: 1.0, nightVision: 0.3, noseReach: 26, scentGain: 1.0,
      baseThreshold: -52, tauLeak: 0.82, refractoryTicks: 2,
      learningRate: 0.038, traceDecay: 0.982, sproutingThreshold: 6, pruningRate: 0.035,
      joyGain: 1.45, stressGain: 1.85,
      walkSpeed: 1.3, jumpPower: 5, runBoost: 1.5,
      lifespanTicks: 30 * 60 * Evo.TICKS_PER_SECOND, gestationTicks: 5400,
      voicePitch: F ? 0.65 : 0.4, voiceLoudness: 0.7,
      habituationRate: 0.0015, noveltyGain: 8,
      insulation: 0.6, bodyHeat: 0.5,
      eggInvestment: 0.35, incubationTicks: 5400,
      axonGuidance: [], pacemakers: [], lobeDynamics: [], cellTypes: [],
      reactions: [], emitters: [], receptors: [], halfLives: {}, initial: [], instincts: [], stimuli: [],
      neurochem: Object.fromEntries(NEUROCHEMS.map(n => [n.key, n.base])),
      anatomy: {}
    };
  }

  // The sex chromosome a sex carries: X for a female, Y for a male
  const chromFor = sex => (sex === 'FEMALE' ? 'X' : 'Y');

  // The filler byte at a position of a founder's DNA: a fixed pattern (not a dice roll), so a founder
  // is the same every time. Never the gene start byte, which would switch on a gene by accident.
  const FILLER_SALT = 4242;
  const fillerAt = position => {
    const b = Math.floor(hash2(position, FILLER_SALT) * 256);
    return b === PROMOTER ? 0x5A : b;
  };

  // Encode one founder gene { gene: 'Reaction', stage: 0, ...values } into bytes (promoter included)
  function encodeGene(spec) {
    const type = GENE_INDEX[spec.gene];
    if (type === undefined) throw new Error(`Unknown gene ${spec.gene}`);
    const def = GENES[type];
    const bytes = [PROMOTER, ((spec.stage || 0) << 5) | type];
    for (const [key, codec] of def.fields) {
      if (!(key in spec)) throw new Error(`${spec.gene} gene is missing "${key}"`);
      const b = codec.encode(spec[key]);
      if (b === undefined || Number.isNaN(b) || b === -1) throw new Error(`${spec.gene} gene: bad value ${JSON.stringify(spec[key])} for "${key}" (unknown name?)`);
      bytes.push(b);
    }
    return bytes;
  }

  class Genome {
    // new Genome(bytes, sexChrom) wraps (a copy of) existing DNA; Genome.founder(sex) builds a founder
    constructor(bytes, sexChrom = null) {
      this.dna = new Uint8Array(bytes);
      this.sexChrom = sexChrom || (Evo.chance(0.5) ? 'X' : 'Y');
      this.mutationCount = 0; // Mutation events along the longest parental line since the founders
    }

    // The first female's or the first male's DNA: their genes (Evo.FOUNDER_GENOMES, see founder.js),
    // four filler bytes at the start and three after each gene. The filler is a fixed pattern of the
    // byte's position (fillerAt), so a founder is the same every time and never uses the world's dice,
    // and the two founders' DNA line up byte for byte (only their looks and voice values differ).
    // The DNA (about 3 KB) is far above MIN_LENGTH, so the padding at the end never applies; it fills
    // about a third of MAX_LENGTH (8 KB), leaving room for duplicated genes and insertions to grow into.
    static founder(sex = 'FEMALE', genes = Evo.FOUNDER_GENOMES[sex]) {
      const bytes = [];
      const filler = n => { for (let i = 0; i < n; i++) bytes.push(fillerAt(bytes.length)); };
      filler(4);
      for (const spec of genes) {
        bytes.push(...encodeGene(spec));
        filler(3);
      }
      filler(Math.max(0, MIN_LENGTH - bytes.length));
      return new Genome(Uint8Array.from(bytes), chromFor(sex));
    }

    // Locate every expressed gene in a DNA string: [start, end) spans including the promoter
    static findGenes(dna) {
      const len = dna.length, genes = [];
      let i = 0;
      while (i < len) {
        if (dna[i] !== PROMOTER || i + 1 >= len) { i++; continue; }
        const type = dna[i + 1] % TYPE_SLOTS;
        if (type >= GENES.length) { i++; continue; } // An unused type slot: silent
        const end = i + 2 + GENES[type].payload;
        if (end > len) break; // Truncated at the chromosome's end: not expressed
        genes.push({ start: i, end, type, stage: dna[i + 1] >> 5 });
        i = end;
      }
      return genes;
    }

    findGenes() {
      return Genome.findGenes(this.dna);
    }

    // The decoded values of one gene (for display)
    decode(gene) {
      const v = {};
      GENES[gene.type].fields.forEach(([key, codec], k) => { v[key] = codec.decode(this.dna[gene.start + 2 + k]); });
      return v;
    }

    // What one gene expresses on its own, as a flat record: the traits it sets, the fields of the
    // list entry it adds, { neurochem, spread }, { region, ...anatomy } or { halfLife }
    expressed(gene) {
      const x = {};
      GENES[gene.type].express(this.decode(gene), {
        F: this.sexChrom !== 'Y',
        set: (name, v) => { x[name] = v; },
        add: (list, entry) => Object.assign(x, entry),
        neurochem: (name, v) => Object.assign(x, { neurochem: name, spread: v }),
        anatomy: (region, v) => Object.assign(x, { region }, v),
        halfLife: (chem, ticks) => { x.halfLife = ticks; }
      });
      return x;
    }

    // An exact copy, including the family line's mutation count
    clone() {
      const g = new Genome(this.dna, this.sexChrom);
      g.mutationCount = this.mutationCount;
      return g;
    }

    cloneWithMutation(mutationRate = MUTATION.rate) {
      const dna = Array.from(this.dna);
      let muts = 0;

      // 1. Point mutations: mostly small shifts, sometimes a completely new byte
      for (let i = 0; i < dna.length; i++) {
        if (Evo.chance(mutationRate)) {
          dna[i] = Evo.chance(MUTATION.smallStepShare)
            ? (dna[i] + Math.floor((Evo.random() - 0.5) * MUTATION.stepWidth) + 256) % 256
            : Evo.randInt(256);
          muts++;
        }
      }

      // 2. Gene duplication: a whole expressed gene is copied to a random place (it may land
      //    inside another gene and disrupt it, as in real genomes)
      let genes = Genome.findGenes(dna);
      if (genes.length && Evo.chance(MUTATION.duplication)) {
        const g = Evo.pick(genes);
        if (dna.length + g.end - g.start <= MAX_LENGTH) {
          dna.splice(Evo.randInt(dna.length), 0, ...dna.slice(g.start, g.end));
          muts++;
          genes = Genome.findGenes(dna); // Positions moved: find the genes again
        }
      }
      // 3. Gene loss: a whole expressed gene is deleted
      if (genes.length && Evo.chance(MUTATION.deletion) && dna.length > MIN_LENGTH) {
        const g = Evo.pick(genes);
        dna.splice(g.start, g.end - g.start);
        muts++;
      }
      // 4. Small indel: one byte inserted or deleted anywhere. Inside a gene it is a frameshift
      //    that garbles that gene; in junk DNA it usually does nothing.
      if (Evo.chance(MUTATION.indel)) {
        const at = Evo.randInt(dna.length);
        if (Evo.chance(0.5) && dna.length < MAX_LENGTH) dna.splice(at, 0, Evo.randInt(256));
        else if (dna.length > MIN_LENGTH) dna.splice(at, 1);
        muts++;
      }

      const child = new Genome(Uint8Array.from(dna), this.sexChrom);
      child.mutationCount = this.mutationCount + muts;
      return child;
    }

    // Haploid recombination: two random crossover points, either parent as the backbone.
    // The father's sperm carries X or Y with equal odds.
    static recombine(mother, father) {
      const [base, donor] = Evo.chance(0.5) ? [mother, father] : [father, mother];
      const dna = new Uint8Array(base.dna);
      const minLen = Math.min(mother.dna.length, father.dna.length);
      let a = Evo.randInt(minLen), b = Evo.randInt(minLen);
      if (a > b) [a, b] = [b, a];
      for (let i = a; i < b; i++) dna[i] = donor.dna[i];

      const child = new Genome(dna, null);
      child.mutationCount = Math.max(mother.mutationCount, father.mutationCount);
      return child.cloneWithMutation();
    }

    // Build the traits of a creature at a life stage: every gene whose switch-on stage has been
    // reached (stages 0 and 1 are both "from birth"). Genes marked birthOnly (anatomy,
    // membrane, neurochemistry, lobe dynamics, cell type) still appear in later traits, but the
    // brain only reads them when it is built, so a copy that switches on after birth has no effect.
    // Each list entry records the gene it came from (`gene`: its start offset, and its `stage`), so
    // callers can tell which ones are new at a later stage, and the gene's own dice (`dice`): a whole
    // number for whatever it builds by chance (the brain grows a wiring gene's connections with it).
    // The dice are made from the gene's bytes (its header and values), not from where it sits, so
    // moving it or changing another gene leaves them as they were, and from how many identical genes
    // came before it, so each copy of a doubled gene rolls its own dice.
    develop(stage = 1) {
      const sex = this.sexChrom === 'Y' ? 'MALE' : 'FEMALE';
      const F = sex === 'FEMALE';
      const traits = defaultTraits(F);
      traits.sex = sex;

      const acc = {}, chemAcc = {}, anatomyAcc = {};
      const push = (table, key, v) => { (table[key] = table[key] || []).push(v); };
      const copies = new Map(); // How many genes with these exact bytes so far, by their bytes
      for (const gene of this.findGenes()) {
        if (gene.stage > Math.max(1, stage)) continue;
        const bytes = this.dna.subarray(gene.start + 1, gene.end), key = bytes.join(',');
        const before = copies.get(key) || 0;
        copies.set(key, before + 1);
        const dice = fixedNumber([before, ...bytes]);
        GENES[gene.type].express(this.decode(gene), {
          F,
          set: (name, v) => push(acc, name, v),
          add: (list, entry) => traits[list].push({ ...entry, gene: gene.start, stage: gene.stage, dice }),
          neurochem: (name, v) => push(chemAcc, name, v),
          anatomy: (region, v) => push(anatomyAcc, region, v),
          halfLife: (chem, ticks) => { traits.halfLives[chem] = ticks; }
        });
      }

      // Gene dosage: several copies of a gene average their values (co-dominance)
      for (const name in acc) traits[name] = mean(acc[name]);
      for (const chem in chemAcc) traits.neurochem[chem] = mean(chemAcc[chem]);
      for (const region in anatomyAcc) {
        const list = anatomyAcc[region];
        traits.anatomy[region] = {
          shift: mean(list.map(a => a.shift)), lateral: mean(list.map(a => a.lateral)),
          size: mean(list.map(a => a.size)), count: mean(list.map(a => a.count))
        };
      }
      traits.refractoryTicks = Math.round(traits.refractoryTicks);
      traits.pattern = Math.round(traits.pattern);
      return traits;
    }
  }

  Object.assign(Evo, { GENOME_LIMITS, Genome, chromFor, GENES, GENE_INDEX, CODEC, FLAG, flagsOf, GENE_NONE, GUIDANCE, TRAIT_RANGES, encodeGene });
})(globalThis.Evo);
