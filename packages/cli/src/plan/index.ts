/**
 * Sprite planning (P2, ali3b/sloponator#8): ssg.assets.json → one BatchSpec per sprite, as the old generator's
 * `ssg sprite apply` + `ssg sprite render` would have queued it. Ported from the old packages/client (apply, spec,
 * sprites) and packages/shared/src/sprite (state, spec, render, words, templates) plus templateCatalog.
 */
export * from './plan.js';
export * from './apply.js';
export * from './buildSpec.js';
export * from './sources.js';
export * from './sprites.js';
export * from './render.js';
export * from './spriteSpec.js';
export * from './state.js';
export * from './words.js';
export * from './templates.js';
export * from './templateCatalog.js';
