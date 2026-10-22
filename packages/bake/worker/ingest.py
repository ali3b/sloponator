# Copied from synty-sprite-generator worker/ingest.py (P2, ali3b/sloponator#69): the Blender worker moved into the Sloponator unchanged.
"""Blender worker: convert one Synty/Mixamo FBX into a normalized GLB plus metadata JSON.

Usage:
  blender -b --factory-startup -P worker/ingest.py -- '<json>'

JSON args (one Blender session handles a whole batch; startup is the slow part):
  items          list of {fbx, out_glb (optional -> metadata only), out_meta, out_thumb (optional PNG)}
  textures       list of texture file paths available in the pack
  material_lists the pack's MaterialList_*.txt files (material_list: one path, older callers)

Prints one line per item: INGEST_OK {...} or INGEST_FAIL {...}.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

from synty import rigs, roles, textures  # noqa: E402


def parse_args():
    raw = sys.argv[sys.argv.index("--") + 1]
    # Large argument sets (texture lists) come in a file: "@/path/args.json".
    if raw.startswith("@"):
        with open(raw[1:]) as f:
            return json.load(f)
    return json.loads(raw)


def import_fbx(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=path, use_anim=True, ignore_leaf_bones=True,
                             automatic_bone_orientation=False)


def world_bbox(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    if not pts:
        return None
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def to_gltf(v):
    """Blender Z-up -> glTF Y-up (same conversion the exporter applies)."""
    return [round(v.x, 4), round(v.z, 4), round(-v.y, 4)]


def material_list_entries(paths):
    """Every MaterialList of the pack, merged. Some packs ship the Generic pack's list beside their own (Pro Racer:
    MaterialList_PolygonGeneric.txt and MaterialList_PolygonProRacer.txt); the pack's own list wins a name both have."""
    if isinstance(paths, str):
        paths = [paths]
    paths = sorted((p for p in paths or [] if p and os.path.exists(p)),
                   key=lambda p: ("generic" in os.path.basename(p).lower(), p))
    merged = {}
    for path in paths:
        with open(path, encoding="utf-8", errors="replace") as f:
            for k, v in textures.parse_material_list(f.read()).items():
                merged.setdefault(k, v)
    return merged


def image_refs(mat):
    if not mat or not mat.use_nodes:
        return []
    return [n.image.filepath for n in mat.node_tree.nodes if n.type == "TEX_IMAGE" and n.image]


def is_glass(mat, slot_hint):
    names = " ".join(x for x in (mat.name if mat else "", slot_hint or "") if x).lower()
    return "glass" in names


def _emission_input(bsdf, name):
    # Blender 4.x: "Emission Color"; 3.x: "Emission".
    for key in (f"Emission {name}", "Emission" if name == "Color" else None):
        if key and key in bsdf.inputs:
            return bsdf.inputs[key]
    return None


def skin_image(livery_path, plain_path, mask_paths):
    """The livery sheet with the skin and hair masks' texels taken from the plain sheet (OR-FB-016), as a packed image
    the glTF export embeds. Cached by its inputs within the session."""
    import numpy as np
    name = "Skin_" + os.path.basename(livery_path)
    if name in bpy.data.images:
        return bpy.data.images[name]
    livery = bpy.data.images.load(livery_path, check_existing=True)
    plain = bpy.data.images.load(plain_path, check_existing=True)
    w, h = livery.size
    out = np.empty(w * h * 4, dtype=np.float32)
    livery.pixels.foreach_get(out)
    if tuple(plain.size) == (w, h):
        take = np.zeros(w * h, dtype=bool)
        buf = np.empty(w * h * 4, dtype=np.float32)
        for mp in mask_paths:
            m = bpy.data.images.load(mp, check_existing=True)
            if tuple(m.size) != (w, h):
                continue
            m.pixels.foreach_get(buf)
            take |= buf[0::4] > 0.5
        plain.pixels.foreach_get(buf)
        out = out.reshape(-1, 4)
        out[take] = buf.reshape(-1, 4)[take]
        out = out.reshape(-1)
        del buf
    img = bpy.data.images.new(name, w, h, alpha=True)
    img.pixels.foreach_set(out)
    img.file_format = "PNG"
    img.pack()
    return img


