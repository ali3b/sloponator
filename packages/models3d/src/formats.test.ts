/**
 * @slop/models3d writes what @slop/formats describes: the manifest type here (spec/manifest.ts ModelManifest, the
 * old generator's) and the formats' `ssgModel` schema (SsgModel) are the same shape, both ways at the type level,
 * and the fixtures' real manifests parse as ModelManifest values the exporter's helpers accept.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FORMATS, detectFormat, ssgModel, ssgModelsIndex, type SsgModel, type SsgModelsIndex } from '@slop/formats';
import { MODEL_LICENCE, boundsOf, colliderOf, isTrackSource, sourceLabel, type ModelManifest } from './index.js';
import type { ModelsIndex } from './index.js';

// Type-level: a ModelManifest is an SsgModel and the other way round (a field added on one side fails here).
const toFormats = (m: ModelManifest): SsgModel => m;
const fromFormats = (m: SsgModel): ModelManifest => m;
const indexToFormats = (i: ModelsIndex): SsgModelsIndex => i;
const indexFromFormats = (i: SsgModelsIndex): ModelsIndex => i;

const dir = fileURLToPath(new URL('../../formats/test/fixtures', import.meta.url));
const manifests = fs.readdirSync(dir).filter((f) => f.endsWith('.model.json')).sort();

describe('the .model.json format', () => {
  it('is listed as ssg-model (and models.json as ssg-models-index) and detected by file name', () => {
    expect(FORMATS.map((f) => f.id)).toEqual(expect.arrayContaining(['ssg-model', 'ssg-models-index']));
    expect(detectFormat('truck.model.json', {})?.id).toBe('ssg-model');
    expect(detectFormat('public/models/models.json', {})?.id).toBe('ssg-models-index');
    expect(typeof toFormats).toBe('function');
    expect([fromFormats, indexToFormats, indexFromFormats].every((f) => typeof f === 'function')).toBe(true);
  });

  it(`the games' real manifests (${manifests.length}) parse unchanged and read as ModelManifest values`, () => {
    expect(manifests.length).toBeGreaterThanOrEqual(10);
    const kinds = new Set<string>();
    for (const f of manifests) {
      const data = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'));
      const r = ssgModel.safeParse(data);
      expect(r.success, `${f}: ${r.error?.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`).toBe(true);
      // Strict: the parse keeps every key the file has.
      expect(r.data).toEqual(data);
      const m = fromFormats(r.data!);
      expect(m.licence).toBe(MODEL_LICENCE);
      expect(colliderOf(boundsOf(m.bounds.min, m.bounds.max)).box).toEqual(m.collider.box);
      kinds.add('kind' in m.source ? m.source.kind : 'asset');
      if (isTrackSource(m.source)) expect(m.trackpiece).toBeDefined();
      expect(sourceLabel(m.source)).not.toBe('?');
    }
    expect([...kinds].sort()).toEqual(['asset', 'composite', 'skydome', 'terrain', 'trackpiece']);
  });

  it('the index schema takes an index of those manifests and refuses an unknown key', () => {
    const data = JSON.parse(fs.readFileSync(`${dir}/${manifests[0]}`, 'utf8'));
    const index = { version: 1, models: { a: { id: '0123456789abcdef', rev: 'fedcba9876543210', asset: 'Pack/Name', glb: 'a.glb', manifest: 'a.model.json', data } } };
    expect(ssgModelsIndex.safeParse(index).success).toBe(true);
    expect(ssgModelsIndex.safeParse({ ...index, extra: 1 }).success).toBe(false);
    expect(ssgModel.safeParse({ ...data, extra: 1 }).success).toBe(false);
  });
});
