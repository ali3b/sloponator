/**
 * What the goldens compare of a manifest: the JSON without what names its maker (`generator`, the phaser atlas's
 * `meta.app` / `meta.version`), re-serialised with sorted keys. The old generator and slop build must agree on
 * everything else, byte for byte.
 */
import crypto from 'node:crypto';

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]));
  return v;
}

export function normalizeManifest(text: string): string {
  const v = JSON.parse(text) as Record<string, unknown>;
  delete v.generator;
  const meta = v.meta as Record<string, unknown> | undefined;
  if (meta && typeof meta === 'object') {
    delete meta.app;
    delete meta.version;
  }
  return JSON.stringify(sortKeys(v), null, 1);
}

export const sha256 = (b: Uint8Array | string) => crypto.createHash('sha256').update(b).digest('hex');
