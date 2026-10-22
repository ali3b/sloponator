// Moved from synty-sprite-generator apps/server/test/bundled.test.ts (P3, ali3b/sloponator#14): the GLB reading; the DB sync tests stayed with the old ingest.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { bundledMeshes, pieceKey, readGlbJson } from '../src/build/glb.js';

/** A GLB holding only a JSON chunk: enough for the node / mesh / accessor tables the server reads. */
function writeGlb(file: string, json: object) {
  let body = Buffer.from(JSON.stringify(json), 'utf8');
  if (body.length % 4) body = Buffer.concat([body, Buffer.alloc(4 - (body.length % 4), 0x20)]);
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + body.length, 8);
  head.writeUInt32LE(body.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([head, body]));
}

/**
 * A combined character file like POLYGON_Generic's Generic_Characters.fbx: two bodies and three bundled pieces on
 * one armature (scaled 0.01, as Synty's centimetre rigs export), one piece static and parented to a bone.
 */
const gltf = {
  nodes: [
    { name: 'Armature', children: [1, 2, 3, 4, 5, 6], scale: [0.01, 0.01, 0.01] },
    { name: 'SM_Gen_Chr_Business_Male_01', mesh: 0, skin: 0 },
    { name: 'SM_Gen_Chr_Business_Female_01', mesh: 0, skin: 0 },
    { name: 'SM_Gen_Chr_Attach_Hair_01', mesh: 1, skin: 0 },
    { name: 'SM_Gen_Chr_Attach_Hood_01', mesh: 1, skin: 0 },
    { name: 'SM_Char_Attach_Male_Armor_01', mesh: 1, skin: 0 },
    { name: 'Head', translation: [0, 160, 0], children: [7] },
    { name: 'SM_Gen_Chr_Attach_Glasses_01', mesh: 2, translation: [0, 10, 5] },
  ],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }, { primitives: [{ attributes: { POSITION: 1 } }] }, { primitives: [{ attributes: { POSITION: 2 } }, { attributes: { POSITION: 3 } }] }],
  accessors: [
    { min: [-50, 0, -20], max: [50, 180, 20] },
    // Skinned: metres already (glTF ignores the skinned node's transform, the joints place it).
    { min: [-0.12, 1.5, -0.12], max: [0.12, 1.85, 0.12] },
    { min: [-8, -2, 0], max: [0, 2, 3] },
    { min: [0, -2, 0], max: [8, 2, 3] },
  ],
};

describe('bundled attachments (combined character files)', { timeout: 20000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssg-bundled-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  writeGlb(path.join(dir, 'glb/p1/a10.glb'), gltf);

  it('reads the attachment meshes of a GLB: skinned or not, rest-pose bounds in the file space', () => {
    const meshes = bundledMeshes(readGlbJson(path.join(dir, 'glb/p1/a10.glb')));
    expect(meshes.map((m) => [m.name, m.skinned])).toEqual([
      ['SM_Char_Attach_Male_Armor_01', true],
      ['SM_Gen_Chr_Attach_Glasses_01', false],
      ['SM_Gen_Chr_Attach_Hair_01', true],
      ['SM_Gen_Chr_Attach_Hood_01', true],
    ]);
    expect(meshes.find((m) => m.name === 'SM_Gen_Chr_Attach_Hair_01')!.bounds).toEqual({ min: [-0.12, 1.5, -0.12], max: [0.12, 1.85, 0.12] });
    // Through the head bone: (0, 160 + 10, 5) cm, both primitives.
    expect(meshes.find((m) => m.name === 'SM_Gen_Chr_Attach_Glasses_01')!.bounds).toEqual({ min: [-0.08, 1.68, 0.05], max: [0.08, 1.72, 0.08] });
  });

  it('one name for a piece shipped two ways', () => {
    expect(pieceKey('SK_Chr_Attach_Female_Armor_01')).toBe(pieceKey('SM_Char_Attach_Female_Armor_01'));
    expect(pieceKey('SM_Gen_Chr_Attach_Hair_01')).not.toBe(pieceKey('SM_Gen_Chr_Attach_Hair_01_alt'));
  });
});
