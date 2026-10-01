// Tables that several parts of the simulation (and the UI) share. Every chemical, item, season and
// brain region, and most senses, are defined once here (brain.js lays out the touch cells);
// everything else derives from these tables.
(function (Evo) {
  'use strict';

  // ---- Time ----
  const TICKS_PER_SECOND = 60;
  const DAY_TICKS = 3 * 60 * TICKS_PER_SECOND;   // A day lasts three minutes at 1x
  const SEASON_DAYS = 2;

  // ---- Life stages. `until` is the fraction of the lifespan at which the stage ends. ----
  const STAGES = [
    { key: 'embryo', word: 'Egg', until: 0 },
    { key: 'baby', word: 'Baby', until: 0.05 },
    { key: 'child', word: 'Child', until: 0.15 },
    { key: 'adolescent', word: 'Adolescent', until: 0.25 },
    { key: 'youth', word: 'Youth', until: 0.35 },
    { key: 'adult', word: 'Adult', until: 0.75 },
    { key: 'old', word: 'Old', until: 0.90 },
    { key: 'senile', word: 'Senile', until: Infinity }
  ];
  const STAGE = Object.fromEntries(STAGES.map((s, i) => [s.key.toUpperCase(), i]));

  // ---- Odours diffusing through the air. `token` is the CSS colour used to draw each one. ----
  const SCENTS = [
    { key: 'sweet',   word: 'sweet',       token: '--fruit',   diffusion: 0.20, decay: 0.006 },
    { key: 'starch',  word: 'grainy',      token: '--grain',   diffusion: 0.18, decay: 0.006 },
    { key: 'moist',   word: 'water',       token: '--water',   diffusion: 0.20, decay: 0.016 },
    { key: 'bitter',  word: 'bitter',      token: '--toxin',   diffusion: 0.16, decay: 0.010 },
    { key: 'earthy',  word: 'earthy',      token: '--grub',    diffusion: 0.14, decay: 0.006 },
    { key: 'prey',    word: 'bug',         token: '--protein', diffusion: 0.20, decay: 0.010 },
    { key: 'muskF',   word: 'female musk', token: '--female',  diffusion: 0.22, decay: 0.006 },
    { key: 'muskM',   word: 'male musk',   token: '--male',    diffusion: 0.22, decay: 0.006 },
    { key: 'alarm',   word: 'alarm',       token: '--alarm',   diffusion: 0.24, decay: 0.030 },
    { key: 'carrion', word: 'rot',         token: '--carrion', diffusion: 0.18, decay: 0.014 }
  ];
  const SCENT = Object.fromEntries(SCENTS.map((s, i) => [s.key, i]));

  // ---- Vision: what an eye reports about a thing. Colours by hue, plus movement. ----
  const VISION_FEATURES = [
    { key: 'red', word: 'something red', hue: 0 },
    { key: 'yellow', word: 'something yellow', hue: 50 },
    { key: 'green', word: 'something green', hue: 120 },
    { key: 'blue', word: 'something blue', hue: 200 },
    { key: 'violet', word: 'something violet', hue: 275 },
    { key: 'pink', word: 'something pink', hue: 325 },
    { key: 'creature', word: 'another creature' },   // A big furry shape, whatever its colour
    { key: 'motion', word: 'movement' }
  ];
  const HUES = VISION_FEATURES.filter(f => f.hue !== undefined);
  // How strongly a surface of hue h (degrees) excites each colour channel (hue receptors overlap)
  function hueFeatures(h, strength = 1) {
    const out = {};
    for (const f of HUES) {
      const d = Math.abs(((h - f.hue + 540) % 360) - 180);
      const w = Math.max(0, 1 - d / 45);
      if (w > 0) out[f.key] = w * strength;
    }
    return out;
  }

  // ---- Items: how each looks, smells, what it contains, how it moves ----
  // look: visual features. odour: [[scent channel, rate]]. food: what enters the gut when eaten
  // (units are chemical concentrations; taste is derived from it; 'contents' means whatever a dead body
  // held, as with carrion). ttl: ticks before it rots. Movement: bounce: fraction of speed kept on a
  // bounce. crawls: wander speed on the ground. flees: crawls away from creatures. hops: jumps while
  // fleeing. rolls: rolls and spins. Items that roll or bounce slide downhill.
  const ITEM_TYPES = {
    fruit:   { word: 'fruit', radius: 6, look: { red: 1 }, odour: [[SCENT.sweet, 0.05]], food: { gutSugar: 0.3, water: 0.06 }, ttl: 7200, bounce: 0.3 },
    grain:   { word: 'grain', radius: 5, look: { yellow: 1 }, odour: [[SCENT.starch, 0.04]], food: { gutStarch: 0.3, gutProtein: 0.06 }, ttl: 14400, bounce: 0.2 },
    grub:    { word: 'grub', radius: 5, look: { yellow: 0.5, red: 0.2 }, odour: [[SCENT.earthy, 0.05]], food: { gutProtein: 0.18, gutFat: 0.08, water: 0.02 }, ttl: 9000, crawls: 0.15 },
    bug:     { word: 'bug', radius: 4.5, look: { green: 1 }, odour: [[SCENT.prey, 0.05]], food: { gutProtein: 0.2, gutFat: 0.1, water: 0.02 }, ttl: 12000, crawls: 0.6, flees: true, hops: true },
    mimic:   { word: 'mimic berry', radius: 6, look: { red: 0.9, violet: 0.25 }, odour: [[SCENT.sweet, 0.035], [SCENT.bitter, 0.02]], food: { gutSugar: 0.08, toxin: 0.35 }, ttl: 7200, bounce: 0.3 },
    dew:     { word: 'dew drop', radius: 4, look: { blue: 0.8 }, odour: [[SCENT.moist, 0.03]], food: { water: 0.14 }, ttl: 3600 },
    lure:    { word: 'lure', radius: 6, look: { pink: 1 }, odour: [[SCENT.muskF, 0.12]], food: null, ttl: 2400 },
    carrion: { word: 'carrion', radius: 9, look: { red: 0.2, violet: 0.2 }, odour: [[SCENT.carrion, 0.06]], food: 'contents', ttl: 5400 },
    egg:     { word: 'egg', radius: 7, look: {}, odour: [], food: null, bounce: 0.2 },
    ball:    { word: 'ball', radius: 8, look: {}, odour: [], food: null, bounce: 0.7, rolls: true }
  };

  // ---- Seasons: temperature, dew and what grows ----
  // temp: mean ambient temperature (0 freezing .. 1 hot); swing: the day-night amplitude (half the difference);
  // dew: how likely dew drops are at dawn (a multiplier). grow: growth multipliers for each food source
  const SEASONS = [
    { key: 'SPRING', word: 'Spring', temp: 0.48, swing: 0.14, dew: 1.0, grow: { fruit: 0.4, grain: 0.5, grub: 1.0, bug: 1.2, mimic: 0.4 } },
    { key: 'SUMMER', word: 'Summer', temp: 0.6, swing: 0.13, dew: 0.5, grow: { fruit: 1.2, grain: 1.0, grub: 1.0, bug: 1.3, mimic: 1.0 } },
    { key: 'AUTUMN', word: 'Autumn', temp: 0.44, swing: 0.12, dew: 1.0, grow: { fruit: 1.3, grain: 1.2, grub: 0.8, bug: 0.6, mimic: 1.2 } },
    { key: 'WINTER', word: 'Winter', temp: 0.22, swing: 0.10, dew: 0.0, grow: { fruit: 0.1, grain: 0.3, grub: 0.5, bug: 0.1, mimic: 0.1 } }
  ];

  // ---- Chemicals: 64 slots. Slot 0 is nothing; named ones below; the rest are free for mutation to use. ----
  // kind: 'nutrient' | 'hormone' | 'drive' | 'relief' | 'reinforcer' | 'other'
  const N_CHEM = 64;
  const CHEMICAL_LIST = [
    [1, 'gutSugar', 'Gut sugar', 'nutrient', '--fruit'], [2, 'gutStarch', 'Gut starch', 'nutrient', '--grain'],
    [3, 'gutProtein', 'Gut protein', 'nutrient', '--protein'], [4, 'gutFat', 'Gut fat', 'nutrient', '--fat'],
    [5, 'glucose', 'Blood sugar', 'nutrient', '--energy'], [6, 'glycogen', 'Glycogen', 'nutrient', '--grain'],
    [7, 'fat', 'Fat store', 'nutrient', '--fat'], [8, 'protein', 'Body protein', 'nutrient', '--protein'],
    [9, 'water', 'Water', 'nutrient', '--water'], [10, 'toxin', 'Toxin', 'other', '--toxin'],
    [11, 'insulin', 'Insulin', 'hormone', '--muted'], [12, 'glucagon', 'Glucagon', 'hormone', '--muted'],
    [13, 'adrenaline', 'Adrenaline', 'hormone', '--alarm'], [14, 'adenosine', 'Adenosine', 'hormone', '--muted'],
    [15, 'melatonin', 'Melatonin', 'hormone', '--bored'], [16, 'growthHormone', 'Growth hormone', 'hormone', '--protein'],
    [17, 'sexHormone', 'Sex hormone', 'hormone', '--female'], [18, 'endorphin', 'Endorphin', 'hormone', '--joy'],
    [19, 'ageing', 'Ageing', 'other', '--faint'], [20, 'liverEnzyme', 'Liver enzyme', 'hormone', '--toxin'],
    [22, 'pain', 'Pain', 'drive', '--injury'], [23, 'hunger', 'Hunger', 'drive', '--energy'],
    [24, 'proteinHunger', 'Protein hunger', 'drive', '--protein'], [25, 'fatHunger', 'Fat hunger', 'drive', '--fat'],
    [26, 'thirst', 'Thirst', 'drive', '--water'], [27, 'tiredness', 'Tiredness', 'drive', '--muted'],
    [28, 'sleepiness', 'Sleepiness', 'drive', '--bored'], [29, 'coldness', 'Coldness', 'drive', '--water'],
    [30, 'hotness', 'Hotness', 'drive', '--fruit'], [31, 'loneliness', 'Loneliness', 'drive', '--bored'],
    [32, 'crowdedness', 'Crowdedness', 'drive', '--stress'], [33, 'fear', 'Fear', 'drive', '--toxin'],
    [34, 'anger', 'Anger', 'drive', '--stress'], [35, 'boredom', 'Boredom', 'drive', '--bored'],
    [36, 'sexDrive', 'Sex drive', 'drive', '--female'], [37, 'nausea', 'Nausea', 'drive', '--toxin'],
    [38, 'reward', 'Reward', 'reinforcer', '--joy'], [39, 'punishment', 'Punishment', 'reinforcer', '--stress'],
    [40, 'warmth', 'Warmth', 'relief', '--fruit'], [41, 'coolness', 'Coolness', 'relief', '--water'],
    [42, 'company', 'Company', 'relief', '--female'], [43, 'restRelief', 'Rest', 'relief', '--muted'],
    [44, 'sleepSignal', 'Sleep', 'relief', '--bored'], [45, 'novelty', 'Novelty', 'relief', '--accent'],
    [46, 'drink', 'Drinking', 'relief', '--water'], [47, 'mating', 'Mating', 'relief', '--female'],
    [48, 'sweetTaste', 'Sweet taste', 'relief', '--fruit'], [49, 'savouryTaste', 'Savoury taste', 'relief', '--protein'],
    [50, 'sleepOnset', 'Dozing off', 'relief', '--bored']
  ];
  const CHEMICALS = CHEMICAL_LIST.map(([id, key, word, kind, token]) => ({ id, key, word, kind, token }));
  const CHEM = Object.fromEntries(CHEMICALS.map(c => [c.key, c.id]));
  const CHEM_BY_ID = Object.fromEntries(CHEMICALS.map(c => [c.id, c]));
  const DRIVES = CHEMICALS.filter(c => c.kind === 'drive').map(c => c.key);

  // ---- Stimuli: things that happen to (or are done by) a creature. Stimulus genes decide which
  // chemicals each one releases, as in Creatures. word: "When it ..." ----
  const STIMULUS_LIST = [
    ['ate', 'eats'], ['drank', 'drinks'], ['patted', 'is tickled'], ['slapped', 'is slapped'], ['nuzzled', 'nuzzles another'],
    ['wasNuzzled', 'is nuzzled'], ['shoved', 'shoves another'], ['wasShoved', 'is shoved'], ['called', 'calls'],
    ['heardCall', 'hears a call'], ['grabbed', 'picks something up'], ['dropped', 'drops something'], ['bumped', 'bumps into something'],
    ['fell', 'lands hard'], ['woke', 'wakes up'], ['fellAsleep', 'falls asleep'], ['mated', 'mates'], ['played', 'plays'], ['pricked', 'is pricked by thorns']
  ];
  const STIMULI = STIMULUS_LIST.map(([key]) => key);
  const STIMULUS = Object.fromEntries(STIMULI.map((k, i) => [k, i]));
  const STIMULUS_WORDS = Object.fromEntries(STIMULUS_LIST);

  const N_DRIVE_CELLS = 18, N_LIMBIC = 8;

  // ---- Tastes: what the tongue reports about what goes in the mouth. food: the chemical in a food
  // that it reads; scale: how strongly; locus: the body reading emitter genes see; gut: marks the
  // four that sit in the gut until digested and count toward how full it is ----
  const TASTES = [
    { key: 'sweet',   word: 'Tastes sweet',   locus: 'tasteSweet',   food: 'gutSugar',   scale: 4, gut: true },
    { key: 'starch',  word: 'Tastes starchy', locus: 'tasteStarch',  food: 'gutStarch',  scale: 4, gut: true },
    { key: 'savoury', word: 'Tastes savoury', locus: 'tasteSavoury', food: 'gutProtein', scale: 4, gut: true },
    { key: 'fat',     word: 'Tastes fatty',   locus: 'tasteFat',     food: 'gutFat',     scale: 4, gut: true },
    { key: 'bitter',  word: 'Tastes bitter',  locus: 'tasteBitter',  food: 'toxin',      scale: 4 },
    { key: 'water',   word: 'Tastes water',   locus: 'tasteWater',   food: 'water',      scale: 6 }
  ];

  // ---- Body loci: what emitter genes can read (all 0..1). Codes 128+ read a chemical instead. ----
  const BODY_LOCI = [
    'none', 'always', 'bodyTemp', 'heatGain', 'heatLoss', 'darkness', 'exertion', 'awake', 'asleep',
    'resting', 'injury', 'health', 'impact', 'gentleTouch', 'touchingFriend', 'company', 'crowding',
    'novelty', 'falling', 'inWater', 'held', ...TASTES.map(t => t.locus), 'gutFullness', 'mated', 'pregnant', 'heardCall', 'growth', 'starving',
    ...Array.from({ length: N_LIMBIC }, (_, k) => `limbic${k}`)
  ];
  const LOCUS = Object.fromEntries(BODY_LOCI.map((k, i) => [k, i]));

  // ---- Receptor targets: what receptor genes can push on ----
  // Physiological targets are read by the body; need:k and limbic:k inject current into a neuron,
  // except limbic:0 and limbic:1, which are the brain's reward and punishment outcome.
  const PHYSIO_TARGETS = ['none', 'muscle', 'arousal', 'sleep', 'damage', 'healing', 'fertility', 'growth',
    'scentSex', 'scentAlarm', 'metabolism', 'thermogenesis', 'cooling'];
  const TARGETS = [...PHYSIO_TARGETS,
    ...Array.from({ length: N_DRIVE_CELLS }, (_, k) => `need:${k}`),
    ...Array.from({ length: N_LIMBIC }, (_, k) => `limbic:${k}`)];
  const TARGET = Object.fromEntries(TARGETS.map((k, i) => [k, i]));

  // ---- Brain regions, in genome order (genes address a region by its index here) ----
  // word: plain-language region name; cell: what one of its general-purpose cells is called.
  // The brain map: x runs from the world's left (0) to its right (1), y from the front (0) to the back
  // (1). Every region is a box on it, [x0, y0, x1, y1]; a cell's address is its spot inside its box, and
  // where it is drawn follows from the box. grid: [columns, rows] of the spots (per side for a two-sided
  // region), which also gives the region's usual cell count. The touch and movement cells have spots of
  // their own (see TOUCH and MOTORS below). sided: the box is the LEFT box and the right one is its
  // mirror image (x becomes 1 - x); a spot's left-right position is measured from the box's outer edge,
  // so a left cell and its twin on the right share one spot.
  const LOBES = [
    { key: 'sight',    word: 'Sight',        color: '#38bdf8', sensory: true, box: [0.10, 0.10, 0.47, 0.18], sided: true, grid: [8, 2] },
    { key: 'smell',    word: 'Smell',        color: '#f59e0b', sensory: true, box: [0.30, 0.02, 0.47, 0.08], sided: true, grid: [5, 2] },
    { key: 'hearing',  word: 'Hearing',      color: '#fb7185', sensory: true, box: [0.02, 0.20, 0.08, 0.28], sided: true, grid: [1, 2] },
    { key: 'touch',    word: 'Touch',        color: '#ec4899', sensory: true, box: [0.36, 0.79, 0.64, 0.85] },
    { key: 'taste',    word: 'Taste',        color: '#f97316', sensory: true, box: [0.14, 0.79, 0.30, 0.84], grid: [3, 2] },
    { key: 'near',     word: 'Up close',     color: '#fb923c', sensory: true, box: [0.70, 0.79, 0.86, 0.84], grid: [4, 2] },
    { key: 'needs',    word: 'Drives',       color: '#eab308', sensory: true, box: [0.33, 0.71, 0.67, 0.78], grid: [6, 3] },
    { key: 'feelings', word: 'Feelings',     color: '#10b981', box: [0.41, 0.63, 0.59, 0.68], grid: [4, 2] },
    { key: 'attention', word: 'Attention',   color: '#22d3ee', box: [0.16, 0.26, 0.47, 0.30], sided: true, grid: [8, 1] },
    { key: 'cortex',   word: 'Thinking',     color: '#818cf8', cell: 'Thinking cell', box: [0.08, 0.34, 0.45, 0.48], sided: true, grid: [5, 3] },
    { key: 'side',     word: 'Side lobes',   color: '#c084fc', cell: 'Side lobe cell', box: [0.03, 0.53, 0.20, 0.67], sided: true, grid: [2, 4] },
    { key: 'central',  word: 'Central lobe', color: '#a78bfa', cell: 'Central lobe cell', box: [0.39, 0.52, 0.61, 0.61], grid: [5, 4] },
    { key: 'motor',    word: 'Movement',     color: '#34d399', box: [0.06, 0.955, 0.94, 0.99] },
    { key: 'stem',     word: 'Brainstem',    color: '#2dd4bf', cell: 'Brainstem cell', box: [0.10, 0.885, 0.90, 0.925], grid: [9, 2] }
  ];
  const LOBE_ORDER = LOBES.map(l => l.key);
  const LOBE_INFO = Object.fromEntries(LOBES.map(l => [l.key, l]));
  const SENSORY_LOBES = LOBES.filter(l => l.sensory).map(l => l.key);

  // Muscles (Movement region). spot: where each one sits in its box (left to right, then its row).
  // Guidance genes find a muscle by its spot. side: the two walking muscles are a pair; the others
  // sit on the midline.
  const MOTORS = [
    { key: 'walkL', word: 'Walk left',  spot: [0.056, 0.5], side: 'L' },
    { key: 'walkR', word: 'Walk right', spot: [0.944, 0.5], side: 'R' },
    { key: 'jump',  word: 'Jump',       spot: [0.167, 0.5] },
    { key: 'eat',   word: 'Eat',        spot: [0.278, 0.5] },
    { key: 'grab',  word: 'Grab / drop', spot: [0.389, 0.5] },
    { key: 'rest',  word: 'Rest',       spot: [0.500, 0.5] },
    { key: 'call',  word: 'Call',       spot: [0.611, 0.5] },
    { key: 'run',   word: 'Run',        spot: [0.722, 0.5] },
    { key: 'drink', word: 'Drink',      spot: [0.833, 0.5] }
  ];

  // Touch cells: each has a spot of its own in the Touch box (and a side, where it has one). The mouth
  // cells sit at the front, next to the lips; the feet, falling and water cells at the back.
  const TOUCH = [
    { key: 'contactL', word: 'Touch on its left', spot: [0.05, 0.50], side: 'L' },
    { key: 'contactR', word: 'Touch on its right', spot: [0.95, 0.50], side: 'R' },
    { key: 'mouthL', word: 'Something at its mouth (left)', spot: [0.35, 0.10], side: 'L' },
    { key: 'mouthR', word: 'Something at its mouth (right)', spot: [0.65, 0.10], side: 'R' },
    { key: 'lips', word: 'Water at its lips', spot: [0.50, 0.30], side: null },
    { key: 'back', word: 'Touch on its back', spot: [0.50, 0.50], side: null },
    { key: 'feet', word: 'Ground under its feet', spot: [0.50, 0.90], side: null },
    { key: 'pain', word: 'Pain', spot: [0.35, 0.65], side: null },
    { key: 'gentle', word: 'Gentle touch', spot: [0.65, 0.65], side: null },
    { key: 'falling', word: 'Falling', spot: [0.25, 0.90], side: null },
    { key: 'inWater', word: 'In water', spot: [0.75, 0.90], side: null }
  ];

  // Drives region: one cell per drive chemical (cell k feels Evo.DRIVES[k], by the founder's receptor
  // genes), plus spare cells. What a drive makes the creature do is up to guidance genes aimed at single
  // cells.
  if (DRIVES.length > N_DRIVE_CELLS) throw new Error('more drive chemicals than Drives region cells');
  const driveCell = key => DRIVES.indexOf(key);

  // ---- Neurochemicals: the brain's modulatory channels, in channel order. Neurochemistry genes pick
  // one by index and set how far its learning signal spreads around the modulator cell's axon
  // terminals (see Brain.buildLearningFields). base: the spread when no gene sets it.
  const NEUROCHEMS = [
    { key: 'DA', word: 'Reward', base: 0.5 },   // Dopamine-like reward chemical
    { key: 'ST', word: 'Punishment', base: 0.5 }    // Punishment chemical
  ];

  const LIMITS = {
    MAX_POPULATION: 16,   // Performance ceiling; food and weather normally limit population first
    MAX_FOOD: 70,         // How much growing food the world holds at once
    SEED_BANK: 24,        // Proven breeders kept for wanderers and re-founding
    SYNAPSE_CAP: 3200,    // Most synapses one brain can hold
    INNATE_BUDGET: 2400,  // Synapses the genome grows before birth (the rest is room to learn)
    BACKGROUND_WIRING_EXTRA: 150 // The background wiring (weak links between neighbours) may go this far past the budget
  };

  Object.assign(Evo, {
    TICKS_PER_SECOND, DAY_TICKS, SEASON_DAYS, STAGES, STAGE,
    SCENTS, SCENT, VISION_FEATURES, hueFeatures, ITEM_TYPES, SEASONS,
    N_CHEM, CHEMICALS, CHEM, CHEM_BY_ID, DRIVES,
    STIMULI, STIMULUS, STIMULUS_WORDS, TASTES, BODY_LOCI, LOCUS, TARGETS, TARGET, N_DRIVE_CELLS, N_LIMBIC,
    LOBE_ORDER, LOBE_COUNT: LOBES.length, LOBE_INFO, SENSORY_LOBES, MOTORS, TOUCH, driveCell, NEUROCHEMS,
    LIMITS
  });
})(globalThis.Evo);
