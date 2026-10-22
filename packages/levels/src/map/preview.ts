// Moved from the old generator's packages/shared/src/map/preview.ts (ali3b/sloponator#17, #18).
/* eslint-disable @typescript-eslint/no-unused-expressions -- moved code keeps the old generator's comma expressions (a(), b()) unchanged */
import { createImage, mapSize, type RgbaImage } from '../tileset/raster.js';
import { TERRAIN_COLORS, tileExtraHeight, tileImageHeight, tilesetPpm, type TilesetBody } from '../tileset/types.js';
import { elevationLookup, elevationPx } from './elevation.js';
import { blendPixel, drawPlacedLabels, FONT_H, fillPolygon, fillRect, hexToRgba, placeLabels, strokePath, type Box, type LabelRequest, type Rgba } from './draw.js';
import { objectRect } from './ops.js';
import { gridFacingAngle } from './generate.js';
import { nearestFacing } from './stamp.js';
import { baseTerrain, cellTerrain, resolveGround } from './resolve.js';
import { GID_STRIDE, splitGid, type MapBody, type MapLayer, type MapObject, type Zone, type ZoneKind } from './types.js';

/**
 * The map preview (pure TS, deterministic): a depth-sorted picture of a map as an iso (or orthogonal) engine would
 * draw it, plus a minimap.
 *
 * - Ground and decoration layers are sampled from the tilesets' atlases per output pixel: a pixel's centre is
 *   turned back into a map cell and a pixel of that cell's tile picture, so at scale 1 the ground is exactly what
 *   `composeMap` (and Tiled/Phaser) draw, and at other scales it has no seams (smaller scales average 2×2 or 3×3
 *   samples).
 * - Objects are drawn from their sprite's export frame with the export's `object` anchor on the object's map
 *   position (the footprint centre), scaled by the map's pixels per metre over the export's, and sorted by the
 *   anchor's screen y (the ground position). An export with column `slices` is drawn as strips, each sorted at its
 *   own `sortY`. An object without a picture is drawn as its footprint diamond with its name.
 * - Overlays (drawn on top, at the output resolution so they stay sharp): collision, the cell grid, zones with
 *   their kind's colour and a label.
 *
 * - Raised terrain (B4): tile pictures taller than the grid (cliffs) are drawn like Tiled does, bottom-aligned on
 *   their cell, layer by layer and cell by cell from back to front, so a plateau's raised top and cliff face overlap
 *   the cells behind it. Objects standing on raised ground are drawn the cliff height higher (sorted by their
 *   ground position as before).
 *
 * "Native" pixels are the map picture's own (`mapSize`: cell (x, y)'s tile at `cellOrigin`); the output is that
 * picture scaled by `scale` and grown to fit objects that stick out of the ground (`origin` = the native pixel at
 * the output's top-left).
 */

/** A tileset with its decoded atlas (tiles by id, `columns` per row). */
export interface PreviewTileset {
  body: TilesetBody;
  atlas: RgbaImage;
  columns: number;
}

/** The picture of a placed object: one frame of its export. */
export interface ObjectPicture {
  /** The atlas page the frame is on. */
  page: RgbaImage;
  /** The (trimmed) frame rectangle on the page. */
  frame: { x: number; y: number; w: number; h: number };
  /** Where the trimmed rectangle sits in the untrimmed frame, and the untrimmed frame size. */
  trimX: number;
  trimY: number;
  sourceW: number;
  sourceH: number;
  /** A mirrored direction: draw the untrimmed frame flipped horizontally. */
  flipX: boolean;
  /** The ground centre of the footprint in the drawn (already flipped) untrimmed frame, pixels. */
  anchor: { x: number; y: number };
  /** The export's pixels per metre (null: drawn at its own size). */
  pixelsPerMetre: number | null;
  /** Column slices of the drawn frame (untrimmed-frame pixels), each depth-sorted at `sortY`. */
  strips?: { x: number; y: number; w: number; h: number; sortY: number }[];
}

export interface MapPreviewOptions {
  /** Output pixels per map pixel (default 1). Capped so the longest side stays within `maxSize`. */
  scale?: number;
  /** Longest output side in pixels (default 4096). */
  maxSize?: number;
  /** Layers to draw, by name or type (default: every visible ground, decoration and objects layer). */
  layers?: string[];
  /** Zone overlays: outlines, fills and labels (default true). */
  zones?: boolean;
  /** The cell grid (default false). */
  grid?: boolean;
  /** Blocked cells in red (default false; also on when `layers` names a collision layer). */
  collision?: boolean;
  /**
   * Labels: 'all' (zone labels and the names of objects drawn as placeholders, the default), 'zones' or 'none'
   * (true / false: all / none). They are placed so they do not overlap (leader lines when moved away).
   */
  labels?: LabelMode | boolean;
  /** Behind everything (default transparent). */
  background?: Rgba;
  /**
   * Only this part of the map: cells [x0, y0, x1, y1) (x1, y1 exclusive; `regionOf` reads "x,y,w,h"). The picture
   * is the region's ground, the objects standing in it and the overlays over it, at native size unless `scale`.
   */
  region?: [number, number, number, number];
}

export interface MapPreview {
  image: RgbaImage;
  /** The scale used (after the size cap). */
  scale: number;
  /** Native map pixel at the output's top-left (objects sticking out above or left make it negative). */
  origin: [number, number];
  /** Objects drawn from their export, and the ids of those drawn as footprint placeholders. */
  sprites: string[];
  placeholders: string[];
  warnings: string[];
  /** The labels drawn and where (output pixels); `leader` when moved away from their point. */
  labels: { text: string; box: Box; leader: boolean }[];
  /** The region drawn (clamped to the map), when one was asked for. */
  region?: [number, number, number, number];
}

