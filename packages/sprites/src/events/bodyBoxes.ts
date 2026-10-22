// Moved from synty-sprite-generator packages/shared/src/export/bodyBoxes.ts (P2, ali3b/sloponator#8).
/**
 * Per-frame body boxes for hurtboxes (SF-FB-009): head, torso and legs as axis-aligned rectangles in frame pixels
 * (untrimmed frame, from its top-left, like the sockets), measured from the posed skeleton's joints projected into
 * the frame. A crouch, a lean back or a knockdown changes the boxes by itself; a striking hand or foot does not
 * stretch the torso box (the arms are not part of any box; the legs box does follow a kicking leg).
 *
 * Each box bounds its joints, padded by the body part's half-thickness:
 *   head:  the head joint and the head's top (HEAD_LENGTH along the neck → head direction), padded HEAD_PAD
 *   torso: hips, spine, neck, clavicles / upper arms (the shoulders) and thighs (the hip joints), padded TORSO_PAD
 *   legs:  thighs, calves, feet and toes, padded LEG_PAD
 */

export interface PixelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BodyBoxes {
  head?: PixelBox;
  torso?: PixelBox;
  legs?: PixelBox;
}

/** Metres from the head joint (the base of the skull) to the top of the head. */
export const HEAD_LENGTH = 0.17;
/** Half-thickness padding of each box, metres. */
export const HEAD_PAD = 0.1;
export const TORSO_PAD = 0.08;
export const LEG_PAD = 0.07;

/** Joints (canonical rig names) each box bounds. `head_top` is the derived top of the head. */
export const BODY_BOX_JOINTS = {
  head: ['head', 'head_top'],
  torso: ['hips', 'spine1', 'spine2', 'spine3', 'neck', 'clavicle_l', 'clavicle_r', 'upperarm_l', 'upperarm_r', 'thigh_l', 'thigh_r'],
  legs: ['thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'foot_l', 'foot_r', 'toe_l', 'toe_r'],
} as const;

/** Every joint a body box needs, without the derived head top. */
export const BODY_JOINTS: string[] = [...new Set(Object.values(BODY_BOX_JOINTS).flat())].filter((j) => j !== 'head_top');

const box = (pts: { x: number; y: number }[], pad: number): PixelBox | undefined => {
  if (!pts.length) return undefined;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x0 = Math.floor(Math.min(...xs) - pad), y0 = Math.floor(Math.min(...ys) - pad);
  const x1 = Math.ceil(Math.max(...xs) + pad), y1 = Math.ceil(Math.max(...ys) + pad);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

/**
 * The boxes of one frame from projected joints (pixels, by canonical name) and the frame's scale (pixels per metre
 * at the body). Boxes whose joints are all missing are left out; the torso needs the hips or a spine joint.
 */
export function bodyBoxes(joints: Record<string, { x: number; y: number } | null | undefined>, pxPerMetre: number): BodyBoxes {
  const pick = (names: readonly string[]) => names.map((n) => joints[n]).filter((p): p is { x: number; y: number } => !!p && Number.isFinite(p.x) && Number.isFinite(p.y));
  const out: BodyBoxes = {};
  const head = box(pick(BODY_BOX_JOINTS.head), HEAD_PAD * pxPerMetre);
  if (head && joints.head) out.head = head;
  const core = pick(['hips', 'spine1', 'spine2', 'spine3']);
  const torso = core.length ? box(pick(BODY_BOX_JOINTS.torso), TORSO_PAD * pxPerMetre) : undefined;
  if (torso) out.torso = torso;
  const legs = box(pick(BODY_BOX_JOINTS.legs), LEG_PAD * pxPerMetre);
  if (legs) out.legs = legs;
  return out;
}

/** A box of a mirrored (flipX) animation: x' = frameWidth - x - w. */
export const flipBox = (b: PixelBox, frameWidth: number): PixelBox => ({ ...b, x: frameWidth - b.x - b.w });
