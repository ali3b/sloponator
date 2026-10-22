#!/usr/bin/env node
// `slop`: runs the TypeScript sources through tsx (no build step while the Sloponator is a workspace of sources).
import { register } from 'tsx/esm/api';

register();
const { main } = await import(new URL('../src/main.ts', import.meta.url).href);
process.exitCode = await main();
