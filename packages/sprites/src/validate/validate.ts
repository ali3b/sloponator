// Moved from synty-sprite-generator packages/shared/src/export/validate.ts (P2, ali3b/sloponator#8).
/**
 * Checks an export is usable as-is in an engine: every sheet of a layered export has the same frames, and
 * no sheet has gaps, oversized pages, pivots outside the frame or atlas settings that bleed neighbours.
 */
import type { ExportContext } from '../manifest/context.js';
import type { LayoutSettings } from '../layout/layout.js';

export interface ValidationIssue {
  level: 'error' | 'warn';
  code: 'missing_frames' | 'frame_count' | 'rect_mismatch' | 'pivot_mismatch' | 'size_mismatch' | 'timing_mismatch' | 'direction_mismatch' | 'page_size' | 'pivot_outside' | 'bleeding' | 'alignment_mismatch' | 'frame_overflow' | 'style_without_weapon' | 'full_rerender' | 'slice_skipped' | 'state_clip_skipped' | 'state_clip_fallback' | 'state_loop_skipped';
  message: string;
}

const issue = (level: ValidationIssue['level'], code: ValidationIssue['code'], message: string): ValidationIssue => ({ level, code, message });

/** `contexts[0]` is the reference (the body); the rest must match it frame for frame. */
export function validateSheets(contexts: ExportContext[], opts: { layout: LayoutSettings }): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const ref = contexts[0];
  if (!ref) return out;
  for (const ctx of contexts) {
    const who = ctx === ref ? ctx.base : `${ctx.base} (vs ${ref.base})`;
    for (const c of ctx.clips) {
      for (const a of c.animations.filter((x) => !x.flipX)) {
        if (a.frames.length !== c.frameCount)
          out.push(issue('error', 'missing_frames', `${who}: ${a.name} has ${a.frames.length} of ${c.frameCount} frames`));
        const idx = a.frames.map((f) => f.index);
        if (idx.some((v, i) => v !== i)) out.push(issue('error', 'missing_frames', `${who}: ${a.name} skips frame indexes`));
      }
    }
    if (ctx.pivot.x < 0 || ctx.pivot.y < 0 || ctx.pivot.x > ctx.frameWidth || ctx.pivot.y > ctx.frameHeight)
      out.push(issue('error', 'pivot_outside', `${who}: pivot (${ctx.pivot.x}, ${ctx.pivot.y}) is outside the ${ctx.frameWidth}×${ctx.frameHeight} frame`));
    for (const p of ctx.pages)
      if (p.width > opts.layout.maxSize || p.height > opts.layout.maxSize)
        out.push(issue('error', 'page_size', `${who}: page ${p.file} is ${p.width}×${p.height}, over ${opts.layout.maxSize}`));
    if (ctx === ref) continue;
    if (ctx.frameWidth !== ref.frameWidth || ctx.frameHeight !== ref.frameHeight)
      out.push(issue('error', 'size_mismatch', `${who}: frame ${ctx.frameWidth}×${ctx.frameHeight} differs from ${ref.frameWidth}×${ref.frameHeight}`));
    if (ctx.pivot.x !== ref.pivot.x || ctx.pivot.y !== ref.pivot.y) out.push(issue('error', 'pivot_mismatch', `${who}: pivot differs`));
    if (ctx.fps !== ref.fps) out.push(issue('error', 'timing_mismatch', `${who}: ${ctx.fps} fps differs from ${ref.fps}`));
    const dirs = ctx.directions.map((d) => d.name).join(','), refDirs = ref.directions.map((d) => d.name).join(',');
    if (dirs !== refDirs) out.push(issue('error', 'direction_mismatch', `${who}: directions ${dirs} differ from ${refDirs}`));
    for (const a of ref.animations) {
      const b = ctx.animations.find((x) => x.name === a.name);
      if (!b) {
        out.push(issue('error', 'frame_count', `${who}: animation ${a.name} is missing`));
        continue;
      }
      if (b.frames.length !== a.frames.length) {
        out.push(issue('error', 'frame_count', `${who}: ${a.name} has ${b.frames.length} frames, body has ${a.frames.length}`));
        continue;
      }
      const bad = a.frames.findIndex((f, i) => {
        const g = b.frames[i];
        return f.x !== g.x || f.y !== g.y || f.w !== g.w || f.h !== g.h || f.trimX !== g.trimX || f.trimY !== g.trimY || f.page !== g.page || f.durationMs !== g.durationMs;
      });
      if (bad >= 0) out.push(issue('error', 'rect_mismatch', `${who}: ${a.name} frame ${bad} is placed differently from the body's`));
    }
  }
  if (opts.layout.mode === 'atlas' && (opts.layout.padding < 2 || opts.layout.extrude < 1))
    out.push(issue('warn', 'bleeding', `atlas padding ${opts.layout.padding}px / extrude ${opts.layout.extrude}px: use padding ≥ 2 and extrude ≥ 1 to avoid texture bleeding when filtering`));
  return out;
}
