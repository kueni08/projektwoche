export function initialState() {
  return {
    title: "Projektwoche",
    projects: Array.from({ length: 9 }, (_, i) => ({
      id: String(i + 1),
      title: `Angebot ${i + 1}`,
      description: "Beschreibung folgt.",
      capacity: [12, 12],
    })),
    children: [],
    assignments: {},
    fixed: [],
    relations: [],
    wintermarktband: [],
    planStatus: "draft",
  };
}
export const WALD_PROJECT_ID = "7";
export const isWintermarktband = (state, id) => (state.wintermarktband || []).includes(id);
export function validatePlan(
  state,
  plan,
  { allowOutside = false, complete = false } = {},
) {
  const counts = state.projects.map(() => [0, 0]);
  const issues = [];
  for (const child of state.children) {
    const pair = plan[child.id] || [null, null];
    if (!Array.isArray(pair) || pair.length !== 2) {
      issues.push("Ungültige Zuteilung.");
      continue;
    }
    if (pair[0] && pair[0] === pair[1])
      issues.push(`${child.id}: zweimal derselbe Posten.`);
    pair.forEach((id, b) => {
      if (!id) {
        if (complete) issues.push(`${child.id}: Block ${b + 1} fehlt.`);
        return;
      }
      const i = state.projects.findIndex((p) => p.id === id);
      if (i < 0) {
        issues.push("Unbekannter Posten.");
        return;
      }
      counts[i][b]++;
      if (id === WALD_PROJECT_ID && isWintermarktband(state, child.id))
        issues.push(`${child.id}: Wintermarktband und Waldtage und Basteln überschneiden sich in Block ${b + 1}. Das Kind muss in eine andere Gruppe.`);
      if (!allowOutside && !child.choices.includes(id))
        issues.push(`${child.id}: Angebot nicht gewählt.`);
    });
  }
  state.projects.forEach((p, i) =>
    [0, 1].forEach((b) => {
      if (counts[i][b] > p.capacity[b])
        issues.push(`${p.title}: zu viele Kinder in Block ${b + 1}.`);
    }),
  );
  for (const rule of state.relations || []) {
    const a = plan[rule.a] || [null, null],
      b = plan[rule.b] || [null, null];
    for (let block = 0; block < 2; block++) {
      if (!a[block] || !b[block]) continue;
      if (rule.kind === "together" && a[block] !== b[block])
        issues.push(`${rule.a} und ${rule.b} müssen in Block ${block + 1} zusammen sein.`);
      if (rule.kind === "apart" && a[block] === b[block])
        issues.push(`${rule.a} und ${rule.b} dürfen in Block ${block + 1} nicht zusammen sein.`);
    }
  }
  return { issues, counts };
}
// Successive shortest augmenting paths, convex seat costs favour equal groups.
function match(state, children, projects, block, excluded, fixed, seed) {
  const n = children.length,
    source = 0,
    childStart = 1,
    projectStart = n + 1,
    sink = projectStart + projects.length,
    g = Array.from({ length: sink + 1 }, () => []),
    out = {};
  function edge(u, v, cap, cost) {
    const a = { to: v, rev: g[v].length, cap, cost },
      b = { to: u, rev: g[u].length, cap: 0, cost: -cost };
    g[u].push(a);
    g[v].push(b);
    return a;
  }
  const used = projects.map(() => 0);
  for (const c of children) {
    if (fixed[c.id]) {
      out[c.id] = fixed[c.id];
      const j = projects.findIndex((p) => p.id === fixed[c.id]);
      if (j >= 0) used[j]++;
    }
  }
  const links = [];
  children.forEach((c, i) => {
    if (out[c.id]) return;
    edge(source, childStart + i, 1, 0);
    c.choices.forEach((id) => {
      const j = projects.findIndex((p) => p.id === id);
      if (j < 0 || excluded[c.id] === id || isWintermarktband(state, c.id) && id === WALD_PROJECT_ID) return;
      const tie = ((i + 1) * 17 + (j + 1) * 31 + seed * (i + 7) * (j + 3)) % 19;
      links.push({
        id: c.id,
        project: id,
        e: edge(childStart + i, projectStart + j, 1, tie),
      });
    });
  });
  projects.forEach((p, j) => {
    for (let k = used[j]; k < p.capacity[block]; k++)
      edge(projectStart + j, sink, 1, k * 100);
  });
  for (;;) {
    const d = Array(g.length).fill(Infinity),
      prev = Array(g.length),
      queue = [source],
      inQ = Array(g.length).fill(false);
    d[source] = 0;
    inQ[source] = true;
    for (let q = 0; q < queue.length; q++) {
      const u = queue[q];
      inQ[u] = false;
      g[u].forEach((e, i) => {
        if (e.cap && d[e.to] > d[u] + e.cost) {
          d[e.to] = d[u] + e.cost;
          prev[e.to] = [u, i];
          if (!inQ[e.to]) {
            inQ[e.to] = true;
            queue.push(e.to);
          }
        }
      });
    }
    if (!prev[sink]) break;
    for (let v = sink; v !== source; ) {
      const [u, i] = prev[v],
        e = g[u][i];
      e.cap--;
      g[v][e.rev].cap++;
      v = u;
    }
  }
  for (const l of links) if (!l.e.cap) out[l.id] = l.project;
  return out;
}
function candidatePlan(state, fixed, seed) {
  const first = seed % 2,
    second = 1 - first;
  const a = match(
      state,
      state.children,
      state.projects,
      first,
      fixed[second],
      fixed[first],
      seed,
    ),
    b = match(
      state,
      state.children,
      state.projects,
      second,
      a,
      fixed[second],
      seed + 3,
    );
  const plan = {};
  for (const c of state.children)
    plan[c.id] =
      first === 0
        ? [a[c.id] || null, b[c.id] || null]
        : [b[c.id] || null, a[c.id] || null];
  return plan;
}

