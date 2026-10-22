// Moved from the old generator's packages/shared/src/map/tiled.ts (ali3b/sloponator#17, #18).
import { yawForAngle } from '@slop/sprites';
import { gridAxes, rotateYaw } from '@slop/sprites';
import { atlasLayout, TILED_APP_VERSION, TILED_VERSION, toTiledJson, writeTsx } from '../tileset/tiled.js';
import type { TilesetBody } from '../tileset/types.js';
import { tileExtraHeight, tilesetPpm } from '../tileset/types.js';
import { elevationLookup, elevationPx } from './elevation.js';
import { resolveGround } from './resolve.js';
import { GID_STRIDE, type MapBody, type MapObject, type Properties, type PropertyValue, type Zone } from './types.js';

/**
 * Tiled map writers (pure): a map body → `.tmj` (Tiled JSON) or `.tmx` (Tiled XML), format 1.10.
 *
 * - Tilesets are external: `{ firstgid, source: "<slug>.tsj" }` (`.tsx` in a .tmx). Slot i gets firstgid
 *   1 + i·GID_STRIDE, the map's own gids, so decoration cells are written as stored.
 * - Ground layers are resolved to tiles through the tileset's corner tiles (resolve.ts); decoration as stored.
 * - Objects: a tile object (gid) when the caller passes a collection tile for the sprite, else a point object with
 *   spriteId / assetRef / state / facing / footprint properties. Zones: point, rect, polygon or polyline objects
 *   whose `type` is the zone kind. Collision: rectangle objects of type "collision", one per run of blocked cells.
 * - Object coordinates. Tiled stores isometric object positions in "pixels" along the two map axes, where one
 *   cell is tileHeight × tileHeight (so a 64×32 map's cell (x, y) is at (32x, 32y)); orthogonal maps use
 *   tileWidth × tileHeight. Map coordinates are cell units, so they are scaled by those.
 */

export interface MapTilesetRef {
  body: TilesetBody;
  /** File base name without extension (".tsj" / ".tsx" is added per format). */
  file: string;
}

/** A picture of an object in an image-collection tileset: its tile id, size and where its anchor is in it. */
export interface ObjectTile {
  id: number;
  width: number;
  height: number;
  /** The object's anchor (ground centre of the footprint) in the image, pixels from its top-left. */
  anchor: { x: number; y: number };
}

export interface ObjectTileset {
  /** File base name without extension. */
  file: string;
  /**
   * Tiles by object key, looked up most specific first: "<ref>|<state>|<facing>", "<ref>|<state>|",
   * "<ref>||<facing>", "<ref>||", where ref is the spriteId or the assetRef. `width`/`height` are the size the
   * object is drawn at in Tiled (its image scaled to the map's pixels per metre).
   */
  tiles: Record<string, ObjectTile>;
  /** The collection's name (default: the file name). */
  name?: string;
  /** Its images (paths relative to the map) at their own size: needed to write the tileset file or embed it. */
  images?: { id: number; image: string; width: number; height: number }[];
}

/**
 * The parts of a sprite export's `object` block (object/footprint.ts ObjectInfo) the map export reads: the
 * directions and states with their collision polygons.
 */
export interface SpriteObjectBlock {
  centre?: { x: number; z: number };
  tiles?: { metresPerTile: number; shape?: 'square' | 'diamond' } | null;
  collision?: { points: [number, number][] };
  pixelsPerMetre?: number | null;
  directions?: { name: string; worldAngle?: number; mirrorOf?: string | null; tiles?: { polygon?: [number, number][] } }[];
  states?: { name: string; collision?: { points: [number, number][] }; directions?: { name: string; tiles?: { polygon?: [number, number][] } }[] }[];
}

/** What the export knows about a placed project sprite (from its current render). */
export interface MapSpriteInfo {
  /** The sprite's name. */
  name: string;
  /** The folder `ssg sprite download` and `ssg sprite apply --download` write it to (default: from the name). */
  exportName?: string;
  /** Its library model, "Pack/Model". */
  asset?: string;
  /** Its current render's object block (null: no render with one). */
  object?: SpriteObjectBlock | null;
  /** The clip a sprite without states shows (default "still"). */
  stillClip?: string;
}

