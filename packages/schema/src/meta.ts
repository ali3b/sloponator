/**
 * The field-metadata convention: every option is a zod schema wrapped in `opt()`, which gives it the one-line help
 * every surface shows (JSON Schema `description`, CLI `--help`, the MCP tool input, the docs table) and, in a
 * registry of our own, what only some surfaces need (the CLI flag spelling, whether the CLI shows it at all).
 * Documented objects are wrapped in `doc()`, which names them (JSON Schema `$defs`, docs headings, the "see …"
 * part of an error) and lists the old spellings of their keys so an error can say which key was meant.
 */
import { z } from 'zod';

export interface OptMeta {
  /** One line: what the option means. Shown everywhere. */
  help: string;
  /** An example value (JSON Schema `examples`, the docs table). */
  example?: unknown;
  /** The CLI flag spelling without the dashes, e.g. `metres-per-tile <n>` (default: the key in kebab-case plus a placeholder from the type). */
  flag?: string;
  /** false: the CLI has no flag for it (a key that only makes sense in a file, such as `sprites`). */
  cli?: boolean;
}

export interface DocMeta {
  /** A short id for anchors and `$defs`: `sprite`, `anim`, `tileset`. Unique across every schema. */
  id: string;
  /** The heading in the docs. */
  title: string;
  /** A paragraph under the heading. */
  summary?: string;
  /** Other spellings of keys the old generator took (`model` → `asset`), so an unknown-key error says which key was meant. */
  aliases?: Record<string, string>;
  /** Keys the old generator ignored at this level (`orientation`): an error says they are not needed rather than guessing. */
  ignored?: string[];
}

export const optRegistry = z.registry<OptMeta>();
export const docRegistry = z.registry<DocMeta>();

/** An option: the schema with its help (and example) attached. Chain `.optional()` / `.default()` after it. */
export function opt<T extends z.ZodType>(schema: T, meta: OptMeta): T {
  const s = schema.meta({ description: meta.help, ...(meta.example !== undefined ? { examples: [meta.example] } : {}) }) as T;
  optRegistry.add(s, meta);
  return s;
}

/** A documented object: named for `$defs`, the docs and errors. Apply it last (after `.strict()`, refinements…). */
export function doc<T extends z.ZodType>(schema: T, meta: DocMeta): T {
  const s = schema.meta({ id: meta.id, title: meta.title, ...(meta.summary ? { description: meta.summary } : {}) }) as T;
  docRegistry.add(s, meta);
  return s;
}

const WRAPPERS = new Set(['optional', 'nullable', 'default', 'readonly', 'nonoptional', 'catch', 'prefault']);

/** The schema under optional / nullable / default / refinement wrappers. */
export function unwrap(schema: z.ZodType): z.ZodType {
  let s = schema;
  for (let i = 0; i < 16; i++) {
    const def = s._zod.def as { type: string; innerType?: z.ZodType; in?: z.ZodType };
    if (WRAPPERS.has(def.type) && def.innerType) s = def.innerType;
    else if (def.type === 'pipe' && def.in) s = def.in;
    else break;
  }
  return s;
}

/**
 * The chain from the schema down to the bare type (the schema itself first): through wrappers, and through the
 * clones `.meta()` / `.describe()` make (a clone remembers its parent, where `doc()` registered the object).
 */
function chain(schema: z.ZodType): z.ZodType[] {
  const out: z.ZodType[] = [];
  let s: z.ZodType | undefined = schema;
  for (let i = 0; i < 32 && s; i++) {
    out.push(s);
    const def = s._zod.def as { type: string; innerType?: z.ZodType; in?: z.ZodType };
    const parent: z.ZodType | undefined = (s._zod as { parent?: z.ZodType }).parent;
    if (WRAPPERS.has(def.type) && def.innerType) s = def.innerType;
    else if (def.type === 'pipe' && def.in) s = def.in;
    else s = parent;
  }
  return out;
}

/** The `opt()` metadata of a schema, looked for under its wrappers. */
export function metaOf(schema: z.ZodType): OptMeta | undefined {
  for (const s of chain(schema)) {
    const m = optRegistry.get(s);
    if (m) return m;
  }
  return undefined;
}

/** The `doc()` metadata of a schema, looked for under its wrappers. */
export function docOf(schema: z.ZodType): DocMeta | undefined {
  // A registry hands a clone (`.meta()`, `.optional()`…) its parent's entry without the id: only the real entry counts.
  for (const s of chain(schema)) {
    const m = docRegistry.get(s);
    if (m?.id) return m;
  }
  return undefined;
}

/** True when the field is optional (or has a default): its wrappers say so. */
export function isOptional(schema: z.ZodType): boolean {
  return chain(schema).some((s) => {
    const t = (s._zod.def as { type: string }).type;
    return t === 'optional' || t === 'default' || t === 'prefault';
  });
}

