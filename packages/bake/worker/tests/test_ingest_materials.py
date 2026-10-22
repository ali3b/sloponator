# Copied from synty-sprite-generator worker/tests/test_ingest_materials.py (P2, ali3b/sloponator#69): the Blender worker moved into the Sloponator unchanged.
"""ingest.resolve_materials without Blender: bpy and mathutils are stubbed, materials are plain objects."""
import sys
import types
import unittest

sys.modules.setdefault("bpy", types.ModuleType("bpy"))
_mu = sys.modules.setdefault("mathutils", types.ModuleType("mathutils"))
if not hasattr(_mu, "Vector"):
    _mu.Vector = tuple

import ingest  # noqa: E402
from synty import textures  # noqa: E402


class Mat:
    def __init__(self, name):
        self.name = name
        self.use_nodes = False


class Slot:
    def __init__(self, material):
        self.material = material


class Obj:
    def __init__(self, name, material, *more):
        self.name = name
        self.parent = None
        self.material_slots = [Slot(m) for m in (material, *more)]


class SharedGlassMaterial(unittest.TestCase):
    def setUp(self):
        self._build = ingest.build_material
        ingest.build_material = lambda name, image, glass, fx=None, skin=None: Mat(name)

    def tearDown(self):
        ingest.build_material = self._build

    def test_glass_slot_does_not_turn_the_body_to_glass(self):
        # Palm City SM_Veh_Pickup_01: one FBX material (MAT_01A) for the body and its windows; the MaterialList
        # gives the body "PolygonPalmCity_01_A (Uses custom shader)" and the windows "Glass_01".
        ml = textures.parse_material_list(
            "Prefab Name: SM_Veh_Pickup_01\n"
            "    Mesh Name: SM_Veh_Pickup_01\n        Slot: PolygonPalmCity_01_A (Uses custom shader)\n"
            "    Mesh Name: SM_Veh_Pickup_01_Door_L\n        Slot: PolygonPalmCity_01_A (Uses custom shader)\n"
            "    Mesh Name: SM_Veh_Pickup_01_Door_L_Glass\n        Slot: Glass_01 (Uses custom shader)\n"
        )
        shared = Mat("MAT_01A")
        objs = [Obj(n, shared) for n in ("SM_Veh_Pickup_01", "SM_Veh_Pickup_01_Door_L", "SM_Veh_Pickup_01_Door_L_Glass")]
        available = ["/p/Textures/PolygonPalmCity_01_A.png", "/p/Textures/PolygonPalmCity_02_A.png"]
        report = ingest.resolve_materials(objs, available, ml, fallback=available[1])
        self.assertEqual(report["SM_Veh_Pickup_01_Door_L_Glass/MAT_01A"], "glass")
        self.assertEqual(report["SM_Veh_Pickup_01/MAT_01A"], available[0])
        self.assertEqual(report["SM_Veh_Pickup_01_Door_L/MAT_01A"], available[0])
        self.assertEqual(objs[0].material_slots[0].material.name, "PolygonPalmCity_01_A.png")
        self.assertEqual(objs[2].material_slots[0].material.name, "Glass")

    def test_all_glass_users_stay_glass(self):
        ml = textures.parse_material_list("Prefab Name: W\n    Mesh Name: W_Glass\n        Slot: Glass_01 (Uses custom shader)\n")
        objs = [Obj("W_Glass", Mat("MAT_01A"))]
        report = ingest.resolve_materials(objs, ["/p/T_01.png"], ml)
        self.assertEqual(report["W_Glass/MAT_01A"], "glass")

    def test_material_named_glass(self):
        objs = [Obj("Window", Mat("Glass_Mat"))]
        report = ingest.resolve_materials(objs, ["/p/T_01.png"], {})
        self.assertEqual(report["Window/Glass_Mat"], "glass")



