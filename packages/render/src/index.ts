/**
 * @slop/render: the three.js render bundle (web/, built by Vite into the cache dir and named by its content hash)
 * and the Node runner that launches Chromium, serves the bundle and answers its data requests from @slop/library,
 * with the frame cache around every render. Renders frames; @slop/sprites packs them (ali3b/sloponator#9, #10).
 */
export { ensureBundle, bundleSourceHash, hashDir, defaultCacheDir, WEB_DIR, type BundleInfo } from './bundle.js';
export { chromiumLaunch, backendOf, isSoftwareRenderer, GPU_CHOICES, type GpuChoice, type ChromiumLaunch } from './browser.js';
export { FrameStore, type FrameEntry } from './frameStore.js';
export { decodePng, encodePng, stripFrames, stripFrame } from './strips.js';
export { startRunner, dataHandler, ORIGIN, type Runner, type RunnerOptions, type RenderHooks, type RenderResult, type UnitFrames } from './runner.js';
export type { RenderJob, RenderOutput, RenderUnit, RenderedUnit, PlanOut } from './protocol.js';
