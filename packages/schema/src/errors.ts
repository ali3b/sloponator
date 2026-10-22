/**
 * Errors that teach. A zod issue becomes one line that says where (`sprites[2] (hero).fps`), what is wrong, what
 * was meant (the nearest valid key, the old spelling's new name, the allowed values), what the key is for, and
 * where it is documented (`docs/api/declarations.md#sprite`).
 */
import type { z } from 'zod';
import { branchesOf, docOf, metaOf, schemasAt, shapeOf, typeText, unwrap, valuesOf } from './meta.js';

export const DOCS_FILE = 'docs/api/declarations.md';

export interface TeachingError {
  /** Where in the file, e.g. `sprites[2] (hero).anim[0]`; empty at the top level. */
  where: string;
  /** The path as zod reports it. */
  path: (string | number)[];
  /** The one-line message (without the docs link). */
  message: string;
  /** The docs anchor of the nearest documented object, e.g. `docs/api/declarations.md#sprite`. */
  docs?: string;
}

export type ValidateResult<T> = { ok: true; value: T; errors: [] } | { ok: false; value?: undefined; errors: TeachingError[] };

/** Validate data against a schema: the value, or teaching errors (never a zod error). */
export function validate<T extends z.ZodType>(schema: T, data: unknown): ValidateResult<z.output<T>> {
  const r = schema.safeParse(data, { reportInput: true });
  if (r.success) return { ok: true, value: r.data, errors: [] };
  return { ok: false, errors: teachingErrors(schema, data, r.error.issues) };
}

export class DeclarationError extends Error {
  constructor(
    public readonly errors: TeachingError[],
    public readonly file?: string,
  ) {
    super(formatErrors(errors, file));
    this.name = 'DeclarationError';
  }
}

/** The value, or a DeclarationError whose message lists every teaching error. */
export function assertValid<T extends z.ZodType>(schema: T, data: unknown, file?: string): z.output<T> {
  const r = validate(schema, data);
  if (r.ok) return r.value;
  throw new DeclarationError(r.errors, file);
}

/** One line per error, the docs link at the end of each. */
export function formatErrors(errors: TeachingError[], file?: string): string {
  return errors.map((e) => `${file ? `${file}: ` : ''}${e.where ? `${e.where}: ` : ''}${e.message}${e.docs ? ` See ${e.docs}.` : ''}`).join('\n');
}