def build_material(name, image_path, glass, fx=None, skin=None):
    """fx: None (palette albedo), 'sprite' (white RGBA particle texture, self-lit, alpha-blended) or
    'unlit' (white self-lit, for FX meshes the renderer tints). FX materials carry ssg_fx in glTF extras.
    skin: (plain sheet, [mask paths]) for a character on a livery sheet (see skin_image)."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = 1.0
    bsdf.inputs["Metallic"].default_value = 0.0
    if fx:
        mat["ssg_fx"] = fx
        emit = _emission_input(bsdf, "Color")
        strength = _emission_input(bsdf, "Strength")
        if strength is not None:
            strength.default_value = 1.0
        if fx == "sprite" and image_path:
            tex = nt.nodes.new("ShaderNodeTexImage")
            tex.image = bpy.data.images.load(image_path, check_existing=True)
            tex.interpolation = "Linear"
            nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
            if emit is not None:
                nt.links.new(tex.outputs["Color"], emit)
            nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
            mat.blend_method = "BLEND"
        else:
            bsdf.inputs["Base Color"].default_value = (1, 1, 1, 1)
            if emit is not None:
                emit.default_value = (1, 1, 1, 1)
        return mat
    if glass:
        bsdf.inputs["Base Color"].default_value = (0.55, 0.7, 0.8, 1.0)
        bsdf.inputs["Alpha"].default_value = 0.45
        mat.blend_method = "BLEND"
    elif image_path:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = skin_image(image_path, *skin) if skin else bpy.data.images.load(image_path, check_existing=True)
        tex.interpolation = "Closest"  # palette atlases: avoid colour bleed between swatches
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


def ml_entry_for(obj, ml_entries):
    """MaterialList entry for a mesh. Child parts are often listed under the asset-prefixed name
    (FBX 'Wheel_fl' vs list 'SM_Veh_Car_Ambo_Wheel_fl'), so try that and the parent too."""
    names = [obj.name]
    root = obj
    while root.parent:
        root = root.parent
    if root is not obj:
        prefix = re.sub(r"_\d+$", "", root.name)
        names += [f"{prefix}_{obj.name}", root.name]
    for n in names:
        e = textures.lookup_material_list(ml_entries, n)
        if e:
            return e
    return {}


def slot_entry(obj, index, ml_entries):
    """The MaterialList entry for one material slot of a mesh: a mesh with several slots (a billboard's sign face
    and its frame) has one entry per slot in the FBX's order; otherwise the mesh's entry."""
    e = ml_entry_for(obj, ml_entries)
    if not e:
        return {}
    exact = ml_entries.get(obj.name) is e
    slots = e.get("slots")
    if slots and len(slots) == len(obj.material_slots) and 0 <= index < len(slots):
        return {**slots[index], "exact": exact}
    return {**e, "exact": exact}


def resolve_materials(meshes, available, ml_entries, siblings=(), fallback=None, asset_name=""):
    """Replace every mesh material with a clean Principled material using the resolved pack texture.

    Each source material is resolved once, using evidence from every mesh that shares it. FX meshes get a
    self-lit material (their pack textures are Unity particle shaders we cannot reproduce). Emissive/normal maps
    referenced by the FBX resolve to their albedo; sheets that ship in a sibling pack are looked up there.
    """
    sheet = textures.default_albedo(available)
    fallback = fallback or sheet
    emissive = []
    users = {}
    # Each slot's own MaterialList entry (for sign art), keyed by the slot wrapper kept in `users` (so its id stays
    # unique).
    slot_entry_of = {}
    for obj in meshes:
        for i, slot in enumerate(obj.material_slots):
            users.setdefault(slot.material, []).append((obj, slot))
            slot_entry_of[id(slot)] = slot_entry(obj, i, ml_entries)

    report, built = {}, {}
    for old, slots in users.items():
        entries = [ml_entry_for(obj, ml_entries) for obj, _ in slots]
        art_entries = [slot_entry_of.get(id(slot), {}) for _, slot in slots]
        ml_albedos = [e["albedo"] for e in entries if e.get("albedo")]
        raw_refs = image_refs(old)
        emissive += [r for r in raw_refs if textures.is_non_albedo_ref(r)]
        refs = [textures.albedo_ref(r) for r in raw_refs]
        ml_albedos = [textures.albedo_ref(a) for a in ml_albedos]
        fx_mesh = all(textures.is_fx_mesh(obj.name) or textures.is_fx_mesh(asset_name) for obj, _ in slots)
        if fx_mesh:
            sprite = textures.fx_texture_for(asset_name or slots[0][0].name, available)
            key = f"fx:{sprite or 'unlit'}"
            if key not in built:
                built[key] = build_material("FX_" + (os.path.basename(sprite) if sprite else "Unlit"), sprite, False,
                                            fx="sprite" if sprite else "unlit")
            for obj, slot in slots:
                slot.material = built[key]
                report[f"{obj.name}/{old.name if old else '?'}"] = key
            continue
        # Glass: the material's own name says so, or the MaterialList gives a mesh a glass slot (no albedo). One
        # FBX material is often shared by the body and its windows (Palm City's SM_Veh_Pickup_01: MAT_01A), so
        # a glass slot makes only those meshes glass; the rest resolve their texture below.
        slot_glass = [bool(e) and not e.get("albedo") and is_glass(None, e.get("slot")) for e in entries]
        if is_glass(old, None) or (slots and all(slot_glass)):
            glass_slots, slots = slots, []
        else:
            glass_slots = [s for s, g in zip(slots, slot_glass) if g]
            slots = [s for s, g in zip(slots, slot_glass) if not g]
            entries = [e for e, g in zip(entries, slot_glass) if not g]
            art_entries = [e for e, g in zip(art_entries, slot_glass) if not g]
            ml_albedos = [textures.albedo_ref(e["albedo"]) for e in entries if e.get("albedo")]
        if glass_slots:
            if "glass" not in built:
                built["glass"] = build_material("Glass", None, True)
            for obj, slot in glass_slots:
                slot.material = built["glass"]
                report[f"{obj.name}/{old.name if old else '?'}"] = "glass"
        if not slots:
            continue
        glass = False
        # A "(Uses custom shader)" slot has no albedo, but its slot is often the sheet's own name.
        ml_slots = [e["slot"] for e in entries if e.get("slot") and not e.get("albedo")]
        chosen = None
        # The MaterialList naming a texture of its own (a sign's art: Palm City's "Billboard_PalmCity_01" slot is
        # Billboards_PalmCity_01.png, City's "Billboard_01.png" is BillboardAds.png) beats an FBX reference to the
        # palette sheet (or an alt of it), when the list names this mesh exactly. A mesh with several slots (the face
        # and the frame) reads each slot's own entry; other materials keep resolving from the mesh's entry below.
        named = ([textures.albedo_ref(e["albedo"]) for e in art_entries if e.get("albedo")][:1]
                 + [e["slot"] for e in art_entries if e.get("slot") and not e.get("albedo")][:1])
        if named and all(e.get("exact") for e in art_entries):
            art = (textures.best_match(named, available, min_score=0.99, plural=True)
                   or textures.named_prefix_match(named, available))
            fbx = textures.best_match(refs, available, min_score=0.99)
            if art and textures.is_own_art(art, fbx, sheet):
                chosen = art
        # The MaterialList's material names a dedicated texture by its words (Grandstand_Seating_MAT_01 is
        # Seats_Diffuse.tga) while the FBX references an unrelated sheet (OR-FB-023): the list is the prefab's real
        # material, so it wins.
        list_slots = {e.get("slot") for e in art_entries if not e.get("albedo")}
        if not chosen and art_entries and all(e.get("exact") for e in art_entries) and len(list_slots) == 1 \
                and None not in list_slots:
            slot_name = next(iter(list_slots))
            by_words = textures.slot_texture(slot_name, available)
            if textures.is_slot_texture_override(by_words, textures.best_match(refs, available, min_score=0.99), slot_name):
                chosen = by_words
        if not glass and not chosen:
            # The FBX's own reference wins when it names a texture that exists exactly;
            # then the MaterialList (this pack, then sibling packs); then name similarity; then the default.
            chosen = (textures.best_match(refs, available, min_score=0.99)
                      or textures.best_match(ml_albedos[:1], available, min_score=0.99)
                      or textures.best_match(ml_slots[:1], available, min_score=0.99)
                      or textures.best_match(refs + ml_albedos[:1], siblings, min_score=0.99)
                      or textures.best_match(ml_albedos[:1], available)
                      or textures.prefix_match(refs, available)
                      or textures.best_match(refs + [old.name if old else None], available)
                      or fallback)
        # Characters on the vehicle livery sheet (Pro Racer) render with white skin and hair (OR-FB-016): Unity's
        # character shader tints those swatches through the pack's skin and hair masks. The livery stays (the drivers'
        # suits wear it); the masked texels come from the plain sheet, which has skin and hair painted in. Without
        # masks the plain sheet is used whole.
        skin = None
        if all(textures.is_character_mesh(obj.name) or textures.is_character_mesh(asset_name) for obj, _ in slots):
            plain = textures.character_sheet(chosen, available)
            if plain != chosen:
                masks = textures.character_masks(chosen, available)
                if masks:
                    skin = (plain, masks)
                else:
                    chosen = plain
        key = "glass" if glass else (f"skin:{chosen}" if skin else chosen)
        if key not in built:
            built[key] = build_material("Glass" if glass else os.path.basename(chosen or "untextured"),
                                        chosen, glass, skin=skin)
        for obj, slot in slots:
            slot.material = built[key]
            report[f"{obj.name}/{old.name if old else '?'}"] = "glass" if glass else chosen
    if emissive:
        report["_emissive"] = sorted(set(emissive))[0]
    return report


def _texture_node(mat):
    if not mat or not mat.use_nodes:
        return None
    return next((n for n in mat.node_tree.nodes if n.type == "TEX_IMAGE" and n.image), None)


def _uv_samples(obj):
    """(material, [(u, v), ...]) for each polygon of a mesh: its corners' UVs and its centre, on the UV set the
    textures read (the active render layer)."""
    me = obj.data
    layer = next((u for u in me.uv_layers if u.active_render), None) or me.uv_layers.active
    if layer is None:
        return []
    out = []
    for poly in me.polygons:
        if poly.material_index >= len(obj.material_slots):
            continue
        uvs = [tuple(layer.data[i].uv) for i in poly.loop_indices]
        if not uvs:
            continue
        centre = (sum(u for u, _ in uvs) / len(uvs), sum(v for _, v in uvs) / len(uvs))
        out.append((obj.material_slots[poly.material_index].material, uvs + [centre]))
    return out


def is_cutout(alpha_at, samples, threshold=0.5):
    """Whether a texture's alpha cuts the mesh out: enough of the UV samples the mesh's polygons take (corners and
    centres) fall on transparent texels. One stray sample on a palette sheet is not a cutout; a card's corners are."""
    n = len(samples)
    if not n:
        return False
    clear = sum(1 for uv in samples if alpha_at(*uv) < threshold)
    return clear >= max(1, 0.01 * n)


