/**
 * `ssg.textures.json` (CS-FB-021): a folder of library textures kept in step with this file. Ported from the old
 * generator's packages/client/src/textures.ts (parseTexturesFile): unknown keys are errors, `comment` is allowed
 * anywhere.
 */
import { z } from 'zod';
import { doc, opt } from '../meta.js';

export const TEXTURE_FORMATS = ['png', 'webp'] as const;

const textureFields = {
  pack: opt(z.string().min(1), { help: 'The pack to look in when several have a texture of that name.', example: 'POLYGON_War' }).optional(),
  size: opt(z.number().int().min(8).max(8192), { help: 'Largest side in pixels, 8–8192: scaled down to fit, never up.', example: 512 }).optional(),
  format: opt(z.enum(TEXTURE_FORMATS), { help: 'The image format written: png or webp.' }).optional(),
  comment: opt(z.unknown(), { help: 'A note for people; ignored.', cli: false }).optional(),
};

export const textureDecl = doc(
  z.strictObject({
    name: opt(z.string().min(1), { help: 'File name in the folder (without extension); unique. Default: the texture file\'s own name.', example: 'ground-sand' }).optional(),
    texture: opt(z.union([z.string().min(1), z.number().int().positive()]), { help: 'A texture name, a path from `textures --all` (Pack/…/File.png), or an asset id.', example: 'POLYGON_Generic_v3/Textures/Generic_Grass.png' }),
    ...textureFields,
  }),
  { id: 'texture', title: 'Texture', summary: 'One texture to export: `<name>.png` (or `.webp`) and `<name>.json` (size, background and frame grid) in the folder.' },
);
export type TextureDecl = z.infer<typeof textureDecl>;

export const textureDefaults = doc(z.strictObject(textureFields), { id: 'texture-defaults', title: 'Texture defaults', summary: 'Settings every texture starts from (`defaults`): a texture\'s own keys win.' });

const safeBase = (s: string) => s.replace(/[^\w.-]+/g, '_');
const nameOf = (t: TextureDecl) => safeBase((t.name?.trim() || String(t.texture).split('/').pop()!.replace(/\.(png|tga)$/i, '')).toLowerCase());

export const texturesFile = doc(
  z
    .strictObject({
      $schema: opt(z.string(), { help: 'The JSON Schema this file follows (editors use it); ignored.', cli: false }).optional(),
      comment: opt(z.unknown(), { help: 'A note for people; ignored.', cli: false }).optional(),
      textures: opt(z.array(textureDecl), { help: 'The textures to keep in the folder.', cli: false }),
      defaults: opt(textureDefaults, { help: 'Settings for every texture (size, format, pack).', cli: false }).optional(),
    })
    .superRefine((f, ctx) => {
      const seen = new Map<string, number>();
      f.textures.forEach((t, i) => {
        const k = nameOf(t);
        const first = seen.get(k);
        if (first !== undefined) ctx.addIssue({ code: 'custom', path: ['textures', i, 'name'], message: `the name "${t.name ?? k}" is used twice (also textures[${first}]); names are file names, so each must differ` });
        else seen.set(k, i);
      });
    }),
  { id: 'textures-file', title: 'ssg.textures.json', summary: 'Declares the library textures a game keeps in a folder (`slop build` writes each as an image plus a `.json` of its size, background and frame grid, and removes the ones no longer declared).' },
);
export type TexturesFile = z.infer<typeof texturesFile>;
