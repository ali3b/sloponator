/**
 * @slop/models3d: the 3D model export moved from the old generator (P3, ali3b/sloponator#14/#15/#16). The spec and
 * manifest logic (packages/shared/src/model3d), the GLB builders (apps/server/src/modelBuild.ts and friends), the
 * resolver over @slop/library, the ssg.models.json / ssg.textures.json apply and the texture export. Node only.
 */
export * from './spec/index.js';
export * from './build/modelBuild.js';
export * from './build/modelSimplify.js';
export * from './build/modelSeats.js';
export * from './build/modelDashboard.js';
export * from './build/modelSwatches.js';
export * from './build/modelNature.js';
export * from './build/natureMaterials.js';
export * from './build/compositeBuild.js';
export * from './build/terrainBuild.js';
export * from './build/terrainModels.js';
export * from './build/trackBuild.js';
export * from './build/companions.js';
export * from './build/glb.js';
export * from './build/png.js';
export * from './resolve/errors.js';
export * from './resolve/names.js';
export * from './resolve/clips.js';
export * from './resolve/resolve.js';
export * from './declarations.js';
export * from './apply.js';
export * from './textures.js';
export * from './cli.js';
