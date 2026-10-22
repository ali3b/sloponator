# Copied from synty-sprite-generator worker/tests/test_synty.py (P2, ali3b/sloponator#69): the Blender worker moved into the Sloponator unchanged.
"""Run with: python3 -m unittest discover -s worker/tests -t worker"""
import unittest

from synty import rigs, roles, textures

BIKER_BONES = ['Pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head', 'eyes', 'eyebrows', 'clavicle_l',
               'UpperArm_L', 'lowerarm_l', 'Hand_L', 'clavicle_r', 'UpperArm_R', 'lowerarm_r', 'Hand_R', 'Thigh_R',
               'calf_r', 'Foot_R', 'ball_r', 'toes_r', 'Thigh_L', 'calf_l', 'Foot_L', 'ball_l', 'toes_l',
               '_ik_foot_root', '_ik_hand_root']
COMMANDO_BONES = ['Root', 'Hips', 'Spine_01', 'Spine_02', 'Spine_03', 'Neck', 'Head', 'Eyes', 'Clavicle_L',
                  'Shoulder_L', 'Elbow_L', 'Hand_L', 'Clavicle_R', 'Shoulder_R', 'Elbow_R', 'Hand_R', 'UpperLeg_R',
                  'LowerLeg_R', 'Ankle_R', 'Ball_R', 'Toes_R', 'UpperLeg_L', 'LowerLeg_L', 'Ankle_L', 'Ball_L', 'Toes_L']
MIXAMO_BONES = ['mixamorig:' + b for b in ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftShoulder',
                'LeftArm', 'LeftForeArm', 'LeftHand', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
                'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'RightUpLeg', 'RightLeg', 'RightFoot',
                'RightToeBase']]


class RigDetection(unittest.TestCase):
    def test_synty_ue(self):
        r = rigs.detect(BIKER_BONES)
        self.assertEqual(r["profile"], "synty_ue")
        self.assertEqual(r["score"], 1.0)

    def test_synty_legacy(self):
        r = rigs.detect(COMMANDO_BONES)
        self.assertEqual(r["profile"], "synty_legacy")
        self.assertEqual(r["score"], 1.0)
        self.assertEqual(r["map"]["upperarm_l"], "Shoulder_L")

    def test_mixamo_prefix(self):
        r = rigs.detect(MIXAMO_BONES)
        self.assertEqual(r["profile"], "mixamo")
        self.assertEqual(r["map"]["hips"], "mixamorig:Hips")

    def test_unknown(self):
        self.assertIsNone(rigs.detect(["Bone", "Bone.001"]))


class PartRoles(unittest.TestCase):
    def check(self, asset, expected):
        for part, role in expected.items():
            self.assertEqual(roles.role_for(part, asset), role, part)

    def test_ambulance(self):
        self.check("SM_Veh_Car_Ambo_01", {
            "Wheel_fl": "wheel", "Wheel_rr": "wheel", "SteeringW": "steering",
            "SM_Veh_Car_Ambo_Door_l": "door", "SM_Veh_Car_Ambo_Glass": "static", "SM_Veh_Car_Ambo_Plates": "static"})

    def test_plane(self):
        self.check("SM_Veh_Plane_01", {
            "SM_Veh_Plane_Prop_01": "propeller", "SM_Veh_Plane_Flap_fl_01": "control_surface",
            "SM_Veh_Plane_Wheel_Door_F": "wheel_door", "SM_Veh_Plane_Wheels_L": "wheel",
            "SM_Veh_Plane_Wheel_F": "wheel", "SM_Veh_Plane_Cargo_Door_01": "door",
            "SM_Veh_Plane_Cockpit_Stick_L": "static"})

    def test_forklift_and_bot(self):
        self.check("SK_Veh_Forklift_01", {"SK_Veh_Forklift_Beams_01": "lift", "SK_Veh_Forklift_Wheel_fl": "wheel",
                                          "SK_Veh_Forklift_SteeringW_01": "steering"})
        self.check("SM_Veh_Delivery_Bot_01", {"SM_Veh_Delivery_Bot_01_Lid_01": "lid",
                                              "SM_Veh_Delivery_Bot_01_Wheel_FL": "wheel"})

    def test_pro_racer(self):
        # CS-FB-009: a steering wheel is `steering` (matched before the generic wheel rule); levers; mud flaps.
        self.check("SM_Veh_Stock_Car_01", {"SM_Veh_Stock_Car_01_Steering_Wheel_01": "steering",
                                           "SM_Veh_Stock_Car_01_Wheel_FL": "wheel",
                                           "SM_Veh_Stock_Car_01_Gear_Stick_01": "lever"})
        self.check("SM_Veh_Rally_01", {"SM_Veh_Rally_01_EBrake_01": "lever", "SM_Veh_Rally_01_Mudflaps_01": "static",
                                       "SM_Veh_Rally_01_SteeringW_01": "steering"})
        self.check("SM_Veh_Dirtbike_01", {"SK_Veh_Dirtbike_01_Handlebars": "steering"})


