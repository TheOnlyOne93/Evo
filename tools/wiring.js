// How a founder's brain is wired, for spotting mis-wiring: what each wiring gene grows on its own and
// where it lands, then each region's connections in, out and inside.
//   node tools/wiring.js [FEMALE|MALE]   (default FEMALE)
'use strict';
const Evo = require('../tests/load')();

const sex = (process.argv[2] || 'FEMALE').toUpperCase();
if (sex !== 'FEMALE' && sex !== 'MALE') { console.error('usage: node tools/wiring.js [FEMALE|MALE]'); process.exit(1); }

const traits = Evo.Genome.founder(sex).develop();
const brain = new Evo.Brain(traits);
const f = v => v.toFixed(2);
console.log(`${sex}: ${brain.N} cells, ${brain.S} connections\n`);

// The connections a brain has, as "source,target" pairs
const pairsOf = b => { const out = new Set(); for (let s = 0; s < b.S; s++) out.add(`${b.sSrc[s]},${b.sDst[s]}`); return out; };

// The brain with no wiring genes: the background wiring only. A gene's own
// connections are the ones that appear when that gene is added.
const base = pairsOf(new Evo.Brain({ ...traits, axonGuidance: [] }));

console.log('Each wiring gene on its own (source, target address, radius, weight; source cells; connections; where they land)');
traits.axonGuidance.forEach((rule, i) => {
  const src = rule.source;
  let from = Evo.LOBE_ORDER[src.lobe] + (src.relX ? ' relative x' : '') + (src.relY ? ' relative y' : '') + (src.mirrorX ? ' mirrored' : '');
  if (rule.srcWindow) from += ` window (${f(rule.srcWindow.x)}, ${f(rule.srcWindow.y)}, ${f(rule.srcWindow.r)})`;
  const alone = new Evo.Brain({ ...traits, axonGuidance: [rule] });
  const landed = {};
  let grown = 0;
  for (let s = 0; s < alone.S; s++) {
    if (base.has(`${alone.sSrc[s]},${alone.sDst[s]}`)) continue;
    grown++;
    const lobe = alone.neurons[alone.sDst[s]].lobe;
    landed[lobe] = (landed[lobe] || 0) + 1;
  }
  const where = Object.entries(landed).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ');
  console.log(`${String(i + 1).padStart(3)}  ${from} -> [${rule.target.map(f).join(', ')}] radius ${f(rule.affinityRadius)} weight ${f(rule.weightSign)} | ` +
    `${brain.tractSources(rule).length} source cells, ${grown} connections: ${where || 'none'}`);
});

console.log('\nEach region (cells, connections in from other regions, out to other regions, inside)');
const tally = {};
for (const k of Object.keys(brain.lobes)) tally[k] = { cells: brain.lobes[k].length, in: 0, out: 0, inside: 0 };
for (let s = 0; s < brain.S; s++) {
  const a = brain.neurons[brain.sSrc[s]].lobe, b = brain.neurons[brain.sDst[s]].lobe;
  if (a === b) tally[a].inside++;
  else { tally[a].out++; tally[b].in++; }
}
const width = Math.max(...Object.keys(tally).map(k => k.length));
for (const [k, t] of Object.entries(tally)) {
  const quiet = k !== 'motor' && t.out < t.in / 10;   // The muscles act on the body, so motor may send nothing on
  console.log(`${k.padEnd(width)}  cells ${String(t.cells).padStart(4)}  in ${String(t.in).padStart(5)}  out ${String(t.out).padStart(5)}  inside ${String(t.inside).padStart(5)}${quiet ? '  <- receives but sends little on' : ''}`);
}