export interface MapWriteOptions {
  /** The map's tilesets by slot (null when one is missing: its ground resolves to nothing, with a warning). */
  tilesets: (MapTilesetRef | null)[];
  /** Image-collection tilesets with pictures of the placed objects (external, or embedded with `embed`). */
  objectTilesets?: ObjectTileset[];
  /**
   * The placed sprites by id: their names, export folders, models and object blocks, so every object says which
   * sprite, state and facing it shows and carries its collision polygon.
   */
  sprites?: Record<number, MapSpriteInfo>;
  /** Also write each object's collision polygon as a polygon object in an object layer "collision_shapes". */
  collisionShapes?: boolean;
  /**
   * Embed the ground tilesets in the map instead of referencing `<file>.tsj`/`.tsx` (Phaser 3 only reads embedded
   * tilesets). The atlas image is still `<file>.png` next to the map.
   */
  embed?: boolean;
  /**
   * How placed objects carry their sprite's data (FB-066). 'inline' (default): every object has all of it (sprite,
   * spriteId, exportName, asset, state, facing, footprintW/H, collision, anchor). 'shared': each distinct set of that
   * data is written once, in the map property `spriteData` (a JSON object keyed "<sprite>|<state>|<facing>"), and each
   * object keeps only what differs (mapId, elevation, cellX/cellY, its own properties) plus `spriteKey`, the key of
   * its entry; the map property `objectData` is then "shared". A reader merges `{ ...spriteData[spriteKey], ...own }`
   * to get the inline properties back (resolveSharedObjectProperties).
   */
  objectData?: ObjectDataMode;
}

export type ObjectDataMode = 'inline' | 'shared';
export const OBJECT_DATA_MODES: readonly ObjectDataMode[] = ['inline', 'shared'];
/** The per-sprite property names a 'shared' export moves off the objects into `spriteData`. */
export const SHARED_OBJECT_PROPS = ['anchor', 'asset', 'assetRef', 'collision', 'exportName', 'facing', 'footprintH', 'footprintW', 'sprite', 'spriteId', 'state'] as const;

type PropType = 'string' | 'int' | 'float' | 'bool';
interface Prop { name: string; type: PropType; value: PropertyValue }
const typeOf = (v: PropertyValue): PropType => (typeof v === 'boolean' ? 'bool' : typeof v === 'number' ? (Number.isInteger(v) ? 'int' : 'float') : 'string');
/** Properties written as floats whatever their value looks like (Tiled keeps a property's type). */
const FLOAT_PROPS = new Set(['elevationM', 'elevationPx', 'widthM', 'edgeWidthM']);
const propsOf = (o: Properties): Prop[] => Object.keys(o).sort().map((name) => ({ name, type: FLOAT_PROPS.has(name) && typeof o[name] === 'number' ? 'float' : typeOf(o[name]), value: o[name] }));
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

export const mapFileName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'map';

/** Map coordinates (cells) → Tiled object pixels. */
export function toTiledPx(doc: Pick<MapBody, 'orientation' | 'tileWidth' | 'tileHeight'>, x: number, y: number): [number, number] {
  return doc.orientation === 'isometric' ? [r4(x * doc.tileHeight), r4(y * doc.tileHeight)] : [r4(x * doc.tileWidth), r4(y * doc.tileHeight)];
}

/**
 * Where a tile object must be so its picture's anchor lands on map point (x, y). Tiled draws a tile object with
 * its picture's bottom-centre (isometric) or bottom-left (orthogonal) at the object's position, so the position is
 * the anchor's minus the anchor's offset from that point, turned back from screen pixels into object pixels.
 */
export function tileObjectPosition(doc: Pick<MapBody, 'orientation' | 'tileWidth' | 'tileHeight'>, x: number, y: number, t: Pick<ObjectTile, 'width' | 'height' | 'anchor'>): [number, number] {
  const [px, py] = toTiledPx(doc, x, y);
  if (doc.orientation !== 'isometric') return [r4(px - t.anchor.x), r4(py + t.height - t.anchor.y)];
  // Screen offset from the anchor to the picture's bottom-centre; screen (sx, sy) = ((ox − oy)·W/2H, (ox + oy)/2).
  const dx = t.width / 2 - t.anchor.x, dy = t.height - t.anchor.y;
  const k = doc.tileHeight / doc.tileWidth;
  return [r4(px + dy + dx * k), r4(py + dy - dx * k)];
}

/** The folder name `ssg sprite download` gives a sprite (the client's safeName). */
export const spriteFolderName = (name: string) => name.replace(/[^\w.\- ]+/g, '_').trim() || 'untitled';