/** Placeholder labels past which only one per name is drawn. */
export const PLACEHOLDER_LABELS = 40;

/** A region [x0, y0, x1, y1) clamped to the map (at least one cell). */
export function clampRegion(doc: Pick<MapBody, 'width' | 'height'>, r: [number, number, number, number]): [number, number, number, number] {
  const x0 = Math.max(0, Math.min(doc.width - 1, Math.floor(Math.min(r[0], r[2])))), y0 = Math.max(0, Math.min(doc.height - 1, Math.floor(Math.min(r[1], r[3]))));
  const x1 = Math.max(x0 + 1, Math.min(doc.width, Math.ceil(Math.max(r[0], r[2])))), y1 = Math.max(y0 + 1, Math.min(doc.height, Math.ceil(Math.max(r[1], r[3]))));
  return [x0, y0, x1, y1];
}

/**
 * A region from "x,y,w,h" (or [x, y, w, h]): cells x..x+w-1, y..y+h-1 → [x0, y0, x1, y1). Throws a readable error
 * for anything else.
 */
export function parseRegion(v: string | number[]): [number, number, number, number] {
  const n = (typeof v === 'string' ? v.split(/[\s,]+/).filter(Boolean) : v).map(Number);
  if (n.length !== 4 || n.some((x) => !Number.isFinite(x)) || n[2] < 1 || n[3] < 1) throw new Error(`region must be x,y,w,h in cells (w, h ≥ 1), got "${String(v)}"`);
  return [Math.floor(n[0]), Math.floor(n[1]), Math.floor(n[0]) + Math.ceil(n[2]), Math.floor(n[1]) + Math.ceil(n[3])];
}

export const ZONE_COLORS: Record<ZoneKind, string> = {
  spawn: '#3ddc84', patrol: '#4aa3ff', objective: '#ffcc33', extraction: '#ff5ad1', trigger: '#ff7a1a', custom: '#d8d8d8',
};
const PLACEHOLDER: Rgba = [232, 128, 48, 0.55];
const PLACEHOLDER_EDGE: Rgba = [255, 196, 140, 1];

type Geo = Pick<MapBody, 'orientation' | 'tileWidth' | 'tileHeight' | 'width' | 'height'>;

/** Native map pixel of ground point (x, y) in cell units (cell (2.5, 3.5) = the centre of cell (2, 3)'s diamond). */
export function groundPixel(doc: Geo, x: number, y: number): [number, number] {
  if (doc.orientation === 'isometric') return [((x - y + doc.height) * doc.tileWidth) / 2, ((x + y) * doc.tileHeight) / 2];
  return [x * doc.tileWidth, y * doc.tileHeight];
}

const layerWanted = (l: MapLayer, wanted?: string[]) => (wanted?.length ? wanted.some((w) => w === l.name || w === l.type) : l.visible !== false);

/** The tile layers to draw as gid grids (ground resolved through its tileset's corner tiles). */
function tileLayers(doc: MapBody, tilesets: (PreviewTileset | null)[], wanted: string[] | undefined, warnings: string[]): number[][] {
  const out: number[][] = [];
  for (const l of doc.layers) {
    if (!layerWanted(l, wanted)) continue;
    if (l.type === 'ground') {
      const ts = tilesets[l.tileset ?? 0];
      if (!ts) {
        warnings.push(`ground layer "${l.name}": tileset slot ${l.tileset ?? 0} is missing`);
        continue;
      }
      out.push(resolveGround(doc, l, ts.body).gids);
    } else if (l.type === 'decoration') out.push(l.cells);
  }
  return out;
}

interface Placed {
  o: MapObject;
  pic: ObjectPicture | null;
  k: number;
  /** Native pixels the object is drawn higher (standing on raised terrain). */
  raise: number;
  /** Untrimmed frame top-left, native. */
  left: number;
  top: number;
  p: [number, number];
}

/** Supersampling grid size for a scale (1 when not shrinking). */
const samplesFor = (s: number) => (s >= 1 ? 1 : Math.min(3, Math.ceil(1 / s - 1e-9)));

