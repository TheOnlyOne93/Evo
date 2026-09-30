// Who is related to whom, read from world.history (everyone who has lived here, each with its
// motherId and fatherId; both null for a founder or a wanderer). The Family deck's lists and its
// chart both take a creature's family from here. Pure functions, no page access: tests load this
// file in Node.
(function (Evo) {
  'use strict';

  // A history indexed once: its records by id, and each parent's children in the order they hatched
  function kinIndex(history) {
    const byId = new Map(history.map(h => [h.id, h]));
    const kids = new Map();
    for (const h of history) for (const p of [h.motherId, h.fatherId]) if (p !== null) (kids.get(p) || kids.set(p, []).get(p)).push(h);
    return { byId, childrenOf: id => kids.get(id) || [] };
  }

  // The family of the creature with this id, as history records, or null if it never lived here:
  //   self, outsider (it has no parents here), mother, father,
  //   grandparents: [{ rec, of: 'mother' | 'father', role: 'mother' | 'father' }] (only a parent hatched here has any),
  //   siblings: [{ rec, half }] (full ones first), mates (the other parent of each of its children),
  //   children, grandchildren, descendants (everyone below it, however far down, each once)
  function kinOf(index, id) {
    const { byId, childrenOf } = index;
    const self = byId.get(id);
    if (!self) return null;
    const outsider = self.motherId === null;
    const mother = byId.get(self.motherId), father = byId.get(self.fatherId);
    const grandparents = [[mother, 'mother'], [father, 'father']].filter(([p]) => p && p.motherId !== null)
      .flatMap(([p, of]) => [{ rec: byId.get(p.motherId), of, role: 'mother' }, { rec: byId.get(p.fatherId), of, role: 'father' }]);
    const half = h => h.motherId !== self.motherId || h.fatherId !== self.fatherId;
    const siblings = outsider ? [] : [...new Set([...childrenOf(self.motherId), ...childrenOf(self.fatherId)])]
      .filter(h => h.id !== id).map(h => ({ rec: h, half: half(h) })).sort((a, z) => a.half - z.half);
    const children = childrenOf(id);
    const mates = [...new Set(children.map(ch => byId.get(ch.motherId === id ? ch.fatherId : ch.motherId)))].filter(Boolean);
    const grandchildren = [...new Set(children.flatMap(ch => childrenOf(ch.id)))];
    const descendants = new Set(), queue = [id];
    while (queue.length) for (const h of childrenOf(queue.pop())) if (!descendants.has(h)) { descendants.add(h); queue.push(h.id); }
    return { self, outsider, mother, father, grandparents, siblings, mates, children, grandchildren, descendants: [...descendants] };
  }

  Object.assign(Evo, { kinIndex, kinOf });
})(globalThis.Evo);
