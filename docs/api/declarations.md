# Declaration files

Generated from `packages/schema` by `npm run docs`; do not edit by hand. Each file is validated with unknown keys
rejected, and an error names the key, the nearest valid key and the section here that documents it.

- [`ssg.assets.json`](#assets-file) — JSON Schema: [`ssg.assets.schema.json`](ssg.assets.schema.json)
- [`ssg.models.json`](#models-file) — JSON Schema: [`ssg.models.schema.json`](ssg.models.schema.json)
- [`ssg.textures.json`](#textures-file) — JSON Schema: [`ssg.textures.schema.json`](ssg.textures.schema.json)

<a id="assets-file"></a>
# ssg.assets.json

Declares the sprites (and tilesets) a game needs. `slop build` creates or updates each by name, renders what is outdated and downloads it into the game. Settings for every sprite go in `defaults` or at the top level.

| Key | Type | Required | Example | What it is |
|---|---|---|---|---|
| `$schema` | text |  |  | The JSON Schema this file follows (editors use it); ignored. |
| `comment` | anything |  |  | A note for people; ignored. |
| `description` | anything |  |  | A note for people; ignored. |
| `generatedBy` | anything |  |  | What wrote the file; ignored. |
| `project` | text \| whole number |  | `My Game` | The project's name or id (a new name is created from the settings below); the CLI's --project wins. |
| `sprites` | [[Sprite](#sprite), …] | yes |  | The sprites. |
| `tilesets` | [[Tileset](#tileset), …] |  |  | The tilesets (see Tileset). |
| `maps` | [anything, …] |  |  | Level maps built from the tilesets; checked by the levels package (P4), passed through here. |
| `defaults` | [Sprite defaults](#sprite-defaults) |  |  | Settings for every sprite (the same keys may also sit at the top level); a sprite's own keys win. |
| `kind` | "character" \| "vehicle" \| "object" \| "prop" \| "weapon" |  |  | What the model is (default: from the model). |
| `class` | text \| [text, …] |  | `rifle` | Movesets: "rifle", ["rifle", "pistol"] or "rifle,pistol" (unarmed, sword, knife, bow, staff, launcher, rifle, pistol, martial_arts). |
| `anim` | text \| [Anim entry](#anim) \| [Template entry](#template) \| [text \| [Anim entry](#anim) \| [Template entry](#template), …] |  | `["idle","walk",{"clip":"Knife_Stab_Fore","trim":"0:0.9","with":"POLYGON_Palm_City/SM_Wep_Knife_01"}]` | Clip names, or with class the moves to keep ("idle", "crouch_*"); each may carry its own trim, cap, events and held items ("Clip@0.8:2.6", "Clip@max=2", or an Anim entry object). With class, installed clip names are extra clips under their own names. |
| `template` | text \| [Template entry](#template) \| [text \| [Template entry](#template), …] |  | `still` | Procedural moves: "still", ["crawl", "drive_turn:steer=25"]; with its own held items a Template entry object. |
| `set` | text |  | `builtin_locomotion` | An animation set by id or name (not with class); "none" = only the declared anim/template moves (the default whenever any are declared). |
| `with` | text \| [text, …] |  | `["POLYGON_War/SM_Wep_American_Rifle_01"]` | Held items: "Pack/Model", "@bone", "=layer", ":front", "~class". |
| `states` | text \| { <name>: whole number \| text \| State } |  | `auto,destroyed@destroy` | Objects: "auto", "auto,destroyed@destroy", "auto,intact:drive,destroyed@destroy" or { "intact": { "template": "drive" }, "destroyed": { "asset", "transition" } } (no anim/set/class; a template next to states is the intact state's loop). |
| `view` | "side2" \| "lowthreequarter" \| "jrpg4" \| "topdown8" \| "high8" \| "straightdown" \| "iso8" \| "iso4d" \| "trueiso8" \| "hexflat6" \| "hexpointy6" \| "vehicle16" \| "rts32" \| "rpgmaker" \| "lpc" |  |  | The view preset (default: the project's). |
| `dirs` | whole number \| text \| [text \| number, …] |  | `8` | Directions: 1, 2, 4, 4d, 8, 16… (on an object in an iso view, 1 = one facing of that view), or the directions by name: "E", "N,S", ["N", "S"]. |
| `facings` | 0 \| 1 \| 2 \| 4 |  | `4` | Objects: 1, 2 or 4 grid-aligned facings (0 = use dirs). |
| `slice` | "columns" |  |  | Objects on a diamond tile: "columns" (per-tile-column strips). |
| `collision` | "auto" \| "base" \| "full" \| "concave" |  |  | Objects: full (whole hull), base (ground slice: a trunk), concave (the outline of the slice: curved walls, fences) or auto (default: vehicles, aircraft, buildings full; trees, poles base). |
| `collisionHeight` | number |  | `0.5` | Objects: the ground slice's height in metres above the bottom (default min(0.5, 15% of the height)). |
| `pitch` | number |  | `30` | Camera pitch in degrees (0 = side, 30 = 2:1 iso, 90 = straight down). |
| `projection` | "ortho" \| "persp" |  |  | The camera projection. |
| `frame` | whole number |  | `128` | Square frame size in px (the minimum with ppm/tile). |
| `ppm` | number |  | `64` | Fixed pixels per metre (a sprite's own ppm wins over the file's tile; next to its own tile, the tile wins with a warning). |
| `tile` | text \| null \| false |  | `64x32` | Tile lock "64x32" (iso diamond) or "32x32" (square): the scale from the game's tile; null/false on a sprite leaves the lock (own ppm, or fit). |
| `metresPerTile` | number |  | `1` | With tile: metres one tile covers (default 1). |
| `scale` | "fit" \| number \| text |  | `fit` | "fit": fit the model into the frame (UI icons), leaving the tile lock and ppm; or a number, the model's own size factor (1.3 = a boss 30% bigger, also "130%") at the same ppm/tile lock. |
| `fps` | number |  | `12` | Frames per second sampled from the clips. |
| `mirror` | true \| false |  |  | true: render only right-facing directions; the engine flips the rest. |
| `supersample` | 1 \| 2 \| 3 \| 4 |  | `2` | 1–4: render at N× and average down. |
| `pixelArt` | true \| false |  |  | Pixel-art style (hard edges, model palette, 1 px outline). |
| `outline` | true \| false |  |  | Pixel style: 1 px outline. |
| `palette` | "full" \| "model" \| "levels" |  |  | Pixel style colours: full, model or levels. |
| `shadow` | "off" \| "low" \| "high" \| false |  | `off` | The drop shadow: off, low or high (false = off). |
| `look` | "clean" \| "pixel" \| "hand_painted" \| "stylized" |  |  | Look card: clean, pixel, hand_painted, stylized. |
| `size` | "small" \| "medium" \| "large" \| "xl" |  |  | Size card: small (64 px), medium (128), large (256), xl (512). |
| `format` | text |  | `phaser3` | Engine format: generic, godot4, unity, phaser3, pixi, aseprite, libgdx, gamemaker, rpgmaker, lpc (or a custom profile). |
| `layers` | text \| ["normal" \| "depth" \| "uv" \| "shadow", …] |  | `["normal"]` | Extra layers: normal, depth, uv, shadow. |
| `uniform` | true \| false |  |  | Same frame size and pivot for every direction and clip (fixed scale); the project's sprites of one model with uniform at the same view share one frame and pivot. |
| `atlas` | true \| false |  |  | Pack trimmed frames into atlas pages. |
| `animPrefix` | text |  | `{base}/` | Animation key prefix, tokens {base} {asset} (default: the sprite's name; "" = bare clip_dir). |
| `movePrefix` | true \| false |  |  | With one class: false = bare move names (keys "hero/idle_E", clips "idle") instead of "hero/martial_arts_idle_E". |
| `maxSeconds` | number |  | `3` | Cap every clip at this many seconds (a clip's own maxSeconds in anim wins). |
| `gender` | "auto" \| "Masculine" \| "Feminine" |  |  | Clip gender: auto, Masculine or Feminine. |
| `layered` | true \| false \| "mask" \| "none" |  |  | Held items as separate aligned sheets: true / "mask" (hidden pixels cut away) or "none" (whole items); false (default): baked into one sheet. |
| `fx` | true \| false \| [FX](#fx) |  | `{"enabled":true,"tint":"#ff7a20","intensity":1.2}` | Glowing FX look: true or { "enabled", "tint", "intensity", "blend" }. |
| `light` | "day" \| "dusk" \| "night" \| "overcast" \| "desert_noon" \| "arctic" \| [Light](#light) |  | `dusk` | Lighting (FB-060): day, dusk, night, overcast, desert_noon, arctic (default day), or a Light object. |
| `tags` | [text, …] |  | `["enemy"]` | Sprite tags (default: its movesets). |
| `pivot` | "anchor" \| "origin" |  |  | Objects: the frame pivot in the data files: each direction's object anchor (default) or the model origin. |
| `turret` | true \| false \| "1" \| "2" \| "4" \| "8" \| "12" \| "16" \| "32" \| "4d" \| "6f" \| "6p" \| whole number \| [Turret](#turret) \| null |  | `true` | Vehicles (FB-096): hull and turret as two sheets, the turret's mount per hull direction in the hull's meta: true, or the turret's own dirs "16" / { "dirs": "32" }; false = one sheet. |
| `portrait` | true \| false \| whole number \| text \| [Portrait](#portrait) \| null |  | `240x192,front` | Characters (SF-FB-021): also a head-and-shoulders still <base>_portrait.png: true (256 px, 3/4, transparent), a size, "320x400,front,#203040" or a Portrait object; false = none. |
| `split` | true \| false \| text \| [Split](#split) \| null |  | `waist` | Characters (FB-124): "waist" = a legs sheet and a torso sheet with a per-frame waist socket in both, to aim the torso apart from the walk; or a Split object; false = one sheet. |
| `still` | text \| [text, …] |  | `Victory_Pose@2.4=ending` | One-frame stills of clips or moves: "Victory_Pose@2.4" (source seconds) or a list, each a one-frame animation <Clip>_still per direction ("Clip@2.4=ending" names it). |

Old spellings (an error names the key to use): `model` → `asset`, `classes` → `class`, `moveset` → `class`, `movesets` → `class`, `anims` → `anim`, `animations` → `anim`, `templates` → `template`, `directions` → `dirs`, `frameSize` → `frame`, `uniformFrame` → `uniform`, `metres-per-tile` → `metresPerTile`, `max-seconds` → `maxSeconds`, `pixel-art` → `pixelArt`, `anim-prefix` → `animPrefix`, `move-prefix` → `movePrefix`, `collision-height` → `collisionHeight`, `turretDirs` → `turret`, `turret_dirs` → `turret`, `turret-dirs` → `turret`, `modelScale` → `scale`, `model-scale` → `scale`, `stills` → `still`.

<a id="sprite"></a>
## Sprite

One sprite: a model and how to render it. Every key but name and asset may also sit in `defaults` or at the top of the file, for every sprite; a sprite's own keys win.

| Key | Type | Required | Example | What it is |
|---|---|---|---|---|
| `name` | text | yes | `hero` | The sprite's name in the project (unique in the file): what the next run matches. |
| `asset` | text \| whole number | yes | `POLYGON_War/Character_American_Soldier_01` | The model: id, name or Pack/Name. |
| `kind` | "character" \| "vehicle" \| "object" \| "prop" \| "weapon" |  |  | What the model is (default: from the model). |
| `class` | text \| [text, …] |  | `rifle` | Movesets: "rifle", ["rifle", "pistol"] or "rifle,pistol" (unarmed, sword, knife, bow, staff, launcher, rifle, pistol, martial_arts). |
| `anim` | text \| [Anim entry](#anim) \| [Template entry](#template) \| [text \| [Anim entry](#anim) \| [Template entry](#template), …] |  | `["idle","walk",{"clip":"Knife_Stab_Fore","trim":"0:0.9","with":"POLYGON_Palm_City/SM_Wep_Knife_01"}]` | Clip names, or with class the moves to keep ("idle", "crouch_*"); each may carry its own trim, cap, events and held items ("Clip@0.8:2.6", "Clip@max=2", or an Anim entry object). With class, installed clip names are extra clips under their own names. |
| `template` | text \| [Template entry](#template) \| [text \| [Template entry](#template), …] |  | `still` | Procedural moves: "still", ["crawl", "drive_turn:steer=25"]; with its own held items a Template entry object. |
| `set` | text |  | `builtin_locomotion` | An animation set by id or name (not with class); "none" = only the declared anim/template moves (the default whenever any are declared). |
| `with` | text \| [text, …] |  | `["POLYGON_War/SM_Wep_American_Rifle_01"]` | Held items: "Pack/Model", "@bone", "=layer", ":front", "~class". |
| `states` | text \| { <name>: whole number \| text \| State } |  | `auto,destroyed@destroy` | Objects: "auto", "auto,destroyed@destroy", "auto,intact:drive,destroyed@destroy" or { "intact": { "template": "drive" }, "destroyed": { "asset", "transition" } } (no anim/set/class; a template next to states is the intact state's loop). |
| `view` | "side2" \| "lowthreequarter" \| "jrpg4" \| "topdown8" \| "high8" \| "straightdown" \| "iso8" \| "iso4d" \| "trueiso8" \| "hexflat6" \| "hexpointy6" \| "vehicle16" \| "rts32" \| "rpgmaker" \| "lpc" |  |  | The view preset (default: the project's). |
| `dirs` | whole number \| text \| [text \| number, …] |  | `8` | Directions: 1, 2, 4, 4d, 8, 16… (on an object in an iso view, 1 = one facing of that view), or the directions by name: "E", "N,S", ["N", "S"]. |
| `facings` | 0 \| 1 \| 2 \| 4 |  | `4` | Objects: 1, 2 or 4 grid-aligned facings (0 = use dirs). |
| `slice` | "columns" |  |  | Objects on a diamond tile: "columns" (per-tile-column strips). |
| `collision` | "auto" \| "base" \| "full" \| "concave" |  |  | Objects: full (whole hull), base (ground slice: a trunk), concave (the outline of the slice: curved walls, fences) or auto (default: vehicles, aircraft, buildings full; trees, poles base). |
| `collisionHeight` | number |  | `0.5` | Objects: the ground slice's height in metres above the bottom (default min(0.5, 15% of the height)). |
| `pitch` | number |  | `30` | Camera pitch in degrees (0 = side, 30 = 2:1 iso, 90 = straight down). |
| `projection` | "ortho" \| "persp" |  |  | The camera projection. |
| `frame` | whole number |  | `128` | Square frame size in px (the minimum with ppm/tile). |
| `ppm` | number |  | `64` | Fixed pixels per metre (a sprite's own ppm wins over the file's tile; next to its own tile, the tile wins with a warning). |
| `tile` | text \| null \| false |  | `64x32` | Tile lock "64x32" (iso diamond) or "32x32" (square): the scale from the game's tile; null/false on a sprite leaves the lock (own ppm, or fit). |
| `metresPerTile` | number |  | `1` | With tile: metres one tile covers (default 1). |
| `scale` | "fit" \| number \| text |  | `fit` | "fit": fit the model into the frame (UI icons), leaving the tile lock and ppm; or a number, the model's own size factor (1.3 = a boss 30% bigger, also "130%") at the same ppm/tile lock. |
| `fps` | number |  | `12` | Frames per second sampled from the clips. |
| `mirror` | true \| false |  |  | true: render only right-facing directions; the engine flips the rest. |
| `supersample` | 1 \| 2 \| 3 \| 4 |  | `2` | 1–4: render at N× and average down. |
| `pixelArt` | true \| false |  |  | Pixel-art style (hard edges, model palette, 1 px outline). |
| `outline` | true \| false |  |  | Pixel style: 1 px outline. |
| `palette` | "full" \| "model" \| "levels" |  |  | Pixel style colours: full, model or levels. |
| `shadow` | "off" \| "low" \| "high" \| false |  | `off` | The drop shadow: off, low or high (false = off). |
| `look` | "clean" \| "pixel" \| "hand_painted" \| "stylized" |  |  | Look card: clean, pixel, hand_painted, stylized. |
| `size` | "small" \| "medium" \| "large" \| "xl" |  |  | Size card: small (64 px), medium (128), large (256), xl (512). |
| `format` | text |  | `phaser3` | Engine format: generic, godot4, unity, phaser3, pixi, aseprite, libgdx, gamemaker, rpgmaker, lpc (or a custom profile). |
| `layers` | text \| ["normal" \| "depth" \| "uv" \| "shadow", …] |  | `["normal"]` | Extra layers: normal, depth, uv, shadow. |
| `uniform` | true \| false |  |  | Same frame size and pivot for every direction and clip (fixed scale); the project's sprites of one model with uniform at the same view share one frame and pivot. |
| `atlas` | true \| false |  |  | Pack trimmed frames into atlas pages. |
| `animPrefix` | text |  | `{base}/` | Animation key prefix, tokens {base} {asset} (default: the sprite's name; "" = bare clip_dir). |
| `movePrefix` | true \| false |  |  | With one class: false = bare move names (keys "hero/idle_E", clips "idle") instead of "hero/martial_arts_idle_E". |
| `maxSeconds` | number |  | `3` | Cap every clip at this many seconds (a clip's own maxSeconds in anim wins). |
| `gender` | "auto" \| "Masculine" \| "Feminine" |  |  | Clip gender: auto, Masculine or Feminine. |
| `layered` | true \| false \| "mask" \| "none" |  |  | Held items as separate aligned sheets: true / "mask" (hidden pixels cut away) or "none" (whole items); false (default): baked into one sheet. |
| `fx` | true \| false \| [FX](#fx) |  | `{"enabled":true,"tint":"#ff7a20","intensity":1.2}` | Glowing FX look: true or { "enabled", "tint", "intensity", "blend" }. |
| `light` | "day" \| "dusk" \| "night" \| "overcast" \| "desert_noon" \| "arctic" \| [Light](#light) |  | `dusk` | Lighting (FB-060): day, dusk, night, overcast, desert_noon, arctic (default day), or a Light object. |
| `tags` | [text, …] |  | `["enemy"]` | Sprite tags (default: its movesets). |
| `pivot` | "anchor" \| "origin" |  |  | Objects: the frame pivot in the data files: each direction's object anchor (default) or the model origin. |
| `turret` | true \| false \| "1" \| "2" \| "4" \| "8" \| "12" \| "16" \| "32" \| "4d" \| "6f" \| "6p" \| whole number \| [Turret](#turret) \| null |  | `true` | Vehicles (FB-096): hull and turret as two sheets, the turret's mount per hull direction in the hull's meta: true, or the turret's own dirs "16" / { "dirs": "32" }; false = one sheet. |
| `portrait` | true \| false \| whole number \| text \| [Portrait](#portrait) \| null |  | `240x192,front` | Characters (SF-FB-021): also a head-and-shoulders still <base>_portrait.png: true (256 px, 3/4, transparent), a size, "320x400,front,#203040" or a Portrait object; false = none. |
| `split` | true \| false \| text \| [Split](#split) \| null |  | `waist` | Characters (FB-124): "waist" = a legs sheet and a torso sheet with a per-frame waist socket in both, to aim the torso apart from the walk; or a Split object; false = one sheet. |
| `still` | text \| [text, …] |  | `Victory_Pose@2.4=ending` | One-frame stills of clips or moves: "Victory_Pose@2.4" (source seconds) or a list, each a one-frame animation <Clip>_still per direction ("Clip@2.4=ending" names it). |

Old spellings (an error names the key to use): `model` → `asset`, `classes` → `class`, `moveset` → `class`, `movesets` → `class`, `anims` → `anim`, `animations` → `anim`, `templates` → `template`, `directions` → `dirs`, `frameSize` → `frame`, `uniformFrame` → `uniform`, `metres-per-tile` → `metresPerTile`, `max-seconds` → `maxSeconds`, `pixel-art` → `pixelArt`, `anim-prefix` → `animPrefix`, `move-prefix` → `movePrefix`, `collision-height` → `collisionHeight`, `turretDirs` → `turret`, `turret_dirs` → `turret`, `turret-dirs` → `turret`, `modelScale` → `scale`, `model-scale` → `scale`, `stills` → `still`.

<a id="anim"></a>
## Anim entry

An `anim` entry as an object: one clip or move with this sprite's own trim, cap, events, export name and held items. The string form packs the same into the name: "Clip@0.8:2.6", "Clip@max=2", "Clip@reverse", "Clip@lockyaw", "Clip@hit=1.2@hit_end=1.4", "Clip@0:3=kicks_a", "Clip@still=2.4".

| Key | Type | Required | Example | What it is |
|---|---|---|---|---|
| `clip` | text | yes | `MartialArts_Crouch_Punch` | The clip, or with `class` the move (idle, crouch_punch…). |
| `trim` | text \| [number \| null, number \| null] \| { start, end } |  | `0.8:2.6` | This sprite's window of the clip in SOURCE seconds: "start:end" (either side may be empty), [start, end] or { start, end }. It replaces the shared clip trim on the sides it sets. |
| `maxSeconds` | number |  | `2` | Cap this clip at this many seconds (after the trim); wins over the sprite's maxSeconds. |
| `reverse` | true \| false |  |  | Play the clip backwards (SF-FB-017): a clip picked by name is exported as <Clip>_reverse; a move is reversed in place. |
| `lockYaw` | true \| false |  |  | Lock the root's yaw (SF-FB-023): a punch that turns the body punches straight ahead in a side view; false plays the turn even when the shared clip edit locks it. |
| `events` | [{ t, name }, …] |  | `[{"t":1.2,"name":"hit"}]` | This sprite's own events for the clip, in SOURCE seconds (SF-FB-022). They replace the clip's shared events for this sprite; [] drops them. |
| `autoEvents` | true \| false |  |  | false: no automatic events (footsteps, the key moment) in this sprite's clip. |
| `label` | text |  | `kicks_a` | The name the clip is exported under (default: the clip's or move's name), so one clip can appear twice with different windows. |
| `still` | number |  | `2.4` | One frame only (SF-FB-025): the pose at this many source seconds, exported as <Clip>_still unless label names it. |
| `with` | text \| [text, …] |  | `POLYGON_Palm_City/SM_Wep_Knife_01` | This clip's own held items (FB-074), as the sprite's `with`: one sprite, several loadouts. Exported as <as>_<clip>; the sprite's other hand-held items are put away during it. |
| `as` | text |  | `knife` | The loadout group the clip is exported under (default: the first item's moveset, else its name). |
| `release` | "hide" \| "drop" \| "keep" |  |  | What happens to the held items at the clip's `release` event (FB-103): hide (default), drop (falls and stays) or keep. |

Old spellings (an error names the key to use): `name` → `clip`, `move` → `clip`, `anim` → `clip`, `max-seconds` → `maxSeconds`, `reversed` → `reverse`, `lock-yaw` → `lockYaw`, `auto-events` → `autoEvents`, `exportAs` → `label`, `export-as` → `label`, `at` → `still`.

<a id="template"></a>
## Template entry

A `template` entry as an object: a procedural move with its own held items, exported as <as>_<template>. The string form is just the template spec.

| Key | Type | Required | Example | What it is |
|---|---|---|---|---|
| `template` | text | yes | `shoulder_fire:kneel=1` | A procedural move and its parameters: "still", "crawl", "shoulder_fire:kneel=1", "drive_turn:steer=25". |
| `with` | text \| [text, …] | yes | `POLYGON_BattleRoyale/SM_Wep_RPG_01` | The items held during this template (as the sprite's `with`). |
| `as` | text |  | `knife` | The loadout group the clip is exported under (default: the first item's moveset, else its name). |
| `release` | "hide" \| "drop" \| "keep" |  |  | What happens to the held items at the clip's `release` event (FB-103): hide (default), drop (falls and stays) or keep. |

Old spellings (an error names the key to use): `id` → `template`.

<a id="state"></a>
## State

One object state in the object form of `states`: `{ "intact": { "template": "drive" }, "destroyed": { "asset", "transition" } }`.

| Key | Type | Required | Example | What it is |
|---|---|---|---|---|
| `asset` | text \| whole number |  | `POLYGON_War/SM_Veh_Tank_Destroyed_01` | The model of this state (default: the sprite's). |
| `transition` | text |  | `destroy` | The transition template played into this state ("destroy", "blast=1"), or null for none. |
| `from` | text |  |  | The state the transition starts from. |
| `look` | text |  |  | A look for this state ("scorch:dark=0.9"). |
| `template` | text \| [text, …] |  | `drive` | The state's looping template (objects have no skeletal clips). |
| `anim` | text \| [text, …] |  |  | Another name for template. |
| `collision` | "none" \| "auto" \| "base" \| "full" \| "concave" |  |  | What the state collides with (FB-085): none (a blown gate), base, full, concave or auto. |

<a id="fx"></a>
## FX

The glowing FX look as an object (`"fx": true` is the default glow).

| Key | Type | Required | Example | What it is |
|---|---|---|---|---|
| `enabled` | true \| false | yes |  | Whether the FX look is on. |
| `tint` | text |  | `#ff7a20` | The glow colour. |
| `intensity` | number |  | `1.2` | How strong the glow is (1 = as authored). |
| `blend` | "add" \| "normal" |  |  | How the sprite blends over the scene: add (light, fire) or normal. |

<a id="light"></a>
## Light

Lighting as an object: a preset plus overrides. On a sprite it lights the model; on a tileset the same values grade the ground to match (FB-060).

| Key | Type | Required | Example | What it is |
|---|---|---|---|---|
| `preset` | "day" \| "dusk" \| "night" \| "overcast" \| "desert_noon" \| "arctic" |  |  | The preset the other values start from (default day). |
| `ambient` | text |  | `#8090c0` | Ambient (sky) colour. |
| `ambientIntensity` | number |  |  | Ambient strength, 0–10 (day 1.9). |
| `key` | text |  | `#ffe0b0` | Key light (sun or moon) colour. |
| `keyIntensity` | number |  |  | Key light strength, 0–10 (day 1.6). |
| `azimuth` | number |  |  | Where the key light comes from, degrees around the model as the camera sees it: 0 from the camera, 90 from the right, -90 from the left, 180 from behind (day about -34). |
| `elevation` | number |  |  | Height of the key light above the horizon, 1–90 degrees (day about 48). |

<a id="turret"></a>
## Turret

The object form of `turret` (FB-096): `{ "dirs": "16" }`.

| Key | Type | Required | Example | What it is |
|---|---|---|---|---|
| `dirs` | "1" \| "2" \| "4" \| "8" \| "12" \| "16" \| "32" \| "4d" \| "6f" \| "6p" \| whole number |  | `16` | The turret's own direction count (default: the hull's). |

Old spellings (an error names the key to use): `directions` → `dirs`.

<a id="portrait"></a>
## Portrait

The object form of `portrait` (SF-FB-021): a head-and-shoulders still <base>_portrait.png (+ .json). The string form is "320x400,front,#203040".

| Key | Type | Required | Example | What it is |
|---|---|---|---|---|
| `size` | whole number |  | `256` | Square output size in pixels (default 256). |
| `width` | whole number |  |  | Width in pixels, with height for a non-square portrait. |
| `height` | whole number |  |  | Height in pixels. |
| `angle` | number \| text |  | `3/4` | How far the character is turned from the camera: degrees (-180..180), or front, 3/4 (default, facing right), 3/4 left, side, side left. |
| `pitch` | number \| text |  |  | Camera pitch looking down at the face, 0–60 degrees (default 0). |
| `background` | text |  | `#203040` | A hex colour (#203040), or null / "transparent" (default). |
| `clip` | text |  |  | The clip whose first frame poses the bust (default: the first idle, else the first clip). |

Old spellings (an error names the key to use): `bg` → `background`.

<a id="split"></a>
## Split

The object form of `split` (FB-124): a legs sheet and a torso sheet with a per-frame waist socket in both.

| Key | Type | Required | Example | What it is |
|---|---|---|---|---|
| `at` | "waist" |  |  | Where to split: waist (the only place today). |
| `legs` | text \| [text, …] |  | `["idle","walk","run"]` | The moves of the legs sheet (default: idle and locomotion). |
| `torso` | text \| [text, …] |  | `["idle","aim","shoot"]` | The moves of the torso sheet (default: idle, aim, shoot, throw, reload). |
| `whole` | true \| false |  |  | Also write the whole-body sheet <base> (every move) from the same job and framing (FB-126). |

<a id="tileset"></a>
## Tileset

One tileset: its tile size, terrains and which pairs blend. A declaration is the whole truth about a tileset (terrains it does not list are removed), and tiles that stay keep their ids, so maps made with it stay valid.

| Key | Type | Required | Example | What it is |
|---|---|---|---|---|
| `name` | text | yes | `temperate` | The tileset's name (unique in the file): what the next run matches. |
| `tile` | text |  | `64x32` | "64x32" (2:1 iso diamond, the default) or "32x32" (square, orthogonal); default: the file's tile. |
| `metresPerTile` | number |  | `1` | Metres one tile covers (default: the file's, else 1). |
| `noisePeriod` | number |  | `4` | Period of the large-scale ground noise in tiles (default 4). |
| `variants` | whole number |  | `2` | Default random variants per corner combination (a terrain's own variants wins; default 1). |
| `terrains` | [[Terrain](#terrain) \| text, …] | yes |  | The terrains, by name or as Terrain objects. |
| `pairs` | [[text, text] \| text, …] \| "all" |  | `[["grass","dirt"]]` | Terrain pairs that get transition tiles ([["grass", "dirt"]] or ["grass,dirt"]), or "all" for every pair. |
| `cliffHeight` | number |  | `16` | Cliff face height in pixels for raised terrains (default tileHeight / 2). |
| `mixes` | "auto" \| "triples" \| "pairs" |  |  | Tiles where three or four terrains meet: auto (default: every mix while the tileset has few terrains), triples or pairs. |
| `light` | "day" \| "dusk" \| "night" \| "overcast" \| "desert_noon" \| "arctic" \| [Light](#light) |  | `dusk` | Lighting preset ("dusk") or a Light object, as a sprite's light: grades the ground to match (FB-060). |
| `comment` | anything |  |  | A note for people; ignored. |
| `description` | anything |  |  | A note for people; ignored. |

Old spellings (an error names the key to use): `metres-per-tile` → `metresPerTile`.

Not needed (an error says so): `orientation`.

<a id="terrain"></a>
## Terrain

One terrain of a tileset: a colour or a texture, and how it meets its neighbours. A bare string is a terrain with that name.

| Key | Type | Required | Example | What it is |
|---|---|---|---|---|
| `name` | text | yes | `grass` | The terrain's name (unique in the tileset). |
| `kind` | "grass" \| "dirt" \| "sand" \| "mud" \| "road" \| "water" \| "snow" \| "jungle" \| "rock" \| "custom" |  |  | What it is (default: the name if it is a kind, else custom): sets the default colour and water/shore behaviour. |
| `color` | text |  | `#8a6440` | Flat palette colour (default: the kind's). Not with texture. |
| `noise` | number |  | `0.3` | 0–1 noise on the palette colour. |
| `texture` | text \| whole number |  | `POLYGON_Generic_v3/Textures/Generic_Grass.png` | A texture instead of a colour: a texture path inside the packs, or an installed asset id. |
| `scale` | number |  | `4` | With texture: metres one repeat of the texture covers (default one tile). |
| `tint` | text |  | `#c0d0a0` | A tint over the texture or colour. |
| `variants` | whole number |  | `3` | Random variants of this terrain's tiles (default: the tileset's). |
| `blend` | text \| [text, …] |  | `["grass","dirt"]` | Terrains to make transitions with (the same as listing the pairs). |
| `height` | 0 \| 1 |  |  | 1 = raised one level: cliffs where it meets ground terrains (`cliff: true` is the same). |
| `cliff` | true \| false |  |  | true = raised one level with cliffs (the same as height 1). |
| `shore` | true \| false |  |  | Shore treatment where it meets another terrain (default: on for water). |

Old spellings (an error names the key to use): `colour` → `color`.

<a id="sprite-defaults"></a>
## Sprite defaults

The `defaults` object (and the same keys at the top level): every Sprite key but name and asset.

| Key | Type | Required | Example | What it is |
|---|---|---|---|---|
| `kind` | "character" \| "vehicle" \| "object" \| "prop" \| "weapon" |  |  | What the model is (default: from the model). |
| `class` | text \| [text, …] |  | `rifle` | Movesets: "rifle", ["rifle", "pistol"] or "rifle,pistol" (unarmed, sword, knife, bow, staff, launcher, rifle, pistol, martial_arts). |
| `anim` | text \| [Anim entry](#anim) \| [Template entry](#template) \| [text \| [Anim entry](#anim) \| [Template entry](#template), …] |  | `["idle","walk",{"clip":"Knife_Stab_Fore","trim":"0:0.9","with":"POLYGON_Palm_City/SM_Wep_Knife_01"}]` | Clip names, or with class the moves to keep ("idle", "crouch_*"); each may carry its own trim, cap, events and held items ("Clip@0.8:2.6", "Clip@max=2", or an Anim entry object). With class, installed clip names are extra clips under their own names. |
| `template` | text \| [Template entry](#template) \| [text \| [Template entry](#template), …] |  | `still` | Procedural moves: "still", ["crawl", "drive_turn:steer=25"]; with its own held items a Template entry object. |
| `set` | text |  | `builtin_locomotion` | An animation set by id or name (not with class); "none" = only the declared anim/template moves (the default whenever any are declared). |
| `with` | text \| [text, …] |  | `["POLYGON_War/SM_Wep_American_Rifle_01"]` | Held items: "Pack/Model", "@bone", "=layer", ":front", "~class". |
| `states` | text \| { <name>: whole number \| text \| State } |  | `auto,destroyed@destroy` | Objects: "auto", "auto,destroyed@destroy", "auto,intact:drive,destroyed@destroy" or { "intact": { "template": "drive" }, "destroyed": { "asset", "transition" } } (no anim/set/class; a template next to states is the intact state's loop). |
| `view` | "side2" \| "lowthreequarter" \| "jrpg4" \| "topdown8" \| "high8" \| "straightdown" \| "iso8" \| "iso4d" \| "trueiso8" \| "hexflat6" \| "hexpointy6" \| "vehicle16" \| "rts32" \| "rpgmaker" \| "lpc" |  |  | The view preset (default: the project's). |
| `dirs` | whole number \| text \| [text \| number, …] |  | `8` | Directions: 1, 2, 4, 4d, 8, 16… (on an object in an iso view, 1 = one facing of that view), or the directions by name: "E", "N,S", ["N", "S"]. |
| `facings` | 0 \| 1 \| 2 \| 4 |  | `4` | Objects: 1, 2 or 4 grid-aligned facings (0 = use dirs). |
| `slice` | "columns" |  |  | Objects on a diamond tile: "columns" (per-tile-column strips). |
| `collision` | "auto" \| "base" \| "full" \| "concave" |  |  | Objects: full (whole hull), base (ground slice: a trunk), concave (the outline of the slice: curved walls, fences) or auto (default: vehicles, aircraft, buildings full; trees, poles base). |
| `collisionHeight` | number |  | `0.5` | Objects: the ground slice's height in metres above the bottom (default min(0.5, 15% of the height)). |
| `pitch` | number |  | `30` | Camera pitch in degrees (0 = side, 30 = 2:1 iso, 90 = straight down). |
| `projection` | "ortho" \| "persp" |  |  | The camera projection. |
| `frame` | whole number |  | `128` | Square frame size in px (the minimum with ppm/tile). |
| `ppm` | number |  | `64` | Fixed pixels per metre (a sprite's own ppm wins over the file's tile; next to its own tile, the tile wins with a warning). |
| `tile` | text \| null \| false |  | `64x32` | Tile lock "64x32" (iso diamond) or "32x32" (square): the scale from the game's tile; null/false on a sprite leaves the lock (own ppm, or fit). |
| `metresPerTile` | number |  | `1` | With tile: metres one tile covers (default 1). |
| `scale` | "fit" \| number \| text |  | `fit` | "fit": fit the model into the frame (UI icons), leaving the tile lock and ppm; or a number, the model's own size factor (1.3 = a boss 30% bigger, also "130%") at the same ppm/tile lock. |
| `fps` | number |  | `12` | Frames per second sampled from the clips. |
| `mirror` | true \| false |  |  | true: render only right-facing directions; the engine flips the rest. |
| `supersample` | 1 \| 2 \| 3 \| 4 |  | `2` | 1–4: render at N× and average down. |
| `pixelArt` | true \| false |  |  | Pixel-art style (hard edges, model palette, 1 px outline). |
| `outline` | true \| false |  |  | Pixel style: 1 px outline. |
| `palette` | "full" \| "model" \| "levels" |  |  | Pixel style colours: full, model or levels. |
| `shadow` | "off" \| "low" \| "high" \| false |  | `off` | The drop shadow: off, low or high (false = off). |
| `look` | "clean" \| "pixel" \| "hand_painted" \| "stylized" |  |  | Look card: clean, pixel, hand_painted, stylized. |
| `size` | "small" \| "medium" \| "large" \| "xl" |  |  | Size card: small (64 px), medium (128), large (256), xl (512). |
| `format` | text |  | `phaser3` | Engine format: generic, godot4, unity, phaser3, pixi, aseprite, libgdx, gamemaker, rpgmaker, lpc (or a custom profile). |
| `layers` | text \| ["normal" \| "depth" \| "uv" \| "shadow", …] |  | `["normal"]` | Extra layers: normal, depth, uv, shadow. |
| `uniform` | true \| false |  |  | Same frame size and pivot for every direction and clip (fixed scale); the project's sprites of one model with uniform at the same view share one frame and pivot. |
| `atlas` | true \| false |  |  | Pack trimmed frames into atlas pages. |
| `animPrefix` | text |  | `{base}/` | Animation key prefix, tokens {base} {asset} (default: the sprite's name; "" = bare clip_dir). |
| `movePrefix` | true \| false |  |  | With one class: false = bare move names (keys "hero/idle_E", clips "idle") instead of "hero/martial_arts_idle_E". |
| `maxSeconds` | number |  | `3` | Cap every clip at this many seconds (a clip's own maxSeconds in anim wins). |
| `gender` | "auto" \| "Masculine" \| "Feminine" |  |  | Clip gender: auto, Masculine or Feminine. |
| `layered` | true \| false \| "mask" \| "none" |  |  | Held items as separate aligned sheets: true / "mask" (hidden pixels cut away) or "none" (whole items); false (default): baked into one sheet. |
| `fx` | true \| false \| [FX](#fx) |  | `{"enabled":true,"tint":"#ff7a20","intensity":1.2}` | Glowing FX look: true or { "enabled", "tint", "intensity", "blend" }. |
| `light` | "day" \| "dusk" \| "night" \| "overcast" \| "desert_noon" \| "arctic" \| [Light](#light) |  | `dusk` | Lighting (FB-060): day, dusk, night, overcast, desert_noon, arctic (default day), or a Light object. |
| `tags` | [text, …] |  | `["enemy"]` | Sprite tags (default: its movesets). |
| `pivot` | "anchor" \| "origin" |  |  | Objects: the frame pivot in the data files: each direction's object anchor (default) or the model origin. |
| `turret` | true \| false \| "1" \| "2" \| "4" \| "8" \| "12" \| "16" \| "32" \| "4d" \| "6f" \| "6p" \| whole number \| [Turret](#turret) \| null |  | `true` | Vehicles (FB-096): hull and turret as two sheets, the turret's mount per hull direction in the hull's meta: true, or the turret's own dirs "16" / { "dirs": "32" }; false = one sheet. |
| `portrait` | true \| false \| whole number \| text \| [Portrait](#portrait) \| null |  | `240x192,front` | Characters (SF-FB-021): also a head-and-shoulders still <base>_portrait.png: true (256 px, 3/4, transparent), a size, "320x400,front,#203040" or a Portrait object; false = none. |
| `split` | true \| false \| text \| [Split](#split) \| null |  | `waist` | Characters (FB-124): "waist" = a legs sheet and a torso sheet with a per-frame waist socket in both, to aim the torso apart from the walk; or a Split object; false = one sheet. |
| `still` | text \| [text, …] |  | `Victory_Pose@2.4=ending` | One-frame stills of clips or moves: "Victory_Pose@2.4" (source seconds) or a list, each a one-frame animation <Clip>_still per direction ("Clip@2.4=ending" names it). |

Old spellings (an error names the key to use): `model` → `asset`, `classes` → `class`, `moveset` → `class`, `movesets` → `class`, `anims` → `anim`, `animations` → `anim`, `templates` → `template`, `directions` → `dirs`, `frameSize` → `frame`, `uniformFrame` → `uniform`, `metres-per-tile` → `metresPerTile`, `max-seconds` → `maxSeconds`, `pixel-art` → `pixelArt`, `anim-prefix` → `animPrefix`, `move-prefix` → `movePrefix`, `collision-height` → `collisionHeight`, `turretDirs` → `turret`, `turret_dirs` → `turret`, `turret-dirs` → `turret`, `modelScale` → `scale`, `model-scale` → `scale`, `stills` → `still`.

<a id="models-file"></a>
# ssg.models.json

Declares the 3D models a game keeps in a folder: `slop build` exports each one as a GLB plus a `.model.json` manifest, downloads only what changed, removes files of models no longer declared and indexes them in `models.json`. A bare list of models works too.

One of: { $schema, comment, project, models, defaults }, [[Model](#model), …].

<a id="model"></a>
## Model

One model to export: a library asset (or a built kind: trackpiece, terrain, skydome, composite) and its options. `name` is the file name in the folder; it defaults to the asset's name.

| Key | Type | Required | Example | What it is |
|---|---|---|---|---|
| `asset` | text \| whole number |  | `POLYGON_Palm_City/SM_Veh_Pickup_01` | Asset id, or name ("SM_Veh_Pickup_Lift_01", or "Pack/Name" when several packs have it). Not with a built kind. |
| `trackpiece` | [Track piece](#trackpiece) |  |  | A procedural track piece instead of an asset (see Track piece). |
| `terrain` | [Terrain (3D)](#terrain3d) |  |  | Terrain on the track grid instead of an asset (see Terrain (3D)). |
| `skydome` | [Skydome](#skydome) |  |  | A skydome instead of an asset (see Skydome). |
| `composite` | [Composite](#composite) |  |  | One model from several assets at offsets (see Composite). |
| `collider` | "box" \| "convex" \| "trimesh" |  |  | The collider the export carries (CS-FB-002): box (the manifest's box; default for assets), trimesh (also a collider node in the GLB; default for track pieces) or convex (assets: the hull of the visual mesh). |
| `colliderExclude` | text \| [text, …] |  | `["wheel","door"]` | Parts a trimesh or convex collider leaves out, by role (wheel, door…) or part name. Default the moving parts; [] keeps every part. |
| `convexMaxVertices` | whole number |  | `255` | With collider convex: the most vertices the hull may have (default 255, what physics engines take). |
| `name` | text |  | `truck` | Output name (file names and the GLB's root node). Default: the asset's name. |
| `clips` | text \| [text, …] |  | `["POLY_IDL_Base@Masculine"]` | Clips baked into the GLB (characters only): a clip name, name@Masculine\|Feminine\|Neutral, name@Polygon\|Sidekick (the rig family), name@<pack>, or an animation id. |
| `inPlace` | true \| false |  |  | In-place clips (default true); false keeps the root motion. |
| `attach` | text \| [text, …] |  | `["SM_Veh_Pickup_Lift_01"]` | Extra pieces: bundled attachments of the same file by mesh name, or other attachment assets by name or id. |
| `replaceWheels` | true \| false |  |  | When an attachment brings four road wheels of its own (a lift kit), the model's own are dropped and the attachment's become the wheels (default true). |
| `origin` | "bottom-centre" \| "axle-centre" \| "pivot" |  |  | Where the model's origin goes: the centre of its bottom (default), the centre of the wheel axles at axle height (vehicles), or the source model's own origin. |
| `texSize` | whole number |  | `1024` | Largest texture side in pixels (scaled down to fit, never up). Default by kind: props 256, vehicles and characters 1024. |
| `texFormat` | "png" \| "webp" \| "keep" |  |  | Texture format: webp (default), png, or keep (as ingested). |
| `simplify` | number |  | `0.5` | Mesh simplification: the fraction of triangles to keep (0.05–1; 1 or unset = none). |
| `tint` | text |  | `#c62828` | A colour (#rgb / #rrggbb): recolours the body paint. Not with variants. |
| `variants` | text \| [[Model variant](#model-variant), …] |  | `[{"name":"red","tint":"#c62828"}]` | Paint variants in one GLB: [{ name, tint }] (or "red=#c62828,blue=#1e5bc6,plain"). The first is the default look. |
| `compress` | "meshopt" \| "none" |  |  | Geometry compression: meshopt (three.js needs MeshoptDecoder) or none (default). |
| `fit` | { length, width, height } |  | `{"length":4.5}` | Scale the model uniformly so a dimension matches, in metres. With several, the smallest scale wins. |
| `pose` | text \| [Model pose](#model-pose) |  | `{"clip":"Crowd_Sit_Idle","time":1}` | Bake a character into one static mesh posed at a clip's time: { clip, time } or "Clip:0.2". Not with clips or poses. |
| `poses` | text \| [[Named pose](#model-named-pose), …] |  |  | Several posed static meshes in one GLB, a node per pose: [{ name, clip, time }] or "idle=Idle:0,wave=Wave_01:0.2". Not with clips or pose. |
| `splitBySwatch` | true \| false |  |  | Split the model's triangles by palette swatch (OR-FB-022): a child node swatch_<hex> per atlas colour with its own material. Static models only. |
| `lods` | text \| [number, …] |  | `[0.5,0.2]` | Levels of detail in the same GLB, as falling shares of the triangles ([0.5, 0.2]); at most 4. |
| `paint` | text |  | `#e3b52f` | The paint a tint or variants recolour (CS-FB-026): a colour #rrggbb (the swatch that is its paint) or a material name. Default: found. |
| `decals` | true \| false |  |  | CS-FB-028: false paints over every decal and livery in the paint's texture with the paint. Default true: only small lettering enclosed by the paint. |

<a id="trackpiece"></a>
## Track piece

A procedural track piece instead of an asset (CS-FB-001): a preset with its parameters, or a path of segments swept with a profile; Synty swatch materials; sockets at its open ends.

| Key | Type | Required | Example | What it is |
|---|---|---|---|---|
| `preset` | "straight" \| "curve-left" \| "curve-right" \| "banked-curve-left" \| "banked-curve-right" \| "bank-transition" \| "slope-up" \| "slope-down" \| "ramp" \| "landing" \| "jump" \| "loop" \| "corkscrew-left" \| "corkscrew-right" \| "pipe" \| "pipe-in" \| "pipe-out" \| "halfpipe" \| "halfpipe-in" \| "halfpipe-out" \| "tunnel" \| "bridge" \| "chicane-left" \| "chicane-right" \| "split-left" \| "split-right" \| "crossroads" \| "helix-left" \| "helix-right" \| "widen" \| "narrow" \| "barrel-roll" |  | `curve-left` | A ready-made piece; its parameters are the keys below that it takes. |
| `cell` | number |  | `30` | The grid's cell in metres (default 30). |
| `footprint` | [whole number, whole number] |  | `[1,2]` | Declared footprint in cells [across (X), along (Z)]; checked against the geometry. |
| `elevation` | number |  |  | Height of the entry above the ground (default 0; a bridge preset sets it). |
| `bank` | number |  |  | Entry bank, degrees (default 0); on a banked curve, the bank (default 30). |
| `pitch` | number |  |  | Entry pitch, degrees (default 0). |
| `bankPivot` | "low-edge" \| "centre" |  |  | Bank about the edge that goes down, which stays at path height (default), or about the centre line. |
| `profile` | [Track profile](#track-profile) |  |  | The cross-section at the entry. |
| `width` | number |  | `10` | A shorthand for profile.width. |
| `path` | [[Track segment](#track-segment), …] |  |  | A custom path of segments instead of a preset. |
| `branches` | [[Track branch](#track-branch), …] |  |  | Side paths with their own sockets. |
| `materials` | { deck, kerb, kerbAlt, wall, support } |  | `{"deck":"#404040"}` | Synty swatches per slot (deck, kerb, kerbAlt, wall, support): "Pack/Asset", "Pack/Asset#rrggbb", "Pack/Material" or "#rrggbb". |
| `supports` | "auto" \| "none" \| "pillars" \| "solid" \| { kind, spacing, size } |  |  | Pillars or a solid fill down to y = 0 under elevated parts; auto (default) pillars where the deck is over 1.5 m up, solid for ramps. |
| `stripe` | number |  |  | Kerb stripe length in metres (default 2). |
| `edge` | text |  | `highway` | The edge kind a flat road end reports in its socket (default road; e.g. highway for a dual carriageway). |
| `length` | number |  | `2` | Cells along the piece (straight, slope, ramp, jump, corkscrew, pipe, tunnel, bridge, chicane…). |
| `size` | number |  | `2` | Curves and splits: the footprint in cells (1: 1×1, radius half a cell; 2: 2×2, radius 1.5 cells). |
| `angle` | number |  |  | Curves: degrees turned (default 90). Ramps / jumps: the lip angle (default 20). Helix and barrel roll: up to 1440. |
| `radius` | number |  |  | Loop: its radius in metres. Curves: the centre-line radius (instead of size). Pipe: the tube's radius. Helix: its radius. Barrel roll: the roll axis's height above the deck. |
| `transition` | number |  |  | Banked curve: the share of the arc each bank ramp takes. Slope: the share of the run each curved end takes (default 0.25). |
| `bankIn` | number |  |  | Banked curve: bank at the entry (default 0). |
| `bankOut` | number |  |  | Banked curve: bank at the exit (default 0). |
| `from` | number \| [Track profile](#track-profile) |  |  | Bank transition: the bank at the entry (degrees). Narrow: the wide profile at the entry ({ width, edge, median… }). |
| `to` | number \| [Track profile](#track-profile) |  |  | Bank transition: the bank at the exit (degrees). Widen: the wide profile at the exit. |
| `height` | number |  |  | Slopes: the rise (m); ramps / jumps: the lip height; bridges: the deck height; tunnels: the clear height; helix: the climb over its turn (negative descends). |
| `shift` | number |  |  | Loop and chicane: the sideways offset (m). |
| `side` | number |  |  | Corkscrew: the cells it moves sideways (default 1). |
| `align` | "offset" \| "inline" |  |  | Loop: offset (default; the exit leaves shift metres to the side of the entry) or inline (2 cells, exit on the centre line). |
| `turn` | "left" \| "right" |  |  | Loop: which way the exit moves (default right). Barrel roll: the wall the deck climbs first. |
| `offset` | true \| false |  |  | Chicane: true makes it a lane change, the exit shift metres to the side of the entry (default false: an S-bend that ends in line). |
| `travel` | number |  |  | Helix: cells it advances along its entry heading while it turns (default 0). |

<a id="track-profile"></a>
## Track profile

A track piece's cross-section: the road's shape, width, kerbs, walls and median.

| Key | Type | Required | Example | What it is |
|---|---|---|---|---|
| `shape` | "flat" \| "pipe" \| "halfpipe" \| "tunnel" |  |  | flat road, closed pipe (the car drives on its inside), half-pipe, or a flat road under a tunnel shell. |
| `width` | number |  | `10` | Drivable width between the kerbs' outer edges; for a pipe its diameter (default 10). |
| `kerb` | number |  |  | Kerb strip width on each edge, 0 for none (default 0.6). |
| `kerbHeight` | number |  |  | Kerb height. |
| `kerbs` | "both" \| "left" \| "right" \| "none" |  |  | Which edges get kerbs. |
| `wall` | number |  |  | Wall / rail height above the deck, 0 for none (default 0.8). |
| `wallThickness` | number |  |  | Wall thickness. |
| `walls` | "both" \| "left" \| "right" \| "none" |  |  | Which edges get walls. |
| `thickness` | number |  |  | Deck slab thickness under the surface (default 0.5). |
| `radius` | number |  |  | Half-pipe: the radius of its curved sides (default width / 4). |
| `height` | number |  |  | Tunnel: clear height inside (default width / 2 + 2). |
| `median` | number |  | `3` | A divided road (CS-FB-012): the width of the central median strip (default 0: none). |
| `medianHeight` | number |  |  | The median's height (default 0.8, a concrete barrier; 0: a painted strip). |
| `edge` | text |  | `highway` | The edge kind flat road ends report from here on (default the spec's edge, else road; e.g. highway). |

<a id="track-segment"></a>
## Track segment

One segment of a custom track path: how far it goes and how it turns, pitches, rolls, banks and shifts on the way.

| Key | Type | Required | Example | What it is |
|---|---|---|---|---|
| `length` | number | yes | `30` | Metres along the centreline. |
| `turn` | number |  |  | Yaw over the segment, degrees, + left. |
| `pitch` | number |  |  | Pitch over the segment, degrees, + nose up (a loop is 360). |
| `roll` | number |  |  | Rolls the path frame itself over the segment, degrees, + raises the right edge (corkscrews). |
| `rollRadius` | number |  |  | CS-FB-027: roll about an axis this many metres above the deck instead of the centre line (a barrel roll). Only with roll; no turn, pitch, shift or rise. |
| `rollEase` | number |  |  | With rollRadius: the share of the length each end takes to ease the roll in or out (0–0.5, default 0.25). |
| `bank` | number |  |  | Deck bank at the END of the segment (absolute degrees, eased from the previous end); + raises the right edge. |
| `shift` | number |  |  | Sideways offset over the segment, metres, + left, eased in and out. |
| `rise` | number |  |  | Upward offset over the segment, metres, eased (an S-shaped slope with level ends). |
| `profile` | [Track profile](#track-profile) |  |  | This segment's profile, merged over the previous one. |
| `blend` | true \| false |  |  | Ease from the previous segment's profile to this one over the segment (pipe-road transitions). |
| `gap` | true \| false |  |  | No geometry: the path flies on (the gap of a jump). |

<a id="track-branch"></a>
## Track branch

A side path off a track piece (a pit lane, a split) with its own sockets.

| Key | Type | Required | Example | What it is |
|---|---|---|---|---|
| `name` | text | yes | `pit` | Socket name(s): name for its one open end, name_in / name_out when both are open. |
| `from` | whole number |  |  | Start where the main path is after this many segments (0: the entry). Not with start. |
| `start` | { pos, heading, bank } |  |  | Or start here: a position in the piece and a heading. |
| `path` | [[Track segment](#track-segment), …] | yes |  | The branch's segments. |
| `profile` | [Track profile](#track-profile) |  |  | Profile changes over the main path's (the profile where it starts). |
| `open` | "start" \| "end" \| "both" \| "none" |  |  | Which ends are open (get sockets). Default end for from, both for start. |

<a id="terrain3d"></a>
## Terrain (3D)

Terrain on the track grid instead of an asset (CS-FB-003): one tile, or a whole grid of corner heights with water, coasts, swatch materials and scattered props.

| Key | Type | Required | Example | What it is |
|---|---|---|---|---|
| `cell` | number |  | `30` | The grid's cell in metres (default 30, as track pieces). |
| `height` | number |  | `13` | One height step in metres (default 0.44 cell). Heights count steps. |
| `tile` | "flat" \| "slope" \| "corner-outer" \| "corner-inner" \| "plateau" \| "water" \| "coast" |  |  | One tile: its kind (not with heights). |
| `dir` | "N" \| "E" \| "S" \| "W" \| "NE" \| "NW" \| "SE" \| "SW" |  |  | The way a tile faces: slope, the uphill side N\|E\|S\|W; corners, the uphill corner NE\|NW\|SE\|SW; coast, the water's corner. |
| `heights` | [[number, …], …] |  | `[[0,0],[0,1]]` | A grid: corner heights in steps, rows along +Z, columns along +X: (rows + 1) × (cols + 1) numbers (not with tile). |
| `water` | [text \| [text \| number, …], …] |  | `["..w",".ww"]` | Water per tile (rows × cols): "" or "." land, "w" water, NE \| NW \| SE \| SW a coast; a string of one char a tile also works ("..w"). |
| `level` | number |  |  | The water surface's height in metres (default 0.02). |
| `depth` | number |  |  | How far the bed under open water sinks below the surface, metres (default 1.5). |
| `shape` | "planar" \| "track" |  |  | Slope faces: planar (default; straight faces) or track (the slope-up piece's curve, so a road slope fits). |
| `transition` | number |  |  | track shape: the share of the run each curved end takes (default 0.25). |
| `subdiv` | whole number |  |  | Subdivisions per tile side (default 1 planar, 8 track). |
| `skirt` | number |  |  | Vertical walls this many metres down from the outer edges (default 0: none). |
| `chunk` | whole number |  |  | Tiles per chunk side: a grid is cut into chunk × chunk meshes (default 10). |
| `biome` | "meadow" \| "desert" \| "alpine" \| "tropical" \| "swamp" |  |  | A swatch set: meadow (default), desert, alpine, tropical, swamp. |
| `materials` | { ground, slope, shore, seabed, water, skirt } |  | `{"ground":"POLYGON_Generic_v3/Generic_Grass"}` | Swatches per slot (ground, slope, shore, seabed, water, skirt): "Pack/Asset", "Pack/Asset#rrggbb", "Pack/Material" or "#rrggbb". |
| `slopeAngle` | number |  |  | Faces steeper than this (degrees) take the slope material (default 45). |
| `shade` | number |  |  | Brightness variation between faces, 0–0.3 (default 0.06). |
| `seed` | number |  |  | Seed of the shading and the scatter (default 1). |
| `scatter` | [[Terrain scatter](#terrain-scatter), …] |  |  | Props scattered over the ground (at most 8 kinds). |
| `clear` | [[whole number, whole number], …] |  | `[[0,0]]` | Tiles [i, j] kept free of scatter (where track pieces go). |

<a id="terrain-scatter"></a>
## Terrain scatter

Props scattered over a terrain (cacti, rocks), instanced in the GLB.

| Key | Type | Required | Example | What it is |
|---|---|---|---|---|
| `asset` | text | yes | `POLYGON_NatureBiomes_AridDesert/SM_Env_Cactus_01` | A Synty prop ("Pack/Asset" or a name), exported in metres and instanced. |
| `density` | number |  | `4` | Props per tile on average (default 4). |
| `scale` | [number, number] |  | `[0.8,1.2]` | Uniform scale range [min, max] (default [0.8, 1.2]). |
| `maxSlope` | number |  |  | Steepest ground it stands on, degrees (default 25). |
| `on` | "land" \| "shore" \| "any" |  |  | Where: land (default, dry ground off the shore), shore (the shore only), any dry ground. |
| `align` | true \| false |  |  | Tilt with the ground (default false: upright). |

<a id="skydome"></a>
## Skydome

A skydome instead of an asset (CS-FB-004): a gradient dome and a silhouette ring of Synty background props.

| Key | Type | Required | Example | What it is |
|---|---|---|---|---|
| `preset` | "desert" \| "tropical" \| "alpine" \| "city" \| "country" |  | `desert` | The sky and ring the colours start from. |
| `radius` | number |  | `1000` | Dome radius, metres (default 1000; keep it inside the camera's far plane). |
| `colors` | { zenith, horizon, ground, ring } |  |  | Colour overrides. |
| `ring` | true \| false \| { assets, distance, elevation, haze, layers } |  |  | The silhouette ring: true / left out for the preset's, false for none, or its settings. |
| `segments` | whole number |  |  | Segments around (default 32). |
| `seed` | number |  |  | Seed of the ring placement. |
| `panorama` | whole number \| false |  |  | Also an equirectangular panorama PNG of the dome and ring, this many pixels wide (default 2048; false: none). |

<a id="composite"></a>
## Composite

One model from several library assets at offsets (CS-FB-024): each part exported, placed and merged into one GLB with shared materials.

| Key | Type | Required | Example | What it is |
|---|---|---|---|---|
| `parts` | [[Composite part](#composite-part), …] | yes |  | The parts, each placed at its pos / rot / scale. |

<a id="composite-part"></a>
## Composite part

One library asset placed in a composite model.

| Key | Type | Required | Example | What it is |
|---|---|---|---|---|
| `asset` | text \| whole number | yes | `POLYGON_Pro_Racer/SM_Prop_Gantry_06` | Asset id, name or "Pack/Name". |
| `name` | text |  |  | Its node in the GLB (default the asset's name; repeats get _2, _3…). |
| `pos` | [number, number, number] |  | `[0,0,5]` | Position in metres (default [0, 0, 0]). |
| `rot` | number \| [number, number, number] |  | `90` | Degrees: a number turns it about +Y (yaw, + to the left); [x, y, z] are Euler angles applied X, then Y, then Z. |
| `scale` | number \| [number, number, number] |  | `1` | A uniform scale, or [x, y, z] (default 1). |
| `origin` | "bottom-centre" \| "pivot" |  |  | Where the part's own origin is before it is placed: bottom-centre (default) or pivot (the source model's own origin). |
| `attach` | [text, …] |  |  | Extra pieces of this part, as a model's attach. |
| `tint` | text |  |  | Recolour this part's paint, as a model's tint. |
| `paint` | text |  |  | The paint its tint recolours, as a model's paint (#rrggbb or a material name). |
| `decals` | true \| false |  |  | false: its decals are painted over, as a model's decals. |

<a id="model-variant"></a>
## Model variant

One paint variant (shared geometry, its own material and texture). The CLI form is "red=#c62828,blue=#1e5bc6,plain".

| Key | Type | Required | Example | What it is |
|---|---|---|---|---|
| `name` | text | yes | `red` | The variant's name (KHR_materials_variants). |
| `tint` | text |  | `#c62828` | #rrggbb; left out, the model's own colours. |

<a id="model-pose"></a>
## Model pose

A pose to bake: a clip and a time. The CLI form is "Clip:0.2".

| Key | Type | Required | Example | What it is |
|---|---|---|---|---|
| `clip` | text \| whole number | yes | `Crowd_Sit_Idle` | The clip (any clips form) to pose at. |
| `time` | number |  | `1` | Seconds into the clip as exported (default 0). |

<a id="model-named-pose"></a>
## Named pose

One of several baked poses (a node per pose in one GLB). The CLI form is "idle=Idle:0,wave=Wave_01:0.2".

| Key | Type | Required | Example | What it is |
|---|---|---|---|---|
| `name` | text | yes | `sit` | Its node in the GLB. |
| `clip` | text \| whole number | yes | `Crowd_Sit_Idle` | The clip (any clips form) to pose at. |
| `time` | number |  | `1` | Seconds into the clip as exported (default 0). |

<a id="model-defaults"></a>
## Model defaults

The `defaults` object: Model keys every model starts from (never asset or name). Asset fields do not apply to built kinds, and `trackpiece` / `terrain` here hold the fields those kinds share.

| Key | Type | Required | Example | What it is |
|---|---|---|---|---|
| `collider` | "box" \| "convex" \| "trimesh" |  |  | The collider the export carries (CS-FB-002): box (the manifest's box; default for assets), trimesh (also a collider node in the GLB; default for track pieces) or convex (assets: the hull of the visual mesh). |
| `colliderExclude` | text \| [text, …] |  | `["wheel","door"]` | Parts a trimesh or convex collider leaves out, by role (wheel, door…) or part name. Default the moving parts; [] keeps every part. |
| `convexMaxVertices` | whole number |  | `255` | With collider convex: the most vertices the hull may have (default 255, what physics engines take). |
| `clips` | text \| [text, …] |  | `["POLY_IDL_Base@Masculine"]` | Clips baked into the GLB (characters only): a clip name, name@Masculine\|Feminine\|Neutral, name@Polygon\|Sidekick (the rig family), name@<pack>, or an animation id. |
| `inPlace` | true \| false |  |  | In-place clips (default true); false keeps the root motion. |
| `attach` | text \| [text, …] |  | `["SM_Veh_Pickup_Lift_01"]` | Extra pieces: bundled attachments of the same file by mesh name, or other attachment assets by name or id. |
| `replaceWheels` | true \| false |  |  | When an attachment brings four road wheels of its own (a lift kit), the model's own are dropped and the attachment's become the wheels (default true). |
| `origin` | "bottom-centre" \| "axle-centre" \| "pivot" |  |  | Where the model's origin goes: the centre of its bottom (default), the centre of the wheel axles at axle height (vehicles), or the source model's own origin. |
| `texSize` | whole number |  | `1024` | Largest texture side in pixels (scaled down to fit, never up). Default by kind: props 256, vehicles and characters 1024. |
| `texFormat` | "png" \| "webp" \| "keep" |  |  | Texture format: webp (default), png, or keep (as ingested). |
| `simplify` | number |  | `0.5` | Mesh simplification: the fraction of triangles to keep (0.05–1; 1 or unset = none). |
| `tint` | text |  | `#c62828` | A colour (#rgb / #rrggbb): recolours the body paint. Not with variants. |
| `variants` | text \| [[Model variant](#model-variant), …] |  | `[{"name":"red","tint":"#c62828"}]` | Paint variants in one GLB: [{ name, tint }] (or "red=#c62828,blue=#1e5bc6,plain"). The first is the default look. |
| `compress` | "meshopt" \| "none" |  |  | Geometry compression: meshopt (three.js needs MeshoptDecoder) or none (default). |
| `fit` | { length, width, height } |  | `{"length":4.5}` | Scale the model uniformly so a dimension matches, in metres. With several, the smallest scale wins. |
| `pose` | text \| [Model pose](#model-pose) |  | `{"clip":"Crowd_Sit_Idle","time":1}` | Bake a character into one static mesh posed at a clip's time: { clip, time } or "Clip:0.2". Not with clips or poses. |
| `poses` | text \| [[Named pose](#model-named-pose), …] |  |  | Several posed static meshes in one GLB, a node per pose: [{ name, clip, time }] or "idle=Idle:0,wave=Wave_01:0.2". Not with clips or pose. |
| `splitBySwatch` | true \| false |  |  | Split the model's triangles by palette swatch (OR-FB-022): a child node swatch_<hex> per atlas colour with its own material. Static models only. |
| `lods` | text \| [number, …] |  | `[0.5,0.2]` | Levels of detail in the same GLB, as falling shares of the triangles ([0.5, 0.2]); at most 4. |
| `paint` | text |  | `#e3b52f` | The paint a tint or variants recolour (CS-FB-026): a colour #rrggbb (the swatch that is its paint) or a material name. Default: found. |
| `decals` | true \| false |  |  | CS-FB-028: false paints over every decal and livery in the paint's texture with the paint. Default true: only small lettering enclosed by the paint. |
| `trackpiece` | [Track piece defaults](#trackpiece-defaults) |  |  | Track fields every piece shares (cell, width, profile, materials…), merged under each piece's own. |
| `terrain` | [Terrain (3D) defaults](#terrain3d-defaults) |  |  | Terrain fields every entry shares (cell, height, biome, materials…), merged under each terrain's own. |

<a id="trackpiece-defaults"></a>
## Track piece defaults

`defaults.trackpiece`: track fields every piece shares, merged under each piece's own (never preset or path).

| Key | Type | Required | Example | What it is |
|---|---|---|---|---|
| `cell` | number |  | `30` | The grid's cell in metres (default 30). |
| `footprint` | [whole number, whole number] |  | `[1,2]` | Declared footprint in cells [across (X), along (Z)]; checked against the geometry. |
| `elevation` | number |  |  | Height of the entry above the ground (default 0; a bridge preset sets it). |
| `bank` | number |  |  | Entry bank, degrees (default 0); on a banked curve, the bank (default 30). |
| `pitch` | number |  |  | Entry pitch, degrees (default 0). |
| `bankPivot` | "low-edge" \| "centre" |  |  | Bank about the edge that goes down, which stays at path height (default), or about the centre line. |
| `profile` | [Track profile](#track-profile) |  |  | The cross-section at the entry. |
| `width` | number |  | `10` | A shorthand for profile.width. |
| `branches` | [[Track branch](#track-branch), …] |  |  | Side paths with their own sockets. |
| `materials` | { deck, kerb, kerbAlt, wall, support } |  | `{"deck":"#404040"}` | Synty swatches per slot (deck, kerb, kerbAlt, wall, support): "Pack/Asset", "Pack/Asset#rrggbb", "Pack/Material" or "#rrggbb". |
| `supports` | "auto" \| "none" \| "pillars" \| "solid" \| { kind, spacing, size } |  |  | Pillars or a solid fill down to y = 0 under elevated parts; auto (default) pillars where the deck is over 1.5 m up, solid for ramps. |
| `stripe` | number |  |  | Kerb stripe length in metres (default 2). |
| `edge` | text |  | `highway` | The edge kind a flat road end reports in its socket (default road; e.g. highway for a dual carriageway). |
| `length` | number |  | `2` | Cells along the piece (straight, slope, ramp, jump, corkscrew, pipe, tunnel, bridge, chicane…). |
| `size` | number |  | `2` | Curves and splits: the footprint in cells (1: 1×1, radius half a cell; 2: 2×2, radius 1.5 cells). |
| `angle` | number |  |  | Curves: degrees turned (default 90). Ramps / jumps: the lip angle (default 20). Helix and barrel roll: up to 1440. |
| `radius` | number |  |  | Loop: its radius in metres. Curves: the centre-line radius (instead of size). Pipe: the tube's radius. Helix: its radius. Barrel roll: the roll axis's height above the deck. |
| `transition` | number |  |  | Banked curve: the share of the arc each bank ramp takes. Slope: the share of the run each curved end takes (default 0.25). |
| `bankIn` | number |  |  | Banked curve: bank at the entry (default 0). |
| `bankOut` | number |  |  | Banked curve: bank at the exit (default 0). |
| `from` | number \| [Track profile](#track-profile) |  |  | Bank transition: the bank at the entry (degrees). Narrow: the wide profile at the entry ({ width, edge, median… }). |
| `to` | number \| [Track profile](#track-profile) |  |  | Bank transition: the bank at the exit (degrees). Widen: the wide profile at the exit. |
| `height` | number |  |  | Slopes: the rise (m); ramps / jumps: the lip height; bridges: the deck height; tunnels: the clear height; helix: the climb over its turn (negative descends). |
| `shift` | number |  |  | Loop and chicane: the sideways offset (m). |
| `side` | number |  |  | Corkscrew: the cells it moves sideways (default 1). |
| `align` | "offset" \| "inline" |  |  | Loop: offset (default; the exit leaves shift metres to the side of the entry) or inline (2 cells, exit on the centre line). |
| `turn` | "left" \| "right" |  |  | Loop: which way the exit moves (default right). Barrel roll: the wall the deck climbs first. |
| `offset` | true \| false |  |  | Chicane: true makes it a lane change, the exit shift metres to the side of the entry (default false: an S-bend that ends in line). |
| `travel` | number |  |  | Helix: cells it advances along its entry heading while it turns (default 0). |

<a id="terrain3d-defaults"></a>
## Terrain (3D) defaults

`defaults.terrain`: terrain fields every entry shares (cell, height, biome, materials, shape…), merged under each terrain's own (never tile or heights).

| Key | Type | Required | Example | What it is |
|---|---|---|---|---|
| `cell` | number |  | `30` | The grid's cell in metres (default 30, as track pieces). |
| `height` | number |  | `13` | One height step in metres (default 0.44 cell). Heights count steps. |
| `dir` | "N" \| "E" \| "S" \| "W" \| "NE" \| "NW" \| "SE" \| "SW" |  |  | The way a tile faces: slope, the uphill side N\|E\|S\|W; corners, the uphill corner NE\|NW\|SE\|SW; coast, the water's corner. |
| `water` | [text \| [text \| number, …], …] |  | `["..w",".ww"]` | Water per tile (rows × cols): "" or "." land, "w" water, NE \| NW \| SE \| SW a coast; a string of one char a tile also works ("..w"). |
| `level` | number |  |  | The water surface's height in metres (default 0.02). |
| `depth` | number |  |  | How far the bed under open water sinks below the surface, metres (default 1.5). |
| `shape` | "planar" \| "track" |  |  | Slope faces: planar (default; straight faces) or track (the slope-up piece's curve, so a road slope fits). |
| `transition` | number |  |  | track shape: the share of the run each curved end takes (default 0.25). |
| `subdiv` | whole number |  |  | Subdivisions per tile side (default 1 planar, 8 track). |
| `skirt` | number |  |  | Vertical walls this many metres down from the outer edges (default 0: none). |
| `chunk` | whole number |  |  | Tiles per chunk side: a grid is cut into chunk × chunk meshes (default 10). |
| `biome` | "meadow" \| "desert" \| "alpine" \| "tropical" \| "swamp" |  |  | A swatch set: meadow (default), desert, alpine, tropical, swamp. |
| `materials` | { ground, slope, shore, seabed, water, skirt } |  | `{"ground":"POLYGON_Generic_v3/Generic_Grass"}` | Swatches per slot (ground, slope, shore, seabed, water, skirt): "Pack/Asset", "Pack/Asset#rrggbb", "Pack/Material" or "#rrggbb". |
| `slopeAngle` | number |  |  | Faces steeper than this (degrees) take the slope material (default 45). |
| `shade` | number |  |  | Brightness variation between faces, 0–0.3 (default 0.06). |
| `seed` | number |  |  | Seed of the shading and the scatter (default 1). |
| `scatter` | [[Terrain scatter](#terrain-scatter), …] |  |  | Props scattered over the ground (at most 8 kinds). |
| `clear` | [[whole number, whole number], …] |  | `[[0,0]]` | Tiles [i, j] kept free of scatter (where track pieces go). |

<a id="textures-file"></a>
# ssg.textures.json

Declares the library textures a game keeps in a folder (`slop build` writes each as an image plus a `.json` of its size, background and frame grid, and removes the ones no longer declared).

| Key | Type | Required | Example | What it is |
|---|---|---|---|---|
| `$schema` | text |  |  | The JSON Schema this file follows (editors use it); ignored. |
| `comment` | anything |  |  | A note for people; ignored. |
| `textures` | [[Texture](#texture), …] | yes |  | The textures to keep in the folder. |
| `defaults` | [Texture defaults](#texture-defaults) |  |  | Settings for every texture (size, format, pack). |

<a id="texture"></a>
## Texture

One texture to export: `<name>.png` (or `.webp`) and `<name>.json` (size, background and frame grid) in the folder.

| Key | Type | Required | Example | What it is |
|---|---|---|---|---|
| `name` | text |  | `ground-sand` | File name in the folder (without extension); unique. Default: the texture file's own name. |
| `texture` | text \| whole number | yes | `POLYGON_Generic_v3/Textures/Generic_Grass.png` | A texture name, a path from `textures --all` (Pack/…/File.png), or an asset id. |
| `pack` | text |  | `POLYGON_War` | The pack to look in when several have a texture of that name. |
| `size` | whole number |  | `512` | Largest side in pixels, 8–8192: scaled down to fit, never up. |
| `format` | "png" \| "webp" |  |  | The image format written: png or webp. |
| `comment` | anything |  |  | A note for people; ignored. |

<a id="texture-defaults"></a>
## Texture defaults

Settings every texture starts from (`defaults`): a texture's own keys win.

| Key | Type | Required | Example | What it is |
|---|---|---|---|---|
| `pack` | text |  | `POLYGON_War` | The pack to look in when several have a texture of that name. |
| `size` | whole number |  | `512` | Largest side in pixels, 8–8192: scaled down to fit, never up. |
| `format` | "png" \| "webp" |  |  | The image format written: png or webp. |
| `comment` | anything |  |  | A note for people; ignored. |
