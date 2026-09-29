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
  const { mean, clamp } = Evo.util;
  const { LOBE_ORDER, LOBE_COUNT, N_CHEM, CHEM, LOCUS, BODY_LOCI, TARGET, TARGETS, NEUROCHEMS } = Evo;

  const PROMOTER = 0xA5;
  const TYPE_SLOTS = 32;
  const MIN_LENGTH = 256;
  const MAX_LENGTH = 2400;

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
    rate: { decode: b => Math.pow(10, -6 + 5 * b / 255), encode: k => byte((Math.log10(k) + 6) / 5 * 255) },
    // Product yield, 0..~4
    yield: { decode: b => b / 64, encode: v => byte(v * 64) },
    // Emitter output per tick at full signal, 0..0.05 (quadratic, for fine control of small rates)
    emit: { decode: b => (b / 255) ** 2 * 0.05, encode: v => byte(Math.sqrt(v / 0.05) * 255) },
    // Receptor gain, 0..4
    gain: { decode: b => b / 64, encode: v => byte(v * 64) },
    // Half-life in ticks: 2^(b/16) (1 tick .. ~16 minutes); 255 = never decays
    halfLife: { decode: b => (b === 255 ? Infinity : Math.pow(2, b / 16)), encode: t => (t === Infinity ? 255 : byte(Math.log2(t) * 16)) }
  };
  const flagsOf = b => ({ invert: !!(b & 1), digital: !!(b & 2), negative: !!(b & 4) });
  const u = key => [key, CODEC.unit];

  // Axon guidance source byte: bits 0-3 lobe, bit 4 x relative to the source's own tag,
  // bit 5 y relative, bit 6 x mirrored (a crossed projection)
  const guidanceSource = {
    decode: b => ({ lobe: (b & 15) % LOBE_COUNT, relX: !!(b & 16), relY: !!(b & 32), mirrorX: !!(b & 64) }),
    encode: v => LOBE_ORDER.indexOf(v.lobe) | (v.relX ? 16 : 0) | (v.relY ? 32 : 0) | (v.mirrorX ? 64 : 0)
  };

  // One row per gene type. fields: [name, codec] per payload byte, in order.
  // express(v, d): what the gene builds from its decoded values v.
  //   d.set(trait, value) votes for a trait (several copies of a gene average: co-dominance);
  //   d.add(list, entry) appends to a list trait; d.F is true for females.
  // describe(v, x, w) (optional): the gene in plain words, as { group, text }. v = decoded values,
  //   x = what this one gene expresses (Genome.expressed), w = word helpers from Evo.text. Genes
  //   without one are listed as 'body' genes showing their expressed traits.
  // birthOnly: the brain reads these traits only when it is built, so a copy that switches on at
  //   a later life stage has no effect.
  const GENES = [
    { name: 'Appearance', fields: [u('hue'), u('accentHue'), u('pattern'), u('patternScale'), u('earSize'), u('tailLength'), u('eyeSize'), u('plumpness')],
      express(v, d) {
        d.set('hue', v.hue * 360); d.set('accentHue', v.accentHue * 360); d.set('pattern', Math.min(3, Math.floor(v.pattern * 4)));
        for (const k of ['patternScale', 'earSize', 'tailLength', 'eyeSize', 'plumpness']) d.set(k, v[k]);
      } },
    { name: 'Morphology', fields: [u('size'), u('legLength'), u('mouthReach'), u('crest')],
      express(v, d) {
        d.set('adultSize', (d.F ? 32 : 30) + v.size * 16);      // Adult body length, px
        d.set('legLength', v.legLength);
        d.set('mouthReach', 4 + v.mouthReach * 8);
        d.set('crest', v.crest);
      } },
    { name: 'Eyes', fields: [u('range'), u('gain'), u('night')],
      express(v, d) { d.set('visionRange', 180 + v.range * 280); d.set('opticGain', 0.6 + v.gain); d.set('nightVision', v.night); } },
    { name: 'Nose', fields: [u('reach'), u('gain')],
      express(v, d) { d.set('noseReach', 14 + v.reach * 30); d.set('scentGain', 0.6 + v.gain); } },
    { name: 'Membrane', fields: [u('threshold'), u('leak'), u('refractory')],
      express(v, d) { d.set('baseThreshold', -58 + v.threshold * 10); d.set('tauLeak', 0.72 + v.leak * 0.19); d.set('refractoryTicks', 1 + v.refractory * 2); },
      describe: (v, x, w) => ({ group: 'brain', text: `Neurons fire at ${w.num(x.baseThreshold, 0)} mV` }),
      birthOnly: true },
    { name: 'Plasticity', fields: [u('rate'), u('memory'), u('sprouting'), u('pruning')],
      express(v, d) {
        d.set('learningRate', 0.018 + v.rate * 0.045);
        d.set('traceDecay', 0.88 + v.memory * 0.115); // Eligibility half-life from ~5 to ~140 ticks
        d.set('sproutingThreshold', 3 + v.sprouting * 7);
        d.set('pruningRate', 0.02 + v.pruning * 0.03);
      },
      describe: (v, x, w) => ({ group: 'brain', text: `Learns at rate ${w.num(x.learningRate, 3)}; a memory trace halves in ${w.num(Math.log(0.5) / Math.log(x.traceDecay), 0)} ticks` }) },
    { name: 'Reinforcement', fields: [u('joy'), u('stress')],
      express(v, d) { d.set('joyGain', 0.9 + v.joy * 1.3); d.set('stressGain', 1.1 + v.stress * 1.6); },
      describe: (v, x, w) => ({ group: 'brain', text: `Feels reward ×${w.num(x.joyGain)}, stress ×${w.num(x.stressGain)}` }) },
    { name: 'Muscle', fields: [u('speed'), u('jump'), u('run')],
      express(v, d) { d.set('walkSpeed', 0.8 + v.speed * 1.0); d.set('jumpPower', 3.5 + v.jump * 3.5); d.set('runBoost', 1.2 + v.run * 0.8); } },
    { name: 'Life history', fields: [u('lifespan'), u('gestation')],
      express(v, d) { d.set('lifespanTicks', (20 + v.lifespan * 24) * 60 * 60); d.set('gestationTicks', 3000 + v.gestation * 6000); },
      describe: (v, x, w) => ({ group: 'body', text: `Lives about ${w.seconds(x.lifespanTicks)}; carries an egg for ${w.seconds(x.gestationTicks)}` }) },
    { name: 'Voice', fields: [u('pitch'), u('loudness')],
      express(v, d) { d.set('voicePitch', v.pitch); d.set('voiceLoudness', 0.4 + v.loudness * 0.6); } },
    { name: 'Curiosity', fields: [u('habituation'), u('novelty')],
      express(v, d) { d.set('habituationRate', 0.0005 + v.habituation * 0.004); d.set('noveltyGain', 4 + v.novelty * 8); },
      describe: (v, x, w) => ({ group: 'brain', text: `Gets used to things at rate ${w.num(x.habituationRate, 4)}, loves novelty ×${w.num(x.noveltyGain, 1)}` }) },
    { name: 'Anatomy', fields: [['region', CODEC.lobe], u('shift'), u('lateral'), u('size'), u('count')],
      express(v, d) {
        d.anatomy(LOBE_ORDER[v.region], { shift: (v.shift - 0.5) * 0.3, lateral: 0.6 + v.lateral * 0.8, size: 0.6 + v.size * 0.9, count: 0.5 + v.count * 1.1 });
      },
      describe: (v, x, w) => ({ group: 'brain', text: `${w.lobe(v.region)} region: ${w.percent(x.count)} cells, ${w.percent(x.size)} size` }),
      birthOnly: true },
    { name: 'Region duplication', fields: [['source', CODEC.lobe], u('depth'), u('lateral'), u('chemShift'), u('input')],
      express(v, d) {
        d.add('duplications', {
          sourceLobeIdx: v.source,
          depth: 0.45 + v.depth * 0.45,       // Where the copy sits, front (0) to back (1)
          lateral: 0.6 + v.lateral * 0.8,     // Narrower or wider than the original
          chemShift: (v.chemShift - 0.5) * 0.8, // How far its chemical identity drifts from the original
          inputWeight: 0.3 + v.input * 0.6    // Strength of the in-register input from the original
        });
      },
      describe: (v, x, w) => ({ group: 'brain', text: `A copy of the ${w.lobe(v.source).toLowerCase()} region` }),
      birthOnly: true },
    { name: 'Axon guidance', fields: [['source', guidanceSource], u('tx'), u('ty'), u('tz'), u('radius'), ['sign', CODEC.raw], u('reach'), u('conduction')],
      express(v, d) {
        d.add('axonGuidance', {
          source: v.source,
          target: [v.tx, v.ty, v.tz],        // Receptor chemistry sought (x/y relative to the source's own tag if relX/relY)
          affinityRadius: 0.04 + v.radius * 0.76,
          // Sign and strength: bytes above 120 are excitatory, below inhibitory, stronger the
          // further from 120 they are (0.2 .. 1.0 either way)
          weightSign: (v.sign > 120 ? 1 : -1) * Math.min(1.0, 0.2 + Math.abs(v.sign - 120) / 100),
          reach: 0.15 + v.reach * 1.35,      // How far these axons can grow (brain widths)
          conduction: 0.08 + v.conduction * 0.50 // Myelination: distance per tick
        });
      },
      describe(v, x, w) {
        const src = x.source, map = src.relX || src.relY ? (src.mirrorX ? ', crossed map' : ', mapped') : '';
        const [tx, ty, tz] = x.target.map(t => w.num(t));
        return { group: 'brain', text: `${w.lobe(src.lobe)} axons seek (${tx}, ${ty}, ${tz})${map}, ${x.weightSign > 0 ? 'exciting' : 'inhibiting'}` };
      } },
    { name: 'Pacemaker', fields: [['lobe', CODEC.lobe], u('bias')],
      express(v, d) { d.add('pacemakers', { lobeIdx: v.lobe, bias: v.bias * 3.0 }); },
      describe: (v, x, w) => ({ group: 'brain', text: `${w.lobe(x.lobeIdx)} cells fire on their own (+${w.num(x.bias)} mV)` }) },
    { name: 'Neurochemistry', fields: [['chem', CODEC.raw], u('spread')],
      express(v, d) { d.neurochem(NEUROCHEMS[v.chem % NEUROCHEMS.length].key, v.spread); },
      describe: (v, x, w) => ({ group: 'brain', text: `${NEUROCHEMS.find(n => n.key === x.neurochem).word} chemical spreads ${w.percent(x.spread)}` }),
      birthOnly: true },
    { name: 'Reaction', fields: [['a', CODEC.chem], ['b', CODEC.chem], ['c', CODEC.chem], ['d', CODEC.chem], ['rate', CODEC.rate], ['yieldC', CODEC.yield], ['yieldD', CODEC.yield]],
      express(v, d) { if (v.a) d.add('reactions', v); },
      describe(v, x, w) {
        const lhs = [v.a, v.b].filter(Boolean).map(w.chem).join(' + ');
        const rhs = [[v.c, v.yieldC], [v.d, v.yieldD]].filter(([c, y]) => c && y > 0).map(([c]) => w.chem(c)).join(' + ');
        return { group: 'chemistry', text: `${lhs || 'nothing'} → ${rhs || 'nothing'}` };
      } },
    { name: 'Emitter', fields: [['locus', CODEC.locus], ['chem', CODEC.chem], u('threshold'), ['gain', CODEC.emit], ['flags', CODEC.raw]],
      express(v, d) { if (v.chem) d.add('emitters', { ...v, ...flagsOf(v.flags) }); },
      describe: (v, x, w) => ({ group: 'chemistry', text: `${flagsOf(v.flags).invert ? 'Too little' : 'Enough'} ${w.locus(v.locus)} releases ${w.chem(v.chem).toLowerCase()}` }) },
    { name: 'Receptor', fields: [['chem', CODEC.chem], ['target', CODEC.target], u('threshold'), ['gain', CODEC.gain], ['flags', CODEC.raw]],
      express(v, d) { if (v.chem && v.target) d.add('receptors', { ...v, ...flagsOf(v.flags) }); },
      describe(v, x, w) {
        const f = flagsOf(v.flags), chem = f.invert ? `Lack of ${w.chem(v.chem).toLowerCase()}` : w.chem(v.chem);
        return { group: 'chemistry', text: `${chem} ${f.negative ? 'lowers' : 'raises'} ${w.target(v.target)}` };
      } },
    { name: 'Half-life', fields: [['chem', CODEC.chem], ['halfLife', CODEC.halfLife]],
      express(v, d) { if (v.chem) d.halfLife(v.chem, v.halfLife); },
      describe: (v, x, w) => ({ group: 'chemistry', text: v.halfLife === Infinity ? `${w.chem(v.chem)} never fades` : `${w.chem(v.chem)} halves in ${w.seconds(v.halfLife)}` }) },
    { name: 'Initial concentration', fields: [['chem', CODEC.chem], u('amount')],
      express(v, d) { if (v.chem) d.add('initial', v); },
      describe: (v, x, w) => ({ group: 'chemistry', text: `Born with ${w.percent(v.amount)} ${w.chem(v.chem).toLowerCase()}` }) },
    { name: 'Instinct', fields: [['lobeA', CODEC.lobe], ['indexA', CODEC.raw], ['lobeB', CODEC.lobe], ['indexB', CODEC.raw], ['motor', CODEC.raw], ['chem', CODEC.chem], u('amount')],
      express(v, d) { d.add('instincts', v); },
      describe(v, x, w) {
        const inputs = [w.cell(v.lobeA, v.indexA), w.cell(v.lobeB, v.indexB)].filter(Boolean).join(' + ');
        const motor = Evo.MOTORS[v.motor % Evo.MOTORS.length].word.toLowerCase();
        return { group: 'instinct', text: `Dreams: ${inputs || 'nothing'} → ${motor}, feels ${w.chem(v.chem).toLowerCase()}` };
      } },
    { name: 'Insulation', fields: [u('insulation'), u('bodyHeat')],
      express(v, d) { d.set('insulation', 0.3 + v.insulation * 0.6); d.set('bodyHeat', v.bodyHeat); } },
    { name: 'Reproduction', fields: [u('investment'), u('incubation')],
      express(v, d) { d.set('eggInvestment', 0.2 + v.investment * 0.4); d.set('incubationTicks', 3000 + v.incubation * 6000); },
      describe: (v, x, w) => ({ group: 'body', text: `Puts ${w.percent(x.eggInvestment)} into each egg, which hatches in about ${w.seconds(x.incubationTicks)}` }) }
  ];
  GENES.forEach(g => { g.payload = g.fields.length; });
  const GENE_INDEX = Object.fromEntries(GENES.map((g, i) => [g.name, i]));

  // Defaults for any trait whose gene is missing
  function defaultTraits(F) {
    return {
      hue: 30, accentHue: 45, pattern: 0, patternScale: 0.5, earSize: 0.5, tailLength: 0.5, eyeSize: 0.5, plumpness: 0.5,
      adultSize: F ? 40 : 38, legLength: 0.5, mouthReach: 8, crest: 0.5,
      visionRange: 300, opticGain: 1.0, nightVision: 0.3, noseReach: 26, scentGain: 1.0,
      baseThreshold: -52, tauLeak: 0.82, refractoryTicks: 2, membraneNoise: 0.35,
      learningRate: 0.038, traceDecay: 0.94, sproutingThreshold: 6, pruningRate: 0.035,
      joyGain: 1.45, stressGain: 1.85,
      walkSpeed: 1.3, jumpPower: 5, runBoost: 1.5,
      lifespanTicks: 30 * 60 * 60, gestationTicks: 5400,
      voicePitch: F ? 0.65 : 0.4, voiceLoudness: 0.7,
      habituationRate: 0.0015, noveltyGain: 8,
      insulation: 0.6, bodyHeat: 0.5,
      eggInvestment: 0.35, incubationTicks: 5400,
      axonGuidance: [], pacemakers: [], duplications: [],
      reactions: [], emitters: [], receptors: [], halfLives: {}, initial: [], instincts: [],
      neurochem: Object.fromEntries(NEUROCHEMS.map(n => [n.key, n.base])),
      anatomy: {}
    };
  }

  const junkByte = () => { const b = Evo.randInt(256); return b === PROMOTER ? 0x5A : b; };

  // Encode one founder gene { gene: 'Reaction', stage: 0, ...values } into bytes (promoter included)
  function encodeGene(spec) {
    const type = GENE_INDEX[spec.gene];
    if (type === undefined) throw new Error(`Unknown gene ${spec.gene}`);
    const def = GENES[type];
    const bytes = [PROMOTER, ((spec.stage || 0) << 5) | type];
    for (const [key, codec] of def.fields) {
      if (!(key in spec)) throw new Error(`${spec.gene} gene is missing "${key}"`);
      bytes.push(codec.encode(spec[key]));
    }
    return bytes;
  }

  class Genome {
    // new Genome(bytes, sexChrom) wraps (a copy of) existing DNA; Genome.founder() builds a founder
    constructor(bytes, sexChrom = null) {
      this.dna = new Uint8Array(bytes);
      this.sexChrom = sexChrom || (Evo.chance(0.5) ? 'X' : 'Y');
      this.mutationCount = 0; // Mutation events along the longest parental line since the founders
    }

    // Founder genes (Evo.FOUNDER_GENOME, see founder.js).separated by a few junk bytes, then junk
    // padding. The chromosome is sized to hold every founder gene.
    static founder(sexChrom = null, genes = Evo.FOUNDER_GENOME) {
      const bytes = [];
      const junk = n => { for (let i = 0; i < n; i++) bytes.push(junkByte()); };
      junk(4);
      for (const spec of genes) {
        bytes.push(...encodeGene(spec));
        junk(2 + Evo.randInt(3));
      }
      junk(Math.max(0, MIN_LENGTH - bytes.length));
      return new Genome(Uint8Array.from(bytes), sexChrom);
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

    cloneWithMutation(mutationRate = 0.004, allowIndels = true) {
      const dna = Array.from(this.dna);
      let muts = 0;

      // 1. Point mutations: mostly small shifts, sometimes a completely new byte
      for (let i = 0; i < dna.length; i++) {
        if (Evo.chance(mutationRate)) {
          dna[i] = Evo.chance(0.8)
            ? (dna[i] + Math.floor((Evo.random() - 0.5) * 48) + 256) % 256
            : Evo.randInt(256);
          muts++;
        }
      }

      if (allowIndels) {
        // 2. Gene duplication: a whole expressed gene is copied to a random place (it may land
        //    inside another gene and disrupt it, as in real genomes)
        let genes = Genome.findGenes(dna);
        if (genes.length && Evo.chance(0.03) && dna.length < MAX_LENGTH) {
          const g = Evo.pick(genes);
          dna.splice(Evo.randInt(dna.length), 0, ...dna.slice(g.start, g.end));
          muts++;
          genes = Genome.findGenes(dna); // Positions moved: find the genes again
        }
        // 3. Gene loss: a whole expressed gene is deleted
        if (genes.length && Evo.chance(0.02) && dna.length > MIN_LENGTH) {
          const g = Evo.pick(genes);
          dna.splice(g.start, g.end - g.start);
          muts++;
        }
        // 4. Small indel: one byte inserted or deleted anywhere. Inside a gene it is a frameshift
        //    that garbles that gene; in junk DNA it usually does nothing.
        if (Evo.chance(0.02)) {
          const at = Evo.randInt(dna.length);
          if (Evo.chance(0.5) && dna.length < MAX_LENGTH) dna.splice(at, 0, Evo.randInt(256));
          else if (dna.length > MIN_LENGTH) dna.splice(at, 1);
          muts++;
        }
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

      const child = new Genome(dna, Evo.chance(0.5) ? 'X' : 'Y');
      child.mutationCount = Math.max(mother.mutationCount, father.mutationCount);
      return child.cloneWithMutation();
    }

    // Build the traits of a creature at a life stage: every gene whose switch-on stage has been
    // reached (stages 0 and 1 are both "from birth"). Genes marked birthOnly (anatomy, region
    // duplication, membrane, neurochemistry) still appear in later traits, but the brain only reads
    // them when it is built, so a copy that switches on after birth has no effect. Each list entry records the gene it came
    // from (`gene`: its start offset), so callers can tell which ones are new at a later stage.
    develop(stage = 1) {
      const sex = this.sexChrom === 'Y' ? 'MALE' : 'FEMALE';
      const F = sex === 'FEMALE';
      const traits = defaultTraits(F);
      traits.sex = sex;

      const acc = {}, chemAcc = {}, anatomyAcc = {};
      const push = (table, key, v) => { (table[key] = table[key] || []).push(v); };
      for (const gene of this.findGenes()) {
        if (gene.stage > Math.max(1, stage)) continue;
        GENES[gene.type].express(this.decode(gene), {
          F, traits,
          set: (name, v) => push(acc, name, v),
          add: (list, entry) => traits[list].push({ ...entry, gene: gene.start, stage: gene.stage }),
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

  Object.assign(Evo, { Genome, GENES, GENE_INDEX, PROMOTER, CODEC, encodeGene });
})(globalThis.Evo);
