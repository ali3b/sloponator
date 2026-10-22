#!/usr/bin/env node
// Writes docs/api/declarations.md (the reference of every declaration file) and a JSON Schema per file under
// docs/api/, all from the zod schemas in packages/schema. Run with `npm run docs` (tsx loads the TypeScript).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DECLARATION_FILES, markdownReference, toJsonSchema } from '../packages/schema/src/index.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs', 'api');
fs.mkdirSync(outDir, { recursive: true });

const parts = [
  '# Declaration files',
  '',
  'Generated from `packages/schema` by `npm run docs`; do not edit by hand. Each file is validated with unknown keys',
  'rejected, and an error names the key, the nearest valid key and the section here that documents it.',
  '',
  ...DECLARATION_FILES.map((d) => `- [\`${d.file}\`](#${d.anchor}) — JSON Schema: [\`${d.schemaFile}\`](${d.schemaFile})`),
  '',
];
for (const d of DECLARATION_FILES) {
  parts.push(markdownReference(d.schema, { level: 1 }));
  const schema = toJsonSchema(d.schema, { id: `https://github.com/ali3b/sloponator/blob/master/docs/api/${d.schemaFile}` });
  fs.writeFileSync(path.join(outDir, d.schemaFile), `${JSON.stringify(schema, null, 2)}\n`);
}
fs.writeFileSync(path.join(outDir, 'declarations.md'), `${parts.join('\n').replace(/\n{3,}/g, '\n\n')}`);
console.log(`wrote docs/api/declarations.md and ${DECLARATION_FILES.length} JSON Schemas`);