def _image_alpha(image):
    """A sampler of an image's alpha by UV (wrapping), or None when the image has no alpha below 1."""
    try:
        import numpy as np
    except ImportError:  # pragma: no cover - Blender ships numpy
        return None
    w, h = image.size
    if not w or not h or image.channels < 4:
        return None
    px = np.empty(w * h * 4, dtype=np.float32)
    image.pixels.foreach_get(px)
    alpha = px[3::4].reshape(h, w)
    if float(alpha.min()) >= 0.999:
        return None

    def at(u, v):
        x = min(w - 1, int((u - np.floor(u)) * w))
        y = min(h - 1, int((v - np.floor(v)) * h))
        return float(alpha[y, x])
    return at


def apply_alpha_cutout(meshes):
    """Alpha-cutout foliage and cards (OR-FB-018): a textured material whose texture is transparent where its meshes'
    UVs fall gets its alpha linked and alphaMode MASK (Blender CLIP, cutoff 0.5), double-sided. Returns the names of
    the materials changed."""
    samples = {}
    for obj in meshes:
        for mat, uvs in _uv_samples(obj):
            if mat is not None and not mat.get("ssg_fx") and mat.blend_method == "OPAQUE":
                samples.setdefault(mat, []).extend(uvs)
    alpha_of = {}
    changed = []
    for mat, uvs in samples.items():
        tex = _texture_node(mat)
        if tex is None:
            continue
        if tex.image.name not in alpha_of:
            alpha_of[tex.image.name] = _image_alpha(tex.image)
        at = alpha_of[tex.image.name]
        if at is None or not is_cutout(at, uvs):
            continue
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf is None:
            continue
        mat.node_tree.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
        mat.blend_method = "CLIP"
        mat.alpha_threshold = 0.5
        if hasattr(mat, "shadow_method"):
            mat.shadow_method = "CLIP"
        mat.use_backface_culling = False  # cards are seen from both sides
        changed.append(mat.name)
    return sorted(changed)