function planScore(state, plan) {
  const check = validatePlan(state, plan, { allowOutside: true });
  if (check.issues.length) return Infinity;
  const missing = Object.values(plan).flat().filter((x) => !x).length;
  return missing * 1e6 + check.counts.flat().reduce((sum, n) => sum + n * n, 0);
}

function constrainedUnits(state) {
  const parent = Object.fromEntries(state.children.map((c) => [c.id, c.id]));
  function root(id) {
    while (parent[id] !== id) id = parent[id] = parent[parent[id]];
    return id;
  }
  for (const rule of state.relations || [])
    if (rule.kind === "together") parent[root(rule.b)] = root(rule.a);
  const groups = new Map();
  for (const c of state.children) {
    const id = root(c.id);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(c);
  }
  const involved = new Set((state.relations || []).flatMap((r) => [root(r.a), root(r.b)]));
  const apart = new Map([...involved].map((id) => [id, new Set()]));
  for (const rule of state.relations || []) {
    if (rule.kind !== "apart") continue;
    const a = root(rule.a), b = root(rule.b);
    if (a === b) throw Error("Widerspruch: Diese Kinder sollen zugleich zusammen und getrennt sein.");
    apart.get(a).add(b);
    apart.get(b).add(a);
  }
  const units = [...involved].map((id) => {
    const members = groups.get(id);
    const locked = members.filter((c) => state.fixed.includes(c.id));
    const fixedPair = locked[0] ? state.assignments[locked[0].id] : null;
    if (locked.some((c) => JSON.stringify(state.assignments[c.id]) !== JSON.stringify(fixedPair)))
      throw Error("Fixierte Kinder können wegen einer Zusammen-Regel nicht gemeinsam eingeteilt werden.");
    const choices = members
      .filter((c) => !state.fixed.includes(c.id))
      .reduce((ids, c) => ids.filter((p) => c.choices.includes(p)), state.projects.map((p) => p.id));
    const candidates = [];
    for (const a of state.projects)
      for (const b of state.projects)
        if (a.id !== b.id && a.capacity[0] >= members.length && b.capacity[1] >= members.length &&
          (!members.some((c) => isWintermarktband(state, c.id)) || a.id !== WALD_PROJECT_ID && b.id !== WALD_PROJECT_ID) &&
          (fixedPair ? a.id === fixedPair[0] && b.id === fixedPair[1] : choices.includes(a.id) && choices.includes(b.id)) &&
          (!fixedPair || members.every((c) => state.fixed.includes(c.id) || c.choices.includes(a.id) && c.choices.includes(b.id))))
          candidates.push([a.id, b.id]);
    if (!candidates.length)
      throw Error(`${members.map((c) => c.id).join(" / ")}: keine zwei gemeinsamen verfügbaren Angebote. Wünsche, Plätze und Fixierungen prüfen.`);
    return { id, members, candidates };
  });
  units.sort((a, b) => a.candidates.length - b.candidates.length || b.members.length - a.members.length);
  return { units, apart };
}

