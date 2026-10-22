// Moved from the old generator's packages/shared/src/tileset/raster.ts (ali3b/sloponator#17, #18).
/* eslint-disable @typescript-eslint/no-unused-expressions -- moved code keeps the old generator's comma expressions (a(), b()) unchanged */
import { lightGradeTable } from '@slop/sprites';
import { DEFAULT_NOISE_PERIOD, hasShore, isRaised, TERRAIN_COLORS, tileExtraHeight, type Terrain, type TerrainKind, type TilesetBody, type TilesetTile } from './types.js';
import { cornersKey, type Corners } from './ops.js';
import { atlasLayout } from './tiled.js';

/**
 * The ground tile renderer (pure TS, deterministic, no GPU): a tileset body → the atlas PNG's pixels, laid out
 * exactly like the Tiled writer says (tiles by id, `columns` per row).
 *
 * Geometry. Every tile picture is a function of ground coordinates (u, v) ∈ [0, 1)²: u runs along the map's x
 * axis, v along its y axis, so the corners top-left/top-right/bottom-right/bottom-left (Tiled's order) are
 * (0,0)/(1,0)/(1,1)/(0,1); on an iso diamond those are the top, right, bottom and left vertices. A pixel belongs to
 * the tile when its centre's (u, v) lies in the half-open square [0, 1)². The test is done in integers, and because
 * neighbouring tiles are shifted by exactly (W/2, H/2) pixels, a map of tiles covers every pixel exactly once:
 * no 1-px gaps and no double-drawn (double-blended) seam pixels, in Tiled, Phaser or any engine that places tiles
 * on whole pixels.
 *
 * Seams. A Wang tile can be placed anywhere its corners fit, so what a tile shows ON its edges may depend only on
 * the position along the edge and the edge's two corners: never on where the tile sits in the world or which
 * variant it is. So every field is split in two:
 *   - the edge part E is periodic with a period of ONE tile in u and v (world noise, and the texture remapped to a
 *     one-tile repeat, see below): tile-local (u, v) are world coordinates modulo 1, so the colour just inside one
 *     tile's edge continues into whatever tile lies across it;
 *   - the interior parts are multiplied by windows that are 0 on the edges: the random variant noise (window
 *     16·u(1−u)·v(1−v)) and the large-scale part L (bandWindow: 0 on the edges, 1 from BAND inwards).
 * Any two tiles therefore meet seamlessly, whatever variants a map engine picks.
 *
 * Periods (B3/B2 polish). One-tile noise repeats every tile, which shows as a scallop along long terrain borders,
 * and a texture squeezed into one tile loses its detail. The large-scale part L is periodic with `noisePeriod` P
 * tiles (default 4), and variant v of a corner combination is drawn for period cell (ox, oy) = (v mod P, ⌊v/P⌋ mod
 * P): its interior shows L at world (ox + u, oy + v). With P² variants and the variant picked by map position
 * (x mod P, y mod P; cellsFromCorners does this, the .tsj carries `noisePeriod` and each tile's `variant`), the
 * interiors join into noise that repeats only every P tiles; with fewer variants or a random pick, L is simply more
 * per-variant variety. Either way the edges are E only, so seams stay perfect.
 *
 * A texture with `scale` S tiles per repeat is sampled at S× the detail. Its edge part is the texture made
 * one-tile periodic by cross-fading the 2×2 tiles of texture at (u, v), (u+1, v), (u, v+1), (u+1, v+1) with
 * weights s(u), 1−s(u)…, where s rises from 0 to 1 across the tile's middle, so both edges show the texture at
 * world 1 (periodic). The middle, where that cross-fade would blur, is covered by the interior L = the texture at
 * (ox + u, oy + v), which joins up between neighbours placed by position when S divides P.
 *
 * Transitions. Each terrain's weight is a smoothstepped bilinear blend of the four corner indicators; along an edge
 * it depends only on that edge's two corners, which the neighbour shares. The weight is perturbed by world noise
 * (+ windowed variant noise) and thresholded softly, so the boundary is organic yet identical on both sides of an
 * edge. The perturbation is bounded (< 0.5 − softness) so a terrain absent from both corners of an edge never
 * shows on that edge, and a pure tile is exactly pure.
 *
 * Three or four terrains in a tile (FB-049) are layered in tileset order with weights relative to the layers below
 * (layerField), so on each edge the stack is exactly that edge's pair (or pure) tile; shores and cliffs build on the
 * same fields (see composite and the cliff faces), so mixed tiles meet pair tiles seamlessly.
 *
 * Shores (B4). A shore terrain (water by default) meeting one other terrain gets wet sand, a foam line, ripples and
 * shallow-to-deep water from bands of the overlay field (overlayField, before the soft threshold). The bands sit
 * strictly between the field's values on an all-land and an all-water edge, so edges match pure tiles (see SHORE).
 *
 * Cliffs (B4). A terrain with height 1 is raised one level. When a tileset has one, every tile picture is
 * W × (H + E) with E = cliffHeight and its ground diamond in the bottom H rows (Tiled draws taller tiles
 * bottom-aligned on the grid). Each cell is drawn as a prism: the raised part of its ground shifted up by E (the top
 * H rows), its vertical face (the raised part swept down by up to E pixels), and the ground part in place. Drawn
 * back to front (row by row, as Tiled and Phaser do), the prisms occlude each other exactly: a plateau's back and
 * side faces are hidden under its own top or the cells in front, so only the camera-facing cliffs show. The raised
 * mask is the layers' coverage ≥ 0.5, which on an edge depends only on that edge's corners, so tops, faces and the
 * ground meet seamlessly between tiles.
 */