def normalize_units(arm):
    """Some Synty rigs (e.g. POLYGON War) are authored in centimetres. Scale those armatures to metres so
    every asset shares one unit: needed for composites and for a consistent pixels-per-metre across sheets."""
    if arm is None:
        return 1.0
    heights = [(arm.matrix_world @ b.head_local).z for b in arm.data.bones]
    extent = max(heights) - min(heights)
    if extent > 20:  # no humanoid or prop rig is 20 m tall: this is centimetres
        # The meshes are already in metres (they carry a 0.01 object scale), so keep their world
        # placement and shrink only the skeleton.
        kids = [(c, c.matrix_world.copy()) for c in arm.children]
        arm.scale = arm.scale * 0.01
        bpy.context.view_layer.update()
        for c, mw in kids:
            c.matrix_world = mw
        bpy.context.view_layer.update()
        return 0.01
    return 1.0


def body_variants(meshes):
    """Skinned meshes that are whole bodies. Synty ships some packs' characters as one FBX with every
    character on a shared skeleton; each full-height body becomes its own selectable character.
    Short skinned meshes (hair, hats, attachments) are not bodies."""
    skinned = [m for m in meshes if any(md.type == "ARMATURE" for md in m.modifiers)]
    if len(skinned) < 2:
        return []
    heights = {m.name: (lambda bb: bb[1].z - bb[0].z)(world_bbox([m])) for m in skinned}
    tallest = max(heights.values())
    bodies = [n for n, h in heights.items() if h >= 0.7 * tallest]
    return sorted(bodies) if len(bodies) > 1 else []


