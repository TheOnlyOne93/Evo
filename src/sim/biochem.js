// Genetic biochemistry, after Creatures: chemicals in 64 slots, and the genes acting on them. Each
// tick: emitters release chemicals from body readings, reactions convert chemicals, chemicals decay
// by their half-lives, and receptors push on the body and brain. Between ticks, stimulus genes
// release chemicals when something happens to the creature (stimulate).
(function (Evo) {
  'use strict';
  const { N_CHEM, TARGETS, TARGET, CHEM_BY_ID, STIMULI } = Evo;

  // What a death by damage from each chemical is called (anything else: 'illness')
  const DAMAGE_CAUSE = { toxin: 'poison', ageing: 'old age' };

  class Biochemistry {
    constructor() {
      this.c = new Float32Array(N_CHEM);          // Concentrations, 0..1
      this.keep = new Float32Array(N_CHEM);       // Fraction surviving decay each tick
      this.effects = new Float32Array(TARGETS.length); // Receptor output this tick, by target
      this.damageBy = new Float32Array(N_CHEM);   // Health damage caused by each chemical this tick
      this.reactions = [];
      this.emitters = [];
      this.receptors = [];
      this.stimuli = STIMULI.map(() => []);      // Stimulus genes, by event index
    }

    // Install the genes of the current life stage. Concentrations carry over.
    configure(traits) {
      this.reactions = traits.reactions;
      this.emitters = traits.emitters;
      this.receptors = traits.receptors;
      this.stimuli = STIMULI.map(() => []);
      for (const g of traits.stimuli || []) this.stimuli[g.event].push(g);
      this.keep.fill(1);
      for (const chem in traits.halfLives) {
        const hl = traits.halfLives[chem];
        this.keep[chem] = hl === Infinity ? 1 : Math.pow(0.5, 1 / Math.max(1, hl));
      }
    }

    // Starting concentrations from the genome (at birth)
    setInitial(traits) {
      for (const { chem, amount } of traits.initial) this.c[chem] = amount;
    }

    get(key) { return this.c[Evo.CHEM[key]]; }
    set(key, v) { this.c[Evo.CHEM[key]] = Math.max(0, Math.min(1, v)); }
    add(key, amount) { const i = Evo.CHEM[key]; this.c[i] = Math.max(0, Math.min(1, this.c[i] + amount)); }

    // Something happened (event: an index into Evo.STIMULI) with strength s: each stimulus gene for
    // it releases its chemicals (a negative amount removes some)
    stimulate(event, s = 1) {
      const c = this.c;
      for (const g of this.stimuli[event]) {
        if (g.chem1) c[g.chem1] = Math.max(0, Math.min(1, c[g.chem1] + g.amount1 * s));
        if (g.chem2) c[g.chem2] = Math.max(0, Math.min(1, c[g.chem2] + g.amount2 * s));
      }
    }

    // loci: Float32Array of body readings (see Evo.BODY_LOCI)
    step(loci) {
      const c = this.c;

      // 1. Emitters: a reading above (or, inverted, below) the threshold releases the chemical
      for (const e of this.emitters) {
        const v = e.locus.body !== undefined ? loci[e.locus.body] : c[e.locus.chem];
        const x = e.invert ? e.threshold - v : v - e.threshold;
        if (x > 0) c[e.chem] += e.digital ? e.gain : x * e.gain;
      }

      // 2. Reactions, A + B -> C + D, by mass action. B, C and D may be nothing; a chemical on both
      //    sides acts as a catalyst.
      for (const r of this.reactions) {
        const a = c[r.a];
        if (a <= 0) continue;
        const b = r.b ? c[r.b] : 1;
        if (b <= 0) continue;
        let amount = r.rate * a * b;
        if (amount > a) amount = a;
        if (r.b && amount > b) amount = b;
        c[r.a] -= amount;
        if (r.b) c[r.b] -= amount;
        if (r.c) c[r.c] += amount * r.yieldC;
        if (r.d) c[r.d] += amount * r.yieldD;
      }

      // 3. Decay by half-life, and keep every level in 0..1 (anything above capacity is lost)
      for (let i = 1; i < N_CHEM; i++) {
        let v = c[i] * this.keep[i];
        if (v > 1) v = 1;
        c[i] = v < 1e-6 ? 0 : v;
      }

      // 4. Receptors
      const fx = this.effects;
      fx.fill(0);
      this.damageBy.fill(0);
      for (const r of this.receptors) {
        const v = c[r.chem];
        const x = r.invert ? r.threshold - v : v - r.threshold;
        if (x <= 0) continue;
        const out = (r.negative ? -1 : 1) * (r.digital ? r.gain : x * r.gain);
        fx[r.target] += out;
        if (r.target === TARGET.damage && out > 0) this.damageBy[r.chem] += out;
      }
    }

    effect(target) {
      return this.effects[TARGET[target]];
    }

    // The chemical doing the most damage right now, as a cause of death
    damageCause() {
      let best = 0, bestChem = 0;
      for (let i = 1; i < N_CHEM; i++) if (this.damageBy[i] > best) { best = this.damageBy[i]; bestChem = i; }
      if (!bestChem) return null;
      const chem = CHEM_BY_ID[bestChem];
      return (chem && DAMAGE_CAUSE[chem.key]) || 'illness';
    }
  }

  Evo.Biochemistry = Biochemistry;
})(globalThis.Evo);
