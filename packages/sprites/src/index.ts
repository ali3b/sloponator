/**
 * @slop/sprites: the sprite export core, moved from the old generator's packages/shared (ali3b/sloponator#8).
 * It describes and packs frames (profiles, layout, manifests, events, validation, the frame-cache key) and never
 * draws them: no three.js, no browser, no DOM. The render bundle feeds it frames through `FrameSource`.
 */
export * from './hash.js';
export * from './view/camera.js';
export * from './inputs/batch.js';
export * from './inputs/combat.js';
export * from './inputs/classes.js';
export * from './inputs/light.js';
export * from './inputs/categories.js';
export * from './profiles/profiles.js';
export * from './profiles/render.js';
export * from './layout/layout.js';
export * from './layout/compose.js';
export * from './manifest/context.js';
export * from './manifest/meta.js';
export * from './manifest/layers.js';
export * from './manifest/split.js';
export * from './manifest/turret.js';
export * from './manifest/sheetMerge.js';
export * from './manifest/portrait.js';
export * from './events/strike.js';
export * from './events/footsteps.js';
export * from './events/groundSpeed.js';
export * from './events/bodyBoxes.js';
export * from './validate/validate.js';
export * from './cache/frameCache.js';
export * from './object/footprint.js';
export * from './object/concave.js';
export * from './object/slices.js';
export * from './object/states.js';
export * from './object/scorch.js';