def is_bundled_attachment(name):
    """Synty's optional pieces in a combined character file (SM_Char_Attach_Male_Armor_01, SM_Gen_Chr_Attach_Hair_01):
    the same rule as isBundledAttachment in packages/shared/src/fx.ts."""
    return bool(re.search(r"(^|_)Attach(_|$)", name, re.I))


def bundled_attachments(meshes):
    """The bundled pieces of a combined character file, by name (each becomes its own attachment asset)."""
    return sorted((m for m in meshes if is_bundled_attachment(m.name)), key=lambda m: m.name)


def classify(arm, meshes, actions, name):
    skinned = [m for m in meshes if any(md.type == "ARMATURE" for md in m.modifiers)]
    if textures.is_fx_mesh(name) and not [m for m in meshes if m.parent is not None and m.type == "MESH"]:
        return "fx"
    if arm and skinned:
        return "character"
    if arm and actions and not meshes:
        return "animation"
    roots = [m for m in meshes if m.parent is None]
    children = [m for m in meshes if m.parent is not None]
    if "_Veh_" in name and children:
        return "vehicle"
    if roots and children:
        return "multipart"
    return "prop"


def part_info(obj, asset_name, rules):
    lo, hi = world_bbox([obj])
    size = hi - lo
    pivot = obj.matrix_world.translation
    # Spin/hinge axis guess: the thinnest bbox dimension (wheels/props spin about their thin axis).
    dims = [size.x, size.y, size.z]
    thin = dims.index(min(dims))
    axis_blender = [Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))][thin]
    return {
        "name": obj.name,
        "local": roles.local_name(obj.name, asset_name),
        "role": roles.role_for(obj.name, asset_name, rules),
        "parent": obj.parent.name if obj.parent else None,
        "pivot": to_gltf(pivot),
        "bbox_min": to_gltf(Vector((lo.x, hi.y, lo.z))),
        "bbox_max": to_gltf(Vector((hi.x, lo.y, hi.z))),
        "spin_axis": [abs(c) for c in to_gltf(axis_blender)],
    }


