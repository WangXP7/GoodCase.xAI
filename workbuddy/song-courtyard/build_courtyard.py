# -*- coding: utf-8 -*-
"""
===============================================================================
 SONG DYNASTY CHINESE COURTYARD  --  "SONG TING"  (宋代中式庭院)
===============================================================================
 100% procedural bpy build.  No external models, textures, HDRIs or addons.

 SOURCE DESIGN CONTRACT  (from the referenced article's Song-style system)
   Layout  : south gate - N/S axis - central hall - west water court -
             east academy - north back garden - perimeter wall - corridors
   Style   : grey clay-tile roofs, restrained upturn, deep eaves,
             dark natural timber frames, stable bay rhythm,
             warm white lime walls, blue-grey stone paving,
             pine / bamboo / scholar rocks / still water / misty mountains
   Excluded: imperial red+gold, ornate Ming-Qing motifs, Japanese shrine
             markers, fantasy roofs, theme-park pastiche

 ARCHITECTURAL FEATURES MODELLED (Song *Yingzao Fashi* vocabulary)
   tai ji (podium) + ta duo (stepped stair with xiang yan)
   suo zhu (entasis column) + ce jiao (inward lean) + sheng qi (rising eave)
   fu pen zhu chu (inverted-basin stone column base)
   lan e (architrave) + pu pai fang (flat plate)
   dou gong: lu dou / hua gong / xia ang / ni dao gong / gua zi gong /
             ling gong / jiao hu dou / san dou / shua tou / liao yan fang
   ju zhe (concave roof curve) + yi jiao qi qiao (upturned flying corners)
   xuan shan / wu dian / xie shan roof forms (one parametric surface engine)
   tong wa long (barrel-tile ridges) + zheng ji / chui ji / qiang ji
   bo feng ban (barge board) + xuan yu (hanging-fish ornament) + chi wei
   zhi ling chuang (vertical-bar window) + ge zi men (lattice door)
   lan jian gou chuang (railing-and-hook window) + xun zhang railing
   lian lang (covered corridors) + lang qiao (covered bridge)
   zan jian ding pavilion (pyramidal roof) + tai hu rocks + pine + bamboo

 RENDER
   engine : EEVEE  (BLENDER_EEVEE in Blender 5.x)
   output : render/song_courtyard_<tag>.png      blend: ChineseCourtyard.blend

 USAGE
   blender -b --factory-startup --python build_courtyard.py -- <tag> <res>
===============================================================================
"""

import bpy
import bmesh
import math
import os
import sys
import random
from math import radians, degrees, sin, cos, tan, pi, sqrt, atan2, hypot
from mathutils import Vector, Euler, Matrix, Quaternion

# -----------------------------------------------------------------------------
# PATHS / CLI
# -----------------------------------------------------------------------------
try:
    HERE = os.path.dirname(os.path.abspath(__file__))
except NameError:
    HERE = os.getcwd()

ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
TAG = ARGV[0] if len(ARGV) > 0 else "v1"
RES = int(ARGV[1]) if len(ARGV) > 1 else 1600

RENDER_DIR = os.path.join(HERE, "render")
BLEND_PATH = os.path.join(HERE, "ChineseCourtyard.blend")
os.makedirs(RENDER_DIR, exist_ok=True)

RNG = random.Random(20260802)

# =============================================================================
#  GLOBAL SITE DIMENSIONS  (metres)
# =============================================================================
CX = 34.5           # compound half-width  (X : +east / -west)
CY = 37.0           # compound half-depth  (Y : +north / -south)
WALL_T = 0.90       # perimeter wall thickness
WALL_H = 4.00       # perimeter wall height (to the tiling course)

# ---- south gate (shan men) ---------------------------------------------------
GATE_CY = -36.0
GATE_HW = 6.50      # half 面阔
GATE_HD = 3.75      # half 进深
GATE_BAY_X = [-6.50, -3.00, 3.00, 6.50]
GATE_BAY_Y = [-3.75, 0.00, 3.75]
GATE_COL_H = 4.30
GATE_POD = 0.85     # podium height

# ---- central hall (da dian) --------------------------------------------------
HALL_CY = -7.0
HALL_HW = 11.60     # half 面阔 (5 bays : 4.0 4.8 5.6 4.8 4.0)
HALL_HD = 6.40      # half 进深 (2 bays)
HALL_BAY_X = [-11.60, -7.60, -2.80, 2.80, 7.60, 11.60]
HALL_BAY_Y = [-6.40, 0.00, 6.40]
HALL_COL_H = 5.20
HALL_POD = 1.30     # podium height
HALL_EAVE_OUT = 2.05    # eave overhang beyond the column line
HALL_JUTOU_D = 5.60     # yue tai (front terrace) depth
HALL_JUTOU_HW = 7.20

# ---- east academy (shu yuan) -------------------------------------------------
ACAD_CX = 26.2
ACAD_CY = -3.0
ACAD_HW = 4.60
ACAD_HD = 3.40
ACAD_COL_H = 4.10
ACAD_BAY_X = [-4.60, -1.50, 1.50, 4.60]
ACAD_BAY_Y = [-3.40, 0.00, 3.40]

# ---- west water court (shui yuan) -------------------------------------------
POND_CX = -25.5
POND_CY = -2.0
POND_HW = 5.80
POND_HD = 8.40
POND_Z = -0.55           # still water level (recessed)

# ---- waterside tea pavilion (cha ting) ---------------------------------------
TEA_CX = -22.50
TEA_CY = 9.60
TEA_HW = 2.35
TEA_COL_H = 3.35
TEA_POD = 0.55

# ---- roof / column module ----------------------------------------------------
COL_D = 0.58             # column diameter (Song: ~42 fen)
EAVE_BOARD_T = 0.24      # fascia depth at the eave
RAFT_SPACING = 0.44      # rafter (chuan) spacing

# =============================================================================
#  SMALL MATH HELPERS
# =============================================================================
def clamp(x, a=0.0, b=1.0):
    return a if x < a else (b if x > b else x)


def lerp(a, b, t):
    return a + (b - a) * t


def smoothstep(t):
    t = clamp(t)
    return t * t * (3.0 - 2.0 * t)


def vlerp(a, b, t):
    return Vector(a) + (Vector(b) - Vector(a)) * t


def nrm(v):
    v = Vector(v)
    L = v.length
    return v if L < 1e-12 else v / L


def V3(p, z=0.0):
    """accept 2-tuples / 3-tuples / Vectors and always return a 3D Vector"""
    v = Vector(p)
    return v if len(v) == 3 else Vector((v[0], v[1], z))


# =============================================================================
#  MESH BUILDER
#  Accumulates loose polygonal geometry with per-face material slots, then
#  emits a single Blender object.  Winding is fixed afterwards by recalc.
# =============================================================================
class MB(object):
    __slots__ = ("verts", "faces", "fmats", "mats", "_lookup")

    def __init__(self):
        self.verts = []
        self.faces = []
        self.fmats = []
        self.mats = []
        self._lookup = {}

    # ---- material slots ----
    def slot(self, mat):
        if mat is None:
            return 0
        key = mat.name
        i = self._lookup.get(key)
        if i is None:
            self.mats.append(mat)
            i = len(self.mats) - 1
            self._lookup[key] = i
        return i

    # ---- vertices ----
    def v(self, p):
        self.verts.append((float(p[0]), float(p[1]), float(p[2])))
        return len(self.verts) - 1

    def vs(self, pts):
        return [self.v(p) for p in pts]

    # ---- faces ----
    def face(self, idx, mat=None):
        if len(idx) < 3:
            return
        self.faces.append(tuple(idx))
        self.fmats.append(self.slot(mat))

    def tri(self, a, b, c, mat=None):
        self.face((a, b, c), mat)

    def quad(self, a, b, c, d, mat=None):
        self.face((a, b, c, d), mat)

    # ---- convenience solids ----
    def box(self, x0, x1, y0, y1, z0, z1, mat=None, mat_top=None):
        """Axis aligned box. Skips degenerate axes gracefully."""
        if x1 < x0:
            x0, x1 = x1, x0
        if y1 < y0:
            y0, y1 = y1, y0
        if z1 < z0:
            z0, z1 = z1, z0
        p = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
             (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
        i = self.vs(p)
        mt = mat_top if mat_top is not None else mat
        self.quad(i[0], i[3], i[2], i[1], mat)          # bottom
        self.quad(i[4], i[5], i[6], i[7], mt)           # top
        self.quad(i[0], i[1], i[5], i[4], mat)
        self.quad(i[1], i[2], i[6], i[5], mat)
        self.quad(i[2], i[3], i[7], i[6], mat)
        self.quad(i[3], i[0], i[4], i[7], mat)
        return i

    def obox(self, center, half, mat=None, rot=None, mat_top=None):
        """Oriented box: center Vector, half Vector(hx,hy,hz), rot = Matrix 3x3."""
        c = Vector(center)
        h = Vector(half)
        corners = []
        for sz in (-1, 1):
            for sy in (-1, 1):
                for sx in (-1, 1):
                    o = Vector((sx * h.x, sy * h.y, sz * h.z))
                    if rot is not None:
                        o = rot @ o
                    corners.append(c + o)
        # order: [---, +--, -+-, ++-, --+, +-+, -++, +++]
        p = corners
        i = self.vs(p)
        self.quad(i[0], i[1], i[3], i[2], mat)
        self.quad(i[4], i[6], i[7], i[5], mat_top if mat_top is not None else mat)
        self.quad(i[0], i[4], i[5], i[1], mat)
        self.quad(i[1], i[5], i[7], i[3], mat)
        self.quad(i[3], i[7], i[6], i[2], mat)
        self.quad(i[2], i[6], i[4], i[0], mat)
        return i

    def frustum(self, x0, x1, y0, y1, z0, z1, sx=1.0, sy=1.0, mat=None,
                mat_top=None, ox=0.0, oy=0.0):
        """Box whose top face is scaled by sx, sy about its centre (+ optional
        offset).  Used for dou (bracket blocks), pedestals, pagoda bodies."""
        cx = (x0 + x1) * 0.5
        cy = (y0 + y1) * 0.5
        hx = (x1 - x0) * 0.5
        hy = (y1 - y0) * 0.5
        a = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0)]
        b = [(cx + ox + (-hx * sx), cy + oy + (-hy * sy), z1),
             (cx + ox + (hx * sx), cy + oy + (-hy * sy), z1),
             (cx + ox + (hx * sx), cy + oy + (hy * sy), z1),
             (cx + ox + (-hx * sx), cy + oy + (hy * sy), z1)]
        i = self.vs(a + b)
        self.quad(i[0], i[3], i[2], i[1], mat)
        self.quad(i[4], i[5], i[6], i[7], mat_top if mat_top is not None
                  else mat)
        for k in range(4):
            k2 = (k + 1) % 4
            self.quad(i[k], i[k2], i[4 + k2], i[4 + k], mat)
        return i

    def cyl(self, cx, cy, z0, z1, r0, r1=None, seg=16, mat=None,
            mat_top=None, mat_bot=None, phase=0.0, sx=1.0, sy=1.0,
            cap_top=True, cap_bot=True):
        if r1 is None:
            r1 = r0
        ring0, ring1 = [], []
        for k in range(seg):
            a = phase + 2.0 * pi * k / seg
            ring0.append((cx + cos(a) * r0 * sx, cy + sin(a) * r0 * sy, z0))
            ring1.append((cx + cos(a) * r1 * sx, cy + sin(a) * r1 * sy, z1))
        i0 = self.vs(ring0)
        i1 = self.vs(ring1)
        for k in range(seg):
            k2 = (k + 1) % seg
            self.quad(i0[k], i0[k2], i1[k2], i1[k], mat)
        if cap_top:
            self.face(tuple(i1), mat_top if mat_top is not None else mat)
        if cap_bot:
            self.face(tuple(reversed(i0)), mat_bot if mat_bot is not None else mat)
        return i0, i1

    # ---- surfaces ----
    def grid(self, rows, mat=None, close_u=False, flip=False):
        """rows: list of equal-length index rows (v direction). Quads between."""
        nv = len(rows)
        nu = len(rows[0])
        m = nu if close_u else nu - 1
        for j in range(nv - 1):
            r0, r1 = rows[j], rows[j + 1]
            for i in range(m):
                i2 = (i + 1) % nu
                a, b, c, d = r0[i], r0[i2], r1[i2], r1[i]
                if flip:
                    a, b, c, d = d, c, b, a
                self.quad(a, b, c, d, mat)

    def loft(self, rings, mat=None, close_ring=True, cap_start=False,
             cap_end=False, flip=False):
        """rings: list of index rings (equal length)."""
        idx = self.vs_rings(rings)
        n = len(idx)
        for j in range(n - 1):
            r0, r1 = idx[j], idx[j + 1]
            seg = len(r0)
            m = seg if close_ring else seg - 1
            for k in range(m):
                k2 = (k + 1) % seg
                a, b, c, d = r0[k], r0[k2], r1[k2], r1[k]
                if flip:
                    a, b, c, d = d, c, b, a
                self.quad(a, b, c, d, mat)
        if cap_start:
            self.face(tuple(reversed(idx[0])), mat)
        if cap_end:
            self.face(tuple(idx[-1]), mat)
        return idx

    def vs_rings(self, rings):
        out = []
        for r in rings:
            if r and isinstance(r[0], (int,)) and not isinstance(r[0], (tuple, list, Vector)):
                out.append(list(r))
            else:
                out.append(self.vs(r))
        return out

    def strip(self, path_a, path_b, mat=None, close=False, flip=False):
        """Two equal-length point paths -> quad strip."""
        ia = self.vs(path_a)
        ib = self.vs(path_b)
        n = len(ia)
        lim = n if close else n - 1
        for k in range(lim):
            k2 = (k + 1) % n
            a, b, c, d = ia[k], ia[k2], ib[k2], ib[k]
            if flip:
                a, b, c, d = d, c, b, a
            self.quad(a, b, c, d, mat)
        return ia, ib

    # ---- emit ----
    def build(self, name, smooth=False, recalc=True, smooth_angle=38.0,
              collection=None):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.verts, [], self.faces)
        me.validate(verbose=False)
        me.update()
        for m in self.mats:
            me.materials.append(m)
        for p, mi in zip(me.polygons, self.fmats):
            p.material_index = mi
        ob = bpy.data.objects.new(name, me)
        (collection or bpy.context.scene.collection).objects.link(ob)
        if recalc:
            bm = bmesh.new()
            bm.from_mesh(me)
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            bm.to_mesh(me)
            bm.free()
        if smooth:
            ang = radians(smooth_angle)
            for p in me.polygons:
                p.use_smooth = True
            me.calc_normals_split() if hasattr(me, "calc_normals_split") else None
            # mark sharp edges beyond the angle so roofs keep crisp ridges
            for e in me.edges:
                e.use_edge_sharp = False
            mod = ob.modifiers.new("Smooth", 'EDGE_SPLIT')
            mod.split_angle = ang
        me.update()
        return ob


def clear_scene():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for blk in (bpy.data.meshes, bpy.data.materials, bpy.data.lights,
                bpy.data.cameras, bpy.data.worlds, bpy.data.curves,
                bpy.data.images):
        for it in list(blk):
            try:
                blk.remove(it)
            except Exception:
                pass


def join_objs(objs, name):
    objs = [o for o in objs if o is not None]
    if not objs:
        return None
    if len(objs) == 1:
        objs[0].name = name
        return objs[0]
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    return ob


# =============================================================================
#  PROCEDURAL MATERIALS
#  Every material is a pure node network - no image textures, no UV maps.
#  Object coordinates are used for projection (object origin == world origin,
#  so patterns stay in real-world metres and read continuously across the
#  whole compound).
# =============================================================================
PRINCIPLED_ALIASES = {
    "specular": ("Specular IOR Level", "Specular"),
    "transmission": ("Transmission Weight", "Transmission"),
    "emission_color": ("Emission Color", "Emission"),
    "emission_strength": ("Emission Strength",),
    "sheen": ("Sheen Weight", "Sheen"),
    "coat": ("Coat Weight", "Clearcoat"),
    "subsurface": ("Subsurface Weight", "Subsurface"),
    "sss_radius": ("Subsurface Radius",),
    "diffuse_rough": ("Diffuse Roughness",),
}


def pset(node, key, value):
    for n in PRINCIPLED_ALIASES.get(key, (key,)):
        if n in node.inputs:
            try:
                node.inputs[n].default_value = value
                return True
            except Exception:
                pass
    return False


