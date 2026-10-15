# -*- coding: utf-8 -*-
"""
===============================================================================
 DIORAMA WINTER  --  "FROST-FOLD CABIN"
===============================================================================
 A fully procedural winter diorama, authored 100% in code (bpy / bmesh).
 No external models, textures, HDRIs or addons are used.

 CONTENTS
   * Rounded-square display plinth (dark stone base + sculpted snow field)
   * "Frost-Fold Cabin": a folded-paper / ice-crystal cabin with an
     asymmetric ridge that rises toward one side, and a full-height
     triangular glazed gable pouring warm light into the cold.
   * Free-designed yard: swept footpath, frozen pond, snow-laden spruce,
     bare birches, driftwood fence, a lone lantern, firewood, footprints.

 RENDER / OUTPUT
   engine : EEVEE (default, fast) or Cycles (-- arg "cycles")
   output : render/diorama_winter_<tag>_<engine>.png
   blend  : diorama_winter.blend

 USAGE
   blender -b --factory-startup --python build_diorama.py -- <tag> <engine>
===============================================================================
"""

import bpy
import bmesh
import math
import os
import sys
import random
from math import radians, sin, cos, pi, sqrt, atan2, hypot
from mathutils import Vector, Euler, Matrix
from mathutils import noise as mnoise

# -----------------------------------------------------------------------------
# PATHS / CLI
# -----------------------------------------------------------------------------
try:
    HERE = os.path.dirname(os.path.abspath(__file__))
except NameError:
    HERE = os.getcwd()

ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
TAG = ARGV[0] if len(ARGV) > 0 else "v1"
ENGINE = ARGV[1] if len(ARGV) > 1 else "eevee"

RENDER_DIR = os.path.join(HERE, "render")
BLEND_PATH = os.path.join(HERE, "diorama_winter.blend")
os.makedirs(RENDER_DIR, exist_ok=True)

# Bloom is available via setup_compositor(), but the snow surface and the
# emissive openings sit at similar HDR levels, so any threshold that lights
# up the windows also washes the whole frame warm. The clean cold/warm
# contrast reads better, so it stays off.
USE_BLOOM = False

# -----------------------------------------------------------------------------
# GLOBAL DIMENSIONS  (metres)
# -----------------------------------------------------------------------------
BASE_W = 1.60          # plinth footprint, X
BASE_D = 1.60          # plinth footprint, Y
BASE_R = 0.17          # plinth corner radius
BASE_H = 0.150         # plinth thickness (top surface sits at z = 0)
SNOW_INSET = 0.024     # snow field outline inset from plinth edge

# cabin local frame (origin = cabin centre on the ground plane)
CAB_W = 0.500          # cabin footprint, X
CAB_D = 0.500          # cabin footprint, Y
CAB_HW = CAB_W * 0.5
CAB_HD = CAB_D * 0.5
WALL_TOP = 0.262       # eave height
RIDGE_Y = -0.105       # ridge line Y (pushed forward -> steep front, long rear)
RIDGE_Z_L = 0.360      # ridge height at -X end
RIDGE_Z_R = 0.505      # ridge height at +X end   (asymmetric! one wing soars)

CAB_POS = Vector((0.135, 0.190, 0.0))   # cabin placement on the plinth

# -----------------------------------------------------------------------------
# SMALL MATH HELPERS
# -----------------------------------------------------------------------------
def clamp(x, a=0.0, b=1.0):
    return a if x < a else (b if x > b else x)


def smoothstep(a, b, x):
    if b == a:
        return 0.0 if x < a else 1.0
    t = clamp((x - a) / (b - a))
    return t * t * (3.0 - 2.0 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def fbm(x, y, z=0.0, scale=1.0, octaves=3, lac=2.13, gain=0.5, seed=0.0):
    """Fractal value noise in [-1, 1]-ish range."""
    v = 0.0
    amp = 1.0
    freq = scale
    norm = 0.0
    for _ in range(octaves):
        v += amp * mnoise.noise(Vector((x * freq + seed * 1.37,
                                        y * freq + seed * 2.71,
                                        z * freq + seed * 3.19)))
        norm += amp
        amp *= gain
        freq *= lac
    return v / max(norm, 1e-9)


def rr_sdf(x, y, w, d, r):
    """Signed distance to a rounded rectangle. Negative = inside."""
    hw = w * 0.5 - r
    hd = d * 0.5 - r
    qx = abs(x) - hw
    qy = abs(y) - hd
    outside = hypot(max(qx, 0.0), max(qy, 0.0))
    inside = min(max(qx, qy), 0.0)
    return outside + inside - r


def polyline_dist(px, py, pts):
    """Shortest distance from (px,py) to a 2D polyline."""
    best = 1e9
    for i in range(len(pts) - 1):
        ax, ay = pts[i]
        bx, by = pts[i + 1]
        vx, vy = bx - ax, by - ay
        L2 = vx * vx + vy * vy
        if L2 < 1e-12:
            t = 0.0
        else:
            t = clamp(((px - ax) * vx + (py - ay) * vy) / L2)
        cx, cy = ax + vx * t, ay + vy * t
        best = min(best, hypot(px - cx, py - cy))
    return best


def resample_path(pts, n):
    """Resample a polyline into n evenly spaced points."""
    segs = []
    total = 0.0
    for i in range(len(pts) - 1):
        a = Vector(pts[i])
        b = Vector(pts[i + 1])
        L = (b - a).length
        segs.append((a, b, L))
        total += L
    out = []
    for k in range(n):
        s = total * k / (n - 1)
        acc = 0.0
        for a, b, L in segs:
            if acc + L >= s - 1e-9:
                t = 0.0 if L < 1e-9 else (s - acc) / L
                out.append(a.lerp(b, clamp(t)))
                break
            acc += L
        else:
            out.append(Vector(pts[-1]))
    return out


# -----------------------------------------------------------------------------
# SCENE / OBJECT PLUMBING
# -----------------------------------------------------------------------------
ROOT = None


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    global ROOT
    ROOT = bpy.context.scene.collection


def obj_from_pydata(name, verts, faces, mat=None, smooth=False, collection=None,
                    recalc=False):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.validate(verbose=False)
    if recalc and len(me.polygons):
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        bm.to_mesh(me)
        bm.free()
    me.update()
    ob = bpy.data.objects.new(name, me)
    (collection or bpy.context.scene.collection).objects.link(ob)
    if mat is not None:
        me.materials.append(mat)
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    return ob


def beam_obj(name, p0, p1, r, mat, sides=4, rot=0.0, taper=1.0):
    """A prism running from p0 to p1 (used for posts, branches, battens)."""
    p0 = Vector(p0)
    p1 = Vector(p1)
    d = p1 - p0
    L = d.length
    if L < 1e-9:
        return None
    z = d / L
    ref = Vector((0.0, 0.0, 1.0))
    if abs(z.dot(ref)) > 0.95:
        ref = Vector((1.0, 0.0, 0.0))
    x = ref.cross(z).normalized()
    y = z.cross(x).normalized()
    verts = []
    for k, base, rr in ((0, p0, r), (1, p1, r * taper)):
        for i in range(sides):
            a = rot + 2.0 * pi * i / sides
            verts.append(tuple(base + x * (rr * cos(a)) + y * (rr * sin(a))))
    faces = []
    for i in range(sides):
        j = (i + 1) % sides
        faces.append((i, j, sides + j, sides + i))
    faces.append(tuple(range(sides - 1, -1, -1)))
    faces.append(tuple(range(sides, 2 * sides)))
    return obj_from_pydata(name, verts, faces, mat, recalc=True)


def plate_obj(name, quad_outer, offset_dir, thickness, mat, shrink=0.0):
    """A thin slab built from a quad, pushed along offset_dir."""
    n = Vector(offset_dir).normalized()
    pts = [Vector(p) for p in quad_outer]
    if shrink > 0.0:
        c = sum(pts, Vector()) / len(pts)
        pts = [c + (p - c) * (1.0 - shrink) for p in pts]
    top = [p + n * thickness for p in pts]
    verts = [tuple(p) for p in pts] + [tuple(p) for p in top]
    faces = [(0, 1, 2, 3), (4, 5, 6, 7), (0, 4, 5, 1), (1, 5, 6, 2),
             (2, 6, 7, 3), (3, 7, 4, 0)]
    return obj_from_pydata(name, verts, faces, mat, recalc=True)


def tri_slab(name, tri, offset_dir, thickness, mat):
    """A thin slab built from a triangle."""
    n = Vector(offset_dir).normalized()
    pts = [Vector(p) for p in tri]
    top = [p + n * thickness for p in pts]
    verts = [tuple(p) for p in pts] + [tuple(p) for p in top]
    faces = [(0, 1, 2), (5, 4, 3), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)]
    return obj_from_pydata(name, verts, faces, mat, recalc=True)


def obj_from_bmesh(name, bm, mat=None, smooth=False):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.validate(verbose=False)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if mat is not None:
        me.materials.append(mat)
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    return ob


def join_objects(objs, name):
    """Join a list of mesh objects into one (no ops, pure data-API)."""
    bm = bmesh.new()
    mats = []
    for ob in objs:
        me = ob.data
        me.transform(ob.matrix_world)
        # remap material indices into the merged list
        local_map = []
        for m in me.materials:
            if m not in mats:
                mats.append(m)
            local_map.append(mats.index(m))
        if not me.polygons:
            continue
        tmp = me.copy()
        for p in tmp.polygons:
            p.material_index = local_map[p.material_index] if local_map else 0
        bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)

    me_new = bpy.data.meshes.new(name)
    bm.to_mesh(me_new)
    bm.free()
    me_new.validate(verbose=False)
    ob = bpy.data.objects.new(name, me_new)
    bpy.context.scene.collection.objects.link(ob)
    for m in mats:
        me_new.materials.append(m)
    # remove the source objects
    for ob_old in objs:
        mesh = ob_old.data
        bpy.data.objects.remove(ob_old, do_unlink=True)
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)
    return ob


# -----------------------------------------------------------------------------
# MATERIALS
# -----------------------------------------------------------------------------
MAT = {}


