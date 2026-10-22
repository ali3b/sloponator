# Copied from synty-sprite-generator worker/retarget.py (P2, ali3b/sloponator#69): the Blender worker moved into the Sloponator unchanged.
"""Blender worker: bake an animation from any detected humanoid rig onto a Synty character.

Usage:
  blender -b --factory-startup -P worker/retarget.py -- '<json>'

JSON args:
  source        FBX containing the animation (Mixamo "without skin", Synty ANIMATION pack clip, ...)
  target        character FBX to receive it
  out_glb       output GLB: target skeleton + baked clip (meshes stripped; the Studio plays the clip on the
                character GLB from ingest, matching bones by name)
  action        optional name of the source action (default: the longest one)
  in_place      true (default) -> remove horizontal hips travel, keeping bob/sway
  clip_name     optional output clip name (default: source action name)

Method: per-bone world-space rotation transfer with a rest-pose alignment,
    R_target(t) = R_source(t) * R_source_rest^-1 * C * R_target_rest
where C rotates the target bone's rest direction (head -> next canonical bone's head) onto the source's.
That makes every target bone point exactly where the source bone points, whatever pose either rig rests
in (Synty characters rest in a T-pose; the Synty ANIMATION rig does not). Leaf bones (head, hands, toes)
reuse their parent's C. Hips translation is transferred as a displacement scaled by the hip-height ratio.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Matrix  # noqa: E402

from synty import rigs  # noqa: E402


def import_armature(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path, use_anim=True, ignore_leaf_bones=True,
                             automatic_bone_orientation=False)
    new = [o for o in bpy.data.objects if o not in before]
    arms = [o for o in new if o.type == "ARMATURE"]
    if not arms:
        raise RuntimeError(f"no armature in {path}")
    return arms[0], new


def rot(m):
    return m.to_quaternion().to_matrix().to_4x4()


def world_rest(arm, bone_name):
    return arm.matrix_world @ arm.data.bones[bone_name].matrix_local


def leg_length(arm, rig):
    """Thigh + shin length in world units (bone head to head), the same whatever pose the rest is in."""
    m = rig["map"]
    if not all(k in m for k in ("thigh_l", "calf_l", "foot_l")):
        return 0.0
    head = lambda k: world_rest(arm, m[k]).translation  # noqa: E731
    return (head("calf_l") - head("thigh_l")).length + (head("foot_l") - head("calf_l")).length


def main():
    raw = sys.argv[sys.argv.index("--") + 1]
    if raw.startswith("@"):
        with open(raw[1:]) as f:
            raw = f.read()
    args = json.loads(raw)
    bpy.ops.wm.read_factory_settings(use_empty=True)

    src, _ = import_armature(args["source"])
    actions = list(bpy.data.actions)
    if not actions:
        raise RuntimeError("source has no animation")
    action = next((a for a in actions if a.name == args.get("action")), None) or max(
        actions, key=lambda a: a.frame_range[1] - a.frame_range[0])
    src.animation_data_create()
    src.animation_data.action = action
    # Importing the target FBX overwrites the scene frame rate; the clip keeps the source's.
    fps = bpy.context.scene.render.fps / bpy.context.scene.render.fps_base

    tgt, tgt_objs = import_armature(args["target"])
    if tgt.animation_data:
        tgt.animation_data.action = None

    src_rig = rigs.detect([b.name for b in src.data.bones])
    tgt_rig = rigs.detect([b.name for b in tgt.data.bones])
    if not src_rig or not tgt_rig:
        raise RuntimeError(f"rig not recognised: source={src_rig and src_rig['profile']} target={tgt_rig and tgt_rig['profile']}")
    pairs = {canon: (src_rig["map"][canon], tgt_rig["map"][canon])
             for canon in tgt_rig["map"] if canon in src_rig["map"]}

    # Rest data.
    src_rest = {s: rot(world_rest(src, s)) for s, _ in pairs.values()}
    tgt_rest_world = {t: rot(world_rest(tgt, t)) for _, t in pairs.values()}
    s_hips, t_hips = pairs["hips"]
    src_hips_rest = world_rest(src, s_hips).translation.copy()
    tgt_hips_rest = world_rest(tgt, t_hips).translation.copy()
    src_floor = min(world_rest(src, b.name).translation.z for b in src.data.bones)
    tgt_floor = min(world_rest(tgt, b.name).translation.z for b in tgt.data.bones)
    scale = (tgt_hips_rest.z - tgt_floor) / max(1e-6, src_hips_rest.z - src_floor)
    in_place = args.get("in_place", True)
    f0, f1 = int(action.frame_range[0]), int(action.frame_range[1])

    # Some packs (Synty Sword Combat) store a non-standing rest pose, e.g. lying down. Hip height then says
    # nothing about the character's size, so scale by leg length (the same in any pose) and rebuild the
    # standing hip position from it, starting where the clip starts.
    src_leg, tgt_leg = leg_length(src, src_rig), leg_length(tgt, tgt_rig)
    rest_standing = src_leg <= 0 or (src_hips_rest.z - src_floor) > 0.6 * src_leg
    if not rest_standing and tgt_leg > 0:
        scale = tgt_leg / src_leg
        bpy.context.scene.frame_set(f0)
        start = (src.matrix_world @ src.pose.bones[s_hips].matrix).translation
        src_hips_rest = start.copy()
        src_hips_rest.z = src_floor + (tgt_hips_rest.z - tgt_floor) / scale

    # Rest alignment C per canonical bone (see module docstring).
    direction_child = {"hips": "spine1", "spine1": "spine2", "spine2": "spine3", "spine3": "neck", "neck": "head",
                       "clavicle_l": "upperarm_l", "upperarm_l": "lowerarm_l", "lowerarm_l": "hand_l",
                       "clavicle_r": "upperarm_r", "upperarm_r": "lowerarm_r", "lowerarm_r": "hand_r",
                       "thigh_l": "calf_l", "calf_l": "foot_l", "foot_l": "toe_l",
                       "thigh_r": "calf_r", "calf_r": "foot_r", "foot_r": "toe_r"}
    canon_parent = rigs.load_canonical()["parents"]

    def rest_dir(arm, a, b):
        return (world_rest(arm, b).translation - world_rest(arm, a).translation).normalized()

    align = {}
    for canon in rigs.load_canonical()["bones"]:  # parents-first order
        if canon not in pairs:
            continue
        child = direction_child.get(canon)
        if child in pairs:
            ds = rest_dir(src, pairs[canon][0], pairs[child][0])
            dt = rest_dir(tgt, pairs[canon][1], pairs[child][1])
            align[canon] = dt.rotation_difference(ds).to_matrix().to_4x4()
        else:
            align[canon] = align.get(canon_parent.get(canon), Matrix.Identity(4))
    align_by_target = {pairs[c][1]: m for c, m in align.items()}

    by_target = {t: s for s, t in pairs.values()}
    tgt_world = tgt.matrix_world
    tgt_world_inv = tgt_world.inverted()
    order = [b for b in tgt.data.bones]  # Blender lists bones parents-first

    scene = bpy.context.scene
    clip_name = args.get("clip_name") or action.name
    out_action = bpy.data.actions.new(clip_name)
    tgt.animation_data_create()
    tgt.animation_data.action = out_action
    for pb in tgt.pose.bones:
        pb.rotation_mode = "QUATERNION"

    travel = []  # source hips horizontal position per frame (walk/run speed)

    for frame in range(f0, f1 + 1):
        scene.frame_set(frame)
        pose_arm = {}  # target bone -> desired armature-space pose matrix
        for bone in order:
            rest_b = bone.matrix_local
            parent = bone.parent
            if parent is not None:
                chain = pose_arm[parent.name] @ parent.matrix_local.inverted() @ rest_b
            else:
                chain = rest_b.copy()
            s_name = by_target.get(bone.name)
            if s_name is None:
                pose_arm[bone.name] = chain
                continue
            # Rotation: world-space delta from the source rest, applied on the target rest.
            src_world = src.matrix_world @ src.pose.bones[s_name].matrix
            want_world_rot = (rot(src_world) @ src_rest[s_name].inverted() @ align_by_target[bone.name]
                              @ tgt_rest_world[bone.name])
            want_arm_rot = rot(tgt_world_inv) @ want_world_rot
            loc = chain.translation.copy()
            if bone.name == t_hips:
                d = src_world.translation - src_hips_rest
                travel.append((d.x, d.y))
                if in_place:  # Blender world is Z-up: drop horizontal travel, keep the vertical bob
                    d.x = 0.0
                    d.y = 0.0
                world_pos = tgt_hips_rest + d * scale
                loc = tgt_world_inv @ world_pos
            m = want_arm_rot.copy()
            m.translation = loc
            pose_arm[bone.name] = m

        for bone in order:
            if bone.name not in by_target:
                continue
            pb = tgt.pose.bones[bone.name]
            if bone.parent is not None:
                parent_pose = pose_arm[bone.parent.name]
                basis = (bone.parent.matrix_local.inverted() @ bone.matrix_local).inverted() \
                    @ parent_pose.inverted() @ pose_arm[bone.name]
            else:
                basis = bone.matrix_local.inverted() @ pose_arm[bone.name]
            loc, q, _ = basis.decompose()
            pb.rotation_quaternion = q
            pb.keyframe_insert("rotation_quaternion", frame=frame - f0)
            if bone.name == t_hips:
                pb.location = loc
                pb.keyframe_insert("location", frame=frame - f0)

    # Export only the target skeleton + baked clip.
    for o in list(bpy.data.objects):
        if o is not tgt:
            bpy.data.objects.remove(o, do_unlink=True)
    for a in list(bpy.data.actions):
        if a is not out_action:
            bpy.data.actions.remove(a)
    scene.frame_start, scene.frame_end = 0, f1 - f0
    scene.render.fps, scene.render.fps_base = round(fps), 1.0
    os.makedirs(os.path.dirname(os.path.abspath(args["out_glb"])), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=args["out_glb"], export_format="GLB", export_yup=True,
                              export_animations=True, export_force_sampling=True,
                              export_animation_mode="ACTIONS", export_skins=False)
    # Ground speed of the original motion (target scale), so engines can play walk/run cycles without sliding.
    speed = 0.0
    if len(travel) > 1 and f1 > f0:
        dx, dy = travel[-1][0] - travel[0][0], travel[-1][1] - travel[0][1]
        speed = (dx * dx + dy * dy) ** 0.5 * scale / ((f1 - f0) / fps)
    print("RETARGET_OK", json.dumps({"rest_standing": rest_standing, "clip": clip_name, "frames": f1 - f0 + 1, "fps": fps, "speed_mps": round(speed, 3),
                                      "source_rig": src_rig["profile"], "target_rig": tgt_rig["profile"],
                                      "bones": len(pairs), "hip_scale": round(scale, 3)}), flush=True)


if __name__ == "__main__":
    main()
