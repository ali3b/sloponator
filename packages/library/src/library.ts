/**
 * A read-only view of the old generator's library: its SQLite database (data/library.db, opened read-only) and the
 * files its rows point at under data/{packs,glb,meta,thumbs,bakes,rigs}. How rows map to files follows the old
 * server (apps/server/src/library.ts, main.ts assetDto/animDto, assetSearch.ts, assetVariants.ts, scale.ts,
 * assetSize.ts, roles.ts, rigs.ts, bake.ts, labels.ts, search.ts). Nothing here writes, runs Blender or talks to a
 * server.
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { autoCategory, isCategory } from './synty/categories.js';
import { slotFor, type PartSlot } from './synty/attachments.js';
import { extentOf, packScaleVerdict, scaleFixFor, sizeSuspectFor, type PackScaleVerdict } from './synty/scale.js';
import { localName, partMetres, roleFor } from './synty/roles.js';
import { detect, loadProfiles, type RigProfile } from './synty/rigs.js';
import { findStateVariants } from './synty/states.js';
import { knownScaleOverride } from './synty/index.js';
import type {
  Animation, AnimationEntry, AnimationQuery, Asset, AssetEntry, AssetKind, AssetPart, AssetQuery, AssetRig, AssetScale, AssetStatus, IngestMeta, Label, LabelField, Library,
  Pack, PackKind, PackStatus, Project, ScaleOverrideRow,
} from './types.js';

export interface OpenLibraryOptions {
  /** The old generator's data dir (holds library.db, packs/, glb/, meta/, thumbs/, bakes/, rigs/). */
  dataDir: string;
  /** The database file; default `${dataDir}/library.db`. */
  db?: string;
}

// ---- rows as the DB has them (apps/server/src/db.ts) ----

interface PackRow {
  id: number;
  name: string;
  version: number;
  kind: PackKind;
  file_name: string;
  dir: string;
  status: PackStatus;
  progress: number;
  message: string | null;
  created_at: string;
}

interface AssetRow {
  id: number;
  pack_id: number;
  pack_name: string;
  name: string;
  kind: string;
  fbx: string;
  variant: string;
  glb: string | null;
  thumb: string | null;
  meta: string | null;
  status: AssetStatus;
  error: string | null;
  ai_tags: string | null;
  ai_description: string | null;
  size_x: number | null;
  size_y: number | null;
  size_z: number | null;
  size_max: number | null;
  modular: number | null;
  size_stamp: number | null;
}

interface AnimationRow {
  id: number;
  pack_id: number;
  pack_name: string;
  name: string;
  fbx: string;
  rig: string | null;
  frames: number | null;
  fps: number | null;
  loop: number;
  category: string | null;
  set_name: string | null;
  gender: string | null;
  root_motion: number;
  bones: string | null;
  status: AssetStatus;
  error: string | null;
  previous_names: string | null;
}

const KIND_ORDER = `CASE a.kind WHEN 'character' THEN 0 WHEN 'vehicle' THEN 1 WHEN 'attachment' THEN 2 WHEN 'weapon' THEN 3 ELSE 4 END`;
const ASSET_COLS = 'a.id, a.pack_id, p.name AS pack_name, a.name, a.kind, a.fbx, a.variant, a.glb, a.thumb, a.meta, a.status, a.error';
const MAX_LIMIT = 5000;

function parseJson<T>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

const stringList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/**
 * A user's words as a safe FTS5 query: each token quoted (inner quotes dropped), the last one a prefix. Null when
 * nothing usable is left. (search.ts ftsQuery; the synonym expansion and re-ranking of the old search are not ported.)
 */
