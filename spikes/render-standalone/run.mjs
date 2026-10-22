#!/usr/bin/env node
// P0 spike 1: render a sprite from a pinned, content-hashed renderer bundle, driven by this script.
//
//   node spikes/render-standalone/run.mjs [--gpu software|nvidia] [--asset 378] [--work <dir>]
//
// What it proves: the renderer runs from a fixed bundle (no Vite, no dist guessing), launched and fed by the
// build tool itself, and its frames match the current system's (the old server serving its own apps/web/dist).
// The old generator still answers the data API here (a private instance on a random port with its runner off and a
// private copy of the database); replacing that with in-process handlers is P2 work.
//
// It never touches the shared servers (5180/5181) or the shared database: the database is copied, the heavy
// read-only folders (packs, glb, bakes…) are symlinked, and outputs / frame cache are private.
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const SSG = process.env.SSG_ROOT ?? path.resolve(process.env.HOME, 'projects/synty-sprite-generator');
const require = createRequire(path.join(SSG, 'apps/server/package.json'));
const Database = require('better-sqlite3');
const { chromium } = require('@playwright/test');
const { unzipSync } = require('fflate');
const { PNG } = require('pngjs');

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const GPU = args.gpu ?? 'software';
const ASSET = Number(args.asset ?? 378); // Character_American_Soldier_01
const WORK = path.resolve(args.work ?? path.join(process.env.TMPDIR ?? '/tmp', 'slop-spike1'));
const log = (...a) => console.log(`[spike ${((performance.now()) / 1000).toFixed(1)}s]`, ...a);

fs.mkdirSync(WORK, { recursive: true });

// 1. Private data dir: copied database, shared read-only folders, private outputs.
const DATA = path.join(WORK, 'data');
function setupData() {
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.mkdirSync(DATA, { recursive: true });
  for (const d of ['packs', 'glb', 'thumbs', 'meta', 'bakes', 'rigs', 'models']) {
    const src = path.join(SSG, 'data', d);
    if (fs.existsSync(src)) fs.symlinkSync(src, path.join(DATA, d));
  }
  const src = new Database(path.join(SSG, 'data/library.db'), { readonly: true });
  return src.backup(path.join(DATA, 'library.db')).then(() => {
    src.close();
    // The copy must not hand this runner someone else's unfinished batch.
    const db = new Database(path.join(DATA, 'library.db'));
    db.prepare(`UPDATE batches SET status = 'cancelled' WHERE status IN ('queued', 'running')`).run();
    db.close();
  });
}

// 2. The pinned renderer bundle: vite build of apps/web into a folder named by the hash of its contents.
function hashDir(dir) {
  const h = crypto.createHash('sha256');
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else h.update(path.relative(dir, p)).update(fs.readFileSync(p));
    }
  };
  walk(dir);
  return h.digest('hex').slice(0, 16);
}
function buildBundle() {
  const tmp = path.join(WORK, 'bundle-build');
  fs.rmSync(tmp, { recursive: true, force: true });
  execFileSync('npx', ['vite', 'build', '--outDir', tmp, '--emptyOutDir', '--logLevel', 'warn'], { cwd: path.join(SSG, 'apps/web'), stdio: 'inherit' });
  const id = hashDir(tmp);
  const dir = path.join(WORK, `bundle-${id}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(tmp, dir);
  return { id, dir };
}

// 3. A private old-generator server: data API only (runner off, no ingest resume, loopback only).
function freePort() {
  return new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
}
async function startServer(port) {
  const env = { ...process.env, SSG_DATA_DIR: DATA, SSG_PORT: String(port), SSG_HOST: '127.0.0.1', SSG_HEADLESS_RUNNER: 'off', SSG_RESUME_INGEST: 'off', SSG_WEB_URL: 'http://127.0.0.1:9' };
  const child = spawn('npx', ['tsx', 'src/main.ts'], { cwd: path.join(SSG, 'apps/server'), env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const out = fs.createWriteStream(path.join(WORK, 'server.log'));
  child.stdout.pipe(out); child.stderr.pipe(out);
  const origin = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${origin}/api/health`)).ok) return { child, origin }; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`private server did not start; see ${path.join(WORK, 'server.log')}`);
}

