# Copied from synty-sprite-generator worker/synty/roles.py (P2, ali3b/sloponator#69): the Blender worker moved into the Sloponator unchanged.
"""Tag the rigid child parts of vehicles/props with animation roles (wheel, door, propeller...)."""
import json
import os
import re

ROLES_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "roles.json")


def load_rules():
    with open(ROLES_FILE) as f:
        return [(r["role"], re.compile(r["pattern"], re.I)) for r in json.load(f)["rules"]]


def local_name(part_name, asset_name):
    """Strip the shared asset prefix: ('SM_Veh_Car_Ambo_Door_l', 'SM_Veh_Car_Ambo_01') -> 'Door_l'."""
    p, a = part_name.split("_"), asset_name.split("_")
    # Parts often drop the asset's SM_/SK_ prefix ('Prop_Lecturn_01_Fabric_01' in 'SM_Prop_Lecturn_01').
    if a and a[0].lower() in ("sm", "sk") and p and p[0].lower() != a[0].lower():
        a = a[1:]
    i = 0
    while i < min(len(p), len(a)) and p[i].lower() == a[i].lower():
        i += 1
    rest = p[i:] or p[-1:]
    return "_".join(rest)


def role_for(part_name, asset_name, rules=None):
    rules = rules or load_rules()
    name = local_name(part_name, asset_name)
    for role, pat in rules:
        if pat.search(name):
            return role
    return None