/** The facing and state an object shows: its own, else the export's first direction and first state (or still clip). */
export function resolvedObjectView(o: Pick<MapObject, 'state' | 'facing'>, info?: MapSpriteInfo | null): { state?: string; facing?: string } {
  const state = o.state ?? info?.object?.states?.[0]?.name ?? (info?.object ? info.stillClip ?? 'still' : undefined);
  const facing = o.facing ?? info?.object?.directions?.[0]?.name;
  return { ...(state !== undefined ? { state } : {}), ...(facing !== undefined ? { facing } : {}) };
}

/**
 * An object's ground collision polygon in map cells around its anchor (x along the map's x axis, y along its y),
 * for a state and facing, from its export's object block: the direction's tile polygon (rescaled when the export
 * was rendered at another metres per tile), else the metres polygon turned like the direction. Null when the
 * block has no polygon for it.
 */
export function objectCollisionCells(block: SpriteObjectBlock | null | undefined, metresPerTile: number, view: { state?: string; facing?: string }, orientation: MapBody['orientation'] = 'isometric'): [number, number][] | null {
  const dirs = block?.directions ?? [];
  const dir = dirs.find((d) => d.name === view.facing) ?? dirs[0];
  if (!block || !dir || !(metresPerTile > 0)) return null;
  const st = view.state !== undefined ? block.states?.find((s) => s.name === view.state) : undefined;
  const r3 = (v: number) => Math.round(v * 1000) / 1000 || 0;
  // A state's own polygon for the facing; a state with no collision of its own has the base state's.
  const poly = (st ? st.directions?.find((d) => d.name === dir.name)?.tiles?.polygon : undefined) ?? (st?.collision ? undefined : dir.tiles?.polygon);
  if (poly?.length && block.tiles?.metresPerTile) {
    const k = block.tiles.metresPerTile / metresPerTile;
    return poly.map(([u, v]) => [r3(u * k), r3(v * k)]);
  }
  // No tile polygon: the metres polygon (model axes, around the base state's centre) turned like the direction.
  const points = (st?.collision ?? block.collision)?.points;
  if (!points?.length) return null;
  const shape = block.tiles?.shape ?? (orientation === 'isometric' ? 'diamond' : 'square');
  const src = dir.mirrorOf ? dirs.find((d) => d.name === dir.mirrorOf) ?? dir : dir;
  if (src.worldAngle === undefined) return null;
  const yaw = yawForAngle(src.worldAngle);
  const [u, v] = gridAxes(shape);
  const c = rotateYaw([block.centre?.x ?? 0, block.centre?.z ?? 0], yaw);
  const out = points.map((p): [number, number] => {
    const q = rotateYaw(p, yaw);
    const dx = q[0] - c[0], dz = q[1] - c[1];
    return [(dx * u[0] + dz * u[1]) / metresPerTile, (dx * v[0] + dz * v[1]) / metresPerTile];
  });
  // A mirrored direction is its source flipped: a diamond grid's u and v swap, a square grid's u turns round.
  const flipped = src !== dir ? out.map(([a, b]): [number, number] => (shape === 'diamond' ? [b, a] : [-a, b])) : out;
  return flipped.map(([a, b]) => [r3(a), r3(b)]);
}

function objectTileFor(o: MapObject, sets: ObjectTileset[], firstgid: (i: number) => number): { gid: number; tile: ObjectTile } | null {
  const ref = o.spriteId !== undefined ? String(o.spriteId) : o.assetRef ?? '';
  const keys = [`${ref}|${o.state ?? ''}|${o.facing ?? ''}`, `${ref}|${o.state ?? ''}|`, `${ref}||${o.facing ?? ''}`, `${ref}||`];
  for (const [i, s] of sets.entries())
    for (const k of keys) if (s.tiles[k]) return { gid: firstgid(i) + s.tiles[k].id, tile: s.tiles[k] };
  return null;
}

interface TObject {
  id: number;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  gid?: number;
  point?: boolean;
  polygon?: { x: number; y: number }[];
  polyline?: { x: number; y: number }[];
  props: Prop[];
}
type TLayer =
  | { kind: 'tile'; id: number; name: string; data: number[]; visible: boolean; props: Prop[] }
  | { kind: 'objects'; id: number; name: string; className: string; objects: TObject[]; visible: boolean; props: Prop[] };

