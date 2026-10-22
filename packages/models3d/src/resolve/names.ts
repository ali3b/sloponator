// Moved from synty-sprite-generator apps/server/src/opSprites.ts closeNames (P3, ali3b/sloponator#14): the
// "did you mean" list an error carries when an asset or clip name resolves to nothing.

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Levenshtein distance. */
function distance(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = t;
    }
  }
  return prev[b.length];
}

/** Up to `n` names close to `query`: same start, containing it (or it them), shared words, or a few letters apart. */
export function closeNames(names: string[], query: string, n = 6): string[] {
  const q = norm(query);
  const qWords = new Set(query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1));
  const scored = [...new Set(names)].map((name) => {
    const k = norm(name);
    const words = name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
    const shared = words.filter((w) => qWords.has(w)).length;
    const d = distance(q, k);
    // Lower is closer: a typo or two first, then same start, containing, then shared words.
    const score = Math.min(
      d <= Math.max(2, Math.floor(q.length / 3)) ? d * 0.3 : Infinity,
      q && (k.startsWith(q) || q.startsWith(k)) ? 0.7 : Infinity,
      q && (k.includes(q) || (k.length > 2 && q.includes(k))) ? 1 : Infinity,
      shared ? 4 - shared / 10 : Infinity,
    );
    return { name, score, d };
  });
  return scored.filter((x) => x.score < Infinity).sort((a, b) => a.score - b.score || a.d - b.d || a.name.localeCompare(b.name)).slice(0, n).map((x) => x.name);
}
