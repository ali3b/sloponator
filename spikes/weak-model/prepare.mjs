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
// The machine's inotify watchers are exhausted and node_modules is shared with the real game, so this copy runs
// Vite with no file watching, its own dependency cache, and the port it was given.
fs.writeFileSync(path.join(dest, 'vite.config.ts'), `import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: ${port}, strictPort: true, host: '127.0.0.1', watch: null },
  cacheDir: '.vite-cache',
  base: './',
  build: { chunkSizeWarningLimit: 2000 },
});
`);
fs.writeFileSync(path.join(dest, '.gitignore'), 'node_modules\n.vite-cache\ntest-results\ndist\nvite.log\n');
fs.writeFileSync(path.join(dest, 'AGENTS.md'), `# Monty (scratch copy for a test run)

A Phaser 3.80 + TypeScript + Vite game. Source in \`src/\` (scenes in \`src/scenes/\`, the player in \`src/joe.ts\`,
sprite loading in \`src/assets.ts\`). Sprites come from the Synty Sprite Generator and are declared in
\`ssg.assets.json\`; \`npm run assets\` builds them into \`public/assets/\` (generated: never edit by hand).

Commands:
- \`npm run typecheck\` — TypeScript check (must pass).
- \`npx vite\` — dev server on port ${port} (run it in the background: \`nohup npx vite > vite.log 2>&1 &\`). It does not watch files: restart it (kill its PID from \`ss -ltnp\`) after you change code or run \`npm run assets\`.
- \`node scripts/load-check.mjs http://localhost:${port} room\` — plays the first room headlessly and fails on errors (must pass).
- Generator CLI: \`node /home/andrew/projects/synty-sprite-generator/apps/cli/bin/ssg.mjs --help\` (e.g. \`ssg assets skeleton\`, \`ssg sprite --help\`). Use it only through \`npm run assets\` unless you need to look something up.

Rules: stay inside this folder; do not kill processes by name (use the PID from vite.log or \`ss -ltnp\`); do not run more than one asset build at a time.
`);
execFileSync('git', ['init', '-q'], { cwd: dest });
execFileSync('git', ['-c', 'user.name=spike', '-c', 'user.email=spike@local', 'add', '-A'], { cwd: dest });
execFileSync('git', ['-c', 'user.name=spike', '-c', 'user.email=spike@local', 'commit', '-qm', 'scratch copy'], { cwd: dest });
console.log(`prepared ${dest} (project "Spike2 ${label}", port ${port})`);
