#!/usr/bin/env node
// Builds run.json from one run: analyse.mjs <resDir> <model> <task> <wallSeconds> <exit> <capped> <infra> <strayed> <notesJson>
import fs from 'node:fs';
import path from 'node:path';
const [dir, model, task, wall, exit, capped, infra, strayed, notesJson] = process.argv.slice(2);
const lines = fs.readFileSync(path.join(dir, 'transcript.jsonl'), 'utf8').split('\n').filter(Boolean);
const ev = [];
for (const l of lines) { try { ev.push(JSON.parse(l)); } catch { ev.push({ type: 'unparsable', raw: l.slice(0, 200) }); } }
const log = fs.existsSync(path.join(dir, 'opencode.log')) ? fs.readFileSync(path.join(dir, 'opencode.log'), 'utf8') : '';
const steps = ev.filter((e) => e.type === 'step_start').length;
const tools = ev.filter((e) => e.type === 'tool_use');
const toolNames = {};
let toolErrors = 0, toolErrorSamples = [];
for (const t of tools) {
  const name = t.part?.tool ?? '?';
  toolNames[name] = (toolNames[name] ?? 0) + 1;
  if (t.part?.state?.status === 'error') { toolErrors++; if (toolErrorSamples.length < 8) toolErrorSamples.push(`${name}: ${String(t.part.state.error ?? '').slice(0, 160)}`); }
}
const errors = ev.filter((e) => e.type === 'error').map((e) => String(e.error?.data?.message ?? e.error?.name ?? '').slice(0, 200));
const logLines = log.split('\n');
const rateLimited = logLines.filter((l) => /stream error/.test(l) && /429|rate-limited|rate limit/i.test(l)).length;
const streamErrors = logLines.filter((l) => /stream error/.test(l)).length;
const malformed = logLines.filter((l) => /InvalidToolInput|NoSuchTool|InvalidToolArguments|invalid.*tool.*(input|argument)|tool_call.*(parse|malformed)/i.test(l)).length
  + tools.filter((t) => /InvalidToolInput|NoSuchTool|invalid.*(input|argument)/i.test(String(t.part?.state?.error ?? ''))).length;
const finishes = ev.filter((e) => e.type === 'step_finish').map((e) => e.part?.reason);
const tokens = ev.filter((e) => e.type === 'step_finish').reduce((a, e) => ({ input: a.input + (e.part?.tokens?.input ?? 0), output: a.output + (e.part?.tokens?.output ?? 0), reasoning: a.reasoning + (e.part?.tokens?.reasoning ?? 0) }), { input: 0, output: 0, reasoning: 0 });
const grade = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'grade.json'), 'utf8')); } catch { return null; } })();
const out = {
  model, task, harness: 'opencode 1.19.0',
  calls: steps, wallSeconds: Number(wall), exit: Number(exit),
  rateLimited, infraFailure: infra === '1', cappedAt40Calls: capped === '1', timedOut: Number(exit) === 124,
  toolCalls: tools.length, toolCallErrors: toolErrors, malformedToolCalls: malformed, toolNames,
  streamErrors, finishReasons: finishes.reduce((a, r) => (a[r] = (a[r] ?? 0) + 1, a), {}),
  tokens, errors: errors.slice(0, 5), toolErrorSamples,
  strayedOutsideCopy: strayed === 'true',
  grade: grade && { pass: grade.pass, typecheck: grade.typecheck, loadCheck: grade.loadCheck, feature: grade.feature },
  notes: JSON.parse(notesJson || '[]'),
};
console.log(JSON.stringify(out, null, 2));