/** Zod issues → teaching errors, with unions resolved to the branch the data was closest to. */
export function teachingErrors(root: z.ZodType, data: unknown, issues: z.core.$ZodIssue[]): TeachingError[] {
  const out: TeachingError[] = [];
  const seen = new Set<string>();
  for (const issue of flatten(issues)) {
    const path = issue.path.map((p) => (typeof p === 'symbol' ? String(p) : p));
    const message = messageFor(root, issue, path, data);
    const key = `${path.join('.')}|${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // A missing key is reported on the object that lacks it.
    const missing = issue.code === 'invalid_type' && (issue as { input?: unknown }).input === undefined && typeof path[path.length - 1] === 'string';
    const wherePath = missing ? path.slice(0, -1) : path;
    out.push({ where: whereText(data, wherePath), path, message, docs: docsLink(root, wherePath, data) });
  }
  return out;
}

/** The value at a path in the data, or undefined. */
function valueAt(data: unknown, path: readonly (string | number)[]): unknown {
  let cur: unknown = data;
  for (const step of path) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[step];
  }
  return cur;
}

/**
 * The object schemas that can hold the value at a path (a union's branches apart), the best match first: for an
 * object value, the branch sharing the most keys with it.
 */
function objectCandidates(root: z.ZodType, path: readonly (string | number)[], data: unknown): z.ZodType[] {
  const value = valueAt(data, path);
  const keys = value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [];
  const all = schemasAt(root, path).flatMap((s) => branchesOf(s)).filter((b) => shapeOf(b));
  if (!keys.length || all.length < 2) return all;
  const score = (b: z.ZodType) => keys.filter((k) => k in (shapeOf(b) ?? {})).length;
  const scored = all.map((b) => [b, score(b)] as const).sort((a, b) => b[1] - a[1]);
  const best = scored[0]?.[1] ?? 0;
  return best > 0 ? scored.filter(([, s]) => s === best).map(([b]) => b) : all;
}

type Issue = z.core.$ZodIssue;

/** Unions: keep only the branch whose issues are the most specific (deepest, not a plain type mismatch at the union). */
function flatten(issues: Issue[]): Issue[] {
  return issues.flatMap((issue) => {
    if (issue.code !== 'invalid_union') return [issue];
    const u = issue as z.core.$ZodIssueInvalidUnion;
    const branches = u.errors.map((errs) => flatten(errs));
    const score = (errs: Issue[]) => Math.max(0, ...errs.map((e) => (e.path.length - u.path.length) * 10 + (e.code === 'invalid_type' && e.path.length === u.path.length ? 0 : 5)));
    let best: Issue[] | null = null;
    let bestScore = -1;
    for (const b of branches) {
      const s = score(b);
      if (s > bestScore || (s === bestScore && best && b.length < best.length)) {
        best = b;
        bestScore = s;
      }
    }
    // Every branch failed at the union itself: one message about the union's type, not one per branch.
    if (!best || bestScore === 0) return [{ ...u, code: 'invalid_type', expected: 'union', input: u.input } as unknown as Issue];
    return best;
  });
}

/** `sprites[2] (hero).anim[0]`: array indexes in brackets, a named object's name after its index. */
export function whereText(data: unknown, path: (string | number)[]): string {
  let text = '';
  let cur: unknown = data;
  for (const step of path) {
    if (typeof step === 'number') text += `[${step}]`;
    else text += text ? `.${step}` : step;
    cur = cur && typeof cur === 'object' ? (cur as Record<string | number, unknown>)[step] : undefined;
    if (typeof step === 'number' && cur && typeof cur === 'object' && typeof (cur as { name?: unknown }).name === 'string') text += ` (${(cur as { name: string }).name})`;
  }
  return text;
}

/** The docs link of the nearest documented object on the path (the object itself, else a parent). */
export function docsLink(root: z.ZodType, path: readonly (string | number)[], data?: unknown): string | undefined {
  for (let n = path.length; n >= 0; n--) {
    const sub = path.slice(0, n);
    for (const s of [...objectCandidates(root, sub, data), ...schemasAt(root, sub)]) {
      const d = docOf(s);
      if (d) return `${DOCS_FILE}#${d.id}`;
    }
  }
  return undefined;
}

const show = (v: unknown) => {
  const s = JSON.stringify(v);
  return s === undefined ? String(v) : s.length > 60 ? `${s.slice(0, 57)}…` : s;
};

const sentence = (s: string) => (/[.?!]$/.test(s) ? s : `${s}.`);

