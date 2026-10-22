// One zod object drives four surfaces: JSON Schema, CLI options, an MCP tool and a markdown table.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { cliOptions, docSections, markdownReference, markdownTable, mcpTool, parseCliValues, spriteDecl, textureDecl, texturesFile, toJsonSchema, assetsFile, modelsFile, modelSpec, doc, opt } from '../src/index.js';

const demo = doc(
  z.strictObject({
    name: opt(z.string().min(1), { help: 'The name.', example: 'hero' }),
    ppm: opt(z.number().positive(), { help: 'Pixels per metre.', example: 64 }).optional(),
    mirror: opt(z.boolean(), { help: 'Flip the rest.' }).default(false),
    look: opt(z.enum(['clean', 'pixel']), { help: 'The look.' }).optional(),
    tags: opt(z.array(z.string()), { help: 'Tags.' }).optional(),
    metresPerTile: opt(z.number(), { help: 'Metres a tile covers.' }).optional(),
    fx: opt(z.union([z.boolean(), z.strictObject({ enabled: z.boolean() })]), { help: 'FX.' }).optional(),
    secret: opt(z.string(), { help: 'Not on the CLI.', cli: false }).optional(),
  }),
  { id: 'demo', title: 'Demo', summary: 'A demo object.' },
);

describe('JSON Schema', () => {
  it('carries the help as descriptions, examples, strict objects and $defs for documented objects', () => {
    const js = toJsonSchema(demo) as { $schema: string; properties: Record<string, Record<string, unknown>>; required: string[]; additionalProperties: boolean };
    expect(js.$schema).toContain('draft-07');
    expect(js.properties.ppm).toMatchObject({ type: 'number', description: 'Pixels per metre.', examples: [64] });
    expect(js.properties.look).toMatchObject({ enum: ['clean', 'pixel'] });
    expect(js.required).toEqual(['name']);
    expect(js.additionalProperties).toBe(false);
    expect(js.properties.ppm).not.toHaveProperty('flag');
  });
  it('names documented objects in $defs and references them', () => {
    const js = toJsonSchema(assetsFile) as { definitions: Record<string, unknown>; properties: Record<string, Record<string, unknown>>; additionalProperties: boolean };
    expect(Object.keys(js.definitions)).toEqual(expect.arrayContaining(['sprite', 'anim', 'template', 'tileset', 'terrain', 'light', 'sprite-defaults']));
    expect(Object.keys(js.definitions).filter((k) => k.startsWith('__'))).toEqual([]);
    expect(JSON.stringify(js.properties.sprites)).toContain('#/definitions/sprite');
    expect(js.additionalProperties).toBe(false);
    expect(js.properties.fps).toMatchObject({ type: 'number', description: 'Frames per second sampled from the clips.' });
    const mcp = toJsonSchema(assetsFile, { target: 'draft-2020-12', reused: 'inline' }) as { $defs?: unknown; properties: Record<string, Record<string, unknown>> };
    expect(mcp.$defs).toBeUndefined();
    expect(JSON.stringify(mcp.properties.sprites)).toContain('"ppm"');
  });
  it('works for every declaration file', () => {
    for (const s of [assetsFile, modelsFile, texturesFile]) expect(toJsonSchema(s)).toHaveProperty('$schema');
  });
});

describe('CLI options', () => {
  it('spells flags from the keys with placeholders from the types, and parses the text back', () => {
    const opts = cliOptions(demo);
    expect(opts.map((o) => o.flags)).toEqual(['--name <text>', '--ppm <n>', '--mirror [true|false]', '--look <clean|pixel>', '--tags <a,b,…>', '--metres-per-tile <n>', '--fx <json>']);
    expect(opts.find((o) => o.key === 'mirror')).toMatchObject({ default: false, description: 'Flip the rest.' });
    expect(opts.find((o) => o.key === 'look')?.choices).toEqual(['clean', 'pixel']);
    const by = Object.fromEntries(opts.map((o) => [o.key, o]));
    expect(by.ppm!.parse('64')).toBe(64);
    expect(by.ppm!.parse('abc')).toBe('abc');
    expect(by.mirror!.parse('')).toBe(true);
    expect(by.mirror!.parse('false')).toBe(false);
    expect(by.tags!.parse('a, b')).toEqual(['a', 'b']);
    expect(by.tags!.parse('c', ['a'])).toEqual(['a', 'c']);
    expect(by.fx!.parse('{"enabled":true}')).toEqual({ enabled: true });
    expect(by.fx!.parse('true')).toBe(true);
  });
  it('validates collected values with teaching errors', () => {
    const ok = parseCliValues(demo, { name: 'x', ppm: 64, mirror: undefined });
    expect(ok.ok && ok.value).toEqual({ name: 'x', ppm: 64, mirror: false });
    const bad = parseCliValues(demo, { name: 'x', look: 'pixle' });
    expect(!bad.ok && bad.errors[0]!.message).toContain('Did you mean "pixel"?');
  });
  it('the sprite keys make export flags, the file-only keys do not', () => {
    const flags = cliOptions(spriteDecl).map((o) => o.flags);
    expect(flags).toContain('--asset <value>');
    expect(flags).toContain('--pixel-art [true|false]');
    expect(flags).toContain('--dirs <a,b,…>');
    expect(flags).toContain('--scale <value>');
    expect(cliOptions(modelSpec).map((o) => o.key)).not.toContain('trackpiece');
    expect(cliOptions(textureDecl).map((o) => o.key)).not.toContain('comment');
  });
});

describe('MCP tool', () => {
  it('is a 2020-12 input schema with the descriptions', () => {
    const tool = mcpTool('apply_textures', texturesFile);
    expect(tool.name).toBe('apply_textures');
    expect(tool.description).toContain('Declares the library textures');
    expect(tool.inputSchema).not.toHaveProperty('$schema');
    expect(tool.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
    const props = tool.inputSchema.properties as Record<string, Record<string, unknown>>;
    expect(props.textures).toMatchObject({ type: 'array', description: 'The textures to keep in the folder.' });
  });
});

describe('markdown', () => {
  it('a table with key, type, required, example and help', () => {
    const md = markdownTable(demo);
    expect(md).toContain('| `name` | text | yes | `hero` | The name. |');
    expect(md).toContain('| `mirror` | true \\| false | default `false` |  | Flip the rest. |');
    expect(md).toContain('| `look` | "clean" \\| "pixel" |  |  | The look. |');
  });
  it('a reference walks every documented object once, in order, with anchors', () => {
    const ids = docSections(assetsFile).map((s) => s.meta.id);
    expect(ids[0]).toBe('assets-file');
    expect(ids).toEqual(expect.arrayContaining(['sprite', 'anim', 'template', 'sprite-defaults', 'tileset', 'terrain', 'light', 'portrait', 'split', 'turret', 'fx', 'state']));
    expect(new Set(ids).size).toBe(ids.length);
    const md = markdownReference(assetsFile);
    expect(md).toContain('<a id="assets-file"></a>\n# ssg.assets.json');
    expect(md).toContain('<a id="sprite"></a>\n## Sprite');
    expect(ids.indexOf('sprite')).toBeLessThan(ids.indexOf('sprite-defaults'));
    expect(md).toContain('[Anim entry](#anim)');
    expect(md).toContain('Old spellings (an error names the key to use): `model` → `asset`');
  });
});
