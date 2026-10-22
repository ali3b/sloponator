/**
 * Real export files of the games (Solitary Strike, Sidefighter, Monty, Off Road, 4D Stunts; copied read-only into fixtures, the big
 * character files cut to their first animations) validate unchanged, and the schemas refuse what they should.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FORMATS, checkFormat, detectFormat, formatById, objectInfo, ssgMeta, ssgSplit } from '../src/index.js';

const dir = fileURLToPath(new URL('fixtures', import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
const load = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, unknown>;

describe('the games\' real files validate', () => {
  it('has fixtures of every kind the games write', () => {
    const kinds = new Set(files.map((f) => detectFormat(f, load(f))?.id));
    expect([...kinds].sort()).toEqual(['phaser3-anims', 'ssg-meta/1', 'ssg-model', 'ssg-sheet']);
  });
  for (const f of files) {
    it(f, () => {
      const data = load(f);
      const format = detectFormat(f, data);
      expect(format).toBeDefined();
      expect(checkFormat(format!, data)).toEqual([]);
    });
  }
  it('the blocks inside the files validate on their own: object, split', () => {
    const metas = files.filter((f) => f.endsWith('.meta.json')).map(load);
    const objects = metas.map((m) => m.object).filter(Boolean);
    expect(objects.length).toBeGreaterThanOrEqual(2);
    for (const o of objects) expect(checkFormat(formatById('ssg-object')!, o)).toEqual([]);
    const splits = metas.map((m) => m.split).filter(Boolean);
    expect(splits).toHaveLength(1);
    expect(checkFormat(formatById('ssg-split/1')!, splits[0]!)).toEqual([]);
    // An object with states and a tree with a canopy are among them.
    expect(objects.some((o) => objectInfo.parse(o).states?.length)).toBe(true);
    expect(objects.some((o) => objectInfo.parse(o).canopy)).toBe(true);
  });
});

describe('the schemas refuse', () => {
  const meta = () => load('monty.flame.meta.json');
  it('an unknown top-level key', () => {
    expect(checkFormat(formatById('ssg-meta/1')!, { ...meta(), extra: 1 })).toEqual([expect.stringMatching(/extra/)]);
  });
  it('another schema id', () => {
    expect(checkFormat(formatById('ssg-meta/1')!, { ...meta(), schema: 'ssg-meta/2' })).toEqual([expect.stringMatching(/^schema: /)]);
  });
  it('a wrong value deep inside', () => {
    const m = meta();
    (m.clips as { events: unknown[] }[])[0]!.events = [{ frame: 1, name: 'hit', limb: 'tail' }];
    expect(checkFormat(formatById('ssg-meta/1')!, m)).toEqual([expect.stringMatching(/^clips\.0\.events\.0\.limb: /)]);
  });
  it('a split block that names a third sheet', () => {
    const split = load('airborne-ranger.ranger_legs.trimmed.meta.json').split as Record<string, unknown>;
    expect(ssgSplit.safeParse({ ...split, sheet: 'arms' }).success).toBe(false);
    expect(ssgSplit.safeParse(split).success).toBe(true);
  });
  it('a file of one kind against another', () => {
    expect(ssgMeta.safeParse(load('sidefighter.quake.sheet.json')).success).toBe(false);
    expect(detectFormat('x.sheet.json', {})?.id).toBe('ssg-sheet');
    expect(detectFormat('x_anims.json', {})?.id).toBe('phaser3-anims');
    expect(detectFormat('x.json', {})).toBeUndefined();
  });
});

describe('every format', () => {
  it('has a distinct id and schema file', () => {
    expect(new Set(FORMATS.map((f) => f.id)).size).toBe(FORMATS.length);
    expect(new Set(FORMATS.map((f) => f.schemaFile)).size).toBe(FORMATS.length);
  });
});