export const TILE_RENDER_VERSION = 4;

/** An RGBA8 picture, row-major, 4 bytes per pixel. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export const createImage = (width: number, height: number): RgbaImage => ({ width, height, data: new Uint8Array(width * height * 4) });

type Geometry = Pick<TilesetBody, 'orientation' | 'tileWidth' | 'tileHeight'>;

// ------------------------------------------------------------------------------------------------- geometry

/**
 * Ground coordinates [u, v] of the centre of pixel (px, py) of a tile picture, or null when that pixel belongs to
 * a neighbouring tile (outside the diamond). Exact: the [0, 1) test is done on integers.
 */
export function tilePixelGround(g: Geometry, px: number, py: number): [number, number] | null {
  const W = g.tileWidth, H = g.tileHeight;
  if (g.orientation === 'isometric') {
    // u = y/H + x/W − 1/2 and v = y/H − x/W + 1/2 at the pixel centre (x, y) = (px + ½, py + ½), times 2WH.
    const D = 2 * W * H;
    const nu = (2 * py + 1) * W + (2 * px + 1) * H - W * H;
    const nv = (2 * py + 1) * W - (2 * px + 1) * H + W * H;
    return nu >= 0 && nu < D && nv >= 0 && nv < D ? [nu / D, nv / D] : null;
  }
  return px >= 0 && px < W && py >= 0 && py < H ? [(px + 0.5) / W, (py + 0.5) / H] : null;
}

/** Top-left pixel of map cell (mx, my) in a map picture of `rows` rows (iso maps shift right by (rows − 1)·W/2). */
export function cellOrigin(g: Geometry, mx: number, my: number, rows: number): [number, number] {
  if (g.orientation === 'isometric') return [((mx - my + rows - 1) * g.tileWidth) / 2, ((mx + my) * g.tileHeight) / 2];
  return [mx * g.tileWidth, my * g.tileHeight];
}

/** Size of a map picture of cols × rows cells. */
export function mapSize(g: Geometry, cols: number, rows: number): [number, number] {
  if (g.orientation === 'isometric') return [((cols + rows) * g.tileWidth) / 2, ((cols + rows) * g.tileHeight) / 2];
  return [cols * g.tileWidth, rows * g.tileHeight];
}

// ---------------------------------------------------------------------------------------------------- noise

/** A stable 32-bit seed from a string (FNV-1a). */
export function seedOf(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y + 0x3c6ef372, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const mod = (i: number, n: number) => ((i % n) + n) % n;

/** Value noise in [−1, 1] with `cells` lattice cells per tile, periodic with a period of 1 in u and v. */
export function periodicNoise(u: number, v: number, cells: number, seed: number): number {
  const x = u * cells, y = v * cells;
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = fade(x - ix), fy = fade(y - iy);
  const x0 = mod(ix, cells), x1 = mod(ix + 1, cells), y0 = mod(iy, cells), y1 = mod(iy + 1, cells);
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed), c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  const top = a + (b - a) * fx, bottom = c + (d - c) * fx;
  return (top + (bottom - top) * fy) * 2 - 1;
}

