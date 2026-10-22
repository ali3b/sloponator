/**
 * Moved from synty-sprite-generator packages/shared/src/sprite/templates.ts (P2, ali3b/sloponator#8): the project
 * templates a new project starts from (`templateDefaults`). The Wizard's starter presets stayed behind.
 */
import type { LookId, SizeId } from './words.js';

/** Templates a new project can start from: the shared settings of a kind of game. */
export const PROJECT_TEMPLATES: { id: string; name: string; blurb: string; viewId: string; look: LookId; size: SizeId; profileId: string }[] = [
  { id: 'tpl_godot_topdown', name: 'Godot top-down game', blurb: 'Top-down, 8 directions, clean look, medium size, Godot 4.', viewId: 'topdown8', look: 'clean', size: 'medium', profileId: 'godot4' },
  { id: 'tpl_phaser_pixel_platformer', name: 'Phaser pixel-art platformer', blurb: 'Side-scroller, pixel art, small sprites, Phaser 3.', viewId: 'side2', look: 'pixel', size: 'small', profileId: 'phaser3' },
  { id: 'tpl_unity_iso', name: 'Unity isometric game', blurb: 'Isometric, 8 directions, clean look, medium size, Unity.', viewId: 'iso8', look: 'clean', size: 'medium', profileId: 'unity' },
  { id: 'tpl_jrpg_pixel', name: 'Pixel-art JRPG', blurb: 'Top-down, 4 directions, pixel art, small sprites, PNG + JSON.', viewId: 'jrpg4', look: 'pixel', size: 'small', profileId: 'generic' },
  { id: 'tpl_hd_topdown', name: 'HD top-down shooter', blurb: 'High top-down, 8 directions, stylized look, large sprites, PixiJS.', viewId: 'high8', look: 'stylized', size: 'large', profileId: 'pixi' },
];
