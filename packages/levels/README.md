# @slop/levels

Tilesets, Tiled maps and the level tools of the Sloponator (P4, [#17](https://github.com/ali3b/sloponator/issues/17),
[#18](https://github.com/ali3b/sloponator/issues/18)): the old generator's `packages/shared/src/tileset` and
`map` moved in with their tests, the server side they needed ported to Node, and maps turned from database rows into
files a game keeps.

```ts
import { buildLevels } from '@slop/levels';

// The tilesets and maps of a game's ssg.assets.json → <out>/tilesets/<name>/ and each map's export folder.
const r = await buildLevels('ssg.assets.json', { out: 'public/assets' });
r.tilesets; // [{ name: 'temperate', tiles: 1394, changes: [], files: [...temperate.png, ...temperate.tsj] }, …]
r.maps;     // [{ name: 'mission1', size: '128x256', ops: 72, objects: 979, zones: 35, files: [...mission1.tmj, ...temperate.png] }, …]
```

```ts
import { createMap, replayOps, exportMap, mapRoute, spriteCatalog, declareTileset, parseTilesetDecls } from '@slop/levels';

const [decl] = parseTilesetDecls([{ name: 'meadow', terrains: ['grass', 'dirt'], pairs: 'all' }]);
const ground = declareTileset(null, decl);
const sprites = spriteCatalog(file.sprites, { out: 'public/assets' });       // declared sprites + their built folders
let map = createMap('yard', { width: 32, height: 32, tilesets: [{ name: 'meadow', body: ground }] });
map = replayOps(map, [{ op: 'path', points: [[0, 16], [32, 16]], terrain: 'dirt', width: 2 }, { op: 'scatter', objects: [{ sprite: 'tree' }], count: 40 }], { sprites, tilesets: [ground] }).map;
mapRoute(map, { from: '0.5,16.5', to: '31.5,16.5', clearance: 1 }, sprites);  // FB-110/125
exportMap(map, { tilesets: [{ body: ground }], sprites, embed: true }).files;   // { 'yard.tmj': '…' }
```

## What moved

| Old (synty-sprite-generator) | Here |
|---|---|
| `packages/shared/src/tileset/*` (types, ops, declare, raster, tiled) | `src/tileset/`, unchanged apart from imports: the light grade and the camera's pixels-per-metre come from `@slop/sprites` |
| `packages/shared/src/map/*` (types, ops, generate, plan, stamp, fence, transform, route, resolve, elevation, tiled, sheet, preview, draw, noise, objectSummary) | `src/map/`, unchanged apart from imports |
| `apps/server/src/png.ts` (PNG encoder, PNG/TGA decoders) | `src/tileset/image.ts`, byte for byte, so atlases come out identical |
| `apps/server/src/tileRender.ts`, `textures.ts` (texture lookup, average colour) | `src/tileset/textures.ts`: pack folders instead of the database |
| `packages/client/src/tilesetApply.ts` + server `tilesets.ts` (declare, check, render, download) | `src/tileset/build.ts` `buildTileset`, `bodyFromTsj` |
| server `opSprites.ts` (sprite names in ops, FB-032), `maps.ts` opsContext / objectBlockOf / collisionPolygons, `mapSprites.ts` | `src/map/sprites.ts`: the declared sprites and their built folders instead of project rows and export zips |
| server `maps.ts` create / ops / route / stamps, client `maps.ts` export | `src/map/file.ts`: `createMap`, `replayOps`, `stampFromMap`, `exportMap`, `mapRoute` |
| Solitary Strike's `scripts/build-assets.mjs` (tilesets) and `build-maps.mjs` (`map create`, `map edit @ops`, `map stamp save`, `map export -f tmj --embed`) | `src/build.ts` `buildLevels` |

Every op of the old `applyOps` replays unchanged: brushes (paint, fill, rect, line), place / move / remove / set,
zones (addZone, editZone, removeZone), layers, `clear`, `cliffs`, `resize`, `transform`, and the generators
`generate`, `scatter`, `path`, `fence`, `stamp`, with the level tools:

- **Routes** (FB-110, 122, 123, 125, 128): `findRoute` / `mapRoute` on the walk grid (collision layers and
  solid footprints block), `avoidRoute` on place / addZone / scatter (a margin, `via` chains, `legs`, `at: "end"`),
  the `checkRoute` op re-checking every stored guard, and `clearance` in metres measured from the placed sprites'
  ground collision polygons (a tree's trunk, not its canopy's footprint), footprints only for objects without one.
  FB-127 (a batch that changes nothing saves nothing) is, for files, a rebuild that writes the same bytes.
- **Zones** (spawn, patrol, objective, extraction, trigger, custom; point, rect, polygon, polyline), with a vehicle
  and speed on patrols (FB-059) and `clearRect` / `clearZone` (FB-101).
- **Game-only markers** (FB-095, FB-100): `collision: false` objects (mines, trigger plates): no collision polygon in
  the export (`collides: false`), never blocking or blocked by solid objects, still keeping off each other.

## Tilesets: what a build reads and writes

`buildTileset(decl, { previous, textures })` declares the tileset (`declareTileset`: the declaration is the whole
truth, terrains it does not list are removed), resolves texture terrains in the installed packs, draws the atlas
with the pure ground renderer and writes `<name>.png` + `<name>.tsj` (`.tsx` on request).

**Texture terrains render here too.** The old ground renderer was never a browser one: its server decoded the Synty
texture (PNG or TGA) and ran the same pure renderer, so no render bundle is needed and no `renderTiles` seam was
made. The packs are the old generator's (`<dataDir>/packs` and the library's model pack folders, through
`@slop/library`); a texture that is not there is an error naming the terrain and the closest textures.

**Tile ids across builds.** The old generator kept each tileset in its database, so a terrain added later got new
ids and every old id kept its tile: maps made with the tileset stayed valid. Solitary Strike's `temperate` grew that
way, and its ids are not what a fresh declaration gives. A file-based build takes the previous body from the `.tsj`
the last build wrote into `<out>/tilesets/<name>/` (`bodyFromTsj`: ids, corners and variants from the wangsets, terrain
ids from the colours, own tile properties and collision, on-demand mixes) and declares on top of it. That `.tsj` is
the file the game's maps were made against, so keep it: commit it, or keep the output folder (a game that
git-ignores `public/assets` should not delete it between builds). Without it the tileset starts fresh and says
`new`. The change report (`changes`) then lists only what the file shows changed.

## Maps: the file-based model

The old generator stored a map as a row in its database: a body, a revision, 50 undo steps, a project and its
sprites by id, edited only through its server (`ssg map edit`, the MCP, the web editor). Here:

- **A map is a document a game keeps:** `<name>.map.json`, `ssg-map/1` (schema in `@slop/formats`, `ssgMap`). It is the
  old body with its tilesets named (`"tilesets": ["temperate"]`) instead of database ids. Git is the undo stack.
- **An edit is a list of the same ops** replayed with `replayOps` (atomic: every op applies or none does, each failure
  named). Ops name sprites the way games already wrote them (`"sprite": "tree"`, or `"POLYGON_War/SM_Prop_Wire_01"`);
  they are looked up in the declaration's `sprites` and their footprints, facings, states and collision read from
  the folders `slop build` wrote (`<out>/<sprite>/*.meta.json`). A sprite's id is its position in `sprites` (1-based),
  or what `spriteIds` says; the export also carries its name and folder (`sprite`, `exportName`), which is what games read.
- **Stamps** are cut from a map by its entry's `stamps` and kept for the maps after it in the same build (the old
  `map_stamps` table).

