'use strict';

// How closely each numeric codec can represent a value (its quantisation step)
function tolerance(codec, Evo, v) {
  const C = Evo.CODEC;
  if (codec === C.unit) return 0.5 / 255 + 1e-9;
  if (codec === C.yield || codec === C.gain) return 0.5 / 64 + 1e-9;
  if (codec === C.rate) return v * 0.05;
  if (codec === C.emit) return Math.max(v * 0.2, 2e-6);
  if (codec === C.halfLife) return v * 0.03;
  return 0.5;
}

test('genome: every founder gene value survives encoding (nothing is clamped or misread)', (Evo, assert) => {
  const C = Evo.CODEC;
  for (const spec of Evo.FOUNDER_GENOME) {
    const def = Evo.GENES[Evo.GENE_INDEX[spec.gene]];
    const bytes = Evo.encodeGene(spec);
    assert.strictEqual(bytes.length, 2 + def.payload, spec.gene);
    const [gene] = Evo.Genome.findGenes(Uint8Array.from(bytes));
    assert.ok(gene, `${spec.gene} is found`);
    assert.strictEqual(gene.stage, spec.stage || 0, `${spec.gene} stage`);
    def.fields.forEach(([key, codec], k) => {
      const want = spec[key], got = codec.decode(bytes[2 + k]);
      const what = `${spec.gene}.${key} = ${JSON.stringify(want)}`;
      if (codec === C.chem) assert.strictEqual(got, want === null ? 0 : Evo.CHEM[want], what);
      else if (codec === C.target) assert.strictEqual(got, Evo.TARGET[want], what);
      else if (codec === C.lobe) assert.strictEqual(got, Evo.LOBE_ORDER.indexOf(want), what);
      else if (codec === C.locus) {
        assert.deepStrictEqual(got, want.startsWith('chem:') ? { chem: Evo.CHEM[want.slice(5)] } : { body: Evo.LOCUS[want] }, what);
      } else if (typeof want === 'object') {
        assert.deepStrictEqual(got, { ...want, lobe: Evo.LOBE_ORDER.indexOf(want.lobe) }, what);
      } else if (want === Infinity) {
        assert.strictEqual(got, Infinity, what);
      } else {
        assert.ok(Math.abs(got - want) <= tolerance(codec, Evo, want), `${what} decodes to ${got}`);
      }
    });
  }
});

test('genome: founders always carry exactly the founder genes, in order', (Evo, assert) => {
  const expected = Evo.FOUNDER_GENOME.map(s => [Evo.GENE_INDEX[s.gene], s.stage || 0]);
  for (let i = 0; i < 100; i++) {
    const found = Evo.Genome.founder().findGenes().map(g => [g.type, g.stage]);
    assert.deepStrictEqual(found, expected);
  }
});

test('genome: later life-stage genes switch on only at their stage', (Evo, assert) => {
  const g = Evo.Genome.founder('X');
  const baby = g.develop(Evo.STAGE.BABY), teen = g.develop(Evo.STAGE.ADOLESCENT), old = g.develop(Evo.STAGE.SENILE);
  const sexHormone = Evo.CHEM.sexHormone, ageing = Evo.CHEM.ageing;
  assert.ok(!baby.emitters.some(e => e.chem === sexHormone), 'no sex hormone in babies');
  assert.ok(teen.emitters.some(e => e.chem === sexHormone), 'sex hormone from adolescence');
  assert.ok(!teen.emitters.some(e => e.chem === ageing), 'no ageing in adolescents');
  assert.strictEqual(old.emitters.filter(e => e.chem === ageing).length, 2, 'both ageing genes when senile');
  assert.ok(teen.emitters.every(e => e.stage <= Evo.STAGE.ADOLESCENT));
});

test('genome: gene loss after a duplication removes a whole gene', (Evo, assert) => {
  const parent = Evo.Genome.founder();
  const before = parent.findGenes();
  const target = 3;
  // Script the random draws: no point mutations, duplicate gene #3 to the front, then lose one gene
  const draws = [
    ...new Array(parent.dna.length).fill(0.99),  // no point mutations
    0.0, (target + 0.5) / before.length, 0.0,    // duplicate gene #target, insert at position 0
    0.0, (target + 0.5) / (before.length + 1),   // lose gene #target of the new (longer) list
    0.99                                         // no small indel
  ];
  let i = 0;
  Evo.useRandomSource(() => (i < draws.length ? draws[i++] : 0.5));
  const child = parent.cloneWithMutation(0.004, true);
  Evo.seed(1);
  const after = child.findGenes();
  assert.strictEqual(after.length, before.length, 'one gene gained, one whole gene lost');
  const bytes = (g, dna) => Array.from(dna.slice(g.start, g.end)).join(',');
  const parentGenes = new Set(before.map(g => bytes(g, parent.dna)));
  for (const g of after) assert.ok(parentGenes.has(bytes(g, child.dna)), 'no garbled gene');
});

test('genome: heavy mutation keeps length in bounds and every trait finite', (Evo, assert) => {
  let g = Evo.Genome.founder();
  for (let gen = 0; gen < 300; gen++) {
    g = g.cloneWithMutation(0.03, true);
    assert.ok(g.dna.length >= 256 && g.dna.length <= 3200, `length ${g.dna.length}`);
    const t = g.develop(Evo.STAGE.SENILE);
    for (const [k, v] of Object.entries(t)) if (typeof v === 'number') assert.ok(Number.isFinite(v), `${k} = ${v}`);
    for (const r of t.reactions) assert.ok(r.a < Evo.N_CHEM && Number.isFinite(r.rate));
    for (const r of t.receptors) assert.ok(r.target > 0 && r.target < Evo.TARGETS.length);
  }
});

