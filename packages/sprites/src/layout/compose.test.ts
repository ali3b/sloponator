import { describe, expect, it } from 'vitest';
import { layoutFrames, type FrameInput, type LayoutSettings } from './layout.js';
import { composePage, composePages, extractFrame, extrude, frameOf, opaqueBox, unionBox, type FrameSource } from './compose.js';

/** A w × h frame with one opaque rectangle of colour `rgb`. */
function frame(w: number, h: number, box: { x: number; y: number; w: number; h: number } | null, rgb = [255, 0, 0]): FrameSource {
  const f = frameOf(w, h);
  const d = f.pixels();
  if (box) for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) d.set([...rgb, 255], (y * w + x) * 4);
  return f;
}
const px = (f: FrameSource, x: number, y: number) => Array.from(f.pixels().subarray((y * f.width + x) * 4, (y * f.width + x) * 4 + 4));

describe('opaque boxes', () => {
  it('measures the alpha bounds, null for an empty frame', () => {
    expect(opaqueBox(frame(8, 8, { x: 2, y: 3, w: 3, h: 2 }))).toEqual({ x: 2, y: 3, w: 3, h: 2 });
    expect(opaqueBox(frame(8, 8, null))).toBeNull();
    expect(opaqueBox(frame(1, 1, { x: 0, y: 0, w: 1, h: 1 }))).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
  it('unions boxes', () => {
    expect(unionBox({ x: 0, y: 0, w: 2, h: 2 }, { x: 3, y: 1, w: 2, h: 4 })).toEqual({ x: 0, y: 0, w: 5, h: 5 });
    expect(unionBox(null, { x: 1, y: 1, w: 1, h: 1 })).toEqual({ x: 1, y: 1, w: 1, h: 1 });
    expect(unionBox(null, null)).toBeNull();
  });
  it('refuses pixels of the wrong size', () => {
    expect(() => frameOf(2, 2, new Uint8Array(3))).toThrow(/16 needed/);
  });
});

describe('composing pages', () => {
  const atlas: LayoutSettings = { mode: 'atlas', grouping: 'single', trim: true, padding: 2, extrude: 1, powerOfTwo: false, maxSize: 256 };
  const grid: LayoutSettings = { mode: 'grid', grouping: 'single', trim: false, padding: 0, extrude: 0, powerOfTwo: false, maxSize: 256 };
  const a = frame(16, 16, { x: 4, y: 6, w: 6, h: 4 }, [255, 0, 0]);
  const b = frame(16, 16, { x: 0, y: 0, w: 16, h: 16 }, [0, 255, 0]);
  const empty = frame(16, 16, null);
  const frames = new Map<string, FrameSource>([['walk|E|0', a], ['walk|E|1', b], ['walk|E|2', empty]]);
  const inputs: FrameInput[] = [...frames].map(([key, f], i) => ({ key, clip: 'walk', direction: 'E', index: i, width: 16, height: 16, opaque: opaqueBox(f) }));

  it('grid: every frame lands untrimmed at its placement; the empty frame stays transparent', () => {
    const pages = layoutFrames(inputs, grid);
    const [page] = composePages(pages, (k) => frames.get(k), grid);
    expect([page.width, page.height]).toEqual([48, 16]);
    const pa = pages[0].placements.find((p) => p.key === 'walk|E|0')!;
    expect(px(page, pa.x + 4, pa.y + 6)).toEqual([255, 0, 0, 255]);
    expect(px(page, pa.x + 3, pa.y + 6)).toEqual([0, 0, 0, 0]);
    const pb = pages[0].placements.find((p) => p.key === 'walk|E|1')!;
    expect(px(page, pb.x, pb.y)).toEqual([0, 255, 0, 255]);
    expect(px(page, pb.x + 15, pb.y + 15)).toEqual([0, 255, 0, 255]);
    const pe = pages[0].placements.find((p) => p.key === 'walk|E|2')!;
    expect(opaqueBox(extractFrame(page, pe))).toBeNull();
  });

  it('atlas: trimmed rectangles are drawn from their trim offset and extruded by one pixel', () => {
    const pages = layoutFrames(inputs, atlas);
    const page = composePage(pages[0], (k) => frames.get(k), atlas);
    const pa = pages[0].placements.find((p) => p.key === 'walk|E|0')!;
    expect(pa.trimmed).toBe(true);
    expect([pa.w, pa.h]).toEqual([6, 4]);
    // The whole placed rect is red, and so is the one-pixel border around it.
    for (let y = -1; y <= pa.h; y++) for (let x = -1; x <= pa.w; x++) expect(px(page, pa.x + x, pa.y + y)).toEqual([255, 0, 0, 255]);
    // Two pixels out is the padding: transparent.
    expect(px(page, pa.x - 2, pa.y)).toEqual([0, 0, 0, 0]);
    // Reading the frame back gives the untrimmed frame.
    const back = extractFrame(page, pa);
    expect([back.width, back.height]).toEqual([16, 16]);
    expect(opaqueBox(back)).toEqual({ x: 4, y: 6, w: 6, h: 4 });
    expect(px(back, 4, 6)).toEqual([255, 0, 0, 255]);
  });

  it('a frame of the wrong size is refused; a missing frame is left transparent', () => {
    const pages = layoutFrames(inputs, grid);
    expect(() => composePage(pages[0], () => frame(8, 8, null), grid)).toThrow(/is 8×8, the layout placed a 16×16 frame/);
    const page = composePage(pages[0], () => null, grid);
    expect(opaqueBox(page)).toBeNull();
  });

  it('extrude clips at the page edge instead of writing out of bounds', () => {
    const page = frameOf(6, 4);
    extrude(page, b, { key: 'k', x: 0, y: 0, w: 6, h: 4, trimX: 0, trimY: 0, sourceW: 16, sourceH: 16, trimmed: true }, 2);
    expect(opaqueBox(page)).toBeNull();
  });
});