/** The map as Tiled sees it, shared by both writers. */
function build(doc: MapBody, o: MapWriteOptions) {
  const warnings: string[] = [];
  let nextObject = 1;
  const layers: TLayer[] = [];
  const firstgid = (slot: number) => 1 + slot * GID_STRIDE;
  const objectSets = o.objectTilesets ?? [];
  const objectFirstgid = (i: number) => firstgid(doc.tilesets.length + i);
  const px = (x: number, y: number) => toTiledPx(doc, x, y);
  /** Objects' collision polygons (Tiled pixels around their anchors), for the collision_shapes layer. */
  const shapes: { ob: MapObject; name: string; points: [number, number][] }[] = [];
  /** Height level at a map point (objects on a plateau get `elevation: 1`). */
  const elevation = elevationLookup(doc, o.tilesets.map((t) => t?.body));
  /** objectData 'shared': each distinct per-sprite property set once, by key (and its JSON, to find it again). */
  const shared = o.objectData === 'shared';
  const spriteData = new Map<string, { json: string; data: Properties }>();
  const spriteKeyFor = (base: string, data: Properties): string => {
    const json = JSON.stringify(data);
    for (let n = 1; ; n++) {
      const key = n === 1 ? base : `${base}#${n}`;
      const hit = spriteData.get(key);
      if (!hit) {
        spriteData.set(key, { json, data });
        return key;
      }
      if (hit.json === json) return key;
    }
  };
  for (const [li, l] of doc.layers.entries()) {
    const id = li + 1;
    const visible = l.visible !== false;
    const props = propsOf(l.properties ?? {});
    if (l.type === 'ground') {
      const slot = l.tileset ?? 0;
      const ts = o.tilesets[slot];
      if (!ts) {
        warnings.push(`ground layer "${l.name}": tileset slot ${slot} is missing, the layer is empty`);
        layers.push({ kind: 'tile', id, name: l.name, data: new Array(doc.width * doc.height).fill(0), visible, props });
        continue;
      }
      const g = resolveGround(doc, l, ts.body);
      if (g.missing)
        warnings.push(
          `ground layer "${l.name}": ${g.missing} cells have a corner mix the tileset has no tile for (${g.missingCombos.slice(0, 5).join(', ')}), ` +
            `at ${g.missingAt.slice(0, 8).map(([x, y]) => `(${x},${y})`).join(' ')}${g.missing > 8 ? ' …' : ''}; they show the pure tile of their main terrain (get_map / ssg map show list them all)`,
        );
      // Raised terrain (B4): the tiles are taller than the grid. Tiled draws them bottom-aligned (right as written);
      // Phaser 3.80 draws iso tiles top-aligned, so tell it how far up to create the layer.
      const extra = tileExtraHeight(ts.body);
      const lp = extra ? propsOf({ ...(l.properties ?? {}), tileOffsetY: -extra }) : props;
      layers.push({ kind: 'tile', id, name: l.name, data: g.gids, visible, props: lp });
    } else if (l.type === 'decoration') {
      layers.push({ kind: 'tile', id, name: l.name, data: [...l.cells], visible, props });
    } else if (l.type === 'objects') {
      const objects = l.objects.map((ob): TObject => {
        const info = ob.spriteId !== undefined ? o.sprites?.[ob.spriteId] : undefined;
        const view = resolvedObjectView(ob, info);
        const spriteName = info?.name ?? (ob.spriteId !== undefined ? ob.name : undefined);
        // FB-095: a marker has no collision polygon (and says so).
        const poly = info && ob.collision !== false ? objectCollisionCells(info.object, doc.metresPerTile, view, doc.orientation) : null;
        const polyPx = poly?.map(([u, v]) => toTiledPx(doc, u, v));
        if (poly && polyPx) shapes.push({ ob, name: spriteName ?? ob.name ?? ob.id, points: polyPx });
        const own: Properties = {
          mapId: ob.id,
          ...(ob.spriteId !== undefined ? { spriteId: ob.spriteId } : {}),
          ...(spriteName !== undefined ? { sprite: spriteName, exportName: info?.exportName ?? spriteFolderName(spriteName) } : {}),
          ...(ob.assetRef ? { assetRef: ob.assetRef } : {}),
          ...(info?.asset ?? ob.assetRef ? { asset: (info?.asset ?? ob.assetRef)! } : {}),
          ...view,
          ...(ob.footprint ? { footprintW: ob.footprint.w, footprintH: ob.footprint.h } : {}),
          ...(polyPx ? { collision: JSON.stringify(polyPx) } : {}),
          ...(elevation(ob.x, ob.y).level ? { elevation: 1 } : {}),
          anchor: 'footprint-centre',
          ...(ob.collision === false ? { collides: false } : {}),
          // FB-079: standing on something: metres above the ground and how many map pixels higher it is drawn.
          ...(ob.elevation ? { elevationM: ob.elevation, elevationPx: elevationPx(doc, ob.elevation) } : {}),
          ...(ob.on !== undefined ? { onObject: ob.on } : {}),
          ...(ob.group !== undefined ? { group: ob.group } : {}),
        };
        const tile = objectTileFor({ ...ob, ...view }, objectSets, objectFirstgid) ?? objectTileFor(ob, objectSets, objectFirstgid);
        if (tile) Object.assign(own, { cellX: r4(ob.x), cellY: r4(ob.y) });
        let props = propsOf({ ...ob.properties, ...own });
        if (shared) {
          // The sprite's part once in spriteData; the object keeps the rest. Split after merging, so an object's own
          // property named like a shared one moves with it (a different value gets its own key, "<base>#2").
          const data: Properties = {}, rest: Properties = {};
          for (const p of props) ((SHARED_OBJECT_PROPS as readonly string[]).includes(p.name) ? data : rest)[p.name] = p.value;
          const label = String(data.sprite ?? data.assetRef ?? 'object');
          const key = spriteKeyFor(`${label}|${data.state ?? ''}|${data.facing ?? ''}`, data);
          props = propsOf({ ...rest, spriteKey: key });
        }
        const name = ob.name ?? ob.assetRef ?? (ob.spriteId !== undefined ? `sprite ${ob.spriteId}` : ob.id);
        if (tile) {
          const [x, y] = tileObjectPosition(doc, ob.x, ob.y, tile.tile);
          return { id: nextObject++, name, type: 'object', x, y, width: tile.tile.width, height: tile.tile.height, gid: tile.gid, props };
        }
        const [x, y] = px(ob.x, ob.y);
        return { id: nextObject++, name, type: 'object', x, y, width: 0, height: 0, point: true, props };
      });
      layers.push({ kind: 'objects', id, name: l.name, className: 'objects', objects, visible, props });
    } else if (l.type === 'zones') {
      const objects = l.zones.map((z: Zone): TObject => {
        // FB-059: the zone's vehicle as its sprite's (current) name, id and export folder; speed always a float.
        const vInfo = z.vehicle ? o.sprites?.[z.vehicle.spriteId] : undefined;
        const vName = vInfo?.name ?? z.vehicle?.name;
        const props = [
          ...propsOf({
            ...z.properties, mapId: z.id,
            ...(z.vehicle ? { vehicleId: z.vehicle.spriteId, ...(vName ? { vehicle: vName, vehicleExport: vInfo?.exportName ?? spriteFolderName(vName) } : {}) } : {}),
          }).filter((p) => p.name !== 'speed' || z.speed === undefined),
          ...(z.speed !== undefined ? [{ name: 'speed', type: 'float' as const, value: z.speed }] : []),
        ].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        const base = { id: nextObject++, name: z.name, type: z.kind, props };
        const pts = z.points.map(([x, y]) => px(x, y));
        if (z.shape === 'point') return { ...base, x: pts[0][0], y: pts[0][1], width: 0, height: 0, point: true };
        if (z.shape === 'rect') {
          const [a, b] = pts;
          return { ...base, x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: r4(Math.abs(b[0] - a[0])), height: r4(Math.abs(b[1] - a[1])) };
        }
        const rel = pts.map(([x, y]) => ({ x: r4(x - pts[0][0]), y: r4(y - pts[0][1]) }));
        return { ...base, x: pts[0][0], y: pts[0][1], width: 0, height: 0, ...(z.shape === 'polygon' ? { polygon: rel } : { polyline: rel }) };
      });
      layers.push({ kind: 'objects', id, name: l.name, className: 'zones', objects, visible, props });
    } else if (l.type === 'collision') {
      const objects: TObject[] = [];
      for (let y = 0; y < doc.height; y++)
        for (let x = 0; x < doc.width; ) {
          if (!l.cells[y * doc.width + x]) {
            x++;
            continue;
          }
          let e = x;
          while (e < doc.width && l.cells[y * doc.width + e]) e++;
          const [ax, ay] = px(x, y), [bx, by] = px(e, y + 1);
          objects.push({ id: nextObject++, name: '', type: 'collision', x: ax, y: ay, width: r4(bx - ax), height: r4(by - ay), props: [] });
          x = e;
        }
      layers.push({ kind: 'objects', id, name: l.name, className: 'collision', objects, visible, props });
    }
  }
  if (o.collisionShapes) {
    // One polygon object per object with a collision polygon, at the object's anchor (its own `collision` property).
    const objects = shapes.map(({ ob, name, points }): TObject => {
      const [x, y] = px(ob.x, ob.y);
      return { id: nextObject++, name, type: 'collision_shape', x, y, width: 0, height: 0, polygon: points.map(([a, b]) => ({ x: a, y: b })), props: propsOf({ mapId: ob.id }) };
    });
    layers.push({ kind: 'objects', id: doc.layers.length + 1, name: 'collision_shapes', className: 'collision_shapes', objects, visible: true, props: [] });
  }
  for (const t of o.tilesets) {
    const count = t ? atlasLayout(t.body).tilecount : 0;
    if (count > GID_STRIDE) warnings.push(`tileset "${t!.body.name}" has ${count} tiles, more than the ${GID_STRIDE} a map slot holds`);
  }
  const tilesets: { firstgid: number; file: string; body?: TilesetBody; collection?: ObjectTileset }[] = [
    ...doc.tilesets.map((_, slot) => ({ firstgid: firstgid(slot), file: o.tilesets[slot]?.file ?? `tileset_${doc.tilesets[slot]}`, body: o.embed ? o.tilesets[slot]?.body : undefined })),
    ...objectSets.map((s, i) => ({ firstgid: objectFirstgid(i), file: s.file, collection: o.embed && s.images ? s : undefined })),
  ];
  // Scale: always floats (Tiled keeps a property's type), whatever the number looks like.
  const mapProps = [
    ...propsOf(doc.properties).filter((p) => !['metresPerTile', 'pixelsPerMetre', ...(shared ? ['objectData', 'spriteData'] : [])].includes(p.name)),
    ...(shared
      ? [
          { name: 'objectData', type: 'string' as const, value: 'shared' },
          { name: 'spriteData', type: 'string' as const, value: JSON.stringify(Object.fromEntries([...spriteData].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [k, v.data]))) },
        ]
      : []),
    { name: 'metresPerTile', type: 'float' as const, value: doc.metresPerTile },
    { name: 'pixelsPerMetre', type: 'float' as const, value: r4(tilesetPpm({ orientation: doc.orientation, tileWidth: doc.tileWidth, metresPerTile: doc.metresPerTile })) },
  ].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { layers, tilesets, mapProps, nextLayerId: layers.length + 1, nextObjectId: nextObject, warnings };
}