class SignArt(unittest.TestCase):
    """Billboards (OR-FB-005): the sign face resolves to its own art, not the pack's palette sheet."""

    def setUp(self):
        self._build, self._refs = ingest.build_material, ingest.image_refs
        ingest.build_material = lambda name, image, glass, fx=None, skin=None: Mat(name)
        # The FBX's own image references, by material name.
        self.refs = {}
        ingest.image_refs = lambda mat: self.refs.get(mat.name, []) if mat else []

    def tearDown(self):
        ingest.build_material, ingest.image_refs = self._build, self._refs

    def test_multi_slot_mesh_resolves_each_slot(self):
        # Palm City SM_Prop_Billboard_02: FBX materials MAT_01B, MAT_01C, MAT_01A name the alt palette sheets; the
        # MaterialList's slots (same order) are the two sign faces and the frame's sheet.
        ml = textures.parse_material_list(
            "Prefab Name: SM_Prop_Billboard_02\n    Mesh Name: SM_Prop_Billboard_02\n"
            "        Slot: Billboard_Estate_02 (Uses custom shader)\n"
            "        Slot: Billboard_Dentist_01 (Uses custom shader)\n"
            "        Slot: PolygonPalmCity_01_A (Uses custom shader)\n"
        )
        self.assertEqual([x["slot"] for x in ml["SM_Prop_Billboard_02"]["slots"]], ["Billboard_Estate_02", "Billboard_Dentist_01", "PolygonPalmCity_01_A"])
        mats = [Mat("MAT_01B"), Mat("MAT_01C"), Mat("MAT_01A")]
        self.refs = {"MAT_01B": ["D:/x/PolygonPalmCity_01_B.png"], "MAT_01C": ["D:/x/PolygonPalmCity_01_C.png"], "MAT_01A": ["D:/x/PolygonPalmCity_01_A.png"]}
        available = [
            "/p/Textures/Alts/PolygonPalmCity_01_A.png", "/p/Textures/Alts/PolygonPalmCity_01_B.png", "/p/Textures/Alts/PolygonPalmCity_01_C.png",
            "/p/Textures/Signs/Billboards_Estate_02.png", "/p/Textures/Signs/Billboards_Dentist_01.png", "/p/Textures/Signs/Billboards_PalmCity_01.png",
        ]
        report = ingest.resolve_materials([Obj("SM_Prop_Billboard_02", *mats)], available, ml)
        self.assertEqual(report["SM_Prop_Billboard_02/MAT_01B"], available[3])
        self.assertEqual(report["SM_Prop_Billboard_02/MAT_01C"], available[4])
        self.assertEqual(report["SM_Prop_Billboard_02/MAT_01A"], available[0])

    def test_named_sign_sheet_beats_an_unrelated_fbx_sheet(self):
        # City SM_Prop_Billboard_Sign_01: the FBX names the palette sheet; the MaterialList names Billboard_01.png,
        # which ships as BillboardAds.png.
        ml = textures.parse_material_list(
            "Prefab Name: SM_Prop_Billboard_Sign_01\n    Mesh Name: SM_Prop_Billboard_Sign_01\n        Slot: Billboard_01\n"
            "            Albedo: Billboard_01.png (_Albedo_Map)\n"
        )
        self.refs = {"blinn283": ["C:/x/PolygonCity_Texture.png"]}
        available = ["/p/Textures/PolygonCity_Texture.png", "/p/Textures/PolygonCity_Texture_01_A.png", "/p/Textures/BillboardAds.png"]
        report = ingest.resolve_materials([Obj("SM_Prop_Billboard_Sign_01", Mat("blinn283"))], available, ml)
        self.assertEqual(report["SM_Prop_Billboard_Sign_01/blinn283"], available[2])

    def test_palette_props_keep_the_fbx_sheet(self):
        # City props name "PolygonCity_01_A.png" in the list and PolygonCity_Texture.png in the FBX: same sheet family,
        # the FBX's own reference still wins.
        ml = textures.parse_material_list(
            "Prefab Name: SM_Prop_Cone_01\n    Mesh Name: SM_Prop_Cone_01\n        Slot: PolygonCity_01_A\n"
            "            Albedo: PolygonCity_01_A.png (_Albedo_Map)\n"
        )
        self.refs = {"blinn283": ["C:/x/PolygonCity_Texture.png"]}
        available = ["/p/Textures/PolygonCity_Texture.png", "/p/Textures/PolygonCity_Texture_01_A.png", "/p/Textures/BillboardAds.png"]
        report = ingest.resolve_materials([Obj("SM_Prop_Cone_01", Mat("blinn283"))], available, ml)
        self.assertEqual(report["SM_Prop_Cone_01/blinn283"], available[0])

    def test_matching_helpers(self):
        self.assertEqual(textures.best_match(["Billboard_PalmCity_01"], ["/a/PolygonPalmCity_01_A.png", "/a/Billboards_PalmCity_01.png"], 0.99, plural=True), "/a/Billboards_PalmCity_01.png")
        self.assertIsNone(textures.best_match(["Billboard_PalmCity_01"], ["/a/Billboards_PalmCity_01.png"], 0.99))
        self.assertEqual(textures.named_prefix_match(["Billboard_01.png"], ["/a/PolygonCity_Texture.png", "/a/BillboardAds.png"]), "/a/BillboardAds.png")
        self.assertIsNone(textures.named_prefix_match(["Car_01"], ["/a/Cars_Texture.png"]))
        sheet = "/a/PolygonPalmCity_01_A.png"
        self.assertTrue(textures.is_own_art("/a/Billboards_PalmCity_01.png", "/a/PolygonPalmCity_01_B.png", sheet))
        self.assertTrue(textures.is_own_art("/a/BillboardAds.png", "/a/PolygonCity_Texture.png", "/a/PolygonCity_Texture_01_A.png"))
        self.assertTrue(textures.is_own_art("/a/Portrait_09.png", "/a/PolygonFantasyVillage_01_A.png", "/a/PolygonFantasyVillage_01_A.png"))
        self.assertTrue(textures.is_own_art("/p/Textures/Signs/Posters_Shark_01.png", "/a/PolygonPalmCity_01_A.png", sheet))
        self.assertFalse(textures.is_own_art("/a/Weatherboard_01.png", "/a/Weatherboard_07.png", sheet))
        self.assertFalse(textures.is_own_art("/a/Brick_01.png", "/a/PolygonFantasyVillage_01_A.png", "/a/PolygonFantasyVillage_01_A.png"))
        self.assertFalse(textures.is_own_art("/a/Design_Assets.png", "/a/PolygonCity_Texture.png", "/a/PolygonCity_Texture_01_A.png"))
        self.assertFalse(textures.is_own_art("/a/PolygonPalmCity_01_A.png", "/a/Overgrowth.png", sheet))