### `maps` entries in ssg.assets.json

Solitary Strike's entries are read unchanged; paths are relative to the file's folder.

| Key | |
|---|---|
| `name` | the map's name (unique) |
| `size`, `tileset` (or `tilesets: [...]`), `terrain` | a new map: `"128x256"`, the ground tileset by its declared name, the ground before the ops |
| `ops` | a JSON file of ops (`"maps/mission1.ops.json"`) or the ops inline; replayed onto a new map after a `clear`, as `build-maps.mjs` did |
| `stamps` | `[{ name, rect: [x0, y0, x1, y1], layers? }]` cut after the ops, for later maps' `stamp` ops |
| `export` | the folder the Tiled map goes to, emptied first: `<map>.tmj` with the tilesets embedded and each tileset's atlas next to it (the old `ssg map export -f tmj --embed`) |
| `map` | the map document: written after the ops; with no `ops`, the map itself (read, then exported) |
| `formats`, `embed`, `collisionShapes`, `objectData` | `["tmj", "tmx"]`; `embed: false` writes `<tileset>.tsj` next to the map instead; FB-066 shared object data |

## Goldens

`test/goldens.test.ts`, each skipped with a message when its files are not on the machine:

- **Monty's `tomb`** (colour/noise terrains, `packages/schema/test/fixtures/monty.assets.json`) against
  `~/projects/monty/public/assets/tilesets/tomb`: the atlas pixel for pixel (and byte for byte), the `.tsj`
  deep-equal.
- **Solitary Strike**: its 4 tilesets (texture terrains with tints, shores, triples) and all 14 maps replayed from
  `maps/*.ops.json` (two stamp sources, 12 missions with stamps, scatters, paths, fences, `avoidRoute` guards,
  markers): the 8 tileset files and the 12 exported `.tmj` files with their atlases against the game's
  `public/assets`, **byte for byte** (32 files). The game is only read: its declaration and ops are copied into
  `test-results/`. The sprite ids are the old project's (read from its database read-only), the one number a
  file-based build cannot know. The written map documents validate against `ssg-map/1`.

## Tests

`npm test`: 242 in this package. The 227 moved with the code (19 files, the old `tileset/*.test.ts` and
`map/*.test.ts` unchanged: seams, shores, cliffs, mixes, generators and their FB fixes, transforms, large maps, the
Tiled writers, previews, routes, route guards and clearance), 13 on the file-based model (`test/build.test.ts`), and
the 2 goldens.

## Not here yet (deferred)

- **The map editor** (the old web app's map page) and the `ssg map …` / MCP map commands. Maps are edited as files
  and op lists; the editor belongs to the one UI of P9.
- **Map previews** (`preview.png`, `minimap.png`, which `build-maps.mjs` also wrote): the pure renderer moved
  (`renderMapPreview`, `renderMinimap`, with their tests), but feeding it the placed sprites' pictures (the old
  server's `mapPreview.ts`) is not wired into `buildLevels`.
- **Tile objects** (`--tile-objects`: an image collection of each placed sprite's still for Tiled) and the
  `missingMixes` `add-mixes` fix as a build step (the warning is reported; add the mixes to the declaration).
- **Textures outside the old packs**: texture terrains resolve in the old generator's data dir until the library
  has its own store.