// ---------------------------------------------------------------------------------------------- JSON (.tmj)

const jsonProps = (p: Prop[]) => (p.length ? { properties: p.map((x) => ({ name: x.name, type: x.type, value: x.value })) } : {});

/** The Tiled JSON map object and the warnings (serialise with JSON.stringify, or use writeTmj). */
export function toTiledMapJson(doc: MapBody, o: MapWriteOptions) {
  const b = build(doc, o);
  const layers = b.layers.map((l) =>
    l.kind === 'tile'
      ? { data: l.data, height: doc.height, id: l.id, name: l.name, opacity: 1, ...jsonProps(l.props), type: 'tilelayer', visible: l.visible, width: doc.width, x: 0, y: 0 }
      : {
          class: l.className, draworder: 'topdown', id: l.id, name: l.name,
          objects: l.objects.map((ob) => ({
            ...(ob.gid !== undefined ? { gid: ob.gid } : {}),
            height: ob.height, id: ob.id, name: ob.name,
            ...(ob.point ? { point: true } : {}),
            ...(ob.polygon ? { polygon: ob.polygon } : {}),
            ...(ob.polyline ? { polyline: ob.polyline } : {}),
            ...jsonProps(ob.props),
            rotation: 0, type: ob.type, visible: true, width: ob.width, x: ob.x, y: ob.y,
          })),
          opacity: 1, ...jsonProps(l.props), type: 'objectgroup', visible: l.visible, x: 0, y: 0,
        },
  );
  return {
    map: {
      compressionlevel: -1,
      height: doc.height,
      infinite: false,
      layers,
      nextlayerid: b.nextLayerId,
      nextobjectid: b.nextObjectId,
      orientation: doc.orientation,
      ...jsonProps(b.mapProps),
      renderorder: 'right-down',
      tiledversion: TILED_APP_VERSION,
      tileheight: doc.tileHeight,
      tilesets: b.tilesets.map((t) => {
        if (t.collection) {
          const { version: _v, tiledversion: _t, type: _type, ...embedded } = objectTilesetJson(t.collection);
          return { firstgid: t.firstgid, ...embedded };
        }
        if (!t.body) return { firstgid: t.firstgid, source: `${t.file}.tsj` };
        const { version: _v, tiledversion: _t, type: _type, ...embedded } = toTiledJson(t.body, { file: t.file });
        return { firstgid: t.firstgid, ...embedded };
      }),
      tilewidth: doc.tileWidth,
      type: 'map',
      version: TILED_VERSION,
      width: doc.width,
    },
    warnings: b.warnings,
  };
}