class ProRacer(unittest.TestCase):
    """OR-FB-016 (characters on the livery sheet) and OR-FB-023 (Seating_05's FBX names the wrong sheet)."""

    T = "/p/SourceFiles/Textures/ProRacer/"
    AVAILABLE = [T + "Alts/PolygonProRacer_VehicleTexture_01.png", T + "Alts/PolygonProRacer_VehicleTexture_03_Corsa.png",
                 T + "Alts/PolygonProRacer_Texture_01_A.png", T + "Misc/PolygonProRacer_SkinMask.png",
                 T + "Misc/PolygonProRacer_HairMask.png", T + "Misc/Seats_Diffuse.tga", T + "Misc/Vehicle_Red.png",
                 T + "Decals/Decal_Chug.png", "/p/SourceFiles/Textures/Generic/Generic_01_A.png"]

    def setUp(self):
        self._build, self._refs = ingest.build_material, ingest.image_refs
        self.built = []

        def build(name, image, glass, fx=None, skin=None):
            self.built.append((name, image, skin))
            return Mat(name)
        ingest.build_material = build
        self.refs = {}
        ingest.image_refs = lambda mat: self.refs.get(mat.name, []) if mat else []

    def tearDown(self):
        ingest.build_material, ingest.image_refs = self._build, self._refs

    def test_characters_keep_the_livery_with_skin_and_hair_from_the_plain_sheet(self):
        # ProRacer_Characters.fbx: every body and piece shares BaseMAT, which names the vehicle sheet; the MaterialList's
        # slot is PolygonProRacer_Mat_01_Chug (custom shader, no albedo).
        ml = textures.parse_material_list(
            "Prefab Name: SM_Chr_Driver_Male_01\n    Mesh Name: SM_Chr_Driver_Male_01\n"
            "        Slot: PolygonProRacer_Mat_01_Chug (Uses custom shader)\n"
            "    Mesh Name: SM_Chr_Attach_Hair_08\n        Slot: PolygonProRacer_Mat_01_Chug (Uses custom shader)\n")
        mat = Mat("ProRacer_Characters___Copy:BaseMAT")
        self.refs = {mat.name: ["D:/x/_Textures/PolygonProRacer_VehicleTexture_01.psd"]}
        objs = [Obj("SM_Chr_Driver_Male_01", mat), Obj("SM_Chr_Attach_Hair_08", mat)]
        report = ingest.resolve_materials(objs, self.AVAILABLE, ml, asset_name="ProRacer_Characters")
        livery, plain = self.AVAILABLE[0], self.AVAILABLE[2]
        self.assertEqual(report["SM_Chr_Driver_Male_01/" + mat.name], livery)
        self.assertEqual(self.built, [("PolygonProRacer_VehicleTexture_01.png", livery, (plain, [self.AVAILABLE[4], self.AVAILABLE[3]]))])

    def test_props_on_the_livery_sheet_are_untouched(self):
        mat = Mat("vehicles")
        self.refs = {"vehicles": ["C:/x/PolygonProRacer_VehicleTexture_01.png"]}
        report = ingest.resolve_materials([Obj("SM_Prop_Pit_Box_01", mat)], self.AVAILABLE, {})
        self.assertEqual(report["SM_Prop_Pit_Box_01/vehicles"], self.AVAILABLE[0])
        self.assertIsNone(self.built[0][2])

    def test_character_helpers(self):
        livery, plain = self.AVAILABLE[0], self.AVAILABLE[2]
        self.assertTrue(textures.is_character_mesh("SM_Chr_Crowd_01"))
        self.assertTrue(textures.is_character_mesh("ProRacer_Characters"))
        self.assertTrue(textures.is_character_mesh("Character_Male_01"))
        self.assertFalse(textures.is_character_mesh("SM_Prop_Chair_01"))
        self.assertEqual(textures.character_sheet(livery, self.AVAILABLE), plain)
        self.assertEqual(textures.character_sheet(plain, self.AVAILABLE), plain)
        self.assertEqual(textures.character_sheet(livery, [livery]), livery)
        self.assertEqual(textures.character_masks(livery, self.AVAILABLE), [self.AVAILABLE[4], self.AVAILABLE[3]])

    def test_seating_05_takes_the_sheet_its_material_names(self):
        # SM_Bld_Grandstand_Seating_01..04 reference Seats_Diffuse.tga; 05's FBX material "Polygon" names the vehicle
        # sheet, with the same seat UVs. All five have the slot Grandstand_Seating_MAT_01.
        ml = textures.parse_material_list(
            "Prefab Name: SM_Bld_Grandstand_Seating_05\n    Mesh Name: SM_Bld_Grandstand_Seating_05\n"
            "        Slot: Grandstand_Seating_MAT_01 (Uses custom shader)\n")
        self.refs = {"Polygon": ["C:/x/PolygonProRacer_VehicleTexture_01.png"]}
        report = ingest.resolve_materials([Obj("SM_Bld_Grandstand_Seating_05", Mat("Polygon"))], self.AVAILABLE, ml)
        self.assertEqual(report["SM_Bld_Grandstand_Seating_05/Polygon"], self.T + "Misc/Seats_Diffuse.tga")

    def test_a_slot_of_the_sheet_family_keeps_the_fbx_sheet(self):
        ml = textures.parse_material_list(
            "Prefab Name: SM_Prop_Cone_01\n    Mesh Name: SM_Prop_Cone_01\n"
            "        Slot: PolygonProRacer_Mat_01_Chug (Uses custom shader)\n")
        self.refs = {"vehicles": ["C:/x/PolygonProRacer_VehicleTexture_01.png"]}
        report = ingest.resolve_materials([Obj("SM_Prop_Cone_01", Mat("vehicles"))], self.AVAILABLE, ml)
        self.assertEqual(report["SM_Prop_Cone_01/vehicles"], self.AVAILABLE[0])

    def test_slot_texture_words(self):
        self.assertEqual(textures.slot_texture("Grandstand_Seating_MAT_01", self.AVAILABLE), self.T + "Misc/Seats_Diffuse.tga")
        # The sheet family's own slot names the plain sheet by its words; the override rule below keeps the FBX's.
        self.assertEqual(textures.slot_texture("PolygonProRacer_Mat_20_Red", self.AVAILABLE), self.AVAILABLE[2])
        self.assertIsNone(textures.slot_texture("Concrete_01", self.AVAILABLE))
        seats = self.T + "Misc/Seats_Diffuse.tga"
        self.assertTrue(textures.is_slot_texture_override(seats, self.AVAILABLE[0], "Grandstand_Seating_MAT_01"))
        self.assertFalse(textures.is_slot_texture_override(seats, seats, "Grandstand_Seating_MAT_01"))
        self.assertFalse(textures.is_slot_texture_override(self.AVAILABLE[2], self.AVAILABLE[0], "PolygonProRacer_Mat_01_Chug"))
        self.assertFalse(textures.is_slot_texture_override(seats, None, "Grandstand_Seating_MAT_01"))


