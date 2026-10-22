# Copied from synty-sprite-generator worker/synty/rigs.py (P2, ali3b/sloponator#69): the Blender worker moved into the Sloponator unchanged.
"""Detect which rig profile a skeleton uses and map its bones onto the canonical humanoid."""
import json
import os
import re

RIGS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "rigs")


def load_canonical():
    with open(os.path.join(RIGS_DIR, "canonical.json")) as f:
        return json.load(f)


def profile_dirs():
    """Built-in profiles plus user-confirmed ones saved by the bone-mapping dialog (SSG_EXTRA_RIGS)."""
    dirs = [RIGS_DIR]
    extra = os.environ.get("SSG_EXTRA_RIGS")
    if extra and os.path.isdir(extra):
        dirs.append(extra)
    return dirs


def load_profiles():
    profiles = []
    for d in profile_dirs():
        for fn in sorted(os.listdir(d)):
            if fn.endswith(".json") and fn != "canonical.json":
                with open(os.path.join(d, fn)) as f:
                    profiles.append(json.load(f))
    return profiles


def strip(profile, bone):
    pat = profile.get("strip_prefix")
    return re.sub(pat, "", bone) if pat else bone


def match_profile(profile, bone_names):
    """Return {canonical: native_bone_name} for the canonical bones this profile finds."""
    by_stripped = {strip(profile, b).lower(): b for b in bone_names}
    found = {}
    for canon, native in profile["map"].items():
        hit = by_stripped.get(native.lower())
        if hit:
            found[canon] = hit
    return found


def detect(bone_names, min_score=0.9):
    """Pick the best rig profile. Returns {"profile", "score", "map"} or None if nothing fits."""
    canonical = load_canonical()["bones"]
    best = None
    for prof in load_profiles():
        found = match_profile(prof, bone_names)
        score = len(found) / len(canonical)
        if best is None or score > best["score"]:
            best = {"profile": prof["name"], "score": round(score, 3), "map": found}
    if best and best["score"] >= min_score:
        return best
    return None