def _bsdf(mat):
    return mat.node_tree.nodes.get("Principled BSDF")


def new_mat(name, base=(0.8, 0.8, 0.8), rough=0.5, metal=0.0,
            spec=None, emis=None, emis_str=0.0, alpha=1.0,
            transmission=0.0, ior=1.45, coat=0.0, sheen=0.0,
            subsurf=0.0, subsurf_col=(0.9, 0.9, 0.95)):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = _bsdf(m)
    b.inputs["Base Color"].default_value = (*base, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    b.inputs["IOR"].default_value = ior
    if alpha < 1.0:
        b.inputs["Alpha"].default_value = alpha
        for attr, val in (("blend_method", 'BLEND'),
                          ("surface_render_method", 'BLENDED'),
                          ("use_transparent_shadow", True)):
            try:
                setattr(m, attr, val)
            except Exception:
                pass
    if transmission > 0.0:
        b.inputs["Transmission Weight"].default_value = transmission
    if spec is not None:
        b.inputs["Specular IOR Level"].default_value = spec
    if emis is not None:
        b.inputs["Emission Color"].default_value = (*emis, 1.0)
        b.inputs["Emission Strength"].default_value = emis_str
    if coat > 0.0:
        b.inputs["Coat Weight"].default_value = coat
    if sheen > 0.0:
        b.inputs["Sheen Weight"].default_value = sheen
        b.inputs["Sheen Roughness"].default_value = 0.4
    if subsurf > 0.0:
        b.inputs["Subsurface Weight"].default_value = subsurf
        b.inputs["Subsurface Radius"].default_value = subsurf_col
    return m


def add_noise_bump(mat, scale=40.0, detail=6.0, strength=0.2, rough_var=0.0):
    """Attach a procedural noise -> bump (and optionally roughness jitter)."""
    nt = mat.node_tree
    b = _bsdf(mat)
    tex = nt.nodes.new("ShaderNodeTexNoise")
    tex.inputs["Scale"].default_value = scale
    tex.inputs["Detail"].default_value = detail
    tex.location = (-700, -260)
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = strength
    bump.inputs["Distance"].default_value = 0.02
    bump.location = (-420, -260)
    nt.links.new(tex.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    if rough_var > 0.0:
        mr = nt.nodes.new("ShaderNodeMapRange")
        mr.location = (-420, 60)
        mr.inputs["From Min"].default_value = 0.0
        mr.inputs["From Max"].default_value = 1.0
        mr.inputs["To Min"].default_value = max(0.0, b.inputs["Roughness"].default_value - rough_var)
        mr.inputs["To Max"].default_value = min(1.0, b.inputs["Roughness"].default_value + rough_var)
        nt.links.new(tex.outputs["Fac"], mr.inputs["Value"])
        nt.links.new(mr.outputs["Result"], b.inputs["Roughness"])
    return mat


def add_color_variation(mat, base_a, base_b, scale=6.0, fac_out=None):
    """Blend two base colours with noise (breaks up flat surfaces)."""
    nt = mat.node_tree
    b = _bsdf(mat)
    tex = nt.nodes.new("ShaderNodeTexNoise")
    tex.inputs["Scale"].default_value = scale
    tex.inputs["Detail"].default_value = 4.0
    tex.location = (-900, 220)
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.location = (-640, 220)
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[0].color = (*base_a, 1.0)
    ramp.color_ramp.elements[1].position = 0.65
    ramp.color_ramp.elements[1].color = (*base_b, 1.0)
    nt.links.new(tex.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    return mat


def build_materials():
    M = MAT

    # --- snow -------------------------------------------------------------
    M['snow'] = new_mat("Snow", base=(0.905, 0.935, 0.985), rough=0.32,
                        subsurf=0.16, subsurf_col=(0.42, 0.50, 0.62), spec=0.42)
    add_noise_bump(M['snow'], scale=55.0, detail=8.0, strength=0.22, rough_var=0.12)

    M['snow_shade'] = new_mat("SnowShade", base=(0.72, 0.78, 0.88), rough=0.40)
    add_noise_bump(M['snow_shade'], scale=60.0, detail=8.0, strength=0.25)

    # --- plinth stone -----------------------------------------------------
    M['plinth'] = new_mat("PlinthStone", base=(0.050, 0.060, 0.078), rough=0.70,
                          spec=0.28, coat=0.08)
    add_noise_bump(M['plinth'], scale=26.0, detail=7.0, strength=0.30, rough_var=0.10)

    M['plinth_top'] = new_mat("PlinthTop", base=(0.030, 0.038, 0.052), rough=0.82)

    # --- cabin timber -----------------------------------------------------
    M['wood'] = new_mat("CabinTimber", base=(0.105, 0.062, 0.040), rough=0.58,
                        spec=0.35, coat=0.10)
    add_color_variation(M['wood'], (0.085, 0.048, 0.030), (0.140, 0.086, 0.056), 9.0)
    add_noise_bump(M['wood'], scale=34.0, detail=6.0, strength=0.16)

    M['wood_dark'] = new_mat("TimberDark", base=(0.045, 0.030, 0.024), rough=0.62)
    add_noise_bump(M['wood_dark'], scale=40.0, detail=5.0, strength=0.18)

    M['wood_light'] = new_mat("TimberLight", base=(0.290, 0.196, 0.126), rough=0.62)
    add_noise_bump(M['wood_light'], scale=40.0, detail=6.0, strength=0.18)

    # --- roof -------------------------------------------------------------
    M['roof'] = new_mat("RoofShingle", base=(0.052, 0.060, 0.078), rough=0.55,
                        spec=0.45, coat=0.14)
    add_noise_bump(M['roof'], scale=64.0, detail=6.0, strength=0.22)

    # --- warm glazing -----------------------------------------------------
    M['glass_warm'] = new_mat("GlazingWarm", base=(1.0, 0.62, 0.28), rough=0.16,
                              emis=(1.0, 0.510, 0.180), emis_str=3.1,
                              transmission=0.25, ior=1.45, alpha=1.0)
    M['glass_warm_bright'] = new_mat("GlazingCore", base=(1.0, 0.78, 0.45), rough=0.10,
                                     emis=(1.0, 0.660, 0.330), emis_str=5.6)
    M['glass_cool'] = new_mat("GlazingCool", base=(0.30, 0.42, 0.60), rough=0.14,
                              emis=(0.36, 0.52, 0.78), emis_str=0.65,
                              transmission=0.35, ior=1.45)

    # --- metal ------------------------------------------------------------
    M['metal'] = new_mat("DarkMetal", base=(0.055, 0.062, 0.075), rough=0.34, metal=0.92)
    M['metal_warm'] = new_mat("LampMetal", base=(0.115, 0.082, 0.048), rough=0.38, metal=0.85)

    # --- lamp glow --------------------------------------------------------
    M['lamp'] = new_mat("LampGlow", base=(1.0, 0.72, 0.38), rough=0.10,
                        emis=(1.0, 0.600, 0.250), emis_str=11.0)

    # --- vegetation -------------------------------------------------------
    M['pine'] = new_mat("SpruceNeedle", base=(0.030, 0.062, 0.050), rough=0.66,
                        spec=0.25, sheen=0.35)
    M['pine_snow'] = new_mat("SpruceSnow", base=(0.880, 0.918, 0.975), rough=0.36,
                             subsurf=0.10, subsurf_col=(0.45, 0.52, 0.64))
    M['bark'] = new_mat("BirchBark", base=(0.520, 0.512, 0.500), rough=0.62)
    add_color_variation(M['bark'], (0.400, 0.392, 0.380), (0.640, 0.630, 0.616), 12.0)
    M['twig'] = new_mat("Twig", base=(0.245, 0.205, 0.175), rough=0.70)
    M['frost_twig'] = new_mat("FrostTwig", base=(0.660, 0.700, 0.760), rough=0.50)

    # --- ice --------------------------------------------------------------
    M['ice'] = new_mat("PondIce", base=(0.145, 0.240, 0.365), rough=0.055,
                       transmission=0.60, ior=1.31, coat=0.70, spec=0.80,
                       emis=(0.100, 0.190, 0.330), emis_str=0.10)
    M['ice_edge'] = new_mat("IceRim", base=(0.830, 0.890, 0.960), rough=0.30,
                            subsurf=0.10, subsurf_col=(0.5, 0.58, 0.7))

    # --- path stone -------------------------------------------------------
    M['stone'] = new_mat("PathStone", base=(0.180, 0.190, 0.205), rough=0.62, spec=0.35)
    add_color_variation(M['stone'], (0.130, 0.140, 0.155), (0.235, 0.245, 0.260), 8.0)
    add_noise_bump(M['stone'], scale=48.0, detail=6.0, strength=0.20)

    # --- smoke / fog ------------------------------------------------------
    M['smoke'] = new_mat("Smoke", base=(0.780, 0.845, 0.955), rough=1.0,
                         alpha=0.21, emis=(0.520, 0.640, 0.860), emis_str=0.30)
    M['flake'] = new_mat("Snowflake", base=(0.960, 0.968, 1.000), rough=0.40,
                         emis=(0.760, 0.830, 0.955), emis_str=0.75)
    M['fog'] = bpy.data.materials.new("AtmoFog")
    M['fog'].use_nodes = True
    nt = M['fog'].node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    vol = nt.nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Color"].default_value = (0.62, 0.74, 0.95, 1.0)
    vol.inputs["Density"].default_value = 0.028
    vol.inputs["Anisotropy"].default_value = 0.35
    nt.links.new(vol.outputs["Volume"], out.inputs["Volume"])

    return M


# =============================================================================
#  TERRAIN FIELD  --  shared height function for the snow surface
# =============================================================================
# The yard layout is defined once, here, so that the snow, the footpath
# stones and the footprints all agree with each other.

YARD_PATH = [                       # swept footpath, cabin door -> plinth edge
    (0.055, -0.075),
    (0.045, -0.215),
    (0.010, -0.335),
    (-0.075, -0.445),
    (-0.205, -0.520),
    (-0.345, -0.552),
]

FOOTPRINT_SPINE = [                 # trail of footprints heading the other way
    (0.088, -0.090),
    (0.145, -0.180),
    (0.212, -0.268),
    (0.292, -0.344),
    (0.386, -0.398),
    (0.470, -0.430),
    (0.548, -0.446),
]

POND_CENTER = Vector((-0.395, -0.088))
POND_RX = 0.255
POND_RY = 0.185
POND_ROT = radians(24.0)
POND_DEPTH = 0.030


def pond_field(x, y):
    """Return (inside_amount, distance_outside) for the frozen pond ellipse."""
    c, s = cos(-POND_ROT), sin(-POND_ROT)
    dx = x - POND_CENTER.x
    dy = y - POND_CENTER.y
    u = (dx * c - dy * s) / POND_RX
    v = (dx * s + dy * c) / POND_RY
    r = hypot(u, v)
    # wobble the rim so it does not read as a perfect ellipse
    wob = 1.0 + 0.085 * fbm(x, y, 0.0, scale=6.5, octaves=3, seed=11.0)
    r = r / wob
    return r


def snow_height(x, y):
    """Snow surface elevation, relative to the plinth top (z = 0)."""
    d_in = -rr_sdf(x, y, BASE_W - SNOW_INSET, BASE_D - SNOW_INSET, BASE_R)

    # gentle rolling drifts
    h = 0.0125 + 0.0110 * fbm(x, y, 0.0, scale=2.45, octaves=4, seed=3.0)
    h += 0.0042 * fbm(x, y, 0.0, scale=7.30, octaves=3, seed=17.0)
    h += 0.0016 * fbm(x, y, 0.0, scale=19.0, octaves=2, seed=29.0)

    # deeper snow piled against the cabin walls and along the plinth rim
    near_rim = 1.0 - smoothstep(0.0, 0.115, d_in)
    h += 0.0185 * near_rim

    # drift bank pushed up on the windward (-Y) side of the cabin
    rel = Vector((x - CAB_POS.x, y - CAB_POS.y))
    if abs(rel.x) < 0.52 and -0.56 < rel.y < 0.10:
        band = smoothstep(-0.30, -0.26, rel.y) * (1.0 - smoothstep(-0.235, -0.185, rel.y))
        h += 0.020 * band * (1.0 - smoothstep(0.24, 0.32, abs(rel.x)))

    # subtract the swept footpath
    d_path = polyline_dist(x, y, YARD_PATH)
    h -= 0.026 * (1.0 - smoothstep(0.030, 0.088, d_path))

    # subtract the frozen pond
    r_pond = pond_field(x, y)
    h -= POND_DEPTH * (1.0 - smoothstep(0.92, 1.06, r_pond))
    # snow bank around the pond rim
    h += 0.011 * smoothstep(1.16, 1.00, r_pond) * smoothstep(0.94, 1.00, r_pond)

    # footprints dents
    for i, p in enumerate(FOOTPRINT_SPINE):
        off = 0.024 if (i % 2 == 0) else -0.024
        # perpendicular to the local heading
        if i < len(FOOTPRINT_SPINE) - 1:
            hd = Vector(FOOTPRINT_SPINE[i + 1]) - Vector(p)
        else:
            hd = Vector(p) - Vector(FOOTPRINT_SPINE[i - 1])
        if hd.length > 1e-6:
            hd.normalize()
        px, py = p[0] - hd.y * off, p[1] + hd.x * off
        d = hypot(x - px, y - py)
        h -= 0.0135 * (1.0 - smoothstep(0.016, 0.038, d))

    # fade to a flat rim at the very edge so the plinth silhouette stays clean
    h *= smoothstep(-0.004, 0.055, d_in)
    h += 0.0025 * smoothstep(-0.01, 0.02, d_in)
    return h


def snow_shade_at(x, y):
    """0 = lit snow, 1 = shadowed/compacted snow (for material blend)."""
    d_path = polyline_dist(x, y, YARD_PATH)
    r_pond = pond_field(x, y)
    v = 0.0
    v = max(v, 1.0 - smoothstep(0.035, 0.10, d_path))
    v = max(v, 1.0 - smoothstep(0.95, 1.10, r_pond))
    return v


def build_snow_field(res=190):
    """A dense grid clipped to the rounded-rect outline, displaced by noise."""
    W = BASE_W - SNOW_INSET
    D = BASE_D - SNOW_INSET
    R = BASE_R - SNOW_INSET * 0.35

    verts = []
    idx = [[0] * (res + 1) for _ in range(res + 1)]
    for j in range(res + 1):
        for i in range(res + 1):
            x = -W * 0.5 + W * i / res
            y = -D * 0.5 + D * j / res
            sd = rr_sdf(x, y, W, D, R)
            if sd > 0.0:
                # push stray corner verts back onto the boundary
                k = 1.0 / (sd / R + 1.0) if R > 0 else 0.0
                if sd > 1e-6:
                    hw = W * 0.5 - R
                    hd = D * 0.5 - R
                    qx = abs(x) - hw
                    qy = abs(y) - hd
                    if qx > 0 and qy > 0:
                        L = hypot(qx, qy)
                        sc = R / L
                        x = (hw + qx * sc) * (1 if x >= 0 else -1)
                        y = (hd + qy * sc) * (1 if y >= 0 else -1)
                    elif qx > 0:
                        x = (W * 0.5) * (1 if x >= 0 else -1)
                    else:
                        y = (D * 0.5) * (1 if y >= 0 else -1)
            z = snow_height(x, y)
            idx[j][i] = len(verts)
            verts.append((x, y, z))

    faces = []
    for j in range(res):
        for i in range(res):
            faces.append((idx[j][i], idx[j][i + 1], idx[j + 1][i + 1], idx[j + 1][i]))

    ob = obj_from_pydata("SnowField", verts, faces, MAT['snow'], smooth=False)

    # vertex-driven blend: compacted / shaded snow uses a second material slot
    me = ob.data
    me.materials.append(MAT['snow_shade'])
    for p in me.polygons:
        cx = sum(me.vertices[v].co.x for v in p.vertices) / len(p.vertices)
        cy = sum(me.vertices[v].co.y for v in p.vertices) / len(p.vertices)
        if snow_shade_at(cx, cy) > 0.45:
            p.material_index = 1
        p.use_smooth = True
    # keep the plinth rim crisp while the drifts stay soft
    mark_sharp_edges(ob, 40.0)
    return ob


def mark_sharp_edges(ob, angle=35.0):
    """Blender 4.1+ dropped mesh auto-smooth: smooth shading + explicit
    sharp edges is the supported way to keep creases crisp."""
    me = ob.data
    ef = {}
    for p in me.polygons:
        n = p.normal
        for ek in p.edge_keys:
            ef.setdefault(tuple(sorted(ek)), []).append(n)
    thr = math.cos(radians(angle))
    for e in me.edges:
        key = tuple(sorted((e.vertices[0], e.vertices[1])))
        normals = ef.get(key, [])
        if len(normals) == 2 and normals[0].dot(normals[1]) < thr:
            e.use_edge_sharp = True


# =============================================================================
#  DISPLAY PLINTH
# =============================================================================
def build_plinth():
    objs = []
    seg = 16
    outline = []
    hw = BASE_W * 0.5 - BASE_R
    hd = BASE_D * 0.5 - BASE_R
    for ax, ay, a0 in ((hw, hd, -pi / 2), (-hw, hd, 0.0), (-hw, -hd, pi / 2), (hw, -hd, pi)):
        for i in range(seg):
            a = a0 + (pi / 2) * i / seg
            outline.append((ax + BASE_R * cos(a), ay + BASE_R * sin(a)))

    n = len(outline)
    z_bot, z_top = -BASE_H, 0.0
    # slight taper so the block reads as a solid display base
    k_bot = 0.988
    verts = []
    for (x, y) in outline:
        verts.append((x, y, z_top))
    for (x, y) in outline:
        verts.append((x * k_bot, y * k_bot, z_bot))
    faces = []
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    faces.append(tuple(range(n)))                      # top cap
    faces.append(tuple(range(2 * n - 1, n - 1, -1)))   # bottom cap
    objs.append(obj_from_pydata("PlinthBody", verts, faces, MAT['plinth']))

    # a thin darker reveal line just under the top edge
    verts2, faces2 = [], []
    z0, z1 = 0.0, -0.022
    for (x, y) in outline:
        verts2.append((x * 0.9995, y * 0.9995, z1))
    for (x, y) in outline:
        verts2.append((x, y, z0))
    for i in range(n):
        j = (i + 1) % n
        faces2.append((i, j, n + j, n + i))
    faces2.append(tuple(range(n)))
    objs.append(obj_from_pydata("PlinthCap", verts2, faces2, MAT['plinth_top']))

    return objs


# =============================================================================
#  THE CABIN  --  "Frost-Fold"
# =============================================================================
def translate_objs(objs, offset):
    M = Matrix.Translation(Vector(offset))
    for ob in objs:
        ob.data.transform(M)
        ob.data.update()


def add_wood_bump(mat, bands=110.0, dist_scale=0.55, strength=0.28, rough_var=0.0):
    """Horizontal clapboard-like banding via a wave texture."""
    nt = mat.node_tree
    b = _bsdf(mat)
    coord = nt.nodes.new("ShaderNodeTexCoord")
    coord.location = (-1200, -320)
    wave = nt.nodes.new("ShaderNodeTexWave")
    wave.wave_type = 'BANDS'
    wave.bands_direction = 'Z'
    wave.inputs["Scale"].default_value = bands
    wave.inputs["Distortion"].default_value = 1.6
    wave.inputs["Detail"].default_value = 2.0
    wave.location = (-960, -320)
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 42.0
    noise.inputs["Detail"].default_value = 6.0
    noise.location = (-960, -560)
    mix = nt.nodes.new("ShaderNodeMixRGB")
    mix.blend_type = 'MIX'
    mix.inputs["Fac"].default_value = 0.35
    mix.location = (-720, -420)
    nt.links.new(coord.outputs["Object"], wave.inputs["Vector"])
    nt.links.new(coord.outputs["Object"], noise.inputs["Vector"])
    nt.links.new(wave.outputs["Fac"], mix.inputs["Color1"])
    nt.links.new(noise.outputs["Fac"], mix.inputs["Color2"])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = strength
    bump.inputs["Distance"].default_value = 0.012
    bump.location = (-460, -420)
    nt.links.new(mix.outputs["Color"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return mat


def snow_shell(name, pts, normal, offs, mat, base=0.0035):
    """A closed snow slab laid over a polygon: bottom = base offset,
    top = per-vertex offset (so drifts can thicken toward the ridge)."""
    n = Vector(normal).normalized()
    P = [Vector(p) for p in pts]
    bot = [p + n * base for p in P]
    top = [p + n * o for p, o in zip(P, offs)]
    verts = [tuple(v) for v in bot] + [tuple(v) for v in top]
    k = len(P)
    faces = [tuple(range(k, 2 * k)), tuple(range(k - 1, -1, -1))]
    for i in range(k):
        j = (i + 1) % k
        faces.append((i, j, k + j, k + i))
    return obj_from_pydata(name, verts, faces, mat, recalc=True)


def snow_slab_grid(name, corners, normal, thick_fn, mat, nu=7, nv=7,
                   amp=0.011, freq=7.5, seed=0.0, base=0.004, smooth=True):
    """A displaced, subdivided snow slab draped over a quad.
    `corners` in CCW order, `thick_fn(u, v) -> extra thickness`."""
    n = Vector(normal).normalized()
    P = [Vector(c) for c in corners]
    p00, p10, p11, p01 = P[0], P[1], P[2], P[3]

    def surf(u, v, extra):
        p = (p00 * (1 - u) * (1 - v) + p10 * u * (1 - v)
             + p11 * u * v + p01 * (1 - u) * v)
        return p + n * extra

    top = []
    bot = []
    for i in range(nu + 1):
        u = i / nu
        for j in range(nv + 1):
            v = j / nv
            fade = (smoothstep(0.0, 0.30, min(u, 1.0 - u))
                    * smoothstep(0.0, 0.30, min(v, 1.0 - v)))
            nz = amp * fbm(u * freq, v * freq, 0.0, scale=1.0, octaves=3,
                           seed=seed) * fade
            top.append(surf(u, v, base + thick_fn(u, v) + nz))
            bot.append(surf(u, v, 0.0008))

    verts = [tuple(p) for p in top] + [tuple(p) for p in bot]
    k = len(top)
    faces = []
    for i in range(nu):
        for j in range(nv):
            a = i * (nv + 1) + j
            b = (i + 1) * (nv + 1) + j
            faces.append((a, a + 1, b + 1, b))
    # bottom (reversed winding)
    for i in range(nu):
        for j in range(nv):
            a = i * (nv + 1) + j
            b = (i + 1) * (nv + 1) + j
            faces.append((k + b, k + b + 1, k + a + 1, k + a))
    # skirts
    for i in range(nu):
        a = i * (nv + 1)
        b = (i + 1) * (nv + 1)
        faces.append((a, b, k + b, k + a))
        a2 = i * (nv + 1) + nv
        b2 = (i + 1) * (nv + 1) + nv
        faces.append((b2, a2, k + a2, k + b2))
    for j in range(nv):
        a = j
        b = j + 1
        faces.append((b, a, k + a, k + b))
        a2 = nu * (nv + 1) + j
        b2 = nu * (nv + 1) + j + 1
        faces.append((a2, b2, k + b2, k + a2))
    return obj_from_pydata(name, verts, faces, mat, smooth=smooth, recalc=True)


def build_cabin():
    objs = []
    hw, hd, zt = CAB_HW, CAB_HD, WALL_TOP

    # ---------- plinth-like stone footing so the cabin sits into the snow ---
    fo = 0.014
    v = [(-hw - fo, -hd - fo, -0.010), (hw + fo, -hd - fo, -0.010),
         (hw + fo, hd + fo, -0.010), (-hw - fo, hd + fo, -0.010),
         (-hw, -hd, 0.040), (hw, -hd, 0.040), (hw, hd, 0.040), (-hw, hd, 0.040)]
    f = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 1, 5, 4), (1, 2, 6, 5),
         (2, 3, 7, 6), (3, 0, 4, 7)]
    objs.append(obj_from_pydata("CabinFooting", v, f, MAT['plinth'], recalc=True))

    # ---------- wall block -------------------------------------------------
    v = [(-hw, -hd, 0.030), (hw, -hd, 0.030), (hw, hd, 0.030), (-hw, hd, 0.030),
         (-hw, -hd, zt), (hw, -hd, zt), (hw, hd, zt), (-hw, hd, zt)]
    f = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5),
         (2, 3, 7, 6), (3, 0, 4, 7)]
    walls = obj_from_pydata("CabinWalls", v, f, MAT['wood'], recalc=True)
    objs.append(walls)

    # corner posts -- crisp vertical battens that sharpen the folded read
    for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        p0 = (sx * hw, sy * hd, 0.020)
        p1 = (sx * hw, sy * hd, zt + 0.006)
        o = beam_obj("CornerPost", p0, p1, 0.017, MAT['wood_dark'],
                     sides=4, rot=pi / 4)
        objs.append(o)

    # ---------- roof: asymmetric wedge -------------------------------------
    A = Vector((-hw, -hd, zt))          # front-left eave
    B = Vector((hw, -hd, zt))           # front-right eave
    C = Vector((hw, hd, zt))            # back-right eave
    D = Vector((-hw, hd, zt))           # back-left eave
    R0 = Vector((-hw, RIDGE_Y, RIDGE_Z_L))
    R1 = Vector((hw, RIDGE_Y, RIDGE_Z_R))

    rv = [tuple(A), tuple(B), tuple(C), tuple(D), tuple(R0), tuple(R1)]
    rf = [
        (0, 1, 5), (0, 5, 4),           # front slope
        (3, 4, 5), (3, 5, 2),           # back slope
        (4, 3, 0),                      # left gable
        (5, 1, 2),                      # right gable
        (0, 3, 2, 1),                   # underside
    ]
    objs.append(obj_from_pydata("CabinRoof", rv, rf, MAT['roof'], recalc=True))

    # ---------- the soaring glazed gable (+X) -------------------------------
    def shrink_tri(tri, k, x_plane):
        g = sum(tri, Vector()) / len(tri)
        out = []
        for p in tri:
            q = g + (p - g) * k
            out.append(Vector((x_plane, q.y, q.z)))
        return out

    gable_r = shrink_tri([R1, B, C], 0.80, hw + 0.006)
    objs.append(obj_from_pydata("GableGlassMain", gable_r,
                                [(0, 1, 2)], MAT['glass_warm']))
    # inner bright core, slightly smaller and pushed a touch further out
    core_r = shrink_tri([R1, B, C], 0.62, hw + 0.010)
    objs.append(obj_from_pydata("GableGlowCore", core_r,
                                [(0, 1, 2)], MAT['glass_warm_bright']))
    # mullions: a slim frame hugging the triangle's three edges
    for i in range(3):
        p0 = gable_r[i]
        p1 = gable_r[(i + 1) % 3]
        objs.append(beam_obj("GableMullion", p0, p1, 0.0125,
                             MAT['wood_dark'], sides=4))

    # ---------- smaller cool gable on the shadow side (-X) ------------------
    gable_l = shrink_tri([R0, D, A], 0.72, -hw - 0.006)
    objs.append(obj_from_pydata("GableGlassSide", gable_l,
                                [(0, 1, 2)], MAT['glass_cool']))
    for i in range(3):
        p0 = gable_l[i]
        p1 = gable_l[(i + 1) % 3]
        objs.append(beam_obj("GableMullionL", p0, p1, 0.0120,
                             MAT['wood_dark'], sides=4))

    # ---------- door + porch ------------------------------------------------
    dx0, dx1, dz1 = -0.158, -0.036, 0.178
    door_panel = [(dx0, -hd - 0.004, 0.030), (dx1, -hd - 0.004, 0.030),
                  (dx1, -hd - 0.004, dz1), (dx0, -hd - 0.004, dz1)]
    objs.append(obj_from_pydata("DoorPanel", door_panel, [(0, 1, 2, 3)],
                                MAT['wood_dark'], recalc=False))
    objs.append(obj_from_pydata("DoorPanelBack", door_panel[::-1],
                                [(0, 1, 2, 3)], MAT['wood_dark'], recalc=False))
    for p0, p1 in (((dx0, -hd - 0.006, 0.030), (dx0, -hd - 0.006, dz1)),
                   ((dx1, -hd - 0.006, 0.030), (dx1, -hd - 0.006, dz1)),
                   ((dx0, -hd - 0.006, 0.030), (dx1, -hd - 0.006, 0.030)),
                   ((dx0, -hd - 0.006, dz1), (dx1, -hd - 0.006, dz1))):
        objs.append(beam_obj("DoorFrame", p0, p1, 0.010, MAT['wood_light'],
                             sides=4, rot=pi / 4))
    # handle
    objs.append(beam_obj("DoorHandle", (dx1 - 0.020, -hd - 0.017, 0.108),
                         (dx1 - 0.020, -hd - 0.020, 0.108), 0.009,
                         MAT['metal_warm'], sides=8))

    # porch canopy
    py_out = -hd - 0.150
    pz_in, pz_out = 0.222, 0.192
    pc = [(-0.205, -hd - 0.004, pz_in), (0.012, -hd - 0.004, pz_in),
          (0.012, py_out, pz_out), (-0.205, py_out, pz_out)]
    objs.append(plate_obj("PorchCanopy", pc, (0.0, -0.28, 0.96), 0.014,
                          MAT['wood_light']))
    for px in (-0.190, -0.004):
        objs.append(beam_obj("PorchPost", (px, py_out + 0.014, -0.002),
                             (px, py_out + 0.014, pz_out + 0.012),
                             0.011, MAT['wood_dark'], sides=4, rot=pi / 4))
    objs.append(snow_shell("PorchSnow", pc, (0.0, -0.28, 0.96),
                           [0.008, 0.008, 0.010, 0.010], MAT['snow'], base=0.013))

    # threshold step
    st = [(-0.185, -hd - 0.092, 0.006), (-0.008, -hd - 0.092, 0.006),
          (-0.008, -hd - 0.004, 0.006), (-0.185, -hd - 0.004, 0.006)]
    objs.append(plate_obj("DoorStep", st, (0.0, 0.0, 1.0), 0.014, MAT['stone']))

    # ---------- windows -----------------------------------------------------
    # large front window (the warm eye of the facade)
    wx0, wx1, wz0, wz1 = 0.036, 0.196, 0.086, 0.216
    wp = [(wx0, -hd - 0.005, wz0), (wx1, -hd - 0.005, wz0),
          (wx1, -hd - 0.005, wz1), (wx0, -hd - 0.005, wz1)]
    objs.append(obj_from_pydata("FrontWindow", wp, [(0, 1, 2, 3)],
                                MAT['glass_warm'], recalc=False))
    objs.append(obj_from_pydata("FrontWindowBack", wp[::-1], [(0, 1, 2, 3)],
                                MAT['glass_warm'], recalc=False))
    for p0, p1 in (((wx0, -hd - 0.007, wz0), (wx1, -hd - 0.007, wz0)),
                   ((wx0, -hd - 0.007, wz1), (wx1, -hd - 0.007, wz1)),
                   ((wx0, -hd - 0.007, wz0), (wx0, -hd - 0.007, wz1)),
                   ((wx1, -hd - 0.007, wz0), (wx1, -hd - 0.007, wz1)),
                   ((wx0, -hd - 0.007, (wz0 + wz1) * 0.5),
                    (wx1, -hd - 0.007, (wz0 + wz1) * 0.5)),
                   ((( wx0 + wx1) * 0.5, -hd - 0.007, wz0),
                    ((wx0 + wx1) * 0.5, -hd - 0.007, wz1))):
        objs.append(beam_obj("WindowFrame", p0, p1, 0.0062,
                             MAT['wood_dark'], sides=4))

    # side window (-X wall)
    sy0, sy1, sz0, sz1 = -0.030, 0.076, 0.118, 0.198
    sp = [(-hw - 0.005, sy0, sz0), (-hw - 0.005, sy1, sz0),
          (-hw - 0.005, sy1, sz1), (-hw - 0.005, sy0, sz1)]
    objs.append(obj_from_pydata("SideWindow", sp, [(0, 1, 2, 3)],
                                MAT['glass_warm'], recalc=False))
    objs.append(obj_from_pydata("SideWindowBack", sp[::-1], [(0, 1, 2, 3)],
                                MAT['glass_warm'], recalc=False))
    for p0, p1 in (((-hw - 0.007, sy0, sz0), (-hw - 0.007, sy1, sz0)),
                   ((-hw - 0.007, sy0, sz1), (-hw - 0.007, sy1, sz1)),
                   ((-hw - 0.007, sy0, sz0), (-hw - 0.007, sy0, sz1)),
                   ((-hw - 0.007, sy1, sz0), (-hw - 0.007, sy1, sz1))):
        objs.append(beam_obj("WindowFrameS", p0, p1, 0.0060,
                             MAT['wood_dark'], sides=4))

    # ---------- chimney -----------------------------------------------------
    chx, chy = 0.150, 0.165
    objs.append(beam_obj("Chimney", (chx, chy, 0.180), (chx, chy, 0.638),
                         0.026, MAT['metal'], sides=4, rot=pi / 4))
    objs.append(beam_obj("ChimneyCap", (chx, chy, 0.638), (chx, chy, 0.662),
                         0.034, MAT['metal'], sides=4, rot=pi / 4))
    # snow cap on the chimney mouth
    objs.append(beam_obj("ChimneySnow", (chx, chy, 0.662), (chx, chy, 0.676),
                         0.030, MAT['snow'], sides=8))

    # ---------- roof snow ---------------------------------------------------
    n_front = (B - A).cross(R1 - B).normalized()
    if n_front.z < 0:
        n_front = -n_front

    def thick_front(u, v):      # v: 0 at the eave, 1 at the ridge
        return 0.009 + 0.021 * v

    objs.append(snow_slab_grid("RoofSnowFront", [A, B, R1, R0], n_front,
                               thick_front, MAT['snow'], nu=9, nv=9,
                               amp=0.011, freq=6.0, seed=2.0, base=0.004))

    n_back = (R1 - R0).cross(C - R1).normalized()
    if n_back.z < 0:
        n_back = -n_back

    def thick_back(u, v):       # v: 0 at the ridge, 1 at the eave
        return 0.009 + 0.021 * (1.0 - v)

    objs.append(snow_slab_grid("RoofSnowBack", [R0, R1, C, D], n_back,
                               thick_back, MAT['snow'], nu=9, nv=9,
                               amp=0.011, freq=6.0, seed=5.0, base=0.004))

    # ridge crest drift
    objs.append(beam_obj("RidgeSnow", R0 + n_front * 0.022,
                         R1 + n_front * 0.022, 0.020, MAT['snow'], sides=6))

    # eave icicle line -- short frozen drips under the front eave
    rnd = random.Random(7)
    x = -hw + 0.03
    while x < hw - 0.02:
        L = rnd.uniform(0.022, 0.062)
        objs.append(beam_obj("Icicle", (x, -hd - 0.012, zt - 0.004),
                             (x + rnd.uniform(-0.006, 0.006), -hd - 0.012, zt - 0.004 - L),
                             rnd.uniform(0.0045, 0.0080), MAT['ice'], sides=5,
                             taper=0.12))
        x += rnd.uniform(0.028, 0.055)

    translate_objs(objs, CAB_POS)
    return objs


# =============================================================================
#  YARD  --  path, pond, planting, props
# =============================================================================
def stone_slab(name, cx, cy, z, rx, ry, rot, mat, thickness=0.011,
               n=7, seed=0, wob=0.20):
    rnd = random.Random(seed)
    pts = []
    for i in range(n):
        a = 2.0 * pi * i / n + rot
        r = 1.0 + rnd.uniform(-wob, wob)
        pts.append((cx + rx * r * cos(a), cy + ry * r * sin(a), z))
    bot = [(x, y, z - thickness) for (x, y, z) in pts]
    verts = pts + bot
    faces = [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    return obj_from_pydata(name, verts, faces, mat, recalc=True)


def build_path_stones():
    objs = []
    rnd = random.Random(21)
    # walk the spine twice with an offset so slabs straddle the centre line
    pts = resample_path(YARD_PATH, 46)
    for k, p in enumerate(pts):
        if k % 2 == 1:
            continue
        # local heading -> lateral offset
        if k + 1 < len(pts):
            hd = (pts[k + 1] - p)
        else:
            hd = (p - pts[k - 1])
        if hd.length < 1e-9:
            continue
        hd.normalize()
        lat = Vector((-hd.y, hd.x))
        for side in (-1, 1):
            c = p + lat * (0.030 * side)
            z = snow_height(c.x, c.y) + 0.021
            objs.append(stone_slab("PathSlab", c.x, c.y, z,
                                   0.048 * rnd.uniform(0.85, 1.15),
                                   0.040 * rnd.uniform(0.85, 1.15),
                                   rnd.uniform(0, pi), MAT['stone'],
                                   thickness=0.014, n=7,
                                   seed=rnd.randint(0, 9999)))
    return objs


def build_pond():
    objs = []
    n = 72
    rim = []
    for i in range(n):
        a = 2.0 * pi * i / n
        u, v = cos(a), sin(a)
        w = 1.0 + 0.085 * fbm(POND_CENTER.x + POND_RX * u * cos(POND_ROT),
                              POND_CENTER.y + POND_RX * u * sin(POND_ROT),
                              0.0, scale=6.5, octaves=3, seed=11.0)
        ex = POND_RX * u * w
        ey = POND_RY * v * w
        x = POND_CENTER.x + ex * cos(POND_ROT) - ey * sin(POND_ROT)
        y = POND_CENTER.y + ex * sin(POND_ROT) + ey * cos(POND_ROT)
        rim.append((x, y))

    z_ice = snow_height(POND_CENTER.x, POND_CENTER.y) + 0.022
    # ice sheet (slightly domed so it catches a highlight)
    inner = []
    for (x, y) in rim:
        d = hypot(x - POND_CENTER.x, y - POND_CENTER.y)
        k = 1.0 - min(1.0, d / 0.42) * 0.35
        inner.append((x, y, z_ice + 0.004 * k))
    ctr = [(POND_CENTER.x, POND_CENTER.y, z_ice + 0.004)]
    verts = inner + ctr
    faces = []
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n))
    objs.append(obj_from_pydata("PondIce", verts, faces, MAT['ice'],
                                smooth=True))

    # rime collar around the rim
    rnd = random.Random(5)
    for i in range(0, n, 2):
        x, y = rim[i]
        x2, y2 = rim[(i + 1) % n]
        objs.append(beam_obj("IceRim", (x, y, z_ice - 0.012),
                             ((x + x2) * 0.5, (y + y2) * 0.5, z_ice + 0.008),
                             rnd.uniform(0.012, 0.020), MAT['ice_edge'],
                             sides=5))

    # frozen reeds poking through the ice
    for k in range(9):
        a = rnd.uniform(0, 2 * pi)
        r = rnd.uniform(0.35, 0.92)
        x = POND_CENTER.x + cos(a) * POND_RX * r
        y = POND_CENTER.y + sin(a) * POND_RY * r
        h = rnd.uniform(0.10, 0.23)
        tilt = Vector((rnd.uniform(-0.16, 0.16), rnd.uniform(-0.16, 0.16), 1.0))
        base = Vector((x, y, z_ice))
        objs.append(beam_obj("Reed", base, base + tilt.normalized() * h,
                             rnd.uniform(0.0026, 0.0040), MAT['twig'],
                             sides=4, taper=0.35))
        # frosted seed head
        objs.append(beam_obj("ReedHead", base + tilt.normalized() * (h - 0.020),
                             base + tilt.normalized() * (h + 0.006),
                             rnd.uniform(0.0060, 0.0090), MAT['snow'],
                             sides=5, taper=0.5))
    return objs