/** The default value a `.default()` wrapper gives, if any. */
export function defaultOf(schema: z.ZodType): unknown {
  for (const s of chain(schema)) {
    const def = s._zod.def as { type: string; defaultValue?: unknown };
    if (def.type === 'default') return typeof def.defaultValue === 'function' ? (def.defaultValue as () => unknown)() : def.defaultValue;
  }
  return undefined;
}

/** The fields of an object schema (through its wrappers), or undefined when it is not an object. */
export function shapeOf(schema: z.ZodType): Record<string, z.ZodType> | undefined {
  const s = unwrap(schema);
  return s instanceof z.ZodObject ? (s.shape as Record<string, z.ZodType>) : undefined;
}

/** The branches of a union (through its wrappers, nested unions flattened), else the schema itself. */
export function branchesOf(schema: z.ZodType): z.ZodType[] {
  const s = unwrap(schema);
  return s instanceof z.ZodUnion ? (s.options as z.ZodType[]).flatMap((o) => branchesOf(o)) : [s];
}

/** The values of an enum or literal (through its wrappers), or undefined. */
export function valuesOf(schema: z.ZodType): unknown[] | undefined {
  const s = unwrap(schema);
  if (s instanceof z.ZodEnum) return Object.values(s.enum as Record<string, unknown>);
  if (s instanceof z.ZodLiteral) return [...(s.values as Iterable<unknown>)];
  return undefined;
}

/** The nested schema a path step leads to: an object's key, an array's element, a tuple's item, a record's value. */
export function stepInto(schema: z.ZodType, step: string | number): z.ZodType[] {
  const out: z.ZodType[] = [];
  for (const b of branchesOf(schema)) {
    const s = unwrap(b);
    if (s instanceof z.ZodObject && typeof step === 'string') {
      const f = (s.shape as Record<string, z.ZodType>)[step];
      if (f) out.push(f);
    } else if (s instanceof z.ZodArray) out.push(s.element as z.ZodType);
    else if (s instanceof z.ZodTuple && typeof step === 'number') {
      const item = (s.def.items as z.ZodType[])[step];
      if (item) out.push(item);
    } else if (s instanceof z.ZodRecord) out.push(s.valueType as z.ZodType);
  }
  return out;
}

/** Every schema a path can lead to (unions give several). */
export function schemasAt(root: z.ZodType, path: readonly (string | number)[]): z.ZodType[] {
  let current: z.ZodType[] = [root];
  for (const step of path) {
    current = current.flatMap((s) => stepInto(s, step));
    if (!current.length) break;
  }
  return current;
}

/** The type of a schema in plain words, for errors, the docs and CLI placeholders. */
export function typeText(schema: z.ZodType, depth = 0): string {
  const s = unwrap(schema);
  const nullable = chain(schema).some((x) => (x._zod.def as { type: string }).type === 'nullable');
  const base = bareTypeText(s, depth);
  return nullable && !base.includes('null') ? `${base} | null` : base;
}

function bareTypeText(s: z.ZodType, depth: number): string {
  const d = docOf(s);
  if (d && depth > 0) return d.title;
  if (s instanceof z.ZodString) return 'text';
  if (s instanceof z.ZodNumber) return s.format === 'safeint' || s.isInt ? 'whole number' : 'number';
  if (s instanceof z.ZodBoolean) return 'true | false';
  if (s instanceof z.ZodNull) return 'null';
  if (s instanceof z.ZodLiteral) return [...(s.values as Iterable<unknown>)].map((v) => JSON.stringify(v)).join(' | ');
  if (s instanceof z.ZodEnum) return Object.values(s.enum as Record<string, unknown>).map((v) => JSON.stringify(v)).join(' | ');
  if (s instanceof z.ZodArray) return `[${typeText(s.element as z.ZodType, depth + 1)}, …]`;
  if (s instanceof z.ZodTuple) return `[${(s.def.items as z.ZodType[]).map((i) => typeText(i, depth + 1)).join(', ')}]`;
  if (s instanceof z.ZodRecord) return `{ <name>: ${typeText(s.valueType as z.ZodType, depth + 1)} }`;
  if (s instanceof z.ZodUnion) return (s.options as z.ZodType[]).map((o) => typeText(o, depth + 1)).join(' | ');
  if (s instanceof z.ZodObject) {
    if (d) return d.title;
    const keys = Object.keys(s.shape);
    return depth > 0 ? `{ ${keys.slice(0, 6).join(', ')}${keys.length > 6 ? ', …' : ''} }` : 'an object';
  }
  if (s instanceof z.ZodUnknown || s instanceof z.ZodAny) return 'anything';
  return (s._zod.def as { type: string }).type;
}