export function ftsQuery(q: string): string | null {
  const tokens = q.split(/\s+/).map((t) => t.replace(/"/g, '').trim()).filter(Boolean);
  if (!tokens.length) return null;
  return tokens.map((t, i) => `"${t}"${i === tokens.length - 1 ? '*' : ''}`).join(' AND ');
}

/** Adds non-enumerable methods to a plain object, so spreading or serialising it gives the plain object back. */
function withMethods<T extends object, M extends object>(dto: T, methods: M): T & M {
  for (const [k, v] of Object.entries(methods)) Object.defineProperty(dto, k, { value: v, enumerable: false, writable: false, configurable: false });
  return dto as T & M;
}

export function openLibrary(opts: OpenLibraryOptions): Library {
  const dataDir = path.resolve(opts.dataDir);
  const dbPath = opts.db ? path.resolve(opts.db) : path.join(dataDir, 'library.db');
  if (!fs.existsSync(dbPath)) throw new Error(`no library database at ${dbPath}`);
  // readonly: the WAL is still read (SQLite needs the -shm file to exist or be creatable; the old server keeps both).
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const dirs = {
    packs: path.join(dataDir, 'packs'),
    glb: path.join(dataDir, 'glb'),
    thumbs: path.join(dataDir, 'thumbs'),
    meta: path.join(dataDir, 'meta'),
    bakes: path.join(dataDir, 'bakes'),
    rigs: path.join(dataDir, 'rigs'),
  };

  const tables = new Set((db.prepare(`SELECT name FROM sqlite_master WHERE type IN ('table', 'view')`).all() as { name: string }[]).map((r) => r.name));
  const has = (t: string) => tables.has(t);
  let hasFts = has('assets_fts');
  if (hasFts) {
    try {
      db.prepare(`SELECT rowid FROM assets_fts WHERE assets_fts MATCH ? LIMIT 1`).get('"a"*');
    } catch {
      hasFts = false; // the SQLite build lacks FTS5
    }
  }
  // The name rules' category as a SQL function, so lists can filter on it (labels.ts registerCategoryFn).
  db.function('slop_category', { deterministic: true }, (name: unknown, kind: unknown) => autoCategory(String(name), String(kind))?.category ?? null);
  const CATEGORY_SQL = has('asset_labels')
    ? `COALESCE((SELECT json_extract(l.value, '$') FROM asset_labels l WHERE l.pack_name = p.name AND l.fbx = a.fbx AND l.variant = a.variant AND l.field = 'category'), slop_category(a.name, a.kind))`
    : `slop_category(a.name, a.kind)`;
  const sizeCols = has('assets') && (db.prepare('PRAGMA table_info(assets)').all() as { name: string }[]).some((c) => c.name === 'size_stamp');

  // ---- packs ----

  /** The extracted folder: the DB's absolute path when it exists, else the same folder name under dataDir/packs. */
  const packDir = (dir: string) => (fs.existsSync(dir) ? dir : path.join(dirs.packs, path.basename(dir)));
  const packDto = (r: PackRow, counts: { assets: number; animations: number; errors: number }): Pack => ({
    id: r.id, name: r.name, version: r.version, kind: r.kind, fileName: r.file_name, dir: packDir(r.dir), status: r.status, message: r.message, createdAt: r.created_at, ...counts,
  });
  const packCounts = (id: number) => ({
    assets: (db.prepare('SELECT COUNT(*) AS n FROM assets WHERE pack_id = ?').get(id) as { n: number }).n,
    animations: (db.prepare('SELECT COUNT(*) AS n FROM animations WHERE pack_id = ?').get(id) as { n: number }).n,
    errors: (db.prepare(`SELECT (SELECT COUNT(*) FROM assets WHERE pack_id = ? AND status = 'error') + (SELECT COUNT(*) FROM animations WHERE pack_id = ? AND status = 'error') AS n`).get(id, id) as { n: number }).n,
  });
  const packs = (): Pack[] => (db.prepare('SELECT * FROM packs ORDER BY name').all() as PackRow[]).map((r) => packDto(r, packCounts(r.id)));
  const packRow = (ref: number | string): PackRow | undefined => {
    if (typeof ref === 'number' || /^\d+$/.test(String(ref).trim())) return db.prepare('SELECT * FROM packs WHERE id = ?').get(Number(ref)) as PackRow | undefined;
    const r = String(ref).trim().toLowerCase();
    const all = db.prepare('SELECT * FROM packs').all() as PackRow[];
    return all.find((x) => x.name.toLowerCase() === r) ?? all.find((x) => x.name.toLowerCase() === r.replace(/[_ ]?v?\d+$/, ''));
  };
  const pack = (ref: number | string): Pack | undefined => {
    const r = packRow(ref);
    return r ? packDto(r, packCounts(r.id)) : undefined;
  };
  const packDirs = new Map<number, string>();
  const packDirOf = (packId: number): string => {
    let d = packDirs.get(packId);
    if (d === undefined) {
      const r = db.prepare('SELECT dir FROM packs WHERE id = ?').get(packId) as { dir: string } | undefined;
      d = packDir(r?.dir ?? path.join(dirs.packs, String(packId)));
      packDirs.set(packId, d);
    }
    return d;
  };

  // ---- labels (labels.ts labelsOf) ----

  const labelsOf = (a: AssetRow): Partial<Record<LabelField, Label>> => {
    if (!has('asset_labels')) return {};
    const rows = db.prepare('SELECT field, value, source, model, updated_at FROM asset_labels WHERE pack_name = ? AND fbx = ? AND variant = ?').all(a.pack_name, a.fbx, a.variant) as {
      field: LabelField; value: string; source: 'human' | 'ai'; model: string | null; updated_at: string;
    }[];
    const out: Partial<Record<LabelField, Label>> = {};
    for (const r of rows) out[r.field] = { value: parseJson(r.value), source: r.source, model: r.model, updatedAt: r.updated_at };
    return out;
  };

  // ---- scale (scale.ts scaleFixer, assetSize.ts assetScaler) ----

  const verdicts = new Map<number, PackScaleVerdict>();
  const verdictOf = (packId: number): PackScaleVerdict => {
    let v = verdicts.get(packId);
    if (!v) {
      const rows = db
        .prepare(`SELECT name, json_extract(meta, '$.bounds') AS bounds FROM assets WHERE pack_id = ? AND status = 'ready' AND kind IN ('prop', 'multipart', 'weapon')`)
        .all(packId) as { name: string; bounds: string | null }[];
      v = packScaleVerdict(rows.map((r) => ({ name: r.name, extent: extentOf({ bounds: parseJson<{ min: number[]; max: number[] }>(r.bounds) }) })));
      verdicts.set(packId, v);
    }
    return v;
  };
  const overrideQ = has('scale_overrides') ? db.prepare('SELECT scale FROM scale_overrides WHERE pack_name = ? AND fbx = ? AND variant = ?') : null;
  const scaleOf = (a: AssetRow, meta: IngestMeta | null): AssetScale => {
    const extent = extentOf(meta);
    const auto = meta?.bundled ? 1 : scaleFixFor(a, extent, verdictOf(a.pack_id));
    const row = overrideQ?.get(a.pack_name, a.fbx, a.variant) as { scale: number } | undefined;
    const known = row ? undefined : knownScaleOverride(a.pack_name, a.fbx, a.variant);
    const scale = row?.scale ?? known?.scale ?? auto;
    const source: AssetScale['source'] = row ? 'override' : known ? 'known' : meta?.bundled ? 'bundled' : 'auto';
    const s = source === 'auto' && extent && !['character', 'rigged', 'vehicle'].includes(a.kind) ? sizeSuspectFor(a.name, extent * scale) : null;
    return { scale, source, auto, extent, suspect: s ? { ...s, suggestedScale: s.factor ? +(scale * s.factor).toPrecision(6) : null } : null };
  };

  // ---- assets ----

  const metaOf = (a: AssetRow): IngestMeta | null => parseJson<IngestMeta>(a.meta) ?? parseJson<IngestMeta>(fs.existsSync(metaPathOf(a)) ? fs.readFileSync(metaPathOf(a), 'utf8') : null);
  const metaPathOf = (a: { pack_id: number; id: number }) => path.join(dirs.meta, `p${a.pack_id}`, `a${a.id}.json`);
  const sizeOf = (a: AssetRow, meta: IngestMeta | null, scale: number): [number, number, number] | null => {
    if (sizeCols && a.size_stamp != null && a.size_x != null && a.size_y != null && a.size_z != null) return [a.size_x, a.size_y, a.size_z];
    if (!meta?.bounds) return null;
    const b = meta.bounds;
    return b.max.map((v, i) => +((v - (b.min[i] ?? 0)) * scale).toFixed(3)) as [number, number, number];
  };
  const partOverrides = (a: AssetRow): Map<string, string | null> => {
    if (!has('part_overrides')) return new Map();
    const rows = db.prepare('SELECT part, role FROM part_overrides WHERE pack_name = ? AND fbx = ?').all(a.pack_name, a.fbx) as { part: string; role: string | null }[];
    return new Map(rows.map((r) => [r.part, r.role]));
  };
  let userProfiles: RigProfile[] | null = null;
  const profiles = () => (userProfiles ??= loadProfiles([dirs.rigs]));

  const assetDto = (a: AssetRow): Asset => {
    const meta = parseJson<IngestMeta>(a.meta);
    const labels = labelsOf(a);
    const label = <T>(f: LabelField) => labels[f]?.value as T | undefined;
    const cat = autoCategory(a.name, a.kind);
    const labelCategory = label<string>('category');
    const slot = label<string>('slot') ?? (['attachment', 'weapon', 'fx', 'prop', 'multipart', 'rigged'].includes(a.kind) ? slotFor(a.name, a.kind) : null);
    const scale = scaleOf(a, meta);
    return {
      id: a.id, packId: a.pack_id, pack: a.pack_name, name: a.name, kind: a.kind as AssetKind, status: a.status, error: a.error,
      fbx: a.fbx, variant: a.variant || null, glb: a.glb, thumb: a.thumb,
      bundled: meta?.bundled ?? null,
      category: isCategory(labelCategory) ? labelCategory : (cat?.category ?? null), damaged: cat?.damaged ?? false,
      slot: (slot as PartSlot | null) ?? null,
      size: sizeOf(a, meta, scale.scale),
      modular: sizeCols && a.size_stamp != null ? !!a.modular : meta?.bundled ? true : null,
      tags: label<string[]>('tags') ?? stringList(parseJson(a.ai_tags)),
      description: label<string>('description') ?? a.ai_description ?? null,
      labels,
      hidden: label<boolean>('hidden') ?? false,
    };
  };

  const entry = (a: AssetRow): AssetEntry => {
    const existing = (p: string | null) => (p && fs.existsSync(p) ? p : null);
    return withMethods(assetDto(a), {
      glbPath: () => existing(a.glb ? path.join(dataDir, a.glb) : null),
      thumbPath: () => existing(a.thumb ? path.join(dataDir, a.thumb) : null),
      metaPath: () => existing(metaPathOf(a)),
      meta: () => metaOf(a),
      fbxPath: () => path.join(packDirOf(a.pack_id), a.fbx),
      scale: () => scaleOf(a, parseJson<IngestMeta>(a.meta)),
      roles: (): AssetPart[] => {
        const meta = metaOf(a);
        if (!meta?.parts?.length) return [];
        const ov = partOverrides(a);
        const { scale } = scaleOf(a, meta);
        return meta.parts.map((p) => {
          const rule = roleFor(p.name, meta.name);
          const overridden = ov.has(p.name);
          return {
            name: p.name, local: localName(p.name, meta.name), role: overridden ? (ov.get(p.name) ?? null) : rule, ruleRole: rule, overridden,
            ...(p.parent !== undefined ? { parent: p.parent } : {}),
            ...(p.pivot ? { pivot: p.pivot } : {}), ...(p.bbox_min ? { bboxMin: p.bbox_min } : {}), ...(p.bbox_max ? { bboxMax: p.bbox_max } : {}), ...(p.spin_axis ? { spinAxis: p.spin_axis } : {}),
            ...partMetres(p, scale),
          };
        });
      },
      rig: (): AssetRig | null => {
        const meta = metaOf(a);
        const bones = meta?.bones ?? [];
        if (meta?.rig?.profile) return { profile: meta.rig.profile, score: meta.rig.score, map: meta.rig.map ?? detect(bones, profiles(), 0)?.map ?? {}, bones };
        if (!bones.length) return null;
        const d = detect(bones, profiles());
        return d ? { profile: d.profile, score: d.score, map: d.map, bones } : null;
      },
      variants: () => {
        const siblings = db.prepare(`SELECT id, name, kind FROM assets WHERE pack_id = ? AND status = 'ready'`).all(a.pack_id) as { id: number; name: string; kind: string }[];
        return findStateVariants({ id: a.id, name: a.name, kind: a.kind }, siblings);
      },
      grip: () => (has('grips') ? parseJson<Record<string, unknown>>((db.prepare('SELECT data FROM grips WHERE pack_name = ? AND asset_name = ?').get(a.pack_name, a.name) as { data: string } | undefined)?.data) : null),
      placements: () => {
        if (!has('placements')) return {};
        const rows = db.prepare('SELECT moveset, data, source, rev FROM placements WHERE pack_name = ? AND asset_name = ?').all(a.pack_name, a.name) as { moveset: string; data: string; source: 'human' | 'ai-approved'; rev: number }[];
        return Object.fromEntries(rows.map((r) => [r.moveset, { ...(parseJson<Record<string, unknown>>(r.data) ?? {}), rev: r.rev, source: r.source }]));
      },
    });
  };

  const searchIds = (q: string, limit: number): number[] | null => {
    if (!hasFts) return null;
    const match = ftsQuery(q);
    if (!match) return null;
    try {
      return (db.prepare('SELECT rowid AS id FROM assets_fts WHERE assets_fts MATCH ? ORDER BY rank LIMIT ?').all(match, limit) as { id: number }[]).map((r) => r.id);
    } catch {
      return null;
    }
  };

  const assets = (q: AssetQuery = {}): AssetEntry[] => {
    const where = ['1=1'];
    const args: unknown[] = [];
    const add = (sql: string, ...a: unknown[]) => {
      where.push(sql);
      args.push(...a);
    };
    const status = q.status ?? 'ready';
    if (status !== 'all') add('a.status = ?', status);
    const kinds = q.kind === undefined ? [] : Array.isArray(q.kind) ? q.kind : [q.kind];
    if (kinds.length) add(`a.kind IN (${kinds.map(() => '?').join(',')})`, ...kinds);
    const cats = q.category === undefined ? [] : Array.isArray(q.category) ? q.category : [q.category];
    if (cats.length) {
      const bad = cats.find((c) => !isCategory(c));
      if (bad) throw new Error(`unknown category "${bad}"`);
      where.push(`${CATEGORY_SQL} IN (${cats.map(() => '?').join(',')})`);
      args.push(...cats);
    }
    if (q.pack !== undefined) {
      const p = packRow(q.pack);
      if (!p) return [];
      where.push('a.pack_id = ?');
      args.push(p.id);
    }
    let ranked: string | null = null;
    const query = q.query?.trim();
    if (query) {
      const ids = searchIds(query, 2000);
      if (ids?.length) {
        ranked = JSON.stringify(ids);
        add('a.id IN (SELECT value FROM json_each(?))', ranked);
      } else if (ids && !ids.length) return [];
      else add('a.name LIKE ?', `%${query}%`);
    }
    const limit = Math.min(Math.max(1, q.limit ?? 200), MAX_LIMIT);
    const offset = Math.max(0, q.offset ?? 0);
    const rows = db
      .prepare(
        `SELECT ${ASSET_COLS}${sizeCols ? ', a.ai_tags, a.ai_description, a.size_x, a.size_y, a.size_z, a.size_max, a.modular, a.size_stamp' : ', a.ai_tags, a.ai_description'}
         FROM assets a JOIN packs p ON p.id = a.pack_id ${ranked ? 'JOIN json_each(?) r ON r.value = a.id' : ''}
         WHERE ${where.join(' AND ')}
         ORDER BY ${ranked ? 'r.key, ' : ''}${KIND_ORDER}, a.name, a.id LIMIT ? OFFSET ?`,
      )
      .all(...(ranked ? [ranked] : []), ...args, limit, offset) as AssetRow[];
    return rows.map(entry);
  };

  const assetSelect = `SELECT ${ASSET_COLS}, a.ai_tags, a.ai_description${sizeCols ? ', a.size_x, a.size_y, a.size_z, a.size_max, a.modular, a.size_stamp' : ''} FROM assets a JOIN packs p ON p.id = a.pack_id`;
  const assetRow = (id: number) => db.prepare(`${assetSelect} WHERE a.id = ?`).get(id) as AssetRow | undefined;
  const rowsNamed = (name: string, packId?: number): AssetRow[] =>
    db
      .prepare(`${assetSelect} WHERE lower(a.name) = lower(?) AND a.status = 'ready'${packId !== undefined ? ' AND a.pack_id = ?' : ''} ORDER BY (a.variant != ''), a.id`)
      .all(...(packId !== undefined ? [name, packId] : [name])) as AssetRow[];

  const asset = (ref: number | string): AssetEntry | undefined => {
    if (typeof ref === 'number' || /^\d+$/.test(ref.trim())) {
      const r = assetRow(Number(ref));
      return r ? entry(r) : undefined;
    }
    const s = ref.trim();
    const i = s.indexOf('/');
    let packId: number | undefined;
    let name = s;
    if (i > 0) {
      const p = packRow(s.slice(0, i));
      if (!p) return undefined;
      packId = p.id;
      name = s.slice(i + 1).trim();
    }
    const r = rowsNamed(name, packId)[0];
    return r ? entry(r) : undefined;
  };
  const assetsNamed = (name: string, packRef?: number | string): AssetEntry[] => {
    let packId: number | undefined;
    if (packRef !== undefined) {
      const p = packRow(packRef);
      if (!p) return [];
      packId = p.id;
    }
    return rowsNamed(name, packId).map(entry);
  };

  // ---- animations (main.ts animDto, bake.ts) ----

  const looksHumanoid = (bones: string[]) => bones.some((b) => /hip|pelvis|spine/i.test(b));
  const clipEditOf = (packName: string, name: string) =>
    has('clip_edits') ? parseJson<Animation['edit']>((db.prepare('SELECT data FROM clip_edits WHERE pack_name = ? AND clip_name = ?').get(packName, name) as { data: string } | undefined)?.data) : null;
  const animDto = (n: AnimationRow): Animation => {
    const bones = stringList(parseJson(n.bones));
    return {
      id: n.id, packId: n.pack_id, pack: n.pack_name, name: n.name, fbx: n.fbx, rig: n.rig, frames: n.frames, fps: n.fps, loop: !!n.loop,
      category: n.category, set: n.set_name, gender: n.gender, rootMotion: !!n.root_motion, status: n.status, error: n.error,
      needsMapping: n.status === 'ready' && !n.rig && (n.bones ? looksHumanoid(bones) : true),
      previousNames: stringList(parseJson(n.previous_names)),
      edit: clipEditOf(n.pack_name, n.name),
    };
  };
  const bakeFile = (assetId: number, animId: number, inPlace: boolean) => path.join(dirs.bakes, `a${assetId}`, `n${animId}${inPlace ? '' : '_rm'}.glb`);
  const animEntry = (n: AnimationRow): AnimationEntry =>
    withMethods(animDto(n), {
      bakePath: (assetId: number, o: { inPlace?: boolean } = {}) => {
        const f = bakeFile(assetId, n.id, o.inPlace ?? true);
        return fs.existsSync(f) ? f : null;
      },
      bakeSpeed: (assetId: number, o: { inPlace?: boolean } = {}) => {
        const f = `${bakeFile(assetId, n.id, o.inPlace ?? true)}.json`;
        const v = fs.existsSync(f) ? (parseJson<{ speedMps?: unknown }>(fs.readFileSync(f, 'utf8'))?.speedMps ?? null) : null;
        return typeof v === 'number' && v > 0.05 ? v : null;
      },
      metaPath: () => {
        const f = path.join(dirs.meta, `p${n.pack_id}`, `n${n.id}.json`);
        return fs.existsSync(f) ? f : null;
      },
      fbxPath: () => path.join(packDirOf(n.pack_id), n.fbx),
      bones: () => stringList(parseJson(n.bones)),
    });
  const ANIM_SELECT = 'SELECT n.*, p.name AS pack_name FROM animations n JOIN packs p ON p.id = n.pack_id';

  const animations = (q: AnimationQuery = {}): AnimationEntry[] => {
    const where = ['1=1'];
    const args: unknown[] = [];
    const add = (sql: string, ...a: unknown[]) => {
      where.push(sql);
      args.push(...a);
    };
    const status = q.status ?? 'ready';
    if (status !== 'all') add('n.status = ?', status);
    const query = q.query?.trim();
    if (query) add('(n.name LIKE ? OR n.category LIKE ? OR n.previous_names LIKE ?)', `%${query}%`, `%${query}%`, `%${query}%`);
    if (q.pack !== undefined) {
      const p = packRow(q.pack);
      if (!p) return [];
      where.push('n.pack_id = ?');
      args.push(p.id);
    }
    if (q.rigKind !== undefined) {
      if (q.rigKind === null) add('n.rig IS NULL');
      else add('n.rig = ?', q.rigKind);
    }
    if (q.category) add('n.category LIKE ?', `${q.category}%`);
    if (q.gender) add('lower(n.gender) = lower(?)', q.gender);
    if (q.set) add('lower(n.set_name) = lower(?)', q.set);
    if (q.rootMotion !== undefined) add('n.root_motion = ?', q.rootMotion ? 1 : 0);
    const limit = Math.min(Math.max(1, q.limit ?? 20000), 20000);
    const rows = db.prepare(`${ANIM_SELECT} WHERE ${where.join(' AND ')} ORDER BY p.name, n.category, n.name, n.id LIMIT ?`).all(...args, limit) as AnimationRow[];
    return rows.map(animEntry);
  };
  const animation = (ref: number | string): AnimationEntry | undefined => {
    if (typeof ref === 'number' || /^\d+$/.test(ref.trim())) {
      const r = db.prepare(`${ANIM_SELECT} WHERE n.id = ?`).get(Number(ref)) as AnimationRow | undefined;
      return r ? animEntry(r) : undefined;
    }
    const r = db
      .prepare(`${ANIM_SELECT} WHERE lower(n.name) = lower(?) AND n.status = 'ready' ORDER BY (n.rig IS NULL), n.root_motion, n.id`)
      .get(ref.trim()) as AnimationRow | undefined;
    return r ? animEntry(r) : undefined;
  };

  // ---- projects (projects.ts): the shared settings the old generator's sprites inherited ----

  const projectDto = (r: { id: number; name: string; description: string | null; defaults: string | null; kind: string | null; created_at: string; updated_at: string }): Project => ({
    id: r.id, name: r.name, description: r.description, kind: r.kind ?? '2d', defaults: parseJson<Record<string, unknown>>(r.defaults) ?? {}, createdAt: r.created_at, updatedAt: r.updated_at,
  });
  const projects = (): Project[] =>
    has('projects') ? (db.prepare('SELECT id, name, description, defaults, kind, created_at, updated_at FROM projects ORDER BY name').all() as Parameters<typeof projectDto>[0][]).map(projectDto) : [];
  const project = (ref: number | string): Project | undefined => {
    if (!has('projects')) return undefined;
    if (typeof ref === 'number' || /^\d+$/.test(String(ref).trim())) {
      const r = db.prepare('SELECT id, name, description, defaults, kind, created_at, updated_at FROM projects WHERE id = ?').get(Number(ref)) as Parameters<typeof projectDto>[0] | undefined;
      return r ? projectDto(r) : undefined;
    }
    const r = db.prepare('SELECT id, name, description, defaults, kind, created_at, updated_at FROM projects WHERE lower(name) = lower(?) ORDER BY id').get(String(ref).trim()) as Parameters<typeof projectDto>[0] | undefined;
    return r ? projectDto(r) : undefined;
  };

  const scaleOverrides = (): ScaleOverrideRow[] =>
    has('scale_overrides')
      ? (db.prepare('SELECT pack_name AS pack, fbx, variant, scale FROM scale_overrides ORDER BY pack_name, fbx, variant').all() as ScaleOverrideRow[])
      : [];

  return { dataDir, dbPath, hasFts, packs, pack, assets, asset, assetsNamed, animations, animation, projects, project, scaleOverrides, close: () => db.close() };
}