def dome(name, cx, cy, rx, ry, h, mat, rings=5, seg=13, seed=0.0, wob=0.28,
         z0=None, smooth=True):
    """A drifted snow mound sitting on the snow field."""
    base_z = snow_height(cx, cy) if z0 is None else z0
    verts = [(cx, cy, base_z + h)]
    for j in range(1, rings + 1):
        t = j / rings
        rad = sin(t * pi * 0.5)
        zz = cos(t * pi * 0.5)
        for i in range(seg):
            a = 2.0 * pi * i / seg
            rr = 1.0 + wob * fbm(cos(a) * 2.0, sin(a) * 2.0, t * 3.0,
                                 scale=1.6, octaves=2, seed=seed)
            x = cx + rx * rad * rr * cos(a)
            y = cy + ry * rad * rr * sin(a)
            z = (snow_height(x, y) if z0 is None else z0) + h * zz
            verts.append((x, y, z))
    faces = []
    for i in range(seg):
        faces.append((0, 1 + i, 1 + (i + 1) % seg))
    for j in range(rings - 1):
        a0 = 1 + j * seg
        a1 = 1 + (j + 1) * seg
        for i in range(seg):
            i2 = (i + 1) % seg
            faces.append((a0 + i, a0 + i2, a1 + i2, a1 + i))
    return obj_from_pydata(name, verts, faces, mat, smooth=smooth)


