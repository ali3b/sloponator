/**
 * Pure RGBA compositing of frames onto the pages a layout chose, with no canvas: what the old generator did with
 * HTMLCanvasElement in apps/web/src/export/exporter.ts (opaqueBox, PageWriter.draw, extrude) on plain byte arrays.
 * The render bundle hands frames in as `FrameSource`s (read back with gl.readPixels or decoded from a cached strip);
 * this module measures them, places them and extrudes atlas edges. PNG encoding stays with whoever owns the pixels.
 */
import type { LayoutSettings, Page, Placement } from './layout.js';

/** A rendered frame: `width` × `height` RGBA8 pixels, rows top to bottom, non-premultiplied. */
export interface FrameSource {
  width: number;
  height: number;
  /** The pixels, 4 bytes per pixel, row-major from the top-left; length = width × height × 4. */
  pixels(): Uint8Array;
}

/** A page's pixels, the same layout as a FrameSource (and a FrameSource itself). */
export interface PageImage extends FrameSource {
  index: number;
  pixels(): Uint8Array;
}

export interface OpaqueBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A frame in memory. */
export function frameOf(width: number, height: number, pixels?: Uint8Array): FrameSource {
  const data = pixels ?? new Uint8Array(width * height * 4);
  if (data.length !== width * height * 4) throw new Error(`frame: ${data.length} bytes for ${width}×${height} RGBA (${width * height * 4} needed)`);
  return { width, height, pixels: () => data };
}

/** Opaque bounding box of a frame (alpha > 0), or null for a fully transparent frame. */
export function opaqueBox(frame: FrameSource): OpaqueBox | null {
  const { width, height } = frame;
  const data = frame.pixels();
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** The smallest box holding both (a layered export's body and parts share one trim). */
export function unionBox(a: OpaqueBox | null, b: OpaqueBox | null): OpaqueBox | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** Copy the `w` × `h` block of `src` at (sx, sy) to (dx, dy) of `dst`, clipped to both; no blending (frames never overlap). */
export function blit(dst: FrameSource, src: FrameSource, sx: number, sy: number, w: number, h: number, dx: number, dy: number): void {
  const d = dst.pixels(), s = src.pixels();
  for (let y = 0; y < h; y++) {
    const syy = sy + y, dyy = dy + y;
    if (syy < 0 || syy >= src.height || dyy < 0 || dyy >= dst.height) continue;
    const x0 = Math.max(0, -sx, -dx), x1 = Math.min(w, src.width - sx, dst.width - dx);
    if (x1 <= x0) continue;
    d.set(s.subarray((syy * src.width + sx + x0) * 4, (syy * src.width + sx + x1) * 4), (dyy * dst.width + dx + x0) * 4);
  }
}

/** Copy the placed rectangle's edge pixels outward by `e` px so filtering never samples a neighbour (texture bleeding). */
export function extrude(page: FrameSource, src: FrameSource, p: Placement, e: number): void {
  if (!e) return;
  const { trimX: sx, trimY: sy, w, h, x, y } = p;
  for (let i = 1; i <= e; i++) {
    blit(page, src, sx, sy, w, 1, x, y - i); // top
    blit(page, src, sx, sy + h - 1, w, 1, x, y + h + i - 1); // bottom
    blit(page, src, sx, sy, 1, h, x - i, y); // left
    blit(page, src, sx + w - 1, sy, 1, h, x + w + i - 1, y); // right
  }
  // Corners: the corner pixel repeated over the e × e square.
  const corner = (cx: number, cy: number, px: number, py: number) => {
    for (let j = 0; j < e; j++) for (let i = 0; i < e; i++) blit(page, src, cx, cy, 1, 1, px + i, py + j);
  };
  corner(sx, sy, x - e, y - e);
  corner(sx + w - 1, sy, x + w, y - e);
  corner(sx, sy + h - 1, x - e, y + h);
  corner(sx + w - 1, sy + h - 1, x + w, y + h);
}

/** Frames by their layout key (`frameKey(clip, direction, index)`); a missing or null frame leaves its place transparent. */
export type FrameLookup = (key: string) => FrameSource | null | undefined;

/** Put every placement of one page in its place: a transparent page of the layout's size with the frames drawn in. */
export function composePage(page: Page, frames: FrameLookup, layout: Pick<LayoutSettings, 'mode' | 'extrude'>): PageImage {
  const out = frameOf(page.width, page.height);
  for (const p of page.placements) {
    const src = frames(p.key);
    if (!src) continue;
    if (src.width !== p.sourceW || src.height !== p.sourceH) throw new Error(`frame ${p.key} is ${src.width}×${src.height}, the layout placed a ${p.sourceW}×${p.sourceH} frame`);
    blit(out, src, p.trimX, p.trimY, p.w, p.h, p.x, p.y);
    if (layout.mode === 'atlas') extrude(out, src, p, layout.extrude);
  }
  return { index: page.index, width: out.width, height: out.height, pixels: out.pixels };
}

/** Every page of a layout composed (pages no frame touched are plain transparent images). */
export function composePages(pages: Page[], frames: FrameLookup, layout: Pick<LayoutSettings, 'mode' | 'extrude'>): PageImage[] {
  return pages.map((p) => composePage(p, frames, layout));
}

/** The placed rectangle of one frame cut back out of a page into an untrimmed frame (the frame cache reads sheets back this way). */
export function extractFrame(page: FrameSource, p: Placement): FrameSource {
  const out = frameOf(p.sourceW, p.sourceH);
  blit(out, page, p.x, p.y, p.w, p.h, p.trimX, p.trimY);
  return out;
}
