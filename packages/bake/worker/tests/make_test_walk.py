# Copied from synty-sprite-generator worker/tests/make_test_walk.py (P2, ali3b/sloponator#69): the Blender worker moved into the Sloponator unchanged.
"""Test fixture: author a crude walk cycle on a character's own skeleton and save it as an animation-only FBX.

  blender -b --factory-startup -P worker/tests/make_test_walk.py -- <character.fbx> <out.fbx>

Used to test retargeting across rigs (e.g. legacy War rig -> UE-style City rig) without external files.
Rotations are authored in world space (lateral axis), so the fixture doesn't depend on bone roll.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy  # noqa: E402
from mathutils import Matrix  # noqa: E402

from synty import rigs  # noqa: E402

src, out = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src, ignore_leaf_bones=True, automatic_bone_orientation=False)
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
for o in list(bpy.data.objects):
    if o.type == "MESH":
        bpy.data.objects.remove(o, do_unlink=True)

m = rigs.detect([b.name for b in arm.data.bones])["map"]
FRAMES = 24
# canonical bone -> (amplitude deg, phase): legs swing opposite, arms opposite to legs, knees bend.
SWING = {"thigh_l": (25, 0), "thigh_r": (25, math.pi), "calf_l": (-30, -math.pi / 2), "calf_r": (-30, math.pi / 2),
         "upperarm_l": (20, math.pi), "upperarm_r": (20, 0), "spine2": (4, 0)}
# Arms down from the T-pose so the result is clearly not a T-pose (world axis: forward, Blender -Y).
DROP = {"upperarm_l": -70, "upperarm_r": 70}

scene = bpy.context.scene
scene.frame_start, scene.frame_end = 0, FRAMES
arm.animation_data_create()
arm.animation_data.action = bpy.data.actions.new("TestWalk")
order = [b.name for b in arm.data.bones]
canon_of = {v: k for k, v in m.items()}

for f in range(FRAMES + 1):
    scene.frame_set(f)
    ph = 2 * math.pi * f / FRAMES
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    for name in order:
        c = canon_of.get(name)
        if c not in SWING and c not in DROP:
            continue
        pb = arm.pose.bones[name]
        world = arm.matrix_world @ pb.matrix
        head = world.translation.copy()
        r = Matrix.Identity(4)
        if c in DROP:
            r = Matrix.Rotation(math.radians(DROP[c]), 4, "Y") @ r
        if c in SWING:
            amp, phase = SWING[c]
            r = Matrix.Rotation(math.radians(amp) * math.sin(ph + phase), 4, "X") @ r
        new_world = Matrix.Translation(head) @ r @ Matrix.Translation(-head) @ world
        pb.matrix = arm.matrix_world.inverted() @ new_world
        bpy.context.view_layer.update()
    hips = arm.pose.bones[m["hips"]]
    w = arm.matrix_world @ hips.matrix
    w.translation.z += 0.03 * abs(math.sin(ph))
    w.translation.y -= 0.6 * f / FRAMES  # walks forward (Blender -Y): exercises in-place removal
    hips.matrix = arm.matrix_world.inverted() @ w
    bpy.context.view_layer.update()
    for pb in arm.pose.bones:
        pb.keyframe_insert("rotation_quaternion", frame=f)
        pb.keyframe_insert("location", frame=f)

bpy.ops.export_scene.fbx(filepath=out, use_selection=False, bake_anim=True, add_leaf_bones=False,
                         bake_anim_use_all_actions=False, bake_anim_use_nla_strips=False)
print("FIXTURE_OK", out)