def render_thumb(meshes, path, size=160):
    """Small 3/4-front Workbench render (fast, works headless via surfaceless EGL)."""
    import math
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.render.film_transparent = True
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.image_settings.file_format = "PNG"
    cam_data = bpy.data.cameras.new("ThumbCam")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("ThumbCam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    lo, hi = world_bbox(meshes)
    centre = (lo + hi) / 2
    extent = max(hi - lo)
    # Synty assets face -Y in Blender (glTF +Z): look from the front-right, slightly above.
    cam.rotation_euler = (math.radians(65), 0, math.radians(-35))
    cam.location = centre + cam.rotation_euler.to_matrix() @ Vector((0, 0, extent * 3))
    cam_data.ortho_scale = extent * 1.1
    cam_data.clip_end = extent * 10
    os.makedirs(os.path.dirname(path), exist_ok=True)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)


def ingest_one(item, available, ml_entries):
    import_fbx(item["fbx"])
    name = os.path.splitext(os.path.basename(item["fbx"]))[0]
    objs = list(bpy.data.objects)
    arms = [o for o in objs if o.type == "ARMATURE"]
    meshes = [o for o in objs if o.type == "MESH"]
    actions = list(bpy.data.actions)
    arm = arms[0] if arms else None
    kind = classify(arm, meshes, actions, name)

    meta = {"name": name, "source": item["fbx"], "kind": kind, "unit_scale": normalize_units(arm)}

    if arm:
        bone_names = [b.name for b in arm.data.bones]
        meta["bones"] = bone_names
        meta["rig"] = rigs.detect(bone_names)
        if kind == "character" and not meta["rig"]:
            kind = meta["kind"] = "rigged"  # skinned but not a humanoid we can retarget (FX, creatures...)
        # Items shipped skinned to a character rig (SM_Item_Sword in the Dungeon pack) are props, not characters.
        if kind == "character" and re.match(r"^SM_(Item|Prop|Wep)_", name):
            kind = meta["kind"] = "prop"

    if actions:
        fps = bpy.context.scene.render.fps / bpy.context.scene.render.fps_base
        meta["animations"] = [{"name": a.name, "frame_start": int(a.frame_range[0]),
                               "frame_end": int(a.frame_range[1]), "fps": fps} for a in actions]

    if meshes:
        meta["materials"] = resolve_materials(meshes, available, ml_entries, item.get("_siblings") or (),
                                              item.get("_fallback"), name)
        meta["emissive"] = meta["materials"].pop("_emissive", None)
        cutout = apply_alpha_cutout(meshes)
        if cutout:
            meta["alpha_cutout"] = cutout
        fx_keys = sorted({v for v in meta["materials"].values() if v and v.startswith("fx:")})
        if fx_keys:
            meta["fx"] = {"mode": "unlit" if fx_keys[0] == "fx:unlit" else "sprite",
                          "texture": None if fx_keys[0] == "fx:unlit" else fx_keys[0][3:]}
        used = sorted({v for v in meta["materials"].values() if v and v != "glass" and not v.startswith("fx:")})
        meta["texture"] = used[0] if used else None
        meta["texture_variants"] = textures.variants(meta["texture"], available)
        bb = world_bbox(meshes)
        meta["bounds"] = {"min": to_gltf(Vector((bb[0].x, bb[1].y, bb[0].z))),
                          "max": to_gltf(Vector((bb[1].x, bb[0].y, bb[1].z)))}

    if kind in ("vehicle", "multipart"):
        rules = roles.load_rules()
        meta["parts"] = [part_info(o, name, rules) for o in meshes if o.parent is not None]

    if item.get("out_glb"):
        os.makedirs(os.path.dirname(item["out_glb"]), exist_ok=True)
        bpy.ops.export_scene.gltf(filepath=item["out_glb"], export_format="GLB", export_yup=True,
                                  export_apply=False, export_animations=bool(actions),
                                  export_skins=True, export_image_format="AUTO",
                                  # Some Synty FBX carry black vertex colours; the texture is the colour source.
                                  export_colors=False,
                                  # Custom properties (ssg_fx on FX materials) -> glTF extras -> material.userData.
                                  export_extras=True)

    if kind == "character":
        meta["variants"] = body_variants(meshes)

    if item.get("out_thumb") and meshes:
        if len(meta.get("variants", [])) > 1:
            # Combined files (e.g. PalmCityCharacters.fbx): one thumbnail per character body.
            base, ext = os.path.splitext(item["out_thumb"])
            for i, v in enumerate(meta["variants"]):
                for m in meshes:
                    # Bundled optional pieces (SM_Char_Attach_*_Armor_01, hair, capes) belong to no one body;
                    # the renderer hides them too (applyVariant in apps/web/src/render/assets.ts).
                    m.hide_render = (m.name in meta["variants"] and m.name != v) or is_bundled_attachment(m.name)
                render_thumb([m for m in meshes if m.name == v], f"{base}_{i}{ext}")
            # Each bundled piece is its own attachment asset (apps/server/src/bundled.ts): one thumbnail each.
            for a in bundled_attachments(meshes):
                for m in meshes:
                    m.hide_render = m is not a
                render_thumb([a], f"{base}_{a.name}{ext}")
            for m in meshes:
                m.hide_render = False
        else:
            render_thumb(meshes, item["out_thumb"])

    os.makedirs(os.path.dirname(item["out_meta"]), exist_ok=True)
    with open(item["out_meta"], "w") as f:
        json.dump(meta, f, indent=2)
    return {"kind": kind, "name": name}


