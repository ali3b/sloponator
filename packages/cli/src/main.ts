/**
 * `slop`: the Sloponator's command line. P2: `slop build <ssg.assets.json> --out <dir>`. One flat argument parser,
 * no framework; the declaration files' options come from @slop/schema, not from flags.
 */
import { GPU_CHOICES, type GpuChoice } from '@slop/render';
import { build, BuildError, type BuildResult } from './build/build.js';

const HELP = `slop build <ssg.assets.json> --out <dir> [options]

  Build a game's content pack from its declaration file: every sprite rendered (from the frame cache when nothing
  changed) and written to <dir>/<name>/ with its sheets and manifests, exactly as the old generator's
  \`ssg sprite apply --render --download\` wrote them.

  --out <dir>         where the pack goes (required)
  --gpu <mode>        auto (the GPU when a driver is found, default) | nvidia | egl | software (SwiftShader)
  --only <names>      build only these sprites (comma-separated; may repeat)
  --force             render every frame again, nothing from the frame cache
  --data-dir <dir>    the old generator's data dir (default $SLOP_OLD_DATA_DIR or ~/projects/synty-sprite-generator/data)
  --cache-dir <dir>   the render bundle and frame cache (default $SLOP_CACHE_DIR or ~/.cache/slop)
  --json              print a machine-readable summary on stdout (progress stays on stderr)
  -h, --help          this
`;

interface Args {
  command?: string;
  file?: string;
  out?: string;
  gpu: GpuChoice;
  only: string[];
  force: boolean;
  dataDir?: string;
  cacheDir?: string;
  json: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): Args {
  const a: Args = { gpu: 'auto', only: [], force: false, json: false, help: false };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]!;
    const next = () => {
      const n = argv[++i];
      if (n === undefined) throw new BuildError(`${v} needs a value`);
      return n;
    };
    if (v === '-h' || v === '--help') a.help = true;
    else if (v === '--out') a.out = next();
    else if (v === '--gpu') {
      const g = next() as GpuChoice;
      if (!GPU_CHOICES.includes(g)) throw new BuildError(`--gpu must be one of ${GPU_CHOICES.join(', ')}`);
      a.gpu = g;
    } else if (v === '--only') a.only.push(...next().split(',').map((s) => s.trim()).filter(Boolean));
    else if (v === '--force') a.force = true;
    else if (v === '--data-dir') a.dataDir = next();
    else if (v === '--cache-dir') a.cacheDir = next();
    else if (v === '--json') a.json = true;
    else if (v.startsWith('-')) throw new BuildError(`unknown option ${v}\n\n${HELP}`);
    else positional.push(v);
  }
  a.command = positional[0];
  a.file = positional[1];
  return a;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let a: Args;
  try {
    a = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    return 2;
  }
  if (a.help || !a.command) {
    process.stdout.write(HELP);
    return a.help ? 0 : 2;
  }
  if (a.command !== 'build') {
    process.stderr.write(`unknown command "${a.command}"\n\n${HELP}`);
    return 2;
  }
  if (!a.file || !a.out) {
    process.stderr.write(`slop build needs the declaration file and --out <dir>\n\n${HELP}`);
    return 2;
  }
  let r: BuildResult;
  try {
    r = await build({ file: a.file, out: a.out, gpu: a.gpu, only: a.only.length ? a.only : undefined, force: a.force, dataDir: a.dataDir, cacheDir: a.cacheDir, log: (m) => process.stderr.write(`${m}\n`) });
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    return 1;
  }
  for (const s of r.skipped) process.stderr.write(`skipped: ${s}\n`);
  if (a.json) process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
  else {
    for (const s of r.sprites) process.stdout.write(`${s.name}\t${s.asset}\t${s.error ? `FAILED: ${s.error}` : `${s.files.length} files, ${s.frames} frames (${s.cached} cached)`}\n`);
    process.stdout.write(`${r.sprites.filter((s) => !s.error).length}/${r.sprites.length} sprites built in ${r.seconds} s on ${r.backend} (${r.glRenderer}), bundle ${r.bundle}, into ${r.out}\n`);
  }
  return r.ok ? 0 : 1;
}