/** The .tmj text: indented like Tiled, but a tile layer's data one map row per line (not one number per line). */
export function writeTmj(doc: MapBody, o: MapWriteOptions): string {
  const rows: string[] = [];
  const text = JSON.stringify(toTiledMapJson(doc, o).map, (k, v) => {
    if (k !== 'data' || !Array.isArray(v)) return v;
    rows.push(Array.from({ length: doc.height }, (_, y) => v.slice(y * doc.width, (y + 1) * doc.width).join(', ')).join(',\n    '));
    return `\u0000data${rows.length - 1}`;
  }, 1);
  return text.replace(/"\\u0000data(\d+)"/g, (_, i) => `[\n    ${rows[Number(i)]}\n   ]`) + '\n';
}

// ----------------------------------------------------------------------------------------------- XML (.tmx)

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const attrs = (a: Record<string, string | number | undefined>) =>
  Object.entries(a).filter(([, v]) => v !== undefined).map(([k, v]) => ` ${k}="${esc(String(v))}"`).join('');
function xmlProps(p: Prop[], pad: string): string[] {
  if (!p.length) return [];
  return [`${pad}<properties>`, ...p.map((x) => `${pad} <property${attrs({ name: x.name, type: x.type === 'string' ? undefined : x.type, value: String(x.value) })}/>`), `${pad}</properties>`];
}
const pointsAttr = (pts: { x: number; y: number }[]) => pts.map((p) => `${p.x},${p.y}`).join(' ');

