#!/usr/bin/env node
// Makes the render goldens' reference: Monty's ssg.assets.json rendered by the OLD generator, privately (the trick
// of spikes/render-standalone/run.mjs: a copy of its database, its heavy folders symlinked, a server of its own on a
// random loopback port with the runner off, and a headless Chromium launched here on its runner page), through its
// own CLI (`ssg sprite apply --force --render --download`), so the files are exactly what a game got.
//
//   node packages/cli/test/goldens/make-reference.mjs [--gpu software|nvidia] [--only joe,skull] [--out <dir>]
//
// Writes <out>/<sprite>/<files> (default ~/.cache/slop/goldens/<backend>/monty, git-ignored: Synty art is never
// committed) and <out>/reference.json: the SHA-256 of every file, the manifests' text, the renderer that drew them.
// The committed part is packages/cli/test/goldens/monty.<backend>.json (reference.json copied there); the test
// (goldens.test.ts) compares a fresh `slop build` against the PNGs in <out> pixel for pixel and skips when they are
// absent. Nothing here writes into the old generator's data dir or talks to its shared servers (5180/5181).
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SSG = process.env.SSG_ROOT ?? path.resolve(process.env.HOME, 'projects/synty-sprite-generator');
const require = createRequire(path.join(SSG, 'apps/server/package.json'));
const Database = require('better-sqlite3');
const { chromium } = require('@playwright/test');

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const GPU = args.gpu ?? 'software';
const backend = GPU === 'software' ? 'software' : 'gpu';
const ONLY = args.only ? args.only.split(',').map((s) => s.trim()).filter(Boolean) : null;
const cacheDir = process.env.SLOP_CACHE_DIR ?? path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache'), 'slop');
const OUT = path.resolve(args.out ?? path.join(cacheDir, 'goldens', backend, 'monty'));
const WORK = path.join(os.tmpdir(), `slop-goldens-${process.pid}`);
const FIXTURE = path.resolve(here, '../../../schema/test/fixtures/monty.assets.json');
const log = (...a) => console.error(`[reference ${(performance.now() / 1000).toFixed(1)}s]`, ...a);

fs.mkdirSync(WORK, { recursive: true });

// 1. Private data dir: copied database, shared read-only folders, private outputs.
const DATA = path.join(WORK, 'data');
async function setupData() {
  fs.mkdirSync(DATA, { recursive: true });
  for (const d of ['packs', 'glb', 'thumbs', 'meta', 'bakes', 'rigs', 'models']) {
    const src = path.join(SSG, 'data', d);
    if (fs.existsSync(src)) fs.symlinkSync(src, path.join(DATA, d));
  }
  const src = new Database(path.join(SSG, 'data/library.db'), { readonly: true });
  await src.backup(path.join(DATA, 'library.db'));
  src.close();
  const db = new Database(path.join(DATA, 'library.db'));
  // The copy must not hand this runner someone else's unfinished batch.
  db.prepare(`UPDATE batches SET status = 'cancelled' WHERE status IN ('queued', 'running')`).run();
  db.close();
}