export function renderMapPreview(doc: MapBody, tilesets: (PreviewTileset | null)[], pictureOf: (o: MapObject) => ObjectPicture | null, opts: MapPreviewOptions = {}): MapPreview {
  const warnings: string[] = [];
  const wanted = opts.layers?.length ? opts.layers : undefined;
  const gidLayers = tileLayers(doc, tilesets, wanted, warnings);
  const mapPpm = doc.metresPerTile > 0 ? tilesetPpm(doc) : null;

  // Tile pictures taller than the grid (raised terrain), in native pixels above the diamond.
  const extraOf = (ts: PreviewTileset | null) => (ts ? (tileExtraHeight(ts.body) * doc.tileHeight) / ts.body.tileHeight : 0);
  const maxExtra = Math.max(0, ...tilesets.map(extraOf));
  const elevation = elevationLookup(doc, tilesets.map((t) => t?.body));
  // A region: only its cells, the objects standing in it and what overlays touch it, at native size by default.
  const reg = opts.region ? clampRegion(doc, opts.region) : null;
  const [rx0, ry0, rx1, ry1] = reg ?? [0, 0, doc.width, doc.height];
  const inRegion = (x: number, y: number) => x >= rx0 && y >= ry0 && x <= rx1 && y <= ry1;

  // Objects and where their frames land (native pixels); on raised ground, drawn higher.
  const placed: Placed[] = [];
  for (const l of doc.layers)
    if (l.type === 'objects' && layerWanted(l, wanted))
      for (const o of l.objects) {
        if (reg && !inRegion(o.x, o.y)) continue;
        const pic = pictureOf(o);
        const p = groundPixel(doc, o.x, o.y);
        // FB-079: an object standing on another (or given an elevation) is drawn that much higher.
        const raise = elevation(o.x, o.y).raisePx + (o.elevation ? elevationPx(doc, o.elevation) : 0);
        const k = pic && pic.pixelsPerMetre && mapPpm ? mapPpm / pic.pixelsPerMetre : 1;
        placed.push({ o, pic, k, p, raise, left: pic ? p[0] - pic.anchor.x * k : p[0], top: (pic ? p[1] - pic.anchor.y * k : p[1]) - raise });
      }

  // Bounds: the ground picture (with what taller tiles add above it) plus every frame.
  const [gw, gh] = mapSize(doc, doc.width, doc.height);
  let bx0 = 0, by0 = 0, bx1 = gw, by1 = gh;
  if (reg) {
    const cs = [groundPixel(doc, rx0, ry0), groundPixel(doc, rx1, ry0), groundPixel(doc, rx1, ry1), groundPixel(doc, rx0, ry1)];
    bx0 = Math.min(...cs.map((c) => c[0])), by0 = Math.min(...cs.map((c) => c[1])), bx1 = Math.max(...cs.map((c) => c[0])), by1 = Math.max(...cs.map((c) => c[1]));
  }
  if (gidLayers.length && maxExtra > 0) by0 -= Math.ceil(maxExtra);
  for (const q of placed)
    if (q.pic) {
      bx0 = Math.min(bx0, q.left), by0 = Math.min(by0, q.top);
      bx1 = Math.max(bx1, q.left + q.pic.sourceW * q.k), by1 = Math.max(by1, q.top + q.pic.sourceH * q.k);
    }
  bx0 = Math.floor(bx0), by0 = Math.floor(by0), bx1 = Math.ceil(bx1), by1 = Math.ceil(by1);
  const maxSize = opts.maxSize ?? 4096;
  const s = Math.min(opts.scale ?? 1, maxSize / Math.max(1, bx1 - bx0, by1 - by0));
  const OW = Math.max(1, Math.ceil((bx1 - bx0) * s - 1e-6)), OH = Math.max(1, Math.ceil((by1 - by0) * s - 1e-6));
  const img = createImage(OW, OH);
  const toOut = (X: number, Y: number): [number, number] => [(X - bx0) * s, (Y - by0) * s];
  const ground = (x: number, y: number) => toOut(...groundPixel(doc, x, y));

  if (opts.background) for (let i = 0; i < OW * OH; i++) blendPixel(img, i % OW, Math.floor(i / OW), opts.background);

  // ---- tile layers
  if (gidLayers.length) paintTileLayers(img, doc, tilesets, gidLayers, maxExtra, bx0, by0, s, [rx0, ry0, rx1, ry1]);

  // ---- objects, depth sorted by their ground position (strips by their own sortY).
  interface Drawable { depth: number; x: number; seq: number; draw(): void }
  const list: Drawable[] = [];
  const sprites: string[] = [], placeholders: string[] = [];
  // FB-079: what stands on an object is drawn after it (its support's depth or its own, whichever is deeper).
  const groundDepth = new Map(placed.map((q) => [q.o.id, q.p[1]]));
  const depthOf = (q: Placed): number => {
    let d = q.p[1];
    for (let on = q.o.on, n = 0; on !== undefined && n < 8; n++) {
      const sd = groundDepth.get(on);
      if (sd === undefined) break;
      d = Math.max(d, sd + 0.01 * (n + 1));
      on = placed.find((x) => x.o.id === on)?.o.on;
    }
    return d;
  };
  placed.forEach((q, seq) => {
    if (!q.pic) {
      placeholders.push(q.o.id);
      list.push({ depth: depthOf(q), x: q.p[0], seq, draw: () => drawPlaceholder(q) });
      return;
    }
    sprites.push(q.o.id);
    const pic = q.pic;
    if (pic.strips?.length) pic.strips.forEach((st, i) => list.push({ depth: q.top + q.raise + st.sortY * q.k, x: q.p[0], seq: seq + i / 1000, draw: () => blit(q, st) }));
    else list.push({ depth: depthOf(q), x: q.p[0], seq, draw: () => blit(q, null) });
  });
  list.sort((a, b) => a.depth - b.depth || a.x - b.x || a.seq - b.seq);
  for (const d of list) d.draw();

  function blit(q: Placed, clip: { x: number; y: number; w: number; h: number } | null) {
    const pic = q.pic!;
    const k = q.k;
    const dx0 = pic.flipX ? pic.sourceW - pic.trimX - pic.frame.w : pic.trimX;
    // The drawn rect in frame pixels, clipped to the strip.
    let fx0 = dx0, fy0 = pic.trimY, fx1 = dx0 + pic.frame.w, fy1 = pic.trimY + pic.frame.h;
    if (clip) fx0 = Math.max(fx0, clip.x), fy0 = Math.max(fy0, clip.y), fx1 = Math.min(fx1, clip.x + clip.w), fy1 = Math.min(fy1, clip.y + clip.h);
    if (fx1 <= fx0 || fy1 <= fy0) return;
    const [ox0, oy0] = toOut(q.left + fx0 * k, q.top + fy0 * k), [ox1, oy1] = toOut(q.left + fx1 * k, q.top + fy1 * k);
    const n = samplesFor(s * k);
    const page = pic.page;
    for (let py = Math.max(0, Math.floor(oy0)); py < Math.min(OH, Math.ceil(oy1)); py++)
      for (let px = Math.max(0, Math.floor(ox0)); px < Math.min(OW, Math.ceil(ox1)); px++) {
        let r = 0, g = 0, b = 0, a = 0;
        for (let sy = 0; sy < n; sy++)
          for (let sx = 0; sx < n; sx++) {
            const fx = ((bx0 + (px + (sx + 0.5) / n) / s) - q.left) / k, fy = ((by0 + (py + (sy + 0.5) / n) / s) - q.top) / k;
            if (fx < fx0 || fx >= fx1 || fy < fy0 || fy >= fy1) continue;
            const col = Math.floor(fx), row = Math.floor(fy);
            const tc = (pic.flipX ? pic.sourceW - 1 - col : col) - pic.trimX, tr = row - pic.trimY;
            if (tc < 0 || tr < 0 || tc >= pic.frame.w || tr >= pic.frame.h) continue;
            const i = ((pic.frame.y + tr) * page.width + pic.frame.x + tc) * 4;
            const pa = page.data[i + 3] / 255;
            r += page.data[i] * pa, g += page.data[i + 1] * pa, b += page.data[i + 2] * pa, a += pa;
          }
        if (!a) continue;
        blendPixel(img, px, py, [r / a, g / a, b / a, a / (n * n)]);
      }
  }

  function footprintPoly(q: Placed): [number, number][] {
    const o = q.o;
    const [x0, y0, x1, y1] = o.footprint ? objectRect(o) : [o.x - 0.5, o.y - 0.5, o.x + 0.5, o.y + 0.5];
    return [ground(x0, y0), ground(x1, y0), ground(x1, y1), ground(x0, y1)].map(([x, y]) => [x, y - q.raise * s] as [number, number]);
  }
  function drawPlaceholder(q: Placed) {
    const poly = footprintPoly(q);
    fillPolygon(img, poly, PLACEHOLDER);
    strokePath(img, poly, PLACEHOLDER_EDGE, s >= 0.75 ? 2 : 1);
  }

  // ---- overlays at the output resolution.
  const fontScale = Math.max(OW, OH) >= 600 ? 2 : 1;
  const thick = s >= 0.75 ? 2 : 1;
  const showCollision = opts.collision || doc.layers.some((l) => l.type === 'collision' && wanted?.some((w) => w === l.name || w === 'collision'));
  if (showCollision)
    for (const l of doc.layers)
      if (l.type === 'collision')
        for (let y = ry0; y < ry1; y++)
          for (let x = rx0; x < rx1; x++)
            if (l.cells[y * doc.width + x]) fillPolygon(img, [ground(x, y), ground(x + 1, y), ground(x + 1, y + 1), ground(x, y + 1)], [220, 40, 40, 0.42]);
  if (opts.grid) {
    const c: Rgba = [255, 255, 255, 0.28];
    for (let x = rx0; x <= rx1; x++) strokePath(img, [ground(x, ry0), ground(x, ry1)], c, 1, false);
    for (let y = ry0; y <= ry1; y++) strokePath(img, [ground(rx0, y), ground(rx1, y)], c, 1, false);
  }
  const mode = labelMode(opts.labels);
  // Labels are placed together at the end so they avoid each other (zones first, then placeholder names).
  const zoneLabels: LabelRequest[] = [], objectLabels: LabelRequest[] = [], markers: Box[] = [];
  const vehicles: MapObject[] = [];
  if (mode === 'all') {
    // Thousands of placeholders (a scattered forest without renders) would bury the picture in names and take
    // seconds to place: past PLACEHOLDER_LABELS only the first of each name is labelled.
    const many = placed.filter((q) => !q.pic).length > PLACEHOLDER_LABELS;
    const named = new Set<string>();
    for (const q of placed)
      if (!q.pic) {
        const text = objectName(q.o);
        if (many && (named.has(text) || named.size >= PLACEHOLDER_LABELS)) continue;
        named.add(text);
        const [x, y] = ground(q.o.x, q.o.y);
        objectLabels.push({ text, x, y: y - q.raise * s, dy: -(FONT_H + 4) * fontScale - 2 * thick, color: PLACEHOLDER_EDGE });
      }
    if (many) warnings.push(`${placed.filter((q) => !q.pic).length} objects are drawn as placeholders; only one label per name is shown (a region shows a part in detail)`);
  }
  if (opts.zones !== false)
    for (const l of doc.layers) {
      if (l.type !== 'zones' || (wanted && !layerWanted(l, wanted) && !wanted.includes('zones'))) continue;
      for (const z of l.zones) {
        const col = hexToRgba(ZONE_COLORS[z.kind] ?? ZONE_COLORS.custom);
        const pts = z.shape === 'rect' && z.points.length >= 2
          ? [[z.points[0][0], z.points[0][1]], [z.points[1][0], z.points[0][1]], [z.points[1][0], z.points[1][1]], [z.points[0][0], z.points[1][1]]].map(([x, y]) => ground(x, y))
          : z.points.map(([x, y]) => ground(x, y));
        let at: [number, number] = pts[0] ?? [0, 0];
        if (z.shape === 'point' || pts.length === 1) {
          const r = 5 * thick;
          const [x, y] = pts[0];
          const d: [number, number][] = [[x, y - r], [x + r, y], [x, y + r], [x - r, y]];
          fillPolygon(img, d, [col[0], col[1], col[2], 0.85]);
          strokePath(img, d, [10, 10, 10, 0.9], 1);
          markers.push({ x: x - r, y: y - r, w: 2 * r + 1, h: 2 * r + 1 });
          at = [x, y - r - 2];
        } else if (z.shape === 'polyline') {
          strokePath(img, pts, [col[0], col[1], col[2], 0.95], thick, false);
          for (const [x, y] of pts) fillPolygon(img, [[x - 2 * thick, y - 2 * thick], [x + 2 * thick, y - 2 * thick], [x + 2 * thick, y + 2 * thick], [x - 2 * thick, y + 2 * thick]], [col[0], col[1], col[2], 1]);
          at = [pts[0][0], pts[0][1] - 4 * thick];
        } else {
          fillPolygon(img, pts, [col[0], col[1], col[2], 0.18]);
          strokePath(img, pts, [col[0], col[1], col[2], 0.95], thick);
          at = [pts.reduce((m, p) => m + p[0], 0) / pts.length, pts.reduce((m, p) => m + p[1], 0) / pts.length];
        }
        // FB-059 zones with a vehicle: arrows the way it drives, and the vehicle itself on the route's start.
        const start = z.vehicle ? vehicleStart(doc, z) : null;
        if (z.vehicle && start) {
          drawRouteArrows(img, zoneRoute(z)!.map(([x, y]) => ground(x, y)), col, 4 * thick, Math.max(32, 40 * thick));
          vehicles.push({ id: `${z.id}:vehicle`, spriteId: z.vehicle.spriteId, ...(z.vehicle.name ? { name: z.vehicle.name } : {}), facing: start.facing, x: start.x, y: start.y, footprint: { w: 1, h: 1 }, properties: {} });
        }
        if (mode !== 'none') {
          const base = !z.name || z.name.toLowerCase() === z.kind ? z.kind : `${z.kind}: ${z.name}`;
          const text = z.vehicle ? `${base} (${z.vehicle.name ?? `sprite ${z.vehicle.spriteId}`})` : base;
          zoneLabels.push({ text, x: at[0], y: at[1], dy: z.shape === 'point' || z.shape === 'polyline' ? -(5 + 4) * fontScale : 0, color: col });
        }
      }
    }
  for (const o of vehicles) {
    if (reg && !inRegion(o.x, o.y)) continue;
    const pic = pictureOf(o);
    const p = groundPixel(doc, o.x, o.y);
    const raise = elevation(o.x, o.y).raisePx;
    const k = pic && pic.pixelsPerMetre && mapPpm ? mapPpm / pic.pixelsPerMetre : 1;
    const q: Placed = { o, pic, k, p, raise, left: pic ? p[0] - pic.anchor.x * k : p[0], top: (pic ? p[1] - pic.anchor.y * k : p[1]) - raise };
    if (pic) {
      sprites.push(o.id);
      blit(q, null);
    } else {
      placeholders.push(o.id);
      drawPlaceholder(q);
    }
  }
  const onImage = (r: LabelRequest) => !reg || (r.x >= 0 && r.y >= 0 && r.x < OW && r.y < OH);
  const labels = placeLabels([...zoneLabels, ...objectLabels].filter(onImage), { width: OW, height: OH }, fontScale, { avoid: markers });
  drawPlacedLabels(img, labels, fontScale);
  return {
    image: img, scale: s, origin: [bx0, by0], sprites, placeholders, warnings, labels: labels.map((l) => ({ text: l.text, box: l.box, leader: l.leader })),
    ...(reg ? { region: reg } : {}),
  };
}