/** Fractal sum of periodic value noise (cells, 2·cells, …), normalised to [−1, 1]. Period 1 in u and v. */
export function periodicFbm(u: number, v: number, cells: number, octaves: number, seed: number): number {
  let sum = 0, amp = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * periodicNoise(u, v, cells << o, (seed + o * 7919) >>> 0);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

/** 1 in the middle of the tile, 0 on its edges: variant noise is multiplied by this so variants meet seamlessly. */
export const variantWindow = (u: number, v: number) => 16 * u * (1 - u) * v * (1 - v);

const smooth = (t: number) => t * t * (3 - 2 * t);
const smoothstep = (a: number, b: number, x: number) => (x <= a ? 0 : x >= b ? 1 : smooth((x - a) / (b - a)));

/** Width of the edge band (in tile units) over which the large-scale interior fades out. */
export const BAND = 0.3;
/** 0 on the tile's edges, 1 from BAND inwards (smoothstepped): the large-scale part L is multiplied by this. */
export const bandWindow = (u: number, v: number) => smoothstep(0, BAND, u) * smoothstep(0, BAND, 1 - u) * smoothstep(0, BAND, v) * smoothstep(0, BAND, 1 - v);

/** The period cell a variant is drawn for: (v mod P, floor(v / P) mod P). */
export function periodOffset(variant: number, period: number): [number, number] {
  const P = Math.max(1, Math.floor(period));
  return [variant % P, Math.floor(variant / P) % P];
}

/** Fractal noise over world coordinates (x, y) in tiles, periodic with `period` tiles; features about 2 tiles across. */
export function longFbm(x: number, y: number, period: number, octaves: number, seed: number): number {
  const P = Math.max(1, Math.floor(period));
  return periodicFbm(x / P, y / P, Math.max(1, Math.round(P / 2)), octaves, seed);
}

// ----------------------------------------------------------------------------------------------- transitions

/** Mask tuning: one-tile world noise, large-scale (period) noise, variant noise and edge softness (sum < 0.5 - soft). */
export const MASK = { world: 0.1, long: 0.16, variant: 0.13, soft: 0.07 } as const;

/** Weight (0–1) of the corners that are `terrain`, blended bilinearly over the tile with smoothstepped u, v. */
export function cornerWeight(corners: Corners, terrain: string, u: number, v: number): number {
  const su = smooth(u), sv = smooth(v);
  const [tl, tr, br, bl] = corners.map((c) => (c === terrain ? 1 : 0));
  return tl * (1 - su) * (1 - sv) + tr * su * (1 - sv) + br * su * sv + bl * (1 - su) * sv;
}

/**
 * The overlay field of `terrain` at ground point (u, v): the corner weight plus the bounded noise, which the soft
 * threshold at 0.5 turns into coverage (overlayAlpha). −∞ / +∞ where the weight is 0 / 1 (no noise there: a pure
 * tile is exactly pure). On the edges it depends only on (u, v) modulo 1 and the edge's two corners (the variant's
 * and the period's shares fade out there), so the shore bands built on it (B4) are seam-safe too.
 */
export function overlayField(corners: Corners, terrain: string, u: number, v: number, variant: number, period = DEFAULT_NOISE_PERIOD): number {
  return fieldOfWeight(cornerWeight(corners, terrain, u, v), terrain, u, v, variant, period);
}

/** The overlay field for a weight w of `terrain` (overlayField's noise added to it). */
function fieldOfWeight(w: number, terrain: string, u: number, v: number, variant: number, period: number): number {
  if (w <= 0) return -Infinity;
  if (w >= 1) return Infinity;
  const seed = seedOf(`mask:${terrain}`);
  const band = bandWindow(u, v);
  const [ox, oy] = periodOffset(variant, period);
  const n = MASK.world * periodicFbm(u, v, 2, 3, seed)
    + (band > 0 ? MASK.long * band * longFbm(ox + u, oy + v, period, 3, (seed + 7) >>> 0) : 0)
    + MASK.variant * variantWindow(u, v) * periodicFbm(u, v, 2, 3, (seed + 1013 * (variant + 1)) >>> 0);
  return w + n;
}

/**
 * How much of overlay `terrain` covers ground point (u, v) of a tile with these corners (0 = none, 1 = all).
 * On the edges it depends only on (u, v) modulo 1 and the corners (the variant's and the period's shares fade out
 * there), so two tiles that share an edge (and so its two corners) agree all along it.
 */
export function overlayAlpha(corners: Corners, terrain: string, u: number, v: number, variant: number, period = DEFAULT_NOISE_PERIOD): number {
  return alphaOfField(overlayField(corners, terrain, u, v, variant, period));
}

/** Coverage from an overlay field: the soft threshold at 0.5 (exactly 0 / 1 at −∞ / +∞). */
const alphaOfField = (s: number) => (s === -Infinity ? 0 : s === Infinity ? 1 : smoothstep(0.5 - MASK.soft, 0.5 + MASK.soft, s));

/**
 * Multi-terrain stacks (FB-049). A tile's terrains are layered bottom first in tileset order. With two layers the
 * overlay's field is its corner weight plus noise (overlayField). With three or four, layer l's weight is taken
 * relative to the layers up to it, w_l / (w_0 + … + w_l): on an edge, a terrain absent from both of its corners has
 * weight 0 there, so a lower absent layer doesn't change the relative weights of the two that are present, and an
 * upper absent layer has field −∞. The stack therefore reduces, on every edge, to exactly the two-terrain (or pure)
 * tile of that edge's corners: the seam rule "an edge's pixels depend only on its two corners" holds for any 4-corner
 * mix. The top layer of the full stack keeps its absolute weight (the sum is 1), so two-layer tiles are unchanged.
 * `full` = `layers` are all of the tile's terrains (cliff tiles composite subsets: the raised or the ground ones).
 */
export function layerField(corners: Corners, layers: readonly string[], l: number, full: boolean, u: number, v: number, variant: number, period = DEFAULT_NOISE_PERIOD): number {
  const t = layers[l];
  if (full && l === layers.length - 1) return overlayField(corners, t, u, v, variant, period);
  const w = cornerWeight(corners, t, u, v);
  if (w <= 0) return -Infinity;
  let s = w;
  for (let k = 0; k < l; k++) s += cornerWeight(corners, layers[k], u, v);
  return fieldOfWeight(w / s, t, u, v, variant, period);
}

/** Coverage of layer l of a stack (layerField through the soft threshold). */
export const layerAlpha = (corners: Corners, layers: readonly string[], l: number, full: boolean, u: number, v: number, variant: number, period = DEFAULT_NOISE_PERIOD) =>
  alphaOfField(layerField(corners, layers, l, full, u, v, variant, period));

// --------------------------------------------------------------------------------------------- terrain paint

type Rgb = [number, number, number];

export const hexRgb = (hex: string): Rgb => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Default palette noise per kind (a terrain's own `source.noise` wins). */
const KIND_NOISE: Record<TerrainKind, number> = { grass: 0.55, dirt: 0.5, sand: 0.4, mud: 0.45, road: 0.3, water: 0.3, snow: 0.3, jungle: 0.6, rock: 0.5, custom: 0.45 };
/** Noise on top of a texture (variants and large-scale patches; the texture brings the detail). */
const TEXTURE_NOISE = 0.25;

interface Paint {
  /** Colour at ground point (u, v) for a variant, RGB 0–255 floats. */
  sample(u: number, v: number, variant: number, out: Rgb): void;
}

/** A texture box-filtered down to R×R texels (one repeat per tile), tinted, sampled bilinearly with wrap. */
function textureGrid(img: RgbaImage, R: number, tint?: string): Float32Array {
  const grid = new Float32Array(R * R * 3);
  const { width: W, height: H, data } = img;
  for (let ty = 0; ty < R; ty++) {
    const y0 = Math.floor((ty * H) / R), y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * H) / R));
    for (let tx = 0; tx < R; tx++) {
      const x0 = Math.floor((tx * W) / R), x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * W) / R));
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = (y * W + x) * 4;
          r += data[i], g += data[i + 1], b += data[i + 2], n++;
        }
      const o = (ty * R + tx) * 3;
      grid[o] = r / n, grid[o + 1] = g / n, grid[o + 2] = b / n;
    }
  }
  if (tint) {
    // Keep the texture's light and dark (its luminance relative to the mean), take the colour from the tint.
    let mean = 0;
    for (let i = 0; i < grid.length; i += 3) mean += luma(grid[i], grid[i + 1], grid[i + 2]);
    mean = Math.max(1, mean / (R * R));
    const t = hexRgb(tint);
    for (let i = 0; i < grid.length; i += 3) {
      const k = luma(grid[i], grid[i + 1], grid[i + 2]) / mean;
      grid[i] = t[0] * k, grid[i + 1] = t[1] * k, grid[i + 2] = t[2] * k;
    }
  }
  return grid;
}

