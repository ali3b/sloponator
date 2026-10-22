/**
 * @slop/formats: what a game reads. The zod schemas, TypeScript types and JSON Schemas of every file the
 * Sloponator writes for a sprite: `ssg-meta/1` (gameplay metadata), `ssg-layers/1` (layered sheets), `ssg-split/1`
 * (waist split), `ssg-turret/1` (hull + turret), the generic sheet JSON, the Phaser 3 anims JSON, the object
 * data block (footprint, facings, states), and for 3D models the `.model.json` manifest and the `models.json` index, and for levels the `.map.json` map document. This is the contract between the pipeline and slopkit: the writers in
 * @slop/sprites return these types, and the games' real files validate against these schemas (test/fixtures).
 */
import type { z } from 'zod';
import { toJsonSchema, type JsonSchema } from '@slop/schema';
import { ssgMeta } from './meta.js';
import { ssgLayers } from './layers.js';
import { ssgSplit } from './split.js';
import { ssgTurret } from './turret.js';
import { ssgSheet } from './sheet.js';
import { phaserAnims } from './phaser.js';
import { objectInfo } from './object.js';
import { ssgModel, ssgModelsIndex } from './model.js';
import { ssgMap } from './map.js';

export * from './common.js';
export * from './view.js';
export * from './object.js';
export * from './meta.js';
export * from './sheet.js';
export * from './layers.js';
export * from './split.js';
export * from './turret.js';
export * from './phaser.js';
export * from './model.js';
export * from './map.js';

export interface FormatSpec {
  /** The schema id a file carries (`schema` field) or, for files without one, a name. */
  id: string;
  /** The file name pattern an export writes it under (`#key`: a block inside that file). */
  file: string;
  /** The JSON Schema file name under docs/api (and the `$id`). */
  schemaFile: string;
  schema: z.ZodType;
  /** True when the file itself names its schema (`schema: "ssg-…/1"`). */
  selfDescribing: boolean;
}

/** Every file format, in the order the docs list them. */
export const FORMATS: readonly FormatSpec[] = [
  { id: 'ssg-meta/1', file: '{base}.meta.json', schemaFile: 'ssg-meta.schema.json', schema: ssgMeta, selfDescribing: true },
  { id: 'ssg-layers/1', file: '{base}.layers.json', schemaFile: 'ssg-layers.schema.json', schema: ssgLayers, selfDescribing: true },
  { id: 'ssg-split/1', file: '{base}.meta.json#split', schemaFile: 'ssg-split.schema.json', schema: ssgSplit, selfDescribing: true },
  { id: 'ssg-turret/1', file: '{base}.meta.json#turret', schemaFile: 'ssg-turret.schema.json', schema: ssgTurret, selfDescribing: true },
  { id: 'ssg-sheet', file: '{base}.sheet.json', schemaFile: 'ssg-sheet.schema.json', schema: ssgSheet, selfDescribing: false },
  { id: 'phaser3-anims', file: '{base}_anims.json', schemaFile: 'phaser3-anims.schema.json', schema: phaserAnims, selfDescribing: false },
  { id: 'ssg-object', file: '{base}.meta.json#object', schemaFile: 'ssg-object.schema.json', schema: objectInfo, selfDescribing: false },
  { id: 'ssg-model', file: '{name}.model.json', schemaFile: 'ssg-model.schema.json', schema: ssgModel, selfDescribing: false },
  { id: 'ssg-map/1', file: '{name}.map.json', schemaFile: 'ssg-map.schema.json', schema: ssgMap, selfDescribing: true },
  { id: 'ssg-models-index', file: 'models.json', schemaFile: 'ssg-models-index.schema.json', schema: ssgModelsIndex, selfDescribing: false },
];

export const formatById = (id: string): FormatSpec | undefined => FORMATS.find((f) => f.id === id);

/** The JSON Schema (draft-7) of a format, with the schema file name as its `$id`. */
export function formatJsonSchema(f: FormatSpec): JsonSchema {
  return toJsonSchema(f.schema, { id: f.schemaFile });
}

/** Which format a file is, from its `schema` field when it has one, else from its name. */
export function detectFormat(file: string, data: unknown): FormatSpec | undefined {
  const schema = data && typeof data === 'object' ? (data as { schema?: unknown }).schema : undefined;
  if (typeof schema === 'string') return formatById(schema);
  if (/\.sheet\.json$/.test(file)) return formatById('ssg-sheet');
  if (/[_.]anims\.json$/.test(file)) return formatById('phaser3-anims');
  if (/\.model\.json$/.test(file)) return formatById('ssg-model');
  if (/(^|[\\/])models\.json$/.test(file)) return formatById('ssg-models-index');
  return undefined;
}

/** A readable list of what is wrong with a file against a format (empty when it validates). */
export function checkFormat(f: FormatSpec, data: unknown): string[] {
  const r = f.schema.safeParse(data);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
}
