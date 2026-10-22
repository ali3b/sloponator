/**
 * Against the old generator's library (skipped with a message without its data dir): the clip resolution the build
 * bakes for is the one the render page plays (clips.ts vs packages/render/web/export/setPlan.ts over every built-in
 * set on a spread of characters), and neededClips collects a sprite's clips, its siblings', the Masculine/Feminine
 * copy, and nothing for a prop.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { animationDto, assetDto, openLibrary, type AnimationDto } from '@slop/library';
import { BUILTIN_SETS, type BatchSpec, type SetItem } from '@slop/sprites';
import { neededClips, resolveSetItem, type CharacterRecord } from '../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.SLOP_OLD_DATA_DIR ?? '/home/andrew/projects/synty-sprite-generator/data';
const haveData = fs.existsSync(path.join(DATA_DIR, 'library.db'));
if (!haveData) console.warn(`library.test.ts: skipped, no old generator data dir at ${DATA_DIR} (set SLOP_OLD_DATA_DIR)`);

type Resolver = (...a: unknown[]) => AnimationDto | null;

const spec = (items: SetItem[], extra: Partial<BatchSpec> = {}) => ({ set: { id: 't', name: 't', items }, gender: 'auto', ...extra }) as unknown as BatchSpec;
const anim = (name: string, pack = 'ANIMATION_Base_Locomotion'): SetItem => ({ type: 'anim', pack, name, category: 'Locomotion/Walk', rootMotion: false, gender: null, label: name }) as unknown as SetItem;

describe.skipIf(!haveData)('clips the build bakes', () => {
  const lib = haveData ? openLibrary({ dataDir: DATA_DIR }) : null!;
  const urls = { glb: () => null, thumb: () => null };

  it('are the clips the render page resolves (every built-in set item, a spread of characters, each gender choice)', async () => {
    // The page's own resolver, loaded from the render bundle's sources (not part of this package's build).
    const web = (await import(path.resolve(here, '../../render/web/export/setPlan.ts'))) as { resolveAnim: Resolver; resolveMatch: Resolver };
    const pageResolve = (item: SetItem, list: AnimationDto[], asset: CharacterRecord, gender: BatchSpec['gender']): AnimationDto | null => {
      if (item.type === 'template') return null;
      const hit = item.type === 'anim' ? web.resolveAnim(item, list, asset, gender) : web.resolveMatch(item.pattern, list, asset, gender, item.prefer);
      return hit ?? (item.type === 'match' && item.orElse ? pageResolve(item.orElse, list, asset, gender) : null);
    };
    const list = lib.animations({ limit: 20000 }).map(animationDto);
    const chars = lib.assets({ kind: 'character', limit: 5000 }).filter((a) => a.rig());
    const sample = chars.filter((_, i) => i % Math.max(1, Math.floor(chars.length / 12)) === 0).map((a) => assetDto(a, urls));
    expect(new Set(sample.map((a) => a.rig?.profile)).size).toBeGreaterThan(1);
    const items = BUILTIN_SETS.flatMap((s) => s.items);
    let compared = 0, resolved = 0;
    for (const a of sample) {
      for (const gender of ['auto', 'Feminine', 'Masculine'] as const) {
        for (const item of items) {
          const ours = resolveSetItem(item, list, a, gender);
          expect(ours?.id ?? null, `${a.name} ${gender} ${JSON.stringify(item).slice(0, 80)}`).toBe(pageResolve(item, list, a, gender)?.id ?? null);
          compared++;
          if (ours) resolved++;
        }
      }
    }
    expect(compared).toBeGreaterThan(200);
    expect(resolved).toBeGreaterThan(compared / 4);
  });

  it('neededClips: the Masculine/Feminine copy, siblings\' clips (uniformWith) once each, nothing for a prop', () => {
    const girl = lib.asset('POLYGON_War/Character_FactoryGirl_01')!;
    const man = lib.asset('POLYGON_War/Character_GentleMan_01')!;
    const skull = lib.asset('POLYGON_Dark_Fantasy/SM_Prop_Skull_01')!;
    const walk = anim('Walk_F');
    const idle = { ...anim('Idle_Standing'), category: 'Idle' } as SetItem;
    const jobs = [
      { asset: girl.id, name: 'girl', spec: spec([walk], { uniformWith: [{ set: { id: 's', name: 's', items: [walk, idle] } }] }) },
      { asset: girl.id, name: 'girl_idle', spec: spec([idle]) },
      { asset: man.id, name: 'man', spec: spec([walk]) },
      { asset: girl.id, name: 'girl_as_man', spec: spec([walk], { gender: 'Masculine' }) },
      { asset: skull.id, name: 'skull', spec: spec([walk]) },
    ];
    const clips = neededClips(jobs, lib);
    const by = (asset: number) => clips.filter((c) => c.req.asset === asset);
    const girlClips = by(girl.id);
    expect(girlClips.map((c) => [c.animation.name, lib.animation(c.animation.id)!.gender])).toEqual([['Walk_F', 'Feminine'], ['Idle_Standing', 'Feminine'], ['Walk_F', 'Masculine']]);
    expect(girlClips[1]!.sprites).toEqual(['girl', 'girl_idle']);
    expect(by(man.id).map((c) => lib.animation(c.animation.id)!.gender)).toEqual(['Masculine']);
    expect(by(skull.id)).toEqual([]);
    expect(clips.every((c) => c.req.rootMotion === false)).toBe(true);
  });
});
