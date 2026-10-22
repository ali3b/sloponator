#!/usr/bin/env node
// A stand-in for Blender in the unit tests: `--version` prints STUB_BLENDER_VERSION (default "Blender 9.9.9");
// `-b --factory-startup -P <script> -- @args.json` writes a fake GLB to out_glb, records its start/end in
// $STUB_BLENDER_LOG and prints RETARGET_OK like retarget.py. A source path containing "fail" fails like Blender.
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
if (argv[0] === '--version') {
  console.log(process.env.STUB_BLENDER_VERSION || 'Blender 9.9.9');
  console.log('\tbuild date: never');
  process.exit(0);
}
const raw = argv[argv.indexOf('--') + 1];
const args = JSON.parse(raw.startsWith('@') ? fs.readFileSync(raw.slice(1), 'utf8') : raw);
const log = process.env.STUB_BLENDER_LOG;
const start = Date.now();
await new Promise((r) => setTimeout(r, Number(process.env.STUB_BLENDER_MS || 150)));
if (String(args.source).includes('fail')) {
  console.error('Error: boom, the FBX importer gave up');
  process.exit(1);
}
fs.mkdirSync(path.dirname(args.out_glb), { recursive: true });
fs.writeFileSync(args.out_glb, `glTF stub ${JSON.stringify({ ...args, out_glb: undefined, rigs: process.env.SSG_EXTRA_RIGS })}`);
if (log) fs.appendFileSync(log, `${JSON.stringify({ pid: process.pid, start, end: Date.now(), clip: args.clip_name, inPlace: args.in_place })}\n`);
console.log('RETARGET_OK ' + JSON.stringify({ clip: args.clip_name, frames: 32, fps: 30, speed_mps: args.in_place ? 1.25 : 0 }));
