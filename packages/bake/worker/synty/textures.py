# Copied from synty-sprite-generator worker/synty/textures.py (P2, ali3b/sloponator#69): the Blender worker moved into the Sloponator unchanged.
"""Resolve the albedo texture for a Synty mesh.

Synty FBX files reference textures by absolute paths on Synty's own machines
(e.g. ``D:/Dropbox/.../Polygon_City_Characters_Texture_04_B.png`` or ``.psd``), and the
pack's MaterialList_*.txt uses loosely different names (``PolygonCity_01_A.png`` for
``PolygonCity_Texture_01_A.png``). We therefore match by name tokens against the PNG/TGA
files that actually exist in the pack.
"""
import os
import re

# Tokens that carry no identity ("texture", "polygon", file extensions).
_NOISE = {"texture", "textures", "tex", "polygon", "png", "psd", "tga", "jpg", "albedo", "map", "mat", "material"}
# Texture kinds that are never an albedo unless explicitly asked for.
_NON_ALBEDO = {"normal", "normals", "emissive", "emission", "metallic", "roughness", "skyline", "mask", "ao"}


# FX meshes (glowing effect geometry: puffs, cones, rings, light rays, flames, orbs). Kept in sync with
# packages/shared/src/fx.ts isFxName(); pickups, debris and props that merely carry an FX_ prefix are excluded.
FX_NAME = re.compile(r"(^|_)FX(_|\d|$)|GlowingOrb|LightRay|SunShafts|(^|_)(Electricity|Lightning|Bubble|Puff)(_|\d|$)|Particle_Smoke|Flame_Mesh", re.I)
FX_EXCLUDE = re.compile(r"Ammo|Arrow|Crystal|Grenade|Healthcube|Heart|Money|Coin|Note|Question|Shard|Skull|WoodChip|Gore"
                        r"|(^|_)Rock|Wep_|Candle|Chandel|Candelabra|Cart|Moth|Vine|Tower|Prop_|Crowd", re.I)


def is_fx_mesh(name):
    return bool(name) and bool(FX_NAME.search(name)) and not FX_EXCLUDE.search(name)


# FX meshes whose UVs are laid out for one of the Particle FX pack's sprite textures.
FX_TEXTURE_RULES = [(re.compile(r"Bullet_?Trail", re.I), "BulletTrail")]


def fx_texture_for(name, available):
    for pattern, tex in FX_TEXTURE_RULES:
        if pattern.search(name or ""):
            hits = [p for p in available if tex.lower() in os.path.basename(p).lower()]
            if hits:
                return sorted(hits, key=len)[0]
    return None


# Some map packs name a texture sheet that ships in a sibling pack under another name.
SHEET_ALIASES = {"polygondungeon_01": "Dungeons_Texture_01_A"}


def albedo_ref(name):
    """The albedo a referenced emissive/normal map belongs to: 'PolygonFantasyVillage_01_A_Emissive.png' ->
    'PolygonFantasyVillage_01_A.png', 'PolygonDarkFantasy_Emissive_01_A' -> 'PolygonDarkFantasy_01_A'."""
    if not name:
        return name
    base = re.split(r"[\\/]", name)[-1]
    stem, ext = os.path.splitext(base)
    cleaned = re.sub(r"_?(Emissive|Emission|Normals?)(?=_|$)", "", stem, flags=re.I)
    alias = SHEET_ALIASES.get(cleaned.lower())
    return (alias or cleaned) + ext


def is_non_albedo_ref(name):
    return bool(set(tokens(name or "")) & _NON_ALBEDO)


def tokens(name):
    """Split a file/material name into lowercase identity tokens."""
    base = re.split(r"[\\/]", name)[-1]
    base = re.sub(r"\.[A-Za-z0-9]+$", "", base)
    base = re.sub(r"([a-z])([A-Z])", r"\1_\2", base)      # camelCase -> camel_Case
    base = re.sub(r"([A-Za-z])(\d)", r"\1_\2", base)      # Cars02 -> Cars_02
    out = []
    for t in re.split(r"[^A-Za-z0-9]+", base.lower()):
        if not t or t in _NOISE:
            continue
        out.append(str(int(t)) if t.isdigit() else t)      # 01 == 1
    return out


