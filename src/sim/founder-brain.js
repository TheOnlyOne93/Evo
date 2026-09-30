// The founder genome: brain wiring genes (see founder.js).
(function (Evo) {
  'use strict';
  const { FEELING_TAGS, SIDES, sideX, MUSCLE_Z, FEELING_Z } = Evo.BRAIN_BODY_PLAN;
  const { approach, guide, prior, driveCell, FEATURES, ODOURS } = Evo.founderKit;
  // A drive's own cell in the Drives lobe, as a source window for a guidance gene
  const driveWindow = key => [...Evo.DRIVE_CELL_TAGS[driveCell(key)], 0.05];
  // Top-down attention: a drive's cell biases the sight copy's cells for one feature (either side)
  const attend = (drive, feature) => SIDES.map(sideX).map(x =>
    guide('needs', [x, (FEATURES.indexOf(feature) + 0.5) / FEATURES.length, 0.22], { radius: 0.08, weight: 0.3, reach: 1.2, from: driveWindow(drive) }));

  Evo.founderBrain = [
    // ---------- Brain wiring ----------
    // Orienting. A sight cell's tag says which side (x) and which colour (y) it sees; the walk
    // muscles sit at y = 0.5. Each of these genes carries one colour's cells to walking toward
    // (or, crossed, away from) the side they see it on. Food colours pull hardest. The sight copy
    // inherits these genes: what it attends to pulls on top.
    ...['red', 'yellow', 'green'].map(f => approach('sight', FEATURES, f, f === 'red' ? 0.42 : 0.35)),
    approach('sight', FEATURES, 'blue', 0.21),
    approach('sight', FEATURES, 'pink', 0.21),
    approach('sight', FEATURES, 'creature', 0.21),                    // Company
    approach('sight', FEATURES, 'violet', 0.5, true),                   // Thorny violet: walk away
    // Every smell draws the creature toward the side it is stronger on; bitter and alarm push away
    guide('smell', [0.5, 0.5, MUSCLE_Z], { radius: 0.12, weight: 0.3, relX: true }),
    approach('smell', ODOURS, 'bitter', 0.6, true),
    approach('smell', ODOURS, 'alarm', 0.6, true),
    guide('hearing', [0.5, 0.5, MUSCLE_Z], { radius: 0.12, weight: 0.35, relX: true }),
    // Innate priors: a few drive cells lean weakly on one muscle each; the rest is learned
    prior('pain', 'run', 1.0), prior('fear', 'run', 1.0),
    prior('sleepiness', 'rest', 1.0), prior('tiredness', 'rest', 0.7), prior('nausea', 'rest', 0.6),
    prior('loneliness', 'call', 0.6), prior('hunger', 'eat', 0.4), prior('proteinHunger', 'eat', 0.3),
    prior('thirst', 'drink', 0.5), prior('anger', 'grab', 0.6),
    ...['boredom', 'crowdedness', 'hunger', 'thirst'].flatMap(d => [prior(d, 'walkL', 0.4), prior(d, 'walkR', 0.4)]),
    // Each touch cell excites the muscle that shares its address (something at the mouth -> eat it)
    guide('touch', [0.5, 0.5, MUSCLE_Z], { radius: 0.08, weight: 0.3, relX: true, relY: true }),
    // Bumping into something on one side makes the opposite leg push: turn away from walls
    guide('touch', [0.5, 0.5, MUSCLE_Z], { radius: 0.06, weight: 0.6, relX: true, mirrorX: true }),
    // What is up close (its look) informs thinking; whether to eat it is learned (instincts)
    guide('near', [0.5, 0.5, 0.5], { radius: 0.45, weight: 0.3, reach: 0.6 }),
    // Tastes inform thinking (what was just eaten), not the jaws directly
    guide('taste', [0.5, 0.5, 0.5], { radius: 0.3, weight: 0.3, reach: 0.8 }),
    // Sights and smells reach the reward and punishment cells weakly; these cue synapses learn
    // what each sight or smell predicts
    ...['sight', 'smell'].flatMap(lobe => FEELING_TAGS.slice(0, 2).map(tag => [...tag, FEELING_Z]).map(cell => guide(lobe, cell, { radius: 0.08, weight: 0.25 }))),
    // The alarm odour excites the feelings cell that shares its address (a fear cell)
    guide('smell', [0.5, 0.5, FEELING_Z], { radius: 0.07, weight: 0.9, relY: true }),
    // Feelings project broadly and fast: where the reward cell's axons end is where learning happens
    // (the chemical is released at the terminals; the synapses themselves are weak)
    guide('feelings', [0.5, 0.5, 0.65], { radius: 0.8, weight: 0.2, conduction: 0.5 }),
    // Association: senses and needs into the thinking regions, and thinking regions to the muscles
    guide('needs', [0.5, 0.5, 0.55], { radius: 0.3, weight: 0.4, reach: 0.8 }),
    guide('sight', [0.5, 0.5, 0.5], { radius: 0.45, weight: 0.3, reach: 0.6 }),
    // The colours of food and water (red to blue) on one side reach the thinking cells tagged for
    // that side strongly enough to start working memory there
    ...SIDES.map(sideX).map(x => guide('sight', [x, 0.33, 0.45], { radius: 0.35, weight: 0.8, reach: 0.6, from: [x, 0.25, 0.2] })),
    guide('smell', [0.5, 0.5, 0.5], { radius: 0.45, weight: 0.3, reach: 0.6 }),
    guide('cortex', [0.5, 0.5, MUSCLE_Z], { radius: 0.6, weight: 0.2, reach: 0.8 }),
    // …and each thinking cell also pulls on the walk muscle on its own side, so what working memory
    // holds (something there, a moment ago) keeps the creature heading toward it once it is out of sight
    guide('cortex', [0.5, 0.5, MUSCLE_Z], { radius: 0.2, weight: 0.7, reach: 0.8, relX: true }),
    guide('central', [0.5, 0.5, MUSCLE_Z], { radius: 0.6, weight: 0.2, reach: 0.8 }),
    { gene: 'Pacemaker', lobe: 'motor', bias: 0.3 },                   // Restless muscles: exploration
    { gene: 'Region duplication', source: 'motor', depth: 1.0, lateral: 0.5, chemShift: 0.5, input: 0.92 }, // Efference copy
    { gene: 'Region duplication', source: 'sight', depth: 0.69, lateral: 0.5, chemShift: 0.5, input: 0.92 }, // Orienting map
    // Action selection: the muscles compete, the most strongly driven one wins and keeps going
    // until it tires or something much more pressing comes up
    { gene: 'Lobe dynamics', lobe: 'motor', copy: 0, competition: 0.2, persistence: 0.2, tau: 0.3, fatigue: 0.9 },
    // Attention: the sight copy's cells compete, so it settles on one thing at a time, and what
    // the creature needs biases which: hunger toward food colours, thirst toward water, loneliness
    // toward other creatures, desire toward the pink of a mate
    { gene: 'Lobe dynamics', lobe: 'sight', copy: 1, competition: 1.0, persistence: 0.3, tau: 0.2, fatigue: 0.9 },
    ...['red', 'yellow', 'green'].flatMap(f => attend('hunger', f)),
    ...attend('thirst', 'blue'),
    ...attend('loneliness', 'creature'),
    ...attend('sexDrive', 'pink'),
    // Working memory: thinking cells that fire keep themselves going for a while, so what was
    // just seen or felt outlasts it (until they tire or a rival takes over)
    { gene: 'Lobe dynamics', lobe: 'cortex', copy: 0, competition: 0.1, persistence: 0.6, tau: 0.7, fatigue: 0.8 },
  ];
})(globalThis.Evo);
