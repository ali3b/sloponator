// Moved from synty-sprite-generator apps/web/src/export/exporter.ts (ExportPart) (P2, ali3b/sloponator#9). Layered
// exports (one sheet per equipment item) are not rendered yet; the type stays so trackedPoints keeps listing the parts.
import type * as THREE from 'three';
import type { DepthRule, LoadoutItem, PartSlot } from '@slop/sprites';

/** An attached item exported as its own sheet (layered export). */
export interface ExportPart {
  /** Sheet suffix: `{base}_{name}`. */
  name: string;
  slot: PartSlot;
  kind: string;
  asset: string;
  bone: string;
  blend: 'normal' | 'add';
  depth?: DepthRule;
  holder: THREE.Object3D;
  /** The loadout item it came from (batch exports). */
  item?: LoadoutItem;
  /** Weapon class: rendered only for that class's clips, hidden during the others. */
  cls?: string;
}
