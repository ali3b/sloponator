/**
 * A markdown reference from a schema: a section per documented object (the file first, then every object it
 * reaches, each once), with a table of its keys: name, type, required, example, help.
 */
import { z } from 'zod';
import { branchesOf, defaultOf, docOf, isOptional, metaOf, shapeOf, typeText, unwrap, type DocMeta } from '../meta.js';

export interface DocSection {
  meta: DocMeta;
  schema: z.ZodType;
  /** The documented objects this one links to. */
  children: DocMeta[];
}

/** Every documented object reachable from a schema, depth-first in key order, each once. */
export function docSections(root: z.ZodType): DocSection[] {
  const out: DocSection[] = [];
  const seen = new Set<string>();
  const visit = (schema: z.ZodType) => {
    const d = docOf(schema);
    if (d) {
      if (seen.has(d.id)) return;
      seen.add(d.id);
      const section: DocSection = { meta: d, schema, children: [] };
      out.push(section);
      for (const sub of nested(schema)) {
        const cd = docOf(sub);
        if (cd && !section.children.some((c) => c.id === cd.id)) section.children.push(cd);
        visit(sub);
      }
      return;
    }
    for (const sub of nested(schema)) visit(sub);
  };
  visit(root);
  return out;
}

/** The schemas directly under one: object fields, union branches, array elements, record values. */
function nested(schema: z.ZodType): z.ZodType[] {
  const s = unwrap(schema);
  if (s instanceof z.ZodObject) return Object.values(s.shape as Record<string, z.ZodType>);
  if (s instanceof z.ZodUnion) return s.options as z.ZodType[];
  if (s instanceof z.ZodArray) return [s.element as z.ZodType];
  if (s instanceof z.ZodTuple) return s.def.items as z.ZodType[];
  if (s instanceof z.ZodRecord) return [s.valueType as z.ZodType];
  return [];
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const code = (v: unknown) => `\`${cell(typeof v === 'string' ? v : JSON.stringify(v))}\``;
const slug = (id: string) => id.toLowerCase();

/** Type text with documented objects linked to their sections. */
function linkedType(field: z.ZodType): string {
  const parts: string[] = [];
  for (const b of branchesOf(field)) {
    const s = unwrap(b);
    const d = docOf(s);
    if (d) parts.push(`[${d.title}](#${slug(d.id)})`);
    else if (s instanceof z.ZodArray) parts.push(`[${linkedType(s.element as z.ZodType)}, …]`);
    else parts.push(cell(typeText(b, 1)));
  }
  return [...new Set(parts)].join(' \\| ');
}

/** The key table of one object schema. */
export function markdownTable(schema: z.ZodType): string {
  const shape = shapeOf(schema);
  if (!shape) {
    const branches = branchesOf(schema).map((b) => linkedType(b));
    return `One of: ${branches.join(', ')}.\n`;
  }
  const lines = ['| Key | Type | Required | Example | What it is |', '|---|---|---|---|---|'];
  for (const [key, field] of Object.entries(shape)) {
    const meta = metaOf(field);
    const def = defaultOf(field);
    const required = isOptional(field) ? (def !== undefined ? `default ${code(def)}` : '') : 'yes';
    lines.push(`| \`${key}\` | ${linkedType(field)} | ${required} | ${meta?.example !== undefined ? code(meta.example) : ''} | ${cell(meta?.help ?? '')} |`);
  }
  return `${lines.join('\n')}\n`;
}

/** The whole reference of a schema: the root's section at `level`, then a section one level down per documented object it reaches. */
export function markdownReference(root: z.ZodType, options: { level?: number } = {}): string {
  const level = options.level ?? 1;
  const h = (n: number) => '#'.repeat(Math.min(6, level + n));
  const parts: string[] = [];
  docSections(root).forEach((section, i) => {
    parts.push(`<a id="${slug(section.meta.id)}"></a>\n${h(i === 0 ? 0 : 1)} ${section.meta.title}\n`);
    if (section.meta.summary) parts.push(`${section.meta.summary}\n`);
    parts.push(markdownTable(section.schema));
    const aliases = Object.entries(section.meta.aliases ?? {});
    if (aliases.length) parts.push(`Old spellings (an error names the key to use): ${aliases.map(([a, b]) => `\`${a}\` → \`${b}\``).join(', ')}.\n`);
    if (section.meta.ignored?.length) parts.push(`Not needed (an error says so): ${section.meta.ignored.map((k) => `\`${k}\``).join(', ')}.\n`);
  });
  return parts.join('\n');
}