function makePaint(t: Terrain, g: Geometry & { metresPerTile?: number }, texture: RgbaImage | undefined, period: number): Paint {
  const seed = seedOf(`paint:${t.id}:${t.kind}`);
  const low = (u: number, v: number) => periodicFbm(u, v, 2, 2, seed);
  const grain = (u: number, v: number) => periodicFbm(u, v, 8, 3, (seed + 1) >>> 0);
  const warmth = (u: number, v: number) => periodicFbm(u, v, 2, 2, (seed + 2) >>> 0);
  const vary = (u: number, v: number, variant: number) => variantWindow(u, v) * periodicFbm(u, v, 3, 2, (seed + 101 * (variant + 1)) >>> 0);
  /** The large-scale part at world (x, y) (tiles), periodic with the noise period; the caller windows it. */
  const big = (x: number, y: number, s: number) => longFbm(x, y, period, 2, (seed + s) >>> 0);

  if (t.source.type === 'texture' && texture) {
    const R = Math.max(4, Math.round(g.orientation === 'isometric' ? g.tileWidth * 0.75 : g.tileWidth));
    // Tiles per texture repeat (validated to a whole number; 1 = the texture squeezed into one tile).
    const S = Math.max(1, Math.min(16, Math.round((t.source.scale ?? g.metresPerTile ?? 1) / (g.metresPerTile ?? 1))));
    const RS = R * S;
    const grid = textureGrid(texture, RS, t.tint);
    const k = TEXTURE_NOISE;
    /** Texture colour at world (x, y) in tiles (R texels per tile, wrapping every S tiles), bilinear. */
    const tex = (x: number, y: number, out: Rgb, w: number) => {
      const X = x * R - 0.5, Y = y * R - 0.5;
      const ix = Math.floor(X), iy = Math.floor(Y), fx = X - ix, fy = Y - iy;
      const x0 = mod(ix, RS), x1 = mod(ix + 1, RS), y0 = mod(iy, RS), y1 = mod(iy + 1, RS);
      for (let c = 0; c < 3; c++) {
        const a = grid[(y0 * RS + x0) * 3 + c], b = grid[(y0 * RS + x1) * 3 + c], d = grid[(y1 * RS + x0) * 3 + c], e = grid[(y1 * RS + x1) * 3 + c];
        out[c] += w * (a + (b - a) * fx + (d - a + (a - b - d + e) * fx) * fy);
      }
    };
    const edge: Rgb = [0, 0, 0], inner: Rgb = [0, 0, 0];
    return {
      sample(u, v, variant, out) {
        const band = bandWindow(u, v);
        const [ox, oy] = periodOffset(variant, period);
        if (S === 1) {
          out[0] = out[1] = out[2] = 0;
          tex(u, v, out, 1);
        } else {
          // E: one-tile periodic cross-fade of the 2×2 texture tiles (at u = 0 and u = 1 both show world 1).
          edge[0] = edge[1] = edge[2] = 0;
          const su = smoothstep(BAND, 1 - BAND, u), sv = smoothstep(BAND, 1 - BAND, v);
          if (su * sv > 0) tex(u, v, edge, su * sv);
          if ((1 - su) * sv > 0) tex(u + 1, v, edge, (1 - su) * sv);
          if (su * (1 - sv) > 0) tex(u, v + 1, edge, su * (1 - sv));
          if ((1 - su) * (1 - sv) > 0) tex(u + 1, v + 1, edge, (1 - su) * (1 - sv));
          // L: the texture at this variant's place in the period, over the middle of the tile.
          inner[0] = inner[1] = inner[2] = 0;
          if (band > 0) tex(ox + u, oy + v, inner, 1);
          for (let c = 0; c < 3; c++) out[c] = edge[c] + band * (inner[c] - edge[c]);
        }
        const f = 1 + k * (0.12 * low(u, v) + (band > 0 ? 0.14 * band * big(ox + u, oy + v, 5) : 0) + 0.16 * vary(u, v, variant));
        out[0] *= f, out[1] *= f, out[2] *= f;
      },
    };
  }

  // A palette colour (or a texture we could not load: its tint, its average colour, else the kind's colour) broken up with noise.
  const hex = t.source.type === 'palette' ? (t.tint ?? t.source.color) : (t.tint ?? t.source.color ?? TERRAIN_COLORS[t.kind]);
  const base = hexRgb(hex);
  const k = t.source.type === 'palette' && t.source.noise !== undefined ? t.source.noise : KIND_NOISE[t.kind];
  return {
    sample(u, v, variant, out) {
      const band = bandWindow(u, v);
      const [ox, oy] = periodOffset(variant, period);
      const L = band > 0 ? band * big(ox + u, oy + v, 5) : 0;
      const LW = band > 0 ? band * big(ox + u, oy + v, 9) : 0;
      const f = 1 + k * (0.05 * low(u, v) + 0.12 * L + 0.12 * grain(u, v) + 0.22 * vary(u, v, variant));
      const w = k * 14 * (0.3 * warmth(u, v) + 0.6 * LW + 0.6 * variantWindow(u, v) * periodicFbm(u, v, 2, 2, (seed + 211 * (variant + 1)) >>> 0));
      out[0] = base[0] * f + w, out[1] = base[1] * f + w * 0.4, out[2] = base[2] * f - w;
    },
  };
}

