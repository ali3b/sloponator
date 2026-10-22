/**
 * How the headless Chromium renders. Ported from synty-sprite-generator apps/server/src/batches.ts `chromiumLaunch`
 * (P2, ali3b/sloponator#9): `auto` uses the machine's GPU when a driver is found (an NVIDIA card through its EGL
 * library, else whatever EGL device the system offers), `nvidia` / `egl` force those, `software` renders with
 * SwiftShader (several times slower, works anywhere, e.g. in CI). GPU and software frames differ (spike 1: 6% of
 * the pixels), so the frame cache keeps them apart by `backend`.
 */
import fs from 'node:fs';
import type { RenderBackend } from '@slop/sprites';

export type GpuChoice = 'auto' | 'nvidia' | 'egl' | 'software';
export const GPU_CHOICES: readonly GpuChoice[] = ['auto', 'nvidia', 'egl', 'software'];

export interface ChromiumLaunch {
  mode: 'nvidia' | 'egl' | 'software';
  args: string[];
  env: Record<string, string>;
}

const NVIDIA_EGL = '/usr/share/glvnd/egl_vendor.d/10_nvidia.json';

export function chromiumLaunch(want: GpuChoice = 'auto', baseEnv: Record<string, string | undefined> = process.env): ChromiumLaunch {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(baseEnv)) if (v !== undefined) env[k] = v;
  // A display would make Chromium pick the desktop's GL; headless stays headless (apps/web/scripts/ui-smoke.mjs).
  delete env.DISPLAY;
  delete env.WAYLAND_DISPLAY;
  const software: ChromiumLaunch = { mode: 'software', args: ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], env };
  if (want === 'software') return software;
  const egl = ['--headless=new', '--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist'];
  if (want === 'nvidia' || (want === 'auto' && process.platform === 'linux' && fs.existsSync(NVIDIA_EGL))) {
    return { mode: 'nvidia', args: egl, env: { ...env, __NV_PRIME_RENDER_OFFLOAD: '1', __GLX_VENDOR_LIBRARY_NAME: 'nvidia', __EGL_VENDOR_LIBRARY_FILENAMES: NVIDIA_EGL } };
  }
  if (want === 'egl' || want === 'auto') return { mode: 'egl', args: egl, env };
  return software;
}

/** Whether the WebGL renderer string names a software rasteriser. */
export const isSoftwareRenderer = (glRenderer: string) => /swiftshader|llvmpipe|softpipe|software|no webgl/i.test(glRenderer);

/** The frame-cache backend of a page: what it actually renders with, not what was asked for. */
export function backendOf(glRenderer: string): RenderBackend {
  return isSoftwareRenderer(glRenderer) ? 'software' : 'gpu';
}
