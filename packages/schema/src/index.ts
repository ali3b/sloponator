/**
 * @slop/schema: zod is the one source of truth for every option. Each option carries its help (`opt()`), each
 * documented object its name and old spellings (`doc()`), and from that one definition come the JSON Schema, the
 * CLI flags, the MCP tool input, the markdown reference and the teaching errors.
 */
export { z } from 'zod';
export * from './meta.js';
export * from './errors.js';
export * from './generators/json-schema.js';
export * from './generators/cli.js';
export * from './generators/mcp.js';
export * from './generators/markdown.js';
export * from './declarations/common.js';
export * from './declarations/assets.js';
export * from './declarations/models.js';
export * from './declarations/textures.js';

import type { z } from 'zod';
import { assetsFile } from './declarations/assets.js';
import { modelsFile } from './declarations/models.js';
import { texturesFile } from './declarations/textures.js';

export interface DeclarationFile {
  /** The file name a game uses. */
  file: string;
  /** The JSON Schema file name under docs/api (and the `$id`). */
  schemaFile: string;
  /** The section anchor in docs/api/declarations.md (the root `doc()` id). */
  anchor: string;
  schema: z.ZodType;
}

/** The declaration files a game may have, in the order the docs list them. */
export const DECLARATION_FILES: readonly DeclarationFile[] = [
  { file: 'ssg.assets.json', schemaFile: 'ssg.assets.schema.json', anchor: 'assets-file', schema: assetsFile },
  { file: 'ssg.models.json', schemaFile: 'ssg.models.schema.json', anchor: 'models-file', schema: modelsFile },
  { file: 'ssg.textures.json', schemaFile: 'ssg.textures.schema.json', anchor: 'textures-file', schema: texturesFile },
];