def _mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (900, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (620, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m, nt, bsdf


def _coords(nt, scale=1.0, rot=None, x=-1150, y=0):
    """Object-space coordinates, optionally scaled / rotated (world metres)."""
    tc = nt.nodes.new("ShaderNodeTexCoord")
    tc.location = (x, y)
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.location = (x + 190, y)
    s = scale if isinstance(scale, (tuple, list)) else (scale, scale, scale)
    mp.inputs["Scale"].default_value = s
    if rot:
        mp.inputs["Rotation"].default_value = rot
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    return mp.outputs["Vector"]


def _noise(nt, src, scale=8.0, detail=8.0, rough=0.55, distortion=0.0,
           loc=(-880, 0)):
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.location = loc
    n.inputs["Scale"].default_value = scale
    n.inputs["Detail"].default_value = detail
    n.inputs["Roughness"].default_value = rough
    if "Distortion" in n.inputs:
        n.inputs["Distortion"].default_value = distortion
    nt.links.new(src, n.inputs["Vector"])
    return n


def _c4(c):
    """normalise a colour literal to a 4-component RGBA tuple"""
    c = tuple(c)
    if len(c) == 1:
        return (c[0], c[0], c[0], 1.0)
    if len(c) == 2:
        return (c[0], c[0], c[0], c[1])
    if len(c) == 3:
        return c + (1.0,)
    return c


def _ramp(nt, src_socket, stops, loc=(-660, 0), interp='LINEAR'):
    r = nt.nodes.new("ShaderNodeValToRGB")
    r.location = loc
    r.color_ramp.interpolation = interp
    els = r.color_ramp.elements
    while len(els) > 1:
        els.remove(els[-1])
    els[0].position = stops[0][0]
    els[0].color = _c4(stops[0][1])
    for pos, col in stops[1:]:
        e = els.new(pos)
        e.color = _c4(col)
    nt.links.new(src_socket, r.inputs["Fac"])
    return r


def _mix(nt, fac_socket, a_socket, b_socket, loc=(-300, 0), blend='MIX'):
    m = nt.nodes.new("ShaderNodeMix")
    m.data_type = 'RGBA'
    m.blend_type = blend
    m.location = loc
    if isinstance(a_socket, tuple):
        m.inputs[6].default_value = _c4(a_socket)
    else:
        nt.links.new(a_socket, m.inputs[6])
    if isinstance(b_socket, tuple):
        m.inputs[7].default_value = _c4(b_socket)
    else:
        nt.links.new(b_socket, m.inputs[7])
    nt.links.new(fac_socket, m.inputs[0])
    return m


def _bump(nt, src_socket, strength=0.25, distance=0.06, loc=(300, -420)):
    b = nt.nodes.new("ShaderNodeBump")
    b.location = loc
    b.inputs["Strength"].default_value = strength
    b.inputs["Distance"].default_value = distance
    nt.links.new(src_socket, b.inputs["Height"])
    return b


def _zgrad(nt, z0, z1, loc=(-880, -300), src=None):
    """0..1 ramp driven by object-space Z between z0 and z1."""
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    sep.location = loc
    nt.links.new(src, sep.inputs["Vector"])
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.location = (loc[0] + 190, loc[1])
    mr.inputs["From Min"].default_value = z0
    mr.inputs["From Max"].default_value = z1
    mr.inputs["To Min"].default_value = 0.0
    mr.inputs["To Max"].default_value = 1.0
    try:
        mr.clamp = True
    except Exception:
        pass
    nt.links.new(sep.outputs["Z"], mr.inputs["Value"])
    return mr.outputs["Result"]


# -----------------------------------------------------------------------------
# MATERIAL LIBRARY
# -----------------------------------------------------------------------------
MATS = {}


def build_materials():
    M = MATS

    # ---- 1. grey clay barrel tile  (青灰陶瓦) -------------------------------
    m, nt, b = _mat("CY_Tile")
    c = _coords(nt, 1.0)
    n1 = _noise(nt, c, 6.0, 8.0, 0.62, loc=(-880, 220))
    r1 = _ramp(nt, n1.outputs["Fac"],
               [(0.26, (0.050, 0.058, 0.072)),
                (0.50, (0.086, 0.094, 0.108)),
                (0.74, (0.128, 0.134, 0.146)),
                (1.00, (0.172, 0.174, 0.176))], loc=(-660, 220))
    nt.links.new(r1.outputs["Color"], b.inputs["Base Color"])
    n2 = _noise(nt, c, 42.0, 10.0, 0.70, loc=(-880, -120))
    bm = _bump(nt, n2.outputs["Fac"], 0.30, 0.012, loc=(320, -300))
    nt.links.new(bm.outputs["Normal"], b.inputs["Normal"])
    n3 = _noise(nt, c, 2.2, 6.0, 0.55, loc=(-880, -320))
    rr = _ramp(nt, n3.outputs["Fac"],
               [(0.20, (0.40,)), (0.60, (0.56,)), (1.00, (0.68,))],
               loc=(-660, -320))
    nt.links.new(rr.outputs["Color"], b.inputs["Roughness"])
    pset(b, "specular", 0.30)
    M["tile"] = m

    # ---- 2. dark natural timber  (深色原木) --------------------------------
    m, nt, b = _mat("CY_Timber")
    c = _coords(nt, 1.0)
    w = nt.nodes.new("ShaderNodeTexWave")
    w.location = (-880, 220)
    w.wave_type = 'BANDS'
    w.bands_direction = 'Z'
    w.inputs["Scale"].default_value = 1.55
    w.inputs["Distortion"].default_value = 8.0
    w.inputs["Detail"].default_value = 3.0
    w.inputs["Detail Scale"].default_value = 1.4
    nt.links.new(c, w.inputs["Vector"])
    r1 = _ramp(nt, w.outputs["Fac"],
               [(0.00, (0.052, 0.030, 0.019)),
                (0.34, (0.086, 0.052, 0.032)),
                (0.60, (0.128, 0.080, 0.049)),
                (1.00, (0.178, 0.118, 0.076))], loc=(-660, 220))
    n1 = _noise(nt, c, 24.0, 8.0, 0.55, loc=(-880, -60))
    mr = _mix(nt, n1.outputs["Fac"], r1.outputs["Color"],
              (0.055, 0.034, 0.022), loc=(-420, 120))
    nt.links.new(mr.outputs[2], b.inputs["Base Color"])
    bm = _bump(nt, w.outputs["Fac"], 0.22, 0.010, loc=(320, -300))
    n2 = _noise(nt, c, 60.0, 10.0, 0.6, loc=(-880, -400))
    bm2 = _bump(nt, n2.outputs["Fac"], 0.14, 0.006, loc=(140, -420))
    nt.links.new(bm2.outputs["Normal"], bm.inputs["Normal"])
    nt.links.new(bm.outputs["Normal"], b.inputs["Normal"])
    rr = _ramp(nt, n1.outputs["Fac"],
               [(0.20, (0.34,)), (0.55, (0.48,)), (1.00, (0.62,))],
               loc=(-660, -220))
    nt.links.new(rr.outputs["Color"], b.inputs["Roughness"])
    pset(b, "specular", 0.26)
    pset(b, "coat", 0.06)
    M["timber"] = m

    # ---- 3. warm white lime wall  (暖白灰墙) --------------------------------
    m, nt, b = _mat("CY_Wall")
    c = _coords(nt, 1.0)
    n1 = _noise(nt, c, 1.6, 9.0, 0.62, loc=(-880, 240))
    r1 = _ramp(nt, n1.outputs["Fac"],
               [(0.22, (0.530, 0.498, 0.442)),
                (0.50, (0.628, 0.596, 0.540)),
                (0.78, (0.704, 0.672, 0.616)),
                (1.00, (0.760, 0.734, 0.682))], loc=(-660, 240))
    # vertical weather streaks
    cn = _coords(nt, 1.0, rot=(0.0, 0.0, 0.0), x=-1150, y=-140)
    mp2 = nt.nodes.new("ShaderNodeMapping")
    mp2.location = (-960, -140)
    mp2.inputs["Scale"].default_value = (7.0, 7.0, 0.30)
    nt.links.new(cn, mp2.inputs["Vector"])
    n2 = _noise(nt, mp2.outputs["Vector"], 3.4, 8.0, 0.6, loc=(-780, -140))
    r2 = _ramp(nt, n2.outputs["Fac"],
               [(0.34, (0.0,)), (0.62, (0.55,)), (1.00, (0.95,))],
               loc=(-580, -140))
    mx = _mix(nt, r2.outputs["Color"], r1.outputs["Color"],
              (0.560, 0.520, 0.455), loc=(-380, 120))
    # rising damp / splash darkening near the ground
    zg = _zgrad(nt, -0.20, 2.30, loc=(-880, -460), src=c)
    mx2 = _mix(nt, zg, mx.outputs[2], (0.330, 0.300, 0.258), loc=(-160, 120))
    nt.links.new(mx2.outputs[2], b.inputs["Base Color"])
    bm = _bump(nt, n2.outputs["Fac"], 0.28, 0.020, loc=(320, -320))
    n3 = _noise(nt, c, 90.0, 10.0, 0.65, loc=(-880, -620))
    bm2 = _bump(nt, n3.outputs["Fac"], 0.20, 0.006, loc=(140, -440))
    nt.links.new(bm2.outputs["Normal"], bm.inputs["Normal"])
    nt.links.new(bm.outputs["Normal"], b.inputs["Normal"])
    pset(b, "specular", 0.16)
    b.inputs["Roughness"].default_value = 0.90
    M["wall"] = m

    # ---- 4. blue-grey stone paving  (青灰石铺地) ---------------------------
    m, nt, b = _mat("CY_Paving")
    c = _coords(nt, 1.0)
    vor = nt.nodes.new("ShaderNodeTexVoronoi")
    vor.location = (-880, 240)
    vor.feature = 'DISTANCE_TO_EDGE'
    vor.inputs["Scale"].default_value = 1.15
    try:
        vor.inputs["Randomness"].default_value = 0.85
    except Exception:
        pass
    nt.links.new(c, vor.inputs["Vector"])
    joint = _ramp(nt, vor.outputs["Distance"],
                  [(0.000, (0.0,)), (0.014, (0.16,)), (0.040, (1.0,))],
                  loc=(-660, 240))
    vor2 = nt.nodes.new("ShaderNodeTexVoronoi")
    vor2.location = (-880, 20)
    vor2.feature = 'F1'
    vor2.inputs["Scale"].default_value = 1.15
    try:
        vor2.inputs["Randomness"].default_value = 0.85
    except Exception:
        pass
    nt.links.new(c, vor2.inputs["Vector"])
    n1 = _noise(nt, c, 12.0, 9.0, 0.6, loc=(-880, -200))
    nfac = _mix(nt, vor2.outputs["Distance"], vor2.outputs["Distance"],
                n1.outputs["Fac"], loc=(-660, -60))
    r1 = _ramp(nt, nfac.outputs[2],
               [(0.10, (0.094, 0.102, 0.098)),
                (0.45, (0.134, 0.142, 0.136)),
                (0.70, (0.174, 0.178, 0.170)),
                (1.00, (0.222, 0.222, 0.210))], loc=(-420, -60))
    mx = _mix(nt, joint.outputs["Color"], (0.058, 0.063, 0.060),
              r1.outputs["Color"], loc=(-180, 120))
    nt.links.new(mx.outputs[2], b.inputs["Base Color"])
    bm = _bump(nt, joint.outputs["Color"], 0.85, 0.024, loc=(320, -300))
    bm2 = _bump(nt, n1.outputs["Fac"], 0.18, 0.008, loc=(140, -420))
    nt.links.new(bm2.outputs["Normal"], bm.inputs["Normal"])
    nt.links.new(bm.outputs["Normal"], b.inputs["Normal"])
    rr = _ramp(nt, n1.outputs["Fac"],
               [(0.2, (0.52,)), (0.6, (0.66,)), (1.0, (0.78,))],
               loc=(-660, -380))
    nt.links.new(rr.outputs["Color"], b.inputs["Roughness"])
    pset(b, "specular", 0.34)
    M["paving"] = m

    # ---- 5. cut grey stone  (阶条石 / 台基 / 柱础) --------------------------
    m, nt, b = _mat("CY_Stone")
    c = _coords(nt, 1.0)
    n1 = _noise(nt, c, 9.0, 9.0, 0.62, loc=(-880, 200))
    r1 = _ramp(nt, n1.outputs["Fac"],
               [(0.22, (0.164, 0.166, 0.158)),
                (0.50, (0.218, 0.220, 0.208)),
                (0.78, (0.272, 0.270, 0.256)),
                (1.00, (0.314, 0.310, 0.290))], loc=(-660, 200))
    n2 = _noise(nt, c, 55.0, 10.0, 0.68, loc=(-880, -140))
    mx = _mix(nt, n2.outputs["Fac"], r1.outputs["Color"],
              (0.126, 0.130, 0.124), loc=(-400, 120))
    nt.links.new(mx.outputs[2], b.inputs["Base Color"])
    bm = _bump(nt, n2.outputs["Fac"], 0.26, 0.012, loc=(320, -300))
    nt.links.new(bm.outputs["Normal"], b.inputs["Normal"])
    rr = _ramp(nt, n1.outputs["Fac"],
               [(0.2, (0.58,)), (0.6, (0.70,)), (1.0, (0.80,))],
               loc=(-660, -300))
    nt.links.new(rr.outputs["Color"], b.inputs["Roughness"])
    pset(b, "specular", 0.32)
    M["stone"] = m

    # ---- 6. Taihu scholar rock  (太湖石) -----------------------------------
    m, nt, b = _mat("CY_Rock")
    c = _coords(nt, 1.0)
    n1 = _noise(nt, c, 3.2, 12.0, 0.72, distortion=1.6, loc=(-880, 200))
    r1 = _ramp(nt, n1.outputs["Fac"],
               [(0.15, (0.130, 0.129, 0.124)),
                (0.45, (0.192, 0.190, 0.182)),
                (0.72, (0.249, 0.245, 0.232)),
                (1.00, (0.304, 0.298, 0.282))], loc=(-660, 200))
    nt.links.new(r1.outputs["Color"], b.inputs["Base Color"])
    vor = nt.nodes.new("ShaderNodeTexVoronoi")
    vor.location = (-880, -160)
    vor.feature = 'DISTANCE_TO_EDGE'
    vor.inputs["Scale"].default_value = 9.0
    nt.links.new(c, vor.inputs["Vector"])
    bm = _bump(nt, vor.outputs["Distance"], 0.55, 0.030, loc=(320, -300))
    n2 = _noise(nt, c, 26.0, 12.0, 0.7, loc=(-660, -400))
    bm2 = _bump(nt, n2.outputs["Fac"], 0.40, 0.016, loc=(140, -420))
    nt.links.new(bm2.outputs["Normal"], bm.inputs["Normal"])
    nt.links.new(bm.outputs["Normal"], b.inputs["Normal"])
    rr = _ramp(nt, n1.outputs["Fac"],
               [(0.2, (0.62,)), (0.6, (0.74,)), (1.0, (0.86,))],
               loc=(-660, -300))
    nt.links.new(rr.outputs["Color"], b.inputs["Roughness"])
    M["rock"] = m

    # ---- 7. still water  (静水) -------------------------------------------
    m, nt, b = _mat("CY_Water")
    c = _coords(nt, 1.0)
    n1 = _noise(nt, c, 0.42, 6.0, 0.5, loc=(-880, 200))
    n2 = _noise(nt, c, 2.6, 8.0, 0.55, loc=(-880, -60))
    mr = _mix(nt, n2.outputs["Fac"], n1.outputs["Fac"], n2.outputs["Fac"],
              loc=(-660, 60))
    bm = _bump(nt, mr.outputs[2], 0.16, 0.020, loc=(320, -300))
    nt.links.new(bm.outputs["Normal"], b.inputs["Normal"])
    n3 = _noise(nt, c, 0.9, 6.0, 0.5, loc=(-880, -320))
    rr = _ramp(nt, n3.outputs["Fac"],
               [(0.25, (0.018, 0.032, 0.036)),
                (0.60, (0.038, 0.060, 0.062)),
                (1.00, (0.072, 0.098, 0.096))], loc=(-660, -320))
    mx = _mix(nt, n3.outputs["Fac"], (0.006, 0.014, 0.013),
              rr.outputs["Color"], loc=(-420, 260))
    nt.links.new(mx.outputs[2], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.130
    pset(b, "specular", 0.46)
    try:
        b.inputs["IOR"].default_value = 1.333
    except Exception:
        pass
    M["water"] = m

    # ---- 8. pine needle mass  (松针) --------------------------------------
    m, nt, b = _mat("CY_Pine")
    c = _coords(nt, 1.0)
    n1 = _noise(nt, c, 16.0, 10.0, 0.65, loc=(-880, 200))
    r1 = _ramp(nt, n1.outputs["Fac"],
               [(0.15, (0.013, 0.028, 0.019)),
                (0.45, (0.023, 0.046, 0.028)),
                (0.72, (0.036, 0.064, 0.038)),
                (1.00, (0.056, 0.086, 0.050))], loc=(-660, 200))
    nt.links.new(r1.outputs["Color"], b.inputs["Base Color"])
    bm = _bump(nt, n1.outputs["Fac"], 0.45, 0.014, loc=(320, -300))
    nt.links.new(bm.outputs["Normal"], b.inputs["Normal"])
    pset(b, "specular", 0.22)
    pset(b, "sheen", 0.10)
    b.inputs["Roughness"].default_value = 0.78
    M["pine"] = m

    # ---- 9. bamboo leaf / general foliage  (竹叶) --------------------------
    m, nt, b = _mat("CY_Leaf")
    c = _coords(nt, 1.0)
    n1 = _noise(nt, c, 18.0, 10.0, 0.62, loc=(-880, 200))
    r1 = _ramp(nt, n1.outputs["Fac"],
               [(0.15, (0.028, 0.048, 0.026)),
                (0.45, (0.046, 0.074, 0.038)),
                (0.72, (0.068, 0.100, 0.052)),
                (1.00, (0.096, 0.130, 0.070))], loc=(-660, 200))
    nt.links.new(r1.outputs["Color"], b.inputs["Base Color"])
    bm = _bump(nt, n1.outputs["Fac"], 0.35, 0.012, loc=(320, -300))
    nt.links.new(bm.outputs["Normal"], b.inputs["Normal"])
    pset(b, "specular", 0.26)
    pset(b, "sheen", 0.12)
    b.inputs["Roughness"].default_value = 0.72
    M["leaf"] = m

    # ---- 10. tree trunk / bark  (树干) ------------------------------------
    m, nt, b = _mat("CY_Bark")
    c = _coords(nt, 1.0)
    w = nt.nodes.new("ShaderNodeTexWave")
    w.location = (-880, 200)
    w.wave_type = 'BANDS'
    w.bands_direction = 'Z'
    w.inputs["Scale"].default_value = 5.5
    w.inputs["Distortion"].default_value = 12.0
    w.inputs["Detail"].default_value = 4.0
    nt.links.new(c, w.inputs["Vector"])
    n1 = _noise(nt, c, 22.0, 8.0, 0.6, loc=(-880, -80))
    r1 = _ramp(nt, n1.outputs["Fac"],
               [(0.18, (0.108, 0.088, 0.072)),
                (0.50, (0.155, 0.128, 0.104)),
                (0.80, (0.208, 0.176, 0.146)),
                (1.00, (0.258, 0.222, 0.188))], loc=(-660, 200))
    nt.links.new(r1.outputs["Color"], b.inputs["Base Color"])
    bm = _bump(nt, w.outputs["Fac"], 0.42, 0.018, loc=(320, -300))
    nt.links.new(bm.outputs["Normal"], b.inputs["Normal"])
    b.inputs["Roughness"].default_value = 0.80
    pset(b, "specular", 0.20)
    M["bark"] = m

    # ---- 11. garden soil / moss ground  (庭土苔地) -------------------------
    m, nt, b = _mat("CY_Soil")
    c = _coords(nt, 1.0)
    n1 = _noise(nt, c, 5.0, 10.0, 0.65, loc=(-880, 200))
    r1 = _ramp(nt, n1.outputs["Fac"],
               [(0.16, (0.054, 0.049, 0.036)),
                (0.42, (0.080, 0.082, 0.054)),
                (0.62, (0.062, 0.078, 0.041)),
                (0.84, (0.090, 0.102, 0.059)),
                (1.00, (0.128, 0.128, 0.094))], loc=(-660, 200))
    nt.links.new(r1.outputs["Color"], b.inputs["Base Color"])
    n2 = _noise(nt, c, 34.0, 10.0, 0.7, loc=(-880, -140))
    bm = _bump(nt, n2.outputs["Fac"], 0.40, 0.018, loc=(320, -300))
    nt.links.new(bm.outputs["Normal"], b.inputs["Normal"])
    b.inputs["Roughness"].default_value = 0.90
    pset(b, "specular", 0.16)
    M["soil"] = m

    # ---- 12. gravel path  (卵石 / 碎石小路) --------------------------------
    m, nt, b = _mat("CY_Gravel")
    c = _coords(nt, 1.0)
    vor = nt.nodes.new("ShaderNodeTexVoronoi")
    vor.location = (-880, 200)
    vor.inputs["Scale"].default_value = 14.0
    nt.links.new(c, vor.inputs["Vector"])
    r1 = _ramp(nt, vor.outputs["Distance"],
               [(0.05, (0.268, 0.268, 0.252)),
                (0.40, (0.352, 0.350, 0.328)),
                (0.72, (0.430, 0.424, 0.396)),
                (1.00, (0.500, 0.490, 0.456))], loc=(-660, 200))
    nt.links.new(r1.outputs["Color"], b.inputs["Base Color"])
    bm = _bump(nt, vor.outputs["Distance"], 0.70, 0.036, loc=(320, -300))
    nt.links.new(bm.outputs["Normal"], b.inputs["Normal"])
    b.inputs["Roughness"].default_value = 0.86
    pset(b, "specular", 0.22)
    M["gravel"] = m

    # ---- 13. paper window  (窗纸) -----------------------------------------
    m, nt, b = _mat("CY_Paper")
    c = _coords(nt, 1.0)
    n1 = _noise(nt, c, 40.0, 8.0, 0.6, loc=(-880, 200))
    r1 = _ramp(nt, n1.outputs["Fac"],
               [(0.20, (0.640, 0.600, 0.520)),
                (0.60, (0.742, 0.706, 0.628)),
                (1.00, (0.826, 0.796, 0.726))], loc=(-660, 200))
    nt.links.new(r1.outputs["Color"], b.inputs["Base Color"])
    pset(b, "subsurface", 0.45)
    pset(b, "sss_radius", (0.16, 0.12, 0.08))
    pset(b, "specular", 0.14)
    b.inputs["Roughness"].default_value = 0.84
    pset(b, "emission_color", (1.0, 0.80, 0.56))
    pset(b, "emission_strength", 0.10)
    M["paper"] = m

    # ---- 14. dark door leaf  (板门 / 隔扇) ---------------------------------
    m, nt, b = _mat("CY_Door")
    c = _coords(nt, 1.0)
    w = nt.nodes.new("ShaderNodeTexWave")
    w.location = (-880, 200)
    w.wave_type = 'BANDS'
    w.bands_direction = 'Z'
    w.inputs["Scale"].default_value = 2.6
    w.inputs["Distortion"].default_value = 4.0
    w.inputs["Detail"].default_value = 2.0
    nt.links.new(c, w.inputs["Vector"])
    r1 = _ramp(nt, w.outputs["Fac"],
               [(0.00, (0.038, 0.022, 0.014)),
                (0.45, (0.068, 0.040, 0.026)),
                (0.80, (0.104, 0.062, 0.040)),
                (1.00, (0.140, 0.086, 0.056))], loc=(-660, 200))
    nt.links.new(r1.outputs["Color"], b.inputs["Base Color"])
    bm = _bump(nt, w.outputs["Fac"], 0.20, 0.010, loc=(320, -300))
    nt.links.new(bm.outputs["Normal"], b.inputs["Normal"])
    b.inputs["Roughness"].default_value = 0.44
    pset(b, "specular", 0.28)
    pset(b, "coat", 0.10)
    M["door"] = m

    # ---- 15. dark lacquered grey-green beam paint  (青绿彩画 / 柱头) -------
    m, nt, b = _mat("CY_Paint")
    c = _coords(nt, 1.0)
    n1 = _noise(nt, c, 6.0, 8.0, 0.6, loc=(-880, 200))
    r1 = _ramp(nt, n1.outputs["Fac"],
               [(0.20, (0.046, 0.078, 0.078)),
                (0.50, (0.072, 0.116, 0.112)),
                (0.78, (0.104, 0.156, 0.148)),
                (1.00, (0.140, 0.196, 0.182))], loc=(-660, 200))
    nt.links.new(r1.outputs["Color"], b.inputs["Base Color"])
    bm = _bump(nt, n1.outputs["Fac"], 0.16, 0.008, loc=(320, -300))
    nt.links.new(bm.outputs["Normal"], b.inputs["Normal"])
    b.inputs["Roughness"].default_value = 0.42
    pset(b, "specular", 0.30)
    pset(b, "coat", 0.12)
    M["paint"] = m

    # ---- 16. distant misty mountain  (雾山) -------------------------------
    m, nt, b = _mat("CY_Mountain")
    c = _coords(nt, 1.0)
    n1 = _noise(nt, c, 0.46, 7.0, 0.66, loc=(-880, 200))
    r1 = _ramp(nt, n1.outputs["Fac"],
               [(0.14, (0.038, 0.050, 0.034)),
                (0.55, (0.090, 0.108, 0.080)),
                (1.00, (0.122, 0.138, 0.104))], loc=(-660, 200))
    nt.links.new(r1.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 1.0
    pset(b, "specular", 0.05)
    # aerial perspective baked straight into the material (view-distance haze)
    cam_d = nt.nodes.new("ShaderNodeCameraData")
    cam_d.location = (-880, -520)
    rng = nt.nodes.new("ShaderNodeMapRange")
    rng.location = (-660, -520)
    rng.inputs["From Min"].default_value = 120.0
    rng.inputs["From Max"].default_value = 420.0
    rng.inputs["To Min"].default_value = 0.0
    rng.inputs["To Max"].default_value = 1.0
    try:
        rng.clamp = True
    except Exception:
        pass
    nt.links.new(cam_d.outputs["View Z Depth"], rng.inputs["Value"])
    rng2 = nt.nodes.new("ShaderNodeMapRange")
    rng2.location = (-560, -520)
    rng2.inputs["From Min"].default_value = 0.0
    rng2.inputs["From Max"].default_value = 1.0
    rng2.inputs["To Min"].default_value = 0.0
    rng2.inputs["To Max"].default_value = 0.72
    nt.links.new(rng.outputs["Result"], rng2.inputs["Value"])
    haze = _mix(nt, rng2.outputs["Result"], r1.outputs["Color"],
                (0.185, 0.216, 0.238), loc=(-420, 120))
    nt.links.new(haze.outputs[2], b.inputs["Base Color"])
    M["mountain"] = m

    # ---- 17. bronze / iron hardware  (铜饰) -------------------------------
    m, nt, b = _mat("CY_Bronze")
    c = _coords(nt, 1.0)
    n1 = _noise(nt, c, 12.0, 8.0, 0.6, loc=(-880, 200))
    r1 = _ramp(nt, n1.outputs["Fac"],
               [(0.20, (0.176, 0.130, 0.062)),
                (0.55, (0.288, 0.216, 0.104)),
                (1.00, (0.398, 0.320, 0.166))], loc=(-660, 200))
    nt.links.new(r1.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Metallic"].default_value = 0.85
    b.inputs["Roughness"].default_value = 0.42
    bm = _bump(nt, n1.outputs["Fac"], 0.20, 0.008, loc=(320, -300))
    nt.links.new(bm.outputs["Normal"], b.inputs["Normal"])
    M["bronze"] = m

    # ---- 18. warm lantern glow  (灯笼) ------------------------------------
    m, nt, b = _mat("CY_Lantern")
    b.inputs["Base Color"].default_value = (0.62, 0.26, 0.10, 1.0)
    b.inputs["Roughness"].default_value = 0.55
    pset(b, "emission_color", (1.0, 0.52, 0.20))
    pset(b, "emission_strength", 3.2)
    M["lantern"] = m

    # ---- 19. pale carpentry detail  (棂条 / 望柱, dry pale wood) -----------
    m, nt, b = _mat("CY_WoodPale")
    c = _coords(nt, 1.0)
    w = nt.nodes.new("ShaderNodeTexWave")
    w.location = (-880, 200)
    w.wave_type = 'BANDS'
    w.bands_direction = 'Z'
    w.inputs["Scale"].default_value = 3.0
    w.inputs["Distortion"].default_value = 6.0
    nt.links.new(c, w.inputs["Vector"])
    r1 = _ramp(nt, w.outputs["Fac"],
               [(0.00, (0.196, 0.152, 0.108)),
                (0.50, (0.276, 0.222, 0.162)),
                (1.00, (0.356, 0.296, 0.222))], loc=(-660, 200))
    nt.links.new(r1.outputs["Color"], b.inputs["Base Color"])
    bm = _bump(nt, w.outputs["Fac"], 0.18, 0.008, loc=(320, -300))
    nt.links.new(bm.outputs["Normal"], b.inputs["Normal"])
    b.inputs["Roughness"].default_value = 0.58
    pset(b, "specular", 0.26)
    M["woodpale"] = m

    # ---- 19b. countryside field  (郊野) -------------------------------------
    m, nt, b = _mat("CY_Field")
    c = _coords(nt, 1.0)
    n1 = _noise(nt, c, 1.05, 9.0, 0.62, loc=(-880, 200))
    r1 = _ramp(nt, n1.outputs["Fac"],
               [(0.14, (0.038, 0.050, 0.034)),
                (0.34, (0.058, 0.072, 0.046)),
                (0.50, (0.078, 0.090, 0.056)),
                (0.64, (0.100, 0.104, 0.066)),
                (0.78, (0.126, 0.120, 0.080)),
                (0.90, (0.150, 0.138, 0.094)),
                (1.00, (0.176, 0.160, 0.112))], loc=(-660, 200))
    nt.links.new(r1.outputs["Color"], b.inputs["Base Color"])
    n2 = _noise(nt, c, 26.0, 10.0, 0.68, loc=(-880, -140))
    bm = _bump(nt, n2.outputs["Fac"], 0.35, 0.020, loc=(320, -300))
    nt.links.new(bm.outputs["Normal"], b.inputs["Normal"])
    b.inputs["Roughness"].default_value = 0.92
    pset(b, "specular", 0.14)
    M["field"] = m

    # ---- 19c. second foliage tone  (远树 / 秋叶) ---------------------------
    m, nt, b = _mat("CY_Leaf2")
    c = _coords(nt, 1.0)
    n1 = _noise(nt, c, 18.0, 10.0, 0.62, loc=(-880, 200))
    r1 = _ramp(nt, n1.outputs["Fac"],
               [(0.15, (0.040, 0.052, 0.026)),
                (0.45, (0.070, 0.084, 0.040)),
                (0.72, (0.104, 0.114, 0.058)),
                (1.00, (0.150, 0.148, 0.084))], loc=(-660, 200))
    nt.links.new(r1.outputs["Color"], b.inputs["Base Color"])
    bm = _bump(nt, n1.outputs["Fac"], 0.35, 0.012, loc=(320, -300))
    nt.links.new(bm.outputs["Normal"], b.inputs["Normal"])
    b.inputs["Roughness"].default_value = 0.74
    pset(b, "specular", 0.24)
    M["leaf2"] = m

    # ---- 20. moss film on top of rocks / stone  (苔痕) --------------------
    m, nt, b = _mat("CY_Moss")
    c = _coords(nt, 1.0)
    n1 = _noise(nt, c, 9.0, 10.0, 0.68, loc=(-880, 200))
    r1 = _ramp(nt, n1.outputs["Fac"],
               [(0.30, (0.086, 0.108, 0.052)),
                (0.62, (0.130, 0.158, 0.074)),
                (1.00, (0.186, 0.212, 0.108))], loc=(-660, 200))
    nt.links.new(r1.outputs["Color"], b.inputs["Base Color"])
    bm = _bump(nt, n1.outputs["Fac"], 0.45, 0.014, loc=(320, -300))
    nt.links.new(bm.outputs["Normal"], b.inputs["Normal"])
    b.inputs["Roughness"].default_value = 0.86
    pset(b, "specular", 0.20)
    M["moss"] = m

    print("MATERIALS: %d" % len(MATS))
    return M


# =============================================================================
#  SONG CARPENTRY MODULE  (材份制)
#  All bracket sets, columns and roof members are derived from one cai module,
#  exactly as the Yingzao Fashi prescribes, so the bay rhythm stays coherent.
# =============================================================================
CAI = 0.210                  # 材广  (module height)
FEN = CAI / 15.0             # 份    (1/15 of cai)  = 0.014 m
ZUG = CAI * 1.42             # 足材  (cai + qi)     = 0.298 m  -> 拱高
GONG_T = 10.0 * FEN          # 拱厚  = 0.140
TIAO = 30.0 * FEN            # 跳长  = 0.420
LD_W = 32.0 * FEN            # 栌斗   0.448
LD_H = 20.0 * FEN            # 栌斗总高 0.280
SD_W = 16.0 * FEN            # 散斗长 0.224
JHD_W = 18.0 * FEN           # 交互斗长 0.252

DOU_Z_QI = LD_H * 0.40       # 欹 (tapered lower body of a dou)
DOU_Z_PING = LD_H * 0.62     # 平


def lframe(origin, out_dir):
    """Local frame for a bracket set: +X outward (normal to the wall),
    +Y along the wall, +Z up.  Returns a mapper f(lx, ly, lz) -> world."""
    o = Vector((out_dir[0], out_dir[1], 0.0))
    if o.length < 1e-9:
        o = Vector((0.0, -1.0, 0.0))
    o.normalize()
    side = Vector((-o.y, o.x, 0.0))
    org = Vector(origin)

    def f(lx, ly, lz):
        return org + o * lx + side * ly + Vector((0.0, 0.0, lz))
    return f, o, side


def lbox(mb, f, x0, x1, y0, y1, z0, z1, mat=None, mat_top=None):
    p = [f(x0, y0, z0), f(x1, y0, z0), f(x1, y1, z0), f(x0, y1, z0),
         f(x0, y0, z1), f(x1, y0, z1), f(x1, y1, z1), f(x0, y1, z1)]
    i = mb.vs(p)
    mt = mat_top if mat_top is not None else mat
    mb.quad(i[0], i[3], i[2], i[1], mat)
    mb.quad(i[4], i[5], i[6], i[7], mt)
    for k in range(4):
        k2 = (k + 1) % 4
        mb.quad(i[k], i[k2], i[4 + k2], i[4 + k], mat)
    return i


def lbar(mb, f, axis, s0, s1, yc, t, z0, z1, mat=None, juanzha=True,
         tz=0.60, hz=0.70, mat_top=None):
    """A horizontal member (gong / ang / fang).
    axis 'x' : runs along local X, offset by yc in Y
    axis 'y' : runs along local Y, offset by xc in Y-param slot
    juanzha  : apply the Song end taper (卷杀) so the ends narrow."""
    if s1 < s0:
        s0, s1 = s1, s0
    L = s1 - s0
    if juanzha:
        tp = min(0.085, L * 0.16)
        secs = [(s0, tz, hz), (s0 + tp, 1.0, 1.0),
                (s1 - tp, 1.0, 1.0), (s1, tz, hz)]
    else:
        secs = [(s0, 1.0, 1.0), (s1, 1.0, 1.0)]
    rings = []
    for s, kt, kh in secs:
        hh = t * kt * 0.5
        zz1 = z0 + (z1 - z0) * kh
        if axis == 'x':
            rings.append([f(s, yc - hh, z0), f(s, yc + hh, z0),
                          f(s, yc + hh, zz1), f(s, yc - hh, zz1)])
        else:
            rings.append([f(yc - hh, s, z0), f(yc + hh, s, z0),
                          f(yc + hh, s, zz1), f(yc - hh, s, zz1)])
    mb.loft(rings, mat, close_ring=True, cap_start=True, cap_end=True)
    return rings


def dou(mb, f, x, y, z, w=SD_W, d=None, h=None, mat=None, taper=0.80):
    """A dou block (栌斗 / 交互斗 / 散斗) - tapered block with a flat seat."""
    d = SD_W * 0.86 if d is None else d
    h = 10.0 * FEN if h is None else h
    # 欹: the tapered lower body
    hq = h * 0.45
    hp = h * 0.22
    hr = h - hq - hp
    hw, hd_ = w * 0.5, d * 0.5
    rings = [
        [f(x - hw * taper, y - hd_ * taper, z), f(x + hw * taper, y - hd_ * taper, z),
         f(x + hw * taper, y + hd_ * taper, z), f(x - hw * taper, y + hd_ * taper, z)],
        [f(x - hw, y - hd_, z + hq), f(x + hw, y - hd_, z + hq),
         f(x + hw, y + hd_, z + hq), f(x - hw, y + hd_, z + hq)],
        [f(x - hw, y - hd_, z + hq + hp), f(x + hw, y - hd_, z + hq + hp),
         f(x + hw, y + hd_, z + hq + hp), f(x - hw, y + hd_, z + hq + hp)],
        [f(x - hw * 0.94, y - hd_ * 0.94, z + hq + hp + hr),
         f(x + hw * 0.94, y - hd_ * 0.94, z + hq + hp + hr),
         f(x + hw * 0.94, y + hd_ * 0.94, z + hq + hp + hr),
         f(x - hw * 0.94, y + hd_ * 0.94, z + hq + hp + hr)],
    ]
    mb.loft(rings, mat, close_ring=True, cap_start=True, cap_end=True)
    return z + h


def puzuo(mb, origin, out_dir, ang=True, n_tiao=3, mat_wood=None, mat_paint=None):
    """六铺作斗拱 (single hua-gong + descending ang arms).
    origin = centre of the back of the lu-dou, on top of the column.
    Returns (top_z, outer_x) so the facade builder can attach the
    continuous liao-yan-fang and liao-feng-cheng.
    """
    T = mat_wood or MATS["timber"]
    P = mat_paint or MATS["paint"]
    f, o, side = lframe(origin, out_dir)

    # ---------- 栌斗 (lu dou) ----------
    dou(mb, f, 0.0, 0.0, 0.0, w=LD_W, d=LD_W, h=LD_H, mat=T, taper=0.72)
    z = LD_H
    x_out = 0.0

    # ---------- jumping arms : 华拱 then descending 下昂 ----------
    for jump in range(1, n_tiao + 1):
        if jump == 1:
            xi, xo = -0.44, 0.50
            lbar(mb, f, 'x', xi, xo, 0.0, GONG_T, z, z + ZUG, T)
            lbar(mb, f, 'y', -0.44, +0.44, 0.0, GONG_T, z + 0.02,
                 z + ZUG - 0.014, T)                      # 泥道拱
            for sy in (-1, 1):
                dou(mb, f, 0.0, sy * 0.44, z + ZUG - 0.014, mat=T)
        else:
            xi = x_out - 0.10
            xo = xi + TIAO + 0.16
            drop = 0.26 if ang else 0.0
            zb0 = z + 0.06
            p = [f(xi, -GONG_T * 0.5, zb0),
                 f(xi, +GONG_T * 0.5, zb0),
                 f(xo, +GONG_T * 0.5, zb0 + ZUG - drop),
                 f(xo, -GONG_T * 0.5, zb0 + ZUG - drop),
                 f(xi, -GONG_T * 0.5, zb0 + ZUG),
                 f(xi, +GONG_T * 0.5, zb0 + ZUG),
                 f(xo, +GONG_T * 0.5, zb0 + ZUG - drop + ZUG * 0.5),
                 f(xo, -GONG_T * 0.5, zb0 + ZUG - drop + ZUG * 0.5)]
            i = mb.vs(p)
            mb.quad(i[0], i[1], i[2], i[3], P)          # 昂 underside (painted)
            mb.quad(i[4], i[7], i[6], i[5], T)
            mb.quad(i[0], i[4], i[5], i[1], T)
            mb.quad(i[1], i[5], i[6], i[2], T)
            mb.quad(i[2], i[6], i[7], i[3], T)
            mb.quad(i[3], i[7], i[4], i[0], T)
            hw = 0.42 if jump < n_tiao else 0.52         # 瓜子拱 / 令拱
            lbar(mb, f, 'y', -hw, hw, xo - 0.10, GONG_T, z + 0.03,
                 z + ZUG - 0.01, T)
            for sy in (-1, 1):
                dou(mb, f, xo - 0.10, sy * hw, z + ZUG - 0.01, mat=T)
        dou(mb, f, xo, 0.0, z + ZUG, w=JHD_W, d=JHD_W * 0.86, mat=T)
        z = z + ZUG + 10.0 * FEN
        x_out = xo

    # ---------- 耍头 (shua-tou) ----------
    lbar(mb, f, 'x', 0.34, x_out + 0.28, 0.0, GONG_T, z, z + 0.28, T,
         juanzha=False)
    z += 0.30

    # ---------- 撩檐方 (liao-yan-fang) ----------
    lbar(mb, f, 'x', x_out - 0.10, x_out + 0.34, 0.0, 0.235, z,
         z + 0.34, P, juanzha=False)
    # the returned height is ABSOLUTE (world z), i.e. the top of the
    # liao-yan-fang on which the roof purlin lands
    return origin[2] + z + 0.34, x_out + 0.34


def yidousansheng(mb, origin, out_dir, mat_wood=None):
    """一斗三升 - the modest bracket unit used on corridors and walls."""
    T = mat_wood or MATS["timber"]
    f, o, side = lframe(origin, out_dir)
    dou(mb, f, 0.0, 0.0, 0.0, w=LD_W * 0.86, d=LD_W * 0.86,
        h=LD_H * 0.92, mat=T, taper=0.74)
    z = LD_H * 0.92
    lbar(mb, f, 'y', -0.40, +0.40, 0.0, GONG_T, z, z + CAI, T)
    lbar(mb, f, 'x', -0.22, +0.22, 0.0, GONG_T, z, z + CAI, T)
    for sy in (-1, 1):
        dou(mb, f, 0.0, sy * 0.40, z + CAI, mat=T)
    return z + CAI + 10.0 * FEN


# -----------------------------------------------------------------------------
# COLUMNS  (梭柱 : entasis + 侧脚 : lean + 生起 : graduated height)
# -----------------------------------------------------------------------------
def column(mb, x, y, z0, h, d=COL_D, lean=(0.0, 0.0), seg=14, mat=None,
           reg_up=0.68, reg_dn=0.86, ent=1.045):
    """Entasis column.  Max diameter sits at ~1/3 of the height, tapering both
    upwards (梭) and slightly downwards (收分)."""
    T = mat or MATS["timber"]
    r = d * 0.5
    rings = []
    NS = 9
    for k in range(NS):
        t = k / float(NS - 1)
        z = z0 + h * t
        if t < 0.34:
            k_r = lerp(reg_dn, ent, t / 0.34)
        else:
            k_r = lerp(ent, reg_up, (t - 0.34) / 0.66) ** 1.0
        rr = r * k_r
        cx = x + lean[0] * (z - z0)
        cy = y + lean[1] * (z - z0)
        rings.append([(cx + cos(2 * pi * j / seg) * rr,
                       cy + sin(2 * pi * j / seg) * rr, z)
                      for j in range(seg)])
    mb.loft(rings, T, close_ring=True, cap_start=True)
    return z0 + h


def column_base(mb, x, y, z0, d=COL_D, mat=None):
    """覆盆式柱础 - inverted-basin stone base."""
    S = mat or MATS["stone"]
    r = d * 0.5
    mb.cyl(x, y, z0, z0 + 0.035, r * 1.85, r * 1.85, 20, S)
    rings = []
    for k in range(6):
        t = k / 5.0
        rr = lerp(r * 1.85, r * 0.86, t ** 0.55)
        rings.append([(x + cos(2 * pi * j / 20) * rr,
                       y + sin(2 * pi * j / 20) * rr, z0 + 0.035 + t * 0.20)
                      for j in range(20)])
    mb.loft(rings, S, close_ring=True, cap_end=True)
    return z0 + 0.235


# -----------------------------------------------------------------------------
# PODIUM (台基) + STEPS (踏跺)
# -----------------------------------------------------------------------------
def podium(mb, cx, cy, hw, hd, h, mat=None, mat_edge=None, skirt=0.30,
           jietiao=0.055, chamfer=0.07):
    """Stone platform: body + proud 阶条石 top course + chamfered foot."""
    S = mat or MATS["stone"]
    E = mat_edge or MATS["stone"]
    z0 = 0.0
    # chamfered foot
    mb.frustum(cx - hw + chamfer, cx + hw - chamfer, cy - hd + chamfer,
               cy + hd - chamfer, z0, z0 + 0.10, 1.0, 1.0, S)
    # 陡板石 body
    mb.frustum(cx - hw, cx + hw, cy - hd, cy + hd, z0 + 0.10,
               z0 + h - jietiao, 0.985, 0.985, S)
    # 阶条石 (slightly proud top course)
    mb.box(cx - hw - 0.035, cx + hw + 0.035, cy - hd - 0.035,
           cy + hd + 0.035, z0 + h - jietiao, z0 + h, E, mat_top=E)
    # 地面 (damped stone paving on the podium)
    mb.box(cx - hw + 0.16, cx + hw - 0.16, cy - hd + 0.16, cy + hd - 0.16,
           z0 + h - 0.012, z0 + h + 0.004, MATS["paving"])
    return z0 + h


def steps(mb, cx, y_out, hw, n, riser, tread, mat=None, dir_sign=-1,
          fu_zi=0.22):
    """踏跺 with 副子 (side cheek) and 象眼 (the stepped triangle)."""
    S = mat or MATS["stone"]
    y = y_out
    for k in range(n):
        h = riser * (k + 1)
        y0 = y + dir_sign * (tread * k)
        y1 = y + dir_sign * (tread * (k + 1))
        mb.box(cx - hw, cx + hw, min(y0, y1), max(y0, y1),
               h - riser - 0.30, h, S, mat_top=MATS["paving"])
        # 副子 on both sides
        for sx in (-1, 1):
            xa = cx + sx * hw
            xb = cx + sx * (hw + fu_zi)
            mb.box(min(xa, xb), max(xa, xb), min(y0, y1), max(y0, y1),
                   h - riser - 0.34, h + 0.02, S)
    # core mass under the steps (象眼)
    ye = y + dir_sign * tread * n
    mb.box(cx - hw, cx + hw, min(y, ye), max(y, ye), 0.0, riser * 0.9, S)


# =============================================================================
#  ROOF ENGINE  --  举折 + 翼角起翘
#  One parametric surface produces all three canonical Song roof forms:
#     xuan shan (悬山)  shoushan = 0,      break = 1
#     wu dian   (庑殿)  shoushan = hd,     break = 1
#     xie shan  (歇山)  shoushan = s,      break < 1   <- nine-ridge hall roof
# =============================================================================
def disc_at(mb, center, axis, r, t, mat, seg=12, cap=True):
    a = nrm(axis)
    up = Vector((0.0, 0.0, 1.0))
    if abs(a.dot(up)) > 0.94:
        up = Vector((1.0, 0.0, 0.0))
    u = nrm(a.cross(up))
    v = nrm(a.cross(u))
    r0 = [center + u * (cos(2 * pi * k / seg) * r) +
          v * (sin(2 * pi * k / seg) * r) for k in range(seg)]
    r1 = [p + a * t for p in r0]
    i0 = mb.vs(r0)
    i1 = mb.vs(r1)
    for k in range(seg):
        k2 = (k + 1) % seg
        mb.quad(i0[k], i0[k2], i1[k2], i1[k], mat)
    if cap:
        mb.face(tuple(i1), mat)
        mb.face(tuple(reversed(i0)), mat)
    return i1


class SongRoof(object):
    """举折 roof surface.  a = lateral parameter, b = slope parameter
    (0 at the eave, 1 at the ridge)."""

    def __init__(self, cx, cy, hw, hd, eave_z, ridge_z, shoushan=0.0,
                 break_t=1.0, q=1.38, corner_lift=0.62, plan_bulge=0.32,
                 shape=3.0, rot=0.0):
        self.cx = cx
        self.cy = cy
        self.hw = hw
        self.hd = hd
        self.ez = eave_z
        self.rz = ridge_z
        self.s = float(shoushan)
        self.tb = float(break_t)
        self.q = q
        self.cl = corner_lift
        self.pb = plan_bulge
        self.sh = shape
        self.rot = float(rot)

    def _x(self, x, y):
        if abs(self.rot) < 1e-9:
            return self.cx + x, self.cy + y
        c, s = cos(self.rot), sin(self.rot)
        return self.cx + x * c - y * s, self.cy + x * s + y * c

    # ---- key derived values ----
    @property
    def y0(self):
        return self.hd * (1.0 - self.tb)

    @property
    def zb(self):
        return self.ez + (self.rz - self.ez) * (self.tb ** self.q)

    def xms(self, tau):
        if self.s <= 1e-6:
            return 1.0
        return 1.0 - min(tau / self.tb, 1.0) * (self.s / self.hw)

    # ---- surfaces ----
    def slope(self, sy, u, tau):
        tau = clamp(tau, 0.0, 1.0)
        u3 = abs(u) ** self.sh
        d1 = (1.0 - tau)
        lift = self.cl * u3 * (d1 ** 1.6)
        bulge = self.pb * u3 * (d1 ** 2.2)
        z = self.ez + (self.rz - self.ez) * (tau ** self.q) + lift
        y = sy * (self.hd * d1 + bulge)
        x = u * self.hw * self.xms(tau) + (1.0 if u >= 0 else -1.0) * bulge * 0.5
        X, Y = self._x(x, y)
        return Vector((X, Y, z))

    def end_slope(self, sx, w, sigma):
        sigma = clamp(sigma, 0.0, 1.0)
        tt = sigma * self.tb
        w3 = abs(w) ** self.sh
        d1 = (1.0 - tt)
        lift = self.cl * w3 * (d1 ** 1.6)
        bulge = self.pb * w3 * (d1 ** 2.2)
        z = self.ez + (self.zb - self.ez) * (sigma ** self.q) + lift
        x = sx * (self.hw - sigma * self.s + bulge * 0.5)
        y = w * (self.hd + sigma * (self.y0 - self.hd)) + \
            (1.0 if w >= 0 else -1.0) * bulge
        X, Y = self._x(x, y)
        return Vector((X, Y, z))

    def frame(self, fn, a, b, da=4e-3, db=4e-3):
        P = fn(a, b)
        Pa = fn(a + da, b) - fn(a - da, b)
        Pb = fn(a, b + db) - fn(a, b - db)
        N = Pa.cross(Pb)
        if N.length < 1e-9:
            N = Vector((0.0, 0.0, 1.0))
        N.normalize()
        if N.z < 0.0:
            N = -N
        S = Pa
        if S.length < 1e-9:
            S = Vector((1.0, 0.0, 0.0))
        S = S - N * S.dot(N)
        if S.length < 1e-9:
            S = Vector((1.0, 0.0, 0.0))
        S.normalize()
        return P, N, S


# -----------------------------------------------------------------------------
#  TILE RIDGES  (筒瓦垄) + base sheet (板瓦)
# -----------------------------------------------------------------------------
def tile_sheet(mb, rfn, n_lines, nv, mat, a0=0.0, a1=1.0, b0=0.0, b1=1.0,
               hollow=0.021, crown=0.004, bpow=0.88, edge_drop=0.0):
    """Corrugated base sheet: a column at every barrel-tile centre and a
    recessed column between them -> reads as 板瓦 hollows."""
    cols = n_lines * 2 - 1
    grid = []
    for j in range(nv):
        b = b0 + (b1 - b0) * ((j / float(nv - 1)) ** bpow)
        row = []
        for i in range(cols):
            a = a0 + (a1 - a0) * (i / float(cols - 1))
            P, N, S = rfn(a, b)
            off = crown if (i % 2 == 0) else -hollow
            if edge_drop and (i == 0 or i == cols - 1):
                off -= edge_drop
            row.append(P + N * off)
        grid.append(row)
    idx = [mb.vs(r) for r in grid]
    mb.grid(idx, mat)
    return idx


def tile_longs(mb, rfn, n_lines, nv, mat, r=0.113, h=0.100, a0=0.0, a1=1.0,
               b0=0.06, b1=1.0, bpow=0.88, wadang=True, cap_r=0.30):
    """Barrel-tile ridges running up the slope."""
    prof = ((-1.00, 0.00), (-0.70, 0.62), (0.00, 1.00), (0.70, 0.62),
            (1.00, 0.00))
    for i in range(n_lines):
        a = a0 + (a1 - a0) * (i / float(n_lines - 1))
        rings = []
        for j in range(nv):
            b = b0 + (b1 - b0) * ((j / float(nv - 1)) ** bpow)
            P, N, S = rfn(a, b)
            base = P + N * 0.004
            rings.append([base + S * (ps * r) + N * (ph * h) for ps, ph in prof])
        mb.loft(rings, mat, close_ring=False)
        # 瓦当 (round eave cap) at the bottom end of each ridge
        if wadang:
            P, N, S = rfn(a, b0)
            T = rfn(a, b0 + 0.03)[0] - rfn(a, max(0.0, b0 - 0.004))[0]
            if T.length > 1e-7:
                disc_at(mb, P - nrm(T) * 0.5 + N * (h * 0.42), -nrm(T),
                        r * 1.16, 0.055, mat, seg=8)


def ridge_strip(mb, path, ups, sides, w, h, mat, cap=True, taper_end=0.0):
    """A raised tile ridge (正脊 / 垂脊 / 戗脊) lofted along a path."""
    prof = ((-0.50, 0.00), (0.50, 0.00), (0.30, 0.74), (0.00, 1.00),
            (-0.30, 0.74))
    rings = []
    n = len(path)
    for k in range(n):
        P = path[k]
        U = nrm(ups[k])
        S = nrm(sides[k])
        S = nrm(S - U * S.dot(U))
        kt = 1.0
        if taper_end > 0.0:
            t = min(k, n - 1 - k) / max(1.0, taper_end * (n - 1))
            kt = 0.35 + 0.65 * smoothstep(min(t, 1.0))
        rings.append([P + S * (sx * w * kt) + U * (sy * h * kt)
                      for sx, sy in prof])
    mb.loft(rings, mat, close_ring=True, cap_start=cap, cap_end=cap)


def chi_wei(mb, base, along, mat):
    """鸱尾 - the restrained Song ridge-end fin (NOT a Ming-Qing dragon)."""
    a = nrm(Vector((along[0], along[1], 0.0)))
    if a.length < 1e-9:
        a = Vector((1.0, 0.0, 0.0))
    yv = Vector((-a.y, a.x, 0.0))
    o = Vector(base)
    spine = [(-0.02, 0.04, 0.30, 0.055),
             (-0.36, 0.20, 0.30, 0.115),
             (-0.62, 0.48, 0.255, 0.185),
             (-0.72, 0.80, 0.185, 0.205),
             (-0.62, 1.08, 0.135, 0.190),
             (-0.47, 1.30, 0.105, 0.145),
             (-0.46, 1.47, 0.105, 0.085),
             (-0.62, 1.55, 0.115, 0.045)]
    rings = []
    for s, h, ha, hb in spine:
        c = o + a * s + Vector((0.0, 0.0, h))
        rings.append([c + a * ha + yv * (-hb), c + a * ha + yv * hb,
                      c + a * (-ha) + yv * hb, c + a * (-ha) + yv * (-hb)])
    mb.loft(rings, mat, close_ring=True, cap_start=True, cap_end=True)


def xuan_yu(mb, apex, along, mat, scale=1.0):
    """悬鱼 - the hanging board at a gable apex."""
    a = nrm(Vector((along[0], along[1], 0.0)))
    yv = Vector((-a.y, a.x, 0.0))
    o = Vector(apex)
    base = [(-0.30, -0.05), (0.30, -0.05), (0.34, -0.34),
            (0.20, -0.70), (0.00, -0.94), (-0.20, -0.70), (-0.34, -0.34)]
    th = 0.055
    f0 = [o + a * (p[0] * scale) + Vector((0.0, 0.0, p[1] * scale)) +
          yv * (-th) for p in base]
    f1 = [o + a * (p[0] * scale) + Vector((0.0, 0.0, p[1] * scale)) +
          yv * (th) for p in base]
    i0 = mb.vs(f0)
    i1 = mb.vs(f1)
    mb.face(tuple(reversed(i0)), mat)
    mb.face(tuple(i1), mat)
    n = len(base)
    for k in range(n):
        k2 = (k + 1) % n
        mb.quad(i0[k], i0[k2], i1[k2], i1[k], mat)


def frame_matrix(ux, uy, uz):
    return Matrix(((ux.x, uy.x, uz.x), (ux.y, uy.y, uz.y), (ux.z, uy.z, uz.z)))


def sheet_pts(rfn, n_lines, nv, hollow=0.021, crown=0.005, bpow=0.88,
              edge_extra=0.0):
    cols = n_lines * 2 - 1
    rows = []
    for j in range(nv):
        b = (j / float(nv - 1)) ** bpow
        row = []
        for i in range(cols):
            a = -1.0 + 2.0 * (i / float(cols - 1))
            P, N, S = rfn(a, b)
            off = crown if (i % 2 == 0) else -hollow
            row.append(P + N * off)
        rows.append(row)
    return rows


def rafter_ends(mb, rfn, spacing, mat, span_m, out_len=0.62, in_len=1.30,
                w=0.115, h=0.150, feizi=True, norm=0.93):
    """檐椽 + 飞子 : the exposed rafter tails under a deep Song eave.
    span_m is the real eave width in metres; the surface functions of
    SongRoof take a NORMALISED lateral parameter in [-1, 1], so the metre
    values are converted here."""
    n = max(3, int(round(span_m / spacing)))
    half = max(1e-6, span_m * 0.5)
    for k in range(n):
        a = ((-half + span_m * (k / float(n - 1))) / half) * norm
        P0, N0, S0 = rfn(a, 0.0)
        P1, N1, _ = rfn(a, 0.05)
        d = nrm(P1 - P0)                    # up-slope tangent
        p_in = P0 - d * in_len - N0 * 0.055
        p_out = P0 + d * out_len - N0 * 0.055
        c = (p_in + p_out) * 0.5
        rot = frame_matrix(S0, N0, nrm(d))
        mb.obox(c, Vector((w * 0.5, h * 0.5, (p_out - p_in).length * 0.5)),
                mat, rot=rot)
        if feizi:
            # 飞子 : a shorter, slightly raised board on the rafter tail
            f0 = P0 - d * 0.12 - N0 * 0.055
            f1 = P0 + d * out_len * 1.16 - N0 * 0.055
            c2 = (f0 + f1) * 0.5
            mb.obox(c2 + N0 * (h * 0.52),
                    Vector((w * 0.42, h * 0.22, (f1 - f0).length * 0.5)),
                    mat, rot=rot)


def build_roof(mb, R, tile_pitch=0.36, nv=11, thick=0.30,
               mat_tile=None, mat_ridge=None, mat_wood=None, mat_wall=None,
               mat_plate=None, tiles=True, rafters=True, gable_panel=True,
               long_tile_nv=None, ridge_h=(0.30, 0.40), chi_wei_scale=1.0,
               corner_post=False):
    """Assemble a complete roof: slab, barrel tiles, ridges, gable, eave."""
    MT = mat_tile or MATS["tile"]
    MR = mat_ridge or MATS["tile"]
    MW = mat_wood or MATS["timber"]
    MP = mat_plate or MATS["woodpale"]
    MWALL = mat_wall or MATS["wall"]
    nvt = long_tile_nv or nv

    eave_pts = {}       # (kind, sign) -> list of eave edge points

    # ---------------- front & back slopes ----------------
    for sy in (-1, 1):
        def fn(a, b, sy=sy):
            return R.slope(sy, a, b)

        def rfn(a, b, fn=fn):
            return R.frame(fn, a, b, da=3e-3, db=3e-3)

        nl = max(6, int(round(2.0 * R.hw / tile_pitch)) + 1)
        top = sheet_pts(rfn, nl, nvt)
        bot = [[p - Vector((0.0, 0.0, thick)) for p in row] for row in top]
        mb.grid([mb.vs(r) for r in top], MT)
        mb.grid([mb.vs(r) for r in bot], MW)
        # eave fascia band
        mb.strip(top[0], bot[0], MW, flip=(sy > 0))
        # lateral edges of the sheet (small closed bands, mainly hidden)
        for i in (0, -1):
            mb.strip([r[i] for r in top], [r[i] for r in bot], MW)
        eave_pts[("s", sy)] = top[0]
        if tiles:
            tile_longs(mb, rfn, nl, nvt, MT, b0=0.02, b1=0.985)
        if rafters:
            rafter_ends(mb, rfn, RAFT_SPACING, MW, 2.0 * R.hw * 0.94,
                        out_len=0.60, in_len=1.30)

    # ---------------- end slopes (sa tou / 撒头) ----------------
    if R.s > 2e-3:
        for sx in (-1, 1):
            def fn2(w, s_, sx=sx):
                return R.end_slope(sx, w, s_)

            def rfn2(w, s_, fn2=fn2):
                return R.frame(fn2, w, s_, da=3e-3, db=3e-3)

            nl = max(5, int(round(2.0 * R.hd / tile_pitch)) + 1)
            top = sheet_pts(rfn2, nl, nvt)
            bot = [[p - Vector((0.0, 0.0, thick)) for p in row]
                   for row in top]
            mb.grid([mb.vs(r) for r in top], MT)
            mb.grid([mb.vs(r) for r in bot], MW)
            mb.strip(top[0], bot[0], MW, flip=(sx < 0))
            for i in (0, -1):
                mb.strip([r[i] for r in top], [r[i] for r in bot], MW)
            eave_pts[("e", sx)] = top[0]
            if tiles:
                tile_longs(mb, rfn2, nl, nvt, MT, b0=0.02, b1=0.985)
            if rafters:
                rafter_ends(mb, rfn2, RAFT_SPACING, MW, 2.0 * R.hd * 0.94,
                            out_len=0.60, in_len=1.30)

    # ---------------- 山花 (gable panel) + 博风板 (barge board) -----------
    ngg = 9
    for sx in (-1, 1):
        # the u = sx edge of both slopes : 戗脊 -> 垂脊 (or the gable edge)
        tau_a = 0.0 if R.s <= 1e-6 else R.tb
        taus = [tau_a + (1.0 - tau_a) * (k / float(ngg - 1))
                for k in range(ngg)]
        taus[0] = tau_a + 1e-4
        fs, bs, ups, sds = [], [], [], []
        for t in taus:
            Pf = R.slope(-1, sx, t)
            Pb = R.slope(+1, sx, t)
            _, N, _ = R.frame(lambda a, b: R.slope(-1, a, b), sx, t)
            fs.append(Pf)
            bs.append(Pb)
            ups.append(nrm(N))
            edge = nrm(Pb - Pf)
            sds.append(nrm(edge.cross(N)))

        if R.s <= 1e-6:
            # ---- 悬山 : barge boards along both gable edges + hanging fish
            for path, up_l, sd_l, sign in ((fs, ups, sds, -1),
                                           (bs, ups, sds, 1)):
                top = [p + u * 0.10 for p, u in zip(path, up_l)]
                low = [p - Vector((0.0, 0.0, 0.36)) - u * 0.02
                       for p, u in zip(path, up_l)]
                mb.strip(top, low, MP)
                mb.strip(low, [p - Vector((0.0, 0.0, 0.42)) - u * 0.02
                               for p, u in zip(path, up_l)], MP)
            apex = R.slope(-1, sx, 1.0 - 1e-3)
            xuan_yu(mb, apex + Vector((0.0, 0.0, 0.18)),
                    (0.0, 1.0, 0.0), MP, scale=1.15)
        else:
            # ---- ridge along the hip / gable edge
            ridge_strip(mb, [p + u * 0.045 for p, u in zip(fs, ups)],
                        ups, sds, 0.30, ridge_h[0], MR, taper_end=0.30)

        # ---- 山花 panel for 歇山
        if gable_panel and R.s > 2e-3 and R.tb < 0.999:
            tb = R.tb
            njj = 9
            rows = []
            for k in range(njj):
                t = tb + (1.0 - tb) * (k / float(njj - 1))
                Pf = R.slope(-1, sx, t)
                Pb = R.slope(+1, sx, t)
                rows.append([Pf, Pb])
            idx = [mb.vs(r) for r in rows]
            mb.grid(idx, MWALL)
            # 博风板 on the gable edges (above the 山花)
            for path, up_l, sign in ((fs, ups, -1), (bs, ups, 1)):
                top = [p + u * 0.10 for p, u in zip(path, up_l)]
                low = [p - Vector((0.0, 0.0, 0.40)) for p in path]
                mb.strip(top, low, MP)
            # small ridge capping where the 撒头 meets the gable base
            base = [R.slope(-1, sx, tb), R.slope(+1, sx, tb)]
            mid = (base[0] + base[1]) * 0.5
            _, N, S = R.frame(lambda a, b: R.slope(-1, a, b), sx, tb)
            ridge_strip(mb, [(base[0] + base[1]) * 0.5] * 2,
                        [Vector((0.0, 0.0, 1.0))] * 2,
                        [Vector((0.0, 1.0, 0.0))] * 2,
                        0.0, 0.0, MR)

    # ---------------- 正脊 (main ridge) + 鸱尾 ----------------
    if R.s > 2e-3 or R.tb < 0.999:
        xr = R.hw - R.s
        zr = R.rz
        n = 9
        path = [Vector((R.cx - xr + 2 * xr * (k / float(n - 1)), R.cy,
                        zr - 0.10)) for k in range(n)]
        ups = [Vector((0.0, 0.0, 1.0))] * n
        sds = [Vector((0.0, 1.0, 0.0))] * n
        ridge_strip(mb, [p + Vector((0.0, 0.0, 0.07)) for p in path],
                    ups, sds, 0.78, 0.26, MR)
        ridge_strip(mb, [p + Vector((0.0, 0.0, 0.30)) for p in path],
                    ups, sds, 0.56, 0.34, MR)
        for e in (-1, 1):
            chi_wei(mb, Vector((R.cx + e * xr, R.cy, zr + 0.26)),
                    (-e, 0.0, 0.0), MR)
            # 脊端 raising (small upward flick, very restrained)
            mb.obox(Vector((R.cx + e * (xr - 0.20), R.cy, zr + 0.16)),
                    Vector((0.30, 0.34, 0.20)), MR)


# =============================================================================
#  OPENINGS  /  RAILINGS  /  WALLS  /  CORRIDORS
# =============================================================================
def framef(origin, along, up=(0.0, 0.0, 1.0)):
    a = nrm(V3(along))
    u = nrm(V3(up, 1.0))
    n = nrm(a.cross(u))
    o = V3(origin)

    def f(lx, ly, lz):
        return o + a * lx + n * ly + u * lz
    return f, a, n, u


def lrod(mb, f, axis, s0, s1, yc, z, r, seg=8, mat=None, phase=0.0):
    rings = []
    for s in (s0, s1):
        ring = []
        for k in range(seg):
            a = phase + 2.0 * pi * k / seg
            if axis == 'x':
                ring.append(f(s, yc + cos(a) * r, z + sin(a) * r))
            else:
                ring.append(f(yc + cos(a) * r, s, z + sin(a) * r))
        rings.append(ring)
    mb.loft(rings, mat, close_ring=True, cap_start=True, cap_end=True)


def lprism(mb, f, x0, x1, ya0, yb0, ya1, yb1, z0, z1, mat=None):
    """Tapered slab / battered wall course."""
    a = [f(x0, ya0, z0), f(x1, ya0, z0), f(x1, yb0, z0), f(x0, yb0, z0)]
    b = [f(x0, ya1, z1), f(x1, ya1, z1), f(x1, yb1, z1), f(x0, yb1, z1)]
    i = mb.vs(a + b)
    mb.quad(i[0], i[3], i[2], i[1], mat)
    mb.quad(i[4], i[5], i[6], i[7], mat)
    for k in range(4):
        k2 = (k + 1) % 4
        mb.quad(i[k], i[k2], i[4 + k2], i[4 + k], mat)


# ---- 直棂窗 -------------------------------------------------------------------
def win_zhiling(mb, f, x0, x1, z0, z1, t=0.28, nbars=7, mat=None, mat_p=None,
                fw=0.115):
    W = mat or MATS["timber"]
    PA = mat_p or MATS["paper"]
    lbox(mb, f, x0, x1, -t * 0.62, t * 0.62, z1 - fw, z1, W)
    lbox(mb, f, x0, x1, -t * 0.72, t * 0.72, z0, z0 + fw, W)
    lbox(mb, f, x0, x0 + fw, -t * 0.62, t * 0.62, z0, z1, W)
    lbox(mb, f, x1 - fw, x1, -t * 0.62, t * 0.62, z0, z1, W)
    lbox(mb, f, x0 + fw, x1 - fw, -0.025, 0.035, z0 + fw, z1 - fw, PA)
    ia, ib = x0 + fw, x1 - fw
    for k in range(nbars):
        a = ia + (ib - ia) * (k / float(max(1, nbars - 1)))
        lbox(mb, f, a - 0.046, a + 0.046, -t * 0.42, t * 0.46,
             z0 + fw, z1 - fw, W)


# ---- 格子门 (lattice door, 格心 + 障水板) --------------------------------------
def door_gezi(mb, f, x0, x1, z0, z1, nleaf=4, t=0.28, mat=None, mat_p=None,
              nv=5, nh=3):
    W = mat or MATS["timber"]
    PA = mat_p or MATS["paper"]
    lbox(mb, f, x0, x1, -t * 0.68, t * 0.68, z1 - 0.17, z1, W)
    lbox(mb, f, x0, x1, -t * 0.68, t * 0.68, z0, z0 + 0.11, W)
    w = (x1 - x0) / float(nleaf)
    sw = 0.085
    for i in range(nleaf):
        a = x0 + i * w
        b = a + w
        zt = z1 - 0.17
        zb0 = z0 + 0.11
        zb = zb0 + 0.36 * (z1 - z0)
        lbox(mb, f, a, a + sw, -t * 0.52, t * 0.52, zb0, zt, W)
        lbox(mb, f, b - sw, b, -t * 0.52, t * 0.52, zb0, zt, W)
        lbox(mb, f, a, b, -t * 0.52, t * 0.52, zt - 0.085, zt, W)
        lbox(mb, f, a, b, -t * 0.52, t * 0.52, zb, zb + 0.12, W)
        la, lb = a + sw, b - sw
        lbox(mb, f, la, lb, -0.022, 0.030, zb + 0.12, zt - 0.085, PA)
        for k in range(nv):
            zz = lerp(zb + 0.12, zt - 0.085, k / float(max(1, nv - 1)))
            lbox(mb, f, la, lb, -0.050, 0.056, zz - 0.027, zz + 0.027, W)
        for k in range(nh):
            xx = lerp(la, lb, (k + 1) / float(nh + 1))
            lbox(mb, f, xx - 0.027, xx + 0.027, -0.050, 0.056,
                 zb + 0.12, zt - 0.085, W)
        lbox(mb, f, a + sw * 0.55, b - sw * 0.55, -t * 0.34, t * 0.34,
             zb0, zb, W)


# ---- 板门 (plank door) --------------------------------------------------------
def door_banmen(mb, f, x0, x1, z0, z1, t=0.28, mat=None, mat_b=None,
                open_ang=None):
    """板门.  open_ang=None -> closed leaves;  a number -> two leaves swung
    inward by that many degrees (gives a deep dark reveal through the gate)."""
    W = mat or MATS["door"]
    B = mat_b or MATS["bronze"]
    lbox(mb, f, x0, x1, -t * 0.62, t * 0.62, z1 - 0.20, z1, W)
    lbox(mb, f, x0, x1, -t * 0.62, t * 0.62, z0, z0 + 0.13, W)
    lbox(mb, f, x0, x0 + 0.13, -t * 0.62, t * 0.62, z0, z1, W)
    lbox(mb, f, x1 - 0.13, x1, -t * 0.62, t * 0.62, z0, z1, W)
    for e in (-1, 1):
        lbox(mb, f, (x0 + x1) * 0.5 + e * 0.28 - 0.05,
             (x0 + x1) * 0.5 + e * 0.28 + 0.05, -0.115, 0.115,
             z1 - 1.00, z1 - 0.86, B)

    if open_ang is None:
        span = x1 - x0 - 0.26
        np_ = max(4, int(round(span / 0.30)))
        for k in range(np_):
            a = x0 + 0.13 + span * (k / float(np_))
            bw = span / float(np_)
            lbox(mb, f, a + 0.014, a + bw - 0.014, -0.075, 0.075,
                 z0 + 0.13, z1 - 0.20, W)
        return

    mid = (x0 + x1) * 0.5
    lw = (mid - x0) - 0.18
    th = radians(open_ang)
    for e, hx, th2 in ((-1, x0 + 0.15, -th), (1, x1 - 0.15, th)):
        ct, st = cos(th2), sin(th2)
        npl = max(2, int(round(lw / 0.30)))
        step = lw / float(npl)
        for k in range(npl):
            u0 = k * step
            u1 = u0 + step * 0.94
            if e > 0:
                u0, u1 = -u1, -u0
            pts = []
            for zz in (z0 + 0.13, z1 - 0.20):
                for uu, vv in ((u0, -0.062), (u1, -0.062),
                               (u1, 0.062), (u0, 0.062)):
                    pts.append(f(hx + uu * ct - vv * st,
                                 uu * st + vv * ct, zz))
            i = mb.vs(pts)
            mb.quad(i[0], i[3], i[2], i[1], W)
            mb.quad(i[4], i[5], i[6], i[7], W)
            for q in range(4):
                q2 = (q + 1) % 4
                mb.quad(i[q], i[q2], i[4 + q2], i[4 + q], W)


# ---- 寻杖栏杆 (Song railing: 地栿 + 盆唇 + 蜀柱 + 云拱 + 寻杖 + 望柱) ---------
def railing_xz(mb, f, x0, x1, z0, h=0.95, mat=None):
    W = mat or MATS["woodpale"]
    lbox(mb, f, x0, x1, -0.082, 0.082, z0, z0 + 0.105, W)
    lbox(mb, f, x0, x1, -0.066, 0.066, z0 + 0.315, z0 + 0.415, W)
    span = x1 - x0
    nsub = max(2, int(round(span / 0.50)))
    for k in range(nsub + 1):
        xx = x0 + span * (k / float(nsub))
        lbox(mb, f, xx - 0.040, xx + 0.040, -0.040, 0.040,
             z0 + 0.105, z0 + 0.795, W)
        lbox(mb, f, xx - 0.088, xx + 0.088, -0.056, 0.056,
             z0 + 0.795, z0 + 0.905, W)
    lrod(mb, f, 'x', x0, x1, 0.0, z0 + h - 0.045, 0.066, 8, W)
    nw = max(1, int(round(span / 2.60)))
    for k in range(nw + 1):
        xx = x0 + span * (k / float(nw))
        lbox(mb, f, xx - 0.088, xx + 0.088, -0.088, 0.088, z0, z0 + h + 0.30, W)
        lbox(mb, f, xx - 0.112, xx + 0.112, -0.112, 0.112,
             z0 + h + 0.30, z0 + h + 0.40, W)


# ---- 围墙 + 瓦顶压顶 ----------------------------------------------------------
def wall_run(mb, p0, p1, z0=0.0, h=None, t=None, mat=None, mat_r=None,
             gate_gaps=()):
    """Lime-plastered perimeter wall with a battered base and a tiled cap."""
    W = mat or MATS["wall"]
    R = mat_r or MATS["tile"]
    h = WALL_H if h is None else h
    t = WALL_T if t is None else t
    p0 = V3(p0)
    p1 = V3(p1)
    L = (p1 - p0).length
    if L < 0.05:
        return
    f, a, n, u = framef(p0, p1 - p0)
    segs = [(0.0, L)]
    if gate_gaps:
        segs = []
        cuts = sorted(gate_gaps)
        cur = 0.0
        for g0, g1 in cuts:
            if g0 > cur + 0.05:
                segs.append((cur, g0))
            cur = g1
        if L - cur > 0.05:
            segs.append((cur, L))
    for s0, s1 in segs:
        # 下碱 (battered stone base course) + body + capping course
        lprism(mb, f, s0, s1, -t * 0.58, t * 0.58, -t * 0.52, t * 0.52,
               0.0, 0.62, W)
        lbox(mb, f, s0, s1, -t * 0.50, t * 0.50, 0.62, h - 0.14, W)
        lbox(mb, f, s0, s1, -t * 0.545, t * 0.545, h - 0.14, h, W)
        # 瓦顶压顶 : two slopes + roll ridge
        over = 0.30
        rise = 0.34
        e = t * 0.55 + over
        nl = max(3, int(round((s1 - s0) / 0.42)))
        for sy in (-1, 1):
            top_rows = []
            nvp = 3
            for j in range(nvp):
                tt = j / float(nvp - 1)
                row = []
                for k in range(nl + 1):
                    xx = lerp(s0, s1, k / float(nl))
                    yy = sy * e * (1.0 - tt)
                    zz = h + rise * (tt ** 0.86) - 0.10 + 0.02
                    row.append(f(xx, yy, zz))
                top_rows.append(row)
            idx = [mb.vs(r) for r in top_rows]
            mb.grid(idx, R, flip=(sy < 0))
            bot = [[p - Vector((0.0, 0.0, 0.30)) for p in r] for r in top_rows]
            bidx = [mb.vs(r) for r in bot]
            mb.grid(bidx, MATS["timber"], flip=(sy > 0))
            mb.strip(top_rows[0], bot[0], MATS["timber"], flip=(sy < 0))
        # ridge roll
        rows = []
        for j, (dy, dz) in enumerate(((-0.115, 0.0), (-0.075, 0.085),
                                      (0.0, 0.125), (0.075, 0.085),
                                      (0.115, 0.0))):
            rows.append([f(lerp(s0, s1, k / float(nl)), dy,
                           h + rise - 0.08 + dz) for k in range(nl + 1)])
        mb.grid([mb.vs(r) for r in rows], R)


# ---- 连廊 (covered corridor) --------------------------------------------------
def corridor_run(mb, p0, p1, half_w=1.55, col_h=3.10, plinth_h=0.34,
                 col_spacing=3.00, railing_side=(1,), n_tiao=2,
                 tile_pitch=0.40, yidou=True, mat_wood=None,
                 railing_bays=None):
    """连廊 : stone plinth, entasis columns, 一斗三升 brackets, tiled roof."""
    W = mat_wood or MATS["timber"]
    p0 = V3(p0)
    p1 = V3(p1)
    L = (p1 - p0).length
    if L < 0.5:
        return None
    f, a, n, u = framef(p0, p1 - p0)
    # 台明
    lbox(mb, f, 0.0, L, -(half_w + 0.62), (half_w + 0.62), 0.0, plinth_h,
         MATS["stone"])
    lbox(mb, f, 0.0, L, -(half_w + 0.68), (half_w + 0.68),
         plinth_h - 0.05, plinth_h, MATS["paving"], mat_top=MATS["paving"])
    ncol = max(2, int(round(L / col_spacing)))
    xs = [L * (k / float(ncol)) for k in range(ncol + 1)]
    zt = plinth_h + col_h
    for xc in xs:
        for sy in (-1, 1):
            px = f(xc, sy * half_w, plinth_h)
            column_base(mb, px.x, px.y, plinth_h, COL_D * 0.86)
            column(mb, px.x, px.y, plinth_h, col_h, COL_D * 0.86, mat=W)
            if yidou:
                org = f(xc, sy * half_w, zt)
                yidousansheng(mb, org, (n.x * sy, n.y * sy, 0.0), mat_wood=W)
    for sy in (-1, 1):
        for k in range(ncol):
            xa, xb = xs[k], xs[k + 1]
            lbox(mb, f, xa + 0.20, xb - 0.20, sy * half_w - 0.075,
                 sy * half_w + 0.075, zt, zt + 0.30, W)
            lbox(mb, f, xa + 0.12, xb - 0.12, sy * half_w - 0.118,
                 sy * half_w + 0.118, zt + 0.30, zt + 0.45, MATS["paint"])
    # ---- roof ----
    mid = (p0 + p1) * 0.5
    ang = atan2(a.y, a.x)
    purlin_top = zt + 0.45 + 0.16
    purlin_out = half_w + 0.16
    flick = 0.86
    HD = half_w + purlin_out + flick
    rise = 1.46
    ez = purlin_top - rise * ((flick / HD) ** 1.38)
    RR = SongRoof(mid.x, mid.y, L * 0.5 + purlin_out + flick, HD, ez,
                  ez + rise, shoushan=0.0, break_t=1.0, corner_lift=0.30,
                  plan_bulge=0.16, rot=ang)
    build_roof(mb, RR, tile_pitch=tile_pitch, nv=8, thick=0.22,
               mat_wood=W, rafters=True)
    # ---- railings between alternate column pairs ----
    for sy in railing_side:
        for k in range(ncol):
            if railing_bays is not None and k not in railing_bays:
                continue
            xa = xs[k] + 0.26
            xb = xs[k + 1] - 0.26
            if xb - xa < 0.6:
                continue

            def fr(lx, ly, lz, xa=xa, sy=sy):
                return f(xa + lx, sy * (half_w - 0.14) + ly, lz)
            railing_xz(mb, fr, 0.0, xb - xa, plinth_h, 0.98)
    return f


# =============================================================================
#  ROOF PARAMETER HELPER
#  Places the eave so that the tiled surface lands exactly on top of the
#  liao-yan-fang (the outermost purlin carried by the bracket sets).
# =============================================================================
def make_roof(hw_bldg, hd_bldg, cx, cy, purlin_top, purlin_out, flick, rise,
              shoushan=0.0, break_t=1.0, end_over=None, q=1.38,
              corner_lift=0.62, plan_bulge=0.32, rot=0.0, ridge_axis='x'):
    over = purlin_out + flick
    eo = over if end_over is None else end_over
    if ridge_axis == 'x':
        HW = hw_bldg + eo
        HD = hd_bldg + over
        RT = rot
    else:
        HW = hd_bldg + eo
        HD = hw_bldg + over
        RT = rot + pi * 0.5
    ez = purlin_top - rise * ((flick / HD) ** q)
    return SongRoof(cx, cy, HW, HD, ez, ez + rise, shoushan=shoushan,
                    break_t=break_t, q=q, corner_lift=corner_lift,
                    plan_bulge=plan_bulge, rot=RT)


def roof_z_at(R, x, y, thick=0.0, n=160):
    """Under-surface height of a roof at a world (x, y) - used to close the
    gable walls exactly against the tiles."""
    sy = -1.0 if (y - R.cy) < 0 else 1.0
    dy = abs(y - R.cy)
    best = None
    for k in range(n + 1):
        tau = k / float(n)
        xm = R.xms(tau)
        if xm < 1e-7:
            continue
        u = (x - R.cx) / (R.hw * xm)
        if abs(u) > 1.0:
            continue
        try:
            p = R.slope(sy, u, tau)
        except Exception:
            continue
        d = abs(abs(p.y - R.cy) - dy)
        if best is None or d < best[0]:
            best = (d, p.z)
    return None if best is None else best[1] - thick


# =============================================================================
#  FACADE HELPERS :  column row, architrave, bracket line, gable wall
# =============================================================================
def beam2p(mb, p0, p1, w, h, mat=None):
    p0 = Vector(p0)
    p1 = Vector(p1)
    dv = Vector((p1.x - p0.x, p1.y - p0.y, 0.0))
    if dv.length < 1e-9:
        return
    sv = Vector((-dv.y, dv.x, 0.0)).normalized() * (w * 0.5)
    up = Vector((0.0, 0.0, h))
    a = [p0 - sv, p0 + sv, p0 + sv + up, p0 - sv + up]
    b = [p1 - sv, p1 + sv, p1 + sv + up, p1 - sv + up]
    i = mb.vs(a + b)
    mb.quad(i[0], i[3], i[2], i[1], mat)
    mb.quad(i[4], i[5], i[6], i[7], mat)
    for k in range(4):
        k2 = (k + 1) % 4
        mb.quad(i[k], i[k2], i[4 + k2], i[4 + k], mat)


def bracket_line(mb, tops, out_dir, n_tiao=3, mat=None, mpaint=None,
                 gongyan=True, lianfang=True):
    """柱头铺作 at every column + one 补间铺作 per bay, plus 阑额 / 普拍枋 /
    拱眼壁 / continuous 撩檐方.  Returns (top_z, outer_x)."""
    T = mat or MATS["timber"]
    P = mpaint or MATS["paint"]
    n = len(tops)
    # ---- 阑额 (architrave) : follows the sheng-qi rise of the columns ----
    for k in range(n - 1):
        p0 = Vector(tops[k])
        p1 = Vector(tops[k + 1])
        beam2p(mb, p0 - Vector((0.0, 0.0, 0.44)), p1 - Vector((0.0, 0.0, 0.44)),
               0.28, 0.44, T)
    # ---- 普拍枋 (flat plate) ----
    for k in range(n - 1):
        p0 = Vector(tops[k])
        p1 = Vector(tops[k + 1])
        beam2p(mb, p0, p1, 0.36, 0.215, P)
    # ---- bracket sets ----
    top_z, oX = 0.0, 0.0
    for t in tops:
        r = puzuo(mb, (t[0], t[1], t[2] + 0.215), out_dir, n_tiao=n_tiao,
                  mat_wood=T, mat_paint=P)
        top_z = r[0]
        oX = r[1]
    for k in range(n - 1):
        mid = (Vector(tops[k]) + Vector(tops[k + 1])) * 0.5
        r = puzuo(mb, (mid.x, mid.y, mid.z + 0.215), out_dir, n_tiao=n_tiao,
                  mat_wood=T, mat_paint=P)
        top_z = r[0]
        oX = r[1]
    # ---- 拱眼壁 (white panel behind the bracket sets) ----
    if gongyan:
        nx = Vector((out_dir[0], out_dir[1], 0.0)).normalized()
        for k in range(n - 1):
            p0 = Vector(tops[k])
            p1 = Vector(tops[k + 1])
            inn = -nx * 0.10
            z0 = max(p0.z, p1.z) + 0.215
            beam2p(mb, Vector((p0.x + inn.x, p0.y + inn.y, z0)),
                   Vector((p1.x + inn.x, p1.y + inn.y, z0)),
                   0.16, max(0.25, top_z - 0.42 - z0), MATS["wall"])
    # ---- continuous 撩檐方 (outer purlin) ----
    if lianfang:
        nx = Vector((out_dir[0], out_dir[1], 0.0)).normalized()
        for k in range(n - 1):
            p0 = Vector(tops[k]) + nx * oX
            p1 = Vector(tops[k + 1]) + nx * oX
            beam2p(mb, Vector((p0.x, p0.y, top_z - 0.345)),
                   Vector((p1.x, p1.y, top_z - 0.345)), 0.24, 0.345, P)
    return top_z, oX


def gable_wall(mb, R, x_wall, y0, y1, zb, thick=0.46, mat=None, thick_roof=0.34):
    """A gable end wall whose top edge follows the roof underside."""
    W = mat or MATS["wall"]
    N = 12
    rows = []
    for k in range(N + 1):
        y = lerp(y0, y1, k / float(N))
        zt = roof_z_at(R, x_wall, y, thick_roof)
        if zt is None:
            zt = zb + 0.5
        rows.append([(x_wall - thick * 0.5, y, zb),
                     (x_wall + thick * 0.5, y, zb),
                     (x_wall + thick * 0.5, y, max(zt, zb + 0.05)),
                     (x_wall - thick * 0.5, y, max(zt, zb + 0.05))])
    idx = [mb.vs(r) for r in rows]
    mb.grid(idx)


def stairs(mb, edge_c, out_dir, width, n, riser, tread, mat=None, fu_zi=0.26):
    """踏跺 in any direction: descends outward from a platform edge."""
    S = mat or MATS["stone"]
    od = nrm(V3(out_dir))
    perp = Vector((-od.y, od.x, 0.0))
    f, a, nn, u = framef(V3(edge_c), perp)
    for k in range(n):
        h = riser * (n - k)
        y0 = tread * k
        y1 = tread * (k + 1)
        lbox(mb, f, -width * 0.5, width * 0.5, y0, y1,
             max(0.0, h - riser - 0.22), h, S, mat_top=MATS["paving"])
        for sx in (-1, 1):
            lbox(mb, f, sx * width * 0.5, sx * (width * 0.5 + fu_zi),
                 y0, y1, max(0.0, h - riser - 0.26), h + 0.015, S)
    lbox(mb, f, -width * 0.5, width * 0.5, 0.0, tread * n, 0.0, riser * 0.9, S)


def bay_fill(mb, f, x0, x1, z0, z1, t=0.44, mat=None):
    lbox(mb, f, x0, x1, -t * 0.5, t * 0.5, z0, z1, mat or MATS["wall"])


# =============================================================================
#  山门  (south gate house)
# =============================================================================
def build_gate():
    mb = MB()
    cy = GATE_CY
    ph = 1.35
    hw = GATE_HW + ph
    hd = GATE_HD + ph
    zt = podium(mb, 0.0, cy, hw, hd, GATE_POD)
    stairs(mb, (0.0, cy - hd, 0.0), (0.0, -1.0, 0.0), 4.6, 3,
           GATE_POD / 3.0, 0.38)
    stairs(mb, (0.0, cy + hd, 0.0), (0.0, 1.0, 0.0), 4.6, 3,
           GATE_POD / 3.0, 0.38)

    xs = GATE_BAY_X
    xmax = max(abs(x) for x in xs)
    res = 0.18

    def rise(x):
        return res * ((abs(x) / xmax) ** 1.55)

    tf, tb = [], []
    for x in xs:
        for sy, arr in ((-1.0, tf), (1.0, tb)):
            y = cy + sy * GATE_HD
            hh = GATE_COL_H + rise(x)
            column(mb, x, y, zt, hh, COL_D,
                   lean=(-0.013 * (x / xmax), -sy * 0.013))
            column_base(mb, x, y, zt, COL_D)
            arr.append((x, y, zt + hh))
    topf = bracket_line(mb, tf, (0.0, -1.0, 0.0), n_tiao=2)
    topb = bracket_line(mb, tb, (0.0, 1.0, 0.0), n_tiao=2)
    zt_roof = max(topf[0], topb[0])
    oX = max(topf[1], topb[1])

    R = make_roof(GATE_HW, GATE_HD, 0.0, cy, zt_roof, oX, 0.90, 3.62,
                  shoushan=0.0, break_t=1.0, end_over=0.68, ridge_axis='x',
                  corner_lift=0.52)
    build_roof(mb, R, tile_pitch=0.35, nv=11, thick=0.30)

    # ---- 山墙 (gable walls) ----
    for sx in (-1, 1):
        gable_wall(mb, R, sx * (GATE_HW - 0.30), cy - GATE_HD,
                   cy + GATE_HD, zt, 0.46)
    # ---- facades ----
    zl = zt + GATE_COL_H + 0.02            # under the 阑额
    z_spring = zt + 0.55
    # south face
    fS, _, _, _ = framef((0.0, cy - GATE_HD, 0.0), (1.0, 0.0, 0.0))
    bay_fill(mb, fS, xs[0], xs[1], zt, zl, 0.46)
    bay_fill(mb, fS, xs[2], xs[3], zt, zl, 0.46)
    win_zhiling(mb, fS, xs[0] + 0.55, xs[1] - 0.55, z_spring + 0.75,
                zl - 0.30, 0.30, 7)
    win_zhiling(mb, fS, xs[2] + 0.55, xs[3] - 0.55, z_spring + 0.75,
                zl - 0.30, 0.30, 7)
    door_banmen(mb, fS, xs[1] + 0.10, xs[2] - 0.10, zt, zl, 0.30,
                open_ang=104.0)
    # north face : open portal, side bays walled
    fN, _, _, _ = framef((0.0, cy + GATE_HD, 0.0), (-1.0, 0.0, 0.0))
    bay_fill(mb, fN, xs[0], xs[1], zt, zl, 0.46)
    bay_fill(mb, fN, xs[2], xs[3], zt, zl, 0.46)
    win_zhiling(mb, fN, xs[0] + 0.55, xs[1] - 0.55, z_spring + 0.75,
                zl - 0.30, 0.30, 7)
    win_zhiling(mb, fN, xs[2] + 0.55, xs[3] - 0.55, z_spring + 0.75,
                zl - 0.30, 0.30, 7)
    lbox(mb, fN, xs[1] + 0.12, xs[2] - 0.12, -0.16, 0.16,
         zl - 0.62, zl, MATS["timber"])
    # 中柱 (central posts framing the passage)
    for x in (xs[1], xs[2]):
        column(mb, x, cy, zt, GATE_COL_H + 0.16, COL_D * 0.86)
        column_base(mb, x, cy, zt, COL_D * 0.86)
    # 地栿 / threshold
    lbox(mb, fS, xs[1], xs[2], -0.30, 0.30, zt, zt + 0.16, MATS["stone"])
    return join_objs([mb.build("CY_Gate")], "CY_Gate")


# =============================================================================
#  大殿  (central hall - the hero, single-eave 歇山顶 with 六铺作斗拱)
# =============================================================================
def build_hall():
    mb = MB()
    cy = HALL_CY
    ph = 1.85
    hw = HALL_HW + ph
    hd = HALL_HD + ph
    zt = podium(mb, 0.0, cy, hw, hd, HALL_POD)
    # 月台 (front terrace) + steps
    jcy = cy - hd - HALL_JUTOU_D
    podium(mb, 0.0, jcy, HALL_JUTOU_HW, HALL_JUTOU_D, HALL_POD)
    stairs(mb, (0.0, jcy - HALL_JUTOU_D, 0.0), (0.0, -1.0, 0.0), 5.6, 4,
           HALL_POD / 4.0, 0.40)
    stairs(mb, (hw, cy - hd * 0.42, 0.0), (1.0, 0.0, 0.0), 4.4, 3,
           HALL_POD / 3.0, 0.38)
    stairs(mb, (-hw, cy - hd * 0.42, 0.0), (-1.0, 0.0, 0.0), 4.4, 3,
           HALL_POD / 3.0, 0.38)

    xs = HALL_BAY_X
    xmax = max(abs(x) for x in xs)
    res = 0.22

    def rise(x):
        return res * ((abs(x) / xmax) ** 1.55)

    tf, tb = [], []
    for x in xs:
        for sy, arr in ((-1.0, tf), (1.0, tb)):
            y = cy + sy * HALL_HD
            hh = HALL_COL_H + rise(x)
            column(mb, x, y, zt, hh, COL_D, seg=16,
                   lean=(-0.011 * (x / xmax), -sy * 0.011))
            column_base(mb, x, y, zt, COL_D)
            arr.append((x, y, zt + hh))
    topf = bracket_line(mb, tf, (0.0, -1.0, 0.0), n_tiao=3)
    topb = bracket_line(mb, tb, (0.0, 1.0, 0.0), n_tiao=3)
    zt_roof = max(topf[0], topb[0])
    oX = max(topf[1], topb[1])

    # 金柱 (inner column row) - the facade wall stands on this line
    for x in xs:
        column(mb, x, cy, zt, HALL_COL_H + rise(x), COL_D * 0.96,
               seg=16, lean=(-0.011 * (x / xmax), 0.0))
        column_base(mb, x, cy, zt, COL_D * 0.96)

    # ---- roof : 单檐歇山顶 ----
    R = make_roof(HALL_HW, HALL_HD, 0.0, cy, zt_roof, oX, 0.94, 5.05,
                  shoushan=2.35, break_t=0.56, ridge_axis='x',
                  corner_lift=0.72, plan_bulge=0.36)
    build_roof(mb, R, tile_pitch=0.34, nv=12, thick=0.32)

    # ---- end bracket lines : the bracket sets wrap the building ----
    zc = zt + HALL_COL_H + res
    zm = zt + HALL_COL_H
    for sx in (-1, 1):
        te = [(sx * HALL_HW, cy - HALL_HD, zc),
              (sx * HALL_HW, cy, zm),
              (sx * HALL_HW, cy + HALL_HD, zc)]
        bracket_line(mb, te, (float(sx), 0.0, 0.0), n_tiao=3)

    # ---- 山墙 / end walls closed against the tiles ----
    for sx in (-1, 1):
        gable_wall(mb, R, sx * (HALL_HW - 0.02), cy - HALL_HD,
                   cy + HALL_HD, zt, 0.48, thick_roof=0.36)

    # ---- front facade at the 金柱 line : 格子门 + 直棂窗 ----
    zl = zt + HALL_COL_H + 0.42
    fF, _, _, _ = framef((0.0, cy, 0.0), (1.0, 0.0, 0.0))
    bays = [(xs[i], xs[i + 1]) for i in range(len(xs) - 1)]
    for i, (a, b) in enumerate(bays):
        if i == 2:
            door_banmen(mb, fF, a + 0.16, b - 0.16, zt, zl, 0.34,
                        open_ang=98.0)
            lbox(mb, fF, a, a + 0.16, -0.26, 0.26, zt, zl, MATS["timber"])
            lbox(mb, fF, b - 0.16, b, -0.26, 0.26, zt, zl, MATS["timber"])
        elif i in (1, 3):
            door_gezi(mb, fF, a + 0.16, b - 0.16, zt, zl, 4, 0.34)
        else:
            bay_fill(mb, fF, a, b, zt, zt + 1.05, 0.46)
            win_zhiling(mb, fF, a + 0.20, b - 0.20, zt + 1.05, zl - 0.10,
                        0.32, 8)
    # ---- 后檐墙 (rear wall) ----
    fB, _, _, _ = framef((0.0, cy, 0.0), (-1.0, 0.0, 0.0))
    for i, (a, b) in enumerate(bays):
        if i in (1, 3, 2):
            bay_fill(mb, fB, a + 0.16, b - 0.16, zt, zt + 1.05, 0.46)
            win_zhiling(mb, fB, a + 0.30, b - 0.30, zt + 1.05, zl - 0.10,
                        0.32, 6)
        else:
            bay_fill(mb, fB, a, b, zt, zl, 0.46)
    # ---- 阑槛 (railing between the front eave columns : 阑槛钩窗) ----
    y_rail = cy - HALL_HD
    for (a, b) in bays:
        xa = a + 0.30
        xb = b - 0.30

        def fr(lx, ly, lz, xa=xa):
            return Vector((xa + lx, y_rail + ly, lz))
        railing_xz(mb, fr, 0.0, xb - xa, zt, 0.92)
    return join_objs([mb.build("CY_Hall")], "CY_Hall")


# =============================================================================
#  攒尖顶  (four-slope pyramidal roof, meeting at one apex + 宝顶 finial)
# =============================================================================
def pyramid_roof(mb, cx, cy, hw, ez, az, rot=0.0, q=1.36, corner_lift=0.44,
                 tile_pitch=0.30, nv=9, thick=0.26, mat_tile=None,
                 mat_wood=None, finial=True):
    MT = mat_tile or MATS["tile"]
    MW = mat_wood or MATS["timber"]
    cz, sz = cos(rot), sin(rot)

    def _x(x, y):
        return cx + x * cz - y * sz, cy + x * sz + y * cz

    def pt(side, a, tau):
        tau = clamp(tau, 0.0, 1.0)
        d1 = 1.0 - tau
        u3 = abs(a) ** 3.0
        lift = corner_lift * u3 * (d1 ** 1.6)
        z = ez + (az - ez) * (tau ** q) + lift
        if side == 0:
            x, y = a * hw * d1, -hw * d1
        elif side == 1:
            x, y = hw * d1, a * hw * d1
        elif side == 2:
            x, y = -a * hw * d1, hw * d1
        else:
            x, y = -hw * d1, -a * hw * d1
        X, Y = _x(x, y)
        return Vector((X, Y, z))

    def frame(side, a, tau):
        P = pt(side, a, tau)
        Pa = pt(side, a + 4e-3, tau) - pt(side, a - 4e-3, tau)
        Pb = pt(side, a, tau + 4e-3) - pt(side, a, tau - 4e-3)
        N = Pa.cross(Pb)
        if N.length < 1e-9:
            N = Vector((0.0, 0.0, 1.0))
        N.normalize()
        if N.z < 0:
            N = -N
        S = Pa - N * Pa.dot(N)
        if S.length < 1e-9:
            S = Vector((1.0, 0.0, 0.0))
        return P, N, S.normalized()

    nl = max(5, int(round(2.0 * hw / tile_pitch)) + 1)
    for side in range(4):
        def rf(a, b, side=side):
            return frame(side, a, b)
        top = sheet_pts(rf, nl, nv, hollow=0.018, crown=0.004)
        bot = [[p - Vector((0.0, 0.0, thick)) for p in r] for r in top]
        mb.grid([mb.vs(r) for r in top], MT)
        mb.grid([mb.vs(r) for r in bot], MW)
        mb.strip(top[0], bot[0], MW)
        tile_longs(mb, rf, nl, nv, MT, r=0.098, h=0.088, b0=0.02, b1=0.98,
                   wadang=False)
        # fascia + rafter tails
        rafter_ends(mb, rf, 0.40, MW, 2.0 * hw * 0.94, out_len=0.44,
                    in_len=0.85, feizi=False)
    # hip ridges (垂脊) to the apex
    ngt = 8
    for k in range(4):
        path, ups, sds = [], [], []
        for j in range(ngt):
            tau = j / float(ngt - 1)
            P, N, _ = frame(k, 1.0, min(tau, 0.998))
            path.append(P + N * 0.04)
            ups.append(N)
            t2 = frame(k, 1.0, min(tau + 0.03, 1.0))[0] - \
                frame(k, 1.0, max(tau - 0.03, 0.0))[0]
            sds.append(nrm(t2.cross(N)))
        ridge_strip(mb, path, ups, sds, 0.22, 0.20, MT, taper_end=0.35)
    # 宝顶 (finial)
    if finial:
        base = (cx, cy, az + 0.04)
        mb.cyl(cx, cy, base[2], base[2] + 0.13, 0.30, 0.24, 12, MT)
        mb.cyl(cx, cy, base[2] + 0.13, base[2] + 0.30, 0.15, 0.30, 14, MT)
        mb.cyl(cx, cy, base[2] + 0.30, base[2] + 0.62, 0.30, 0.20, 14, MT)
        mb.cyl(cx, cy, base[2] + 0.62, base[2] + 0.74, 0.20, 0.10, 12, MT)
        mb.cyl(cx, cy, base[2] + 0.74, base[2] + 1.02, 0.075, 0.03, 10, MT)


# =============================================================================
#  临水茶亭  (waterside tea pavilion on a stone terrace)
# =============================================================================
def build_tea_pavilion():
    mb = MB()
    cx, cy = TEA_CX, TEA_CY
    hw = TEA_HW
    podium(mb, cx, cy, hw + 0.95, hw + 0.95, TEA_POD)
    zt = TEA_POD
    for sx in (-1, 1):
        for sy in (-1, 1):
            px, py = cx + sx * hw, cy + sy * hw
            column_base(mb, px, py, zt, COL_D * 0.90)
            column(mb, px, py, zt, TEA_COL_H, COL_D * 0.90,
                   lean=(-sx * 0.014, -sy * 0.014))
    ztk = zt + TEA_COL_H
    for sx in (-1, 1):
        for sy in (-1, 1):
            yidousansheng(mb, (cx + sx * hw, cy + sy * hw, ztk),
                          (float(sx), float(sy), 0.0))
            yidousansheng(mb, (cx + sx * hw, cy + sy * hw, ztk),
                          (float(sx), 0.0, 0.0))
            yidousansheng(mb, (cx + sx * hw, cy + sy * hw, ztk),
                          (0.0, float(sy), 0.0))
    for sy in (-1, 1):
        beam2p(mb, (cx - hw, cy + sy * hw, ztk - 0.42),
               (cx + hw, cy + sy * hw, ztk - 0.42), 0.24, 0.42,
               MATS["timber"])
    for sx in (-1, 1):
        beam2p(mb, (cx + sx * hw, cy - hw, ztk - 0.42),
               (cx + sx * hw, cy + hw, ztk - 0.42), 0.24, 0.42,
               MATS["timber"])
    ez = ztk + 0.52
    pyramid_roof(mb, cx, cy, hw + 1.05, ez, ez + 2.95, q=1.34,
                 corner_lift=0.62, tile_pitch=0.29, nv=9, thick=0.26)
    # 坐凳栏杆 on three sides (the south side stays open to the water)
    fW, _, _, _ = framef((cx - hw + 0.14, cy, 0.0), (0.0, 1.0, 0.0))
    railing_xz(mb, lambda lx, ly, lz: fW(lx, ly, lz),
               -hw + 0.28, hw - 0.28, zt, 0.60)
    fE, _, _, _ = framef((cx + hw - 0.14, cy, 0.0), (0.0, 1.0, 0.0))
    railing_xz(mb, lambda lx, ly, lz: fE(lx, ly, lz),
               -hw + 0.28, hw - 0.28, zt, 0.60)
    fN, _, _, _ = framef((cx, cy + hw - 0.14, 0.0), (1.0, 0.0, 0.0))
    railing_xz(mb, lambda lx, ly, lz: fN(lx, ly, lz),
               -hw + 0.28, hw - 0.28, zt, 0.60)
    return join_objs([mb.build("CY_Pavilion")], "CY_Pavilion")


# =============================================================================
#  书院  (east academy : three-bay 悬山顶 hall)
# =============================================================================
def build_academy():
    mb = MB()
    cx, cy = ACAD_CX, ACAD_CY
    ph = 1.45
    hw = ACAD_HW + ph
    hd = ACAD_HD + ph
    zt = podium(mb, cx, cy, hw, hd, 0.62)
    stairs(mb, (cx, cy - hd, 0.0), (0.0, -1.0, 0.0), 4.0, 3, 0.62 / 3.0, 0.36)
    xs = [cx + v for v in ACAD_BAY_X]
    xmax = max(abs(v) for v in ACAD_BAY_X)
    res = 0.15

    def rise(v):
        return res * ((abs(v) / xmax) ** 1.55)

    tf, tb = [], []
    for v in ACAD_BAY_X:
        x = cx + v
        for sy, arr in ((-1.0, tf), (1.0, tb)):
            y = cy + sy * ACAD_HD
            hh = ACAD_COL_H + rise(v)
            column(mb, x, y, zt, hh, COL_D,
                   lean=(-0.013 * (v / xmax), -sy * 0.013))
            column_base(mb, x, y, zt, COL_D)
            arr.append((x, y, zt + hh))
    topf = bracket_line(mb, tf, (0.0, -1.0, 0.0), n_tiao=2)
    topb = bracket_line(mb, tb, (0.0, 1.0, 0.0), n_tiao=2)
    zt_roof = max(topf[0], topb[0])
    oX = max(topf[1], topb[1])
    R = make_roof(ACAD_HW, ACAD_HD, cx, cy, zt_roof, oX, 0.86, 3.10,
                  shoushan=0.0, break_t=1.0, end_over=0.62, ridge_axis='x',
                  corner_lift=0.48)
    build_roof(mb, R, tile_pitch=0.34, nv=10, thick=0.28)
    for sx in (-1, 1):
        gable_wall(mb, R, cx + sx * (ACAD_HW - 0.28), cy - ACAD_HD,
                   cy + ACAD_HD, zt, 0.44)
    zl = zt + ACAD_COL_H + 0.02
    bays = [(cx + ACAD_BAY_X[i], cx + ACAD_BAY_X[i + 1])
            for i in range(len(ACAD_BAY_X) - 1)]
    # NOTE: the panel frames keep their origin at x = 0 so the bay extents
    # (which are absolute world X) can be passed straight through as lx.
    fF, _, _, _ = framef((0.0, cy - ACAD_HD, 0.0), (1.0, 0.0, 0.0))
    fB, _, _, _ = framef((0.0, cy + ACAD_HD, 0.0), (-1.0, 0.0, 0.0))
    for i, (a, b) in enumerate(bays):
        if i == 1:
            door_gezi(mb, fF, a + 0.18, b - 0.18, zt, zl, 4, 0.32)
        else:
            bay_fill(mb, fF, a, b, zt, zt + 0.90, 0.46)
            win_zhiling(mb, fF, a + 0.22, b - 0.22, zt + 0.90, zl - 0.12,
                        0.30, 7)
        bay_fill(mb, fB, a + 0.16, b - 0.16, zt, zt + 0.95, 0.46)
        win_zhiling(mb, fB, a + 0.34, b - 0.34, zt + 0.95, zl - 0.12,
                    0.30, 5)
    return join_objs([mb.build("CY_Academy")], "CY_Academy")


# =============================================================================
#  廊桥  (covered bridge over the water court)
# =============================================================================
def build_bridge(mb, p0, p1, deck_z=0.46, half_w=1.30, col_h=2.95):
    p0 = V3(p0)
    p1 = V3(p1)
    L = (p1 - p0).length
    d = nrm(p1 - p0)
    # stone piers
    for t in (0.26, 0.74):
        c = p0 + (p1 - p0) * t
        mb.box(c.x - 0.75, c.x + 0.75, c.y - 0.60, c.y + 0.60,
               -1.35, deck_z - 0.16, MATS["stone"])
    # deck
    f, a, n, u = framef(p0, p1 - p0)
    lbox(mb, f, -0.4, L + 0.4, -(half_w + 0.35), (half_w + 0.35),
         deck_z - 0.16, deck_z, MATS["paving"], mat_top=MATS["paving"])
    corridor_run(mb, p0, p1, half_w=half_w, col_h=col_h,
                 plinth_h=deck_z, col_spacing=2.6,
                 railing_side=(-1, 1), tile_pitch=0.34)
    return f


# =============================================================================
#  围墙  (perimeter walls with tiled capping)
# =============================================================================
def build_perimeter():
    mb = MB()
    # south (gate is centred at x = 0, opening 17.6 wide)
    wall_run(mb, (-CX, -CY), (CX, -CY), gate_gaps=[(CX - 8.8, CX + 8.8)])
    # north
    wall_run(mb, (CX, CY), (-CX, CY))
    # west
    wall_run(mb, (-CX, -CY), (-CX, CY))
    # east : a small side gate for the academy
    wall_run(mb, (CX, CY), (CX, -CY),
             gate_gaps=[(CY + 14.0, CY + 17.4)])
    # collar walls flanking the gate house
    for sx in (-1, 1):
        wall_run(mb, (sx * 8.8, -CY), (sx * GATE_HW, GATE_CY + GATE_HD + 1.2))
    # 角柱 at the four corners (slightly thicker piers)
    for sx in (-1, 1):
        for sy in (-1, 1):
            mb.box(sx * CX - 1.25, sx * CX + 1.25, sy * CY - 1.25,
                   sy * CY + 1.25, 0.0, WALL_H + 0.62, MATS["wall"])
            mb.box(sx * CX - 1.45, sx * CX + 1.45, sy * CY - 1.45,
                   sy * CY + 1.45, WALL_H + 0.62, WALL_H + 0.86,
                   MATS["tile"])
    return join_objs([mb.build("CY_Walls")], "CY_Walls")


def build_corridors():
    mb = MB()
    # 廊庑 flanking the front court, running north-south
    corridor_run(mb, (-17.3, -31.4), (-17.3, -3.2), half_w=1.50,
                 railing_side=(-1,), tile_pitch=0.40)
    corridor_run(mb, (17.3, -31.4), (17.3, -3.2), half_w=1.50,
                 railing_side=(1,), tile_pitch=0.40)
    # rear cross corridor behind the hall
    corridor_run(mb, (-17.3, 8.4), (17.3, 8.4), half_w=1.50,
                 railing_side=(-1,), tile_pitch=0.40)
    return join_objs([mb.build("CY_Corridors")], "CY_Corridors")


# =============================================================================
#  GARDEN  --  still water, scholar rocks, pine, bamboo, misty mountains
# =============================================================================
def pond_polygon(cx, cy, rx, ry, n=44, wob=0.17, seed=7.0):
    pts = []
    for k in range(n):
        a = 2.0 * pi * k / n
        r = (1.0 + wob * 0.66 * sin(3 * a + seed)
             + wob * 0.36 * sin(5 * a + seed * 1.7)
             + wob * 0.22 * sin(7 * a + seed * 2.3))
        pts.append((cx + cos(a) * rx * r, cy + sin(a) * ry * r))
    return pts


def offset_poly(pts, d):
    n = len(pts)
    out = []
    for i in range(n):
        p0 = Vector((pts[i - 1][0], pts[i - 1][1]))
        p1 = Vector((pts[i][0], pts[i][1]))
        p2 = Vector((pts[(i + 1) % n][0], pts[(i + 1) % n][1]))
        e1 = nrm(p1 - p0)
        e2 = nrm(p2 - p1)
        n1 = Vector((e1.y, -e1.x))
        n2 = Vector((e2.y, -e2.x))
        nn = nrm(n1 + n2)
        if nn.length < 1e-6:
            nn = n1
        out.append((p1.x + nn.x * d, p1.y + nn.y * d))
    return out


def ring_loop(pts, z):
    return [(p[0], p[1], z) for p in pts]


def poly_inside(pts, x, y):
    n = len(pts)
    ins = False
    j = n - 1
    for i in range(n):
        xi, yi = pts[i]
        xj, yj = pts[j]
        if (yi > y) != (yj > y):
            if x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                ins = not ins
        j = i
    return ins


def poly_dist(pts, x, y):
    """minimum distance from (x, y) to the polygon boundary (unsigned)."""
    n = len(pts)
    d = 1e9
    j = n - 1
    for i in range(n):
        xi, yi = pts[i]
        xj, yj = pts[j]
        dx, dy = xj - xi, yj - yi
        L2 = dx * dx + dy * dy
        t = 0.0 if L2 < 1e-12 else clamp(((x - xi) * dx + (y - yi) * dy) / L2)
        px, py = xi + t * dx, yi + t * dy
        d = min(d, hypot(x - px, y - py))
        j = i
    return d


def build_ground(mb, pond_pts, paved_rects, r1=390.0, nr=122, nseg=240):
    """The whole terrain is ONE polar mesh centred on the compound.

    Sample spacing grows geometrically with radius, so the courtyard is
    resolved to about a metre while the far hills stay cheap - and because
    there is only a single continuous surface, no seam, material break or
    z-fight ring can exist anywhere in the landscape.
    """
    cut = offset_poly(pond_pts, 0.60)
    r0 = 0.75
    grid = []
    for j in range(nr + 1):
        t = j / float(nr)
        rr = r0 * ((r1 / r0) ** t)
        row = []
        for i in range(nseg):
            a = 2.0 * pi * i / nseg
            x = cos(a) * rr
            y = sin(a) * rr
            z = terrain_z(x, y) + hill_z(x, y) + \
                0.028 * sin(x * 0.11 + 1.2) * cos(y * 0.13 - 0.4)
            row.append((x, y, z))
        grid.append(row)
    idx = [mb.vs(r) for r in grid]
    for j in range(nr):
        r0_pts, r1_pts = idx[j], idx[j + 1]
        for i in range(nseg):
            i2 = (i + 1) % nseg
            q = (grid[j][i], grid[j][i2], grid[j + 1][i2], grid[j + 1][i])
            if (poly_inside(cut, q[0][0], q[0][1]) or
                    poly_inside(cut, q[1][0], q[1][1]) or
                    poly_inside(cut, q[2][0], q[2][1]) or
                    poly_inside(cut, q[3][0], q[3][1])):
                continue
            cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) * 0.25
            cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) * 0.25
            m = MATS["mountain"]
            for (a, b, c, d) in paved_rects:
                if a <= cx <= b and c <= cy <= d:
                    m = MATS["paving"]
                    break
            else:
                if poly_dist(pond_pts, cx, cy) < 2.6:
                    m = MATS["moss"]
                elif abs(cx) < CX and abs(cy) < CY:
                    m = MATS["soil"]
            mb.quad(r0_pts[i], r0_pts[i2], r1_pts[i2], r1_pts[i], m)
    return grid


HILLS = []


def init_hills(seed=5.0):
    """Build the deterministic list of hill domes once."""
    global HILLS
    rnd = random.Random(int(seed * 31337))
    HILLS = []
    for k in range(54):                     # far ranges 205 - 380 m
        a = 2.0 * pi * k / 54.0 + rnd.uniform(-0.11, 0.11)
        rad = rnd.uniform(205.0, 380.0)
        H = max(4.0, (100.0 - 0.235 * rad) * rnd.uniform(0.45, 1.05))
        rx = rnd.uniform(60.0, 155.0)
        HILLS.append((cos(a) * rad, sin(a) * rad, rx,
                      rx * rnd.uniform(0.42, 0.95), H, rnd.uniform(0, 6.283)))
    for k in range(30):                     # middle 128 - 205 m
        a = 2.0 * pi * k / 30.0 + rnd.uniform(-0.18, 0.18)
        rad = rnd.uniform(128.0, 205.0)
        rx = rnd.uniform(34.0, 74.0)
        HILLS.append((cos(a) * rad, sin(a) * rad, rx, rx * 0.78,
                      rnd.uniform(9.0, 26.0), rnd.uniform(0, 6.283)))
    for k in range(14):                     # low wooded rises 62 - 118 m
        a = rnd.uniform(0, 2 * pi)
        rad = rnd.uniform(62.0, 118.0)
        rx = rnd.uniform(18.0, 40.0)
        HILLS.append((cos(a) * rad, sin(a) * rad, rx, rx * 0.82,
                      rnd.uniform(2.5, 7.5), rnd.uniform(0, 6.283)))


def hill_z(x, y):
    """Max of all domes -> one coherent ridge line, no double counting."""
    z = 0.0
    for (cx, cy, rx, ry, H, ph) in HILLS:
        dx = (x - cx) / rx
        dy = (y - cy) / ry
        r2 = dx * dx + dy * dy
        if r2 >= 1.0:
            continue
        r = sqrt(r2)
        env = (1.0 - r2) ** 1.30 * (1.0 - 0.30 * r)
        ang = atan2(dy, dx)
        mod = 0.70 + 0.32 * sin(ang * 3.0 + ph) + 0.16 * sin(ang * 5.0 -
                                                            ph * 1.7)
        zz = H * env * mod
        if zz > z:
            z = zz
    return z


def ground_z(x, y):
    return terrain_z(x, y) + hill_z(x, y)


def terrain_z(x, y):
    """Shared ground field: dead flat around the compound, gently rolling
    further out, so the outer landscape is not a sheet of paper."""
    dx = max(0.0, abs(x) - (CX + 9.0))
    dy = max(0.0, abs(y) - (CY + 9.0))
    d = hypot(dx, dy)
    t = smoothstep(clamp(d / 52.0))
    n1 = (0.5 + 0.5 * sin(x * 0.0082 + 0.7)) * \
        (0.5 + 0.5 * sin(y * 0.0104 - 2.1)) * 2.0 - 1.0
    n2 = (0.5 + 0.5 * sin(x * 0.0213 - 1.3)) * \
        (0.5 + 0.5 * cos(y * 0.0176 + 0.4)) * 2.0 - 1.0
    n3 = (0.5 + 0.5 * sin(x * 0.0031 + 2.9)) * \
        (0.5 + 0.5 * sin(y * 0.0027 + 1.2)) * 2.0 - 1.0
    return t * (n1 * 1.5 + n2 * 0.55 + n3 * 2.5)


def build_pond(mb, pts, water_z=-0.42, bot_z=-1.62):
    """Bank rings + still water surface."""
    rings = [(7.00, -0.050), (3.40, -0.070), (1.70, -0.120),
             (0.86, -0.250), (0.42, -0.400), (0.05, -0.560),
             (-1.10, -1.180), (-2.10, bot_z)]
    loops = []
    for d, z in rings:
        loops.append(ring_loop(offset_poly(pts, d), z))
    idx = [mb.vs(r) for r in loops]
    for k in range(len(idx) - 1):
        r0, r1 = idx[k], idx[k + 1]
        n = len(r0)
        for i in range(n):
            i2 = (i + 1) % n
            mb.quad(r0[i], r0[i2], r1[i2], r1[i], MATS["stone"])
    # bottom
    mb.face(tuple(reversed(idx[-1])), MATS["stone"])
    # water disc
    wpts = offset_poly(pts, 0.38)
    c = (sum(p[0] for p in wpts) / len(wpts),
         sum(p[1] for p in wpts) / len(wpts))
    ci = mb.v((c[0], c[1], water_z))
    wi = [mb.v((p[0], p[1], water_z)) for p in wpts]
    n = len(wi)
    for i in range(n):
        mb.tri(ci, wi[i], wi[(i + 1) % n], MATS["water"])
    # scattered stone coping around the rim
    rnd = random.Random(31)
    rim = offset_poly(pts, 0.55)
    for i, p in enumerate(rim):
        if i % 2:
            continue
        s = rnd.uniform(0.75, 1.35)
        mb.obox(Vector((p[0], p[1], -0.42 + rnd.uniform(-0.06, 0.12))),
                Vector((0.30 * s, 0.42 * s, 0.20 * s)),
                MATS["rock"],
                rot=Matrix.Rotation(rnd.uniform(0, 3.14), 3, 'Z'))


def scholar_rock(mb, cx, cy, z0, r_major=0.95, r_minor=0.40, h=1.85,
                 seed=1.0, rot=0.0, mat=None):
    """太湖石 : a pierced, lumpy vertical rock (torus base + noise + stretch)."""
    M = mat or MATS["rock"]
    rings, seg = 9, 18
    pts = []
    for i in range(rings):
        a = 2.0 * pi * i / rings
        for j in range(seg):
            b = 2.0 * pi * j / seg
            R = r_major * (1.0 + 0.36 * sin(2 * a + seed) +
                           0.20 * sin(3 * a + seed * 1.7))
            rr = r_minor * (1.0 + 0.32 * sin(3 * b + seed * 2.1) +
                            0.18 * sin(5 * a + seed))
            x = (R + rr * cos(b)) * cos(a)
            y = (R + rr * cos(b)) * sin(a)
            z = rr * sin(b) * h
            nx = 0.11 * r_major * sin(4 * b + 2 * a + seed)
            ny = 0.11 * r_major * cos(3 * b - 1.4 * a + seed)
            ca, sa = cos(rot), sin(rot)
            pts.append((cx + x * ca - (y + ny) * sa,
                        cy + x * sa + (y + ny) * ca,
                        z0 + z + h * r_minor * 0.55))
    faces = []
    for i in range(rings):
        i2 = (i + 1) % rings
        for j in range(seg):
            j2 = (j + 1) % seg
            faces.append((i * seg + j, i * seg + j2, i2 * seg + j2,
                          i2 * seg + j))
    base = len(mb.verts)
    for p in pts:
        mb.v(p)
    for f in faces:
        mb.face(tuple(base + k for k in f), M)


def pine_tree(mb, cx, cy, z0, height=7.2, seed=0.0, lean=(0.06, -0.03),
              pads=7):
    """松: leaning entasis trunk, gnarled branches, layered needle pads."""
    T = MATS["bark"]
    P = MATS["pine"]
    rnd = random.Random(int(seed * 7919) + 3)
    NS = 8
    rings = []
    for k in range(NS):
        t = k / float(NS - 1)
        z = z0 + height * t
        rr = 0.30 * (1.0 - 0.62 * t) * (1.0 + 0.10 * sin(t * 9 + seed))
        x = cx + lean[0] * height * (t ** 1.5) + 0.16 * sin(t * 4.2 + seed)
        y = cy + lean[1] * height * (t ** 1.5) + 0.14 * cos(t * 3.6 + seed)
        rings.append([(x + cos(2 * pi * j / 10) * rr,
                       y + sin(2 * pi * j / 10) * rr, z) for j in range(10)])
    mb.loft(rings, T, close_ring=True, cap_start=True)
    top = Vector(rings[-1][0])
    # branches
    for k in range(pads):
        t = 0.34 + 0.60 * (k / float(max(1, pads - 1)))
        z = z0 + height * t
        base = Vector((cx + lean[0] * height * (t ** 1.5),
                       cy + lean[1] * height * (t ** 1.5), z))
        na = 3 + (k % 3)
        for m in range(na):
            a = 2.0 * pi * (m / float(na)) + k * 0.9 + seed
            L = (2.5 - 1.3 * t) * rnd.uniform(0.75, 1.2)
            dirv = Vector((cos(a), sin(a), 0.30 + 0.24 * rnd.random()))
            dirv.normalize()
            p1 = base + dirv * L
            b0 = base + Vector((0, 0, -0.10))
            pr = []
            for q in range(4):
                tt = q / 3.0
                c = vlerp(b0, p1, tt)
                c.z += 0.28 * sin(tt * pi) * 0.6
                c.z -= 0.34 * tt * tt
                rr = 0.115 * (1.0 - 0.55 * tt)
                pr.append([(c.x + cos(2 * pi * jj / 6) * rr,
                            c.y + sin(2 * pi * jj / 6) * rr, c.z)
                           for jj in range(6)])
            mb.loft(pr, T, close_ring=True, cap_start=True, cap_end=True)
            pad_c = p1 + Vector((0, 0, 0.10))
            _needle_pad(mb, pad_c, 1.05 + rnd.uniform(0.0, 0.5), P, seed + m)
    _needle_pad(mb, Vector((cx + lean[0] * height * 0.95,
                            cy + lean[1] * height * 0.95,
                            z0 + height * 0.99)), 0.85, P, seed + 40)


def _needle_pad(mb, c, r, mat, seed=0.0):
    """A flattened, slightly spiky dome - reads as a mass of pine needles."""
    rings = 4
    seg = 14
    loops = []
    for k in range(rings):
        t = k / float(rings)
        rr = r * (1.0 - t * 0.92)
        zz = c.z + 0.30 * r * (t ** 0.7) * 0.85
        ring = []
        for j in range(seg):
            a = 2 * pi * j / seg
            sp = 1.0 + 0.20 * sin(5 * a + seed) + 0.14 * sin(9 * a + seed * 2)
            ring.append((c.x + cos(a) * rr * sp, c.y + sin(a) * rr * sp,
                         zz + 0.06 * r * sin(7 * a + seed)))
        loops.append(ring)
    loops.append([(c.x, c.y, c.z + 0.34 * r)] * seg)
    mb.loft(loops, mat, close_ring=True, cap_start=True)


def bamboo_clump(mb, cx, cy, z0, n=11, height=6.4, spread=1.5, seed=0.0):
    T = MATS["bark"]
    L = MATS["leaf"]
    rnd = random.Random(int(seed * 104729) + 11)
    for k in range(n):
        a = rnd.uniform(0, 2 * pi)
        rr = spread * sqrt(rnd.random())
        bx = cx + cos(a) * rr
        by = cy + sin(a) * rr
        h = height * rnd.uniform(0.62, 1.0)
        lean = Vector((rnd.uniform(-0.055, 0.055), rnd.uniform(-0.055, 0.055),
                       0.0))
        r0 = 0.075 * rnd.uniform(0.8, 1.2)
        NS = 7
        rings = []
        for q in range(NS):
            t = q / float(NS - 1)
            rings.append([(bx + lean.x * h * t + cos(2 * pi * j / 6) * r0 *
                           (1.0 - 0.35 * t),
                           by + lean.y * h * t + sin(2 * pi * j / 6) * r0 *
                           (1.0 - 0.35 * t),
                           z0 + h * t) for j in range(6)])
        mb.loft(rings, T, close_ring=True, cap_start=True)
        # node rings (竹节)
        for q in range(1, NS - 1, 2):
            t = q / float(NS - 1)
            mb.cyl(bx + lean.x * h * t, by + lean.y * h * t,
                   z0 + h * t - 0.03, z0 + h * t + 0.03,
                   r0 * (1.0 - 0.35 * t) * 1.20, r0 * (1.0 - 0.35 * t) * 1.20,
                   6, T)
        # leaf sprays at the top
        for q in range(5):
            t = 0.60 + 0.40 * (q / 4.0)
            la = rnd.uniform(0, 2 * pi)
            c = Vector((bx + lean.x * h * t, by + lean.y * h * t, z0 + h * t))
            d = Vector((cos(la), sin(la), rnd.uniform(-0.5, 0.2))).normalized()
            _leaf_spray(mb, c + d * 0.45, L, rnd, seed + k * 7 + q)


def _leaf_spray(mb, c, mat, rnd, seed=0.0):
    """A small fan of flat bamboo leaves."""
    for k in range(9):
        a = rnd.uniform(0, 2 * pi)
        L = rnd.uniform(0.32, 0.72)
        w = rnd.uniform(0.045, 0.075)
        d = Vector((cos(a), sin(a), rnd.uniform(-0.75, 0.05))).normalized()
        side = nrm(d.cross(Vector((0, 0, 1))))
        if side.length < 1e-6:
            side = Vector((1, 0, 0))
        p0 = c
        p1 = c + d * L
        pts = [p0 - side * w, p0 + side * w, p1 + side * w * 0.35,
               p1 - side * w * 0.35]
        i = mb.vs(pts)
        mb.quad(i[0], i[1], i[2], i[3], mat)
        mb.quad(i[3], i[2], i[1], i[0], mat)


def fake_mountain(mb, cx, cy, z0, scale=1.0, seed=3.0, n=5):
    """假山 : a stacked cluster of pierced scholar rocks."""
    rnd = random.Random(int(seed * 977) + 7)
    for k in range(n):
        a = 2 * pi * k / n + rnd.uniform(-0.4, 0.4)
        rr = scale * rnd.uniform(0.5, 1.9)
        scholar_rock(mb, cx + cos(a) * rr, cy + sin(a) * rr,
                     z0 + rnd.uniform(-0.1, 0.5),
                     r_major=scale * rnd.uniform(0.55, 1.05),
                     r_minor=scale * rnd.uniform(0.24, 0.44),
                     h=rnd.uniform(1.3, 2.6) * scale,
                     seed=seed + k * 1.7, rot=rnd.uniform(0, 3.14))
    scholar_rock(mb, cx, cy, z0 + scale * 1.3,
                 r_major=scale * 0.75, r_minor=scale * 0.30,
                 h=2.2 * scale, seed=seed + 9.1, rot=0.7)


def stone_lantern(mb, cx, cy, z0, h=1.85):
    S = MATS["stone"]
    mb.cyl(cx, cy, z0, z0 + 0.16, 0.34, 0.30, 8, S)
    mb.cyl(cx, cy, z0 + 0.16, z0 + h * 0.52, 0.115, 0.105, 8, S)
    mb.cyl(cx, cy, z0 + h * 0.52, z0 + h * 0.60, 0.30, 0.30, 8, S)
    mb.frustum(cx - 0.26, cx + 0.26, cy - 0.26, cy + 0.26,
               z0 + h * 0.60, z0 + h * 0.86, 0.86, 0.86, S)
    for sx in (-1, 1):
        for sy in (-1, 1):
            mb.cyl(cx + sx * 0.22, cy + sy * 0.22, z0 + h * 0.60,
                   z0 + h * 0.86, 0.055, 0.055, 5, S)
    mb.cyl(cx, cy, z0 + h * 0.86, z0 + h * 0.94, 0.42, 0.40, 8, S)
    mb.cyl(cx, cy, z0 + h * 0.94, z0 + h * 1.02, 0.22, 0.05, 8, S)


def axial_path(mb, p0, p1, half_w=1.85, h=0.115):
    """甬道 : the raised ceremonial walkway on the main axis."""
    p0 = V3(p0)
    p1 = V3(p1)
    f, a, nn, u = framef(p0, p1 - p0)
    L = (p1 - p0).length
    if L < 0.6:
        return
    lbox(mb, f, 0.0, L, -(half_w + 0.30), (half_w + 0.30), 0.0, h - 0.055,
         MATS["stone"])
    lbox(mb, f, 0.0, L, -(half_w + 0.26), (half_w + 0.26), h - 0.055, h,
         MATS["paving"], mat_top=MATS["paving"])
    for sx in (-1, 1):
        lbox(mb, f, 0.0, L, sx * half_w, sx * (half_w + 0.26), h, h + 0.135,
             MATS["stone"])
    nsl = max(2, int(round(L / 0.92)))
    for k in range(nsl - 1):
        t = (k + 1) / float(nsl)
        lbox(mb, f, L * t - 0.022, L * t + 0.022, -half_w, half_w,
             h + 0.002, h + 0.014, MATS["stone"])


def planter(mb, cx, cy, half=1.35, h=0.42, mat=None):
    S = mat or MATS["stone"]
    mb.frustum(cx - half, cx + half, cy - half, cy + half, 0.0, h,
               0.94, 0.94, S)
    mb.box(cx - half + 0.16, cx + half - 0.16, cy - half + 0.16,
           cy + half - 0.16, h - 0.10, h + 0.02, MATS["soil"])


def stone_vat(mb, cx, cy, r=0.72, h=1.02):
    S = MATS["stone"]
    mb.cyl(cx, cy, 0.0, h * 0.92, r, r * 0.98, 14, S)
    mb.cyl(cx, cy, h * 0.92, h, r * 1.10, r * 1.06, 14, S)
    mb.cyl(cx, cy, h * 0.72, h * 0.95, r * 0.86, r * 0.86, 14, MATS["water"])


def river(mb, path, w=6.5, seed=1.0):
    """A shallow country stream following the rolling terrain - the one thing
    a Song plain needs to stop reading as a sheet of paper."""
    rnd = random.Random(int(seed * 811) + 3)
    P = [V3(q) for q in path]
    lanes = {"oL": [], "wL": [], "iL": [], "iR": [], "wR": [], "oR": []}
    for k in range(len(P) - 1):
        a, b = P[k], P[k + 1]
        d = nrm(b - a)
        side = Vector((-d.y, d.x, 0.0))
        n = max(3, int(round((b - a).length / 8.0)))
        for i in range(n + (1 if k == len(P) - 2 else 0)):
            t = i / float(n)
            c = vlerp(a, b, t)
            ww = w * rnd.uniform(0.72, 1.30)
            zc = terrain_z(c.x, c.y)
            for key, off, dz in (("oL", ww + 2.6, 0.03), ("wL", ww, -0.20),
                                 ("iL", ww * 0.85, -0.30),
                                 ("iR", -ww * 0.85, -0.30),
                                 ("wR", -ww, -0.20), ("oR", -ww - 2.6, 0.03)):
                q = c + side * off
                lanes[key].append((q.x, q.y, terrain_z(q.x, q.y) + dz))
    mb.strip(lanes["oL"], lanes["wL"], MATS["moss"])
    mb.strip(lanes["wL"], lanes["iL"], MATS["gravel"])
    mb.strip(lanes["iL"], lanes["iR"], MATS["water"])
    mb.strip(lanes["iR"], lanes["wR"], MATS["gravel"])
    mb.strip(lanes["wR"], lanes["oR"], MATS["moss"])


def stone_table(mb, cx, cy, z0=0.0):
    S = MATS["stone"]
    mb.cyl(cx, cy, z0 + 0.70, z0 + 0.80, 0.85, 0.85, 14, S)
    mb.cyl(cx, cy, z0, z0 + 0.70, 0.30, 0.26, 10, S)
    for k in range(4):
        a = 2 * pi * k / 4 + 0.4
        px, py = cx + cos(a) * 2.05, cy + sin(a) * 2.05
        mb.cyl(px, py, z0 + 0.44, z0 + 0.56, 0.36, 0.36, 10, S)
        mb.cyl(px, py, z0, z0 + 0.44, 0.20, 0.18, 8, S)


def stone_path(mb, pts, width=1.35, seed=2.0, slab=0.92):
    """石径 : stepping slabs laid along a garden polyline."""
    rnd = random.Random(int(seed * 733) + 5)
    P = [Vector((p[0], p[1], 0.0)) for p in pts]
    for k in range(len(P) - 1):
        a, b = P[k], P[k + 1]
        L = (b - a).length
        n = max(1, int(round(L / slab)))
        d = nrm(b - a)
        side = Vector((-d.y, d.x, 0.0))
        for i in range(n):
            t = (i + 0.5) / n
            c = vlerp(a, b, t)
            w = width * rnd.uniform(0.72, 0.95)
            ln = slab * rnd.uniform(0.62, 0.9)
            rot = Matrix.Rotation(atan2(d.y, d.x) + rnd.uniform(-0.09, 0.09), 3, 'Z')
            mb.obox(Vector((c.x, c.y, 0.045 + rnd.uniform(-0.012, 0.012))),
                    Vector((ln * 0.5, w * 0.5, 0.055)),
                    MATS["stone"], rot=rot)
            if rnd.random() < 0.30:
                up = Vector((0, 0, 1))
                sc = Vector((-d.y, d.x, 0.0))
                for sx in (-1, 1):
                    if rnd.random() < 0.5:
                        continue
                    c2 = c + side * sx * (width * 0.5 + 0.32)
                    mb.cyl(c2.x, c2.y, 0.0, 0.075, 0.26, 0.24, 7,
                           MATS["gravel"])


# =============================================================================
#  GARDEN ASSEMBLY
# =============================================================================
def build_garden():
    mb = MB()
    pond = pond_polygon(POND_CX, POND_CY, POND_HW, POND_HD, 46, 0.17, 7.0)
    paved = [
        (-22.5, 22.5, -38.5, -13.0),
        (-16.5, 16.5, -13.0, 10.5),
        (13.0, 34.0, -18.0, 10.0),
        (-20.6, -14.0, -33.0, -11.5),
        (14.0, 20.6, -33.0, -11.5),
        (-4.9, 4.9, -41.0, -20.0),
    ]
    build_ground(mb, pond, paved)
    build_pond(mb, pond)

    # ---- water court : rocks along the bank, pines, bamboo ----
    rim = offset_poly(pond, 0.95)
    rr = random.Random(101)
    for i, p in enumerate(rim):
        if i % 3 != 0:
            continue
        s = rr.uniform(0.55, 1.5)
        scholar_rock(mb, p[0], p[1], -0.05, r_major=0.85 * s,
                     r_minor=0.36 * s, h=rr.uniform(1.5, 2.6),
                     seed=rr.uniform(0, 12), rot=rr.uniform(0, 3.14))
    scholar_rock(mb, -30.4, 8.4, 0.0, r_major=1.15, r_minor=0.46, h=2.5,
                 seed=3.3, rot=1.2)
    scholar_rock(mb, -31.6, 4.6, 0.0, r_major=0.80, r_minor=0.33, h=2.0,
                 seed=8.1, rot=2.4)
    scholar_rock(mb, -21.4, -12.6, 0.0, r_major=0.95, r_minor=0.40, h=2.1,
                 seed=5.7, rot=0.4)
    scholar_rock(mb, -30.2, -12.4, 0.0, r_major=1.05, r_minor=0.42, h=2.3,
                 seed=6.9, rot=1.7)
    pine_tree(mb, -31.0, 13.8, 0.0, 8.4, seed=1.0, lean=(0.10, 0.04))
    pine_tree(mb, -24.8, 15.4, 0.0, 6.9, seed=2.0, lean=(0.03, 0.09))
    pine_tree(mb, -31.8, -14.6, 0.0, 7.4, seed=3.0, lean=(0.08, -0.06))
    pine_tree(mb, -20.6, -14.8, 0.0, 6.4, seed=31.0, lean=(-0.05, -0.05))
    bamboo_clump(mb, -20.6, 6.4, 0.0, n=13, height=6.6, spread=1.5, seed=1.0)
    bamboo_clump(mb, -20.2, 11.4, 0.0, n=10, height=5.9, spread=1.2, seed=2.0)
    bamboo_clump(mb, -32.2, 0.6, 0.0, n=10, height=6.2, spread=1.3, seed=21.0)
    stone_lantern(mb, -21.8, -3.2, 0.0)
    # ---- courtyard furnishings on the axis ----
    axial_path(mb, (0.0, -31.4), (0.0, -20.6), 1.85, 0.115)
    for sx in (-1, 1):
        for (yy, hh) in ((-27.4, 8.2), (-17.6, 7.0)):
            planter(mb, sx * 8.0, yy, 1.30, 0.40)
            pine_tree(mb, sx * 8.0, yy, 0.40, hh * 0.74,
                      seed=40.0 + sx * yy, lean=(sx * 0.05, -0.03), pads=5)
        stone_vat(mb, sx * 4.6, -25.0, 0.66, 0.98)
        stone_vat(mb, sx * 6.2, 4.6, 0.60, 0.92)
    stone_lantern(mb, -6.4, -31.8, 0.0)
    stone_lantern(mb, 6.4, -31.8, 0.0)
    stone_lantern(mb, 20.4, -13.4, 0.0)
    stone_lantern(mb, -20.8, -6.8, 0.0)

    # ---- academy court : bamboo, stone table ----
    bamboo_clump(mb, 21.3, 6.2, 0.0, n=12, height=6.2, spread=1.4, seed=5.0)
    bamboo_clump(mb, 32.0, 8.0, 0.0, n=9, height=5.4, spread=1.1, seed=6.0)
    bamboo_clump(mb, 32.4, -12.0, 0.0, n=8, height=5.8, spread=1.2, seed=7.0)
    stone_table(mb, 24.4, -10.6, 0.0)
    pine_tree(mb, 32.6, 1.6, 0.0, 7.0, seed=9.0, lean=(-0.09, 0.04))
    scholar_rock(mb, 20.4, -6.4, 0.0, r_major=0.90, r_minor=0.38, h=2.1,
                 seed=4.4, rot=1.9)

    # ---- north back garden : 假山, 曲水, 松, 竹 ----
    fake_mountain(mb, -12.0, 24.5, 0.0, scale=1.55, seed=3.0, n=6)
    fake_mountain(mb, -6.0, 28.0, 0.0, scale=1.05, seed=8.0, n=4)
    scholar_rock(mb, -17.4, 22.0, 0.0, r_major=1.25, r_minor=0.50, h=2.9,
                 seed=11.0, rot=0.9)
    scholar_rock(mb, 3.8, 26.4, 0.0, r_major=1.10, r_minor=0.44, h=2.5,
                 seed=13.0, rot=2.1)
    pine_tree(mb, -3.6, 22.4, 0.0, 9.2, seed=4.0, lean=(-0.07, 0.05))
    pine_tree(mb, 9.4, 27.8, 0.0, 7.6, seed=5.0, lean=(0.05, -0.07))
    pine_tree(mb, 18.6, 21.6, 0.0, 6.8, seed=6.0, lean=(-0.05, 0.06))
    pine_tree(mb, 27.2, 29.4, 0.0, 8.6, seed=7.0, lean=(0.06, 0.03))
    pine_tree(mb, -27.6, 24.6, 0.0, 8.0, seed=11.0, lean=(0.08, -0.02))
    pine_tree(mb, 13.4, 15.4, 0.0, 7.2, seed=12.0, lean=(-0.04, 0.05))
    bamboo_clump(mb, -20.0, 17.0, 0.0, n=14, height=6.8, spread=1.7, seed=3.0)
    bamboo_clump(mb, -23.0, 20.6, 0.0, n=11, height=6.0, spread=1.4, seed=4.0)
    bamboo_clump(mb, 21.4, 18.6, 0.0, n=12, height=6.4, spread=1.5, seed=8.0)
    bamboo_clump(mb, -8.0, 16.6, 0.0, n=9, height=5.5, spread=1.2, seed=9.0)
    river(mb, [(-372.0, -150.0), (-268.0, -74.0), (-186.0, 22.0),
               (-140.0, 132.0), (-74.0, 236.0), (16.0, 322.0)], 6.0, 1.0)
    river(mb, [(392.0, -196.0), (300.0, -86.0), (238.0, 44.0),
               (216.0, 168.0), (250.0, 288.0)], 4.2, 2.0)
    stone_path(mb, [(-17.0, 12.0), (-10.0, 15.4), (-3.0, 14.4), (2.4, 18.2),
                    (6.0, 23.6), (11.0, 27.0), (16.0, 25.6)], 1.35, seed=2.0)
    stone_path(mb, [(-19.6, 4.0), (-20.0, 9.6), (-14.0, 13.0)], 1.20,
               seed=4.0)
    stone_path(mb, [(15.0, 4.0), (21.6, 0.0), (25.6, -7.2)], 1.20, seed=6.0)
    stone_lantern(mb, -13.6, 18.4, 0.0)
    stone_lantern(mb, 4.4, 21.0, 0.0)
    stone_lantern(mb, 12.0, 12.6, 0.0)

    # ---- tree line beyond the walls (context, no cheating with imports) ---
    rnd = random.Random(2024)
    # wooded groves over the whole visible plain, thinning with distance
    for c in range(300):
        ca = rnd.uniform(0, 2 * pi)
        crad = 54.0 + 300.0 * (rnd.random() ** 1.45)
        ccx = cos(ca) * crad
        ccy = sin(ca) * crad * 1.05
        if abs(ccx) < CX + 8 and abs(ccy) < CY + 8:
            continue
        spread = 9.0 + crad * 0.045
        for k in range(rnd.randint(4, 14)):
            px = ccx + rnd.uniform(-spread, spread)
            py = ccy + rnd.uniform(-spread, spread)
            d = hypot(px, py)
            if d < 51.0:
                continue
            h = rnd.uniform(3.6, 10.5) * clamp(0.52 + d / 800.0, 0.52, 1.0)
            _distant_tree(mb, px, py, max(3.0, h), None,
                          ground_z(px, py), rnd)
    return join_objs([mb.build("CY_Garden")], "CY_Garden")


def _distant_tree(mb, x, y, h, col=None, z0=0.0, rnd=None):
    """Cheap silhouette tree - either a conifer spire or a round-crowned
    broadleaf, chosen at random, so the woodland reads as mixed."""
    rd = rnd or random
    kind = rd.random()
    if abs(x) + abs(y) > 40.0 and z0 < ground_z(x, y):
        z0 = ground_z(x, y)
    if kind < 0.42:                                   # conifer
        loops = []
        nlay = 4
        for k in range(nlay):
            t = k / float(nlay - 1)
            r = h * (0.26 - 0.19 * t) * rd.uniform(0.78, 1.22)
            z = z0 + h * (0.30 + 0.66 * t)
            loops.append([(x + cos(2 * pi * j / 9) * r,
                           y + sin(2 * pi * j / 9) * r, z) for j in range(9)])
        loops.append([(x, y, z0 + h * 1.03)] * 9)
        mb.loft(loops, MATS["pine"], close_ring=True)
    else:                                             # round-crowned
        lobes = rd.randint(2, 3)
        for q in range(lobes):
            cz = z0 + h * (0.50 + 0.30 * q / max(1, lobes - 1))
            rr = h * (0.27 - 0.055 * q) * rd.uniform(0.78, 1.15)
            ox = rd.uniform(-0.16, 0.16) * h
            oy = rd.uniform(-0.16, 0.16) * h
            loops = []
            for k in range(5):
                t = k / 4.0
                rad = rr * sin(pi * (0.14 + 0.76 * t))
                zz = cz - rr * 0.98 + rr * 2.05 * t
                loops.append([(x + ox + cos(2 * pi * j / 9) * rad,
                               y + oy + sin(2 * pi * j / 9) * rad, zz)
                              for j in range(9)])
            mb.loft(loops, MATS["leaf"] if rd.random() < 0.55
                    else MATS["leaf2"], close_ring=True, cap_end=True)
    mb.cyl(x, y, z0 - 0.2, z0 + h * 0.44, h * 0.030, h * 0.021, 6,
           MATS["bark"])


# =============================================================================
#  WORLD  /  LIGHTS  /  ATMOSPHERE
# =============================================================================
def setup_world(strength=1.0):
    w = bpy.data.worlds.new("SongSky")
    bpy.context.scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    out.location = (400, 0)
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.location = (200, 0)
    bg.inputs["Strength"].default_value = strength
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    geo.location = (-800, 0)
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
    stops = [(0.00, (0.320, 0.300, 0.268)),
             (0.36, (0.560, 0.520, 0.462)),
             (0.470, (0.775, 0.735, 0.672)),   # warm haze band at the horizon
             (0.500, (0.720, 0.712, 0.690)),
             (0.560, (0.520, 0.556, 0.602)),
             (0.720, (0.352, 0.420, 0.520)),
             (1.000, (0.216, 0.300, 0.440))]   # cool zenith
    cr.elements[0].position = stops[0][0]
    cr.elements[0].color = tuple(stops[0][1]) + (1.0,)
    cr.elements[1].position = stops[-1][0]
    cr.elements[1].color = tuple(stops[-1][1]) + (1.0,)
    for pos, col in stops[1:-1]:
        e = cr.elements.new(pos)
        e.color = tuple(col) + (1.0,)
    nt.links.new(geo.outputs["Incoming"], sep.inputs["Vector"])
    nt.links.new(sep.outputs["Z"], mr.inputs["Value"])
    nt.links.new(mr.outputs["Result"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    return w


def setup_mist(density=0.00260):
    """A height / radius graded volume so the compound sits in soft air."""
    mat = bpy.data.materials.new("CY_Mist")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (520, 0)
    vol = nt.nodes.new("ShaderNodeVolumePrincipled")
    vol.location = (280, 0)
    try:
        vol.inputs["Color"].default_value = (0.560, 0.622, 0.690, 1.0)
        vol.inputs["Anisotropy"].default_value = 0.30
    except Exception:
        pass
    tc = nt.nodes.new("ShaderNodeTexCoord")
    tc.location = (-880, 0)
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    sep.location = (-700, 0)
    nt.links.new(tc.outputs["Object"], sep.inputs["Vector"])
    # height profile
    mrh = nt.nodes.new("ShaderNodeMapRange")
    mrh.location = (-500, 120)
    mrh.inputs["From Min"].default_value = -6.0
    mrh.inputs["From Max"].default_value = 40.0
    mrh.inputs["To Min"].default_value = 1.05
    mrh.inputs["To Max"].default_value = 0.015
    try:
        mrh.clamp = True
    except Exception:
        pass
    nt.links.new(sep.outputs["Z"], mrh.inputs["Value"])
    # near mask : keep the compound itself crisp
    mnear = nt.nodes.new("ShaderNodeMapRange")
    mnear.location = (-340, 240)
    mnear.inputs["From Min"].default_value = 0.0
    mnear.inputs["From Max"].default_value = 185.0
    mnear.inputs["To Min"].default_value = 0.22
    mnear.inputs["To Max"].default_value = 1.0
    try:
        mnear.clamp = True
    except Exception:
        pass
    # radial fade so the box edges never show
    comb = nt.nodes.new("ShaderNodeCombineXYZ")
    comb.location = (-700, -220)
    nt.links.new(sep.outputs["X"], comb.inputs["X"])
    nt.links.new(sep.outputs["Y"], comb.inputs["Y"])
    ln = nt.nodes.new("ShaderNodeVectorMath")
    ln.location = (-520, -220)
    ln.operation = 'LENGTH'
    nt.links.new(comb.outputs["Vector"], ln.inputs[0])
    mrr = nt.nodes.new("ShaderNodeMapRange")
    mrr.location = (-340, -220)
    mrr.inputs["From Min"].default_value = 420.0
    mrr.inputs["From Max"].default_value = 615.0
    mrr.inputs["To Min"].default_value = 1.0
    mrr.inputs["To Max"].default_value = 0.0
    try:
        mrr.clamp = True
    except Exception:
        pass
    nt.links.new(ln.outputs["Value"], mnear.inputs["Value"])
    nt.links.new(ln.outputs["Value"], mrr.inputs["Value"])
    mul = nt.nodes.new("ShaderNodeMath")
    mul.location = (-140, 0)
    mul.operation = 'MULTIPLY'
    nt.links.new(mrh.outputs["Result"], mul.inputs[0])
    nt.links.new(mnear.outputs["Result"], mul.inputs[1])
    mulb = nt.nodes.new("ShaderNodeMath")
    mulb.location = (-40, -120)
    mulb.operation = 'MULTIPLY'
    nt.links.new(mul.outputs["Value"], mulb.inputs[0])
    nt.links.new(mrr.outputs["Result"], mulb.inputs[1])
    mul2 = nt.nodes.new("ShaderNodeMath")
    mul2.location = (60, 0)
    mul2.operation = 'MULTIPLY'
    mul2.inputs[1].default_value = density
    nt.links.new(mulb.outputs["Value"], mul2.inputs[0])
    nt.links.new(mul2.outputs["Value"], vol.inputs["Density"])
    nt.links.new(vol.outputs["Volume"], out.inputs["Volume"])

    me = bpy.data.meshes.new("CY_MistBox")
    R = 640.0
    vs = [(-R, -R, -30), (R, -R, -30), (R, R, -30), (-R, R, -30),
          (-R, -R, 150), (R, -R, 150), (R, R, 150), (-R, R, 150)]
    fs = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
          (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    me.from_pydata(vs, [], fs)
    me.materials.append(mat)
    ob = bpy.data.objects.new("CY_Mist", me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def add_sun(name, to_light, color, energy, angle_deg=2.2):
    d = bpy.data.lights.new(name, 'SUN')
    d.color = color
    d.energy = energy
    d.angle = radians(angle_deg)
    ob = bpy.data.objects.new(name, d)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = Vector(to_light) * 60.0 + Vector((0.0, 0.0, 20.0))
    ob.rotation_euler = (-Vector(to_light)).to_track_quat('-Z', 'Y').to_euler()
    return ob


def add_area(name, loc, target, color, energy, size, size_y=None):
    d = bpy.data.lights.new(name, 'AREA')
    d.color = color
    d.energy = energy
    d.shape = 'SQUARE'
    d.size = size
    if size_y is not None:
        d.size_y = size_y
    ob = bpy.data.objects.new(name, d)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = Vector(loc)
    ob.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat(
        '-Z', 'Y').to_euler()
    return ob


def setup_lights():
    L = []
    # key : soft late-afternoon sun raking in from the west-south-west
    L.append(add_sun("CY_Sun", (-0.596, -0.418, 0.686),
                     (1.000, 0.866, 0.700), 5.05, 1.3))
    # broad cool sky fill so the shadowed eaves keep their detail
    L.append(add_area("CY_SkyFill", (-62.0, -104.0, 126.0), (0.0, 0.0, 6.0),
                      (0.548, 0.662, 0.870), 860.0, 160.0))
    # warm bounce off the paving into the deep eaves
    L.append(add_area("CY_Bounce", (17.0, -44.0, 2.2), (0.0, -8.0, 9.0),
                      (1.000, 0.796, 0.548), 190.0, 50.0))
    # cool rim to separate the roofs from the sky
    L.append(add_area("CY_Rim", (36.0, 98.0, 48.0), (0.0, 4.0, 8.0),
                      (0.628, 0.752, 0.958), 420.0, 80.0))
    return L


def scene_bbox_points(exclude=("CY_Mist", "CY_Hills", "CY_Garden",
                               "CY_Ground", "CY_Outer")):
    pts = []
    for ob in bpy.context.scene.objects:
        if ob.type != 'MESH' or ob.name in exclude:
            continue
        if not ob.name.startswith("CY_"):
            continue
        for c in ob.bound_box:
            pts.append(ob.matrix_world @ Vector(c))
    return pts


def setup_camera(res_w, res_h, az_deg=-27.0, elev_deg=35.0, lens=50.0,
                 fill=0.76):
    cd = bpy.data.cameras.new("CY_Cam")
    cd.lens = lens
    cd.sensor_width = 36.0
    cd.clip_start = 0.6
    cd.clip_end = 4000.0
    cam = bpy.data.objects.new("CY_Cam", cd)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam

    az = radians(az_deg)
    el = radians(elev_deg)
    dirv = Vector((cos(el) * sin(az), -cos(el) * cos(az), sin(el)))
    pts = scene_bbox_points()
    xs = [p.x for p in pts]
    ys = [p.y for p in pts]
    zs = [p.z for p in pts]
    print("BBOX  x[%.1f %.1f]  y[%.1f %.1f]  z[%.1f %.1f]  pts=%d"
          % (min(xs), max(xs), min(ys), max(ys), min(zs), max(zs), len(pts)))
    target = Vector(((min(xs) + max(xs)) * 0.5,
                     (min(ys) + max(ys)) * 0.5,
                     min(zs) + (max(zs) - min(zs)) * 0.44))
    aspect = float(res_h) / float(res_w)
    halfw = cd.sensor_width * 0.5 / cd.lens
    halfh = halfw * aspect
    radius = max((p - target).length for p in pts)
    dist = radius / (halfh * fill)

    def _place(d, tg):
        lo = tg + dirv * d
        cam.location = lo
        cam.rotation_euler = (tg - lo).to_track_quat('-Z', 'Y').to_euler()
        q = cam.rotation_euler.to_quaternion()
        return (lo, q @ Vector((1.0, 0.0, 0.0)),
                q @ Vector((0.0, 1.0, 0.0)), q @ Vector((0.0, 0.0, -1.0)))

    def _proj(d, tg):
        lo, rt, up, fw = _place(d, tg)
        xmin, xmax, ymin, ymax = 1e9, -1e9, 1e9, -1e9
        cnt = 0
        for p in pts:
            v = p - lo
            z = v.dot(fw)
            if z < 1.0:
                continue
            nx = v.dot(rt) / z / halfw
            ny = v.dot(up) / z / halfh
            xmin = min(xmin, nx); xmax = max(xmax, nx)
            ymin = min(ymin, ny); ymax = max(ymax, ny)
            cnt += 1
        return xmin, xmax, ymin, ymax, cnt, rt, up

    for _ in range(10):                       # phase A : solve the distance
        xmin, xmax, ymin, ymax, cnt, rt, up = _proj(dist, target)
        if cnt == 0:
            dist *= 1.5
            continue
        k = max(xmax - xmin, ymax - ymin) * 0.5 / fill
        dist *= (1.0 + (k - 1.0) * 0.62)
        dist = clamp(dist, 15.0, 2500.0)
    for _ in range(6):                        # phase B : bounded re-centring
        xmin, xmax, ymin, ymax, cnt, rt, up = _proj(dist, target)
        if cnt == 0:
            break
        cx = clamp((xmin + xmax) * 0.5, -1.4, 1.4)
        cy = clamp((ymin + ymax) * 0.5, -1.4, 1.4)
        if abs(cx) < 0.02 and abs(cy) < 0.02:
            break
        shift = rt * (cx * dist * halfw * 0.62) + \
            up * (cy * dist * halfh * 0.62)
        cap = radius * 0.55
        if shift.length > cap:
            shift = shift.normalized() * cap
        target = target + shift
        for _ in range(5):
            xmin, xmax, ymin, ymax, cnt, rt, up = _proj(dist, target)
            if cnt == 0:
                break
            k = max(xmax - xmin, ymax - ymin) * 0.5 / fill
            dist *= (1.0 + (k - 1.0) * 0.62)
            dist = clamp(dist, 15.0, 2500.0)
    loc, rt, up, fw = _place(dist, target)
    cd.dof.use_dof = False
    print("CAMERA dist=%.1f target=%s  span=(%.3f x %.3f) ctr=(%.3f %.3f)"
          % (dist, tuple(round(v, 2) for v in target),
             xmax - xmin, ymax - ymin, (xmin + xmax) * 0.5,
             (ymin + ymax) * 0.5))
    return cam


def setup_render(res_w, res_h, samples=192):
    sc = bpy.context.scene
    sc.render.resolution_x = res_w
    sc.render.resolution_y = res_h
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'
    sc.render.image_settings.color_depth = '8'
    sc.render.film_transparent = False
    sc.render.filter_size = 1.4
    for vt in ('AgX', 'Filmic', 'Standard'):
        try:
            sc.view_settings.view_transform = vt
            break
        except Exception:
            continue
    sc.view_settings.exposure = -0.16
    sc.view_settings.gamma = 1.0
    sc.render.engine = 'BLENDER_EEVEE'
    ee = sc.eevee
    ee.taa_render_samples = samples
    for attr, val in (("use_raytracing", True),
                      ("ray_tracing_method", 'RAYTRACE'),
                      ("use_shadows", True),
                      ("shadow_ray_count", 3),
                      ("shadow_step_count", 10),
                      ("use_fast_gi", True),
                      ("fast_gi_method", 'AMBIENT_OCCLUSION_ONLY'),
                      ("fast_gi_distance", 7.0),
                      ("fast_gi_ray_count", 4),
                      ("fast_gi_step_count", 8),
                      ("use_volumetric_shadows", True),
                      ("volumetric_start", 1.0),
                      ("volumetric_end", 1100.0),
                      ("volumetric_samples", 72),
                      ("volumetric_ray_depth", 4),
                      ("volumetric_tile_size", '2')):
        try:
            setattr(ee, attr, val)
        except Exception:
            pass
    print("RENDER ENGINE: %s  view_transform=%s"
          % (sc.render.engine, sc.view_settings.view_transform))
    return sc


# =============================================================================
#  MAIN
# =============================================================================
def main():
    clear_scene()
    build_materials()

    objs = []
    objs.append(build_gate())
    objs.append(build_hall())
    objs.append(build_academy())
    objs.append(build_tea_pavilion())
    objs.append(build_perimeter())
    objs.append(build_corridors())

    bmb = MB()
    build_bridge(bmb, (-20.2, 2.4), (-32.4, 2.4), deck_z=0.50, half_w=1.18,
                 col_h=2.85)
    objs.append(join_objs([bmb.build("CY_Bridge")], "CY_Bridge"))

    init_hills()
    objs.append(build_garden())

    setup_world(0.26)
    setup_mist(0.00180)
    setup_lights()
    sc = setup_render(RES, int(round(RES * 0.667)), samples=192)
    setup_camera(RES, int(round(RES * 0.667)), az_deg=-27.0, elev_deg=35.0,
                 lens=50.0, fill=0.76)

    tris = 0
    for ob in bpy.context.scene.objects:
        if ob.type == 'MESH':
            tris += len(ob.data.polygons)
    print("SCENE OBJECTS: %d   FACES: %d   VERTS: %d"
          % (len(bpy.context.scene.objects), tris,
             sum(len(o.data.vertices) for o in bpy.context.scene.objects
                 if o.type == 'MESH')))

    out_png = os.path.join(RENDER_DIR, "song_courtyard_%s.png" % TAG)
    sc.render.filepath = out_png
    bpy.ops.render.render(write_still=True)
    print("RENDERED -> %s" % out_png)

    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    print("SAVED -> %s" % BLEND_PATH)


main()