class MaterialLists(unittest.TestCase):
    def test_every_list_is_read_and_the_packs_own_wins(self):
        import os
        import tempfile
        d = tempfile.mkdtemp()
        own, generic = os.path.join(d, "MaterialList_PolygonProRacer.txt"), os.path.join(d, "MaterialList_PolygonGeneric.txt")
        with open(own, "w") as f:
            f.write("Prefab Name: A\n    Mesh Name: A\n        Slot: Own_01 (Uses custom shader)\n")
        with open(generic, "w") as f:
            f.write("Prefab Name: A\n    Mesh Name: A\n        Slot: Generic_01_A (Uses custom shader)\n"
                    "Prefab Name: B\n    Mesh Name: B\n        Slot: Generic_01_A (Uses custom shader)\n")
        entries = ingest.material_list_entries([generic, own])
        self.assertEqual(entries["A"]["slot"], "Own_01")
        self.assertEqual(entries["B"]["slot"], "Generic_01_A")
        self.assertEqual(ingest.material_list_entries(own)["A"]["slot"], "Own_01")
        self.assertEqual(ingest.material_list_entries(None), {})


class AlphaCutout(unittest.TestCase):
    """OR-FB-018: a texture cuts its mesh out when enough of the mesh's UV samples fall on clear texels."""

    def test_cards_cut_out_palettes_do_not(self):
        # A card: the texture is clear outside a centred disc; its quad's corners sit on clear texels.
        disc = lambda u, v: 1.0 if (u - 0.5) ** 2 + (v - 0.5) ** 2 < 0.16 else 0.0
        card = [(0, 0), (1, 0), (1, 1), (0, 1), (0.5, 0.5)]
        self.assertTrue(ingest.is_cutout(disc, card))
        # A palette mesh: hundreds of samples on opaque swatches, one stray on a clear texel.
        samples = [(0.5, 0.5)] * 300 + [(0, 0)]
        self.assertFalse(ingest.is_cutout(disc, samples))
        self.assertFalse(ingest.is_cutout(disc, []))


if __name__ == "__main__":
    unittest.main()