/**
 * The tile layers into the picture: per output pixel n×n samples (n from the scale), each the layers composited;
 * a separate function so the engine optimises this hot loop on its own (it is most of a big preview's time).
 */
function paintTileLayers(img: RgbaImage, doc: MapBody, tilesets: (PreviewTileset | null)[], gidLayers: number[][], maxExtra: number, bx0: number, by0: number, s: number, region: [number, number, number, number]) {
  const OW = img.width, OH = img.height;
  const [rx0, ry0, rx1, ry1] = region;
  const n = samplesFor(s);
  const acc = [0, 0, 0, 0];
  const col: Rgba = [0, 0, 0, 0];
  // Without taller tiles a sample hits one cell (cellAt); the loop below is cellAt and tilePixel inlined with
  // no allocation per sample, which is what a 4096 px picture of a 256×256 map spends its time on.
  const iso = doc.orientation === 'isometric';
  const TW = doc.tileWidth, TH = doc.tileHeight, MW = doc.width, MH = doc.height, half = (MH * TW) / 2;
  const K = Math.ceil(maxExtra / (iso ? TH / 2 : TH)) + 1;
  const slots = tilesets.map((ts) => (ts ? { tw: ts.body.tileWidth, th: ts.body.tileHeight, ih: tileImageHeight(ts.body), cols: ts.columns, data: ts.atlas.data, aw: ts.atlas.width, ah: ts.atlas.height } : null));
  /** The atlas offset of gid's pixel at (lx, ly) in its cell (in `td`), or -1. */
  let td: Uint8Array | Uint8ClampedArray = new Uint8Array(0);
  const texel = (gid: number, lx: number, ly: number): number => {
    if (gid <= 0) return -1;
    const slot = Math.floor((gid - 1) / GID_STRIDE), id = (gid - 1) % GID_STRIDE;
    const t = slots[slot];
    if (!t) return -1;
    const tx = Math.floor((lx * t.tw) / TW), ty = Math.floor((ly * t.th) / TH) + t.ih - t.th;
    if (tx < 0 || ty < 0 || tx >= t.tw || ty >= t.ih) return -1;
    const sx = (id % t.cols) * t.tw + tx, sy = Math.floor(id / t.cols) * t.ih + ty;
    if (sx >= t.aw || sy >= t.ah) return -1;
    const i = (sy * t.aw + sx) * 4;
    td = t.data;
    return td[i + 3] ? i : -1;
  };
  for (let py = 0; py < OH; py++)
    for (let px = 0; px < OW; px++) {
      acc[0] = acc[1] = acc[2] = acc[3] = 0;
      for (let sy = 0; sy < n; sy++)
        for (let sx = 0; sx < n; sx++) {
          // Snapped to the centre of the native pixel it falls in, so every sample sees exactly one tile.
          const X = Math.floor(bx0 + (px + (sx + 0.5) / n) / s) + 0.5, Y = Math.floor(by0 + (py + (sy + 0.5) / n) / s) + 0.5;
          let r = 0, g = 0, b = 0, a = 0;
          if (maxExtra > 0) {
            // cellsCovering without allocating: every cell whose taller picture covers (X, Y), layer by layer, and
            // within a layer back to front (taller tiles in front cover the cells behind).
            const xr = X - half;
            const u = iso ? Math.floor(Y / TH + xr / TW) : Math.floor(X / TW), v = iso ? Math.floor(Y / TH - xr / TW) : Math.floor(Y / TH);
            const myA = Math.max(ry0, v - 1), myB = Math.min(ry1 - 1, v + K), mxA = Math.max(rx0, u - 1), mxB = Math.min(rx1 - 1, u + (iso ? K : 1));
            for (const cells of gidLayers)
              for (let my = myA; my <= myB; my++)
                for (let mx = mxA; mx <= mxB; mx++) {
                  const ox = iso ? ((mx - my + MH - 1) * TW) / 2 : mx * TW, oy = iso ? ((mx + my) * TH) / 2 : my * TH;
                  if (X < ox || X >= ox + TW || Y < oy - maxExtra || Y >= oy + TH) continue;
                  const i = texel(cells[my * MW + mx], X - ox, Y - oy);
                  if (i < 0) continue;
                  const ta = td[i + 3] / 255;
                  r = td[i] * ta + r * (1 - ta);
                  g = td[i + 1] * ta + g * (1 - ta);
                  b = td[i + 2] * ta + b * (1 - ta);
                  a = ta + a * (1 - ta);
                }
          } else {
            let mx: number, my: number, ox: number, oy: number;
            if (iso) {
              const xr = X - half;
              mx = Math.floor(Y / TH + xr / TW);
              my = Math.floor(Y / TH - xr / TW);
              ox = ((mx - my + MH - 1) * TW) / 2;
              oy = ((mx + my) * TH) / 2;
            } else {
              mx = Math.floor(X / TW);
              my = Math.floor(Y / TH);
              ox = mx * TW;
              oy = my * TH;
            }
            if (mx < rx0 || my < ry0 || mx >= rx1 || my >= ry1) continue;
            const lx = X - ox, ly = Y - oy, k = my * MW + mx;
            for (const cells of gidLayers) {
              const i = texel(cells[k], lx, ly);
              if (i < 0) continue;
              const ta = td[i + 3] / 255;
              r = td[i] * ta + r * (1 - ta);
              g = td[i + 1] * ta + g * (1 - ta);
              b = td[i + 2] * ta + b * (1 - ta);
              a = ta + a * (1 - ta);
            }
          }
          acc[0] += r, acc[1] += g, acc[2] += b, acc[3] += a;
        }
      if (!acc[3]) continue;
      col[0] = acc[0] / acc[3], col[1] = acc[1] / acc[3], col[2] = acc[2] / acc[3], col[3] = acc[3] / (n * n);
      blendPixel(img, px, py, col);
    }
}