// ---------------------------------------------------------------------------------------------------- render

export interface TileRenderOptions {
  /** Decoded texture per terrain id, for terrains with a texture source (missing → a palette fallback + warning). */
  textures?: Record<string, RgbaImage | undefined>;
  /** Atlas tiles per row (default: the Tiled writer's default, 8). */
  columns?: number;
}

/** Prepared paints for a tileset (decoding/filtering textures once). */
export interface TileRenderer {
  body: TilesetBody;
  warnings: string[];
  /** Pixels above the diamond in every tile picture (the cliff height when a terrain is raised, else 0). */
  extra: number;
  /**
   * Draw one tile picture (tileWidth × (tileHeight + extra)) with its top-left at (ox, oy) of `img`; the ground
   * diamond is its bottom tileHeight rows. Pixels outside the picture's shape are left alone.
   */
  drawTile(tile: Pick<TilesetTile, 'terrainCorners' | 'variant'>, img: RgbaImage, ox: number, oy: number): void;
  /** The flat ground colour (no cliff geometry) of a tile with these corners at ground point (u, v), RGB 0–255 floats. */
  groundColor(corners: Corners, u: number, v: number, variant?: number): [number, number, number];
}

/**
 * Shore (B4). For a tile of a shore terrain (water) and one other terrain, `ws` is the water side's overlay field
 * (the water's own field, or 1 − the land's when the water is the base layer): 0.5 on the shore line, ≥ 1 − MASK.world
 * on an all-water edge and ≤ MASK.world on an all-land edge (|noise| ≤ MASK.world there). Every band below lives
 * strictly between those values, so on any edge the colours match a pure tile's and the seams stay exact:
 *   - land side, ws 0.2 → 0.5: wet sand (darker, sandier);
 *   - a foam line on ws ≈ 0.5 and static ripple lines over the shallows;
 *   - water side, ws 0.5 → 0.85: shallow (lighter, greener) to deep; a pure water tile is all deep.
 */
export const SHORE = { wet: 0.2, deep: 0.85, foam: 0.045 } as const;
const SHALLOW_F = 1.12, DEEP_F = 0.86;
const FOAM: Rgb = [232, 240, 236];
const WET_SAND: Rgb = [150, 128, 92];

/** The rock colour a cliff face leans toward (mixed with the raised terrain's colour). */
const ROCK: Rgb = [118, 104, 88];

function terrainRgb(t: Terrain): Rgb {
  return hexRgb(t.source.type === 'palette' ? (t.tint ?? t.source.color) : (t.tint ?? t.source.color ?? TERRAIN_COLORS[t.kind]));
}

