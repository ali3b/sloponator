/**
 * JSON Schema from a zod schema (zod 4's own converter), with the `opt()` help as each property's description and
 * every `doc()` object as a named definition. zod puts every reused schema (and a root with an id) behind a `$ref`;
 * the anonymous ones and the root are inlined again here, so the document reads top-down and only documented
 * objects are definitions.
 */
import { z } from 'zod';

export type JsonSchema = Record<string, unknown>;

export interface JsonSchemaOptions {
  /** `draft-7` (editors, the declaration files; default) or `draft-2020-12` (MCP tool inputs). */
  target?: 'draft-7' | 'draft-2020-12';
  /** Documented objects as definitions (default) or inlined everywhere they appear. */
  reused?: 'ref' | 'inline';
  /** A `$id` for the document. */
  id?: string;
}

export function toJsonSchema(schema: z.ZodType, options: JsonSchemaOptions = {}): JsonSchema {
  const target = options.target ?? 'draft-7';
  const raw = z.toJSONSchema(schema, { target, unrepresentable: 'any', io: 'input', reused: 'ref' }) as JsonSchema;
  const defsKey = target === 'draft-7' ? 'definitions' : '$defs';
  const out = inlineAnonymous(raw, defsKey, options.reused === 'inline');
  return options.id ? { $id: options.id, ...out } : out;
}

/** Inline `__schemaN` definitions (and, with `all`, every definition) and the root `$ref`. */
function inlineAnonymous(doc: JsonSchema, defsKey: string, all: boolean): JsonSchema {
  const defs = (doc[defsKey] ?? {}) as Record<string, JsonSchema>;
  const prefix = `#/${defsKey}/`;
  const inlined = (name: string) => all || name.startsWith('__schema');
  const walk = (node: unknown, stack: string[]): unknown => {
    if (Array.isArray(node)) return node.map((n) => walk(n, stack));
    if (!node || typeof node !== 'object') return node;
    const o = node as JsonSchema;
    const ref = typeof o.$ref === 'string' && o.$ref.startsWith(prefix) ? o.$ref.slice(prefix.length) : undefined;
    if (ref !== undefined && inlined(ref) && defs[ref] && !stack.includes(ref)) {
      const { $ref: _r, ...rest } = o;
      const body = walk(defs[ref], [...stack, ref]) as JsonSchema;
      return { ...body, ...walk(rest, stack) as JsonSchema };
    }
    const out: JsonSchema = {};
    for (const [k, v] of Object.entries(o)) out[k] = k === defsKey ? v : walk(v, stack);
    return out;
  };
  const { [defsKey]: _d, $ref, ...rest } = doc;
  const rootName = typeof $ref === 'string' && $ref.startsWith(prefix) ? $ref.slice(prefix.length) : undefined;
  const root = rootName && defs[rootName] ? (walk(defs[rootName], [rootName]) as JsonSchema) : {};
  const kept: Record<string, JsonSchema> = {};
  for (const [name, def] of Object.entries(defs)) if (!inlined(name) && name !== rootName) kept[name] = walk(def, [name]) as JsonSchema;
  // A root definition referenced from inside itself (a recursive file) stays a definition too.
  if (rootName && JSON.stringify([root, kept]).includes(`"${prefix}${rootName}"`)) kept[rootName] = root;
  const head: JsonSchema = {};
  if (rest.$schema) head.$schema = rest.$schema;
  const { $schema: _s, ...others } = rest;
  return { ...head, ...(walk(others, []) as JsonSchema), ...root, ...(Object.keys(kept).length ? { [defsKey]: kept } : {}) };
}