export const LABEL_MODES = ['zones', 'all', 'none'] as const;
export type LabelMode = (typeof LABEL_MODES)[number];

/** Which labels a preview draws: 'all' (zones and placeholder names, the default), 'zones', 'none'; true / false as all / none. */
export function labelMode(v: LabelMode | boolean | undefined): LabelMode {
  if (v === undefined || v === true) return 'all';
  if (v === false) return 'none';
  return v;
}

export const objectName = (o: MapObject) => o.name ?? o.assetRef ?? (o.spriteId !== undefined ? `sprite ${o.spriteId}` : o.id);

// ---------------------------------------------------------------------------------------------------- minimap

export interface MinimapOptions {
  /** Pixels per cell (default: as many as keep the longest side near 256, 1–8; a region near 512, 1–16). */
  cellPx?: number;
  /** Longest side in pixels: fewer pixels per cell, or cells per pixel (averaged) on a map bigger than this. */
  maxSize?: number;
  /** Only these cells [x0, y0, x1, y1) (see MapPreviewOptions.region). */
  region?: [number, number, number, number];
  /** Layers to draw, by name or type (default: every visible ground, decoration and objects layer; see MapPreviewOptions.layers). */
  layers?: string[];
  objects?: boolean;
  /** Zone outlines (default true, or when `layers` names a zones layer). */
  zones?: boolean;
  /** Blocked cells darkened red (default false; also on when `layers` names a collision layer), like the iso preview (FB-064). */
  collision?: boolean;
}