def cone_layer(name, cx, cy, z_base, z_tip, r_base, r_tip, n, mat,
               seed=0.0, wob=0.14):
    rnd = random.Random(int(seed * 977) + 13)
    verts = [(cx, cy, z_tip)]
    for i in range(n):
        a = 2.0 * pi * i / n
        rr = r_base * (1.0 + wob * rnd.uniform(-1.0, 1.0))
        verts.append((cx + rr * cos(a), cy + rr * sin(a), z_base))
    if r_tip > 1e-5:
        ring2 = []
        for i in range(n):
            a = 2.0 * pi * i / n
            rr = r_tip * (1.0 + wob * rnd.uniform(-1.0, 1.0))
            ring2.append((cx + rr * cos(a), cy + rr * sin(a), z_tip))
        verts = [(cx, cy, z_tip + 0.004)] + ring2 + verts[1:]
        verts.append((cx, cy, z_base - 0.004))
        base_i = 1 + n
        tip_i = 0
        cap_i = len(verts) - 1
        faces = []
        for i in range(n):
            i2 = (i + 1) % n
            faces.append((base_i + i, base_i + i2, tip_i))
            faces.append((cap_i, base_i + i2, base_i + i))
        return obj_from_pydata(name, verts, faces, mat, recalc=True)
    faces = []
    for i in range(n):
        i2 = (i + 1) % n
        faces.append((0, 1 + i, 1 + i2))
    faces.append(tuple(range(1 + n - 1, 0, -1)))
    return obj_from_pydata(name, verts, faces, mat, recalc=True)


