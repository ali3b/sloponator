import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Document, NodeIO, TextureInfo, type Mesh } from '@gltf-transform/core';
import { MeshoptDecoder } from 'meshoptimizer';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normaliseSpec, specHash } from '../src/index.js';
import { encodePng } from '../src/build/png.js';
import sharp from 'sharp';
import { buildModel, modelIO, paintTint, windowKeys } from '../src/build/modelBuild.js';

// Moved from synty-sprite-generator apps/server/test/models.test.ts (P3, ali3b/sloponator#14): the buildModel part;
// the exportModel-and-routes part (DB + Fastify) is replaced by export.test.ts (a stub library) and golden.test.ts.
/**
 * The 3D model exporter on small GLBs built here (no data dir): a Synty-shaped vehicle (an FBX root turned +90° about
 * X and scaled 0.01, wheels pivoted at the vehicle origin), a combined character file (two bodies and a bundled
 * piece on one skeleton) and baked clips (skeleton-only, one animation each, as bake.ts writes them).
 */

const Q_X90: [number, number, number, number] = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
const Q_XM90: [number, number, number, number] = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];

function texture(doc: Document) {
  const data = new Uint8Array(64 * 64 * 4).fill(200);
  return doc.createTexture('palette').setMimeType('image/png').setImage(new Uint8Array(encodePng({ width: 64, height: 64, data })));
}

/** A box primitive between two corners (positions, uvs, a black COLOR_0 layer and optional skin attributes on one joint). */
function boxPrim(doc: Document, lo: number[], hi: number[], material: ReturnType<Document['createMaterial']>, skin: boolean | number = false) {
  const buf = doc.getRoot().listBuffers()[0];
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i < 8; i++) pos.push(i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]);
  const faces = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
  for (const [a, b, c, d] of faces) idx.push(a, b, c, a, c, d);
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buf))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(16).fill(0.5)).setBuffer(buf))
    .setAttribute('COLOR_0', doc.createAccessor().setType('VEC4').setArray(new Float32Array(32)).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(idx)).setBuffer(buf))
    .setMaterial(material);
  if (skin !== false) {
    const joint = skin === true ? 1 : skin;
    prim.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(new Uint16Array(32).map((_, i) => (i % 4 === 0 ? joint : 0))).setBuffer(buf));
    prim.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(new Float32Array(32).map((_, i) => (i % 4 === 0 ? 1 : 0))).setBuffer(buf));
  }
  return prim;
}

/** A box mesh between two corners. */
function box(doc: Document, name: string, lo: number[], hi: number[], material: ReturnType<Document['createMaterial']>, skin: boolean | number = false): Mesh {
  return doc.createMesh(name).addPrimitive(boxPrim(doc, lo, hi, material, skin));
}

/**
 * SM_Veh_Test_01: a 4 m long, 2 m wide body and four 0.6 m wheels, in centimetres under a +90° X / 0.01 root (so
 * the FBX's +Y forward is glTF's +Z). `facing: -1` builds it facing -Z (front wheels at -Z).
 */
