// The founder genome: the first creatures' genes, written as readable specs and encoded to bytes by
// Evo.Genome.founder(). These are ordinary genes behind ordinary promoters: they mutate, duplicate,
// recombine and can be lost. Nothing here is special-cased by the simulation.
// This file holds the gene-spec helpers (Evo.founderKit) and the body genes (Evo.founderBody);
// founder-brain.js adds the brain wiring and founder-chem.js the chemistry, and assembles Evo.FOUNDER_GENOME.
(function (Evo) {
  'use strict';

  // ---------- Helpers that turn intentions into gene specs ----------
  const reaction = (a, b, c, d, rate, yieldC = 1, yieldD = 1, stage = 0) =>
    ({ gene: 'Reaction', stage, a, b, c, d, rate, yieldC, yieldD });
  const { INVERT, DIGITAL, NEGATIVE } = Evo.FLAG;
  const emitter = (locus, chem, threshold, gain, flags = 0, stage = 0) =>
    ({ gene: 'Emitter', stage, locus, chem, threshold, gain, flags });
  const receptor = (chem, target, threshold, gain, flags = 0, stage = 0) =>
    ({ gene: 'Receptor', stage, chem, target, threshold, gain, flags });
  const stimulus = (key, chem1, amount1, chem2 = null, amount2 = 0) =>
    ({ gene: 'Stimulus', stimulus: Evo.STIMULUS[key], chem1, amount1, chem2, amount2 });
  const halfLife = (chem, ticks) => ({ gene: 'Half-life', chem, halfLife: ticks });
  const initial = (chem, amount) => ({ gene: 'Initial concentration', chem, amount });
  // Axon guidance: a source lobe's axons seek a receptor chemistry. With relX / relY the target is
  // relative to each source cell's own tag (0.5 = "the same as mine"): a topographic projection.
  // from: [x, y, r] limits the source to cells whose tag is within r of (x, y).
  const guide = (lobe, [tx, ty, tz], { radius, weight, reach = 1.4, conduction = 0.3, relX = false, relY = false, mirrorX = false, from = null }) => {
    // The sign byte only reads as a weight of at least 0.2 (weaker ones would flip to excitatory)
    if (Math.abs(weight) < 0.2 || Math.abs(weight) > 1) throw new Error(`Axon guidance weight ${weight} must be 0.2 to 1 in size`);
    const G = Evo.GUIDANCE;
    return {
      gene: 'Axon guidance', source: { lobe, relX, relY, mirrorX }, tx, ty, tz,
      radius: G.radius.encode(radius),
      sign: G.weight.encode(weight),
      reach: G.reach.encode(reach),
      conduction: G.conduction.encode(conduction),
      sx: from ? from[0] : 0, sy: from ? from[1] : 0, sr: from ? G.window.encode(from[2]) : 0
    };
  };
  const { MUSCLE_Z } = Evo.BRAIN_BODY_PLAN;
  // A topographic tract from one sense channel (its cells' tag y) to the walk muscles (tag y 0.5)
  // on the same side, or with crossed = true, the opposite side
  const approach = (lobe, channels, key, weight, crossed = false) => {
    const y = (channels.indexOf(key) + 0.5) / channels.length;
    return guide(lobe, [0.5, 0.5 + (0.5 - y), MUSCLE_Z], { radius: 0.06, weight, relX: true, relY: true, mirrorX: crossed });
  };
  const none = Evo.GENE_NONE; // An instinct input index that matches no neuron
  const instinct = (lobeA, indexA, lobeB, indexB, motor, chem, amount) =>
    ({ gene: 'Instinct', stage: Evo.STAGE.BABY, lobeA, indexA, lobeB, indexB, motor, chem, amount });

  // Neuron indices within their lobes, for instincts (see brain.js for the layouts)
  const FEATURES = Evo.VISION_FEATURES.map(f => f.key);
  const ODOURS = Evo.SCENTS.map(s => s.key);
  const MOTOR = Object.fromEntries(Evo.MOTORS.map((m, i) => [m.key, i]));
  // Drives cell of each drive chemical (Evo.driveCell), for receptor targets and instincts
  const { driveCell } = Evo;
  const driveTarget = key => `need:${driveCell(key)}`;
  // An innate prior: axons from one drive's cell only (a source window) to one muscle
  const prior = (drive, motor, weight) => guide('needs', [...Evo.MOTORS[MOTOR[motor]].tag, MUSCLE_Z],
    { radius: 0.08, weight, conduction: 0.3, from: [...Evo.DRIVE_CELL_TAGS[driveCell(drive)], 0.04] });
  const { sightIndex: sight, smellIndex: smell } = Evo.BRAIN_BODY_PLAN;
  const TOUCH = Object.fromEntries(Evo.BRAIN_BODY_PLAN.TOUCH.map((t, i) => [t.key, i]));

  Evo.founderKit = { reaction, emitter, receptor, stimulus, halfLife, initial, guide, approach, instinct, INVERT, DIGITAL, NEGATIVE, none, FEATURES, ODOURS, MOTOR, driveCell, driveTarget, prior, sight, smell, TOUCH };

  Evo.founderBody = [
    { gene: 'Appearance', hue: 0.08, accentHue: 0.12, pattern: 0.3, patternScale: 0.5, earSize: 0.6, tailLength: 0.6, eyeSize: 0.6, plumpness: 0.55 },
    { gene: 'Morphology', size: 0.5, legLength: 0.5, mouthReach: 0.5, crest: 0.5 },
    { gene: 'Eyes', range: 0.45, gain: 0.4, night: 0.3 },
    { gene: 'Nose', reach: 0.4, gain: 0.4 },
    { gene: 'Membrane', threshold: 0.6, leak: 0.5, refractory: 0.5 },
    { gene: 'Plasticity', rate: 0.33, memory: 0.44, sprouting: 0.43, pruning: 0.5 },
    { gene: 'Reinforcement', joy: 0.42, stress: 0.47 },
    { gene: 'Muscle', speed: 0.5, jump: 0.45, run: 0.5 },
    { gene: 'Life history', lifespan: 0.4, gestation: 0.4 },
    { gene: 'Voice', pitch: 0.5, loudness: 0.5 },
    { gene: 'Curiosity', habituation: 0.25, novelty: 0.5 },
    { gene: 'Insulation', insulation: 0.5, bodyHeat: 0.5 },
    { gene: 'Reproduction', investment: 0.4, incubation: 0.4 },
  ];
})(globalThis.Evo);
