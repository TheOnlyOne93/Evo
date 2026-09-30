// Genetic biochemistry, after Creatures: chemicals in 64 slots, and the genes acting on them. Each
// tick: emitters release chemicals from body readings, reactions convert chemicals, chemicals decay
// by their half-lives, and receptors push on the body and brain (all in the creature's body phase).
// Stimulus genes release chemicals the moment something happens to the creature (stimulate): from
// any phase of a tick, or from the hand between ticks. The change is read by the next body phase.
(function (Evo) {
  'use strict';
  const { N_CHEM, TARGETS, TARGET, CHEM_BY_ID, STIMULI } = Evo;
  const { clamp01 } = Evo.util;

  // What a death by damage from each chemical is called (anything else: 'illness')
  const DAMAGE_CAUSE = { toxin: 'poison', ageing: 'old age' };

  // An emitter's or receptor's response to reading v: how far v is past the gene's threshold
  // (below it, if inverted), times the gain; just the gain if digital. 0 while v isn't past it.
  function respond(v, g) {
    const x = g.invert ? g.threshold - v : v - g.threshold;
    return x > 0 ? (g.digital ? g.gain : x * g.gain) : 0;
  }

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
      for (const g of traits.stimuli || []) this.stimuli[g.stimulus].push(g);
      this.keep.fill(1);
      for (const chem in traits.halfLives) {
        const hl = traits.halfLives[chem];
        this.keep[chem] = Math.pow(0.5, 1 / Math.max(1, hl)); // An infinite half-life keeps 1
      }
    }

    // Set chemicals to the levels Initial concentration genes give (entries of traits.initial): every
    // one at birth, and on entering a later life stage the ones that switch on then
    setInitial(entries) {
      for (const { chem, amount } of entries) this.c[chem] = amount;
    }

    // The slot of a chemical by name; a misspelled name throws instead of quietly reading slot `undefined`
    slot(key) {
      const i = Evo.CHEM[key];
      if (i === undefined) throw new Error(`No chemical called "${key}"`);
      return i;
    }
    get(key) { return this.c[this.slot(key)]; }
    set(key, v) { this.c[this.slot(key)] = clamp01(v); }
    add(key, amount) { const i = this.slot(key); this.c[i] = clamp01(this.c[i] + amount); }

    // Something happened (stimulus: an index into Evo.STIMULI) with strength s: each stimulus gene for
    // it releases its chemicals (a negative amount removes some)
    stimulate(stimulus, s = 1) {
      const c = this.c;
      for (const g of this.stimuli[stimulus]) {
        if (g.chem1) c[g.chem1] = clamp01(c[g.chem1] + g.amount1 * s);
        if (g.chem2) c[g.chem2] = clamp01(c[g.chem2] + g.amount2 * s);
      }
    }

    // loci: Float32Array of body readings (see Evo.BODY_LOCI)
    step(loci) {
      const c = this.c;

      // 1. Emitters: a reading above (or, inverted, below) the threshold releases the chemical
      for (const e of this.emitters) {
        const v = e.locus.body !== undefined ? loci[e.locus.body] : c[e.locus.chem];
        const out = respond(v, e);
        if (out > 0) c[e.chem] += out;
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
        const response = respond(c[r.chem], r);
        if (response <= 0) continue;
        const out = (r.negative ? -1 : 1) * response;
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