// 4. The spec: one walk clip, 8 directions, the generic format, no frame cache.
function specFor(db) {
  const generic = JSON.parse(db.prepare('select spec from batches where id=599').get().spec).profile;
  const view = JSON.parse(db.prepare('select spec from batches where id=666').get().spec).view;
  return {
    name: 'spike1 soldier walk', assetIds: [ASSET], view, profile: generic, layers: [], gender: 'auto', uniformFrame: true, noCache: true,
    set: { id: 'adhoc', name: 'Walk_F', items: [{ type: 'anim', pack: 'ANIMATION_Base_Locomotion', category: 'Locomotion/Walk', name: 'Walk_F', rootMotion: false, gender: null, label: 'walk' }] },
  };
}

const launchFor = (gpu) => {
  const env = { ...process.env }; delete env.DISPLAY; delete env.WAYLAND_DISPLAY;
  if (gpu === 'nvidia') {
    const v = '/usr/share/glvnd/egl_vendor.d/10_nvidia.json';
    return { env: { ...env, __NV_PRIME_RENDER_OFFLOAD: '1', __GLX_VENDOR_LIBRARY_NAME: 'nvidia', __EGL_VENDOR_LIBRARY_FILENAMES: v }, args: ['--headless=new', '--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist'] };
  }
  return { env, args: ['--use-gl=angle', '--use-angle=swiftshader'] };
};

/** Render one batch with a page either served by the old server (`reference`) or from the pinned bundle (`spike`). */
async function render(kind, server, bundle, spec) {
  const created = await (await fetch(`${server.origin}/api/batches`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ spec }) })).json();
  const id = created.id ?? created.batch?.id;
  if (!id) throw new Error(`batch not created: ${JSON.stringify(created).slice(0, 300)}`);
  const l = launchFor(GPU);
  const browser = await chromium.launch({ env: l.env, args: l.args });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.on('pageerror', (e) => log(`${kind} page error:`, e.message));
  let url;
  if (kind === 'spike') {
    // The page's origin is a name only this browser knows; the script answers every request.
    const ORIGIN = 'http://slop.render';
    await page.route(`${ORIGIN}/**`, async (route) => {
      const u = new URL(route.request().url());
      if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/files/')) {
        if (u.pathname === '/api/events') return route.fulfill({ status: 204, body: '' });
        const r = await route.fetch({ url: server.origin + u.pathname + u.search });
        return route.fulfill({ response: r });
      }
      const file = path.join(bundle.dir, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname));
      if (!file.startsWith(bundle.dir) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: 'not in bundle' });
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' }[path.extname(file)] ?? 'application/octet-stream';
      return route.fulfill({ status: 200, contentType: type, body: fs.readFileSync(file) });
    });
    url = `${ORIGIN}/#/runner?mode=headless`;
  } else {
    url = `${server.origin}/#/runner?mode=headless`;
  }
  const t0 = performance.now();
  await page.goto(url);
  const glRenderer = await page.evaluate(`(() => { const gl = document.createElement('canvas').getContext('webgl2'); const x = gl && gl.getExtension('WEBGL_debug_renderer_info'); return gl ? String(x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : 'no WebGL'; })()`);
  let b;
  for (;;) {
    b = await (await fetch(`${server.origin}/api/batches/${id}`)).json();
    if (['done', 'error', 'cancelled'].includes(b.status)) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const seconds = (performance.now() - t0) / 1000;
  await browser.close();
  const item = (b.items ?? [])[0] ?? {};
  log(`${kind}: batch ${id} ${b.status} in ${seconds.toFixed(1)} s on ${glRenderer}${item.error ? ` (${item.error})` : ''}`);
  if (b.status !== 'done') throw new Error(`${kind} batch ${id} ended ${b.status}: ${JSON.stringify(b).slice(0, 400)}`);
  const zip = path.join(DATA, 'outputs', `batch-${id}`);
  const file = fs.readdirSync(zip).find((f) => f.endsWith('.zip'));
  return { id, seconds, glRenderer, files: unzipSync(fs.readFileSync(path.join(zip, file))) };
}

