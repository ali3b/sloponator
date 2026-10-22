/**
 * Commander-style CLI options from an object schema: one `{ flags, description, default, parse }` per key, the
 * flag spelled from the key (kebab-case) with a placeholder from the type, and a parser that turns the flag's text
 * into the value the schema expects (numbers, booleans, comma lists, JSON for objects). The values are then
 * validated by the schema itself (`parseCliValues`), so a wrong value gets the same teaching error as a file would.
 */
import { z } from 'zod';
import { validate, type ValidateResult } from '../errors.js';
import { branchesOf, defaultOf, metaOf, shapeOf, unwrap, valuesOf } from '../meta.js';

export interface CliOption {
  /** The schema key the option sets. */
  key: string;
  /** Commander flags: `--metres-per-tile <n>`. */
  flags: string;
  description: string;
  default?: unknown;
  /** The allowed values, for enum-like options. */
  choices?: string[];
  /** The flag's text → the value to validate (a parse error is left to the schema). */
  parse: (text: string, previous?: unknown) => unknown;
}

export const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).replace(/^\$/, '');

type Kind = 'boolean' | 'number' | 'integer' | 'string' | 'enum' | 'list' | 'json' | 'value';

/** The kind of input a schema takes on the command line. */
function kindOf(schema: z.ZodType): Kind {
  const kinds = new Set<Kind>();
  for (const b of branchesOf(schema)) {
    const s = unwrap(b);
    if (s instanceof z.ZodBoolean) kinds.add('boolean');
    else if (s instanceof z.ZodNumber) kinds.add(s.isInt ? 'integer' : 'number');
    else if (s instanceof z.ZodString) kinds.add('string');
    else if (s instanceof z.ZodEnum) kinds.add('enum');
    else if (s instanceof z.ZodLiteral) {
      const values = [...(s.values as Iterable<unknown>)];
      kinds.add(values.every((v) => typeof v === 'boolean') ? 'boolean' : values.every((v) => typeof v === 'number') ? 'number' : 'enum');
    }
    else if (s instanceof z.ZodArray || s instanceof z.ZodTuple) kinds.add(unwrap((s instanceof z.ZodArray ? s.element : (s.def.items as z.ZodType[])[0]) as z.ZodType) instanceof z.ZodObject ? 'json' : 'list');
    else if (s instanceof z.ZodObject || s instanceof z.ZodRecord) kinds.add('json');
    else if (s instanceof z.ZodNull) continue;
    else kinds.add('value');
  }
  if (kinds.size === 1) return [...kinds][0]!;
  if (kinds.has('json')) return 'json';
  if (kinds.has('list')) return 'list';
  return 'value';
}

function placeholder(schema: z.ZodType, kind: Kind): string {
  const values = valuesOf(schema);
  switch (kind) {
    case 'boolean':
      return '[true|false]';
    case 'number':
      return '<n>';
    case 'integer':
      return '<n>';
    case 'string':
      return '<text>';
    case 'enum':
      return values ? `<${values.map(String).join('|')}>` : '<value>';
    case 'list':
      return '<a,b,…>';
    case 'json':
      return '<json>';
    default:
      return '<value>';
  }
}

const jsonish = (t: string) => /^\s*[[{]/.test(t);
const tryJson = (t: string): unknown => {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
};
const scalar = (t: string): unknown => {
  const s = t.trim();
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null') return null;
  if (s !== '' && !Number.isNaN(Number(s)) && /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return Number(s);
  return t;
};

function parserFor(kind: Kind): CliOption['parse'] {
  switch (kind) {
    case 'boolean':
      return (t) => (t === undefined || t === '' || t === 'true' ? true : t === 'false' ? false : t);
    case 'number':
    case 'integer':
      return (t) => (t.trim() !== '' && !Number.isNaN(Number(t)) ? Number(t) : t);
    case 'string':
    case 'enum':
      return (t) => t;
    case 'list':
      return (t, prev) => {
        const items = jsonish(t) ? tryJson(t) : t.split(',').map((x) => x.trim()).filter(Boolean);
        return Array.isArray(prev) && Array.isArray(items) ? [...prev, ...items] : items;
      };
    case 'json':
      return (t) => (jsonish(t) ? tryJson(t) : scalar(t));
    default:
      return (t) => scalar(t);
  }
}

/** The CLI options of an object schema, in key order; keys marked `cli: false` are left out. */
export function cliOptions(schema: z.ZodType, options: { only?: string[]; except?: string[] } = {}): CliOption[] {
  const shape = shapeOf(schema);
  if (!shape) throw new Error('cliOptions needs an object schema');
  const out: CliOption[] = [];
  for (const [key, field] of Object.entries(shape)) {
    if (options.only && !options.only.includes(key)) continue;
    if (options.except?.includes(key)) continue;
    const meta = metaOf(field);
    if (meta?.cli === false) continue;
    const kind = kindOf(field);
    const flag = meta?.flag ?? `${kebab(key)} ${placeholder(field, kind)}`;
    const values = valuesOf(field);
    const def = defaultOf(field);
    out.push({
      key,
      flags: `--${flag}`,
      description: meta?.help ?? '',
      ...(def !== undefined ? { default: def } : {}),
      ...(kind === 'enum' && values ? { choices: values.map(String) } : {}),
      parse: parserFor(kind),
    });
  }
  return out;
}

/** Flag values (as commander collects them, keyed by the schema key) → the validated object. */
export function parseCliValues<T extends z.ZodType>(schema: T, values: Record<string, unknown>): ValidateResult<z.output<T>> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) if (v !== undefined) clean[k] = v;
  return validate(schema, clean);
}