CITY_TEX = ["Textures/PolygonCity_Texture.png", "Textures/PolygonCity_Texture_01_A.png",
            "Textures/PolygonCity_Texture_01_B.png", "Textures/PolygonCity_Texture_02_A.png",
            "Textures/PolygonCity_Texture_Normal.png", "Textures/Emissive_01.png"]
CHAR_TEX = ["Textures/Polygon_City_Characters_Texture_01_A.png", "Textures/Polygon_City_Characters_Texture_04_B.png",
            "Textures/Polygon_City_Characters_Texture_04_C.png"]


class Textures(unittest.TestCase):
    def test_absolute_windows_path(self):
        ref = "D:/Dropbox/SyntyStudios/PolygonPeople/Assets/Textures/Polygon_City_Characters_Texture_04_B.png"
        self.assertEqual(textures.best_match([ref], CHAR_TEX), "Textures/Polygon_City_Characters_Texture_04_B.png")

    def test_material_list_loose_name(self):
        self.assertEqual(textures.best_match(["PolygonCity_01_A.png"], CITY_TEX), "Textures/PolygonCity_Texture_01_A.png")

    def test_never_picks_normal_map(self):
        self.assertNotEqual(textures.best_match(["PolygonCity_Texture"], CITY_TEX), "Textures/PolygonCity_Texture_Normal.png")

    def test_default_and_variants(self):
        self.assertEqual(textures.default_albedo(CITY_TEX), "Textures/PolygonCity_Texture_01_A.png")
        self.assertEqual(textures.variants("Textures/PolygonCity_Texture_01_A.png", CITY_TEX),
                         ["Textures/PolygonCity_Texture.png", "Textures/PolygonCity_Texture_01_A.png",
                          "Textures/PolygonCity_Texture_01_B.png",
                          "Textures/PolygonCity_Texture_02_A.png"])

    def test_material_list(self):
        text = """Prefab Name: SM_Veh_Car_Ambo_01
    Mesh Name: SM_Veh_Car_Ambo_01
        Slot: PolygonCity_01_A
            Albedo: PolygonCity_01_A.png (_Albedo_Map)
    Mesh Name: SM_Veh_Car_Ambo_Glass
        Slot: Glass_Vehicle_01
            No textures assigned
"""
        entries = textures.parse_material_list(text)
        self.assertEqual(entries["SM_Veh_Car_Ambo_01"]["albedo"], "PolygonCity_01_A.png")
        self.assertIsNone(entries["SM_Veh_Car_Ambo_Glass"]["albedo"])
        chars = textures.parse_material_list("Prefab Name: SM_Chr_Biker_01\n Mesh Name: Character_Biker\n"
                                             "  Slot: X\n   Albedo: PolygonCityCharacters_01_A.png (_Albedo_Map)\n")
        self.assertEqual(textures.lookup_material_list(chars, "SK_Character_Biker")["albedo"],
                         "PolygonCityCharacters_01_A.png")

    def test_prefix_and_unreal_names(self):
        war = ["T/PolygonWar_PostersSignsFlags_01_A.png", "T/PolygonWar_Texture_01_A.png", "T/PolygonWar_Texture_02_A.png"]
        self.assertEqual(textures.prefix_match(["U:/Dropbox/x/PolygonWar_Texture.psd"], war), "T/PolygonWar_Texture_01_A.png")
        entries = {"Character_Pilot_01": {"albedo": "PolygonWar_Texture_01_A", "slot": "x"}}
        self.assertEqual(textures.lookup_material_list(entries, "SK_Chr_Pilot_01")["albedo"], "PolygonWar_Texture_01_A")

    def test_material_list_war_format(self):
        # POLYGON War: texture in brackets on the slot line, no Albedo line.
        entries = textures.parse_material_list("""Prefab Name: SM_Veh_American_Tank_01
    Mesh Name: SM_Veh_American_Tank_01
        Slot: Polygon_War_American_Vehicles_01 (American_Vehicle_Texture_01)
    Mesh Name: SM_Veh_American_Tank_01_Track_l
        Slot: Polygon_War_TankTrack_Material (Tank_Track_Texture)
""")
        self.assertEqual(entries["SM_Veh_American_Tank_01"]["albedo"], "American_Vehicle_Texture_01")
        self.assertEqual(entries["SM_Veh_American_Tank_01_Track_l"]["albedo"], "Tank_Track_Texture")
        war = ["Textures/American_Vehicle_Texture_01.png", "Textures/American_Vehicle_Texture_01_Damaged.png",
               "Textures/PolygonWar_PostersSignsFlags_01_A.png", "Textures/Tank_Track_Texture.png"]
        self.assertEqual(textures.best_match(["American_Vehicle_Texture_01"], war), "Textures/American_Vehicle_Texture_01.png")