test('genome: clones and children keep the family line mutation count', (Evo, assert) => {
  const a = Evo.Genome.founder('X').cloneWithMutation(0.05);
  const b = Evo.Genome.founder('Y');
  assert.ok(a.mutationCount > 0);
  assert.strictEqual(a.clone().mutationCount, a.mutationCount);
  const child = Evo.Genome.recombine(a, b);
  assert.ok(child.mutationCount >= a.mutationCount);
  assert.ok(['X', 'Y'].includes(child.sexChrom));
});

test('genome: a hue byte of zero gives a red coat, not the default', (Evo, assert) => {
  const g = Evo.Genome.founder();
  const look = g.findGenes().find(x => Evo.GENES[x.type].name === 'Appearance');
  g.dna[look.start + 2] = 0;
  assert.strictEqual(g.develop().hue, 0);
});

test('genome: duplicated genes average their values (co-dominance)', (Evo, assert) => {
  const spec = { gene: 'Muscle', speed: 0, jump: 0.5, run: 0.5 };
  const one = new Evo.Genome([0, ...Evo.encodeGene(spec), 0], 'X').develop();
  const two = new Evo.Genome([0, ...Evo.encodeGene(spec), 0, ...Evo.encodeGene({ ...spec, speed: 1 }), 0], 'X').develop();
  assert.ok(Math.abs(one.walkSpeed - 0.8) < 1e-9);
  assert.ok(Math.abs(two.walkSpeed - 1.3) < 1e-9);
});

test('genome: axon guidance strength decodes symmetrically around byte 120', (Evo, assert) => {
  const strength = sign => {
    const spec = { gene: 'Axon guidance', source: { lobe: 'touch', relX: false, relY: false, mirrorX: false }, tx: 0.5, ty: 0.5, tz: 0.5, radius: 0.5, sign, reach: 0.5, conduction: 0.5, sx: 0, sy: 0, sr: 0 };
    return new Evo.Genome([0, ...Evo.encodeGene(spec), 0], 'X').develop().axonGuidance[0].weightSign;
  };
  assert.ok(Math.abs(strength(121) - 0.21) < 1e-9, 'just above 120: weakly excitatory');
  assert.ok(Math.abs(strength(120) + 0.2) < 1e-9, '120 and below: inhibitory');
  assert.ok(Math.abs(strength(100) + 0.4) < 1e-9);
  assert.ok(Math.abs(strength(180) - 0.8) < 1e-9);
  assert.strictEqual(strength(255), 1); assert.strictEqual(strength(0), -1);
});

test('genome: a windowed guidance gene grows synapses only from the cells in its window', (Evo, assert) => {
  const sourcesOf = window => {
    const spec = { gene: 'Axon guidance', source: { lobe: 'needs', relX: false, relY: false, mirrorX: false }, tx: 0.5, ty: 0.5, tz: 0.9,
      radius: 1, sign: 200, reach: 1, conduction: 0.5, sx: 0, sy: 0, sr: 0, ...window };
    const traits = new Evo.Genome([0, ...Evo.encodeGene(spec), 0], 'X').develop();
    const rules = traits.axonGuidance;
    traits.axonGuidance = [];
    const brain = new Evo.Brain(traits);
    const before = brain.S;
    brain.growTracts(rules);
    return { brain, from: new Set(Array.from(brain.sSrc.subarray(before, brain.S))) };
  };
  const { brain } = sourcesOf({});
  const k = 10, cell = brain.lobes.needs[k];
  const [tx, ty] = brain.neurons[cell].tag;
  const open = sourcesOf({});
  assert.ok(open.from.size > 1, 'without a window many need cells send axons');
  const windowed = sourcesOf({ sx: tx, sy: ty, sr: (0.05 - 0.02) / 0.5 });
  assert.ok(windowed.from.size > 0, 'the windowed cell grew synapses');
  assert.deepStrictEqual([...windowed.from], [cell], 'only the cell in the window');
});

test('genome: every kind of gene describes itself in plain words', (Evo, assert) => {
  const brain = new Evo.Brain(Evo.Genome.founder().develop());
  const seen = new Set();
  for (let i = 0; i < 30; i++) {
    const g = Evo.Genome.founder().cloneWithMutation(0.3);
    for (const gene of g.findGenes()) {
      const d = Evo.text.describeGene(g, gene, brain);
      seen.add(d.name);
      assert.ok(['body', 'brain', 'chemistry', 'instinct'].includes(d.group), `${d.name}: group ${d.group}`);
      assert.ok(d.text && !/undefined|NaN/.test(d.text), `${d.name}: ${d.text}`);
    }
  }
  assert.strictEqual(seen.size, Evo.GENES.length, 'every gene kind was seen');
});

test('genome: a brain-building gene that switches on after birth says it has no effect', (Evo, assert) => {
  const g = Evo.Genome.founder('X', [{ gene: 'Region duplication', stage: Evo.STAGE.ADULT, source: 'cortex', depth: 0.5, lateral: 0.5, chemShift: 0.5, input: 0.5 },
    { gene: 'Region duplication', stage: 0, source: 'cortex', depth: 0.5, lateral: 0.5, chemShift: 0.5, input: 0.5 }]);
  const [late, early] = g.findGenes().map(gene => Evo.text.describeGene(g, gene).text);
  assert.ok(/no effect/.test(late), late);
  assert.ok(!/no effect/.test(early), early);
});
