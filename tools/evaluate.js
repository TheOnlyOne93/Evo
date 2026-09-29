// Run several seeds in parallel and summarise how well the creatures live: meals, drinking, sleep,
// social contact, births and deaths. For comparing gene or physiology changes.
//   node tools/evaluate.js [days=2] [seeds=3] [firstSeed=1]
'use strict';
const { fork } = require('child_process');

if (process.argv[2] === '--child') {
  const Evo = require('../tests/load')();
  const [days, seed] = [Number(process.argv[3]), Number(process.argv[4])];
  Evo.seed(seed);
  const world = new Evo.World();
  const counts = {};
  for (const ev of ['eat', 'drink', 'nuzzle', 'shove', 'call', 'mate', 'egg', 'hatch', 'wanderer']) {
    world.events.on(ev, e => { counts[ev] = (counts[ev] || 0) + 1; if (ev === 'eat') counts[e.item.type] = (counts[e.item.type] || 0) + 1; });
  }
  const died = [];
  world.events.on('death', ({ creature: c, cause }) => died.push(`${cause}: ${Evo.STAGES[c.stage].key} ${c.name} gen ${c.generation} day ${world.clock.day} ` +
    `x ${Math.round(c.x)} water ${c.chem.get('water').toFixed(2)} thirst ${c.chem.get('thirst').toFixed(2)} glucose ${c.chem.get('glucose').toFixed(2)} temp ${c.bodyTemp.toFixed(2)}`));
  let creatureTicks = 0, asleep = 0, hunger = 0, thirst = 0, reward = 0, punish = 0;
  const zones = {};
  const zoneOf = c => {
    if (c.inWater) return 'water';
    for (const f of world.features) if (Math.abs(c.x - f.x) < (f.canopy || f.width / 2 || f.length / 2 || f.w || f.radius || 40) + 20) return f.kind + (f.species ? ':' + f.species : '');
    return 'open';
  };
  const t0 = Date.now();
  for (let t = 0; t < days * Evo.DAY_TICKS; t++) {
    world.step();
    if (t % 20) continue;
    for (const c of world.creatures) {
      creatureTicks++;
      if (c.asleep) asleep++;
      hunger += c.chem.get('hunger'); thirst += c.chem.get('thirst');
      reward += c.chem.get('reward'); punish += c.chem.get('punishment');
      const z = zoneOf(c); zones[z] = (zones[z] || 0) + 1;
    }
  }
  const n = Math.max(1, creatureTicks);
  process.send({
    seed, died, msPerTick: (Date.now() - t0) / (days * Evo.DAY_TICKS), pop: world.creatures.length, counts, deaths: world.stats.deaths,
    creatureDays: creatureTicks * 20 / Evo.DAY_TICKS, asleep: asleep / n, hunger: hunger / n, thirst: thirst / n, reward: reward / n, punish: punish / n,
    zones: Object.fromEntries(Object.entries(zones).map(([k, v]) => [k, v / n]))
  });
  process.exit(0);
}

const days = Number(process.argv[2] || 2), seeds = Number(process.argv[3] || 3), first = Number(process.argv[4] || 1);
const runs = Array.from({ length: seeds }, (_, i) => new Promise(resolve => {
  const child = fork(__filename, ['--child', days, first + i]);
  let got = false;
  child.on('message', r => { got = true; resolve(r); });
  child.on('exit', code => {
    if (got) return;
    console.error(`seed ${first + i} failed (child exited ${code} without a result)`);
    process.exitCode = 1;
    resolve(null);
  });
}));
Promise.all(runs).then(all => {
  const results = all.filter(Boolean);
  const f = v => v.toFixed(2);
  for (const r of results) {
    const perDay = k => ((r.counts[k] || 0) / r.creatureDays).toFixed(1);
    console.log(`seed ${r.seed}: pop ${r.pop}, ${f(r.msPerTick)} ms/tick | per creature-day: food ${perDay('eat')} (fruit ${perDay('fruit')} grain ${perDay('grain')} grub ${perDay('grub')} bug ${perDay('bug')} mimic ${perDay('mimic')}), ` +
      `drinks ${perDay('drink')}, nuzzles ${perDay('nuzzle')}, shoves ${perDay('shove')}, calls ${perDay('call')}`);
    console.log(`   asleep ${Math.round(r.asleep * 100)}%  hunger ${f(r.hunger)} thirst ${f(r.thirst)} reward ${f(r.reward)} punish ${f(r.punish)} | mates ${r.counts.mate || 0} eggs ${r.counts.egg || 0} hatched ${r.counts.hatch || 0} wanderers ${r.counts.wanderer || 0} | deaths ${JSON.stringify(r.deaths)}`);
    for (const d of r.died) console.log(`   died    ${d}`);
    console.log(`   where   ${Object.entries(r.zones).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(', ')}`);
  }
});
