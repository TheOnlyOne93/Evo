// Permissive bytecode genome (evo-devo grammar).
// Promoter-driven gene expression. Every byte string is a valid genome: a gene is expressed only
// where a promoter byte sits in front of it, and everything else is silent (junk) DNA that
// mutates freely. A point mutation can create a promoter (switching on a brand-new gene) or
// destroy one (silencing a gene). A frameshift garbles only the gene it lands in. Every decoded
// value is clamped by construction, so a broken gene makes a bad organism, never a broken
// simulation. Sex is carried on its own chromosome (X or Y), outside the mutable gene string.
(function (Evo) {
  'use strict';
  const { mean } = Evo.util;
  const { LOBE_ORDER, LOBE_COUNT } = Evo;

  const PROMOTER = 0xA5;
  const MIN_LENGTH = 96;
  const MAX_LENGTH = 768;
  const FOUNDER_MIN_LENGTH = 256;

  // One row per gene type (the type is the byte after the promoter, modulo the table length).
  //   payload: bytes that follow the type byte
  //   express(d): what the gene builds. d.q(k) is payload byte k scaled to [0, 1], d.raw(k) the
  //   byte itself, d.F is true for females, d.set(trait, value) votes for a trait value.
  const GENES = [
    { name: 'Morphology', payload: 3, express(d) {
      d.set('radius', (d.F ? 14.0 : 12.0) + d.q(0) * 5.5);
      d.set('exoskeletonDrag', 0.84 + d.q(1) * 0.08);
      d.set('mouthRadius', 5.0 + d.q(2) * 7.0);
      d.set('coatColorHue', d.q(0) * 360);
    } },
    { name: 'Antennae', payload: 3, express(d) {
      d.set('antennaLength', (d.F ? 20.0 : 26.0) + d.q(0) * 14.0);
      d.set('antennaSpread', 0.40 + d.q(1) * 0.28);
      d.set('scentGain', 0.6 + d.q(2) * 1.0);
    } },
    { name: 'Optics', payload: 3, express(d) { // Optics & receptive fields
      d.set('visionRange', 210.0 + d.q(0) * 90.0);
      d.set('visionAperture', 0.24 + d.q(1) * 0.16);
      d.set('opticGain', 0.6 + d.q(2) * 1.0);
    } },
    { name: 'Membrane', payload: 3, express(d) { // Membrane biophysics
      d.set('baseThreshold', -58.0 + d.q(0) * 10.0);
      d.set('tauLeak', 0.72 + d.q(1) * 0.19);
      d.set('refractoryTicks', 1 + d.q(2) * 2);
    } },
    { name: 'Energetics', payload: 2, express(d) { // Energetics & spike economy
      d.set('spikeEnergyCost', 0.00002 + d.q(0) * 0.00005);
      d.set('basalCost', (d.F ? 0.0006 : 0.0007) + d.q(1) * 0.0004);
    } },
    { name: 'Enzymes', payload: 4, express(d) { // Digestive enzymes
      d.set('amylaseRate', 0.0018 + d.q(0) * 0.0036);
      d.set('lipolysisEfficiency', 0.6 + d.q(1) * 0.35);
      d.set('combustionSpeed', 0.003 + d.q(2) * 0.0036);
      d.set('lipogenesisRate', 0.001 + d.q(3) * 0.002);
    } },
    { name: 'Osmoregulation', payload: 2, express(d) {
      d.set('waterDrainRate', 0.0012 + d.q(0) * 0.0010);
      d.set('dehydrationTolerance', 0.7 + d.q(1) * 0.3);
    } },
    { name: 'Detox', payload: 2, express(d) { // Liver detoxification
      d.set('detoxRate', 0.014 + d.q(0) * 0.026);
      d.set('toxinResistance', 0.75 + d.q(1) * 0.50);
    } },
    { name: 'Plasticity', payload: 4, express(d) { // Meta-plasticity
      d.set('learningRate', 0.018 + d.q(0) * 0.045);
      d.set('traceDecay', 0.88 + d.q(1) * 0.115); // Eligibility half-life from ~5 to ~140 ticks
      d.set('sproutingThreshold', 3.0 + d.q(2) * 7.0);
      d.set('pruningRate', 0.02 + d.q(3) * 0.03);
    } },
    { name: 'Reinforcement', payload: 2, express(d) { // Reinforcement sensitivity
      d.set('joyGain', 0.9 + d.q(0) * 1.3);
      d.set('stressGain', 1.1 + d.q(1) * 1.6);
    } },
    { name: 'Muscle', payload: 3, express(d) {
      d.set('speedMult', (d.F ? 0.92 : 1.05) + d.q(0) * 0.35);
      d.set('turnAgility', 0.038 + d.q(1) * 0.024);
      d.set('burstFactor', 1.2 + d.q(2) * 0.6);
    } },
    { name: 'Life history', payload: 2, express(d) {
      d.set('maturityAgeSeconds', 18.0 + d.q(0) * 22.0);
      d.set('maxLifespanSeconds', 220.0 + d.q(1) * 180.0);
    } },
    { name: 'Endocrine', payload: 3, express(d) { // Endocrine sensitivity
      d.set('ghrelinGain', 0.7 + d.q(0) * 0.6);
      d.set('leptinGain', 0.7 + d.q(1) * 0.6);
      d.set('crowdingSensitivity', 0.7 + d.q(2) * 0.8);
    } },
    { name: 'Pheromone', payload: 2, express(d) { // How much, and what share is the long-lasting trail form
      d.set('pheromoneEmissionRate', (d.F ? 0.09 : 0.05) + d.q(0) * 0.08);
      d.set('trailFraction', d.q(1));
    } },
    { name: 'Anomaly', payload: 2, express(d) { // Metabolic anomaly (effects compound, within limits)
      if (d.q(0) < 0.12) d.anomaly.noiseAdd += 0.25;
      if (d.q(1) < 0.10) d.anomaly.basalMul *= 1.4;
      if (d.q(0) > 0.88 && d.q(1) > 0.88) d.anomaly.spikeMul *= 0.65;
    } },
    { name: 'Axon guidance', payload: 8, express(d) { // Axon guidance rule
      d.traits.axonGuidanceTags.push({
        sourceLobeIdx: d.raw(0) % LOBE_COUNT,
        targetVector: [d.q(1), d.q(2), d.q(3)],
        affinityRadius: 0.2 + d.q(4) * 0.6,
        // Sign and strength: bytes above 120 are excitatory, stronger the higher they go
        weightSign: d.raw(5) > 120 ? Math.min(1.0, 0.2 + (d.raw(5) - 120) / 100) : -0.80,
        reach: 0.15 + d.q(6) * 0.85,        // How far these axons can grow (brain widths)
        conduction: 0.08 + d.q(7) * 0.50    // Myelination: distance per tick
      });
    } },
    { name: 'Pacemaker', payload: 2, express(d) { // Steady depolarizing current for a whole lobe
      d.traits.pacemakers.push({ lobeIdx: d.raw(0) % LOBE_COUNT, bias: d.q(1) * 3.0 });
    } },
    { name: 'Neurochemistry', payload: 2, express(d) { // How far a brain chemical spreads before breaking down
      d.chem(['DA', 'ST', 'NO'][d.raw(0) % 3], d.q(1));
    } },
    { name: 'Anatomy', payload: 5, express(d) { // Region, depth shift, width, size, neuron count
      d.anatomy(LOBE_ORDER[d.raw(0) % LOBE_COUNT], {
        shift: (d.q(1) - 0.5) * 0.3, lateral: 0.6 + d.q(2) * 0.8, size: 0.6 + d.q(3) * 0.9, count: 0.5 + d.q(4) * 1.1
      });
    } },
    { name: 'Reproduction', payload: 2, express(d) { // Reproductive investment
      d.set('parentalDowryRatio', (d.F ? 0.20 : 0.10) + d.q(0) * 0.30);
      d.set('estrusCooldownTicks', (d.F ? 420 : 260) + d.q(1) * 320);
    } },
    { name: 'Curiosity', payload: 2, express(d) { // How fast boredom builds, and how fast senses get used to things
      d.set('boredomRate', 0.0002 + d.q(0) * 0.0012);
      d.set('habituationRate', 0.0005 + d.q(1) * 0.004);
    } },
    { name: 'Region duplication', payload: 5, express(d) { // Copy a region; the copy starts wired in register
      d.traits.duplications.push({
        sourceLobeIdx: d.raw(0) % LOBE_COUNT,
        depth: 0.45 + d.q(1) * 0.45,        // Where the copy sits, front (0) to back (1)
        lateral: 0.6 + d.q(2) * 0.8,        // Narrower or wider than the original
        chemShift: (d.q(3) - 0.5) * 0.8,    // How far its chemical identity drifts from the original
        inputWeight: 0.3 + d.q(4) * 0.6     // Strength of the in-register input from the original
      });
    } }
  ];
  const GENE_INDEX = Object.fromEntries(GENES.map((g, i) => [g.name, i]));

  // Defaults for any trait whose gene is missing
  function defaultTraits(F) {
    return {
      radius: F ? 16.0 : 13.8, exoskeletonDrag: 0.88, mouthRadius: 8.0,
      coatColorHue: 180,
      antennaLength: F ? 25.0 : 32.0, antennaSpread: F ? 0.48 : 0.62, scentGain: 1.0,
      visionRange: 260.0, visionAperture: 0.32, opticGain: 1.0,
      baseThreshold: -52.0, tauLeak: 0.82, refractoryTicks: 2, spikeEnergyCost: 0.00004, membraneNoise: 0.35,
      basalCost: 0.0009, combustionSpeed: 0.0048, lipogenesisRate: 0.0020,
      amylaseRate: 0.0032, lipolysisEfficiency: 0.8,
      waterDrainRate: 0.0016, dehydrationTolerance: 0.85,
      detoxRate: 0.024, toxinResistance: 1.0,
      learningRate: 0.038, traceDecay: 0.94, sproutingThreshold: 6.0, pruningRate: 0.035,
      joyGain: 1.45, stressGain: 1.85,
      speedMult: 1.0, turnAgility: 0.048, burstFactor: 1.45,
      maturityAgeSeconds: 28.0, maxLifespanSeconds: 300.0,
      parentalDowryRatio: F ? 0.35 : 0.20, estrusCooldownTicks: F ? 580 : 360,
      ghrelinGain: 1.0, leptinGain: 1.0, crowdingSensitivity: 1.0,
      boredomRate: 0.0006, habituationRate: 0.0015,
      pheromoneEmissionRate: F ? 0.12 : 0.08, trailFraction: 0.3,
      axonGuidanceTags: [], pacemakers: [], duplications: [],
      neurochem: { DA: 0.5, ST: 0.5, NO: 0.15 },
      anatomy: {}
    };
  }

  // Primordial founder genome. These are ordinary genes behind ordinary promoters: they mutate,
  // duplicate, recombine and can be lost. Each is [type, ...payload].
  const G = GENE_INDEX;
  const FOUNDER_GENES = [
    [G['Morphology'], 0x80, 0x70, 0x80],             // Size, drag, mouth reach
    [G['Antennae'], 0x75, 0x60, 102],                // Length, spread, smell sensitivity
    [G['Optics'], 0x85, 0x55, 102],                  // Range, field of view, eye sensitivity
    [G['Membrane'], 0x70, 0x80, 0x80],               // Threshold, leak, refractory period
    [G['Energetics'], 0x60, 0x50],
    [G['Enzymes'], 0x75, 0x65, 128, 128],            // Starch digestion, fat burning, sugar burning, fat storing
    [G['Plasticity'], 0x55, 0x70, 109, 128],         // Learning rate, memory span, sprouting, pruning
    [G['Life history'], 0x66, 0x99],                 // Maturity, lifespan
    [G['Reproduction'], 0x80, 0x80],                 // Parental investment, estrus cooldown
    [G['Pheromone'], 0x66, 0x4D],                    // Emission rate, trail share (~30% long-lasting)
    // Axon guidance: source lobe, target chemistry x3, affinity radius, sign, reach, myelination
    [G['Axon guidance'], 0, 128, 128, 230, 250, 200, 120, 112],  // Vision -> motor (same-side favoured by distance)
    [G['Axon guidance'], 1, 128, 128, 230, 250, 200, 120, 112],  // Olfaction -> motor
    [G['Axon guidance'], 3, 128, 128, 25, 250, 200, 105, 90],    // Hypothalamus -> limbic
    [G['Axon guidance'], 4, 128, 51, 230, 43, 200, 165, 112],    // Limbic -> forward thrust & jaws
    [G['Axon guidance'], 4, 128, 128, 180, 250, 200, 200, 180],  // Limbic modulatory projection (broad, fast)
    [G['Pacemaker'], 8, 77],                                     // Pacemaker on the motor lobe
    [G['Region duplication'], 8, 255, 128, 128, 234],            // Copy of the movement lobe: an efference copy of every command
    // Anticipation: smell reaches the joy and stress neurons, weakly at first. These synapses learn
    // what each smell predicts, so smells can come to trigger joy or fear.
    [G['Axon guidance'], 1, 51, 230, 25, 21, 135, 225, 200],     // Olfaction -> joy neuron
    [G['Axon guidance'], 1, 230, 51, 25, 21, 135, 225, 200],     // Olfaction -> stress neuron
    [G['Axon guidance'], 2, 128, 25, 230, 43, 220, 225, 200],    // Innate reflex: touch -> jaws
    [G['Curiosity'], 0x80, 0x80],                                // Boredom and habituation rates
    // Duplicated sensory maps placed just in front of the motor area. Geometry alone should wire
    // each side of these copies to the same-side muscles (a tectum-like orienting map).
    [G['Region duplication'], 0, 176, 128, 128, 234],            // Copy of the visual map
    [G['Region duplication'], 1, 142, 128, 128, 234]             // Copy of the smell map
  ];

  // A random junk byte that is never a promoter
  const junkByte = () => { const b = Evo.randInt(256); return b === PROMOTER ? 0x5A : b; };

  class Genome {
    // new Genome() builds a founder; new Genome(bytes, sexChrom) wraps (a copy of) existing DNA
    constructor(bytes = null, sexChrom = null) {
      this.dna = bytes ? new Uint8Array(bytes) : Genome.founderDNA();
      this.sexChrom = sexChrom || (Evo.chance(0.5) ? 'X' : 'Y');
      this.mutationCount = 0; // Mutation events along the longest parental line since the founders
    }

    // Founder genes separated by a few junk bytes, then junk padding. The chromosome is sized to
    // hold every founder gene, so founders always carry exactly these genes.
    static founderDNA() {
      const bytes = [];
      const junk = n => { for (let i = 0; i < n; i++) bytes.push(junkByte()); };
      junk(4);
      for (const g of FOUNDER_GENES) {
        bytes.push(PROMOTER, ...g);
        junk(3 + Evo.randInt(4));
      }
      junk(Math.max(0, FOUNDER_MIN_LENGTH - bytes.length));
      return Uint8Array.from(bytes);
    }

    // Locate every expressed gene in a DNA string: [start, end) spans including the promoter
    static findGenes(dna) {
      const len = dna.length, genes = [];
      let i = 0;
      while (i < len) {
        if (dna[i] !== PROMOTER || i + 1 >= len) { i++; continue; }
        const type = dna[i + 1] % GENES.length;
        const end = i + 2 + GENES[type].payload;
        if (end > len) break; // Truncated at the chromosome's end: not expressed
        genes.push({ start: i, end, type });
        i = end;
      }
      return genes;
    }

    findGenes() {
      return Genome.findGenes(this.dna);
    }

    // An exact copy, including the family line's mutation count
    clone() {
      const g = new Genome(this.dna, this.sexChrom);
      g.mutationCount = this.mutationCount;
      return g;
    }

    cloneWithMutation(mutationRate = 0.035, allowIndels = true) {
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
        if (genes.length && Evo.chance(0.025) && dna.length > MIN_LENGTH) {
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
      return child.cloneWithMutation(0.018);
    }

    develop() {
      const sex = this.sexChrom === 'Y' ? 'MALE' : 'FEMALE';
      const F = sex === 'FEMALE';
      const traits = defaultTraits(F);
      traits.sex = sex;

      // Gene dosage: several copies of a gene average their values (co-dominance)
      const acc = {}, chemAcc = {}, anatomyAcc = {};
      const anomaly = { noiseAdd: 0, basalMul: 1, spikeMul: 1 };
      const push = (table, key, v) => { (table[key] = table[key] || []).push(v); };
      const dna = this.dna;
      for (const gene of this.findGenes()) {
        const base = gene.start + 2;
        GENES[gene.type].express({
          F, traits, anomaly,
          q: k => dna[base + k] / 255.0,
          raw: k => dna[base + k],
          set: (name, v) => push(acc, name, v),
          chem: (name, v) => push(chemAcc, name, v),
          anatomy: (region, v) => push(anatomyAcc, region, v)
        });
      }

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
      traits.estrusCooldownTicks = Math.round(traits.estrusCooldownTicks);
      traits.bodyMass = 0.8 + (traits.radius / 14.0) ** 2 * 0.4;
      traits.membraneNoise = Math.min(1.5, traits.membraneNoise + anomaly.noiseAdd);
      traits.basalCost *= Math.min(3.0, anomaly.basalMul);
      traits.spikeEnergyCost *= Math.max(0.3, anomaly.spikeMul);
      return traits;
    }
  }

  Object.assign(Evo, { Genome, GENES, GENE_INDEX, FOUNDER_GENES, PROMOTER });
})(globalThis.Evo);