export function tileRenderer(b: TilesetBody, o: TileRenderOptions = {}): TileRenderer {
  const warnings: string[] = [];
  const order = new Map(b.terrains.map((t, i) => [t.id, i]));
  const byId = new Map(b.terrains.map((t) => [t.id, t]));
  const paints = new Map<string, Paint>();
  const period = b.noisePeriod ?? DEFAULT_NOISE_PERIOD;
  for (const t of b.terrains) {
    const tex = o.textures?.[t.id];
    if (t.source.type === 'texture' && !tex) warnings.push(`terrain "${t.id}": texture ${t.source.path ?? `asset ${t.source.assetId}`} not loaded; drawn as ${t.tint ?? t.source.color ?? TERRAIN_COLORS[t.kind]} with noise`);
    paints.set(t.id, makePaint(t, b, tex, period));
  }
  const W = b.tileWidth, H = b.tileHeight;
  const E = tileExtraHeight(b);
  const shore = (id: string) => hasShore(byId.get(id));
  const raised = (id: string) => isRaised(byId.get(id));
  const col: Rgb = [0, 0, 0], over: Rgb = [0, 0, 0];

  const fields = new Float64Array(4);

  /**
   * The ground colour at (u, v) from `layers` only (bottom first; `full` when they are all the tile's terrains, see
   * layerField): the base paint, each overlay blended over it by its alpha, with the shore treatment when a layer
   * is a shore terrain.
   *
   * Shores with three or four terrains: the water side's field `ws` is built up the stack, starting at +∞ (water
   * base) or −∞ (land base); a water layer raises it to its field (max), a land layer lowers it to 1 − its field
   * (min). With two layers that is exactly the pair's (the water overlay's field, or 1 − the land overlay's); on any
   * edge of a bigger stack the absent layers have fields ∓∞ and leave it alone, so the bands (wet sand on the land
   * side, foam, shallows) match the edge's pair tile. Two shore terrains next to each other are both deep water.
   */
  function composite(corners: Corners, layers: string[], full: boolean, u: number, v: number, variant: number, out: Rgb) {
    paints.get(layers[0])!.sample(u, v, variant, out);
    let anyShore = shore(layers[0]);
    for (let l = 1; l < layers.length; l++) anyShore ||= shore(layers[l]);
    let ws = anyShore && !shore(layers[0]) ? -Infinity : Infinity;
    for (let l = 1; l < layers.length; l++) {
      const f = (fields[l] = layerField(corners, layers, l, full, u, v, variant, period));
      if (anyShore) ws = shore(layers[l]) ? Math.max(ws, f) : Math.min(ws, 1 - f);
    }
    const waterShade = (c: Rgb) => {
      const depth = smoothstep(0.5, SHORE.deep, ws);
      const f = SHALLOW_F + (DEEP_F - SHALLOW_F) * depth;
      c[0] *= f, c[1] = c[1] * f + 10 * (1 - depth), c[2] = c[2] * f + 6 * (1 - depth);
      if (ws > 0.53 && ws < 0.8) {
        // Static ripple lines following the shore, fading out toward the deep water.
        const r = Math.cos(ws * Math.PI * 2 * 7);
        if (r > 0.86) {
          const k = ((r - 0.86) / 0.14) * 0.35 * (1 - depth);
          for (let i = 0; i < 3; i++) c[i] += (FOAM[i] - c[i]) * k;
        }
      }
    };
    const landShade = (c: Rgb) => {
      const wet = smoothstep(SHORE.wet, 0.5, ws);
      if (wet <= 0) return;
      for (let i = 0; i < 3; i++) c[i] += (c[i] * 0.55 + WET_SAND[i] * 0.45 - c[i]) * wet;
    };
    if (anyShore) (shore(layers[0]) ? waterShade : landShade)(out);
    for (let l = 1; l < layers.length; l++) {
      const a = alphaOfField(fields[l]);
      if (a <= 0) continue;
      paints.get(layers[l])!.sample(u, v, variant, over);
      if (anyShore) (shore(layers[l]) ? waterShade : landShade)(over);
      // A slightly darker rim where two terrains meet (continuous, so it matches across edges too).
      const rim = 1 - 0.14 * 4 * a * (1 - a);
      for (let c = 0; c < 3; c++) out[c] = (out[c] + (over[c] - out[c]) * a) * rim;
    }
    if (anyShore && ws < Infinity) {
      // The foam line on the shore.
      const d = Math.abs(ws - 0.5);
      if (d < SHORE.foam) {
        const k = 0.75 * (1 - d / SHORE.foam);
        for (let i = 0; i < 3; i++) out[i] += (FOAM[i] - out[i]) * k;
      }
    }
  }

  /** Raised coverage (0–1) at (u, v): the layers composited as 1 (raised) / 0 (ground), with the overlays' alphas. */
  function raisedAt(corners: Corners, layers: string[], u: number, v: number, variant: number) {
    let c = raised(layers[0]) ? 1 : 0;
    for (let l = 1; l < layers.length; l++) {
      const a = layerAlpha(corners, layers, l, true, u, v, variant, period);
      if (a > 0) c += ((raised(layers[l]) ? 1 : 0) - c) * a;
    }
    return c;
  }

  // Lighting (FB-060): every pixel graded by the tileset's light (null by day: pixels untouched).
  const grade = lightGradeTable(b.light);
  const put = (img: RgbaImage, x: number, y: number, c: Rgb) => {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
    const i = (y * img.width + x) * 4;
    const r = Math.max(0, Math.min(255, Math.round(c[0]))), g = Math.max(0, Math.min(255, Math.round(c[1]))), bl = Math.max(0, Math.min(255, Math.round(c[2])));
    img.data[i] = grade ? grade[r] : r;
    img.data[i + 1] = grade ? grade[256 + g] : g;
    img.data[i + 2] = grade ? grade[512 + bl] : bl;
    img.data[i + 3] = 255;
  };

  return {
    body: b,
    warnings,
    extra: E,
    groundColor(corners, u, v, variant = 0) {
      const layers = [...new Set(corners)].sort((x, y) => (order.get(x) ?? 0) - (order.get(y) ?? 0));
      const c: Rgb = [0, 0, 0];
      composite(corners, layers, true, u, v, variant, c);
      if (grade) for (let i = 0; i < 3; i++) c[i] = grade[i * 256 + Math.max(0, Math.min(255, Math.round(c[i])))];
      return c;
    },
    drawTile(tile, img, ox, oy) {
      const corners = tile.terrainCorners;
      if (!corners) return;
      const layers = [...new Set(corners)].sort((x, y) => (order.get(x) ?? 0) - (order.get(y) ?? 0));
      const variant = tile.variant ?? 0;
      const high = layers.filter(raised), low = layers.filter((l) => !raised(l));
      if (!E || !high.length) {
        // Flat ground: the diamond in the bottom H rows.
        for (let py = 0; py < H; py++)
          for (let px = 0; px < W; px++) {
            const gr = tilePixelGround(b, px, py);
            if (!gr) continue;
            composite(corners, layers, true, gr[0], gr[1], variant, col);
            put(img, ox + px, oy + E + py, col);
          }
        return;
      }
      // Cliffs: which diamond pixels are raised; then per picture pixel the raised top (the diamond drawn E
      // higher), else the face hanging below a raised top pixel within E above it, else the low ground in place.
      const hi = new Uint8Array(W * H);
      const ground: ([number, number] | null)[] = new Array(W * H).fill(null);
      for (let q = 0; q < H; q++)
        for (let px = 0; px < W; px++) {
          const gr = tilePixelGround(b, px, q);
          if (!gr) continue;
          ground[q * W + px] = gr;
          hi[q * W + px] = !low.length || raisedAt(corners, layers, gr[0], gr[1], variant) >= 0.5 ? 1 : 0;
        }
      const faceBases = high.map((h) => terrainRgb(byId.get(h)!).map((c, i) => c * 0.45 + ROCK[i] * 0.55) as Rgb);
      const seeds = high.map((h) => seedOf(`cliff:${h}`));
      const faceBase: Rgb = [...faceBases[0]];
      let seed = seeds[0];
      /**
       * Two raised terrains in one tile: the face below top point (u, v) takes the raised layers' colours blended by
       * their (relative) coverage there and the strata of the one on top, so on an edge it is that edge's pair's face.
       */
      const faceAt = (u: number, v: number) => {
        if (high.length < 2) return;
        faceBase[0] = faceBases[0][0], faceBase[1] = faceBases[0][1], faceBase[2] = faceBases[0][2];
        seed = seeds[0];
        for (let l = 1; l < high.length; l++) {
          const a = layerAlpha(corners, high, l, false, u, v, variant, period);
          if (a <= 0) continue;
          for (let c = 0; c < 3; c++) faceBase[c] += (faceBases[l][c] - faceBase[c]) * a;
          if (a >= 0.5) seed = seeds[l];
        }
      };
      for (let py = 0; py < H + E; py++)
        for (let px = 0; px < W; px++) {
          // The raised top.
          if (py < H && hi[py * W + px]) {
            const [u, v] = ground[py * W + px]!;
            composite(corners, high, !low.length, u, v, variant, col);
            // A light lip along the rim: the ground one pixel lower on screen (+1/H in u and v) is not raised. Past
            // the diamond that point is clamped onto the edge, where the coverage is the neighbour's too.
            if (low.length) {
              const du = Math.min(0.9999, u + 1 / H), dv = Math.min(0.9999, v + 1 / H);
              if (raisedAt(corners, layers, du, dv, variant) < 0.5) for (let c = 0; c < 3; c++) col[c] = col[c] * 1.12 + 6;
            }
            put(img, ox + px, oy + py, col);
            continue;
          }
          // The face: the nearest raised top pixel above, within E.
          let d = 1;
          for (; d <= E; d++) {
            const q = py - d;
            if (q < 0) {
              d = E + 1;
              break;
            }
            if (q < H && hi[q * W + px]) break;
          }
          if (d <= E) {
            const [u, v] = ground[(py - d) * W + px]!;
            faceAt(u, v);
            // Which way the face looks: away from the raised side (the gradient of the raised coverage). Light comes
            // from the left, so faces looking down-left (+v) are lit and down-right (+u) ones shaded.
            const e = 0.03;
            let gu = raisedAt(corners, layers, Math.min(0.9999, u + e), v, variant) - raisedAt(corners, layers, Math.max(0, u - e), v, variant);
            let gv = raisedAt(corners, layers, u, Math.min(0.9999, v + e), variant) - raisedAt(corners, layers, u, Math.max(0, v - e), variant);
            if (Math.abs(gu) + Math.abs(gv) < 1e-6) (gu = u > v ? -1 : 0), (gv = v >= u ? -1 : 0);
            const len = Math.hypot(gu, gv);
            const lit = (gu - gv) / len;
            const t = d / E;
            const strata = 0.09 * periodicFbm(u + v, t * 0.5, 4, 2, seed) + (Math.floor(d / 3 + 0.6 * periodicFbm(u, v, 3, 1, seed + 1)) % 2 ? 0.05 : 0);
            const f = (0.8 + 0.18 * lit) * (1 - strata) * (t > 0.85 ? 0.8 : 1) * (d === 1 ? 0.85 : 1);
            col[0] = faceBase[0] * f, col[1] = faceBase[1] * f, col[2] = faceBase[2] * f;
            put(img, ox + px, oy + py, col);
            continue;
          }
          // The ground in place (low terrains only; a raised pixel there is always covered by its own face).
          const q = py - E;
          if (q < 0 || !ground[q * W + px] || hi[q * W + px]) continue;
          const [u, v] = ground[q * W + px]!;
          composite(corners, low, false, u, v, variant, col);
          // Shadow at the foot of the cliff just behind.
          let shade = 1;
          for (let k = 1; k <= 3 && q - k >= 0; k++)
            if (hi[(q - k) * W + px]) {
              shade = 0.8 + 0.05 * k;
              break;
            }
          col[0] *= shade, col[1] *= shade, col[2] *= shade;
          put(img, ox + px, oy + py, col);
        }
    },
  };
}

