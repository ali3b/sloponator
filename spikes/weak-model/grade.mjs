#!/usr/bin/env node
// Grades one run: node grade.mjs <runDir> <T1|T2> <port>  → prints JSON {typecheck, loadCheck, feature, pass, notes}
// Starts its own vite on <port>, so stop the model's dev server first (or pass the port it is already on with --reuse).
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const [dir, task, portArg] = process.argv.slice(2);
const reuse = process.argv.includes('--reuse');
const port = Number(portArg);
const require = createRequire(path.join(dir, 'package.json'));
const { chromium } = require('@playwright/test');
const out = { task, typecheck: false, loadCheck: false, feature: false, pass: false, notes: [] };
const run = (cmd, args, opts = {}) => { try { return { ok: true, out: execFileSync(cmd, args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000, ...opts }) }; } catch (e) { return { ok: false, out: String(e.stdout ?? '') + String(e.stderr ?? e.message) }; } };

const tc = run('npx', ['tsc', '--noEmit']);
out.typecheck = tc.ok; if (!tc.ok) out.notes.push('typecheck: ' + tc.out.split('\n').slice(0, 3).join(' | '));

let vite;
if (!reuse) {
  vite = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${port}/`)).ok) break; } catch { } await new Promise((r) => setTimeout(r, 500)); }
}
try {
  const lc = run('node', ['scripts/load-check.mjs', `http://localhost:${port}`, 'room'], { timeout: 240000 });
  out.loadCheck = lc.ok; if (!lc.ok) out.notes.push('load-check: ' + lc.out.split('\n').filter(Boolean).slice(-3).join(' | '));

  const env = { ...process.env }; delete env.DISPLAY; delete env.WAYLAND_DISPLAY;
  const browser = await chromium.launch({ env, args: ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/?scene=room`);
  await page.waitForFunction(() => window.game && window.game.scene.isActive('Room'), null, { timeout: 30000 }).catch(() => out.notes.push('Room scene never became active'));
  await page.waitForTimeout(1500);
  const texts = () => page.evaluate(() => window.game.scene.getScenes(true).flatMap((s) => s.children.list.filter((c) => c.type === 'Text' && c.visible).map((c) => c.text)));
  if (task === 'T1') {
    await page.keyboard.press('KeyP'); await page.waitForTimeout(400);
    const during = await texts();
    const paused = await page.evaluate(() => { const g = window.game; return g.scene.isPaused('Room') || g.scene.getScene('Room').physics?.world?.isPaused === true || g.scene.getScene('Room').time?.paused === true; });
    await page.keyboard.press('KeyP'); await page.waitForTimeout(400);
    const after = await texts();
    const shown = during.some((t) => /paused/i.test(t)), gone = !after.some((t) => /paused/i.test(t));
    out.feature = shown && gone && paused;
    out.notes.push(`T1: PAUSED shown=${shown} removed=${gone} scenePaused=${paused}`);
  } else {
    const decl = JSON.parse(fs.readFileSync(path.join(dir, 'ssg.assets.json'), 'utf8'));
    const declared = (decl.sprites ?? []).some((s) => s.name === 'guard' && /Skeleton_Knight/.test(s.asset ?? ''));
    const built = fs.existsSync(path.join(dir, 'public/assets/guard')) && fs.readdirSync(path.join(dir, 'public/assets/guard')).some((f) => f.endsWith('.png'));
    const onScreen = await page.evaluate(() => { const s = window.game.scene.getScene('Room'); return s.children.list.some((c) => c.type === 'Sprite' && c.visible && /guard/i.test(c.texture?.key ?? '') && c.anims?.isPlaying); });
    out.feature = declared && built && onScreen;
    out.notes.push(`T2: declared=${declared} built=${built} idleOnScreen=${onScreen}`);
  }
  if (errors.length) out.notes.push('page errors: ' + errors.slice(0, 2).join(' | '));
  await browser.close();
} finally {
  if (vite) try { process.kill(-vite.pid); } catch { }
}
out.pass = out.typecheck && out.loadCheck && out.feature;
console.log(JSON.stringify(out));