def _singular(t):
    """'billboards' -> 'billboard' (Palm City names its sign sheets Billboards_* and their slots Billboard_*)."""
    return t[:-1] if len(t) > 4 and t.endswith("s") and not t.endswith("ss") else t


def _score(want, have, plural=False):
    w, h = set(want), set(have)
    if plural:
        w, h = {_singular(t) for t in w}, {_singular(t) for t in h}
    if not w or not h:
        return 0.0
    if (h & _NON_ALBEDO) and not (w & _NON_ALBEDO):
        return 0.0
    inter = len(w & h)
    return inter / len(w | h)


def best_match(candidates, available, min_score=0.5, plural=False):
    """Return the available texture path that best matches any candidate name, or None.

    ``candidates`` are tried in priority order; an exact token match on an earlier
    candidate beats a partial match on a later one. ``plural`` lets 'Billboard' match 'Billboards'.
    """
    avail = [(p, tokens(p)) for p in available]
    best, best_score = None, 0.0
    for rank, cand in enumerate(c for c in candidates if c):
        want = tokens(cand)
        for path, have in avail:
            s = _score(want, have, plural) - rank * 0.01
            if s > best_score:
                best, best_score = path, s
        if best_score >= 0.99:
            break
    return best if best_score >= min_score else None


def prefix_match(candidates, available):
    """A pack texture whose file name extends a referenced name: 'PolygonWar_Texture.psd' ->
    'PolygonWar_Texture_01_A.png' (the generic tokens make fuzzy matching useless for such names)."""
    def stem(p):
        return re.sub(r"\.[A-Za-z0-9]+$", "", re.split(r"[\\/]", p)[-1]).lower()
    for cand in candidates:
        if not cand:
            continue
        c = stem(cand)
        hits = [p for p in available if stem(p).startswith(c) and not (set(tokens(p)) & _NON_ALBEDO)]
        if hits:
            exact_a = [p for p in hits if tokens(p)[-2:] == ["1", "a"]]
            return sorted(exact_a or hits, key=len)[0]
    return None


def named_prefix_match(candidates, available):
    """A texture a MaterialList name stands for by its stem: POLYGON City's sign slots name 'Billboard_01.png', which
    ships as 'BillboardAds.png'. The name less its trailing numbers must start the file's name (4+ letters)."""
    def stem(p):
        return re.sub(r"\.[A-Za-z0-9]+$", "", re.split(r"[\\/]", p)[-1]).lower()
    for cand in candidates:
        if not cand:
            continue
        c = re.sub(r"([_\-\s]*\d+)+$", "", stem(cand))
        if len(c) < 4:
            continue
        hits = [p for p in available if stem(p).startswith(c) and not (set(tokens(p)) & _NON_ALBEDO)]
        if hits:
            return sorted(hits, key=len)[0]
    return None


def identity_words(name):
    """The words that say what a texture is (single letters and numbers are variants, not identity):
    'PolygonCity_Texture_01_A' -> {'city'}, 'Billboards_PalmCity_01' -> {'billboard', 'palm', 'city'}."""
    return {_singular(t) for t in tokens(name or "") if not t.isdigit() and len(t) > 1}


# Picture art a sign, poster or frame shows (its own sheet, laid out for that mesh's face).
SIGN_ART = re.compile(r"billboard|poster|portrait|painting|(^|[\\/_])signs?([\\/_.]|$)|(^|[\\/_])ads?([\\/_.]|$)|advert|banner", re.I)


def is_own_art(art, fbx, sheet):
    """Whether sign art the MaterialList names should replace the texture the FBX references: it is picture art
    (SIGN_ART: billboards, posters, portraits), it has words of its own beyond the pack's palette sheet's, and the
    FBX's texture shares none of them (it names the palette sheet or an alt of it). 'Billboards_PalmCity_01' over
    'PolygonPalmCity_01_B' yes; the palette sheet itself never. Tiled building textures the list names
    (Weatherboard_01, Brick_01) are left to the FBX: walls and roofs render from the palette as before."""
    if not art or not SIGN_ART.search(art):
        return False
    base = identity_words(sheet)
    words = identity_words(art) - base
    return bool(words) and not ((identity_words(fbx) - base) & words)


