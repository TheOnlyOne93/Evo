// Run the world headless and print a report: population, what the creatures are doing, their
// drives and reserves, and how they die. Useful for tuning genes and checking the ecology.
//   node tools/simulate.js [days=2] [seed=1] [reportsPerDay=4]
'use strict';
const Evo = require('../tests/load')();

const days = Number(process.argv[2] || 2);
const seed = Number(process.argv[3] || 1);
const perDay = Number(process.argv[4] || 4);
Evo.seed(seed);

const world = new Evo.World();
const avg = (list, f) => (list.length ? list.reduce((a, x) => a + f(x), 0) / list.length : 0);
const f2 = v => v.toFixed(2);
const counts = {};
world.events.on('eat', e => { counts[e.item.type] = (counts[e.item.type] || 0) + 1; });
world.events.on('drink', () => { counts.drinks = (counts.drinks || 0) + 1; });
for (const ev of ['mate', 'egg', 'hatch', 'death', 'wanderer', 'call', 'sleep', 'grab', 'refound']) {
  world.events.on(ev, () => { counts[ev] = (counts[ev] || 0) + 1; });
}

const every = Math.floor(Evo.DAY_TICKS / perDay);
const total = days * Evo.DAY_TICKS;
let t0 = Date.now();
for (let t = 1; t <= total; t++) {
  world.step();
  if (t % every) continue;
  const cs = world.creatures;
  const ms = (Date.now() - t0) / every;
  t0 = Date.now();
  const actions = Evo.util.countBy(cs, c => c.action);
  console.log(`day ${world.clock.day} ${f2(world.clock.phase)} ${world.season.key.padEnd(6)} ` +
    `pop ${String(cs.length).padStart(2)} (mature ${cs.filter(c => c.isMature).length}, eggs ${world.items.filter(i => i.type === 'egg').length}) ` +
    `food ${world.foodCount}  ${ms.toFixed(2)} ms/tick`);
  console.log(`   doing   ${Object.entries(actions).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  const drive = k => f2(avg(cs, c => c.body.chem.get(k)));
  console.log(`   drives  hunger ${drive('hunger')} protein ${drive('proteinHunger')} thirst ${drive('thirst')} tired ${drive('tiredness')} ` +
    `sleepy ${drive('sleepiness')} cold ${drive('coldness')} hot ${drive('hotness')} lonely ${drive('loneliness')} bored ${drive('boredom')} fear ${drive('fear')} sex ${drive('sexDrive')}`);
  console.log(`   body    glucose ${drive('glucose')} glycogen ${drive('glycogen')} fat ${drive('fat')} protein ${drive('protein')} water ${drive('water')} ` +
    `temp ${f2(avg(cs, c => c.body.temperature))} health ${f2(avg(cs, c => c.body.health))} reward ${drive('reward')} punish ${drive('punishment')}`);
  console.log(`   events  ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`   deaths  ${JSON.stringify(world.stats.deaths)}`);
}