/**
 * A minimap in map coordinates (x right, y down, like `get_map`'s text picture): one block of `cellPx` pixels per
 * cell in the average colour of its ground (and decoration) tile, object footprints shaded with a dot on each
 * object, zones in their kind's colour, and blocked cells darkened red only with `collision` (or a collision layer
 * named in `layers`). With `maxSize` smaller than the map's side in
 * cells, `cellsPerPixel` cells are averaged into each pixel (`cellPx` is then 1 / cellsPerPixel).
 */
export function renderMinimap(doc: MapBody, tilesets: (PreviewTileset | null)[], o: MinimapOptions = {}): { image: RgbaImage; cellPx: number; cellsPerPixel: number; region?: [number, number, number, number] } {
  const reg = o.region ? clampRegion(doc, o.region) : null;
  const [rx0, ry0, rx1, ry1] = reg ?? [0, 0, doc.width, doc.height];
  const side = Math.max(rx1 - rx0, ry1 - ry0);
  let cp = Math.max(1, Math.min(32, Math.round(o.cellPx ?? (reg ? Math.max(1, Math.min(16, Math.floor(512 / side))) : Math.max(1, Math.min(8, Math.floor(256 / side)))))));
  const max = o.maxSize ? Math.max(16, Math.floor(o.maxSize)) : Infinity;
  cp = Math.max(1, Math.min(cp, Math.floor(max / side)));
  const shrink = side > max ? Math.ceil(side / max) : 1;
  const img = createImage((rx1 - rx0) * cp, (ry1 - ry0) * cp);
  const avg = new Map<number, Rgba | null>();
  const tileColour = (gid: number): Rgba | null => {
    if (avg.has(gid)) return avg.get(gid)!;
    let c: Rgba | null = null;
    const g = splitGid(gid);
    const ts = g ? tilesets[g.slot] : null;
    if (g && ts) {
      const tw = ts.body.tileWidth, th = tileImageHeight(ts.body);
      const sx = (g.id % ts.columns) * tw, sy = Math.floor(g.id / ts.columns) * th;
      let r = 0, gg = 0, b = 0, n = 0;
      for (let y = sy; y < Math.min(ts.atlas.height, sy + th); y++)
        for (let x = sx; x < Math.min(ts.atlas.width, sx + tw); x++) {
          const i = (y * ts.atlas.width + x) * 4;
          if (ts.atlas.data[i + 3] < 128) continue;
          r += ts.atlas.data[i], gg += ts.atlas.data[i + 1], b += ts.atlas.data[i + 2], n++;
        }
      if (n) c = [r / n, gg / n, b / n, 1];
    }
    avg.set(gid, c);
    return c;
  };
  const inside = (x: number, y: number) => x >= rx0 && y >= ry0 && x < rx1 && y < ry1;
  const cell = (x: number, y: number, c: Rgba) => {
    if (!inside(x, y)) return;
    for (let yy = (y - ry0) * cp; yy < (y - ry0 + 1) * cp; yy++) for (let xx = (x - rx0) * cp; xx < (x - rx0 + 1) * cp; xx++) blendPixel(img, xx, yy, c);
  };
  /** Map point → minimap pixel. */
  const at = (x: number, y: number): [number, number] => [(x - rx0) * cp, (y - ry0) * cp];
  const wanted = o.layers?.length ? o.layers : undefined;
  for (const l of doc.layers) {
    if (!layerWanted(l, wanted)) continue;
    if (l.type === 'ground') {
      const ts = tilesets[l.tileset ?? 0];
      const gids = ts ? resolveGround(doc, l, ts.body).gids : null;
      const base = baseTerrain(l);
      const kinds = new Map(ts?.body.terrains.map((t) => [t.id, t]) ?? []);
      for (let y = ry0; y < ry1; y++)
        for (let x = rx0; x < rx1; x++) {
          let c = gids ? tileColour(gids[y * doc.width + x]) : null;
          if (!c) {
            const t = kinds.get(cellTerrain(doc, l, x, y, base));
            if (t) c = hexToRgba(t.source.type === 'palette' ? (t.tint ?? t.source.color) : (t.tint ?? TERRAIN_COLORS[t.kind]));
          }
          if (c) cell(x, y, c);
        }
    } else if (l.type === 'decoration') {
      for (let y = ry0; y < ry1; y++)
        for (let x = rx0; x < rx1; x++) {
          const gid = l.cells[y * doc.width + x];
          const c = gid ? tileColour(gid) : null;
          if (c) cell(x, y, c);
        }
    }
  }
  const showCollision = o.collision === true || (o.collision !== false && doc.layers.some((l) => l.type === 'collision' && wanted?.some((w) => w === l.name || w === 'collision')));
  if (showCollision)
    for (const l of doc.layers)
      if (l.type === 'collision' && (o.collision === true || layerWanted(l, wanted))) for (let y = ry0; y < ry1; y++) for (let x = rx0; x < rx1; x++) if (l.cells[y * doc.width + x]) cell(x, y, [150, 20, 20, 0.55]);
  if (o.objects !== false)
    for (const l of doc.layers)
      if (l.type === 'objects' && layerWanted(l, wanted))
        for (const ob of l.objects) {
          if (reg && (ob.x < rx0 - 8 || ob.y < ry0 - 8 || ob.x > rx1 + 8 || ob.y > ry1 + 8)) continue;
          if (ob.footprint) {
            const [x0, y0, x1, y1] = objectRect(ob);
            for (let y = Math.max(0, Math.floor(y0)); y < Math.min(doc.height, Math.ceil(y1)); y++)
              for (let x = Math.max(0, Math.floor(x0)); x < Math.min(doc.width, Math.ceil(x1)); x++) cell(x, y, [30, 26, 22, 0.45]);
          }
          if (reg && !inside(Math.floor(ob.x), Math.floor(ob.y))) continue;
          const r = Math.max(1, Math.round(cp / 2));
          const [px, py] = at(ob.x, ob.y);
          const cx = Math.round(px - r / 2), cy = Math.round(py - r / 2);
          for (let y = cy; y < cy + r; y++) for (let x = cx; x < cx + r; x++) blendPixel(img, x, y, [255, 244, 214, 1]);
        }
  if (o.zones !== false)
    for (const l of doc.layers)
      if (l.type === 'zones' && (wanted ? layerWanted(l, wanted) || wanted.includes('zones') : l.visible !== false))
        for (const z of l.zones) {
          const col = hexToRgba(ZONE_COLORS[z.kind] ?? ZONE_COLORS.custom);
          const pts = (z.shape === 'rect' && z.points.length >= 2
            ? [[z.points[0][0], z.points[0][1]], [z.points[1][0], z.points[0][1]], [z.points[1][0], z.points[1][1]], [z.points[0][0], z.points[1][1]]]
            : z.points).map(([x, y]) => {
            const [px, py] = at(x, y);
            return [reg ? px : Math.min(img.width - 1, px), reg ? py : Math.min(img.height - 1, py)] as [number, number];
          });
          if (!pts.length) continue;
          if (z.shape === 'point' || pts.length === 1) {
            const r = Math.max(1, Math.round(cp / 2));
            for (let y = Math.round(pts[0][1] - r / 2); y < Math.round(pts[0][1] - r / 2) + r; y++) for (let x = Math.round(pts[0][0] - r / 2); x < Math.round(pts[0][0] - r / 2) + r; x++) blendPixel(img, x, y, col);
          } else strokePath(img, pts, col, 1, z.shape !== 'polyline');
          if (z.vehicle) drawVehicleMarkers(img, (zoneRoute(z) ?? z.points).map(([x, y]) => at(x, y)), col, Math.max(2, cp));
        }
  const out = shrink > 1 ? shrinkImage(img, shrink) : img;
  return { image: out, cellPx: shrink > 1 ? 1 / shrink : cp, cellsPerPixel: shrink, ...(reg ? { region: reg } : {}) };
}

