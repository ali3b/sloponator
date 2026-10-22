/**
 * What crosses between the Node runner and the render page (JSON over Playwright): the job, the per-unit frame
 * data, the render's output. Shared by `web/` (the page) and `src/` (the runner); pure types, no DOM.
 */
import type { BatchSpec, BodyBoxes, CachedFrame, ClipEvent, ClipInput, Direction, ExportProfile, FrameInput, FrameUnitKeyInput, Framing, ObjectInfo, ReleaseMode, ValidationIssue, ViewConfig } from '@slop/sprites';

export interface RenderJob {
  /** The model to render (a library asset id). */
  asset: number;
  /** The batch as the planner made it: set, view, profile, loadout, fx, light, uniformFrame/uniformWith, maxSeconds, pivot, modelScale, noCache. */
  spec: BatchSpec;
}

/** One clip × direction of the export: what the frame cache keys it by (without the renderer id, which the runner adds). */
export interface RenderUnit {
  /** `${clip}\n${direction}` */
  id: string;
  clip: string;
  direction: string;
  /** Frames in the unit. */
  n: number;
  /** The cache key's inputs; the runner adds `renderer: { backend, bundle }`. */
  input: Omit<FrameUnitKeyInput, 'renderer'>;
  /** The frames came from the cache (the runner answered the lookup), so nothing was rendered for it. */
  cached: boolean;
}

/** A rendered unit's pixels: PNG strips (`<sheet>.png`, `<sheet>.<layer>.png`) and the per-frame data the measuring found. */
export interface RenderedUnit {
  id: string;
  /** PNG bytes per strip name, base64 (what crosses the page boundary). */
  strips: Record<string, string>;
  cols: number;
  frames: CachedFrame[];
}

/** A plan line of the export: one output clip and its sample times. */
export interface PlanOut {
  name: string;
  loop: boolean;
  times: number[];
  dirs: string[];
  cls?: string;
  perClip?: boolean;
  release?: ReleaseMode;
}

/** Everything the packer needs apart from the pixels. */
export interface RenderOutput {
  asset: { name: string; pack: string; kind: string; category: string | null };
  view: ViewConfig;
  framing: Framing;
  directions: Direction[];
  plans: PlanOut[];
  clips: ClipInput[];
  events: Record<string, ClipEvent[]>;
  object: ObjectInfo | null;
  sockets: Record<string, Record<string, { x: number; y: number }>>;
  boxes: Record<string, BodyBoxes>;
  /** Every frame's layout input (trim box from the render or the cache). */
  inputs: FrameInput[];
  validation: ValidationIssue[];
  modelScale: number;
  blend: 'normal' | 'add';
  layers: string[];
  units: RenderUnit[];
  cache: { reused: number; total: number };
  /** The profile's fixed layout, when it has one (LPC): the packer places these instead of packing. */
  special: ExportProfile['special'] | undefined;
}