function compare(a, b) {
  const names = [...new Set([...Object.keys(a.files), ...Object.keys(b.files)])].sort();
  const rows = [];
  for (const n of names) {
    const x = a.files[n], y = b.files[n];
    if (!x || !y) { rows.push({ file: n, result: x ? 'only in reference' : 'only in spike' }); continue; }
    if (Buffer.compare(Buffer.from(x), Buffer.from(y)) === 0) { rows.push({ file: n, result: 'identical' }); continue; }
    if (!n.endsWith('.png')) { rows.push({ file: n, result: 'differs (text)' }); continue; }
    const p = PNG.sync.read(Buffer.from(x)), q = PNG.sync.read(Buffer.from(y));
    if (p.width !== q.width || p.height !== q.height) { rows.push({ file: n, result: `size ${p.width}x${p.height} vs ${q.width}x${q.height}` }); continue; }
    let diff = 0, max = 0;
    for (let i = 0; i < p.data.length; i += 4) {
      const d = Math.max(Math.abs(p.data[i] - q.data[i]), Math.abs(p.data[i + 1] - q.data[i + 1]), Math.abs(p.data[i + 2] - q.data[i + 2]), Math.abs(p.data[i + 3] - q.data[i + 3]));
      if (d) { diff++; max = Math.max(max, d); }
    }
    rows.push({ file: n, result: diff ? `${diff} pixels differ (max ${max})` : 'same pixels, different encoding' });
  }
  return rows;
}

let server;
try {
  log(`work dir ${WORK}, gpu ${GPU}, asset ${ASSET}`);
  await setupData();
  log('private database copied');
  const bundle = buildBundle();
  const dist = path.join(SSG, 'apps/web/dist');
  const distId = fs.existsSync(dist) ? hashDir(dist) : 'missing';
  log(`renderer bundle ${bundle.id}; the old server's apps/web/dist is ${distId}${distId === bundle.id ? ' (same)' : ' (DIFFERENT: the old path would render other code)'}`);
  server = await startServer(await freePort());
  log(`private data API at ${server.origin}`);
  const db = new Database(path.join(DATA, 'library.db'), { readonly: true });
  const spec = specFor(db);
  db.close();
  const ref = await render('reference', server, bundle, spec);
  const spk = await render('spike', server, bundle, spec);
  const again = await render('spike', server, bundle, spec);
  const rows = compare(ref, spk);
  const det = compare(spk, again);
  const report = { when: new Date().toISOString(), gpu: GPU, asset: ASSET, bundle: bundle.id, oldDist: distId, reference: { seconds: ref.seconds, gl: ref.glRenderer }, spike: { seconds: spk.seconds, gl: spk.glRenderer }, spikeAgain: { seconds: again.seconds }, referenceVsSpike: rows, spikeVsSpikeAgain: det };
  fs.writeFileSync(path.join(WORK, `report-${GPU}.json`), JSON.stringify(report, null, 2));
  const summary = (r) => Object.entries(r.reduce((m, x) => ((m[x.result.replace(/^\d+ pixels/, 'N pixels')] = (m[x.result.replace(/^\d+ pixels/, 'N pixels')] ?? 0) + 1), m), {})).map(([k, v]) => `${v}× ${k}`).join(', ');
  log(`reference vs spike: ${summary(rows)}`);
  log(`spike vs spike again: ${summary(det)}`);
  for (const r of [...rows, ...det].filter((x) => x.result !== 'identical').slice(0, 12)) log('  ', r.file, r.result);
  log(`report: ${path.join(WORK, `report-${GPU}.json`)}`);
} finally {
  if (server) try { process.kill(-server.child.pid); } catch { /* gone */ }
}