if __name__ == "__main__":
    unittest.main()


class TestNewPacks(unittest.TestCase):
    FX = ["FX_Sphere_Puff_01", "SM_Flame_FX", "SM_LightRayCube 1", "SunShafts", "SM_Particle_Smoke_01",
          "SM_Env_GlowingOrb_01", "FX_Electricity", "FX_Bubble_Half_01", "FX_Cone_01", "FX_Water_Rapids_01", "SM_Flame_Mesh_01"]
    NOT_FX = ["FX_Healthcube_01", "FX_Shard_Rock_01", "FX_SM_Prop_Candle_01", "FX_Cart_Mesh_01", "FX_Arrow_01",
              "SM_Prop_Candle_Flame_01", "SM_Prop_Lecturn_01", "FX_Money_Coin_01", "SM_FX_Crowd_Group_01"]

    def test_fx_names(self):
        for n in self.FX:
            self.assertTrue(textures.is_fx_mesh(n), n)
        for n in self.NOT_FX:
            self.assertFalse(textures.is_fx_mesh(n), n)

    def test_material_list_notes_are_not_textures(self):
        e = textures.parse_material_list(
            "Mesh Name: A\nSlot: PolygonParticleFX_Circle (Uses custom shader)\n"
            "Mesh Name: B\nSlot: X (No Albedo Texture)\n"
            "Mesh Name: C\nSlot: Polygon_War_01 (American_Vehicle_Texture_01)\n")
        self.assertIsNone(e["A"]["albedo"])
        self.assertIsNone(e["B"]["albedo"])
        self.assertEqual(e["C"]["albedo"], "American_Vehicle_Texture_01")

    def test_emissive_reference_resolves_to_albedo(self):
        avail = ["/p/Textures/Alts/PolygonFantasyVillage_01_A.png", "/p/Textures/PolygonFantasyVillage_01_A_Emissive.png",
                 "/p/Textures/Alts/PolygonFantasyVillage_01_B.png"]
        ref = textures.albedo_ref("D:/x/PolygonFantasyVillage_01_A_Emissive.png")
        self.assertEqual(textures.best_match([ref], avail, min_score=0.99), avail[0])
        self.assertEqual(textures.variants(avail[0], avail), [avail[0], avail[2]])
        self.assertEqual(textures.albedo_ref("PolygonDarkFantasy_Emissive_01_A.png"), "PolygonDarkFantasy_01_A.png")

    def test_sibling_alias(self):
        self.assertEqual(textures.albedo_ref("PolygonDungeon_01.png"), "Dungeons_Texture_01_A.png")
        sib = ["/q/POLYGON_Dungeon_Pack_v4/Textures/Dungeons_Texture_01_A.png"]
        self.assertEqual(textures.best_match([textures.albedo_ref("PolygonDungeon_01.png")], sib, min_score=0.99), sib[0])

    def test_fx_texture_rule(self):
        avail = ["/p/PolygonParticles_BulletTrail.png", "/p/PolygonParticles_Texture_01_A.png"]
        self.assertEqual(textures.fx_texture_for("FX_Bullet_Trail_01", avail), avail[0])
        self.assertIsNone(textures.fx_texture_for("FX_Sphere_01", avail))

    def test_role_prefix_and_fantasy_roles(self):
        self.assertNotEqual(roles.role_for("Prop_Lecturn_01_Fabric_01", "SM_Prop_Lecturn_01"), "propeller")
        self.assertEqual(roles.role_for("SM_Prop_Lever_01_Handle_01", "SM_Prop_Lever_01"), "lever")
        self.assertEqual(roles.role_for("Spikes_01", "SM_Prop_Trap_Floor_01"), "blade")
        self.assertEqual(roles.role_for("Arm_01", "SM_Veh_Catapult_01"), "arm")
