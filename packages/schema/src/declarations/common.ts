/** Pieces several declaration files share: colours, lists that may be comma text, lighting. */
import { z } from 'zod';
import { doc, opt } from '../meta.js';

export const HEX6 = /^#[0-9a-f]{6}$/i;
/** A `#rrggbb` colour. */
export const hexColor = z.string().regex(HEX6, 'must be a colour like "#ff8800"');
/** A `#rgb` or `#rrggbb` colour (the model tint takes both). */
export const hexColor36 = z.string().regex(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i, 'must be a colour like "#ff8800"');

/** A list given as `["a", "b"]` or `"a,b"`. */
export const nameList = z.union([z.string(), z.array(z.string())]);
/** A list given as `["a", "b"]` or one `"a"` (no comma splitting: Pack/Model names stay whole). */
export const refList = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);
/** A project: its name or id. */
export const projectRef = z.union([z.string().min(1), z.number().int().positive()]);
/** An asset: its id, name or `Pack/Name`. */
export const assetRef = z.union([z.string().min(1), z.number().int().positive()]);

export const LIGHT_PRESETS = ['day', 'dusk', 'night', 'overcast', 'desert_noon', 'arctic'] as const;

/** Lighting as an object (FB-060): a preset with overrides. */
export const lightObject = doc(
  z
    .strictObject({
      preset: opt(z.enum(LIGHT_PRESETS), { help: 'The preset the other values start from (default day).' }).optional(),
      ambient: opt(hexColor, { help: 'Ambient (sky) colour.', example: '#8090c0' }).optional(),
      ambientIntensity: opt(z.number().min(0).max(10), { help: 'Ambient strength, 0–10 (day 1.9).' }).optional(),
      key: opt(hexColor, { help: 'Key light (sun or moon) colour.', example: '#ffe0b0' }).optional(),
      keyIntensity: opt(z.number().min(0).max(10), { help: 'Key light strength, 0–10 (day 1.6).' }).optional(),
      azimuth: opt(z.number().min(-360).max(360), { help: 'Where the key light comes from, degrees around the model as the camera sees it: 0 from the camera, 90 from the right, -90 from the left, 180 from behind (day about -34).' }).optional(),
      elevation: opt(z.number().min(1).max(90), { help: 'Height of the key light above the horizon, 1–90 degrees (day about 48).' }).optional(),
    }),
  { id: 'light', title: 'Light', summary: 'Lighting as an object: a preset plus overrides. On a sprite it lights the model; on a tileset the same values grade the ground to match (FB-060).' },
);

/** `light`: a preset name or the object. */
export const light = z.union([z.enum(LIGHT_PRESETS), lightObject]);
