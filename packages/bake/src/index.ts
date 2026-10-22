/**
 * @slop/bake: Blender bakes on demand (ali3b/sloponator#69). The retarget worker (worker/, Python run by Blender
 * headless), the bake store it writes into ($SLOP_CACHE_DIR/bakes, keyed by the inputs and the Blender/worker
 * versions, imports of the old generator's bakes), and the pass `slop build` runs before the render starts.
 */
export { BlenderQueue, WORKER_DIR, blenderVersion, defaultBlender, parseTagged, type WorkerResult, type WorkerRun } from './blender.js';
export { withLock, tryLock, unlock, type LockOptions, type LockOwner } from './lock.js';
export {
  BakeStore, BakeError, bakeClip, bakeKey, clipName, defaultBakeDir, fileHash, workerVersion, BAKE_STORE_VERSION, IMPORTED,
  type BakeRequest, type BakeKeyInputs, type BakeSidecar, type BakeEntry, type BakeErrorCode, type BakeStoreOptions, type BakeClipOptions,
} from './store.js';
export { groupAnimations, resolveAnim, resolveMatch, resolveSetItem, type ClipRecord, type CharacterRecord } from './clips.js';
export { bakeForBuild, neededClips, type BakeJob, type NeededClip, type BakeSummary, type BakeForBuildOptions } from './plan.js';
