#!/usr/bin/env node
// A thin wrapper for running @slop/models3d by hand (the real entry is `slop build`, packages/cli):
//   slop-models models ssg.models.json [--out dir] [--only a,b] [--force] [--json] [--data-dir d] [--cache-dir d]
//   slop-models textures ssg.textures.json [--out dir] [--only a,b] [--force] [--json]
// Needs tsx (the package is strict ESM TypeScript run from source): `npx tsx packages/models3d/bin/slop-models.mjs …`.
import { buildModels, buildTextures } from '../src/cli.ts';

const [cmd, file, ...rest] = process.argv.slice(2);
const opts = {};
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  const val = () => rest[++i];
  if (a === '--out') opts.out = val();
  else if (a === '--only') opts.only = val().split(',').map((s) => s.trim()).filter(Boolean);
  else if (a === '--force') opts.force = true;
  else if (a === '--json') opts.json = true;
  else if (a === '--data-dir') opts.dataDir = val();
  else if (a === '--cache-dir') opts.cacheDir = val();
  else {
    console.error(`unknown option ${a}`);
    process.exit(2);
  }
}
if (!file || (cmd !== 'models' && cmd !== 'textures')) {
  console.error('usage: slop-models models|textures <ssg.models.json|ssg.textures.json> [--out dir] [--only a,b] [--force] [--json] [--data-dir d] [--cache-dir d]');
  process.exit(2);
}
try {
  await (cmd === 'models' ? buildModels(file, opts) : buildTextures(file, opts));
} catch (e) {
  console.error(e.message);
  process.exit(e.exitCode ?? 1);
}