# Words a texture file carries that say nothing about what it shows ('Seats_Diffuse').
_GENERIC_TEX_WORDS = {"diffuse", "albedo", "base", "basecolor", "color", "colour", "col", "tex"}


def _stem_eq(a, b):
    """'seating' and 'seat' are one word (the shorter, 4+ letters, starts the longer)."""
    if a == b:
        return True
    short, long_ = sorted((a, b), key=len)
    return len(short) >= 4 and long_.startswith(short)


def slot_texture(slot, available):
    """The one texture a MaterialList material name stands for by its words (Pro Racer's 'Grandstand_Seating_MAT_01'
    is Misc/Seats_Diffuse.tga): every identity word of the texture (less generic ones like 'diffuse') is a word of
    the slot, or shares its stem. None when no texture or several fit."""
    want = identity_words(slot)
    if not want:
        return None
    hits = []
    for p in available:
        if set(tokens(p)) & _NON_ALBEDO:
            continue
        have = identity_words(p) - _GENERIC_TEX_WORDS
        if have and all(any(_stem_eq(h, w) for w in want) for h in have):
            hits.append(p)
    return hits[0] if len(hits) == 1 else None


def is_slot_texture_override(slot_tex, fbx_tex, slot):
    """Whether a texture the MaterialList slot names by its words (slot_texture) should replace the one the FBX
    references: the FBX's texture exists but shares no word with the slot. Pro Racer's SM_Bld_Grandstand_Seating_05
    names PolygonProRacer_VehicleTexture_01 in its FBX, while its slot (Grandstand_Seating_MAT_01, like Seating_01..04)
    is the seats sheet its UVs are laid out for. A slot that names the pack's own sheet family keeps the FBX's choice."""
    if not slot_tex or not fbx_tex or slot_tex == fbx_tex:
        return False
    return not (identity_words(fbx_tex) & identity_words(slot))


# Characters drawn with the Synty character shader: skin and hair are tinted through masks, and a vehicle livery
# sheet leaves those swatches white.
CHARACTER_NAME = re.compile(r"(^|_)(Chr|Char|Character)s?(_|$)", re.I)


def is_character_mesh(name):
    return bool(name) and bool(CHARACTER_NAME.search(name))


def character_sheet(chosen, available):
    """The plain palette sheet for a character mesh whose FBX names the pack's vehicle livery sheet. Pro Racer's
    characters reference PolygonProRacer_VehicleTexture_01, whose skin and hair swatches are white (Unity's shader
    tints them through PolygonProRacer_SkinMask/HairMask); PolygonProRacer_Texture_01_A has the same palette with the
    skin and hair painted in (ingest takes the masked texels from it and keeps the livery elsewhere: the drivers' suits
    wear it). Anything else is returned as it is."""
    if not chosen or "vehicle" not in tokens(chosen):
        return chosen
    want = identity_words(chosen) - {"vehicle"}
    if not want:
        return chosen
    hits = [p for p in available if p != chosen and not (set(tokens(p)) & _NON_ALBEDO) and identity_words(p) == want]
    if not hits:
        return chosen
    first_a = [p for p in hits if tokens(p)[-2:] == ["1", "a"]]
    return sorted(first_a or hits, key=len)[0]


def character_masks(chosen, available):
    """The pack's skin and hair masks for its sheet family ('PolygonProRacer_SkinMask.png', '..._HairMask.png'):
    the texels Unity's character shader tints."""
    want = identity_words(chosen) - {"vehicle"}
    out = []
    for p in available:
        words = identity_words(p)
        if "mask" in words and words & {"skin", "hair"} and words - {"mask", "skin", "hair"} == want:
            out.append(p)
    return sorted(out)


