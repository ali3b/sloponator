#!/usr/bin/env node
// Creates the public GitHub repo (if missing), one milestone per phase, labels, one issue per work item and a
// project board, from docs/PLAN.md's phases. Safe to re-run: existing milestones, labels and issues (by title) are kept.
//
//   node scripts/github-setup.mjs [--repo ali3b/sloponator] [--dry]
import { execFileSync } from 'node:child_process';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const argv = process.argv.slice(2);
const REPO = argv.includes('--repo') ? argv[argv.indexOf('--repo') + 1] : 'ali3b/sloponator';
const DRY = argv.includes('--dry');
const OWNER = REPO.split('/')[0];

const gh = (...a) => {
  if (DRY) { console.log('gh', a.join(' ')); return ''; }
  return execFileSync('gh', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
};
const tryGh = (...a) => { try { return gh(...a); } catch (e) { return null; } };

const PHASES = [
  ['P0 Review and spikes', 'Review of the generator, renderer spike, weak-model baseline; gate on renderer and harness.', [
    'Write docs/REVIEW.md',
    'Spike 1: render from a pinned bundle driven by the build tool, compare with the current output',
    'Spike 2: weak-model baseline (2 free OpenRouter models × mini-swe-agent / OpenCode)',
    'Gate: renderer (three.js bundle or Blender) and harness/model decision',
  ]],
  ['P1 Foundations', 'Repo tooling, one zod schema with generators, library import (read-only).', [
    'npm workspaces, TS, vitest, Playwright, CI',
    'schema package: zod source → CLI flags, MCP tools, JSON Schema, docs',
    'library package: import packs, GLBs, clips and Synty knowledge read-only from the old generator',
  ]],
  ['P2 Sprites', 'slop build renders sprites with no server; render goldens; objects and props.', [
    'Move the export core (profiles, layout, layers, events) into sprites',
    'Render bundle + runner launched by slop build; cache key includes the bundle hash',
    'Blank-frame detection and retry on GPU',
    'Render golden tests (pixel comparison) in npm test',
    'Objects and props (states, facings, footprints)',
    'Accept ssg.assets.json unchanged',
  ]],
  ['P3 3D models and textures', 'GLB export + manifest, textures; ssg.models.json / ssg.textures.json accepted.', [
    'Move modelBuild and model3d into models3d',
    'Textures export',
    'Accept ssg.models.json and ssg.textures.json unchanged',
  ]],
  ['P4 Levels', 'Tilesets, Tiled maps, routes, zones and game markers in their own module.', [
    'Move tilesets and maps into levels',
    'Routes, zones and game-only markers as level tools',
  ]],
  ['P4b Component catalogue', 'Synty-only catalogue: curated ids, Tier 1 prebuilt, Tier 2 on demand, slop find.', [
    'Curated component ids, tags and behaviour hints (reviewed data)',
    'Prebuild Tier 1 (~300 components): GLBs + standard sprite presets',
    'Tier 2 build on first request into the same store',
    'slop find with previews; GAPS.md for what the packs lack',
  ]],
  ['P5 Runtimes', 'runtime-core, runtime-phaser, runtime-three extracted from the games; world.spawn(id).', [
    'runtime-core: loop, actions (keys/pad/touch), audio, save, events, directions, debug hooks',
    'runtime-phaser: sprite loader, Arcade body from pivot, iso depth, Tiled, touch overlay',
    'runtime-three: model loader, renderer/quality/retro, cameras, touch widgets',
    'Runtime components (Character, Vehicle, Door, Pickup, Prop, Spawner) and world.spawn(id)',
  ]],
  ['P5b Scene scripts and video', 'YAML screenplay → director → MP4 with voices, subtitles and music; playScene() in games.', [
    'Scene script schema and slop scene write (prose → script)',
    'Director: routes, clips, sockets, seats, shots',
    'Frame-exact video render with Piper TTS, subtitles and music',
    'playScene() in the runtimes',
    'Three demo scenes: jeep meeting, tavern talk, chase',
  ]],
  ['P6 Agent layer', 'slop CLI + small MCP, templates, examples, docs for weak models.', [
    'slop CLI: new, find, add, build, check, run, help-me, deploy, record, doctor',
    'MCP facade (6–8 tools)',
    'Templates: phaser-topdown, phaser-side, phaser-iso, three-vehicle, three-arena',
    'One finished example game per template',
    'AGENTS.md, recipes, generated API reference, error-message pass',
  ]],
  ['P7 Help loop and evals', 'help-me → /review-help → eval-gated doc fixes; 8 briefs; target ≥5/8 good.', [
    'slop help-me and the help inbox (GitHub issues labelled help-request)',
    '/review-help skill: answer, classify, draft fix branch + eval case',
    'Eval runner: 8 briefs, free model, slop check, Claude judge, scoreboard on Pages',
  ]],
  ['P8 Migration proof', 'Monty (2D) and Off Road (3D) move onto the Sloponator; their load-checks pass.', [
    'Port Monty onto runtime-phaser and slop build',
    'Port Off Road onto runtime-three and slop build',
  ]],
  ['P9 One simple UI', 'One viewer/editor on the Sloponator daemon; retire the old web app.', [
    'Viewer/editor: library, sprite with inspect and placement, levels',
  ]],
];

const LABELS = [['phase', '1d76db'], ['help-request', 'd93f0b'], ['spike', 'fbca04'], ['needs-review', '0e8a16']];

if (!tryGh('repo', 'view', REPO, '--json', 'name')) {
  gh('repo', 'create', REPO, '--public', '--description', 'Game-dev stack on Synty assets that a small free model can build games with: asset pipeline, component catalogue, Phaser/three.js runtimes, scene-to-video, help loop', '--source', '.', '--push');
} else if (!DRY) {
  execFileSync('git', ['push', '-u', 'origin', 'HEAD'], { stdio: 'inherit' });
}

for (const [name, color] of LABELS) tryGh('label', 'create', name, '--repo', REPO, '--color', color, '--force');

const existingMs = DRY ? [] : JSON.parse(gh('api', `repos/${REPO}/milestones?state=all&per_page=100`));
const existingIssues = DRY ? [] : JSON.parse(gh('issue', 'list', '--repo', REPO, '--state', 'all', '--limit', '500', '--json', 'title'));
const titles = new Set(existingIssues.map((i) => i.title));

let projectNumber = null;
if (!DRY) {
  const list = JSON.parse(tryGh('project', 'list', '--owner', OWNER, '--format', 'json') ?? '{"projects":[]}');
  projectNumber = list.projects.find((p) => p.title === 'Sloponator')?.number ?? null;
  if (!projectNumber) {
    const made = tryGh('project', 'create', '--owner', OWNER, '--title', 'Sloponator', '--format', 'json');
    projectNumber = made ? JSON.parse(made).number : null;
    if (projectNumber) tryGh('project', 'link', String(projectNumber), '--owner', OWNER, '--repo', REPO);
  }
}

for (const [title, description, items] of PHASES) {
  if (!existingMs.some((m) => m.title === title)) tryGh('api', `repos/${REPO}/milestones`, '-f', `title=${title}`, '-f', `description=${description}`);
  for (const item of items) {
    const t = `${title.split(' ')[0]}: ${item}`;
    if (titles.has(t)) continue;
    const url = gh('issue', 'create', '--repo', REPO, '--title', t, '--body', `Part of **${title}** — see [docs/PLAN.md](../blob/master/docs/PLAN.md).`, '--milestone', title, '--label', title.startsWith('P0') && /Spike/.test(item) ? 'spike' : 'phase').trim();
    if (projectNumber && url) tryGh('project', 'item-add', String(projectNumber), '--owner', OWNER, '--url', url);
    console.log('issue', t);
    await sleep(1500); // GitHub's secondary rate limit on rapid issue creation
  }
}
console.log(projectNumber ? `project board #${projectNumber}` : 'no project board (gh needs the project scope)');
