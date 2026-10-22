# Spike 1: render from a pinned bundle, driven by the build tool

*22 October 2026 · script: [`spikes/render-standalone/run.mjs`](../../spikes/render-standalone/run.mjs)*

**Question:** can the sprite renderer run from a fixed, content-hashed bundle launched by the build tool itself,
with no Vite dev server and no "which build is the server serving" guess, and produce the same frames as today?

**Setup:** American Soldier 01, one walk clip, 8 directions (80 frames, 58×102), generic format, frame cache off.
The old generator still answered the data API (a private instance on a random port, runner off, a private copy of the
database); the browser page was loaded from `bundle-<hash>/` by request interception, under a made-up origin, so no
web server was involved.

## Result: pass

| | Software (SwiftShader) | GPU (GTX 1060, EGL) |
|---|---|---|
| Old path (server serves its `dist`) | 2.1 s | 1.6 s |
| Pinned bundle, run 1 | 2.2 s | 1.3 s |
| Pinned bundle, run 2 | 2.2 s | 1.3 s |
| Sheet pixels, old vs bundle | identical | identical |
| Sheet pixels, run 1 vs run 2 | identical | identical |

Times are page load to batch done, Blender bakes already cached.

## Findings

1. **The process model works unchanged.** The renderer code needs no edits to run from a hashed bundle with a
   script answering its requests. Moving the data API in-process (P2) is a matter of replacing the forwarder.
2. **One non-deterministic field:** the manifest's `generatedAt` timestamp is the only difference between runs. In the
   Sloponator outputs are content-addressed, so it goes (or moves out of the hashed output).
3. **GPU and software frames differ:** 28,458 of 473,280 pixels (6%) differ between SwiftShader and the GTX 1060, up
   to 247 levels (edges and anti-aliasing). **The old frame-cache key does not include the backend**, so a sheet
   built from cached GPU frames plus fresh software frames (or the reverse) mixes the two looks. The Sloponator's key
   and render goldens must include the backend; goldens are kept per backend.
4. **No blank frames in 80 GPU frames here.** The old blank-frame problem (about 1 in 10 under load) was not
   reproduced in this small run; the blank-frame check and retry stays in the P2 plan.
5. **Bundle identity is checkable.** The script hashes the bundle and the old server's `dist`; today they matched,
   but nothing in the old system checks it.

**Gate decision for the renderer:** keep three.js as a pinned render bundle (option a). The Blender fallback is not
needed.