/** An image made `f` times smaller, each pixel the alpha-weighted average of an f×f block. */
export function shrinkImage(img: RgbaImage, f: number): RgbaImage {
  const out = createImage(Math.max(1, Math.ceil(img.width / f)), Math.max(1, Math.ceil(img.height / f)));
  for (let y = 0; y < out.height; y++)
    for (let x = 0; x < out.width; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y * f; yy < Math.min(img.height, (y + 1) * f); yy++)
        for (let xx = x * f; xx < Math.min(img.width, (x + 1) * f); xx++) {
          const i = (yy * img.width + xx) * 4;
          const pa = img.data[i + 3];
          r += img.data[i] * pa, g += img.data[i + 1] * pa, b += img.data[i + 2] * pa, a += pa, n++;
        }
      if (!a) continue;
      const i = (y * out.width + x) * 4;
      out.data[i] = Math.round(r / a), out.data[i + 1] = Math.round(g / a), out.data[i + 2] = Math.round(b / a), out.data[i + 3] = Math.round(a / n);
    }
  return out;
}

// --------------------------------------------------------------------------------------------- zone vehicles

/** A zone's route as map points (a rect's corners, a polygon closed), or null for a point. */
export function zoneRoute(z: Pick<Zone, 'shape' | 'points'>): [number, number][] | null {
  const p = z.points;
  if (p.length < 2 || z.shape === 'point') return null;
  if (z.shape === 'rect') return [[p[0][0], p[0][1]], [p[1][0], p[0][1]], [p[1][0], p[1][1]], [p[0][0], p[1][1]], [p[0][0], p[0][1]]];
  return z.shape === 'polygon' ? [...p, p[0]] : p;
}

