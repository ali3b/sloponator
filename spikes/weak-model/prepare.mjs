#!/usr/bin/env node
// Makes a scratch copy of Monty for one weak-model run: node prepare.mjs <dest> <label> <port>
// Copies the game (node_modules symlinked), renames its generator project so renders land in a throwaway project,
// writes a short AGENTS.md, and commits, so the model's work is the git diff.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [dest, label, port] = process.argv.slice(2);
if (!dest || !label || !port) throw new Error('usage: prepare.mjs <dest> <label> <port>');
const SRC = path.resolve(process.env.HOME, 'projects/monty');
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
for (const e of fs.readdirSync(SRC)) {
  if (['node_modules', '.git', 'test-results', 'dist', '.mcp.json', 'CLAUDE.md', 'FEEDBACK.md', 'TODO.md'].includes(e)) continue;
  fs.cpSync(path.join(SRC, e), path.join(dest, e), { recursive: true });
}
fs.symlinkSync(path.join(SRC, 'node_modules'), path.join(dest, 'node_modules'));
const assets = JSON.parse(fs.readFileSync(path.join(dest, 'ssg.assets.json'), 'utf8'));
assets.project = `Spike2 ${label}`;
fs.writeFileSync(path.join(dest, 'ssg.assets.json'), JSON.stringify(assets, null, 2) + '\n');
fs.writeFileSync(path.join(dest, 'AGENTS.md'), `# Monty (scratch copy for a test run)

A Phaser 3.80 + TypeScript + Vite game. Source in \`src/\` (scenes in \`src/scenes/\`, the player in \`src/joe.ts\`,
sprite loading in \`src/assets.ts\`). Sprites come from the Synty Sprite Generator and are declared in
\`ssg.assets.json\`; \`npm run assets\` builds them into \`public/assets/\` (generated: never edit by hand).

Commands:
- \`npm run typecheck\` — TypeScript check (must pass).
- \`npx vite --port ${port} --strictPort\` — dev server (run it in the background, e.g. \`nohup npx vite --port ${port} --strictPort > vite.log 2>&1 &\`). Restart it after \`npm run assets\`.
- \`node scripts/load-check.mjs http://localhost:${port} room\` — plays the first room headlessly and fails on errors (must pass).
- Generator CLI: \`node /home/andrew/projects/synty-sprite-generator/apps/cli/bin/ssg.mjs --help\` (e.g. \`ssg assets skeleton\`, \`ssg sprite --help\`). Use it only through \`npm run assets\` unless you need to look something up.

Rules: stay inside this folder; do not kill processes by name (use the PID from vite.log or \`ss -ltnp\`); do not run more than one asset build at a time.
`);
execFileSync('git', ['init', '-q'], { cwd: dest });
execFileSync('git', ['-c', 'user.name=spike', '-c', 'user.email=spike@local', 'add', '-A'], { cwd: dest });
execFileSync('git', ['-c', 'user.name=spike', '-c', 'user.email=spike@local', 'commit', '-qm', 'scratch copy'], { cwd: dest });
console.log(`prepared ${dest} (project "Spike2 ${label}", port ${port})`);