/**
 * The atlas: every tile with corners drawn at its id's slot (id % columns, id / columns), the same layout the
 * Tiled writer records (tile pictures tileImageHeight tall). Tiles without corners stay transparent.
 */
export function renderTilesetAtlas(b: TilesetBody, o: TileRenderOptions = {}): { image: RgbaImage; columns: number; warnings: string[] } {
  const l = atlasLayout(b, { columns: o.columns });
  const image = createImage(l.imagewidth, l.imageheight);
  const r = tileRenderer(b, o);
  for (const t of b.tiles) r.drawTile(t, image, (t.id % l.columns) * b.tileWidth, Math.floor(t.id / l.columns) * l.tileheight);
  return { image, columns: l.columns, warnings: r.warnings };
}

/**
 * Whether ground point (u, v) of a tile is raised (height 1): what the raised top covers there. Maps use it to
 * draw objects on a plateau cliffHeight higher.
 */
export function raisedAtPoint(b: Pick<TilesetBody, 'terrains'> & { noisePeriod?: number }, tile: Pick<TilesetTile, 'terrainCorners' | 'variant'>, u: number, v: number): boolean {
  const corners = tile.terrainCorners;
  if (!corners) return false;
  const byId = new Map(b.terrains.map((t) => [t.id, t]));
  const order = new Map(b.terrains.map((t, i) => [t.id, i]));
  const layers = [...new Set(corners)].sort((x, y) => (order.get(x) ?? 0) - (order.get(y) ?? 0));
  if (!layers.some((l) => isRaised(byId.get(l)))) return false;
  if (layers.every((l) => isRaised(byId.get(l)))) return true;
  let c = isRaised(byId.get(layers[0])) ? 1 : 0;
  for (let l = 1; l < layers.length; l++) {
    const a = layerAlpha(corners, layers, l, true, u, v, tile.variant ?? 0, b.noisePeriod ?? DEFAULT_NOISE_PERIOD);
    if (a > 0) c += ((isRaised(byId.get(layers[l])) ? 1 : 0) - c) * a;
  }
  return c >= 0.5;
}