async function vehicleGlb(file: string, facing = 1) {
  const doc = new Document();
  doc.createBuffer();
  const mat = doc.createMaterial('MAT_01').setBaseColorTexture(texture(doc));
  const root = doc.createNode('SM_Veh_Test_01').setRotation(Q_X90).setScale([0.01, 0.01, 0.01]);
  // Local (FBX) frame: x across, y forward, z down (world y = -z, world z = y).
  root.setMesh(box(doc, 'body', [-100, -200, -150], [100, 200, -60], mat));
  for (const [n, x, y] of [['FL', 90, 140], ['FR', -90, 140], ['RL', 90, -140], ['RR', -90, -140]] as const) {
    const fy = y * facing;
    root.addChild(doc.createNode(`SM_Veh_Test_01_Wheel_${n}`).setMesh(box(doc, `w${n}`, [x - 15, fy - 30, -60], [x + 15, fy + 30, 0], mat)));
  }
  doc.createScene('Scene').addChild(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await new NodeIO().write(file, doc);
}

const vehicleParts = (facing = 1) =>
  (['FL', 'FR', 'RL', 'RR'] as const).map((n) => {
    // The ingest's part box, in glTF scene space.
    const x = n[1] === 'L' ? 0.9 : -0.9, z = (n[0] === 'F' ? 1.4 : -1.4) * facing;
    return { name: `SM_Veh_Test_01_Wheel_${n}`, role: 'wheel', pivot: [0, 0, 0], spin_axis: [1, 0, 0], bbox_min: [x - 0.15, 0, z - 0.3], bbox_max: [x + 0.15, 0.6, z + 0.3] };
  });

/**
 * A combined character file: Armature (+90° X, 0.01) > Root (-90° X) > Hips > Spine > UpperArm_L/R > LowerArm_L/R
 * (centimetres); two bodies and a hat. The test body stands in a T-pose: a 0.4 m torso with 0.7 m arms out to the
 * sides at 1.4 m (1.8 m across, 1.8 m tall).
 */
async function characterGlb(file: string, armature = 'Armature', withMeshes = true) {
  const doc = new Document();
  doc.createBuffer();
  const mat = doc.createMaterial('MAT_chr').setBaseColorTexture(texture(doc));
  const arm = doc.createNode(armature).setRotation(Q_X90).setScale([0.01, 0.01, 0.01]);
  const rootBone = doc.createNode('Root').setRotation(Q_XM90);
  const hips = doc.createNode('Hips').setTranslation([0, 90, 0]);
  const spine = doc.createNode('Spine').setTranslation([0, 20, 0]);
  const arms = (['L', 'R'] as const).map((side) => {
    const x = side === 'L' ? 1 : -1;
    const upper = doc.createNode(`UpperArm_${side}`).setTranslation([20 * x, 30, 0]);
    const lower = doc.createNode(`LowerArm_${side}`).setTranslation([30 * x, 0, 0]);
    spine.addChild(upper);
    upper.addChild(lower);
    return [upper, lower];
  });
  arm.addChild(rootBone);
  rootBone.addChild(hips);
  hips.addChild(spine);
  const scene = doc.createScene('Scene').addChild(arm);
  if (withMeshes) {
    // Joints: Root, Hips, Spine, UpperArm_L, LowerArm_L, UpperArm_R, LowerArm_R. Each inverse bind matrix undoes its
    // joint's world transform (a uniform 0.01 scale and a translation here), so skinned positions are metres.
    const joints = [rootBone, hips, spine, ...arms.flat()];
    const ibms = joints.flatMap((j) => {
      const m = Array.from(j.getWorldMatrix());
      const s = m[0];
      return [1 / s, 0, 0, 0, 0, 1 / s, 0, 0, 0, 0, 1 / s, 0, -m[12] / s, -m[13] / s, -m[14] / s, 1];
    });
    const ibm = doc.createAccessor().setType('MAT4').setArray(new Float32Array(ibms)).setBuffer(doc.getRoot().listBuffers()[0]);
    const skin = doc.createSkin('Armature').setSkeleton(rootBone).setInverseBindMatrices(ibm);
    for (const j of joints) skin.addJoint(j);
    const body = doc
      .createMesh('a')
      .addPrimitive(boxPrim(doc, [-0.2, 0, -0.15], [0.2, 1.8, 0.15], mat, 1))
      .addPrimitive(boxPrim(doc, [0.2, 1.35, -0.05], [0.9, 1.45, 0.05], mat, 3))
      .addPrimitive(boxPrim(doc, [-0.9, 1.35, -0.05], [-0.2, 1.45, 0.05], mat, 5));
    arm.addChild(doc.createNode('Character_Test_01').setMesh(body).setSkin(skin));
    arm.addChild(doc.createNode('Character_Other_01').setMesh(box(doc, 'b', [-0.9, 0, -0.15], [0.9, 2.2, 0.15], mat, true)).setSkin(skin));
    arm.addChild(doc.createNode('SM_Chr_Attach_Hat_01').setMesh(box(doc, 'c', [-0.12, 1.75, -0.12], [0.12, 1.95, 0.12], mat, true)).setSkin(skin));
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await new NodeIO().write(file, doc);
  return { doc, scene, hips };
}

/** A baked clip: Armature.001 > Root > Hips, the hips turning (and travelling `travel` cm in z) over `seconds`. */
async function bakeGlb(file: string, clip: string, seconds: number, travel = 0, armsDown = false) {
  const doc = new Document();
  const buf = doc.createBuffer();
  const arm = doc.createNode('Armature.001').setRotation(Q_X90).setScale([0.01, 0.01, 0.01]);
  const rootBone = doc.createNode('Root').setRotation(Q_XM90);
  const hips = doc.createNode('Hips').setTranslation([0, 90, 0]);
  arm.addChild(rootBone);
  rootBone.addChild(hips);
  doc.createScene().addChild(arm);
  const n = Math.round(seconds * 30) + 1;
  const times = new Float32Array(n).map((_, i) => i / 30);
  const rot = new Float32Array(n * 4);
  const tr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / (n - 1)) * Math.PI * 0.5;
    rot.set([0, Math.sin(a / 2), 0, Math.cos(a / 2)], i * 4);
    tr.set([0, 90, (travel * i) / (n - 1)], i * 3);
  }
  const input = doc.createAccessor().setType('SCALAR').setArray(times).setBuffer(buf);
  const anim = doc.createAnimation(clip);
  const sR = doc.createAnimationSampler().setInput(input).setOutput(doc.createAccessor().setType('VEC4').setArray(rot).setBuffer(buf)).setInterpolation('LINEAR');
  const sT = doc.createAnimationSampler().setInput(input).setOutput(doc.createAccessor().setType('VEC3').setArray(tr).setBuffer(buf)).setInterpolation('LINEAR');
  anim.addSampler(sR).addSampler(sT);
  anim.addChannel(doc.createAnimationChannel().setTargetNode(hips).setTargetPath('rotation').setSampler(sR));
  anim.addChannel(doc.createAnimationChannel().setTargetNode(hips).setTargetPath('translation').setSampler(sT));
  // A channel on the bake's own armature node, which the character does not have by that name: skipped.
  const sA = doc.createAnimationSampler().setInput(input).setOutput(doc.createAccessor().setType('VEC3').setArray(new Float32Array(n * 3).fill(0.01)).setBuffer(buf)).setInterpolation('LINEAR');
  anim.addSampler(sA).addChannel(doc.createAnimationChannel().setTargetNode(arm).setTargetPath('scale').setSampler(sA));
  if (armsDown) {
    // The upper arms held 75° down from the T-pose (about Z) for the whole clip.
    const spine = doc.createNode('Spine').setTranslation([0, 20, 0]);
    hips.addChild(spine);
    for (const [side, sign] of [['L', -1], ['R', 1]] as const) {
      const upper = doc.createNode(`UpperArm_${side}`).setTranslation([-20 * sign, 30, 0]);
      spine.addChild(upper);
      const a = (sign * 75 * Math.PI) / 180;
      const q = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) q.set([0, 0, Math.sin(a / 2), Math.cos(a / 2)], i * 4);
      const sU = doc.createAnimationSampler().setInput(input).setOutput(doc.createAccessor().setType('VEC4').setArray(q).setBuffer(buf)).setInterpolation('LINEAR');
      anim.addSampler(sU).addChannel(doc.createAnimationChannel().setTargetNode(upper).setTargetPath('rotation').setSampler(sU));
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await new NodeIO().write(file, doc);
}

const read = (bytes: Uint8Array) => modelIO().readBinary(bytes);

describe('model export (gltf-transform)', { timeout: 30000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssg-models-'));
  const vehicle = path.join(dir, 'glb/p1/a1.glb');
  const backwards = path.join(dir, 'glb/p1/a2.glb');
  const character = path.join(dir, 'glb/p2/a3.glb');
  const bake1 = path.join(dir, 'bakes/a10/n1.glb');
  const bake2 = path.join(dir, 'bakes/a10/n2.glb');
  const bake2rm = path.join(dir, 'bakes/a10/n2_rm.glb');
  beforeAll(async () => {
    await vehicleGlb(vehicle);
    await vehicleGlb(backwards, -1);
    await characterGlb(character);
    await bakeGlb(bake1, 'n1', 1, 0, true);
    await bakeGlb(bake2, 'n2', 2);
    await bakeGlb(bake2rm, 'n2_rm', 2, 300);
    await bakeGlb(path.join(dir, 'bakes/a10/n5.glb'), 'n5', 1.5);
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  const vehicleInput = (over: Partial<Parameters<typeof buildModel>[0]> = {}) => ({
    name: 'truck', source: { pack: 'P', asset: 'SM_Veh_Test_01', assetId: 1 }, kind: 'vehicle', glb: vehicle, scaleFix: 1,
    parts: vehicleParts(), origin: 'bottom-centre' as const, texFormat: 'keep' as const, ...over,
  });

  it('spec: defaults, validation and a hash that ignores key order and default values', () => {
    expect(normaliseSpec({ asset: ' 12 ' })).toEqual({ asset: 12, clips: [], inPlace: true, attach: [], origin: 'bottom-centre', texFormat: 'webp' });
    const a = specHash({ asset: 12, name: 'Truck', clips: ['Idle', 'Wave'] });
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(specHash({ clips: ['Idle', 'Wave', 'idle'], name: 'Truck', asset: '12', simplify: 1, texFormat: 'webp', compress: 'none', tint: '#FFF', inPlace: true })).toBe(a);
    expect(specHash({ asset: 12, name: 'Truck', clips: ['Idle', 'Wave'], texFormat: 'keep' })).not.toBe(a);
    expect(specHash({ asset: 12, name: 'Truck', clips: ['Wave', 'Idle'] })).not.toBe(a);
    expect(specHash({ asset: 12, name: 'Truck', clips: ['Idle', 'Wave'], texSize: 512 })).not.toBe(a);
    expect(normaliseSpec({ asset: 1, tint: '#f80', name: 'my truck!' })).toMatchObject({ tint: '#ff8800', name: 'my_truck_' });
    expect(() => normaliseSpec({ asset: '' })).toThrow(/asset/);
    expect(() => normaliseSpec({ asset: 1, origin: 'top' as never })).toThrow(/origin/);
    expect(() => normaliseSpec({ asset: 1, simplify: 0 })).toThrow(/simplify/);
    expect(() => normaliseSpec({ asset: 1, tint: 'red' })).toThrow(/tint/);
  });

  it('vehicle: wheels pivot at their own centres, the origin sits at the bottom centre, +Z forward', async () => {
    const { glb, manifest } = await buildModel(vehicleInput());
    expect(manifest.bounds.size).toEqual([2.1, 1.5, 4]);
    expect(manifest.bounds.min[1]).toBe(0);
    expect(manifest.wheels).toBeDefined();
    const fl = manifest.wheels!.fl;
    expect(fl).toEqual({ node: 'SM_Veh_Test_01_Wheel_FL', radius: 0.3, axle: [1, 0, 0], steer: true, pos: [0.9, 0.3, 1.4] });
    expect(manifest.wheels!.rr).toMatchObject({ steer: false, pos: [-0.9, 0.3, -1.4] });
    expect(manifest.parts.find((p) => p.node === fl.node)).toEqual({ node: fl.node, role: 'wheel', pivot: fl.pos, radius: 0.3, spinAxis: [1, 0, 0] });
    expect(manifest.collider.box).toEqual({ center: [0, 0.75, 0], size: [2.1, 1.5, 4] });
    expect(manifest).toMatchObject({ version: 1, units: 'm', forward: '+Z', up: '+Y', origin: 'bottom-centre', licence: expect.stringMatching(/Synty/) });
    // In the GLB: the wheel node is at its pivot with its geometry centred on it, no rotation or scale left.
    const doc = await read(glb);
    const root = doc.getRoot().getDefaultScene()!.listChildren();
    expect(root.map((n) => n.getName())).toEqual(['truck']);
    const wheel = doc.getRoot().listNodes().find((n) => n.getName() === fl.node)!;
    expect(wheel.getParentNode()!.getName()).toBe('truck');
    expect(wheel.getTranslation().map((v) => +v.toFixed(4))).toEqual([0.9, 0.3, 1.4]);
    expect(wheel.getRotation()).toEqual([0, 0, 0, 1]);
    const pos = wheel.getMesh()!.listPrimitives()[0].getAttribute('POSITION')!;
    expect(pos.getMin([]).map((v) => +v.toFixed(4))).toEqual([-0.15, -0.3, -0.3]);
    expect(pos.getMax([]).map((v) => +v.toFixed(4))).toEqual([0.15, 0.3, 0.3]);
    // The body node was named like the root: renamed. Vertex colours are gone; the texture is kept.
    expect(doc.getRoot().listNodes().some((n) => n.getName() === 'SM_Veh_Test_01_Mesh' || n.getName() === 'SM_Veh_Test_01')).toBe(true);
    expect(doc.getRoot().listMeshes().every((m) => m.listPrimitives().every((p) => !p.getAttribute('COLOR_0')))).toBe(true);
    expect(doc.getRoot().listTextures()).toHaveLength(1);
  });

  it('scale fix and origins are baked into the geometry', async () => {
    const big = await buildModel(vehicleInput({ scaleFix: 2 }));
    expect(big.manifest.bounds.size).toEqual([4.2, 3, 8]);
    expect(big.manifest.wheels!.fl).toMatchObject({ radius: 0.6, pos: [1.8, 0.6, 2.8] });
    const doc = await read(big.glb);
    expect(doc.getRoot().getDefaultScene()!.listChildren()[0].getScale()).toEqual([1, 1, 1]);
    const axle = await buildModel(vehicleInput({ origin: 'axle-centre' }));
    expect(axle.manifest.wheels!.fl.pos).toEqual([0.9, 0, 1.4]);
    expect(axle.manifest.bounds.min[1]).toBe(-0.3);
    const pivot = await buildModel(vehicleInput({ origin: 'pivot' }));
    // The source origin: the FBX root's, where the body's top is 1.5 m up and the wheels' bottom 0.
    expect(pivot.manifest.bounds.min).toEqual([-1.05, 0, -2]);
  });

  it('a vehicle facing -Z is turned round so it faces +Z', async () => {
    const { manifest } = await buildModel(vehicleInput({ glb: backwards }));
    expect(manifest.wheels!.fl.pos[2]).toBeGreaterThan(0);
    expect(manifest.wheels!.rl.pos[2]).toBeLessThan(0);
    expect(manifest.wheels!.fl.axle).toEqual([-1, 0, 0]);
  });

  it('a separate attachment (a lift kit with wheels) merges in place, its wheels pivoted as parts', async () => {
    const bodyFile = path.join(dir, 'glb/p1/a4.glb');
    const doc = new Document();
    doc.createBuffer();
    const mat = doc.createMaterial('MAT_body').setBaseColorTexture(texture(doc));
    doc.createScene().addChild(doc.createNode('SM_Veh_Body_01').setMesh(box(doc, 'body', [-1, 1.5, -2.2], [1, 2.5, 2.2], mat)));
    await new NodeIO().write(bodyFile, doc);
    const { glb, manifest } = await buildModel(
      vehicleInput({ glb: bodyFile, parts: [], source: { pack: 'P', asset: 'SM_Veh_Body_01', assetId: 4 }, attach: [{ name: 'SM_Veh_Test_01', glb: vehicle, scaleFix: 1, parts: vehicleParts() }] }),
    );
    expect(manifest.bounds.size).toEqual([2.1, 2.5, 4.4]);
    expect(manifest.wheels!.fl).toMatchObject({ node: 'SM_Veh_Test_01_Wheel_FL', pos: [0.9, 0.3, 1.4] });
    const out = await read(glb);
    expect(out.getRoot().listScenes()).toHaveLength(1);
    expect(out.getRoot().listBuffers()).toHaveLength(1);
  });

  it("an attachment with four road wheels replaces the body's own (replaceWheels), the steering wheel stays", async () => {
    const bodyFile = path.join(dir, 'glb/p1/a5.glb');
    const doc = new Document();
    doc.createBuffer();
    const mat = doc.createMaterial('MAT_body').setBaseColorTexture(texture(doc));
    const body = doc.createNode('SM_Veh_Body_02').setMesh(box(doc, 'body', [-1, 1.5, -2.2], [1, 2.5, 2.2], mat));
    // The body's own small wheels, up in the arches, and a steering wheel the pack tags a wheel too.
    const small = (['FL', 'FR', 'RL', 'RR'] as const).map((n) => {
      const x = n[1] === 'L' ? 0.8 : -0.8, z = n[0] === 'F' ? 1.4 : -1.4;
      body.addChild(doc.createNode(`SM_Veh_Body_02_Wheel_${n}`).setMesh(box(doc, `s${n}`, [x - 0.1, 1.3, z - 0.2], [x + 0.1, 1.7, z + 0.2], mat)));
      return { name: `SM_Veh_Body_02_Wheel_${n}`, role: 'wheel', pivot: [0, 0, 0], spin_axis: [1, 0, 0] };
    });
    body.addChild(doc.createNode('SM_Veh_Body_02_Steering_Wheel').setMesh(box(doc, 'steer', [0.3, 2, 0.8], [0.5, 2.2, 0.9], mat)));
    const parts = [...small, { name: 'SM_Veh_Body_02_Steering_Wheel', role: 'wheel', pivot: [0.4, 2.1, 0.85], spin_axis: [0, 0, 1] }];
    doc.createScene().addChild(body);
    await new NodeIO().write(bodyFile, doc);
    const lift = { name: 'SM_Veh_Test_01', glb: vehicle, scaleFix: 1, parts: vehicleParts() };
    const input = vehicleInput({ glb: bodyFile, parts, source: { pack: 'P', asset: 'SM_Veh_Body_02', assetId: 5 }, attach: [lift] });
    const { glb, manifest } = await buildModel(input);
    expect(Object.values(manifest.wheels!).map((w) => w.node).sort()).toEqual(vehicleParts().map((p) => p.name).sort());
    expect(manifest.wheels!.fl).toMatchObject({ radius: 0.3, pos: [0.9, 0.3, 1.4] });
    expect(manifest.parts.map((p) => p.node).filter((n) => n.startsWith('SM_Veh_Body_02'))).toEqual(['SM_Veh_Body_02_Steering_Wheel']);
    const names = (await read(glb)).getRoot().listNodes().map((n) => n.getName());
    expect(names.filter((n) => /Body_02_Wheel/.test(n))).toEqual([]);
    expect(names).toContain('SM_Veh_Body_02_Steering_Wheel');
    // Kept on request: both sets are in the GLB.
    const both = await buildModel({ ...input, replaceWheels: false });
    expect((await read(both.glb)).getRoot().listNodes().filter((n) => /Wheel_(FL|FR|RL|RR)$/.test(n.getName()))).toHaveLength(8);
    // The steering wheel is never a road wheel (axle-centre ignores it).
    const axle = await buildModel({ ...input, origin: 'axle-centre' });
    expect(axle.manifest.wheels!.fl.pos).toEqual([0.9, 0, 1.4]);
  });

  it('tint, texture size and format, simplify', async () => {
    const { glb, manifest } = await buildModel(vehicleInput({ tint: '#ff8000', texSize: 16, texFormat: 'webp', simplify: 0.5, cropTextures: false }));
    // Boxes cannot lose a triangle without changing shape: simplify says so, and nothing else warns.
    expect(manifest.warnings).toEqual([expect.stringMatching(/^simplify: kept 100% of the triangles .* not 50%/)]);
    const doc = await read(glb);
    const m = doc.getRoot().listMaterials()[0];
    // The tint recolours the paint where the body samples the texture (every UV is the centre here); the factor is
    // left alone.
    expect(m.getBaseColorFactor()).toEqual([1, 1, 1, 1]);
    const t = doc.getRoot().listTextures()[0];
    const plain = (await read((await buildModel(vehicleInput({ tint: '#ff8000' }))).glb)).getRoot().listTextures()[0];
    const { data: px, info } = await sharp(Buffer.from(plain.getImage()!)).raw().toBuffer({ resolveWithObject: true });
    const c = ((info.height / 2) * info.width + info.width / 2) * info.channels;
    expect(Math.abs(px[c] - 255) + Math.abs(px[c + 1] - 128) + Math.abs(px[c + 2] - 0)).toBeLessThan(24);
    expect(px[0]).toBeGreaterThan(150); // outside the body's UVs: still the grey
    expect(t.getMimeType()).toBe('image/webp');
    expect(t.getSize()).toEqual([16, 16]);
    expect(doc.getRoot().listExtensionsUsed().map((e) => e.extensionName)).toContain('EXT_texture_webp');
  });

  it('paintTint: only the paint swatch takes the tint (shades kept); tyres, glass and other swatches keep theirs', async () => {
    const doc = new Document();
    const buf = doc.createBuffer();
    // A 4×1 atlas: paint red, a darker red shade (same paint, in shadow), tyre black, a blue trim.
    const atlas = new Uint8Array([200, 40, 40, 255, 150, 30, 30, 255, 25, 25, 25, 255, 40, 60, 200, 255]);
    const tex = doc.createTexture('atlas').setMimeType('image/png').setImage(new Uint8Array(await sharp(Buffer.from(atlas), { raw: { width: 4, height: 1, channels: 4 } }).png().toBuffer()));
    const mat = doc.createMaterial('MAT').setBaseColorTexture(tex);
    const glass = doc.createMaterial('Glass').setAlphaMode('BLEND').setBaseColorFactor([0.5, 0.7, 0.8, 0.45]);
    const mesh = (name: string, u: number, size: number, m = mat) => {
      const b = box(doc, name, [0, 0, 0], [size, size, size], m);
      b.listPrimitives()[0].setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(16).map((_, i) => (i % 2 ? 0.5 : u))).setBuffer(buf));
      return doc.createNode(name).setMesh(b);
    };
    // The body's underside is black and bigger than its paint: the saturated paint still wins.
    const nodes = [mesh('Body', 0.125, 1), mesh('Body_Under', 0.625, 1.5), mesh('Body_Trim', 0.875, 0.3), mesh('Wheel_FL', 0.625, 2), mesh('Body_Glass', 0.5, 1, glass)];
    expect(await paintTint(doc, nodes, [0, 0.5, 1])).toBe(true);
    const px = await sharp(Buffer.from(tex.getImage()!)).raw().toBuffer();
    expect([...px.subarray(0, 3)]).toEqual([0, 128, 255]);
    // The shade keeps its brightness relative to the paint.
    expect(px[6]).toBeGreaterThan(150);
    expect(px[6]).toBeLessThan(255);
    expect([...px.subarray(8, 11)]).toEqual([25, 25, 25]);
    expect([...px.subarray(12, 15)]).toEqual([40, 60, 200]);
    expect(glass.getBaseColorFactor()).toEqual([0.5, 0.7, 0.8, 0.45]);
    // Nothing textured: no paint.
    expect(await paintTint(doc, [nodes[4]], [1, 0, 0])).toBe(false);
  });

  it('paintTint: lettering inside the paint island is painted over; dark texels reaching the texture edge are not', async () => {
    const doc = new Document();
    const buf = doc.createBuffer();
    // A 32 px orange panel with dark 4×4 "lettering" inside it, a dark letter with a soft (anti-aliased) edge, and a
    // dark stripe along the left edge (a neighbouring swatch, not enclosed by the paint).
    const W = 32;
    const px = new Uint8Array(W * W * 4);
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++) {
        const letter = x >= 4 && x <= 7 && y >= 24 && y <= 27;
        const soft = x >= 24 && x <= 27 && y >= 24 && y <= 27;
        const softEdge = (x === 23 || x === 28) && y >= 24 && y <= 27;
        const stripe = x <= 1;
        const c = letter || stripe ? [30, 30, 30] : soft ? [40, 40, 40] : softEdge ? [150, 90, 20] : [240, 150, 30];
        px.set([...c, 255], (y * W + x) * 4);
      }
    const tex = doc.createTexture('panel').setMimeType('image/png').setImage(new Uint8Array(await sharp(Buffer.from(px), { raw: { width: W, height: W, channels: 4 } }).png().toBuffer()));
    const mat = doc.createMaterial('MAT').setBaseColorTexture(tex);
    const b = box(doc, 'body', [0, 0, 0], [1, 1, 1], mat);
    // The body's UVs span the panel (corners at 0.05 / 0.95): triangle centres land on the paint.
    const uvs = new Float32Array(16).map((_, i) => (((i % 2 ? (i >> 2) & 1 : (i >> 1) & 1) ? 0.95 : 0.05)));
    b.listPrimitives()[0].setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(uvs).setBuffer(buf));
    expect(await paintTint(doc, [doc.createNode('Body').setMesh(b)], [0, 0.5, 1])).toBe(true);
    const out = await sharp(Buffer.from(tex.getImage()!)).raw().toBuffer();
    const at = (x: number, y: number) => [...out.subarray((y * W + x) * 4, (y * W + x) * 4 + 3)];
    expect(at(16, 16)).toEqual([0, 128, 255]);
    expect(at(5, 25)).toEqual([0, 128, 255]);
    expect(at(25, 25)).toEqual([0, 128, 255]);
    // The soft edge (a darker shade of the paint) takes the plain tint too, so no outline is left.
    expect(at(23, 25)).toEqual([0, 128, 255]);
    expect(at(0, 16)).toEqual([30, 30, 30]);
  });

  it('fit: a uniform scale so a dimension matches; wheels, parts, collider and the manifest scale follow', async () => {
    const { glb, manifest } = await buildModel(vehicleInput({ fit: { length: 4.5 } }));
    expect(manifest.bounds.size[0]).toBeCloseTo(2.3625, 3);
    expect(manifest.bounds.size.slice(1)).toEqual([1.6875, 4.5]);
    expect(manifest.scale).toEqual({ modelScale: 1.125, fit: { length: 4.5 } });
    expect(manifest.wheels!.fl).toMatchObject({ radius: 0.3375, pos: [1.0125, 0.3375, 1.575] });
    expect(manifest.collider.box.size).toEqual(manifest.bounds.size);
    const doc = await read(glb);
    const wheel = doc.getRoot().listNodes().find((n) => n.getName() === 'SM_Veh_Test_01_Wheel_FL')!;
    expect(wheel.getTranslation().map((v) => +v.toFixed(4))).toEqual([1.0125, 0.3375, 1.575]);
    expect(wheel.getMesh()!.listPrimitives()[0].getAttribute('POSITION')!.getMax([]).map((v) => +v.toFixed(3))).toEqual([0.169, 0.338, 0.338]);
    // Several dimensions: the smallest scale wins.
    expect((await buildModel(vehicleInput({ fit: { length: 8, width: 1.05 } }))).manifest.bounds.size).toEqual([1.05, 0.75, 2]);
    // No fit: no scale in the manifest.
    expect((await buildModel(vehicleInput())).manifest.scale).toBeUndefined();
  });

  it('doors hinge on their front edge (no source pivot); only spinning roles keep a spin axis', async () => {
    const file = path.join(dir, 'glb/p1/a6.glb');
    const doc = new Document();
    doc.createBuffer();
    const mat = doc.createMaterial('MAT_body').setBaseColorTexture(texture(doc));
    const body = doc.createNode('SM_Veh_Car_09').setMesh(box(doc, 'body', [-1, 0.3, -2], [1, 1.5, 2], mat));
    body.addChild(doc.createNode('SM_Veh_Car_09_Door_L').setMesh(box(doc, 'dl', [0.95, 0.4, 0], [1.02, 1.2, 1.1], mat)));
    body.addChild(doc.createNode('SM_Veh_Car_09_Door_R').setMesh(box(doc, 'dr', [-1.02, 0.4, 0], [-0.95, 1.2, 1.1], mat)));
    body.addChild(doc.createNode('SM_Veh_Car_09_Gearstick').setMesh(box(doc, 'g', [0, 0.6, 0.5], [0.05, 0.8, 0.55], mat)));
    doc.createScene().addChild(body);
    await new NodeIO().write(file, doc);
    const parts = [
      { name: 'SM_Veh_Car_09_Door_L', role: 'door', pivot: [0, 0, 0] },
      { name: 'SM_Veh_Car_09_Door_R', role: 'door', pivot: [0, 0, 0] },
      { name: 'SM_Veh_Car_09_Gearstick', role: 'static', pivot: [0, 0, 0], spin_axis: [1, 0, 0] },
    ];
    const { glb, manifest } = await buildModel(vehicleInput({ glb: file, parts, source: { pack: 'P', asset: 'SM_Veh_Car_09', assetId: 6 } }));
    const part = (n: string) => manifest.parts.find((p) => p.node === n)!;
    // Bottom-centre origin: y from 0.3, z centred at 0.
    expect(part('SM_Veh_Car_09_Door_L')).toEqual({ node: 'SM_Veh_Car_09_Door_L', role: 'door', pivot: [0.985, 0.5, 1.1], hinge: { pos: [0.985, 0.5, 1.1], axis: [0, -1, 0] } });
    expect(part('SM_Veh_Car_09_Door_R').hinge).toEqual({ pos: [-0.985, 0.5, 1.1], axis: [0, 1, 0] });
    expect(part('SM_Veh_Car_09_Gearstick')).not.toHaveProperty('spinAxis');
    expect(part('SM_Veh_Car_09_Gearstick')).not.toHaveProperty('radius');
    // The door node sits on its hinge, its geometry behind it.
    const out = await read(glb);
    const door = out.getRoot().listNodes().find((n) => n.getName() === 'SM_Veh_Car_09_Door_L')!;
    expect(door.getTranslation().map((v) => +v.toFixed(4))).toEqual([0.985, 0.5, 1.1]);
    expect(door.getMesh()!.listPrimitives()[0].getAttribute('POSITION')!.getMax([]).map((v) => +v.toFixed(4))).toEqual([0.035, 0.4, 0]);
  });

  const charInput = (over: Partial<Parameters<typeof buildModel>[0]> = {}) => ({
    name: 'hero', source: { pack: 'C', asset: 'Character_Test_01', assetId: 10 }, kind: 'character', glb: character, scaleFix: 1,
    variant: 'Character_Test_01', variants: ['Character_Test_01', 'Character_Other_01'],
    rigMap: { hips: 'Hips', spine3: 'Spine', upperarm_l: 'UpperArm_L', lowerarm_l: 'LowerArm_L', upperarm_r: 'UpperArm_R', lowerarm_r: 'LowerArm_R' },
    origin: 'bottom-centre' as const, texFormat: 'keep' as const, ...over,
  });

  it('character: other bodies and bundled pieces are dropped, clips merge by bone name with trim, speed and events', async () => {
    const { glb, manifest } = await buildModel(
      charInput({
        clips: [
          { name: 'Idle', glb: bake1, loop: true, inPlace: true },
          { name: 'Punch', glb: bake2, loop: false, inPlace: true, edit: { start: 0.5, end: 1.5, speed: 2, events: [{ t: 1, name: 'hit' }, { t: 1.9, name: 'late' }] } },
        ],
      }),
    );
    // Bounds and collider measure the first frame of the first clip (Idle: arms 75° down), not the 1.8 m T-pose.
    expect(manifest.pose).toBe('clip:Idle');
    expect(manifest.bounds.size[0]).toBeGreaterThan(0.8);
    expect(manifest.bounds.size[0]).toBeLessThan(0.9);
    expect(manifest.bounds.size.slice(1)).toEqual([1.8, 0.3]);
    expect(manifest.bounds.min).toEqual([-manifest.bounds.max[0], 0, -0.15]);
    expect(manifest.collider.box.size).toEqual(manifest.bounds.size);
    expect(manifest.clips).toEqual([
      { name: 'Idle', duration: 1, loop: true },
      { name: 'Punch', duration: 0.5, loop: false, events: [{ t: 0.25, name: 'hit' }] },
    ]);
    expect(manifest.sockets.map((s) => [s.name, s.node])).toEqual([['chest', 'Spine'], ['hips', 'Hips']]);
    expect(manifest.sockets[0].rot).toEqual([0, 0, 0, 1]);
    const doc = await read(glb);
    const names = doc.getRoot().listNodes().map((n) => n.getName());
    expect(names).toContain('Character_Test_01');
    expect(names).not.toContain('Character_Other_01');
    expect(names).not.toContain('SM_Chr_Attach_Hat_01');
    const anims = doc.getRoot().listAnimations();
    expect(anims.map((a) => a.getName())).toEqual(['Idle', 'Punch']);
    const punch = anims[1];
    expect(punch.listChannels().map((c) => `${c.getTargetNode()!.getName()}.${c.getTargetPath()}`)).toEqual(['Hips.rotation', 'Hips.translation']);
    const times = punch.listChannels()[0].getSampler()!.getInput()!;
    expect(times.getMin([])[0]).toBe(0);
    expect(+times.getMax([])[0].toFixed(4)).toBe(0.5);
    // Channels drive the character's own bones (one skeleton, not the bake's).
    const hips = punch.listChannels()[0].getTargetNode()!;
    expect(doc.getRoot().listSkins()[0].listJoints()).toContain(hips);
  });

  it('character without clips: bounds and collider from the rest pose with the arms lowered (OR-W16-4)', async () => {
    const { glb, manifest } = await buildModel(charInput());
    expect(manifest.pose).toBe('rest');
    // Arms hanging 0.7 m from 0.2 m out, tilted a little outward: about 0.73 m across, not 1.8.
    expect(manifest.bounds.size[0]).toBeGreaterThan(0.6);
    expect(manifest.bounds.size[0]).toBeLessThan(0.8);
    expect(manifest.bounds.size[1]).toBe(1.8);
    expect(manifest.collider.box).toEqual({ center: [0, 0.9, 0], size: manifest.bounds.size });
    // The GLB keeps its bind pose: only the measurement is posed.
    const upper = (await read(glb)).getRoot().listNodes().find((n) => n.getName() === 'UpperArm_L')!;
    expect(upper.getRotation()).toEqual([0, 0, 0, 1]);
    // No arm bones in the rig map: the bind pose, as it stands.
    const bind = await buildModel(charInput({ rigMap: { hips: 'Hips' } }));
    expect(bind.manifest.pose).toBe('bind');
    expect(bind.manifest.bounds.size[0]).toBe(1.8);
  });

  it('character: a bundled piece named in attach is kept; root motion gives a ground speed', async () => {
    const { glb, manifest } = await buildModel(
      charInput({ attach: [{ name: 'SM_Chr_Attach_Hat_01', mesh: 'SM_Chr_Attach_Hat_01' }], clips: [{ name: 'Run_Fwd', glb: bake2rm, loop: true, inPlace: false }] }),
    );
    const doc = await read(glb);
    expect(doc.getRoot().listNodes().map((n) => n.getName())).toContain('SM_Chr_Attach_Hat_01');
    expect(manifest.bounds.max[1]).toBe(1.95);
    // 300 cm under a 0.01 armature in 2 s.
    expect(manifest.clips[0]).toMatchObject({ name: 'Run_Fwd', duration: 2, speedMps: 1.5 });
  });

  it('splitBySwatch: triangles split by the atlas texel they sample, a swatch_<hex> node and material each (OR-FB-022)', async () => {
    const sdoc = new Document();
    const buf = sdoc.createBuffer();
    // A 2×1 atlas: red | green. Two quads, the left one sampling red, the right one green.
    const img = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]);
    const tex = sdoc.createTexture('atlas').setMimeType('image/png').setImage(new Uint8Array(encodePng({ width: 2, height: 1, data: img })));
    const mat = sdoc.createMaterial('MAT_lamp').setBaseColorTexture(tex);
    const pos = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 3, 1, 0, 2, 1, 0];
    const uv = [0.25, 0.5, 0.25, 0.5, 0.25, 0.5, 0.25, 0.5, 0.75, 0.5, 0.75, 0.5, 0.75, 0.5, 0.75, 0.5];
    const prim = sdoc
      .createPrimitive()
      .setAttribute('POSITION', sdoc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buf))
      .setAttribute('TEXCOORD_0', sdoc.createAccessor().setType('VEC2').setArray(new Float32Array(uv)).setBuffer(buf))
      .setIndices(sdoc.createAccessor().setType('SCALAR').setArray(new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7])).setBuffer(buf))
      .setMaterial(mat);
    sdoc.createScene('Scene').addChild(sdoc.createNode('SM_Prop_Lamp_01').setMesh(sdoc.createMesh('lamp').addPrimitive(prim)));
    const file = path.join(dir, 'glb/p1/a30.glb');
    await new NodeIO().write(file, sdoc);
    const input = { name: 'lamp', source: { pack: 'P', asset: 'SM_Prop_Lamp_01', assetId: 30 }, kind: 'prop', glb: file, scaleFix: 1, origin: 'bottom-centre' as const, texFormat: 'png' as const };
    const { glb, manifest } = await buildModel({ ...input, splitBySwatch: true });
    expect(manifest.swatches).toEqual([
      { node: 'swatch_00ff00', parent: 'SM_Prop_Lamp_01', color: '#00ff00', triangles: 2 },
      { node: 'swatch_ff0000', parent: 'SM_Prop_Lamp_01', color: '#ff0000', triangles: 2 },
    ]);
    expect(manifest.bounds.size).toEqual([3, 1, 0]);
    const out = await read(glb);
    const nodes = out.getRoot().listNodes();
    const green = nodes.find((n) => n.getName() === 'swatch_00ff00')!;
    expect(green.getParentNode()?.getName()).toBe('SM_Prop_Lamp_01');
    expect(nodes.find((n) => n.getName() === 'SM_Prop_Lamp_01')!.getMesh()).toBeNull();
    const mats = out.getRoot().listMaterials();
    expect(mats.map((m) => [m.getName(), (m.getExtras() as { swatch?: string }).swatch]).sort()).toEqual([['swatch_00ff00', '#00ff00'], ['swatch_ff0000', '#ff0000']]);
    expect(green.getMesh()!.listPrimitives()[0].getIndices()!.getCount()).toBe(6);
    // Without the flag the mesh is left whole.
    expect((await buildModel(input)).manifest.swatches).toBeUndefined();
  });

  it('headwear (mount head) rides on the head bone at its bind position; a clip turning a parent bone carries it (OR-FB-017)', async () => {
    // A helmet modelled around its own origin, as POLYGON_Pro_Racer's are.
    const hdoc = new Document();
    hdoc.createBuffer();
    const hm = hdoc.createMaterial('MAT_h').setBaseColorTexture(texture(hdoc));
    hdoc.createScene('Scene').addChild(hdoc.createNode('SM_Chr_Attach_Helmet_01').setMesh(box(hdoc, 'h', [-0.15, -0.1, -0.15], [0.15, 0.2, 0.15], hm)));
    const helmetFile = path.join(dir, 'glb/p2/a20.glb');
    await new NodeIO().write(helmetFile, hdoc);
    const helmet = { name: 'SM_Chr_Attach_Helmet_01', glb: helmetFile, scaleFix: 1, mount: 'head' };
    // The test rig's head: the spine joint, 1.1 m up in bind space.
    const { glb, manifest } = await buildModel(charInput({ rigMap: { hips: 'Hips', head: 'Spine' }, attach: [helmet], clips: [{ name: 'Idle', glb: bake2, loop: true, inPlace: true }] }));
    const doc = await read(glb);
    const node = doc.getRoot().listNodes().find((n) => n.getName() === 'SM_Chr_Attach_Helmet_01')!;
    expect(node.getParentNode()?.getName()).toBe('Spine');
    expect(Array.from(node.getWorldMatrix()).slice(12, 15).map((v) => +v.toFixed(4) + 0)).toEqual([0, 1.1, 0]);
    expect(manifest.warnings ?? []).not.toContainEqual(expect.stringMatching(/helmet/i));
    // Unmounted, it stays at the feet; a rig without the bone says so.
    const loose = await buildModel(charInput({ rigMap: { hips: 'Hips' }, attach: [helmet] }));
    const ln = (await read(loose.glb)).getRoot().listNodes().find((n) => n.getName() === 'SM_Chr_Attach_Helmet_01')!;
    expect(ln.getParentNode()?.getName()).not.toBe('Spine');
    expect(loose.manifest.warnings).toContainEqual(expect.stringMatching(/no head bone/));
  });

  it('character fit: the root carries the scale, so the bounds, collider and root-motion speed follow', async () => {
    const { glb, manifest } = await buildModel(charInput({ fit: { height: 0.9 }, clips: [{ name: 'Run_Fwd', glb: bake2rm, loop: true, inPlace: false }] }));
    expect(manifest.bounds.size).toEqual([0.9, 0.9, 0.15]);
    expect(manifest.collider.box.size[1]).toBe(0.9);
    expect(manifest.scale).toEqual({ modelScale: 0.5, fit: { height: 0.9 } });
    expect(manifest.clips[0].speedMps).toBe(0.75);
    const root = (await read(glb)).getRoot().getDefaultScene()!.listChildren()[0];
    expect(root.getScale().map((v) => +v.toFixed(6))).toEqual([0.5, 0.5, 0.5]);
  });

  // ---- OR-FB-012: baked poses ----
  it('poses: static meshes baked at clip times, one named node each, no skin, joints or clips', async () => {
    const bk = (name: string, glb: string, loop: boolean) => ({ name, glb, loop, inPlace: true, source: { id: 7, pack: 'A', name, variant: null, set: null } });
    const idle = bk('Idle', bake1, true), turn = bk('Turn', bake2, true);
    const { glb, manifest } = await buildModel(
      charInput({ poses: [{ name: 'idle', ref: 'Idle', clip: idle, time: 0 }, { name: 'turn_a', ref: 'Turn', clip: turn, time: 0 }, { name: 'turn_b', ref: 'Turn', clip: turn, time: 2 }] }),
    );
    const doc = await read(glb);
    const r = doc.getRoot();
    expect(r.listSkins()).toHaveLength(0);
    expect(r.listAnimations()).toHaveLength(0);
    const prims = r.listMeshes().flatMap((m) => m.listPrimitives());
    expect(prims.flatMap((p) => p.listSemantics()).filter((x) => /JOINTS|WEIGHTS/.test(x))).toEqual([]);
    // The root, and one node per pose with its mesh; the body's three primitives (one material) joined into one.
    const top = r.getDefaultScene()!.listChildren()[0];
    expect(top.getName()).toBe('hero');
    expect(top.listChildren().map((n) => [n.getName(), n.getMesh()?.listPrimitives().length])).toEqual([['idle', 1], ['turn_a', 1], ['turn_b', 1]]);
    expect(r.listNodes().map((n) => n.getName()).filter((n) => /Hips|Spine|Arm|Root/.test(n))).toEqual([]);
    expect(manifest.clips).toEqual([]);
    expect(manifest.pose).toBeUndefined();
    expect(manifest.sockets).toEqual([]);
    expect(manifest.poses!.map((p) => [p.name, p.node, p.clip, p.time])).toEqual([['idle', 'idle', 'Idle', 0], ['turn_a', 'turn_a', 'Turn', 0], ['turn_b', 'turn_b', 'Turn', 2]]);
    expect(manifest.poses![0].source).toMatchObject({ id: 7 });
    // Idle has the arms 75° down: the same box as the clip export measures (clip:Idle), standing on the origin.
    const clipped = await buildModel(charInput({ clips: [idle] }));
    expect(manifest.poses![0].bounds).toEqual(clipped.manifest.bounds);
    // Turn: the T-pose turned 0° at its start and 90° at its end (its arms then point along Z).
    expect(manifest.poses![1].bounds.size.map((v) => +v.toFixed(3))).toEqual([1.8, 1.8, 0.3]);
    expect(manifest.poses![2].bounds.size.map((v) => +v.toFixed(3))).toEqual([0.3, 1.8, 1.8]);
    // One origin for all (the first pose's bottom centre): the bounds hold every pose.
    expect(manifest.bounds.min[1]).toBe(0);
    expect(manifest.bounds.size.map((v) => +v.toFixed(3))).toEqual([1.8, 1.8, 1.8]);
    // A time past a looping clip's end wraps; past a one-shot's end, it is the end.
    const late = await buildModel(charInput({ poses: [{ name: 'a', ref: 'Turn', clip: { ...turn, loop: false }, time: 5 }] }));
    expect(late.manifest.poses![0].time).toBe(2);
    expect(late.manifest.warnings).toEqual(['pose a: Turn is 2 s long; 5 s baked as 2 s (its end)']);
  });

  it('pose: one baked pose is the root node\'s mesh; three loads it as a plain Mesh (no SkinnedMesh)', async () => {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const clip = { name: 'Idle', glb: bake1, loop: true, inPlace: true };
    const { glb, manifest } = await buildModel(charInput({ poses: [{ name: 'hero', ref: 'Idle', clip, time: 0.5 }], poseSingle: true, fit: { height: 0.9 } }));
    expect(manifest.poses).toEqual([expect.objectContaining({ name: 'hero', node: 'hero', time: 0.5 })]);
    expect(manifest.bounds.size[1]).toBe(0.9);
    expect(manifest.scale).toEqual({ modelScale: 0.5, fit: { height: 0.9 } });
    const doc = await read(glb);
    for (const t of doc.getRoot().listTextures()) t.dispose();
    const bytes = await modelIO().writeBinary(doc);
    const gltf = await new Promise<{ scene: { traverse: (f: (o: { type: string; name: string; isSkinnedMesh?: boolean; isMesh?: boolean }) => void) => void }; animations: unknown[] }>((res, rej) =>
      new GLTFLoader().parse(bytes.slice().buffer, '', res as never, rej),
    );
    const meshes: string[] = [];
    let skinnedMeshes = 0;
    gltf.scene.traverse((o) => {
      if (o.isSkinnedMesh) skinnedMeshes++;
      if (o.isMesh) meshes.push(o.name);
    });
    expect(skinnedMeshes).toBe(0);
    expect(meshes).toEqual(['hero']);
    expect(gltf.animations).toEqual([]);
  });

  // ---- OR-FB-011: simplify on skinned meshes ----
  it('simplify works on a flat-shaded skinned mesh: the triangles drop, the skin stays consistent, the clip still drives it', async () => {
    // A flat-shaded tube (each triangle its own corners and face normal, as Synty exports) on the test skeleton: the
    // lower half on Hips (joint 1), the upper half on Spine (joint 2).
    const file = path.join(dir, 'glb/p2/a7.glb');
    const { doc } = await characterGlb(file, 'Armature', false);
    const buf = doc.getRoot().listBuffers()[0];
    const byName = new Map(doc.getRoot().listNodes().map((n) => [n.getName(), n]));
    const joints = ['Root', 'Hips', 'Spine'].map((n) => byName.get(n)!);
    const ibm = doc.createAccessor().setType('MAT4').setBuffer(buf).setArray(new Float32Array(joints.flatMap((j) => {
      const m = Array.from(j.getWorldMatrix());
      const sc = m[0];
      return [1 / sc, 0, 0, 0, 0, 1 / sc, 0, 0, 0, 0, 1 / sc, 0, -m[12] / sc, -m[13] / sc, -m[14] / sc, 1];
    })));
    const skin = doc.createSkin('Armature').setSkeleton(joints[0]).setInverseBindMatrices(ibm);
    for (const j of joints) skin.addJoint(j);
    const SEG = 24, RINGS = 12;
    const pos: number[] = [], nrm: number[] = [], jn: number[] = [], wt: number[] = [];
    const at = (a: number, ring: number) => [0.2 * Math.cos((a / SEG) * Math.PI * 2), (ring / RINGS) * 1.8, 0.2 * Math.sin((a / SEG) * Math.PI * 2)];
    for (let ring = 0; ring < RINGS; ring++)
      for (let a = 0; a < SEG; a++) {
        const [p00, p10, p01, p11] = [at(a, ring), at(a + 1, ring), at(a, ring + 1), at(a + 1, ring + 1)];
        const mid = (a + 0.5) / SEG * Math.PI * 2;
        for (const p of [p00, p01, p10, p10, p01, p11]) {
          pos.push(...p);
          nrm.push(Math.cos(mid), 0, Math.sin(mid));
          jn.push(ring < RINGS / 2 ? 1 : 2, 0, 0, 0);
          wt.push(1, 0, 0, 0);
        }
      }
    const mat = doc.createMaterial('MAT_chr').setBaseColorTexture(texture(doc));
    const prim = doc.createPrimitive().setMaterial(mat)
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buf))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nrm)).setBuffer(buf))
      .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array((pos.length / 3) * 2).fill(0.5)).setBuffer(buf))
      .setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(new Uint16Array(jn)).setBuffer(buf))
      .setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(new Float32Array(wt)).setBuffer(buf));
    doc.getRoot().listNodes().find((n) => n.getName() === 'Armature')!.addChild(doc.createNode('Character_Tube_01').setMesh(doc.createMesh('tube').addPrimitive(prim)).setSkin(skin));
    await new NodeIO().write(file, doc);
    const tris = (d: Document) => d.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')!.getCount()) / 3, 0);
    const input = charInput({ glb: file, variant: null, variants: [], clips: [{ name: 'Turn', glb: bake2, loop: true, inPlace: true }] });
    const full = await read((await buildModel(input)).glb);
    const { glb, manifest } = await buildModel({ ...input, simplify: 0.5 });
    const out = await read(glb);
    expect(tris(full)).toBe(SEG * RINGS * 2);
    expect(tris(out)).toBeLessThanOrEqual(tris(full) * 0.6);
    expect(manifest.warnings).toBeUndefined();
    // Still skinned on the same joints: every kept vertex keeps its own joint and a full weight, and the lower half
    // still follows Hips, the upper Spine.
    const p = out.getRoot().listMeshes()[0].listPrimitives()[0];
    const J = p.getAttribute('JOINTS_0')!, W = p.getAttribute('WEIGHTS_0')!, P = p.getAttribute('POSITION')!;
    const jointCount = out.getRoot().listSkins()[0].listJoints().length;
    for (let i = 0; i < P.getCount(); i++) {
      const j = J.getElement(i, []), w = W.getElement(i, []);
      expect(j[0]).toBeLessThan(jointCount);
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 4);
      const y = P.getElement(i, [])[1];
      if (y < 0.85) expect(j[0]).toBe(1);
      if (y > 0.95) expect(j[0]).toBe(2);
    }
    // Flat normals again (unit length, horizontal on the tube's side).
    const N = p.getAttribute('NORMAL')!;
    expect(N.getCount()).toBe(P.getCount());
    expect(Math.hypot(...N.getElement(0, []))).toBeCloseTo(1, 4);
    // The clip is still there and drives the joints.
    expect(out.getRoot().listAnimations().map((a) => a.getName())).toEqual(['Turn']);
    expect(out.getRoot().listAnimations()[0].listChannels().map((c) => c.getTargetNode()!.getName())).toContain('Hips');
  });

  it("three's GLTFLoader reads the output in Node: the wheel nodes, the clips and their lengths", async () => {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const parse = (bytes: Uint8Array) =>
      new Promise<{ scene: { getObjectByName: (n: string) => { position: { toArray: () => number[] } } | undefined }; animations: { name: string; duration: number }[] }>((res, rej) =>
        // Textures need a DOM to decode: left out here (the M0 spike checks them in a browser).
        new GLTFLoader().parse(bytes.slice().buffer, '', res as never, rej),
      );
    const strip = async (glb: Uint8Array) => {
      const doc = await read(glb);
      for (const t of doc.getRoot().listTextures()) t.dispose();
      return modelIO().writeBinary(doc);
    };
    const truck = await parse(await strip((await buildModel(vehicleInput())).glb));
    expect(truck.scene.getObjectByName('SM_Veh_Test_01_Wheel_RL')!.position.toArray().map((v) => +v.toFixed(4))).toEqual([0.9, 0.3, -1.4]);
    const hero = await parse(await strip((await buildModel(charInput({ clips: [{ name: 'Idle', glb: bake1, loop: true, inPlace: true }, { name: 'Punch', glb: bake2, loop: false, inPlace: true }] }))).glb));
    expect(hero.animations.map((a) => [a.name, +a.duration.toFixed(3)])).toEqual([['Idle', 1], ['Punch', 2]]);
  });

  // ---- OR-FB-004: cropped, smaller textures ----
  /** A prop: one quad whose UVs cover [u0,u1]×[v0,v1] of a 64 px atlas of four flat swatches (nearest-sampled). */
  async function swatchProp(file: string, uv: [number, number, number, number]) {
    const doc = new Document();
    const buf = doc.createBuffer();
    const data = new Uint8Array(64 * 64 * 4);
    const SW = [[200, 30, 30], [30, 200, 30], [30, 30, 200], [220, 220, 40]];
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++) data.set([...SW[(y < 32 ? 0 : 2) + (x < 32 ? 0 : 1)], 255], (y * 64 + x) * 4);
    const tex = doc.createTexture('atlas').setMimeType('image/png').setImage(new Uint8Array(encodePng({ width: 64, height: 64, data })));
    const mat = doc.createMaterial('MAT').setBaseColorTexture(tex);
    mat.getBaseColorTextureInfo()!.setMagFilter(TextureInfo.MagFilter.NEAREST).setMinFilter(TextureInfo.MinFilter.NEAREST);
    const [u0, v0, u1, v1] = uv;
    const prim = doc
      .createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0])).setBuffer(buf))
      .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array([u0, v1, u1, v1, u1, v0, u0, v0])).setBuffer(buf))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array([0, 1, 2, 0, 2, 3])).setBuffer(buf))
      .setMaterial(mat);
    doc.createScene().addChild(doc.createNode('SM_Prop_Quad_01').setMesh(doc.createMesh('q').addPrimitive(prim)));
    await new NodeIO().write(file, doc);
  }
  const propInput = (glb: string, over: Partial<Parameters<typeof buildModel>[0]> = {}) => ({
    name: 'quad', source: { pack: 'P', asset: 'SM_Prop_Quad_01', assetId: 5 }, kind: 'prop', glb, scaleFix: 1, origin: 'bottom-centre' as const, texFormat: 'webp' as const, ...over,
  });
  /** The texel a UV samples (nearest), as [r, g, b]. */
  const sample = (img: { data: Buffer; info: { width: number; height: number; channels: number } }, u: number, v: number) => {
    const x = Math.min(img.info.width - 1, Math.floor(u * img.info.width)), y = Math.min(img.info.height - 1, Math.floor(v * img.info.height));
    const o = (y * img.info.width + x) * img.info.channels;
    return [img.data[o], img.data[o + 1], img.data[o + 2]];
  };

  it('textures: the atlas is cropped to the UVs the model uses (remapped, padded) and scaled down with the nearest kernel (OR-FB-004)', async () => {
    const file = path.join(dir, 'glb/p5/quad.glb');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // The quad samples the top-left swatch and a little of its neighbours (u, v 0.05–0.6).
    await swatchProp(file, [0.05, 0.05, 0.6, 0.6]);
    const { glb } = await buildModel(propInput(file, { texSize: 16 }));
    const doc = await read(glb);
    const tex = doc.getRoot().listTextures()[0];
    expect(tex.getMimeType()).toBe('image/webp');
    const [w, h] = tex.getSize()!;
    expect(Math.max(w, h)).toBe(16);
    const img = await sharp(Buffer.from(tex.getImage()!)).raw().toBuffer({ resolveWithObject: true });
    // Nearest kernel, lossless webp: every texel is one of the four swatch colours (no blending at swatch edges).
    const swatches = new Set(['200,30,30', '30,200,30', '30,30,200', '220,220,40']);
    for (let i = 0; i < img.data.length; i += img.info.channels) expect(swatches.has(`${img.data[i]},${img.data[i + 1]},${img.data[i + 2]}`)).toBe(true);
    // The UVs are remapped into the crop and still sample their swatches: corner (0.05, 0.05) red, (0.6, 0.6) yellow.
    const uv = doc.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('TEXCOORD_0')!;
    const uvs = [0, 1, 2, 3].map((i) => uv.getElement(i, []));
    for (const [u, v] of uvs) expect(u >= 0 && u <= 1 && v >= 0 && v <= 1).toBe(true);
    expect(sample(img, uvs[3][0] + 0.01, uvs[3][1] + 0.01)).toEqual([200, 30, 30]);
    expect(sample(img, uvs[1][0] - 0.01, uvs[1][1] - 0.01)).toEqual([220, 220, 40]);
    // The crop keeps a few texels around the UV box: the box is not flush with the image edge.
    expect(Math.min(...uvs.map((x) => x[0]))).toBeGreaterThan(0);
  });

  it('textures: no crop when it saves little or the UVs wrap; png and keep formats', async () => {
    const wide = path.join(dir, 'glb/p5/wide.glb'), wrap = path.join(dir, 'glb/p5/wrap.glb');
    await swatchProp(wide, [0.01, 0.01, 0.99, 0.95]);
    await swatchProp(wrap, [0.1, 0.1, 1.8, 0.4]);
    for (const f of [wide, wrap]) {
      const doc = await read((await buildModel(propInput(f, { texFormat: 'png' }))).glb);
      const tex = doc.getRoot().listTextures()[0];
      expect(tex.getSize()).toEqual([64, 64]);
      expect(tex.getMimeType()).toBe('image/png');
    }
    const kept = await read((await buildModel(propInput(wrap, { texFormat: 'keep', cropTextures: false }))).glb);
    expect(kept.getRoot().listExtensionsUsed().map((e) => e.extensionName)).not.toContain('EXT_texture_webp');
  });

  // ---- OR-FB-018 / 019 / 023: material modes ----
  /**
   * A card (a quad over the whole of a 16 px texture that is clear outside a centred disc, like a cactus card), a
   * palette quad on an opaque RGBA texture, and optionally an FX quad with the ingest's self-lit FX material.
   */
  async function materialProp(file: string, fx?: 'unlit' | 'sprite') {
    const doc = new Document();
    const buf = doc.createBuffer();
    const rgba = (alpha: (x: number, y: number) => number) => {
      const data = new Uint8Array(16 * 16 * 4);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) data.set([90, 160, 60, alpha(x, y)], (y * 16 + x) * 4);
      return new Uint8Array(encodePng({ width: 16, height: 16, data }));
    };
    const quad = (x: number, mat: ReturnType<Document['createMaterial']>) =>
      doc
        .createPrimitive()
        .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array([x, 0, 0, x + 1, 0, 0, x + 1, 1, 0, x, 1, 0])).setBuffer(buf))
        .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array([0, 1, 1, 1, 1, 0, 0, 0])).setBuffer(buf))
        .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array([0, 1, 2, 0, 2, 3])).setBuffer(buf))
        .setMaterial(mat);
    const card = doc.createMaterial('Cactus_01.tga').setBaseColorTexture(doc.createTexture('Cactus_01').setMimeType('image/png').setImage(rgba((x, y) => ((x - 7.5) ** 2 + (y - 7.5) ** 2 < 36 ? 255 : 0))));
    const palette = doc.createMaterial('Palette.png').setBaseColorTexture(doc.createTexture('Palette').setMimeType('image/png').setImage(rgba(() => 255)));
    const mesh = doc.createMesh('m').addPrimitive(quad(0, card)).addPrimitive(quad(2, palette));
    if (fx) {
      const m = doc.createMaterial('FX_Unlit').setEmissiveFactor([1, 1, 1]).setExtras({ ssg_fx: fx });
      if (fx === 'sprite') m.setBaseColorTexture(doc.createTexture('Flash').setMimeType('image/png').setImage(rgba((x) => x * 16)));
      mesh.addPrimitive(quad(4, m));
    }
    doc.createScene().addChild(doc.createNode('SM_Env_Cactus_01').setMesh(mesh));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await new NodeIO().write(file, doc);
  }
  const matsOf = async (glb: Uint8Array) => new Map((await read(glb)).getRoot().listMaterials().map((m) => [m.getName(), m]));

  it('alpha cut-out: a card whose texture is clear where its UVs fall exports MASK and double-sided; an opaque sheet stays OPAQUE (OR-FB-018)', async () => {
    const file = path.join(dir, 'glb/p6/cactus.glb');
    await materialProp(file);
    const mats = await matsOf((await buildModel(propInput(file, { texFormat: 'png' }))).glb);
    expect(mats.get('Cactus_01.tga')!.getAlphaMode()).toBe('MASK');
    expect(mats.get('Cactus_01.tga')!.getAlphaCutoff()).toBe(0.5);
    expect(mats.get('Cactus_01.tga')!.getDoubleSided()).toBe(true);
    expect(mats.get('Palette.png')!.getAlphaMode()).toBe('OPAQUE');
  });

  it('FX materials export self-lit and blended: emissive (times the tint), emissive strength, BLEND, extras fx additive (OR-FB-019)', async () => {
    const file = path.join(dir, 'glb/p6/flame.glb');
    await materialProp(file, 'unlit');
    const { glb, manifest } = await buildModel(propInput(file, { texFormat: 'png' }));
    const fx = (await matsOf(glb)).get('FX_Unlit')!;
    expect(fx.getAlphaMode()).toBe('BLEND');
    expect(fx.getDoubleSided()).toBe(true);
    expect(fx.getEmissiveFactor()).toEqual([1, 1, 1]);
    expect(fx.getBaseColorFactor().slice(0, 3)).toEqual([0, 0, 0]);
    expect(fx.getExtras()).toEqual({ ssg_fx: 'unlit', fx: 'additive' });
    expect((fx.getExtension('KHR_materials_emissive_strength') as unknown as { getEmissiveStrength(): number }).getEmissiveStrength()).toBeGreaterThan(1);
    expect(manifest.warnings).toBeUndefined();
    // The tint is the glow colour (the card and palette keep theirs: their texture's paint takes it).
    const tinted = (await matsOf((await buildModel(propInput(file, { texFormat: 'png', tint: '#ff8000' }))).glb)).get('FX_Unlit')!;
    expect(tinted.getEmissiveFactor().map((v) => +v.toFixed(3))).toEqual([1, +(0x80 / 255).toFixed(3), 0]);
    // A particle sprite glows with its own texture.
    const sprite = path.join(dir, 'glb/p6/sprite.glb');
    await materialProp(sprite, 'sprite');
    const s = (await matsOf((await buildModel(propInput(sprite, { texFormat: 'png' }))).glb)).get('FX_Unlit')!;
    expect(s.getEmissiveTexture()).toBe(s.getBaseColorTexture());
    expect(s.getEmissiveTexture()).not.toBeNull();
  });

  it('wheels that cannot be mapped warn only on a vehicle: a pit box with two casters does not (OR-FB-023)', async () => {
    const casters = vehicleParts().slice(0, 2);
    const box = await buildModel(vehicleInput({ kind: 'multipart', parts: casters }));
    expect(box.manifest.warnings ?? []).not.toContainEqual(expect.stringMatching(/wheels could not be mapped/));
    const car = await buildModel(vehicleInput({ parts: casters }));
    expect(car.manifest.warnings).toContainEqual(expect.stringMatching(/2 wheels could not be mapped/));
  });

  // ---- OR-FB-006: variants and meshopt ----
  const FOUR = [{ name: 'red', tint: '#c62828' }, { name: 'blue', tint: '#1e5bc6' }, { name: 'yellow', tint: '#f2c618' }, { name: 'plain' }];

  it('variants: one GLB, shared geometry, a material and texture per variant (KHR_materials_variants)', async () => {
    const one = await buildModel(vehicleInput({ texFormat: 'png', tint: '#c62828', cropTextures: false }));
    const { glb, manifest } = await buildModel(vehicleInput({ texFormat: 'png', paintVariants: FOUR, cropTextures: false }));
    expect(manifest.variants).toEqual([{ name: 'red', tint: '#c62828' }, { name: 'blue', tint: '#1e5bc6' }, { name: 'yellow', tint: '#f2c618' }, { name: 'plain', tint: null }]);
    expect(manifest.warnings).toBeUndefined();
    const doc = await read(glb);
    const root = doc.getRoot();
    // Geometry is shared: as many meshes and accessors' worth of positions as one truck; one texture per variant.
    expect(root.listMeshes().length).toBe((await read(one.glb)).getRoot().listMeshes().length);
    expect(root.listTextures().length).toBe(4);
    expect(root.listExtensionsUsed().map((e) => e.extensionName)).toContain('KHR_materials_variants');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = (await modelIO().writeJSON(doc)).json as any;
    expect(json.extensions.KHR_materials_variants.variants.map((v: { name: string }) => v.name)).toEqual(['red', 'blue', 'yellow', 'plain']);
    const prim = json.meshes[0].primitives[0];
    const mappings = prim.extensions.KHR_materials_variants.mappings as { material: number; variants: number[] }[];
    expect(mappings.map((m) => m.variants)).toEqual([[0], [1], [2], [3]]);
    // The default look is the first variant: the primitive's own material is variant 0's.
    expect(mappings[0].material).toBe(prim.material);
    // Each variant's texture: the paint at the body's UVs takes its tint; "plain" keeps the original grey.
    const colourAt = async (matIndex: number) => {
      const t = json.materials[matIndex].pbrMetallicRoughness.baseColorTexture.index;
      const tex = root.listTextures()[json.textures[t].source];
      const img = await sharp(Buffer.from(tex.getImage()!)).raw().toBuffer({ resolveWithObject: true });
      return sample(img, 0.5, 0.5);
    };
    const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 24);
    expect(near(await colourAt(mappings[0].material), [0xc6, 0x28, 0x28])).toBe(true);
    expect(near(await colourAt(mappings[1].material), [0x1e, 0x5b, 0xc6])).toBe(true);
    expect(await colourAt(mappings[3].material)).toEqual([200, 200, 200]);
    // About one truck plus three textures.
    expect(glb.byteLength).toBeLessThan(one.glb.byteLength + 3 * root.listTextures()[1].getImage()!.byteLength + 4096);
  });

  it('variants: spec checks; without textured paint each variant multiplies the materials', async () => {
    expect(normaliseSpec({ asset: 1, variants: [{ name: 'Red one', tint: '#f00' }, { name: 'plain', tint: '#fff' }] }).variants).toEqual([{ name: 'Red_one', tint: '#ff0000' }, { name: 'plain' }]);
    expect(() => normaliseSpec({ asset: 1, tint: '#f00', variants: [{ name: 'a', tint: '#0f0' }] })).toThrow(/variants/);
    expect(() => normaliseSpec({ asset: 1, variants: [{ name: 'a' }, { name: 'A' }] })).toThrow(/twice/);
    expect(() => normaliseSpec({ asset: 1, variants: [{ name: 'a', tint: 'red' }] })).toThrow(/variants\[0\]\.tint/);
    expect(() => normaliseSpec({ asset: 1, variants: [{ name: '', tint: '#f00' }] })).toThrow(/name/);
    expect(() => normaliseSpec({ asset: 1, compress: 'draco' as never })).toThrow(/compress/);
    expect(normaliseSpec({ asset: 1, compress: 'none' }).compress).toBeUndefined();
    expect(normaliseSpec({ asset: 1, compress: 'meshopt' }).compress).toBe('meshopt');
    // A flat-coloured model (no texture): the factor carries each variant.
    const flat = path.join(dir, 'glb/p5/flat.glb');
    const d = new Document();
    const b = d.createBuffer();
    const m = d.createMaterial('Flat').setBaseColorFactor([0.5, 0.5, 0.5, 1]);
    const p = d.createPrimitive().setAttribute('POSITION', d.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(b)).setMaterial(m);
    d.createScene().addChild(d.createNode('SM_Prop_Flat_01').setMesh(d.createMesh('f').addPrimitive(p)));
    await new NodeIO().write(flat, d);
    const { glb, manifest } = await buildModel(propInput(flat, { paintVariants: [{ name: 'a', tint: '#ff0000' }, { name: 'b', tint: '#0000ff' }] }));
    expect(manifest.warnings?.[0]).toMatch(/variants: no paint colour/);
    const mats = (await read(glb)).getRoot().listMaterials().map((x) => x.getBaseColorFactor().map((v) => +v.toFixed(2)));
    expect(mats).toEqual([[0.5, 0, 0, 1], [0, 0, 0.5, 1]]);
  });

  it("variants switch in three's GLTFLoader with the documented snippet (parser.associations)", async () => {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const { glb } = await buildModel(vehicleInput({ paintVariants: FOUR, texFormat: 'png' }));
    const doc = await read(glb);
    for (const t of doc.getRoot().listTextures()) t.dispose(); // no DOM to decode images in Node
    const bytes = await modelIO().writeBinary(doc);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gltf: any = await new Promise((res, rej) => new GLTFLoader().parse(bytes.slice().buffer, '', res, rej));
    // docs/MODELS.md "Paint variants": the same function.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function selectVariant(gltf: any, name: string) {
      const { parser } = gltf;
      const index = parser.json.extensions.KHR_materials_variants.variants.findIndex((v: { name: string }) => v.name === name);
      const jobs: Promise<void>[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      gltf.scene.traverse((o: any) => {
        const a = parser.associations.get(o);
        if (!o.isMesh || a?.primitives === undefined) return;
        const prim = parser.json.meshes[a.meshes].primitives[a.primitives];
        const m = prim.extensions?.KHR_materials_variants?.mappings.find((x: { variants: number[] }) => x.variants.includes(index));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (m) jobs.push(parser.getDependency('material', m.material).then((mat: any) => void (o.material = mat)));
      });
      await Promise.all(jobs);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = () => gltf.scene.getObjectByName('SM_Veh_Test_01') as any;
    expect(body().material.name).toBe('MAT_01');
    await selectVariant(gltf, 'blue');
    expect(body().material.name).toBe('MAT_01_blue');
    await selectVariant(gltf, 'red');
    expect(body().material.name).toBe('MAT_01');
  });

  it('meshopt: EXT_meshopt_compression; named parts keep their pivots; three decodes it with MeshoptDecoder', async () => {
    const plain = await buildModel(vehicleInput());
    const { glb, manifest } = await buildModel(vehicleInput({ compress: 'meshopt' }));
    expect(manifest.compress).toBe('meshopt');
    expect(manifest.wheels).toEqual(plain.manifest.wheels);
    await MeshoptDecoder.ready;
    const doc = await read(glb);
    expect(doc.getRoot().listExtensionsUsed().map((e) => e.extensionName)).toEqual(expect.arrayContaining(['EXT_meshopt_compression', 'KHR_mesh_quantization']));
    // The wheel node keeps its translation (its pivot); its mesh moved to an unnamed child with the dequantising transform.
    const wheel = doc.getRoot().listNodes().find((n) => n.getName() === 'SM_Veh_Test_01_Wheel_RL')!;
    expect(wheel.getTranslation().map((v) => +v.toFixed(4))).toEqual([0.9, 0.3, -1.4]);
    expect(wheel.getMesh()).toBeNull();
    expect(wheel.listChildren()[0].getMesh()).toBeTruthy();
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const { MeshoptDecoder: ThreeMeshopt } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
    for (const t of doc.getRoot().listTextures()) t.dispose();
    const bytes = await modelIO().writeBinary(doc);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gltf: any = await new Promise((res, rej) => new GLTFLoader().setMeshoptDecoder(ThreeMeshopt).parse(bytes.slice().buffer, '', res, rej));
    const THREE = await import('three');
    const box = new THREE.Box3().setFromObject(gltf.scene);
    expect(box.getSize(new THREE.Vector3()).toArray().map((v: number) => +v.toFixed(2))).toEqual(plain.manifest.bounds.size.map((v) => +v.toFixed(2)));
  });

  it('windowKeys: interpolated ends, retimed, reversed', () => {
    const t = [0, 1, 2], v = [[0, 0, 0], [1, 0, 0], [2, 0, 0]];
    expect(windowKeys(t, v, 'translation', 'LINEAR', { start: 0.5, end: 1.5, speed: 1 })).toEqual({ times: [0, 0.5, 1], values: [[0.5, 0, 0], [1, 0, 0], [1.5, 0, 0]] });
    expect(windowKeys(t, v, 'translation', 'LINEAR', { start: 0, end: 2, speed: 2, reverse: true }).values[0]).toEqual([2, 0, 0]);
  });

});
