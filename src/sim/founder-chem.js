// The founder genome: metabolism, drives, receptors and instincts (see founder.js).
(function (Evo) {
  'use strict';
  const { reaction, emitter, receptor, stimulus, halfLife, initial, instinct, INVERT, DIGITAL, NEGATIVE, none, FEATURES, MOTOR, need, NEED, sight, smell, TOUCH } = Evo.founderKit;

  Evo.founderChem = [
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
    // Tasting food is what satisfies at the moment of eating (consummatory relief)
    emitter('tasteSweet', 'sweetTaste', 0.05, 0.05), emitter('tasteStarch', 'sweetTaste', 0.05, 0.05),
    emitter('tasteSavory', 'savouryTaste', 0.05, 0.05), emitter('tasteFat', 'savouryTaste', 0.05, 0.05),
    emitter('mated', 'mating', 0, 0.05),
    halfLife('warmth', 60), halfLife('coolness', 60), halfLife('company', 60), halfLife('endorphin', 200),
    halfLife('novelty', 30), halfLife('restRelief', 30), halfLife('sleepSignal', 60), halfLife('drink', 20), halfLife('mating', 120),
    halfLife('sweetTaste', 15), halfLife('savouryTaste', 15),
    // ---------- Stimuli: what happens to the creature releases chemicals directly ----------
    stimulus('patted', 'reward', 0.2, 'company', 0.1),
    stimulus('slapped', 'punishment', 0.25, 'fear', 0.05),
    stimulus('wasNuzzled', 'company', 0.08),
    stimulus('nuzzled', 'company', 0.05),
    stimulus('wasShoved', 'anger', 0.1, 'fear', 0.05),
    stimulus('played', 'novelty', 0.15),
    stimulus('bumped', 'pain', 0.02),
    stimulus('fellAsleep', 'sleepOnset', 0.3), halfLife('sleepOnset', 30),

    // ---------- Reinforcement: relief turns drive into reward; harm releases punishment ----------
    // Eating rewards when the food is tasted, in proportion to the hunger it meets…
    reaction('hunger', 'sweetTaste', 'reward', null, 0.1, 2, 0),
    reaction('proteinHunger', 'savouryTaste', 'reward', null, 0.1, 2, 0),
    reaction('fatHunger', 'savouryTaste', 'reward', 'savouryTaste', 0.1, 0.8, 1),
    // …while a full gut quietly sates, without reward (so a meal doesn't keep rewarding long after)
    reaction('hunger', 'gutSugar', null, 'gutSugar', 0.01, 0, 1),
    reaction('hunger', 'gutStarch', null, 'gutStarch', 0.01, 0, 1),
    reaction('proteinHunger', 'gutProtein', null, 'gutProtein', 0.01, 0, 1),
    reaction('fatHunger', 'gutFat', null, 'gutFat', 0.01, 0, 1),
    reaction('thirst', 'drink', 'reward', null, 0.1, 0.8, 0),
    reaction('tiredness', 'restRelief', 'reward', null, 0.08, 0.5, 0),
    reaction('sleepiness', 'sleepOnset', 'reward', null, 0.1, 1, 0),   // Dozing off feels good (once, not all night)
    reaction('sleepiness', 'sleepSignal', null, 'sleepSignal', 0.002, 0, 1), // Sleep eases sleepiness, but night keeps it going
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
    emitter('chem:nausea', 'punishment', 0.1, 0.02),
    emitter('tasteBitter', 'punishment', 0.05, 0.05),                    // Bitter tastes bad at once…
    emitter('tasteBitter', 'nausea', 0.2, 0.01),                         // …and a lot of it sickens
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

    // ---------- Receptors: what the brain can feel (Drives and Feelings cells) ----------
    // Each drive has its own cell in the Drives lobe; what it makes the creature do is up to the
    // brain's wiring (innate priors in founder-brain.js, then learning)
    ...Evo.DRIVES.map(drive => receptor(drive, NEED(drive), 0.05, 1.2)),
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
    // Drives met with the right thing up close: eat it, drink it, nuzzle it
    ...['red', 'yellow', 'green'].map(f => instinct('needs', need('hunger'), 'near', FEATURES.indexOf(f), MOTOR.eat, 'reward', 0.5)),
    instinct('needs', need('proteinHunger'), 'near', FEATURES.indexOf('green'), MOTOR.eat, 'reward', 0.4),
    instinct('needs', need('thirst'), 'touch', TOUCH.lips, MOTOR.drink, 'reward', 0.5),
    instinct('needs', need('loneliness'), 'near', FEATURES.indexOf('creature'), MOTOR.eat, 'reward', 0.3),
    // Drives on their own
    instinct('needs', need('sleepiness'), 'needs', none, MOTOR.rest, 'reward', 0.5),
    instinct('needs', need('tiredness'), 'needs', none, MOTOR.rest, 'reward', 0.4),
    instinct('needs', need('loneliness'), 'needs', none, MOTOR.call, 'reward', 0.3),
    instinct('needs', need('pain'), 'needs', none, MOTOR.run, 'reward', 0.3),
    instinct('needs', need('fear'), 'needs', none, MOTOR.run, 'reward', 0.3),
    // Places and smells to keep away from
    instinct('sight', sight('L', 'low', 'violet'), 'needs', none, MOTOR.walkL, 'punishment', 0.5), // Don't walk into violet
    instinct('sight', sight('R', 'low', 'violet'), 'needs', none, MOTOR.walkR, 'punishment', 0.5),
    instinct('smell', smell('L', 'alarm'), 'needs', none, MOTOR.walkR, 'reward', 0.3),       // Alarm scent: move away
    instinct('smell', smell('R', 'alarm'), 'needs', none, MOTOR.walkL, 'reward', 0.3)
  ];

  Evo.FOUNDER_GENOME = [...Evo.founderBody, ...Evo.founderBrain, ...Evo.founderChem];
})(globalThis.Evo);
