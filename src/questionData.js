import QUESTIONS from "./data/questions.json";

export { BANK_SUBJECT } from "./bankMeta.js";

/* subject -> module -> inquiry question -> topic
   (the sorter's original TAX object, built once instead of on every render) */
function buildTax(data) {
  const tax = {};
  for (const r of data) {
    for (const t of r.tags) {
      tax[r.subject] = tax[r.subject] || {};
      tax[r.subject][t.module] = tax[r.subject][t.module] || {};
      tax[r.subject][t.module][t.iq] = t.topic;
    }
  }
  return tax;
}

/* precomputed lowercase search text, exactly as the original did */
const withHaystack = QUESTIONS.map((r) => ({
  ...r,
  questionImages: r.questionImages || [],
  mgImages: r.mgImages || [],
  parts: r.parts || [],
  _hay: (
    r.questionText +
    " " +
    r.tags.map((t) => `${t.module} ${t.topic} ${t.iq}`).join(" ")
  ).toLowerCase(),
}));

export const DATA = withHaystack;
export const TAX = buildTax(withHaystack);

export const modOrder = (m) => {
  const hit = m.match(/Module (\d)/);
  return hit ? parseInt(hit[1], 10) : 99;
};

export const modulesFor = (subject) =>
  Object.keys(TAX[subject] || {}).sort((a, b) => modOrder(a) - modOrder(b));

export const yearsFor = (subject) =>
  [...new Set(DATA.filter((r) => r.subject === subject).map((r) => r.year))].sort(
    (a, b) => b - a
  );

export const countFor = (subject) =>
  DATA.filter((r) => r.subject === subject).length;

/* The sorter's baseFilter. `ignoreTree` skips the module/inquiry-question
   narrowing so the tree can show counts for branches you haven't picked yet. */
export function baseFilter(r, f, ignoreTree) {
  if (r.subject !== f.subject) return false;
  if (f.years.size && !f.years.has(r.year)) return false;
  if (f.section && r.section !== f.section) return false;
  if (f.marks) {
    if (f.marks === "8+") {
      if (r.marks < 8) return false;
    } else if (r.marks !== +f.marks) return false;
  }
  if (f.q && !f.q.toLowerCase().split(/\s+/).every((w) => r._hay.includes(w)))
    return false;
  if (!ignoreTree) {
    if (f.iq && !r.tags.some((t) => t.iq === f.iq)) return false;
    if (!f.iq && f.module && !r.tags.some((t) => t.module === f.module))
      return false;
  }
  return true;
}

/* recommended working time, ~1.8 min per mark rounded to 5 */
export function ptTime(marks) {
  const m = Math.max(5, Math.round((marks * 1.8) / 5) * 5);
  return m >= 60
    ? `${Math.floor(m / 60)} hr ${m % 60 ? `${m % 60} min` : ""}`.trim()
    : `${m} min`;
}

const rint = (n) => Math.floor(Math.random() * n);

export function shuffle(a) {
  const out = a.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rint(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* Greedy marks-budget fill, retried up to 120 times keeping the best total.
   Ported unchanged from the original sorter. */
export function allocate(cands, target) {
  let best = [];
  let bestSum = 0;
  for (let t = 0; t < 120 && bestSum < target; t++) {
    let rem = target;
    const out = [];
    for (const r of shuffle(cands)) {
      if (r.marks <= rem) {
        out.push(r);
        rem -= r.marks;
      }
      if (!rem) break;
    }
    const sum = target - rem;
    if (sum > bestSum) {
      best = out;
      bestSum = sum;
    }
  }
  return best;
}