def default_albedo(available):
    """Fallback when nothing matches: the pack's '<x>_01_A' style base texture, else the first albedo-looking file."""
    albedos = [p for p in available if not (set(tokens(p)) & _NON_ALBEDO)]
    for p in sorted(albedos):
        t = tokens(p)
        if t[-2:] == ["1", "a"]:
            return p
    return sorted(albedos)[0] if albedos else None


def variants(chosen, available):
    """Sibling textures that differ only in the trailing letter/number variant (01_A, 01_B, 02_A ...)."""
    if not chosen:
        return []
    stem = [t for t in tokens(chosen) if not (t.isdigit() or len(t) == 1)]
    out = []
    for p in available:
        t = tokens(p)
        if set(t) & _NON_ALBEDO:
            continue
        if [x for x in t if not (x.isdigit() or len(x) == 1)] == stem:
            out.append(p)
    return sorted(out)


def parse_material_list(text):
    """Parse a Synty MaterialList_*.txt into {mesh_or_prefab_name: {"albedo": str|None, "slot": str}}.

    A mesh with several material slots also gets "slots": [{"slot", "albedo"}, ...] in the list's order (the FBX's
    material order), so each of its materials can resolve on its own (a billboard's face and its frame)."""
    result = {}
    slot_lists = {}
    prefab = mesh = slot = None
    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith("Prefab Name:"):
            prefab = line.split(":", 1)[1].strip()
            mesh = None
        elif line.startswith("Mesh Name:"):
            mesh = line.split(":", 1)[1].strip()
            slot_lists[mesh] = []  # a mesh listed again (under another prefab) lists its slots again
        elif line.startswith("Slot:"):
            slot = line.split(":", 1)[1].strip()
            # Older packs (POLYGON War) put the texture in brackets on the slot line and have no Albedo line:
            #   Slot: Polygon_War_American_Vehicles_01 (American_Vehicle_Texture_01)
            m = re.match(r"^(.*?)\s*\(([^)]+)\)\s*$", slot)
            albedo = None
            if m:
                slot, note = m.group(1), m.group(2).strip()
                # "(American_Vehicle_Texture_01)" names a texture; "(Uses custom shader)", "(No Albedo Texture)",
                # "(No textures assigned)" are notes.
                if re.fullmatch(r"[\w.\-]+", note) and not re.match(r"^(uses|no)\b", note, re.I):
                    albedo = note
            if mesh:
                slot_lists.setdefault(mesh, []).append({"slot": slot, "albedo": albedo})
            for key in (mesh, prefab):
                if key and (key not in result or (albedo and result[key]["albedo"] is None)):
                    result[key] = {"albedo": albedo, "slot": slot}
        elif line.startswith("Albedo:"):
            albedo = line.split(":", 1)[1].split("(")[0].strip() or None
            if albedo and re.match(r"^(none|no\b)", albedo, re.I):
                albedo = None
            if mesh and slot_lists.get(mesh) and slot_lists[mesh][-1]["albedo"] is None:
                slot_lists[mesh][-1]["albedo"] = albedo
            for key in (mesh, prefab):
                if key and result.get(key, {}).get("albedo") is None:
                    result[key] = {"albedo": albedo, "slot": slot}
    for key, slots in slot_lists.items():
        if len(slots) > 1 and key in result:
            result[key] = {**result[key], "slots": slots}
    return result


def lookup_material_list(entries, mesh_name):
    """Find a MaterialList entry for a mesh, tolerating SK_/SM_ prefixes and _01 suffixes."""
    if mesh_name in entries:
        return entries[mesh_name]
    # Unreal-style copies use SK_Chr_X for the model the list calls Character_X.
    mesh_name = re.sub(r"^SK_Chr_", "Character_", mesh_name)
    if mesh_name in entries:
        return entries[mesh_name]
    bare = re.sub(r"^(SK|SM)_", "", mesh_name)
    for key, val in entries.items():
        if re.sub(r"^(SK|SM)_", "", key) == bare:
            return val
    for key, val in entries.items():
        k = re.sub(r"^(SK|SM)_", "", key)
        if re.sub(r"_\d+$", "", k) == re.sub(r"_\d+$", "", bare):
            return val
    return None
