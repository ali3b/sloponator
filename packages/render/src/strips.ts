/**
 * PNG strips ↔ frames on the Node side: a strip (one clip × direction's frames in `cols` columns) decoded with pngjs
 * into @slop/sprites `FrameSource`s, straight alpha in and out (no premultiply round trip, as the old
 * apps/web/src/export/frameCache.ts decodeStrip took care to avoid).
 */
import { PNG } from 'pngjs';
import { frameOf, type FrameSource } from '@slop/sprites';

/** Decode a PNG into an RGBA FrameSource. */
export function decodePng(bytes: Uint8Array): FrameSource {
  const png = PNG.sync.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  return frameOf(png.width, png.height, new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength));
}

/** Encode RGBA pixels as PNG (deterministic: same pixels, same bytes). */
export function encodePng(frame: FrameSource): Uint8Array {
  const png = new PNG({ width: frame.width, height: frame.height });
  png.data = Buffer.from(frame.pixels().buffer, frame.pixels().byteOffset, frame.width * frame.height * 4);
  return new Uint8Array(PNG.sync.write(png, { deflateLevel: 9, deflateStrategy: 3 }));
}

/** Frame `i` of a decoded strip. */
export function stripFrame(strip: FrameSource, i: number, w: number, h: number, cols: number): FrameSource {
  const out = frameOf(w, h);
  const sx = (i % cols) * w, sy = Math.floor(i / cols) * h;
  const d = out.pixels(), s = strip.pixels();
  for (let y = 0; y < h; y++) d.set(s.subarray(((sy + y) * strip.width + sx) * 4, ((sy + y) * strip.width + sx + w) * 4), y * w * 4);
  return out;
}

/** Every frame of a strip. */
export function stripFrames(bytes: Uint8Array, n: number, w: number, h: number, cols: number): FrameSource[] {
  const strip = decodePng(bytes);
  if (strip.width < cols * w || strip.height < Math.ceil(n / cols) * h) throw new Error(`frame strip is ${strip.width}×${strip.height}, too small for ${n} frames of ${w}×${h} in ${cols} columns`);
  return Array.from({ length: n }, (_, i) => stripFrame(strip, i, w, h, cols));
}