function messageFor(root: z.ZodType, issue: Issue, path: (string | number)[], data: unknown): string {
  const at = schemasAt(root, path);
  const keyName = typeof path[path.length - 1] === 'string' ? String(path[path.length - 1]) : undefined;
  // What the key is for, as a sentence of its own after the problem.
  const help = (() => {
    for (const s of at) {
      const m = metaOf(s);
      if (m) return ` ${keyName ? `${keyName}: ` : ''}${sentence(m.help)}`;
    }
    return '';
  })();
  const subject = keyName ?? 'it';
  const input = (issue as { input?: unknown }).input;
  switch (issue.code) {
    case 'unrecognized_keys': {
      const keys = (issue as z.core.$ZodIssueUnrecognizedKeys).keys;
      return keys.map((k) => unknownKeyText(k, objectCandidates(root, path, data))).join(' ');
    }
    case 'invalid_type': {
      const expected = at.length ? at.map((s) => typeText(s)).join(' | ') : (issue as z.core.$ZodIssueInvalidType).expected;
      if (input === undefined) return `${subject} is required (${expected}).${help}`;
      return `${subject} must be ${expected} (got ${show(input)}).${help}`;
    }
    case 'invalid_value': {
      const values = (issue as z.core.$ZodIssueInvalidValue).values;
      const near = typeof input === 'string' ? nearest(input, values.filter((v): v is string => typeof v === 'string')) : undefined;
      return `${subject} must be one of ${values.map((v) => JSON.stringify(v)).join(', ')} (got ${show(input)}).${near ? ` Did you mean ${JSON.stringify(near)}?` : ''}${help}`;
    }
    case 'too_small': {
      const i = issue as z.core.$ZodIssueTooSmall;
      if (i.origin === 'array') return `${subject} needs at least ${i.minimum} ${i.minimum === 1 ? 'entry' : 'entries'}.${help}`;
      if (i.origin === 'string') return `${subject} must not be empty.${help}`;
      return `${subject} must be ${i.inclusive ? 'at least' : 'more than'} ${i.minimum} (got ${show(input)}).${help}`;
    }
    case 'too_big': {
      const i = issue as z.core.$ZodIssueTooBig;
      if (i.origin === 'array') return `${subject} takes at most ${i.maximum} entries.${help}`;
      return `${subject} must be ${i.inclusive ? 'at most' : 'less than'} ${i.maximum} (got ${show(input)}).${help}`;
    }
    case 'invalid_format': {
      const i = issue as z.core.$ZodIssueInvalidStringFormat;
      return `${subject} ${i.message && !/^Invalid/.test(i.message) ? i.message : `is not a valid ${i.format}`} (got ${show(input)}).${help}`;
    }
    case 'not_multiple_of':
      return `${subject} must be a multiple of ${(issue as z.core.$ZodIssueNotMultipleOf).divisor}.${help}`;
    case 'invalid_key':
    case 'invalid_element':
      return `${subject}: ${sentence(issue.message)}${help}`;
    default:
      return sentence(issue.message);
  }
}

/** `unknown key "ppmm". Did you mean "ppm"? Keys: …` with the old spellings and ignored keys named. */
function unknownKeyText(key: string, parents: z.ZodType[]): string {
  const keys = new Set<string>();
  let aliases: Record<string, string> = {};
  let ignored: string[] = [];
  for (const p of parents) {
    for (const b of branchesOf(p)) {
      const shape = shapeOf(b);
      if (shape) Object.keys(shape).forEach((k) => keys.add(k));
      const d = docOf(b) ?? docOf(unwrap(b));
      if (d?.aliases) aliases = { ...aliases, ...d.aliases };
      if (d?.ignored) ignored = [...ignored, ...d.ignored];
    }
  }
  const list = [...keys];
  const alias = aliases[key];
  if (alias) return `unknown key "${key}": it is the old spelling of "${alias}", use "${alias}".`;
  if (ignored.includes(key)) return `unknown key "${key}": it is not needed here, remove it.`;
  const near = nearest(key, list);
  return `unknown key "${key}".${near ? ` Did you mean "${near}"?` : ''} Keys: ${list.join(', ')}.`;
}

/** The closest of `options` to `word` by edit distance (case-insensitive), within a third of the word's length. */
export function nearest(word: string, options: readonly string[]): string | undefined {
  const w = word.toLowerCase();
  let best: string | undefined;
  let bestD = Infinity;
  for (const o of options) {
    const d = levenshtein(w, o.toLowerCase());
    if (d < bestD) {
      best = o;
      bestD = d;
    }
  }
  const limit = Math.max(2, Math.floor(Math.max(w.length, best?.length ?? 0) / 3));
  return best !== undefined && bestD <= limit ? best : undefined;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = cur;
  }
  return prev[b.length] ?? 0;
}

/** The allowed values of an enum-like schema at a path (for CLI `choices` and the docs). */
export function valuesAt(root: z.ZodType, path: readonly (string | number)[]): unknown[] | undefined {
  const vals = schemasAt(root, path).flatMap((s) => valuesOf(s) ?? []);
  return vals.length ? vals : undefined;
}
