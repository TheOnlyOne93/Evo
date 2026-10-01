// The founder genome: brain wiring genes (see founder.js). Each wire() says which region's axons grow
// toward which spot of which region (see brain.js for the brain map and how the side word works).
(function (Evo) {
  'use strict';
  const { wire, muscleSpot, driveSpot, colourSpot, odourSpot, touchSpot, feelingSpot, stemSpot, sideSpot } = Evo.founderKit;
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
  // A Brainstem action cell needs two things at once. Each input here is too weak to fire it alone;
  // together they do (like a real brainstem cell that waits for two inputs). One weight for the drives
  // and one for touch.
  const DRIVE_INPUT = 0.8, TOUCH_INPUT = 0.55;
  const stemInput = (from, window, key, weight) =>
    wire(from, 'stem', { window, at: stemSpot(key), radius: 0.06, weight });
  // Side lobe cells, as seen from their own side: toward (the outer column) or away (the inner one)
  const toSide = (from, row, weight, away = false, window = null) =>
    wire(from, 'side', { window, at: sideSpot(row, away), radius: 0.06, weight, side: 'same' });
  const SEEN = 0, SMELLED = 1, HEARD = 2, ATTENDED = 3;
  const COLOURS = ['red', 'yellow', 'green', 'blue', 'violet', 'pink', 'creature'];

  Evo.founderBrain = [
    // ---------- Brainstem: actions that need two things at once ----------
    // Eating: hunger of any kind (sugar, protein, fat) together with something at the mouth (either
    // side). Drinking: thirst together with water at the lips. Then the cell excites its muscle hard.
    ...['hunger', 'proteinHunger', 'fatHunger'].map(d => stemInput('needs', around(driveSpot(d), 0.04), 'eat', DRIVE_INPUT)),
    stemInput('touch', [0.5, 0.1, 0.16], 'eat', TOUCH_INPUT),
    stemInput('needs', around(driveSpot('thirst'), 0.04), 'drink', DRIVE_INPUT),
    stemInput('touch', around(touchSpot('lips'), 0.05), 'drink', TOUCH_INPUT),
    ...['eat', 'drink'].map(key =>
      wire('stem', 'motor', { window: around(stemSpot(key), 0.04), at: muscleSpot(key), radius: 0.06, weight: 1.0 })),
    // While the mouth works, the legs hold still: each action cell holds back both walking muscles
    ...['eat', 'drink'].map(key =>
      wire('stem', 'motor', { window: around(stemSpot(key), 0.04), at: WALK, radius: 0.06, weight: -0.6, side: 'same' })),

    // ---------- Side lobes: where is it? ----------
    // Each Side lobe hears only about its own side. Its outer column means "go toward it", the inner one
    // "go away from it"; its rows are what was seen, smelled, heard, and attended to or remembered.
    // Sight: each colour's cells, only a little (what is merely seen pulls gently; what attention picks, which
    // the drives bias, pulls hard); thorny violet means away
    ...[['red', 0.35], ['yellow', 0.3], ['green', 0.3], ['blue', 0.2], ['pink', 0.2], ['creature', 0.2]].map(([f, weight]) =>
      toSide('sight', SEEN, weight, false, around(colourSpot(f), 0.16))),   // Creature: company
    toSide('sight', SEEN, 0.6, true, around(colourSpot('violet'), 0.16)),
    // Smell: every smell draws toward the stronger side. Smell reaches all round the head, so the nose finds
    // food the eyes miss behind: food smells pull harder. Bitter and alarm push away.
    toSide('smell', SMELLED, 0.4),
    ...['sweet', 'starch', 'earthy', 'prey'].map(o => toSide('smell', SMELLED, 0.6, false, around(odourSpot(o), 0.1))),
    toSide('smell', SMELLED, 0.7, true, around(odourSpot('bitter'), 0.1)),
    toSide('smell', SMELLED, 0.7, true, around(odourSpot('alarm'), 0.1)),
    toSide('hearing', HEARD, 0.5),
    // Attention (toward what it attends to, away from violet) and Thinking's working memory (what was
    // there a moment ago, so the creature keeps heading for it once it is out of sight)
    ...COLOURS.filter(f => f !== 'violet').map(f => toSide('attention', ATTENDED, 0.6, false, around(colourSpot(f), 0.06))),
    toSide('attention', ATTENDED, 0.6, true, around(colourSpot('violet'), 0.06)),
    toSide('cortex', ATTENDED, 0.9),
    // To walking: the toward column to the walk muscle on its own side, the away column to the other
    wire('side', 'motor', { window: [0.25, 0.5, 0.4], at: WALK, radius: 0.06, weight: 0.7, side: 'same' }),
    wire('side', 'motor', { window: [0.75, 0.5, 0.4], at: WALK, radius: 0.06, weight: 0.7, side: 'other' }),
    // The where-is-it trace lasts a while: a spatial working memory
    { gene: 'Lobe dynamics', lobe: 'side', competition: 0.1, persistence: 0.6, tau: 0.6, fatigue: 0.8 },

    // ---------- Attention ----------
    // Attention is an orienting map, like the midbrain's: its cells sit at the same spots as the
    // sight columns, and whichever wins the competition turns the creature hard toward what it
    // attends to (away from violet), on top of the Side lobes
    ...COLOURS.map(f =>
      wire('attention', 'motor', { window: around(colourSpot(f), 0.06), at: WALK, radius: 0.06, weight: 1.0, side: f === 'violet' ? 'other' : 'same' })),
    // Sight feeds attention: each sight cell to the attention cell of its side and colour (both heights
    // feed the same cell)
    ...Evo.VISION_FEATURES.map(f => wire('sight', 'attention',
      { window: around(colourSpot(f.key), 0.16), at: colourSpot(f.key), radius: 0.06, weight: 0.85, side: 'same' })),
    // The attention cells compete, so it settles on one thing at a time, and what the creature needs
    // biases which: hunger toward food colours (protein and fat hunger toward bugs and grubs), thirst
    // toward water, loneliness toward other creatures, desire toward the pink of a mate, fear toward
    // danger
    { gene: 'Lobe dynamics', lobe: 'attention', competition: 1.0, persistence: 0.3, tau: 0.2, fatigue: 0.9 },
    ...['red', 'yellow', 'green'].map(f => attend('hunger', f)),
    ...['proteinHunger', 'fatHunger'].flatMap(d => ['green', 'yellow'].map(f => attend(d, f))),
    attend('thirst', 'blue'),
    attend('loneliness', 'creature'),
    attend('sexDrive', 'pink'),
    attend('fear', 'violet'),

    // ---------- Thinking ----------
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
    // Thinking and the Central lobe reach the muscles broadly
    wire('cortex', 'motor', { radius: 0.6, weight: 0.2 }),
    wire('central', 'motor', { radius: 0.6, weight: 0.2 }),
    // Working memory: thinking cells that fire keep themselves going for a while, so what was
    // just seen or felt outlasts it (until they tire or a rival takes over)
    { gene: 'Lobe dynamics', lobe: 'cortex', competition: 0.1, persistence: 0.6, tau: 0.7, fatigue: 0.8 },

    // ---------- Feelings ----------
    // Sights and smells reach the reward and punishment cells weakly; these cue synapses learn
    // what each sight or smell predicts
    ...['sight', 'smell'].flatMap(lobe => [0, 1].map(k => wire(lobe, 'feelings', { at: feelingSpot(k), radius: 0.06, weight: 0.25 }))),
    // The alarm odour excites the fear cell (Feelings cell 3)
    wire('smell', 'feelings', { window: around(odourSpot('alarm'), 0.1), at: feelingSpot(2), radius: 0.06, weight: 0.9 }),
    // Feelings project broadly and fast: where the reward cell's axons end is where learning happens
    // (the chemical is released at the terminals; the synapses themselves are weak)
    ...['attention', 'cortex', 'side', 'central', 'motor', 'stem'].map(to =>
      wire('feelings', to, { radius: 0.8, weight: 0.2, speed: 0.5, side: 'same' })),

    // ---------- Innate priors ----------
    // Each gene leans one drive cell on one muscle (pain, fear and sleepiness at full strength); the
    // rest is learned. Eating and drinking are the Brainstem's. The walking ones are weak: they only get the
    // legs going and leave the steering to the Side lobes.
    prior('pain', 'run', 1.0), prior('fear', 'run', 1.0),
    prior('sleepiness', 'rest', 1.0), prior('tiredness', 'rest', 0.7), prior('nausea', 'rest', 0.6),
    prior('loneliness', 'call', 0.6), prior('anger', 'grab', 0.6),
    ...['boredom', 'crowdedness', 'hunger', 'thirst'].flatMap(d => [prior(d, 'walkL', 0.2), prior(d, 'walkR', 0.2)]),

    // ---------- Touch reflexes ----------
    // Pain -> run
    wire('touch', 'motor', { window: around(touchSpot('pain'), 0.05), at: muscleSpot('run'), radius: 0.06, weight: 0.3 }),
    // Bumping into something on one side makes the opposite leg push: turn away from walls
    wire('touch', 'motor', { window: around(touchSpot('contactL'), 0.05), at: muscleSpot('walkR'), radius: 0.06, weight: 0.6 }),
    wire('touch', 'motor', { window: around(touchSpot('contactR'), 0.05), at: muscleSpot('walkL'), radius: 0.06, weight: 0.6 }),

    // ---------- Lobe dynamics ----------
    { gene: 'Pacemaker', lobe: 'motor', bias: 0.3 },                   // Restless muscles: exploration
    // Action selection: the muscles compete, the most strongly driven one wins and keeps going
    // until it tires or something much more pressing comes up
    { gene: 'Lobe dynamics', lobe: 'motor', competition: 0.2, persistence: 0.2, tau: 0.3, fatigue: 0.9 },

    // ---------- Cell types ----------
    // Muscles, Feelings cells and Brainstem cells rest nearly silent and grow only a little twitchier
    // when quiet, so a single weak input doesn't make them fire (a Feelings cell that fired at rest
    // would make fear all the time; a Brainstem cell must wait for two inputs at once). Brainstem cells
    // are hard-wired, like a real brainstem's reflex circuits: their connections never change in life.
    // Learning happens in the regions that feed them.
    ...['motor', 'feelings'].map(lobe => ({ gene: 'Cell type', lobe, rest: 0.2408, twitch: 0.1875, learns: 1 })),
    { gene: 'Cell type', lobe: 'stem', rest: 0.2408, twitch: 0.1875, learns: 0 }
  ];
})(globalThis.Evo);