// 2. A private old-generator server: data API only (runner off, no ingest resume, loopback only).
function freePort() {
  return new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
}
async function startServer(port) {
  const env = { ...process.env, SSG_DATA_DIR: DATA, SSG_PORT: String(port), SSG_HOST: '127.0.0.1', SSG_HEADLESS_RUNNER: 'off', SSG_RESUME_INGEST: 'off', SSG_WEB_URL: 'http://127.0.0.1:9', SSG_GPU: GPU === 'software' ? 'off' : GPU };
  const child = spawn('npx', ['tsx', 'src/main.ts'], { cwd: path.join(SSG, 'apps/server'), env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const out = fs.createWriteStream(path.join(WORK, 'server.log'));
  child.stdout.pipe(out);
  child.stderr.pipe(out);
  const origin = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${origin}/api/health`)).ok) return { child, origin }; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`private server did not start; see ${path.join(WORK, 'server.log')}`);
}

// 3. The runner page in a Chromium launched here (the server's own runner is off), as the old server would launch it.
const launchFor = (gpu) => {
  const env = { ...process.env };
  delete env.DISPLAY;
  delete env.WAYLAND_DISPLAY;
  if (gpu === 'nvidia') {
    const v = '/usr/share/glvnd/egl_vendor.d/10_nvidia.json';
    return { env: { ...env, __NV_PRIME_RENDER_OFFLOAD: '1', __GLX_VENDOR_LIBRARY_NAME: 'nvidia', __EGL_VENDOR_LIBRARY_FILENAMES: v }, args: ['--headless=new', '--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist'] };
  }
  return { env, args: ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };
};

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

let server, browser;
try {
  if (!fs.existsSync(path.join(SSG, 'apps/web/dist/index.html'))) throw new Error(`the old generator's web app is not built (${SSG}/apps/web/dist): run its npm run build -w apps/web`);
  log(`work dir ${WORK}, gpu ${GPU}, out ${OUT}`);
  await setupData();
  log('private database copied');
  server = await startServer(await freePort());
  log(`private old-generator server at ${server.origin}`);
  const l = launchFor(GPU);
  browser = await chromium.launch({ env: l.env, args: l.args });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.on('pageerror', (e) => log('runner page error:', e.message));
  await page.goto(`${server.origin}/#/runner?mode=headless`);
  const glRenderer = await page.evaluate(`(() => { const gl = document.createElement('canvas').getContext('webgl2'); const x = gl && gl.getExtension('WEBGL_debug_renderer_info'); return gl ? String(x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : 'no WebGL'; })()`);
  log(`runner page up on ${glRenderer}`);
  if (backend === 'gpu' && /swiftshader|no webgl/i.test(glRenderer)) throw new Error(`asked for the GPU but the page renders with ${glRenderer}`);

  // 4. The old CLI applies the fixture (every sprite re-rendered: --force) and downloads the results.
  const file = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const sprites = ONLY ? file.sprites.filter((s) => ONLY.includes(s.name)) : file.sprites;
  const unknown = ONLY ? ONLY.filter((n) => !file.sprites.some((s) => s.name === n)) : [];
  if (unknown.length) throw new Error(`--only names sprites the fixture does not have: ${unknown.join(', ')}`);
  const payload = { ...file, sprites, tilesets: [] };
  const download = path.join(WORK, 'download');
  const t0 = performance.now();
  const r = spawnSync(process.execPath, [path.join(SSG, 'apps/cli/bin/ssg.mjs'), '--json', 'sprite', 'apply', '-', '--force', '--render', '--download', download, '--minutes', '120'], {
    cwd: SSG, input: JSON.stringify(payload), env: { ...process.env, SSG_URL: server.origin, SSG_DATA_DIR: DATA }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'inherit'],
  });
  const seconds = (performance.now() - t0) / 1000;
  let result = null;
  try { result = JSON.parse(r.stdout); } catch { /* not JSON */ }
  if (r.status !== 0 || !result?.ok) throw new Error(`ssg sprite apply exited ${r.status}: ${r.stdout.slice(0, 2000)}`);
  log(`old generator rendered ${sprites.length} sprites in ${seconds.toFixed(1)} s`);

  // 5. The reference: files per sprite, hashes and manifests in reference.json.
  fs.mkdirSync(OUT, { recursive: true });
  const ref = { when: new Date().toISOString(), backend, gpu: GPU, glRenderer, fixture: path.relative(path.resolve(here, '../../../..'), FIXTURE), seconds, sprites: {} };
  for (const s of sprites) {
    const src = path.join(download, s.name);
    const dst = path.join(OUT, s.name);
    fs.rmSync(dst, { recursive: true, force: true });
    fs.mkdirSync(dst, { recursive: true });
    const files = {};
    for (const f of fs.readdirSync(src).filter((f) => fs.statSync(path.join(src, f)).isFile()).sort()) {
      const bytes = fs.readFileSync(path.join(src, f));
      fs.writeFileSync(path.join(dst, f), bytes);
      files[f] = { sha256: sha(bytes), bytes: bytes.length, ...(f.endsWith('.json') ? { text: bytes.toString('utf8') } : {}) };
    }
    const item = result.sprites.find((x) => x.name === s.name);
    ref.sprites[s.name] = { asset: s.asset, files, render: item?.render ?? null };
    log(`${s.name}: ${Object.keys(files).join(', ')}`);
  }
  fs.writeFileSync(path.join(OUT, 'reference.json'), JSON.stringify(ref, null, 2));
  log(`reference written to ${OUT} (${Object.keys(ref.sprites).length} sprites); copy reference.json to packages/cli/test/goldens/monty.${backend}.json to commit it`);
} finally {
  if (browser) await browser.close().catch(() => undefined);
  if (server) try { process.kill(-server.child.pid); } catch { /* gone */ }
  fs.rmSync(WORK, { recursive: true, force: true });
}