def preferred_fallback(ml_entries, available, siblings):
    """When the pack's own default sheet is not what its MaterialList uses (map packs whose sheet ships in a
    sibling pack), fall back to the most-used MaterialList albedo that resolves here or in a sibling pack."""
    counts = {}
    for e in ml_entries.values():
        a = e.get("albedo")
        if a:
            counts[a] = counts.get(a, 0) + 1
    for name, _ in sorted(counts.items(), key=lambda kv: -kv[1]):
        ref = textures.albedo_ref(name)
        if textures.best_match([ref], available, min_score=0.99):
            return None  # the pack has its own main sheet: keep the normal default
        hit = textures.best_match([ref], siblings, min_score=0.99)
        if hit:
            return hit
    return None


def main():
    args = parse_args()
    available = args.get("textures") or []
    siblings = args.get("sibling_textures") or []
    ml_entries = material_list_entries(args.get("material_lists") or args.get("material_list"))
    fallback = preferred_fallback(ml_entries, available, siblings)
    for item in args["items"]:
        item["_siblings"] = siblings
        item["_fallback"] = fallback
        try:
            result = ingest_one(item, available, ml_entries)
            print("INGEST_OK", json.dumps({"fbx": item["fbx"], **result}), flush=True)
        except Exception as e:  # keep going: one broken FBX must not fail the whole pack
            print("INGEST_FAIL", json.dumps({"fbx": item["fbx"], "error": repr(e)}), flush=True)


if __name__ == "__main__":
    main()