export function writeTmx(doc: MapBody, o: MapWriteOptions): string {
  const b = build(doc, o);
  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<map${attrs({ version: TILED_VERSION, tiledversion: TILED_APP_VERSION, orientation: doc.orientation, renderorder: 'right-down', width: doc.width, height: doc.height, tilewidth: doc.tileWidth, tileheight: doc.tileHeight, infinite: 0, nextlayerid: b.nextLayerId, nextobjectid: b.nextObjectId })}>`,
    ...xmlProps(b.mapProps, ' '),
    ...b.tilesets.map((t) =>
      t.collection
        ? writeObjectTsx(t.collection).trimEnd().split('\n').slice(1).map((line, i) => ' ' + (i === 0 ? line.replace(/^<tileset /, `<tileset firstgid="${t.firstgid}" `).replace(/ version="[^"]*" tiledversion="[^"]*"/, '') : line)).join('\n')
        : t.body
        ? writeTsx(t.body, { file: t.file }).trimEnd().split('\n').slice(1).map((line, i) => ' ' + (i === 0 ? line.replace(/^<tileset /, `<tileset firstgid="${t.firstgid}" `).replace(/ version="[^"]*" tiledversion="[^"]*"/, '') : line)).join('\n')
        : ` <tileset${attrs({ firstgid: t.firstgid, source: `${t.file}.tsx` })}/>`,
    ),
  ];
  for (const l of b.layers) {
    if (l.kind === 'tile') {
      out.push(` <layer${attrs({ id: l.id, name: l.name, width: doc.width, height: doc.height, visible: l.visible ? undefined : 0 })}>`);
      out.push(...xmlProps(l.props, '  '));
      const rows = Array.from({ length: doc.height }, (_, y) => l.data.slice(y * doc.width, (y + 1) * doc.width).join(','));
      out.push(`  <data encoding="csv">\n${rows.join(',\n')}\n</data>`);
      out.push(' </layer>');
      continue;
    }
    out.push(` <objectgroup${attrs({ id: l.id, name: l.name, class: l.className, visible: l.visible ? undefined : 0 })}>`);
    out.push(...xmlProps(l.props, '  '));
    for (const ob of l.objects) {
      const a = attrs({ id: ob.id, name: ob.name || undefined, type: ob.type || undefined, gid: ob.gid, x: ob.x, y: ob.y, width: ob.width || undefined, height: ob.height || undefined });
      const inner = [
        ...xmlProps(ob.props, '   '),
        ...(ob.point ? ['   <point/>'] : []),
        ...(ob.polygon ? [`   <polygon points="${pointsAttr(ob.polygon)}"/>`] : []),
        ...(ob.polyline ? [`   <polyline points="${pointsAttr(ob.polyline)}"/>`] : []),
      ];
      if (!inner.length) out.push(`  <object${a}/>`);
      else out.push(`  <object${a}>`, ...inner, '  </object>');
    }
    out.push(' </objectgroup>');
  }
  out.push('</map>');
  return out.join('\n') + '\n';
}

// ------------------------------------------------------------------------------- object image collections

/**
 * An image-collection tileset of object pictures as Tiled JSON (.tsj): one tile per image, each its own size.
 * Tiled draws an iso map's tile object with the image's bottom-centre on the object's point (bottom-left on an
 * orthogonal map), which `tileObjectPosition` accounts for.
 */
export function objectTilesetJson(s: ObjectTileset) {
  const images = s.images ?? [];
  return {
    columns: 0,
    grid: { height: 1, orientation: 'orthogonal', width: 1 },
    margin: 0,
    name: s.name ?? s.file,
    spacing: 0,
    tilecount: images.length,
    tiledversion: TILED_APP_VERSION,
    tileheight: Math.max(1, ...images.map((i) => i.height)),
    tiles: images.map((i) => ({ id: i.id, image: i.image, imageheight: i.height, imagewidth: i.width })),
    tilewidth: Math.max(1, ...images.map((i) => i.width)),
    type: 'tileset',
    version: TILED_VERSION,
  };
}

export const writeObjectTsj = (s: ObjectTileset) => JSON.stringify(objectTilesetJson(s), null, 1) + '\n';

/** The same collection as Tiled XML (.tsx). */
export function writeObjectTsx(s: ObjectTileset): string {
  const j = objectTilesetJson(s);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<tileset${attrs({ version: TILED_VERSION, tiledversion: TILED_APP_VERSION, name: j.name, tilewidth: j.tilewidth, tileheight: j.tileheight, tilecount: j.tilecount, columns: 0 })}>`,
    ' <grid orientation="orthogonal" width="1" height="1"/>',
    ...j.tiles.flatMap((t) => [` <tile id="${t.id}">`, `  <image${attrs({ source: t.image, width: t.imagewidth, height: t.imageheight })}/>`, ' </tile>']),
    '</tileset>',
  ].join('\n') + '\n';
}

