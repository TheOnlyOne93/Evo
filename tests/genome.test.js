'use strict';

// How closely each numeric codec can represent a value (its quantisation step)
function tolerance(codec, Evo, v) {
  const C = Evo.CODEC;
  if (codec === C.unit) return 0.5 / 255 + 1e-9;
  if (codec === C.yield || codec === C.gain) return 0.5 / 64 + 1e-9;
  if (codec === C.rate) return v * 0.05;
  if (codec === C.emit) return Math.max(v * 0.2, 2e-6);
  if (codec === C.halfLife) return v * 0.03;
  if (codec === C.signed) return 0.5 / 256 + 1e-9;
  return 0.5;
}

test('genome: every founder gene value survives encoding (nothing is clamped or misread)', (Evo, assert) => {
  const C = Evo.CODEC;
  for (const spec of [...Evo.FOUNDER_GENOMES.FEMALE, ...Evo.FOUNDER_GENOMES.MALE]) {
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

test('genome: each founder carries exactly its founder genes, in order (the filler makes no gene)', (Evo, assert) => {
  for (const sex of ['FEMALE', 'MALE']) {
    const expected = Evo.FOUNDER_GENOMES[sex].map(s => [Evo.GENE_INDEX[s.gene], s.stage || 0]);
    const found = Evo.Genome.founder(sex).findGenes().map(g => [g.type, g.stage]);
    assert.deepStrictEqual(found, expected, sex);
  }
});

test('genome: a founder is the same bytes every time and draws no random numbers', (Evo, assert) => {
  const bytes = sex => Array.from(Evo.Genome.founder(sex).dna).join(',');
  for (const sex of ['FEMALE', 'MALE']) {
    Evo.seed(1);
    const first = bytes(sex);
    Evo.seed(5);
    assert.strictEqual(bytes(sex), first, sex + ' after another seed');
  }
  // The next number the dice give is the same with or without a founder built in between
  Evo.seed(5);
  const next = Evo.random();
  Evo.seed(5);
  Evo.Genome.founder('FEMALE'); Evo.Genome.founder('MALE');
  assert.strictEqual(Evo.random(), next, 'building founders drew no random numbers');
  // And no dice at all: a random source that throws is never asked
  try {
    Evo.useRandomSource(() => { throw new Error('a founder asked for a random number'); });
    Evo.Genome.founder('FEMALE'); Evo.Genome.founder('MALE');
  } finally {
    Evo.seed(1);
  }
});

test('genome: the first female and male differ only in the looks and voice values', (Evo, assert) => {
  const she = Evo.Genome.founder('FEMALE'), he = Evo.Genome.founder('MALE');
  assert.strictEqual(she.dna.length, he.dna.length);
  // Every byte that differs lies in the payload of an Appearance or Voice gene
  const looksAndVoice = new Set();
  for (const gene of she.findGenes()) {
    const name = Evo.GENES[gene.type].name;
    if (name === 'Appearance' || name === 'Voice') for (let k = gene.start + 2; k < gene.end; k++) looksAndVoice.add(k);
  }
  assert.deepStrictEqual(he.findGenes(), she.findGenes(), 'the genes sit in the same places');
  const differ = [];
  for (let k = 0; k < she.dna.length; k++) if (she.dna[k] !== he.dna[k]) differ.push(k);
  assert.ok(differ.length > 0, 'they do differ');
  for (const k of differ) assert.ok(looksAndVoice.has(k), `byte ${k} differs outside the looks and voice`);
});

test('genome: the first female develops into a female and the first male into a male', (Evo, assert) => {
  assert.strictEqual(Evo.Genome.founder('FEMALE').develop().sex, 'FEMALE');
  assert.strictEqual(Evo.Genome.founder('MALE').develop().sex, 'MALE');
  assert.strictEqual(Evo.chromFor('FEMALE'), 'X');
  assert.strictEqual(Evo.chromFor('MALE'), 'Y');
});

test('genome: the founders have the looks and voice written in Evo.FOUNDERS', (Evo, assert) => {
  for (const sex of ['FEMALE', 'MALE']) {
    const { looks, voice } = Evo.FOUNDERS[sex], t = Evo.Genome.founder(sex).develop();
    assert.ok(Math.abs(t.hue - looks.hue * 360) < 0.5 * 360 / 255 + 1e-9, sex + ' hue');
    assert.ok(Math.abs(t.voicePitch - voice.pitch) < 0.5 / 255 + 1e-9, sex + ' pitch');
  }
  assert.ok(Evo.Genome.founder('FEMALE').develop().voicePitch > 0.5, 'her voice is high');
  assert.ok(Evo.Genome.founder('MALE').develop().voicePitch < 0.5, 'his voice is low');
});

test('genome: later life-stage genes switch on only at their stage', (Evo, assert) => {
  const g = Evo.Genome.founder('FEMALE');
  const baby = g.develop(Evo.STAGE.BABY), teen = g.develop(Evo.STAGE.ADOLESCENT), old = g.develop(Evo.STAGE.SENILE);
  const sexHormone = Evo.CHEM.sexHormone, ageing = Evo.CHEM.ageing;
  assert.ok(!baby.emitters.some(e => e.chem === sexHormone), 'no sex hormone in babies');
  assert.ok(teen.emitters.some(e => e.chem === sexHormone), 'sex hormone from adolescence');
  assert.ok(!teen.emitters.some(e => e.chem === ageing), 'no ageing in adolescents');
  assert.ok(old.emitters.some(e => e.chem === ageing), 'ageing when senile');
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
  let child;
  try {
    Evo.useRandomSource(() => (i < draws.length ? draws[i++] : 0.5));
    child = parent.cloneWithMutation(0.004);
  } finally {
    Evo.seed(1);
  }
  const after = child.findGenes();
  assert.strictEqual(after.length, before.length, 'one gene gained, one whole gene lost');
  const bytes = (g, dna) => Array.from(dna.slice(g.start, g.end)).join(',');
  assert.notStrictEqual(Array.from(child.dna).join(','), Array.from(parent.dna).join(','), 'the child differs from the parent');
  assert.strictEqual(bytes(after[0], child.dna), bytes(before[target], parent.dna), 'the duplicate sits at the front');
  const parentGenes = new Set(before.map(g => bytes(g, parent.dna)));
  for (const g of after) assert.ok(parentGenes.has(bytes(g, child.dna)), 'no garbled gene');
});

test('genome: heavy mutation keeps length in bounds and every trait finite', (Evo, assert) => {
  let g = Evo.Genome.founder();
  for (let gen = 0; gen < 300; gen++) {
    g = g.cloneWithMutation(0.03);
    assert.ok(g.dna.length >= Evo.GENOME_LIMITS.MIN_LENGTH && g.dna.length <= Evo.GENOME_LIMITS.MAX_LENGTH, `length ${g.dna.length}`);
    const t = g.develop(Evo.STAGE.SENILE);
    for (const [k, v] of Object.entries(t)) if (typeof v === 'number') assert.ok(Number.isFinite(v), `${k} = ${v}`);
    for (const r of t.reactions) assert.ok(r.a < Evo.N_CHEM && Number.isFinite(r.rate));
    for (const r of t.receptors) assert.ok(r.target > 0 && r.target < Evo.TARGETS.length);
  }
});

test('genome: clones and children keep the family line mutation count', (Evo, assert) => {
  const a = Evo.Genome.founder('FEMALE').cloneWithMutation(0.05);
  const b = Evo.Genome.founder('MALE');
  assert.ok(a.mutationCount > 0);
  assert.strictEqual(a.clone().mutationCount, a.mutationCount);
  const child = Evo.Genome.recombine(a, b);
  assert.ok(child.mutationCount >= a.mutationCount);
});

test('genome: a child gets X or Y from its father at random', (Evo, assert) => {
  const mother = Evo.Genome.founder('FEMALE'), father = Evo.Genome.founder('MALE');
  const seen = new Set();
  for (let i = 0; i < 20; i++) seen.add(Evo.Genome.recombine(mother, father).sexChrom);
  assert.deepStrictEqual([...seen].sort(), ['X', 'Y']);
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
  const W = Evo.TRAIT_RANGES.walk;
  assert.ok(Math.abs(one.walkSpeed - W.lo) < 1e-9);
  assert.ok(Math.abs(two.walkSpeed - (W.lo + W.width / 2)) < 1e-9, 'speed 0 and speed 1 average to the middle of the range');
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

test('genome: a misspelled chemical name in a gene throws instead of encoding to nothing', (Evo, assert) => {
  assert.throws(() => Evo.encodeGene({ gene: 'Half-life', chem: 'no-such-chemical', halfLife: 100 }), /chem/);
});

test('genome: a founder guidance weight too weak to keep its sign throws', (Evo, assert) => {
  assert.throws(() => Evo.founderKit.guide('touch', [0.5, 0.5, 0.5], { radius: 0.2, weight: 0.1 }), /0\.1/);
  assert.throws(() => Evo.founderKit.guide('touch', [0.5, 0.5, 0.5], { radius: 0.2, weight: -0.1 }), /-0\.1/);
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
  const open = sourcesOf({});
  const k = 10, cell = open.brain.lobes.needs[k];
  const [tx, ty] = open.brain.neurons[cell].tag;
  assert.ok(open.from.size > 1, 'without a window many need cells send axons');
  // sr is a radius encoded over the window's range (0.02 to 0.5): a radius of about 0.05 in the cell's own tag space
  const windowed = sourcesOf({ sx: tx, sy: ty, sr: (0.05 - 0.02) / 0.5 });
  assert.ok(windowed.from.size > 0, 'the windowed cell grew synapses');
  assert.deepStrictEqual([...windowed.from], [cell], 'only the cell in the window');
});
