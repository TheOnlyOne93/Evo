// Tables that several parts of the simulation (and the UI) share. Every channel, sense, item and
// brain region is defined once here; everything else derives from these tables.
(function (Evo) {
  'use strict';

  // ---- Scent: the odour channels diffusing through the world ----
  // `token` names the CSS colour used to draw the channel. Pheromones are built to linger and travel,
  // so they decay far more slowly; their trail forms barely spread and break down ~5x more slowly still.
  const SCENTS = [
    { key: 'carb',   token: '--fruit',  diffusion: 0.18, decay: 0.015 },
    { key: 'starch', token: '--grain',  diffusion: 0.16, decay: 0.012 },
    { key: 'water',  token: '--water',  diffusion: 0.20, decay: 0.018 },
    { key: 'toxic',  token: '--toxin',  diffusion: 0.15, decay: 0.010 },
    { key: 'pheroF', token: '--female', diffusion: 0.24, decay: 0.006 },  // Female pheromone (volatile)
    { key: 'pheroM', token: '--male',   diffusion: 0.22, decay: 0.007 },  // Male pheromone (volatile)
    { key: 'alarm',  token: '--alarm',  diffusion: 0.22, decay: 0.030 },  // Released by distressed organisms
    { key: 'trailF', token: '--female', diffusion: 0.06, decay: 0.0012 }, // Female pheromone (persistent trail)
    { key: 'trailM', token: '--male',   diffusion: 0.06, decay: 0.0012 }  // Male pheromone (persistent trail)
  ];
  const SCENT = Object.fromEntries(SCENTS.map((s, i) => [s.key, i])); // e.g. SCENT.carb === 0

  // ---- Senses: what the eyes and antennae report. `word` is the plain-language meaning. ----
  const SENSE_CHANNELS = {
    carb: { word: 'fruit' }, starch: { word: 'grain' }, water: { word: 'water' },
    toxic: { word: 'danger' }, pheromone: { word: 'a mate' }, alarm: { word: 'alarm' }
  };
  const VISION_CHANNELS = ['carb', 'starch', 'water', 'toxic', 'pheromone'];
  const SMELL_CHANNELS = ['carb', 'starch', 'water', 'toxic', 'pheromone', 'alarm'];
  // Seven rays fan across the front of the head (radians from the heading, negative = left)
  const RAYS = [
    { key: 'farL', angle: -0.78, word: 'far left' }, { key: 'midL', angle: -0.52, word: 'left' },
    { key: 'nearL', angle: -0.26, word: 'slightly left' }, { key: 'ctr', angle: 0.0, word: 'straight ahead' },
    { key: 'nearR', angle: 0.26, word: 'slightly right' }, { key: 'midR', angle: 0.52, word: 'right' },
    { key: 'farR', angle: 0.78, word: 'far right' }
  ];
  const NOSES = [
    { key: 'antL', word: 'left antenna' }, { key: 'antR', word: 'right antenna' },
    { key: 'snout', word: 'snout' }, { key: 'core', word: 'body' }
  ];

  // ---- Items: how each looks, smells, appears to the eye, and what it contains ----
  // Senses report raw physics; the world never knows what an organism wants.
  //   fruit: fast sugar      grain: slow energy (needs water to digest) plus some protein
  //   dew: water             bug: protein and fat that runs away
  //   grub: beetle larvae from the rotting log; protein like a bug, but they can't run away
  //   mimic: looks and mostly smells like fruit, but it's poisonous
  //   lure: female scent that attracts males; carrion: what a dead body still holds
  // growable: counts toward the ground's carrying capacity. ttl: ticks before it rots away.
  const ITEM_TYPES = {
    carb:      { radius: 8.5,  color: '--fruit',   sight: { carb: 1.0 }, scent: [[SCENT.carb, 0.14]], nutrients: { carbs: 30, water: 6, protein: 1, bulk: 22 }, growable: true },
    starch:    { radius: 9.0,  color: '--grain',   sight: { starch: 1.0 }, scent: [[SCENT.starch, 0.13]], nutrients: { starches: 34, protein: 8, bulk: 28 }, growable: true },
    water:     { radius: 10.0, color: '--water',   sight: { water: 1.0 }, scent: [[SCENT.water, 0.15]], nutrients: { water: 34, bulk: 12 }, growable: true },
    grub:      { radius: 7.0,  color: '--grub',    sight: { carb: 0.5, starch: 0.5 }, scent: [[SCENT.carb, 0.07], [SCENT.starch, 0.07]], nutrients: { protein: 14, fats: 5, water: 3, bulk: 16 }, growable: true },
    bug:       { radius: 7.5,  color: '--protein', sight: { carb: 0.5, starch: 0.5 }, scent: [[SCENT.carb, 0.07], [SCENT.starch, 0.07]], nutrients: { protein: 18, fats: 10, water: 4, bulk: 20 }, growable: true, mobile: true },
    deceptive: { radius: 9.0,  color: '--fruit',   sight: { carb: 0.95 }, scent: [[SCENT.carb, 0.12], [SCENT.toxic, 0.03]], nutrients: { carbs: 14, water: 4, toxin: 36, bulk: 18 }, growable: true, spot: '--mimic-spot' },
    pheromone: { radius: 9.0,  color: '--female',  sight: { pheromone: 1.0 }, scent: [[SCENT.pheroF, 0.35]], nutrients: null, ttl: 2400 },
    carrion:   { radius: 8.0,  color: '--carrion', sight: { carb: 0.3, starch: 0.3 }, scent: [[SCENT.carb, 0.05], [SCENT.starch, 0.05]], nutrients: null, ttl: 3600 }
  };

  // Seasons change what grows and how fast water evaporates
  const SEASONS = {
    TEMPERATE: { regenTicks: 220, waterLoss: 1.0, weights: { carb: 0.30, starch: 0.27, water: 0.20, grub: 0.09, bug: 0.08, deceptive: 0.06 } },
    BLOOM:     { regenTicks: 150, waterLoss: 0.8, weights: { carb: 0.34, starch: 0.27, water: 0.20, grub: 0.08, bug: 0.07, deceptive: 0.04 } },
    DROUGHT:   { regenTicks: 320, waterLoss: 1.6, weights: { carb: 0.31, starch: 0.35, water: 0.10, grub: 0.11, bug: 0.07, deceptive: 0.06 } }
  };
  const SEASON_LENGTH = 1800;       // Ticks per season

  // ---- Brain regions, in genome order (genes address a region by its index here) ----
  // word: plain-language region name; cell: what one of its general-purpose cells is called
  const LOBES = [
    { key: 'vision',      word: 'Sight',        color: '#38bdf8', sensory: true },
    { key: 'olfactory',   word: 'Smell',        color: '#f59e0b', sensory: true },
    { key: 'somato',      word: 'Touch',        color: '#ec4899', sensory: true },
    { key: 'metabolic',   word: 'Needs',        color: '#eab308', sensory: true },
    { key: 'affective',   word: 'Feelings',     color: '#10b981' },
    { key: 'associative', word: 'Thinking',     color: '#818cf8', cell: 'Thinking cell' },
    { key: 'memory',      word: 'Side lobes',   color: '#c084fc', cell: 'Side lobe cell' },
    { key: 'planning',    word: 'Central lobe', color: '#a78bfa', cell: 'Central lobe cell' },
    { key: 'motor',       word: 'Movement',     color: '#34d399' },
    { key: 'efference',   word: 'Brainstem',    color: '#2dd4bf', cell: 'Brainstem cell' }
  ];
  const LOBE_ORDER = LOBES.map(l => l.key);
  const LOBE_INFO = Object.fromEntries(LOBES.map(l => [l.key, l]));
  const SENSORY_LOBES = LOBES.filter(l => l.sensory).map(l => l.key);

  Object.assign(Evo, {
    SCENTS, SCENT, SENSE_CHANNELS, VISION_CHANNELS, SMELL_CHANNELS, RAYS, NOSES,
    ITEM_TYPES, SEASONS, SEASON_LENGTH,
    LOBES, LOBE_ORDER, LOBE_COUNT: LOBES.length, LOBE_INFO, SENSORY_LOBES,
    LIMITS: {
      MAX_ITEMS: 22,       // How much growable food the ground holds at once
      MAX_POPULATION: 24,  // Performance ceiling; food normally limits population first
      SEED_BANK: 24,       // Proven breeders kept for migrants and re-founding
      SYNAPSE_CAP: 2400,   // Most synapses one brain can hold
      INNATE_BUDGET: 1800  // Synapses the genome may grow before birth (the rest is room to learn)
    }
  });
})(globalThis.Evo);
