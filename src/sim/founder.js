// The founder genome: the first creatures' genes, written as readable specs and encoded to bytes by
// Evo.Genome.founder(). These are ordinary genes behind ordinary promoters: they mutate, duplicate,
// recombine and can be lost. Nothing here is special-cased by the simulation.
(function (Evo) {
  'use strict';

  // ---------- Helpers that turn intentions into gene specs ----------
  const reaction = (a, b, c, d, rate, yieldC = 1, yieldD = 1, stage = 0) =>
    ({ gene: 'Reaction', stage, a, b, c, d, rate, yieldC, yieldD });
  const INVERT = 1, DIGITAL = 2, NEGATIVE = 4;
  const emitter = (locus, chem, threshold, gain, flags = 0, stage = 0) =>
    ({ gene: 'Emitter', stage, locus, chem, threshold, gain, flags });
  const receptor = (chem, target, threshold, gain, flags = 0, stage = 0) =>
    ({ gene: 'Receptor', stage, chem, target, threshold, gain, flags });
  const halfLife = (chem, ticks) => ({ gene: 'Half-life', chem, halfLife: ticks });
  const initial = (chem, amount) => ({ gene: 'Initial concentration', chem, amount });
  // Axon guidance: a source lobe's axons seek a receptor chemistry. With relX / relY the target is
  // relative to each source cell's own tag (0.5 = "the same as mine"): a topographic projection.
  const guide = (lobe, [tx, ty, tz], { radius, weight, reach = 1.4, conduction = 0.3, relX = false, relY = false, mirrorX = false }) => ({
    gene: 'Axon guidance', source: { lobe, relX, relY, mirrorX }, tx, ty, tz,
    radius: (radius - 0.04) / 0.76,
    sign: weight > 0 ? 120 + Math.max(1, (weight - 0.2) * 100) : 120 - (-weight - 0.2) * 100,
    reach: (reach - 0.15) / 1.35,
    conduction: (conduction - 0.08) / 0.5
  });
  // A topographic tract from one sense channel (its cells' tag y) to the walk muscles (tag y 0.5)
  // on the same side, or with crossed = true, the opposite side
  const approach = (lobe, channels, key, weight, crossed = false) => {
    const y = (channels.indexOf(key) + 0.5) / channels.length;
    return guide(lobe, [0.5, 0.5 + (0.5 - y), 0.9], { radius: 0.06, weight, relX: true, relY: true, mirrorX: crossed });
  };
  const none = 255; // An instinct input index that matches no neuron
  const instinct = (lobeA, indexA, lobeB, indexB, motor, chem, amount) =>
    ({ gene: 'Instinct', stage: 1, lobeA, indexA, lobeB, indexB, motor, chem, amount });

  // Neuron indices within their lobes, for instincts (see brain.js for the layouts)
  const FEATURES = Evo.VISION_FEATURES.map(f => f.key);
  const ODOURS = Evo.SCENTS.map(s => s.key);
  const MOTOR = Object.fromEntries(Evo.MOTORS.map((m, i) => [m.key, i]));
  // Needs cells 0-8 share an address with the muscle of the same index (brain.js), so a drive
  // wired to need(muscle) excites that muscle. The remaining cells (up to N_NEEDS) address no
  // muscle: these general cells carry one drive each that the brain should feel apart.
  const GENERAL = ['hunger', 'proteinHunger', 'fatHunger', 'thirst', 'coldness', 'hotness', 'boredom', 'sexDrive', 'crowdedness'];
  const need = key => (key in MOTOR ? MOTOR[key] : Evo.MOTORS.length + GENERAL.indexOf(key));
  const NEED = key => `need:${need(key)}`;
  const sight = (side, band, feature) => (side === 'R' ? 2 : 0) * FEATURES.length + (band === 'high' ? FEATURES.length : 0) + FEATURES.indexOf(feature);
  const smell = (side, odour) => (side === 'R' ? 10 : 0) + ODOURS.indexOf(odour);
  const TOUCH = Object.fromEntries(Evo.BRAIN_BODY_PLAN.TOUCH.map((t, i) => [t.key, i]));

  Evo.FOUNDER_GENOME = [
    // ---------- Body ----------
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

    // ---------- Brain wiring ----------
    // Orienting. A sight cell's tag says which side (x) and which colour (y) it sees; the walk
    // muscles sit at y = 0.5. Each of these genes carries one colour's cells to walking toward
    // (or, crossed, away from) the side they see it on. Food colours pull hardest.
    ...['red', 'yellow', 'green'].map(f => approach('sight', FEATURES, f, f === 'red' ? 0.6 : 0.5)),
    approach('sight', FEATURES, 'blue', 0.3),
    approach('sight', FEATURES, 'pink', 0.3),
    approach('sight', FEATURES, 'creature', 0.25),                    // Company
    approach('sight', FEATURES, 'violet', 0.5, true),                   // Thorny violet: walk away
    // Every smell draws the creature toward the side it is stronger on; bitter and alarm push away
    guide('smell', [0.5, 0.5, 0.9], { radius: 0.12, weight: 0.3, relX: true }),
    approach('smell', ODOURS, 'bitter', 0.6, true),
    approach('smell', ODOURS, 'alarm', 0.6, true),
    guide('hearing', [0.5, 0.5, 0.9], { radius: 0.12, weight: 0.35, relX: true }),
    // Each need cell and touch cell excites the muscle that shares its address
    // (tired -> rest, lonely -> call, afraid or hurt -> run, hungry or thirsty -> use the mouth,
    // something at the mouth -> eat it)
    guide('needs', [0.5, 0.5, 0.9], { radius: 0.08, weight: 0.8, relX: true, relY: true }),
    guide('touch', [0.5, 0.5, 0.9], { radius: 0.08, weight: 0.3, relX: true, relY: true }),
    // Bumping into something on one side makes the opposite leg push: turn away from walls
    guide('touch', [0.5, 0.5, 0.9], { radius: 0.06, weight: 0.6, relX: true, mirrorX: true }),
    // Tastes inform thinking (what was just eaten), not the jaws directly
    guide('taste', [0.5, 0.5, 0.5], { radius: 0.3, weight: 0.3, reach: 0.8 }),
    // Sights and smells reach the reward and punishment cells weakly; these cue synapses learn
    // what each sight or smell predicts
    ...['sight', 'smell'].flatMap(lobe => [[0.2, 0.9, 0.1], [0.9, 0.2, 0.1]].map(cell => guide(lobe, cell, { radius: 0.08, weight: 0.25 }))),
    // The alarm odour excites the feelings cell that shares its address (a fear cell)
    guide('smell', [0.5, 0.5, 0.1], { radius: 0.07, weight: 0.9, relY: true }),
    // Feelings project broadly and fast: where the reward cell's axons end is where learning happens
    // (the chemical is released at the terminals; the synapses themselves are weak)
    guide('feelings', [0.5, 0.5, 0.65], { radius: 0.8, weight: 0.2, conduction: 0.5 }),
    // Action selection: every muscle inhibits the others, so the most strongly driven action wins
    guide('motor', [0.5, 0.5, 0.9], { radius: 0.7, weight: -0.4, conduction: 0.5 }),
    // Association: senses and needs into the thinking regions, and thinking regions to the muscles
    guide('needs', [0.5, 0.5, 0.55], { radius: 0.3, weight: 0.4, reach: 0.8 }),
    guide('sight', [0.5, 0.5, 0.5], { radius: 0.45, weight: 0.3, reach: 0.6 }),
    guide('smell', [0.5, 0.5, 0.5], { radius: 0.45, weight: 0.3, reach: 0.6 }),
    guide('cortex', [0.5, 0.5, 0.9], { radius: 0.6, weight: 0.2, reach: 0.8 }),
    guide('central', [0.5, 0.5, 0.9], { radius: 0.6, weight: 0.2, reach: 0.8 }),
    { gene: 'Pacemaker', lobe: 'motor', bias: 0.3 },                   // Restless muscles: exploration
    { gene: 'Region duplication', source: 'motor', depth: 1.0, lateral: 0.5, chemShift: 0.5, input: 0.92 }, // Efference copy
    { gene: 'Region duplication', source: 'sight', depth: 0.69, lateral: 0.5, chemShift: 0.5, input: 0.92 }, // Orienting map

    // ---------- Metabolism ----------
    // Digestion: the gut feeds the blood and the stores
    reaction('gutSugar', null, 'glucose', null, 0.006),
    reaction('gutStarch', 'water', 'glucose', 'water', 0.004, 0.95, 1),
    reaction('gutProtein', null, 'protein', null, 0.003),
    reaction('gutFat', null, 'fat', null, 0.002, 0.8, 0),
    // Insulin stores surplus sugar as glycogen and fat; glucagon releases it again (lossy both ways)
    emitter('chem:glucose', 'insulin', 0.55, 0.01),
    emitter('chem:glucose', 'glucagon', 0.35, 0.01, INVERT),
    halfLife('insulin', 100), halfLife('glucagon', 100),
    reaction('glucose', 'insulin', 'glycogen', 'insulin', 0.05),
    reaction('glycogen', 'glucagon', 'glucose', 'glucagon', 0.05),
    reaction('glucose', 'insulin', 'fat', 'insulin', 0.006, 0.5, 1),
    reaction('fat', 'glucagon', 'glucose', 'glucagon', 0.004, 1.6, 1),
    reaction('protein', 'glucagon', 'glucose', 'glucagon', 0.0003, 0.6, 1), // Wasting muscle when starving
    // The liver clears toxins
    emitter('chem:toxin', 'liverEnzyme', 0.01, 0.01), halfLife('liverEnzyme', 600),
    reaction('toxin', 'liverEnzyme', null, 'liverEnzyme', 0.03, 0, 1),
    // Growth hormone while the body is still growing; it builds protein into body
    emitter('growth', 'growthHormone', 0.999, 0.002, INVERT), halfLife('growthHormone', 500),
    receptor('growthHormone', 'growth', 0.05, 2),
    receptor('protein', 'healing', 0.1, 2),
    initial('glucose', 0.5), initial('glycogen', 0.4), initial('fat', 0.3), initial('protein', 0.5), initial('water', 0.8),

    // ---------- Drives: body states become drive chemicals ----------
    emitter('chem:glucose', 'hunger', 0.35, 0.0016, INVERT),
    emitter('chem:glycogen', 'hunger', 0.5, 0.0012, INVERT),            // Peckish well before the stores run out
    emitter('chem:protein', 'proteinHunger', 0.4, 0.0012, INVERT),
    emitter('chem:fat', 'fatHunger', 0.25, 0.0012, INVERT),
    emitter('chem:water', 'thirst', 0.6, 0.002, INVERT),
    emitter('exertion', 'adenosine', 0, 0.00006),
    emitter('awake', 'adenosine', 0.5, 0.00011),
    emitter('darkness', 'melatonin', 0.4, 0.0012), halfLife('melatonin', 900),
    emitter('chem:adenosine', 'tiredness', 0.25, 0.002),
    emitter('chem:melatonin', 'sleepiness', 0.3, 0.002),
    emitter('chem:adenosine', 'sleepiness', 0.6, 0.002),
    emitter('bodyTemp', 'coldness', 0.42, 0.012, INVERT),
    emitter('bodyTemp', 'hotness', 0.6, 0.012),
    emitter('company', 'loneliness', 0.3, 0.00046, INVERT),
    emitter('crowding', 'crowdedness', 0.4, 0.004),
    emitter('chem:crowdedness', 'anger', 0.5, 0.002),
    emitter('impact', 'pain', 0, 0.05),
    emitter('injury', 'pain', 0.05, 0.004),
    emitter('impact', 'fear', 0, 0.02),
    emitter('falling', 'fear', 0.5, 0.005),
    emitter('held', 'fear', 0.5, 0.001),
    emitter('limbic2', 'fear', 0.35, 0.01),
    emitter('limbic2', 'adrenaline', 0.35, 0.01),
    emitter('chem:fear', 'adrenaline', 0.2, 0.01),
    emitter('novelty', 'boredom', 0.04, 0.0052, INVERT),
    emitter('chem:toxin', 'nausea', 0.04, 0.01),
    emitter('gutFullness', 'nausea', 0.8, 0.004),
    halfLife('hunger', 1500), halfLife('proteinHunger', 2000), halfLife('fatHunger', 2000), halfLife('thirst', 1200),
    halfLife('tiredness', 600), halfLife('sleepiness', 600), halfLife('coldness', 400), halfLife('hotness', 400),
    halfLife('loneliness', 3000), halfLife('crowdedness', 600), halfLife('anger', 800), halfLife('pain', 60),
    halfLife('fear', 300), halfLife('adrenaline', 200), halfLife('boredom', 2000), halfLife('nausea', 300),
    halfLife('adenosine', 40000),

    // ---------- Relief: what satisfies each drive ----------
    emitter('heatGain', 'warmth', 0, 0.02), emitter('heatLoss', 'coolness', 0, 0.02),
    emitter('touchingFriend', 'company', 0, 0.01), emitter('heardCall', 'company', 0.3, 0.002),
    emitter('gentleTouch', 'company', 0, 0.01), emitter('gentleTouch', 'endorphin', 0, 0.02),
    emitter('novelty', 'novelty', 0.05, 0.02),
    emitter('resting', 'restRelief', 0.5, 0.01),
    emitter('asleep', 'sleepSignal', 0.5, 0.01),
    emitter('tasteWater', 'drink', 0, 0.05),
    emitter('mated', 'mating', 0, 0.05),
    halfLife('warmth', 60), halfLife('coolness', 60), halfLife('company', 60), halfLife('endorphin', 200),
    halfLife('novelty', 30), halfLife('restRelief', 30), halfLife('sleepSignal', 60), halfLife('drink', 20), halfLife('mating', 120),
    // ---------- Reinforcement: relief turns drive into reward; harm releases punishment ----------
    reaction('hunger', 'gutSugar', 'reward', 'gutSugar', 0.06, 0.8, 1),
    reaction('hunger', 'gutStarch', 'reward', 'gutStarch', 0.04, 0.8, 1),
    reaction('proteinHunger', 'gutProtein', 'reward', 'gutProtein', 0.06, 0.8, 1),
    reaction('fatHunger', 'gutFat', 'reward', 'gutFat', 0.06, 0.8, 1),
    reaction('thirst', 'drink', 'reward', null, 0.1, 0.8, 0),
    reaction('tiredness', 'restRelief', 'reward', null, 0.08, 0.5, 0),
    reaction('sleepiness', 'sleepSignal', 'reward', 'sleepSignal', 0.002, 3, 1), // Sleep feels good, but night keeps it going
    reaction('coldness', 'warmth', 'reward', null, 0.1, 0.6, 0),
    reaction('hotness', 'coolness', 'reward', null, 0.1, 0.6, 0),
    reaction('loneliness', 'company', 'reward', null, 0.1, 0.8, 0),
    reaction('fear', 'company', null, 'company', 0.02, 0, 1),            // Company calms fear
    reaction('boredom', 'novelty', 'reward', null, 0.08, 0.5, 0),
    reaction('sexDrive', 'mating', 'reward', null, 0.1, 2, 0),
    reaction('pain', 'endorphin', null, 'endorphin', 0.05, 0, 1),         // Endorphin kills pain
    reaction('endorphin', null, 'reward', null, 0.01, 1, 0),              // …and feels good
    reaction('adenosine', 'sleepSignal', null, 'sleepSignal', 0.03, 0, 1), // Sleep clears fatigue
    reaction('adenosine', 'restRelief', null, 'restRelief', 0.01, 0, 1),
    emitter('chem:pain', 'punishment', 0.05, 0.02),
    emitter('chem:nausea', 'punishment', 0.1, 0.005),
    emitter('chem:fear', 'punishment', 0.3, 0.003),
    halfLife('reward', 20), halfLife('punishment', 20),

    // ---------- Receptors: chemicals act on the body ----------
    receptor('glucose', 'muscle', 0.03, 0.6, INVERT | DIGITAL | NEGATIVE), // No sugar, no strength
    receptor('tiredness', 'muscle', 0.3, 0.6, NEGATIVE),
    receptor('adrenaline', 'muscle', 0.1, 1),
    receptor('adrenaline', 'arousal', 0.1, 3),
    receptor('sleepiness', 'sleep', 0.15, 3.95),
    receptor('tiredness', 'sleep', 0.5, 1),
    receptor('adrenaline', 'sleep', 0.2, 3, NEGATIVE),
    receptor('pain', 'sleep', 0.2, 3, NEGATIVE),
    receptor('toxin', 'damage', 0.25, 0.5),
    receptor('coldness', 'thermogenesis', 0.2, 2),
    receptor('hotness', 'cooling', 0.1, 2),                              // Panting
    receptor('fear', 'scentAlarm', 0.3, 2),

    // ---------- Receptors: what the brain can feel (Needs and Feelings cells) ----------
    receptor('tiredness', NEED('rest'), 0.05, 1.2), receptor('sleepiness', NEED('rest'), 0.05, 1.2),
    receptor('loneliness', NEED('call'), 0.05, 1.2),
    receptor('fear', NEED('run'), 0.05, 1.5), receptor('pain', NEED('run'), 0.05, 1.5), receptor('crowdedness', NEED('run'), 0.1, 0.6),
    // Hunger and thirst also feel like wanting to use the mouth, so food at the mouth is eaten
    // when needed, not whenever it happens to be there
    receptor('hunger', NEED('eat'), 0.1, 0.7), receptor('proteinHunger', NEED('eat'), 0.1, 0.6), receptor('thirst', NEED('drink'), 0.1, 0.7),
    // Hunger and boredom make a creature restless: both walk muscles, so it roams
    receptor('hunger', NEED('walkL'), 0.3, 0.4), receptor('hunger', NEED('walkR'), 0.3, 0.4),
    receptor('boredom', NEED('walkL'), 0.2, 1.0), receptor('boredom', NEED('walkR'), 0.2, 1.0),
    receptor('anger', NEED('grab'), 0.2, 0.8),                            // Anger: shove
    ...GENERAL.map(drive => receptor(drive, NEED(drive), 0.05, 1.2)),
    receptor('nausea', NEED('hotness'), 0.05, 1.2),
    receptor('reward', 'limbic:0', 0.01, 3),
    receptor('punishment', 'limbic:1', 0.01, 3),

    // ---------- Adolescence: sex hormones, fertility, courtship scent ----------
    emitter('chem:fat', 'sexHormone', 0.15, 0.001, 0, 3), halfLife('sexHormone', 2000),
    emitter('chem:sexHormone', 'sexDrive', 0.3, 0.001, 0, 3), halfLife('sexDrive', 2000),
    receptor('sexHormone', 'fertility', 0.4, 3.95, 0, 3),
    receptor('sexHormone', 'scentSex', 0.3, 2, 0, 3),

    // ---------- Old age ----------
    emitter('always', 'ageing', 0, 0.000023, 0, 6),
    emitter('always', 'ageing', 0, 0.00004, 0, 7),
    receptor('ageing', 'damage', 0.45, 1.5),

    // ---------- Instincts: replayed in dreams whenever the creature sleeps (switched on from birth,
    // so they matter most in early life, before experience has wired the brain) ----------
    instinct('needs', need('rest'), 'needs', none, MOTOR.rest, 'reward', 0.5),                          // Tired: rest
    instinct('needs', need('hunger'), 'touch', TOUCH.mouthL, MOTOR.eat, 'reward', 0.5),      // Hungry, food at mouth: eat
    instinct('needs', need('hunger'), 'touch', TOUCH.mouthR, MOTOR.eat, 'reward', 0.5),
    instinct('needs', need('thirst'), 'touch', TOUCH.lips, MOTOR.drink, 'reward', 0.5),      // Thirsty, water at lips: drink
    instinct('needs', need('call'), 'needs', none, MOTOR.call, 'reward', 0.3),                           // Lonely: call
    instinct('sight', sight('L', 'low', 'red'), 'needs', need('hunger'), MOTOR.walkL, 'reward', 0.4), // Hungry, sees red: go to it
    instinct('sight', sight('R', 'low', 'red'), 'needs', need('hunger'), MOTOR.walkR, 'reward', 0.4),
    instinct('sight', sight('L', 'low', 'blue'), 'needs', need('thirst'), MOTOR.walkL, 'reward', 0.4), // Thirsty, sees water: go to it
    instinct('sight', sight('R', 'low', 'blue'), 'needs', need('thirst'), MOTOR.walkR, 'reward', 0.4),
    instinct('sight', sight('L', 'low', 'violet'), 'needs', none, MOTOR.walkL, 'punishment', 0.5), // Don't walk into violet
    instinct('sight', sight('R', 'low', 'violet'), 'needs', none, MOTOR.walkR, 'punishment', 0.5),
    instinct('smell', smell('L', 'alarm'), 'needs', none, MOTOR.walkR, 'reward', 0.3),       // Alarm scent: move away
    instinct('smell', smell('R', 'alarm'), 'needs', none, MOTOR.walkL, 'reward', 0.3),
    instinct('touch', TOUCH.pain, 'needs', none, MOTOR.run, 'reward', 0.3)                   // Hurt: run
  ];
})(globalThis.Evo);