const ARROW_FACINGS = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'];

/**
 * Where a zone's vehicle starts and which way it faces: the route's first point, facing (a compass name, as the
 * grid's facings: SE = +x, SW = +y) along its first segment.
 */
export function vehicleStart(doc: Pick<MapBody, 'orientation'>, z: Pick<Zone, 'shape' | 'points'>): { x: number; y: number; facing: string } | null {
  const r = zoneRoute(z);
  if (!r) return null;
  const [a] = r;
  const b = r.find((q) => Math.hypot(q[0] - a[0], q[1] - a[1]) > 1e-6) ?? a;
  return { x: a[0], y: a[1], facing: nearestFacing(ARROW_FACINGS, gridFacingAngle(doc, b[0] - a[0], b[1] - a[1])) ?? 'SE' };
}

/** Arrowheads every `every` pixels along a path (output pixels), pointing the way it runs. */
export function drawRouteArrows(img: RgbaImage, pts: [number, number][], col: Rgba, size: number, every = 48) {
  let carry = every / 2;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-6) continue;
    const ux = (bx - ax) / len, uy = (by - ay) / len;
    let d = carry;
    for (; d < len; d += every) {
      const cx = ax + ux * d, cy = ay + uy * d;
      const tip: [number, number] = [cx + ux * size, cy + uy * size];
      const l: [number, number] = [cx - ux * size - uy * size * 0.8, cy - uy * size + ux * size * 0.8];
      const r: [number, number] = [cx - ux * size + uy * size * 0.8, cy - uy * size - ux * size * 0.8];
      fillPolygon(img, [tip, l, r], [col[0], col[1], col[2], 1]);
      strokePath(img, [tip, l, r], [10, 10, 10, 0.75], 1);
    }
    carry = d - len;
  }
}

/** The minimap's vehicle: a box on the route's start and arrows along it. */
function drawVehicleMarkers(img: RgbaImage, pts: [number, number][], col: Rgba, size: number) {
  drawRouteArrows(img, pts, col, Math.max(2, size * 0.6), Math.max(16, size * 6));
  const [x, y] = pts[0];
  const r = Math.max(2, Math.round(size));
  fillRect(img, x - r, y - r, 2 * r, 2 * r, [250, 250, 250, 1]);
  fillRect(img, x - r + 1, y - r + 1, 2 * r - 2, 2 * r - 2, [col[0], col[1], col[2], 1]);
}
