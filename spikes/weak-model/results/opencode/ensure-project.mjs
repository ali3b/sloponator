#!/usr/bin/env node
// Harness fix for T2: node ensure-project.mjs "<Spike2 project name>"
// prepare.mjs renames the game's generator project, so `ssg sprite apply` (via `npm run assets`) creates a fresh
// project with the generator's stock defaults (topdown8, 128px, no phaser3 profile) and build-assets.mjs then rejects
// every export ("no phaser3 atlas/anims"). This creates the throwaway project up front with the real project's
// defaults (side2, 64px, ppm 32, pixel, phaser3), or re-points it if it already exists, through the running server.
const SERVER = process.env.SSG_SERVER ?? 'http://127.0.0.1:5181';
const SOURCE = process.env.SSG_SOURCE_PROJECT ?? "Montezuma's Revenge";
const name = process.argv[2];
if (!name) throw new Error('usage: ensure-project.mjs <name>');
const req = async (method, path, body) => {
  const r = await fetch(SERVER + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
  return r.json();
};
const all = await req('GET', '/api/projects');
const src = all.find((p) => p.name === SOURCE);
if (!src) throw new Error(`source project "${SOURCE}" not found`);
const hit = all.find((p) => p.name.toLowerCase() === name.toLowerCase());
const project = hit ? await req('PATCH', `/api/projects/${hit.id}`, { defaults: src.defaults }) : await req('POST', '/api/projects', { name, defaults: src.defaults });
const same = JSON.stringify(project.defaults) === JSON.stringify(src.defaults);
console.log(`${hit ? 'updated' : 'created'} project ${project.id} "${project.name}" defaults ${same ? 'match' : 'DIFFER FROM'} "${SOURCE}"`);
if (!same) { console.log(JSON.stringify(project.defaults)); process.exit(1); }
