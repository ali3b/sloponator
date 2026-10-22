#!/usr/bin/env tsx
// Rewrites src/synty/scale-overrides.json from the DB's scale_overrides table (keeps the `why` of rows already
// listed). Usage: npm run scale-overrides -w @slop/library [-- /path/to/data]. Reads the DB only.
import fs from 'node:fs';
import { openLibrary } from '../src/library.js';
import { KNOWN_SCALE_OVERRIDES, SCALE_OVERRIDES_FILE } from '../src/synty/index.js';

const dataDir = process.argv[2] ?? process.env.SSG_DATA_DIR ?? '/home/andrew/projects/synty-sprite-generator/data';
const lib = openLibrary({ dataDir });
const overrides = lib.scaleOverrides().map((r) => {
  const old = KNOWN_SCALE_OVERRIDES.find((o) => o.pack === r.pack && o.fbx === r.fbx && o.variant === r.variant);
  const name = lib.assets({ pack: r.pack, status: 'all', limit: 5000 }).find((a) => a.fbx === r.fbx && (a.variant ?? '') === r.variant)?.name ?? old?.name ?? r.fbx;
  return { pack: r.pack, fbx: r.fbx, variant: r.variant, name, scale: r.scale, why: old?.why ?? 'exported from the DB; say why here' };
});
lib.close();
const file = JSON.parse(fs.readFileSync(SCALE_OVERRIDES_FILE, 'utf8')) as { description: string };
fs.writeFileSync(SCALE_OVERRIDES_FILE, `${JSON.stringify({ description: file.description, overrides }, null, 2)}\n`);
console.log(`${overrides.length} override(s) written to ${SCALE_OVERRIDES_FILE}`);
