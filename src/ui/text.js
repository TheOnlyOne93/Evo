// Plain-language names for what's inside a creature (the code keeps its technical names).
(function (Evo) {
  'use strict';
  const { SENSE_CHANNELS, RAYS, NOSES, LOBE_INFO } = Evo;

  const RAY_WORDS = Object.fromEntries(RAYS.map(r => [r.key, r.word]));
  const NOSE_WORDS = Object.fromEntries(NOSES.map(n => [n.key, n.word]));
  const MUSCLE_WORDS = {
    m_thrust_l: 'Left turn muscle', m_thrust_r: 'Right turn muscle', m_hop_fwd: 'Forward muscle', m_reverse: 'Backing muscle',
    m_burst: 'Sprint muscle', m_bite_ingest: 'Jaws', m_groom_rest: 'Rest', m_caudal_whip: 'Tail flick'
  };
  const ACTION_WORDS = {
    'Drift': 'Drifting', 'Axial Forward': 'Moving forward', 'Steer Left': 'Turning left', 'Steer Right': 'Turning right',
    'Left-Arc Propulsion': 'Curving left', 'Right-Arc Propulsion': 'Curving right', 'Mandible Grasp': 'Biting',
    'Rest / Groom': 'Resting', 'Tail Whip': 'Tail flick', 'Recoil & Whip': 'Backing off', 'Retraction': 'Backing up',
    'Fast Pursuit': 'Sprinting'
  };
  // Why a creature can't breed (keys from BodySimulator.breedingBlocker)
  const BREEDING_WORDS = {
    immature: null, // Described with its growth instead
    cooldown: null, // Depends on whether it has bred before
    sick: 'Too sick to breed', crowded: 'Too crowded to breed', energy: 'Needs more energy to breed',
    protein: 'Needs more protein to breed', stamina: 'Too tired to breed', water: 'Too thirsty to breed',
    libido: 'Not in the mood yet', dead: 'Dead'
  };

  function lobeName(n) {
    const word = LOBE_INFO[n.parentLobe].word;
    return n.copyOf ? `${word} copy` : word;
  }

  function neuronName(n) {
    if (n.copyOf) return `Copy of ${neuronName(n.copyOf).toLowerCase()}`;
    const m = n.meta;
    if (m.kind === 'vision') return `Sees ${SENSE_CHANNELS[m.channel].word} (${RAY_WORDS[m.ray]})`;
    if (m.kind === 'smell') return `Smells ${SENSE_CHANNELS[m.channel].word} (${NOSE_WORDS[m.nose]})`;
    if (m.kind === 'cell') return `${LOBE_INFO[n.lobeId].cell} ${m.index + 1}`;
    return MUSCLE_WORDS[n.id] || n.label;
  }

  function breedingStatus(b) {
    const reason = b.breedingBlocker();
    if (reason === null) return 'Ready to breed';
    if (reason === 'immature') return `Growing, ${Math.round(b.growth * 100)}% of adult size`;
    if (reason === 'cooldown') return b.timesBred ? 'Resting after breeding' : 'Not in breeding season yet';
    return BREEDING_WORDS[reason];
  }

  const clock = ticks => {
    const s = Math.max(0, Math.floor(ticks / 60));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const pct = v => `${Math.round(Math.max(0, Math.min(100, v)))}`;
  const titleCase = s => s.charAt(0) + s.slice(1).toLowerCase();

  Evo.text = { lobeName, neuronName, breedingStatus, ACTION_WORDS, clock, pct, titleCase };
})(globalThis.Evo);