/** A Tiled property as read from a .tmj (`{ name, type, value }`). */
export interface TiledPropertyJson { name: string; type?: string; value: PropertyValue }

/**
 * An object's properties as the inline export writes them, from a map exported with objectData 'shared' (FB-066):
 * the entry of the map's `spriteData` its `spriteKey` names, overlaid with the object's own properties (without
 * `spriteKey`). From an inline export (no `spriteData`), the object's own properties. Types follow the inline
 * writer: whole numbers int, others float. Games without @ssg/shared do the same in a few lines:
 *
 *   const sd = JSON.parse(mapProps.spriteData ?? '{}');
 *   const props = (o) => { const p = Object.fromEntries((o.properties ?? []).map((q) => [q.name, q.value])); return { ...sd[p.spriteKey], ...p }; };
 */
export function resolveSharedObjectProperties(
  map: { properties?: TiledPropertyJson[] },
  object: { properties?: TiledPropertyJson[] },
): { name: string; type: PropType; value: PropertyValue }[] {
  const raw = map.properties?.find((p) => p.name === 'spriteData')?.value;
  const table = typeof raw === 'string' ? (JSON.parse(raw) as Record<string, Properties>) : {};
  const own: Properties = Object.fromEntries((object.properties ?? []).map((p) => [p.name, p.value]));
  const key = own.spriteKey;
  if (typeof key !== 'string' || !table[key]) return propsOf(own);
  delete own.spriteKey;
  return propsOf({ ...table[key], ...own });
}

/** Warnings the export would give (missing tilesets, corner mixes without a tile). */
export function tiledMapWarnings(doc: MapBody, o: MapWriteOptions): string[] {
  return build(doc, o).warnings;
}