/** Whether a corner combination mixes raised and ground terrains (a cliff tile). */
export function isCliffCorners(terrains: Pick<Terrain, 'id' | 'height'>[], corners: readonly string[]): boolean {
  let up = false, down = false;
  for (const c of corners) {
    if (!c) continue;
    if (isRaised(terrains.find((t) => t.id === c))) up = true;
    else down = true;
  }
  return up && down;
}

// ------------------------------------------------------------------------------------------------------ maps

/** Tile ids by corner combination (variants in id order), to build maps from corner terrains. */
export function tilesByCorners(b: Pick<TilesetBody, 'tiles'>): Map<string, number[]> {
  const m = new Map<string, number[]>();
  for (const t of [...b.tiles].sort((x, y) => x.variant - y.variant || x.id - y.id))
    if (t.terrainCorners) m.set(cornersKey(t.terrainCorners), [...(m.get(cornersKey(t.terrainCorners)) ?? []), t.id]);
  return m;
}

/**
 * Map cells from a (rows + 1) × (cols + 1) grid of corner terrains: cell (mx, my) takes the tile whose corners are
 * [tl, tr, br, bl] of its vertices, the variant chosen by `pick`. Default: when the combination has a variant for
 * every period cell (P² of them), the one drawn for (mx mod P, my mod P), so the large-scale noise joins up across
 * cells; else a hash of the cell. null = no such tile.
 */
export function cellsFromCorners(b: Pick<TilesetBody, 'tiles'> & { noisePeriod?: number }, vertices: string[][], pick?: (mx: number, my: number, n: number) => number): (number | null)[][] {
  const tileAt = cornerTilePicker(b, pick);
  const rows = vertices.length - 1, cols = vertices[0].length - 1;
  return Array.from({ length: rows }, (_, my) =>
    Array.from({ length: cols }, (_, mx) => tileAt([vertices[my][mx], vertices[my][mx + 1], vertices[my + 1][mx + 1], vertices[my + 1][mx]], mx, my)),
  );
}

/** The tile `cellsFromCorners` picks for one cell: its corners [tl, tr, br, bl] at (mx, my) → tile id, null = none. */
export function cornerTilePicker(b: Pick<TilesetBody, 'tiles'> & { noisePeriod?: number }, pick?: (mx: number, my: number, n: number) => number): (corners: Corners, mx: number, my: number) => number | null {
  const byCorners = tilesByCorners(b);
  const variantOf = new Map(b.tiles.map((t) => [t.id, t.variant]));
  const P = b.noisePeriod ?? DEFAULT_NOISE_PERIOD;
  return (corners, mx, my) => {
    const ids = byCorners.get(cornersKey(corners));
    if (!ids?.length) return null;
    if (pick) return ids[pick(mx, my, ids.length) % ids.length];
    if (P > 1 && ids.length >= P * P) {
      const want = (mx % P) + P * (my % P);
      const hit = ids.find((id) => variantOf.get(id) === want);
      if (hit !== undefined) return hit;
    }
    return ids[Math.floor(hash2(mx, my, 77) * ids.length) % ids.length];
  };
}

/**
 * Compose a map picture from atlas tiles the way Tiled draws an iso (or orthogonal) layer: cell (mx, my)'s tile
 * picture with its ground diamond at cellOrigin, cells drawn row by row (back to front), so a tile taller than the
 * grid (a cliff, B4) overlaps the cells behind it. The picture has `top` extra rows above the ground's (the tile
 * pictures' extra height): native map pixel (x, y) is image pixel (x, y + top). `overlaps` counts ground pixels
 * (the diamonds' own) drawn by more than one tile: 0 when tiles are exact.
 */
export function composeMap(b: TilesetBody, atlas: RgbaImage, cells: (number | null)[][], columns?: number): { image: RgbaImage; overlaps: number; top: number } {
  const l = atlasLayout(b, { columns });
  const E = l.tileheight - b.tileHeight;
  const rows = cells.length, cols = cells[0]?.length ?? 0;
  const [w, h] = mapSize(b, cols, rows);
  const image = createImage(w, h + E);
  const ground = new Uint8Array(w * (h + E));
  let overlaps = 0;
  for (let my = 0; my < rows; my++)
    for (let mx = 0; mx < cols; mx++) {
      const id = cells[my][mx];
      if (id === null || id === undefined) continue;
      const [ox, oy] = cellOrigin(b, mx, my, rows);
      const sx = (id % l.columns) * b.tileWidth, sy = Math.floor(id / l.columns) * l.tileheight;
      for (let y = 0; y < l.tileheight; y++)
        for (let x = 0; x < b.tileWidth; x++) {
          const si = ((sy + y) * atlas.width + sx + x) * 4;
          if (!atlas.data[si + 3]) continue;
          const k = (oy + y) * w + ox + x;
          if (y >= E && tilePixelGround(b, x, y - E)) {
            if (ground[k]) overlaps++;
            ground[k] = 1;
          }
          image.data.set(atlas.data.subarray(si, si + 4), k * 4);
        }
    }
  return { image, overlaps, top: E };
}