function allocateConstrained(state, baseFixed) {
  const { units, apart } = constrainedUnits(state);
  const counts = state.projects.map(() => [0, 0]);
  const positions = new Map(), projectIndex = new Map(state.projects.map((p, i) => [p.id, i]));
  const relatedIds = new Set(units.flatMap((unit) => unit.members.map((c) => c.id)));
  for (const id of state.fixed) {
    if (relatedIds.has(id)) continue;
    for (let block = 0; block < 2; block++) {
      const project = baseFixed[block][id];
      if (projectIndex.has(project)) counts[projectIndex.get(project)][block]++;
    }
  }
  let best = null, bestScore = Infinity, leaves = 0, nodes = 0;
  function visit(index) {
    if (leaves >= 16 || nodes++ >= 50000) return;
    if (index === units.length) {
      leaves++;
      const fixed = [structuredClone(baseFixed[0]), structuredClone(baseFixed[1])];
      for (const unit of units) {
        const pair = positions.get(unit.id);
        for (const child of unit.members) {
          fixed[0][child.id] = pair[0];
          fixed[1][child.id] = pair[1];
        }
      }
      for (let seed = 1; seed <= 4; seed++) {
        const plan = candidatePlan(state, fixed, seed), score = planScore(state, plan);
        if (score < bestScore) { best = plan; bestScore = score; }
      }
      return;
    }
    const unit = units[index];
    const options = unit.candidates
      .filter(([a, b]) =>
        counts[projectIndex.get(a)][0] + unit.members.length <= state.projects[projectIndex.get(a)].capacity[0] &&
        counts[projectIndex.get(b)][1] + unit.members.length <= state.projects[projectIndex.get(b)].capacity[1] &&
        [...apart.get(unit.id)].every((other) => {
          const pair = positions.get(other);
          return !pair || pair[0] !== a && pair[1] !== b;
        }))
      .sort(([a1, b1], [a2, b2]) =>
        counts[projectIndex.get(a1)][0] + counts[projectIndex.get(b1)][1] -
        counts[projectIndex.get(a2)][0] - counts[projectIndex.get(b2)][1]);
    for (const pair of options) {
      positions.set(unit.id, pair);
      counts[projectIndex.get(pair[0])][0] += unit.members.length;
      counts[projectIndex.get(pair[1])][1] += unit.members.length;
      visit(index + 1);
      counts[projectIndex.get(pair[0])][0] -= unit.members.length;
      counts[projectIndex.get(pair[1])][1] -= unit.members.length;
      positions.delete(unit.id);
      if (leaves >= 16 || nodes >= 50000) break;
    }
  }
  visit(0);
  if (!best) throw Error("Die Zusammen- und Trennregeln lassen sich mit den aktuellen Wahlen, Plätzen oder Fixierungen nicht erfüllen.");
  return best;
}

export function allocate(state) {
  let best = null,
    bestScore = Infinity;
  const fixed = [{}, {}];
  for (const id of state.fixed) {
    const pair = state.assignments[id];
    if (pair)
      pair.forEach((p, b) => {
        if (p) fixed[b][id] = p;
      });
  }
  const fixedPlan = Object.fromEntries(
    state.fixed.map((id) => [id, state.assignments[id]]),
  );
  if (validatePlan(state, fixedPlan, { allowOutside: true }).issues.length)
    throw Error("Fixierte Zuteilungen prüfen.");
  if ((state.relations || []).length) best = allocateConstrained(state, fixed);
  else for (let seed = 1; seed <= 24; seed++) {
    const plan = candidatePlan(state, fixed, seed);
    const score = planScore(state, plan);
    if (score < bestScore) {
      best = plan;
      bestScore = score;
    }
  }
  return {
    plan: best,
    missing: Object.values(best)
      .flat()
      .filter((x) => !x).length,
  };
}
