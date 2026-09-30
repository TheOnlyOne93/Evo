// The founder genome: brain wiring genes (see founder.js). Each wire() says which region's axons grow
// toward which spot of which region (see brain.js for the brain map and how the side word works).
(function (Evo) {
  'use strict';
  const { wire, muscleSpot, driveSpot, colourSpot, odourSpot, touchSpot, feelingSpot } = Evo.founderKit;
  const WALK = muscleSpot('walkL'); // The left walking muscle; 'same' side aims a right cell at the right one
  // A source window around a spot: only the cells there send axons (in a two-sided region, both twins)
  const around = (spot, r) => [...spot, r];
  // Top-down attention: a drive's cell biases the attention cells for one feature (both sides, as
  // the drive has no side)
  const attend = (drive, feature) => wire('needs', 'attention',
    { window: around(driveSpot(drive), 0.04), at: colourSpot(feature), radius: 0.06, weight: 0.3, side: 'same' });
  // An innate prior: axons from one drive's cell only (a source window) to one muscle
  const prior = (drive, motor, weight) => wire('needs', 'motor',
    { window: around(driveSpot(drive), 0.04), at: muscleSpot(motor), radius: 0.06, weight });

  Evo.founderBrain = [
    // ---------- Brain wiring ----------
    // Orienting. A sight cell's spot says which colour (along the box) and which side it sees; the two
    // walking muscles are a left-right pair. Each of these genes carries one colour's cells to walking
    // toward (or, with 'other', away from) the side they see it on. Food colours pull hardest.
    ...[['red', 0.42], ['yellow', 0.35], ['green', 0.35], ['blue', 0.21], ['pink', 0.21], ['creature', 0.21]].map(([f, weight]) =>
      wire('sight', 'motor', { window: around(colourSpot(f), 0.16), at: WALK, radius: 0.06, weight, side: 'same' })),   // Creature: company
    wire('sight', 'motor', { window: around(colourSpot('violet'), 0.16), at: WALK, radius: 0.06, weight: 0.5, side: 'other' }), // Thorny violet: walk away
    // Attention is an orienting map, like the midbrain's: its cells sit at the same spots as the
    // sight columns, and whichever wins the competition turns the creature hard toward what it
    // attends to (away from violet), on top of what it merely sees
    ...['red', 'yellow', 'green', 'blue', 'violet', 'pink', 'creature'].map(f =>
      wire('attention', 'motor', { window: around(colourSpot(f), 0.06), at: WALK, radius: 0.06, weight: 1.0, side: f === 'violet' ? 'other' : 'same' })),
    // Every smell draws the creature toward the side it is stronger on; bitter and alarm push away
    wire('smell', 'motor', { at: WALK, radius: 0.06, weight: 0.3, side: 'same' }),
    wire('smell', 'motor', { window: around(odourSpot('bitter'), 0.1), at: WALK, radius: 0.06, weight: 0.6, side: 'other' }),
    wire('smell', 'motor', { window: around(odourSpot('alarm'), 0.1), at: WALK, radius: 0.06, weight: 0.6, side: 'other' }),
    wire('hearing', 'motor', { at: WALK, radius: 0.06, weight: 0.35, side: 'same' }),
    // Innate priors: each gene leans one drive cell on one muscle (pain, fear and sleepiness at full
    // strength); the rest is learned
    prior('pain', 'run', 1.0), prior('fear', 'run', 1.0),
    prior('sleepiness', 'rest', 1.0), prior('tiredness', 'rest', 0.7), prior('nausea', 'rest', 0.6),
    prior('loneliness', 'call', 0.6), prior('hunger', 'eat', 0.4), prior('proteinHunger', 'eat', 0.3),
    prior('thirst', 'drink', 0.5), prior('anger', 'grab', 0.6),
    ...['boredom', 'crowdedness', 'hunger', 'thirst'].flatMap(d => [prior(d, 'walkL', 0.4), prior(d, 'walkR', 0.4)]),
    // Touch cells that excite the muscle they belong with: something at the mouth (either side, not
    // the lips) -> eat, water at the lips -> drink, pain -> run
    wire('touch', 'motor', { window: [0.5, 0.1, 0.16], at: muscleSpot('eat'), radius: 0.06, weight: 0.3 }),
    wire('touch', 'motor', { window: around(touchSpot('lips'), 0.05), at: muscleSpot('drink'), radius: 0.06, weight: 0.3 }),
    wire('touch', 'motor', { window: around(touchSpot('pain'), 0.05), at: muscleSpot('run'), radius: 0.06, weight: 0.3 }),
    // Bumping into something on one side makes the opposite leg push: turn away from walls
    wire('touch', 'motor', { window: around(touchSpot('contactL'), 0.05), at: muscleSpot('walkR'), radius: 0.06, weight: 0.6 }),
    wire('touch', 'motor', { window: around(touchSpot('contactR'), 0.05), at: muscleSpot('walkL'), radius: 0.06, weight: 0.6 }),
    // What is up close (its look), tastes (what was just eaten), sights, what it attends to, smells,
    // drives, and what the muscles just did (Movement) reach the thinking regions, each side to its own
    // side. Whether to eat what is up close is learned (instincts), not wired to the jaws.
    ...['near', 'taste', 'sight', 'attention', 'smell'].flatMap(lobe => ['cortex', 'central'].map(to =>
      wire(lobe, to, { radius: 0.45, weight: 0.3, side: 'same' }))),
    ...['cortex', 'central'].map(to => wire('needs', to, { radius: 0.45, weight: 0.4, side: 'same' })),
    wire('motor', 'cortex', { radius: 0.45, weight: 0.3, side: 'same' }),
    // The colours of food and water (red to blue, not violet) on one side start working memory on that
    // side of Thinking strongly enough to keep it going
    wire('sight', 'cortex', { window: [0.25, 0.5, 0.26], radius: 0.35, weight: 0.8, side: 'same' }),
    wire('attention', 'cortex', { window: [0.25, 0.5, 0.2], radius: 0.35, weight: 0.8, side: 'same' }),
    // Sight feeds attention: each sight cell to the attention cell of its side and colour (both heights
    // feed the same cell)
    ...Evo.VISION_FEATURES.map(f => wire('sight', 'attention',
      { window: around(colourSpot(f.key), 0.16), at: colourSpot(f.key), radius: 0.06, weight: 0.85, side: 'same' })),
    // Sights and smells reach the reward and punishment cells weakly; these cue synapses learn
    // what each sight or smell predicts
    ...['sight', 'smell'].flatMap(lobe => [0, 1].map(k => wire(lobe, 'feelings', { at: feelingSpot(k), radius: 0.06, weight: 0.25 }))),
    // The alarm odour excites the fear cell (Feelings cell 3)
    wire('smell', 'feelings', { window: around(odourSpot('alarm'), 0.1), at: feelingSpot(2), radius: 0.06, weight: 0.9 }),
    // Feelings project broadly and fast: where the reward cell's axons end is where learning happens
    // (the chemical is released at the terminals; the synapses themselves are weak)
    ...['attention', 'cortex', 'side', 'central', 'motor', 'stem'].map(to =>
      wire('feelings', to, { radius: 0.8, weight: 0.2, speed: 0.5, side: 'same' })),
    // Thinking to the muscles, broadly…
    wire('cortex', 'motor', { radius: 0.6, weight: 0.2 }),
    // …and each thinking cell also pulls on the walk muscle on its own side, so what working memory
    // holds (something there, a moment ago) keeps the creature heading toward it once it is out of sight
    wire('cortex', 'motor', { at: WALK, radius: 0.06, weight: 0.7, side: 'same' }),
    wire('central', 'motor', { radius: 0.6, weight: 0.2 }),
    { gene: 'Pacemaker', lobe: 'motor', bias: 0.3 },                   // Restless muscles: exploration
    // Action selection: the muscles compete, the most strongly driven one wins and keeps going
    // until it tires or something much more pressing comes up
    { gene: 'Lobe dynamics', lobe: 'motor', competition: 0.2, persistence: 0.2, tau: 0.3, fatigue: 0.9 },
    // Attention: the attention cells compete, so it settles on one thing at a time, and what
    // the creature needs biases which: hunger toward food colours, thirst toward water, loneliness
    // toward other creatures, desire toward the pink of a mate
    { gene: 'Lobe dynamics', lobe: 'attention', competition: 1.0, persistence: 0.3, tau: 0.2, fatigue: 0.9 },
    ...['red', 'yellow', 'green'].map(f => attend('hunger', f)),
    attend('thirst', 'blue'),
    attend('loneliness', 'creature'),
    attend('sexDrive', 'pink'),
    // Working memory: thinking cells that fire keep themselves going for a while, so what was
    // just seen or felt outlasts it (until they tire or a rival takes over)
    { gene: 'Lobe dynamics', lobe: 'cortex', competition: 0.1, persistence: 0.6, tau: 0.7, fatigue: 0.8 },
    // Kinds of cell: muscles, Feelings cells and Brainstem cells rest nearly silent and grow only a
    // little twitchier when quiet, so a single weak input doesn't make them fire (a Feelings cell that
    // fired at rest would make fear all the time; a Brainstem cell must wait for two inputs at once)
    ...['motor', 'feelings', 'stem'].map(lobe => ({ gene: 'Cell type', lobe, rest: 0.2408, twitch: 0.1875 }))
  ];
})(globalThis.Evo);