def build_spruce(name, cx, cy, height, radius, seed=0.0, tiers=6):
    """A low-poly snow-laden spruce."""
    objs = []
    z0 = snow_height(cx, cy) - 0.015
    # trunk stub
    objs.append(beam_obj(name + "Trunk", (cx, cy, z0), (cx, cy, z0 + height * 0.22),
                         radius * 0.13, MAT['wood_dark'], sides=5))
    step = height * 0.60 / tiers
    for i in range(tiers):
        t = i / max(1, tiers - 1)
        zb = z0 + i * step
        zt = zb + height * 0.30
        r = radius * (1.0 - 0.80 * t ** 0.92)
        objs.append(cone_layer(name + "Needle", cx, cy, zb, zt, r, 0.0,
                               max(6, 9 - i // 2), MAT['pine'], seed=seed + i * 1.7))
        # snow load riding the upper part of the tier
        objs.append(cone_layer(name + "SnowCap", cx, cy,
                               zb + height * 0.170, zb + height * 0.255,
                               r * 0.975, r * 0.26, max(6, 9 - i // 2),
                               MAT['pine_snow'], seed=seed + i * 3.1, wob=0.11))
    # crown tip
    objs.append(cone_layer(name + "Tip", cx, cy, z0 + height * 0.72,
                           z0 + height + 0.012, radius * 0.22, 0.0, 6,
                           MAT['pine'], seed=seed + 9.9))
    objs.append(cone_layer(name + "TipSnow", cx, cy, z0 + height * 0.86,
                           z0 + height + 0.016, radius * 0.235, 0.0, 6,
                           MAT['pine_snow'], seed=seed + 11.2))
    return objs


def build_bare_tree(name, cx, cy, height, seed=0.0, spread=0.9):
    """A leafless birch, rime-frosted."""
    objs = []
    rnd = random.Random(int(seed * 331) + 7)
    z0 = snow_height(cx, cy) - 0.012
    trunk_top = Vector((cx, cy, z0 + height * 0.42))

    def grow(p0, direction, length, radius, depth):
        p1 = p0 + direction.normalized() * length
        mat = MAT['twig'] if depth >= 2 else MAT['frost_twig']
        objs.append(beam_obj(name + "Bark", p0, p1, radius, mat,
                             sides=5, taper=0.62))
        if depth <= 0:
            return
        for k in range(rnd.randint(2, 3)):
            az = rnd.uniform(0, 2 * pi)
            el = rnd.uniform(0.30, 0.95 - 0.15 * depth)
            d = Vector((cos(az) * cos(el), sin(az) * cos(el), sin(el)))
            d = (direction.normalized() * 0.42 + d * 0.85).normalized()
            grow(p1, d, length * rnd.uniform(0.52, 0.72),
                 radius * rnd.uniform(0.52, 0.68), depth - 1)

    grow(Vector((cx, cy, z0)), Vector((rnd.uniform(-0.09, 0.09),
                                       rnd.uniform(-0.09, 0.09), 1.0)),
         height * 0.44, height * 0.030 * spread, 2)
    return objs


def build_fence(x0, y0, x1, y1, seed=0.0, height=0.115):
    objs = []
    rnd = random.Random(int(seed * 71) + 3)
    a = Vector((x0, y0))
    b = Vector((x1, y1))
    L = (b - a).length
    cnt = max(3, int(L / 0.085))
    posts = []
    d = (b - a).normalized()
    for i in range(cnt + 1):
        p = a + d * (L * i / cnt)
        z = snow_height(p.x, p.y) - 0.04
        h = height * rnd.uniform(0.88, 1.12)
        top = (p.x + rnd.uniform(-0.008, 0.008), p.y + rnd.uniform(-0.008, 0.008),
               z + h + 0.05)
        objs.append(beam_obj("FencePost", (p.x, p.y, z), top,
                             0.011, MAT['wood_dark'], sides=4, rot=pi / 4))
        posts.append(Vector(top))
    for frac in (0.55, 0.85):
        for i in range(cnt):
            p0 = posts[i].lerp(posts[i + 1], 0.0)
            p1 = posts[i + 1]
            q0 = Vector((p0.x, p0.y, p0.z - height * (1.0 - frac)))
            q1 = Vector((p1.x, p1.y, p1.z - height * (1.0 - frac) + rnd.uniform(-0.012, 0.012)))
            objs.append(beam_obj("FenceRail", q0, q1, 0.0080,
                                 MAT['wood_dark'], sides=4, rot=pi / 6))
            objs.append(beam_obj("FenceRailSnow", q0 + Vector((0, 0, 0.007)),
                                 q1 + Vector((0, 0, 0.007)), 0.0062,
                                 MAT['snow'], sides=5))
    return objs


def build_lantern(cx, cy, height=0.42):
    objs = []
    z0 = snow_height(cx, cy) - 0.02
    objs.append(beam_obj("LanternPole", (cx, cy, z0), (cx, cy, z0 + height),
                         0.0125, MAT['metal_warm'], sides=6, taper=0.85))
    objs.append(beam_obj("LanternBase", (cx, cy, z0), (cx, cy, z0 + 0.038),
                         0.024, MAT['metal_warm'], sides=6))
    # lantern head: a small tapered cage
    hz = z0 + height
    objs.append(beam_obj("LanternRoof", (cx, cy, hz + 0.052), (cx, cy, hz + 0.074),
                         0.036, MAT['metal'], sides=6, taper=0.30))
    objs.append(beam_obj("LanternBody", (cx, cy, hz + 0.006), (cx, cy, hz + 0.052),
                         0.026, MAT['lamp'], sides=6, taper=0.80))
    for i in range(4):
        a = pi * 0.25 + i * pi * 0.5
        px = cx + 0.030 * cos(a)
        py = cy + 0.030 * sin(a)
        objs.append(beam_obj("LanternRib", (px, py, hz + 0.006),
                             (px * 0.0 + cx + 0.021 * cos(a),
                              cy + 0.021 * sin(a), hz + 0.056),
                             0.0035, MAT['metal'], sides=4))
    objs.append(beam_obj("LanternSnowCap", (cx, cy, hz + 0.074),
                         (cx, cy, hz + 0.086), 0.032, MAT['snow'], sides=8,
                         taper=0.55))
    return objs


def build_woodpile(cx, cy, seed=0.0):
    objs = []
    rnd = random.Random(int(seed * 37) + 5)
    z0 = snow_height(cx, cy) - 0.012
    rows = 4
    for r in range(rows):
        cnt = 7 - r
        for i in range(cnt):
            x = cx + (i - (cnt - 1) * 0.5) * 0.045
            y = cy + rnd.uniform(-0.006, 0.006)
            z = z0 + 0.022 + r * 0.042
            objs.append(beam_obj("Log", (x, y - 0.062, z), (x, y + 0.062, z),
                                 rnd.uniform(0.018, 0.023), MAT['wood_light'],
                                 sides=6, rot=rnd.uniform(0, pi)))
    objs.append(dome("WoodpileSnow", cx, cy, 0.185, 0.085, 0.055,
                     MAT['snow'], rings=6, seg=14, seed=seed + 2.0))
    return objs


def build_boulder(cx, cy, r, h, seed=0.0):
    objs = []
    rnd = random.Random(int(seed * 53) + 91)
    z0 = snow_height(cx, cy) - 0.02
    ts = [(0.0, 0.0), (0.5, 0.0), (1.0, 0.3), (0.75, 0.85), (0.25, 1.0),
          (-0.35, 0.7), (-0.55, 0.15)]
    verts = [(cx, cy, z0 + h)]
    for (u, v) in ts:
        verts.append((cx + u * r, cy + v * r, z0 + rnd.uniform(-0.01, 0.01)))
    faces = []
    n = len(ts)
    for i in range(n):
        j = (i + 1) % n
        faces.append((0, 1 + i, 1 + j))
    faces.append(tuple(range(1 + n - 1, 0, -1)))
    objs.append(obj_from_pydata("Boulder", verts, faces, MAT['stone'],
                                recalc=True))
    objs.append(dome("BoulderSnow", cx, cy + r * 0.10, r * 0.72, r * 0.60,
                     h * 0.42, MAT['snow'], rings=6, seg=12, seed=seed + 6.0,
                     z0=z0 + h * 0.42))
    return objs


def _sphere_geo(cx, cy, cz, r, seg=10, rings=6, wob=0.0, seed=0.0):
    verts = [(cx, cy, cz + r)]
    for j in range(1, rings):
        phi = pi * j / rings
        sp, cp = sin(phi), cos(phi)
        for i in range(seg):
            a = 2.0 * pi * i / seg
            rr = r * (1.0 + wob * fbm(cos(a), sin(a), j * 0.9,
                                      scale=1.4, octaves=2, seed=seed))
            verts.append((cx + rr * sp * cos(a), cy + rr * sp * sin(a), cz + rr * cp))
    verts.append((cx, cy, cz - r))
    faces = []
    n_bot = len(verts) - 1
    for i in range(seg):
        faces.append((0, 1 + i, 1 + (i + 1) % seg))
    for j in range(rings - 2):
        a0 = 1 + j * seg
        a1 = 1 + (j + 1) * seg
        for i in range(seg):
            i2 = (i + 1) % seg
            faces.append((a0 + i, a0 + i2, a1 + i2, a1 + i))
    a0 = 1 + (rings - 2) * seg
    for i in range(seg):
        faces.append((n_bot, a0 + (i + 1) % seg, a0 + i))
    return verts, faces


def build_smoke():
    """A plume of soft overlapping puffs rising from the chimney."""
    verts, faces = [], []
    base = Vector((CAB_POS.x + 0.150, CAB_POS.y + 0.165, 0.678))
    path_len = 0.78
    t = 0.0
    k = 0
    while t < 1.0 and k < 40:
        r = 0.042 + 0.150 * (t ** 1.70)
        z = base.z + t * 0.70
        x = base.x + 0.095 * (t ** 1.6) + 0.032 * sin(t * 5.1 + 0.6)
        y = base.y + 0.185 * (t ** 1.28)
        v, f = _sphere_geo(x, y, z, r, seg=11, rings=6, wob=0.44, seed=k * 1.9)
        off = len(verts)
        verts += v
        faces += [tuple(i + off for i in ff) for ff in f]
        t += max(0.040, 0.72 * r / path_len)
        k += 1
    ob = obj_from_pydata("ChimneySmoke", verts, faces, MAT['smoke'], smooth=True)
    return [ob]


def build_yard():
    objs = []
    objs += build_path_stones()
    objs += build_pond()

    # --- planting -----------------------------------------------------------
    spruces = [
        (-0.360, 0.560, 0.640, 0.170, 1.0),
        (-0.070, 0.660, 0.470, 0.132, 2.0),
        (0.470, 0.585, 0.720, 0.185, 3.0),
        (0.760, 0.150, 0.520, 0.142, 4.0),
        (-0.645, -0.400, 0.400, 0.116, 5.0),
        (0.700, -0.600, 0.300, 0.088, 6.0),
        (-0.470, 0.230, 0.300, 0.090, 7.0),
    ]
    for (x, y, h, r, sd) in spruces:
        objs += build_spruce("Spruce%d" % int(sd), x, y, h, r, seed=sd)

    birches = [
        (0.330, 0.640, 0.520, 1.0),
        (-0.185, 0.545, 0.440, 2.0),
        (0.600, 0.415, 0.470, 3.0),
        (-0.590, 0.030, 0.380, 4.0),
        (-0.105, -0.665, 0.400, 5.0),
    ]
    for (x, y, h, sd) in birches:
        objs += build_bare_tree("Birch%d" % int(sd), x, y, h, seed=sd)

    # --- shrubs (snow-buried blobs) ----------------------------------------
    rnd = random.Random(88)
    shrubs = [(-0.230, -0.640, 0.085), (0.145, -0.640, 0.072),
              (0.430, -0.640, 0.090), (-0.700, -0.180, 0.078),
              (0.690, -0.480, 0.082), (-0.115, 0.415, 0.070),
              (0.290, 0.455, 0.066), (-0.560, 0.400, 0.088)]
    for k, (x, y, r) in enumerate(shrubs):
        objs.append(dome("Shrub", x, y, r, r * 0.85, r * 0.72, MAT['snow'],
                         rings=6, seg=14, seed=k * 4.4))

    # --- boulders ----------------------------------------------------------
    for k, (x, y, r, h) in enumerate([(-0.290, 0.360, 0.075, 0.062),
                                      (0.560, 0.360, 0.058, 0.048),
                                      (-0.108, -0.470, 0.050, 0.042)]):
        objs += build_boulder(x, y, r, h, seed=k * 3.0)

    # --- drifts hugging the cabin ------------------------------------------
    objs.append(dome("DriftFront", CAB_POS.x + 0.310, CAB_POS.y - 0.325,
                     0.142, 0.098, 0.066, MAT['snow'], rings=6, seg=14, seed=1.0))
    objs.append(dome("DriftSide", CAB_POS.x - 0.335, CAB_POS.y + 0.075,
                     0.105, 0.205, 0.086, MAT['snow'], rings=6, seg=16, seed=2.0))
    objs.append(dome("DriftBack", CAB_POS.x + 0.045, CAB_POS.y + 0.375,
                     0.240, 0.115, 0.078, MAT['snow'], rings=6, seg=16, seed=3.0))

    # --- props -------------------------------------------------------------
    objs += build_fence(0.700, -0.470, 0.700, 0.330, seed=1.0)
    objs += build_fence(-0.700, -0.560, -0.395, -0.560, seed=2.0)
    objs += build_woodpile(0.470, 0.075, seed=1.0)
    objs += build_lantern(-0.062, -0.190, 0.415)
    objs += build_smoke()
    return objs


def build_snowfall(count=270, seed=1.0):
    """Sparse drifting flakes spread through the camera's air column."""
    rnd = random.Random(int(seed * 137) + 17)
    verts, faces = [], []
    for k in range(count):
        x = rnd.uniform(-1.15, 2.40)
        y = rnd.uniform(-2.90, 1.20)
        z = rnd.uniform(0.04, 2.05)
        r = rnd.uniform(0.0026, 0.0074)
        v, f = _sphere_geo(x, y, z, r, seg=6, rings=3)
        off = len(verts)
        verts += v
        faces += [tuple(i + off for i in ff) for ff in f]
    return [obj_from_pydata("Snowfall", verts, faces, MAT['flake'],
                            smooth=True, recalc=True)]


def build_atmosphere():
    """A finite volume of cold haze so the warm light can carve through it."""
    sx, sy, sz = 2.30, 2.30, 1.45
    cx, cy, cz = 0.45, -0.75, 0.95
    v = [(-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1),
         (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]
    verts = [(cx + a * sx, cy + b * sy, cz + c * sz) for (a, b, c) in v]
    faces = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 1, 5, 4),
             (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return [obj_from_pydata("AtmoFog", verts, faces, MAT['fog'], recalc=True)]


# =============================================================================
#  WORLD  --  blue-hour sky, warm at the horizon
# =============================================================================
def setup_world(strength=1.0):
    w = bpy.data.worlds.new("WinterDusk")
    bpy.context.scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()

    out = nt.nodes.new("ShaderNodeOutputWorld")
    out.location = (400, 0)
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.location = (200, 0)
    bg.inputs["Strength"].default_value = strength

    tc = nt.nodes.new("ShaderNodeNewGeometry")
    tc.location = (-800, 0)
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    sep.location = (-620, 0)
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.location = (-440, 0)
    mr.inputs["From Min"].default_value = -1.0
    mr.inputs["From Max"].default_value = 1.0
    mr.inputs["To Min"].default_value = 0.0
    mr.inputs["To Max"].default_value = 1.0

    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.location = (-180, 0)
    cr = ramp.color_ramp
    # Calibrated with sky_probe.py: the frame's visible band runs from about
    # 0.55 (top edge) to 0.80 (bottom edge) of this 0..1 ramp.
    stops = [
        (0.470, (0.048, 0.065, 0.165)),
        (0.555, (0.062, 0.090, 0.222)),  # top of frame: deep winter blue
        (0.615, (0.100, 0.120, 0.226)),
        (0.660, (0.150, 0.145, 0.228)),
        (0.700, (0.480, 0.255, 0.185)),  # violet -> amber transition
        (0.750, (0.900, 0.420, 0.150)),
        (0.810, (0.950, 0.455, 0.160)),  # warm afterglow, low in frame
        (1.000, (0.780, 0.365, 0.145)),
    ]
    cr.elements[0].position = stops[0][0]
    cr.elements[0].color = (*stops[0][1], 1.0)
    cr.elements[1].position = stops[-1][0]
    cr.elements[1].color = (*stops[-1][1], 1.0)
    for pos, col in stops[1:-1]:
        e = cr.elements.new(pos)
        e.color = (*col, 1.0)

    nt.links.new(tc.outputs["Incoming"], sep.inputs["Vector"])
    nt.links.new(sep.outputs["Z"], mr.inputs["Value"])
    nt.links.new(mr.outputs["Result"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    return w


# =============================================================================
#  LIGHTING
# =============================================================================
def add_sun(name, direction_to_light, color, energy, angle_deg=4.0):
    d = bpy.data.lights.new(name, 'SUN')
    d.color = color
    d.energy = energy
    d.angle = radians(angle_deg)
    ob = bpy.data.objects.new(name, d)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = Vector(direction_to_light) * 6.0
    v = -Vector(direction_to_light)
    ob.rotation_euler = v.to_track_quat('-Z', 'Y').to_euler()
    return ob


def add_area(name, loc, target, color, energy, size, shape='SQUARE',
             size_y=None):
    d = bpy.data.lights.new(name, 'AREA')
    d.color = color
    d.energy = energy
    d.shape = shape
    d.size = size
    if size_y is not None:
        d.size_y = size_y
    ob = bpy.data.objects.new(name, d)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = Vector(loc)
    v = Vector(target) - Vector(loc)
    ob.rotation_euler = v.to_track_quat('-Z', 'Y').to_euler()
    return ob


def add_point(name, loc, color, energy, radius=0.04):
    d = bpy.data.lights.new(name, 'POINT')
    d.color = color
    d.energy = energy
    d.shadow_soft_size = radius
    ob = bpy.data.objects.new(name, d)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = Vector(loc)
    return ob


def setup_lights():
    objs = []
    cx, cy = CAB_POS.x, CAB_POS.y

    # 1) last warm rays of the setting sun, grazing in from the west-north
    objs.append(add_sun("DuskSun", (-0.62, -0.70, 0.35),
                        (1.000, 0.400, 0.140), 1.18, 2.0))

    # 2) cold sky fill from above / behind
    objs.append(add_area("SkyFill", (0.35, 0.95, 2.30), (0.02, 0.02, 0.15),
                         (0.430, 0.620, 1.000), 56.0, 3.00))

    # 3) cold rim from behind, separates the roof from the sky
    objs.append(add_area("RimCold", (1.05, 1.75, 1.35), (0.10, 0.12, 0.34),
                         (0.400, 0.590, 1.000), 44.0, 1.60))

    # 4) warm light spilling out of every opening
    objs.append(add_point("GlowFrontWin", (cx + 0.116, cy - 0.290, 0.150),
                          (1.0, 0.470, 0.160), 6.2, 0.085))
    objs.append(add_point("GlowGable", (cx + 0.285, cy - 0.035, 0.352),
                          (1.0, 0.480, 0.170), 12.5, 0.150))
    objs.append(add_point("GlowSideWin", (cx - 0.278, cy + 0.023, 0.158),
                          (1.0, 0.490, 0.180), 2.9, 0.065))
    objs.append(add_point("GlowDoor", (cx - 0.097, cy - 0.300, 0.115),
                          (1.0, 0.440, 0.150), 2.1, 0.055))

    # 5) the yard lantern
    objs.append(add_point("LanternLight", (-0.062, -0.190, 0.478),
                          (1.0, 0.545, 0.220), 19.0, 0.055))

    # 6) a soft warm wash bouncing off the cabin, so the snow reads warm near it
    objs.append(add_area("WarmSpill", (cx + 0.170, cy - 0.520, 0.240),
                         (cx + 0.100, cy - 0.120, 0.030),
                         (1.000, 0.530, 0.210), 20.0, 0.70))
    return objs


# =============================================================================
#  CAMERA
# =============================================================================
def setup_camera():
    cam_data = bpy.data.cameras.new("DioramaCam")
    cam_data.lens = 55.0
    cam_data.sensor_width = 36.0
    cam = bpy.data.objects.new("DioramaCam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam

    target = Vector((0.045, 0.010, 0.285))
    dist = 3.02
    elev = radians(22.5)
    az = radians(34.0)
    horiz = dist * cos(elev)
    loc = Vector((target.x + horiz * sin(az),
                  target.y - horiz * cos(az),
                  target.z + dist * sin(elev)))
    cam.location = loc
    cam.rotation_euler = (target - loc).to_track_quat('-Z', 'Y').to_euler()

    # a whisper of depth of field to reinforce the miniature feel
    cam_data.dof.use_dof = True
    cam_data.dof.focus_object = bpy.data.objects.get("CabinWalls")
    if cam_data.dof.focus_object is None:
        cam_data.dof.focus_distance = dist
    else:
        cam_data.dof.focus_distance = (target - loc).length
    cam_data.dof.aperture_fstop = 6.3
    return cam


# =============================================================================
#  RENDER SETTINGS
# =============================================================================
def setup_render(width=1920, height=1440, samples=192):
    sc = bpy.context.scene
    sc.render.resolution_x = width
    sc.render.resolution_y = height
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'
    sc.render.image_settings.color_depth = '8'
    sc.render.film_transparent = False

    try:
        sc.view_settings.view_transform = 'AgX'
    except Exception:
        sc.view_settings.view_transform = 'Filmic'
    sc.view_settings.exposure = -0.06
    sc.view_settings.gamma = 1.0

    if ENGINE.startswith("cycles"):
        sc.render.engine = 'CYCLES'
        sc.cycles.device = 'CPU'
        sc.cycles.samples = samples
        sc.cycles.use_denoising = True
        sc.cycles.max_bounces = 6
        sc.cycles.transmission_bounces = 6
        sc.cycles.transparent_max_bounces = 6
        sc.cycles.caustics_reflective = False
        sc.cycles.caustics_refractive = False
    else:
        sc.render.engine = 'BLENDER_EEVEE'
        ee = sc.eevee
        ee.taa_render_samples = max(32, min(samples, 512))
        try:
            ee.use_raytracing = True
            ee.ray_tracing_method = 'RAYTRACE'
        except Exception:
            pass
        try:
            ee.use_shadows = True
            ee.shadow_ray_count = 1
            ee.shadow_step_count = 6
        except Exception:
            pass
        try:
            ee.use_fast_gi = True
            ee.fast_gi_method = 'AMBIENT_OCCLUSION_ONLY'
        except Exception:
            pass
        try:
            ee.use_volumetric_shadows = True
        except Exception:
            pass
        try:
            ee.volumetric_start = 0.15
            ee.volumetric_end = 6.5
            ee.volumetric_samples = 48
        except Exception:
            pass
    return sc


# =============================================================================
#  COMPOSITOR  --  warm bloom around the emissive openings
# =============================================================================
def setup_compositor(threshold=6.00, strength=0.14, size=6, tint=(1.0, 0.76, 0.50)):
    sc = bpy.context.scene
    sc.use_nodes = True
    ng = bpy.data.node_groups.new("DioramaComp", "CompositorNodeTree")
    ng.interface.new_socket("Image", in_out='INPUT', socket_type='NodeSocketColor')
    ng.interface.new_socket("Image", in_out='OUTPUT', socket_type='NodeSocketColor')

    rl = ng.nodes.new("CompositorNodeRLayers")
    rl.location = (-400, 0)
    gl = ng.nodes.new("CompositorNodeGlare")
    gl.location = (-120, 0)
    go = ng.nodes.new("NodeGroupOutput")
    go.location = (220, 0)
    ng.nodes.new("NodeGroupInput").location = (-640, 0)

    # Blender 5.x exposes every glare setting as an input socket
    for t in ("BLOOM", "Bloom", "FOG_GLOW", "Fog Glow"):
        try:
            gl.inputs["Type"].default_value = t
            break
        except Exception:
            continue
    for q in ("HIGH", "High", "MEDIUM"):
        try:
            gl.inputs["Quality"].default_value = q
            break
        except Exception:
            continue
    for key, val in (("Threshold", threshold), ("Strength", strength),
                     ("Size", size), ("Smoothness", 0.15), ("Saturation", 1.0),
                     ("Tint", (*tint, 1.0))):
        try:
            gl.inputs[key].default_value = val
        except Exception:
            pass

    ng.links.new(rl.outputs["Image"], gl.inputs["Image"])
    ng.links.new(gl.outputs["Image"], go.inputs[0])
    sc.compositing_node_group = ng
    return ng


# =============================================================================
#  MAIN
# =============================================================================
# Small decorative pieces that never read as shadow casters at diorama scale.
# Dropping them keeps EEVEE's fixed shadow pool from overflowing (the scene
# has 400+ objects and the pool caps out at 2048 tiles).
NO_SHADOW = {
    "Icicle", "RidgeSnow", "GableMullion", "WindowFrame", "WindowFrameS",
    "DoorFrame", "CornerPost", "ReedHead", "FenceRailSnow", "ChimneySnow",
    "ChimneyCap", "DoorHandle", "LanternRib",
}


def trim_shadow_casters():
    n = 0
    for ob in bpy.context.scene.objects:
        if ob.type == 'MESH' and ob.name.split(".")[0] in NO_SHADOW:
            ob.visible_shadow = False
            n += 1
    return n

def main():
    clear_scene()
    build_materials()

    objs = []
    objs += build_plinth()
    objs.append(build_snow_field(res=190))
    objs += build_cabin()
    objs += build_yard()
    objs += build_snowfall()
    objs += build_atmosphere()
    setup_world(strength=1.0)
    setup_lights()
    setup_camera()
    n_trim = trim_shadow_casters()
    sc = setup_render(samples=200 if ENGINE.startswith("cycles") else 192)
    if USE_BLOOM:
        try:
            setup_compositor()
        except Exception as e:
            print("compositor skipped:", e)

    tri = 0
    for ob in bpy.context.scene.objects:
        if ob.type == 'MESH':
            tri += len(ob.data.polygons)
    print("SCENE OBJECTS: %d   FACES: %d   SHADOW_CASTERS_TRIMMED: %d"
          % (len(bpy.context.scene.objects), tri, n_trim))

    suffix = "cycles" if ENGINE.startswith("cycles") else "eevee"
    out_png = os.path.join(RENDER_DIR, "diorama_winter_%s_%s.png" % (TAG, suffix))
    sc.render.filepath = out_png
    bpy.ops.render.render(write_still=True)
    print("RENDERED -> %s" % out_png)

    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    print("SAVED -> %s" % BLEND_PATH)


main()



