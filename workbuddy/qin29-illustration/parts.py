# -*- coding: utf-8 -*-
"""QIN-29 插画：绘图部件库（每个部件独立成函数，便于逐一核对可数性）。"""

INK = "#1b2a38"
GOLD = "#e0a92e"
GOLD2 = "#b9861a"

import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from svgkit import f   # noqa: E402


# ============ 通用小件 ============
def screw(s, cx, cy, r=8, col="#9aa7b4", slot="#39485a"):
    s.circ(cx, cy, r, col, "#39485a", 1.2)
    s.line(cx - r * 0.62, cy, cx + r * 0.62, cy, slot, 2.2)


def empty_hole(s, cx, cy, r=8):
    s.circ(cx, cy, r, "#2a3644", "#0f1720", 1.4)
    s.circ(cx, cy - 0.8, r * 0.62, "#1b2733", None, 0)


def gear(s, cx, cy, r, teeth=9, fill="#c9d4de", stroke="#5b6b7d", sw=1.1, hole=0.36):
    s.gear(cx, cy, r, teeth, fill, stroke, sw, hole)


def apple(s, cx, cy, r, green=False):
    body = "#7ec850" if green else "#e0392b"
    edge = "#4d8f2a" if green else "#9c1f14"
    s.path("M %s %s C %s %s %s %s %s %s C %s %s %s %s %s %s Z" % (
        f(cx - r), f(cy), f(cx - r * 1.06), f(cy - r * 1.18), f(cx - r * 0.34), f(cy - r * 1.2),
        f(cx), f(cy - r * 0.72), f(cx + r * 0.34), f(cy - r * 1.2), f(cx + r * 1.06), f(cy - r * 1.18),
        f(cx + r), f(cy)), body, edge, 1.3)
    s.line(cx, cy - r * 0.72, cx + r * 0.16, cy - r * 1.5, "#6b4a22", 1.8)
    s.path("M %s %s C %s %s %s %s %s %s Z" % (f(cx + r * 0.1), f(cy - r * 1.34),
            f(cx + r * 0.7), f(cy - r * 1.8), f(cx + r * 0.9), f(cy - r * 1.1),
            f(cx + r * 0.1), f(cy - r * 1.34)), "#5fae3a", "#3f7d24", 1)


def flag(s, x, y, w=34, h=24, color="#e0392b", pole="#7a5c34"):
    s.line(x, y, x, y - h - 14, pole, 2.6)
    s.poly([(x, y - h - 12), (x + w, y - h - 5), (x, y - h + 2)], color, "#2b3a4a", 1)


def matryoshka(s, cx, cy, h, k, c1, c2):
    """套娃形检验章：外轮廓随 k 缩小，内部写 k²。"""
    w = h * 0.74
    # 外轮廓（宽底窄颈 + 圆头）
    s.path("M %s %s C %s %s %s %s %s %s C %s %s %s %s %s %s Z" % (
        f(cx - w * 0.44), f(cy + h * 0.02), f(cx - w * 0.44), f(cy + h * 0.30),
        f(cx - w * 0.26), f(cy + h * 0.36), f(cx), f(cy + h * 0.36),
        f(cx + w * 0.26), f(cy + h * 0.36), f(cx + w * 0.44), f(cy + h * 0.30),
        f(cx + w * 0.44), f(cy + h * 0.02)), c2, "#2b3a4a", 1.6)
    # 衣身内色
    s.path("M %s %s C %s %s %s %s %s %s C %s %s %s %s %s %s Z" % (
        f(cx - w * 0.32), f(cy + h * 0.04), f(cx - w * 0.32), f(cy + h * 0.22),
        f(cx - w * 0.18), f(cy + h * 0.26), f(cx), f(cy + h * 0.26),
        f(cx + w * 0.18), f(cy + h * 0.26), f(cx + w * 0.32), f(cy + h * 0.22),
        f(cx + w * 0.32), f(cy + h * 0.04)), c1, None, 0)
    # 头
    s.circ(cx, cy - h * 0.30, w * 0.30, c1, "#2b3a4a", 1.6)
    s.circ(cx, cy - h * 0.30, w * 0.14, c2, None, 0)
    fs = 42 if k == 1 else (38 if k == 2 else (34 if k == 3 else (32 if k == 4 else
          (30 if k == 5 else (28 if k == 6 else (26 if k == 7 else 26))))))
    s.text(cx, cy + h * 0.14, str(k * k), fs, "#1b2a38", "middle", "700")


# ============ 载具 ============
def bicycle(s, cx, cy, wheel_r=32, wb=160, face=1):
    """完整自行车：两轮、车架、链条、牙盘、两脚踏、车把、车座、车铃。
    face=1 车头朝右；face=-1 车头朝左。轮底位于 cy + wheel_r。"""
    R, F = wheel_r, face
    x1, x2 = cx - F * wb / 2, cx + F * wb / 2      # x1=后轮, x2=前轮
    yw = cy
    bbx, bby = cx, cy - 12                          # 五通/牙盘
    sxt, syt = cx - F * wb * 0.20, cy - 78          # 座管上端
    htx, hty = cx + F * wb * 0.30, cy - 70          # 头管上端
    # 轮
    import math
    for wx in (x1, x2):
        s.circ(wx, yw, R, "none", "#2b3a4a", 5.5)
        s.circ(wx, yw, R * 0.80, "none", "#7f8fa0", 1.6)
        s.circ(wx, yw, R * 0.16, "#5b6b7d", "#2b3a4a", 1.2)
        for i in range(10):
            a = math.radians(i * 36)
            s.line(wx, yw, wx + R * 0.78 * math.cos(a), yw + R * 0.78 * math.sin(a),
                   "#a9b6c4", 1.1)
    # 车架
    fr = "#d8452f"
    s.line(bbx, bby, sxt, syt, fr, 5.2)
    s.line(sxt, syt, htx, hty, fr, 5.2)
    s.line(htx, hty, bbx, bby, fr, 5.2)
    s.line(bbx, bby, x1, yw, fr, 4.6)
    s.line(sxt, syt, x1, yw, fr, 4.0)
    s.line(htx, hty, x2, yw, "#39485a", 4.6)
    # 牙盘 + 曲柄 + 双脚踏
    s.circ(bbx, bby, 22, "#e8edf2", "#39485a", 2.4)
    s.circ(bbx, bby, 8, "#8d9aa8", "#39485a", 1.4)
    for i in range(18):
        a = math.radians(i * 20)
        s.line(bbx + 22 * math.cos(a), bby + 22 * math.sin(a),
               bbx + 26 * math.cos(a), bby + 26 * math.sin(a), "#39485a", 1.6)
    # 链条（上下两股 + 绕过后轮）
    s.path("M %s %s L %s %s A %s %s 0 0 0 %s %s L %s %s A %s %s 0 0 1 %s %s" % (
        f(x1), f(yw - 9), f(bbx - F * 21), f(bby - 6), f(40), f(24), f(bbx - F * 21), f(bby + 6),
        f(x1), f(yw + 9), f(40), f(24), f(bbx - F * 21), f(bby - 6)), "none", "#6b7a8a", 2.2)
    s.path("M %s %s L %s %s" % (f(x1), f(yw - 11), f(bbx - F * 19), f(bby - 8)), "#39485a", 2.6)
    s.path("M %s %s L %s %s" % (f(x1), f(yw + 11), f(bbx - F * 19), f(bby + 8)), "#39485a", 2.6)
    # 曲柄与两个脚踏（互成 180°）
    pa = math.radians(8)
    p1 = (bbx + F * 30 * math.cos(pa), bby + 30 * math.sin(pa))
    p2 = (bbx - F * 30 * math.cos(pa), bby - 30 * math.sin(pa))
    s.line(bbx, bby, p1[0], p1[1], "#39485a", 5.5)
    s.line(bbx, bby, p2[0], p2[1], "#39485a", 5.5)
    s.line(p1[0] - 9, p1[1] + 5, p1[0] + 9, p1[1] + 5, "#2b3a4a", 4.4)
    s.line(p2[0] - 9, p2[1] + 5, p2[0] + 9, p2[1] + 5, "#2b3a4a", 4.4)
    # 车座 / 车把 / 车铃
    s.path("M %s %s q -20 -9 0 -13 l 40 0 q 20 4 0 13 Z" % (f(sxt - F * 22), f(syt - 2)),
           "#2b3a4a", "#151f2a", 1.2)
    s.line(htx, hty, htx + F * 8, hty - 30, "#39485a", 4.2)
    bar_l = (htx - F * 30, hty - 34)
    bar_r = (htx + F * 30, hty - 34)
    s.line(bar_l[0], bar_l[1], bar_r[0], bar_r[1], "#2b3a4a", 5.0)
    s.circ(htx + F * 22, hty - 30, 6.5, "#e8c33c", "#8a6a1a", 1.4)
    return {"pedal1": p1, "pedal2": p2, "wheel_back": (x1, yw + R), "wheel_front": (x2, yw + R),
            "bar": (htx + F * 30, hty - 34), "seat": (sxt, syt - 8), "bb": (bbx, bby),
            "top_tube": ((sxt, syt), (htx, hty))}


def engine(s, cx, cy, L=104, D=46, ang=0, label=None):
    """一台发动机：短舱 + 进气唇口 + 可见风扇面。"""
    g = []
    g.append('<rect x="%s" y="%s" width="%s" height="%s" rx="%s" fill="url(#engG)" stroke="#5b6b7d" stroke-width="1.6"/>'
             % (f(cx - L / 2), f(cy - D / 2), f(L), f(D), f(D / 2)))
    g.append('<ellipse cx="%s" cy="%s" rx="%s" ry="%s" fill="#dfe6ee" stroke="#5b6b7d" stroke-width="1.6"/>'
             % (f(cx - L / 2 + 8), f(cy), f(7), f(D / 2 - 1)))
    g.append('<ellipse cx="%s" cy="%s" rx="%s" ry="%s" fill="#2b3a4a"/>'
             % (f(cx - L / 2 + 8), f(cy), f(4.4), f(D / 2 - 8)))
    g.append('<ellipse cx="%s" cy="%s" rx="%s" ry="%s" fill="#7f8fa0" stroke="#39485a" stroke-width="1.2"/>'
             % (f(cx + L / 2 - 12), f(cy), f(9), f(D / 2 - 3)))
    for i in range(7):
        import math
        a = math.radians(i * 51.4)
        g.append('<path d="M %s %s L %s %s" stroke="#39485a" stroke-width="1.5"/>' % (
            f(cx + L / 2 - 12), f(cy), f(cx + L / 2 - 12 + 7 * math.cos(a)),
            f(cy + (D / 2 - 5) * math.sin(a))))
    g.append('<rect x="%s" y="%s" width="10" height="%s" rx="3" fill="#a9b6c4" stroke="#5b6b7d" stroke-width="1"/>'
             % (f(cx - 6), f(cy - D / 2 - 13), f(11)))
    if label:
        g.append('<text x="%s" y="%s" font-size="13" fill="#39485a" text-anchor="middle" font-weight="700">%s</text>'
                 % (f(cx + 6), f(cy + 5), label))
    s.g(g, transform="rotate(%s %s %s)" % (f(ang), f(cx), f(cy)))


# ============ 动物 ============
def polar_bear(s, cx, cy, L=330, face=1):
    """北极熊：白色厚毛、长吻、小圆耳、黑鼻、圆耳小体型识别点。face=1 朝右。"""
    H = L * 0.40
    bx0, bx1 = cx - L * 0.46, cx + L * 0.44
    body = []
    body.append('<path d="M %s %s C %s %s %s %s %s %s C %s %s %s %s %s %s Z" fill="#f6f2e6" stroke="#b9ae95" stroke-width="2.2"/>' % (
        f(bx0 + L * 0.06), f(cy - H * 0.30), f(bx0 - L * 0.04), f(cy - H * 0.05),
        f(bx0), f(cy + H * 0.22), f(bx0 + L * 0.10), f(cy + H * 0.30),
        f(cx + L * 0.10), f(cy + H * 0.40), f(bx1 - L * 0.10), f(cy + H * 0.34),
        f(bx1 - L * 0.02), f(cy + H * 0.10)))
    s.g(body)
    # 头（长吻）
    hx = bx1 - L * 0.02
    hy = cy - H * 0.34
    s.path("M %s %s C %s %s %s %s %s %s C %s %s %s %s %s %s Z" % (
        f(hx - L * 0.06), f(hy - H * 0.18), f(hx + L * 0.10), f(hy - H * 0.22),
        f(hx + L * 0.16), f(hy - H * 0.02), f(hx + L * 0.15), f(hy + H * 0.04),
        f(hx + L * 0.02), f(hy + H * 0.10), f(hx - L * 0.08), f(hy + H * 0.08),
        f(hx - L * 0.09), f(hy - H * 0.04)),
        "#f6f2e6", "#b9ae95", 2.0)
    s.ell(hx + L * 0.13, hy + H * 0.02, L * 0.035, H * 0.13, "#3a3a3a", None, 0)  # 鼻
    s.circ(hx + L * 0.02, hy - H * 0.04, 4.2, "#2b2b2b")                       # 眼
    s.circ(hx - L * 0.03, hy - H * 0.24, H * 0.13, "#fbf8f0", "#8a7f66", 2.4)  # 耳
    # 四足：后足在左、前足在右
    for px, pw in ((bx0 + L * 0.12, L * 0.10), (bx0 + L * 0.24, L * 0.10),
                   (bx1 - L * 0.14, L * 0.10), (bx1 - L * 0.26, L * 0.10)):
        s.rect(px, cy + H * 0.24, pw, H * 0.46, "#f6f1e4", "#8a7f66", 2.4, rx=pw * 0.42)
        s.circ(px + pw * 0.5, cy + H * 0.70, pw * 0.30, "#d9d2c0")  # 掌垫
    s.path("M %s %s q %s %s %s 0" % (f(bx1 - L * 0.30), f(cy + H * 0.26),
            f(L * 0.10), f(H * 0.30), f(L * 0.20)), "none", "#b9ae95", 1.4)  # 尾


def pelican(s, cx, cy, S=1.0, face=-1, wings=True, wing_span=470):
    """鹈鹕：巨长喙 + 喉囊 + 灰白身 + 可展开双翼。S=1 时约 200px 高。"""
    g = []
    # 身体
    g.append('<ellipse cx="%s" cy="%s" rx="%s" ry="%s" fill="#efe9da" stroke="#9a927e" stroke-width="2.6"/>' % (
        f(cx), f(cy), f(64 * S), f(50 * S)))
    g.append('<path d="M %s %s C %s %s %s %s %s %s C %s %s %s %s %s %s Z" fill="#e6e0d2" stroke="#c8c2b2" stroke-width="1.6"/>' % (
        f(cx - 58 * S), f(cy + 14 * S), f(cx - 20 * S), f(cy + 52 * S), f(cx + 24 * S), f(cy + 52 * S),
        f(cx + 56 * S), f(cy + 30 * S), f(cx + 30 * S), f(cy + 48 * S), f(cx - 24 * S), f(cy + 50 * S),
        f(cx - 58 * S), f(cy + 14 * S)))
    # 颈 + 头
    nx = cx + face * 52 * S
    g.append('<path d="M %s %s C %s %s %s %s %s %s" fill="none" stroke="#f7f4ec" stroke-width="%s" stroke-linecap="round"/>' % (
        f(cx + face * 34 * S), f(cy - 18 * S), f(cx + face * 78 * S), f(cy - 62 * S),
        f(nx - face * 10 * S), f(cy - 96 * S), f(nx), f(cy - 78 * S), f(30 * S)))
    g.append('<circle cx="%s" cy="%s" r="%s" fill="#f7f4ec" stroke="#c8c2b2" stroke-width="1.8"/>' % (
        f(nx), f(cy - 74 * S), f(24 * S)))
    # 巨长喙 + 喉囊（鹈鹕特征）
    tipx = nx + face * 118 * S
    g.append('<path d="M %s %s L %s %s L %s %s Z" fill="#f0a63c" stroke="#b5761f" stroke-width="1.8"/>' % (
        f(nx + face * 16 * S), f(cy - 84 * S), f(tipx), f(cy - 74 * S),
        f(nx + face * 16 * S), f(cy - 66 * S)))
    g.append('<path d="M %s %s C %s %s %s %s %s %s C %s %s %s %s %s %s Z" fill="#e8862c" stroke="#a85f16" stroke-width="1.8"/>' % (
        f(nx + face * 18 * S), f(cy - 68 * S), f(nx + face * 74 * S), f(cy - 50 * S),
        f(nx + face * 46 * S), f(cy - 8 * S), f(nx + face * 14 * S), f(cy - 30 * S),
        f(nx + face * 12 * S), f(cy - 50 * S), f(nx + face * 16 * S), f(cy - 64 * S),
        f(nx + face * 18 * S), f(cy - 68 * S)))
    g.append('<circle cx="%s" cy="%s" r="%s" fill="#2b2b2b"/>' % (f(nx - face * 4 * S), f(cy - 82 * S), f(4.4 * S)))
    # 双翼：水平展开的宽大翼面（承托北极熊）
    if wings:
        for sgn in (-1, 1):
            tipx = cx + sgn * wing_span * 0.5
            rootx = cx + sgn * 26 * S
            g.append('<path d="M %s %s C %s %s %s %s %s %s C %s %s %s %s %s %s Z" fill="#ded7c6" stroke="#b3ab97" stroke-width="2.2"/>' % (
                f(rootx), f(cy - 14 * S),
                f(cx + sgn * wing_span * 0.20), f(cy - 34 * S),
                f(cx + sgn * wing_span * 0.36), f(cy - 26 * S),
                f(tipx), f(cy - 18 * S),
                f(tipx - sgn * 6), f(cy + 10 * S),
                f(cx + sgn * wing_span * 0.36), f(cy + 30 * S),
                f(cx + sgn * wing_span * 0.20), f(cy + 24 * S)))
            g.append('<path d="M %s %s L %s %s" stroke="#1b7a4a" stroke-width="3" stroke-dasharray="10 7"/>' % (
                f(rootx), f(cy + 16 * S), f(tipx), f(cy + 16 * S)))
            # 初级飞羽
            for k in range(6):
                t = 0.30 + k * 0.115
                fx = cx + sgn * wing_span * t
                fy = cy + 20 * S
                g.append('<path d="M %s %s L %s %s" stroke="#b3ab97" stroke-width="1.5"/>' % (
                    f(fx), f(cy - 16 * S + k * 3 * S), f(fx + sgn * 10), f(fy + k * 2)))
    s.g(g)
    return {"beak_tip": (tipx, cy - 74 * S), "wing_l": (cx - wing_span * 0.5, cy - 8 * S),
            "wing_r": (cx + wing_span * 0.5, cy - 8 * S), "head": (nx, cy - 74 * S),
            "wing_surface_y": cy + 16 * S}


def octopus(s, cx, cy, r=34, arms=8):
    """章鱼：8 条互不合并的腕足（每条独立贝塞尔 + 吸盘）。"""
    import math
    s.path("M %s %s C %s %s %s %s %s %s C %s %s %s %s %s %s Z" % (
        f(cx - r), f(cy + r * 0.10), f(cx - r * 1.15), f(cy - r * 0.30), f(cx - r * 0.72), f(cy - r * 1.05),
        f(cx), f(cy - r * 1.05),
        f(cx + r * 0.72), f(cy - r * 1.05), f(cx + r * 1.15), f(cy - r * 0.30), f(cx + r), f(cy + r * 0.10)),
        "#b46ad0", "#7a3d94", 2)
    tips = []
    for i in range(arms):
        a0 = math.radians(-168 + i * (336.0 / (arms - 1)))
        L = r * (3.5 if i % 2 == 0 else 2.9)
        ex = cx + L * math.cos(a0)
        ey = cy + r * 0.35 + L * 0.62 * math.sin(a0) * 0.9
        mx = cx + L * 0.55 * math.cos(a0)
        my = cy + r * 0.35 + L * 0.20 * math.sin(a0)
        s.path("M %s %s Q %s %s %s %s" % (f(cx), f(cy + r * 0.20), f(mx), f(my), f(ex), f(ey)),
               "none", "#8a48a8", 7.2)
        s.path("M %s %s Q %s %s %s %s" % (f(cx), f(cy + r * 0.20), f(mx), f(my), f(ex), f(ey)),
               "none", "#b46ad0", 4.6)
        for k in range(1, 5):
            t = k / 5.2
            px = (1 - t) ** 2 * cx + 2 * (1 - t) * t * mx + t * t * ex
            py = (1 - t) ** 2 * (cy + r * 0.20) + 2 * (1 - t) * t * my + t * t * ey
            s.circ(px, py, 2.5 - k * 0.22, "#e6c9f5")
        tips.append((ex, ey))
    return tips


def turtle(s, cx, cy, L=104):
    s.ell(cx, cy, L * 0.5, L * 0.31, "#4f8a3c", "#2f5a24", 2)
    for i in range(-2, 3):
        s.path("M %s %s L %s %s" % (f(cx + i * L * 0.15), f(cy - L * 0.28), f(cx + i * L * 0.15), f(cy + L * 0.28)),
               "#2f5a24", 1.4)
    s.path("M %s %s L %s %s" % (f(cx - L * 0.46), f(cy), f(cx + L * 0.46), f(cy)), "#2f5a24", 1.4)
    s.ell(cx + L * 0.56, cy - L * 0.06, L * 0.11, L * 0.09, "#5aa04a", "#2f5a24", 1.6)
    s.circ(cx + L * 0.60, cy - L * 0.09, 2.4, "#1b2a38")
    for dx in (-0.30, -0.10, 0.12, 0.32):
        s.ell(cx + L * dx, cy + L * 0.30, L * 0.08, L * 0.06, "#5aa04a", "#2f5a24", 1.4)


def elephant(s, cx, cy, L=150):
    s.ell(cx, cy, L * 0.42, L * 0.30, "#b6bcc6", "#7d8590", 2)
    s.ell(cx + L * 0.36, cy - L * 0.16, L * 0.21, L * 0.20, "#b6bcc6", "#7d8590", 2)
    s.ell(cx + L * 0.20, cy - L * 0.20, L * 0.13, L * 0.19, "#a2a9b4", "#7d8590", 1.6)
    s.path("M %s %s C %s %s %s %s %s %s" % (f(cx + L * 0.52), f(cy - L * 0.10),
            f(cx + L * 0.60), f(cy + L * 0.16), f(cx + L * 0.44), f(cy + L * 0.30),
            f(cx + L * 0.40), f(cy + L * 0.16)), "none", "#b6bcc6", 9)
    s.circ(cx + L * 0.44, cy - L * 0.18, 3.0, "#2b2b2b")
    for dx in (-0.26, -0.06, 0.14, 0.30):
        s.rect(cx + L * dx, cy + L * 0.22, L * 0.11, L * 0.24, "#a9b0bb", "#7d8590", 1.4, rx=4)
    s.path("M %s %s L %s %s" % (f(cx + L * 0.40), f(cy - L * 0.02), f(cx + L * 0.47), f(cy + L * 0.04)),
           "#f2ead6", "#b9ae95", 1.2)


def apple_tree(s, cx, cy, R=62, apples=None, branch=None, hourglass_hook=None):
    """苹果树；apples=[(dx,dy,r,green)]；branch=(x1,y1,x2,y2) 挂沙漏的树枝。"""
    s.path("M %s %s C %s %s %s %s %s %s" % (f(cx), f(cy + R * 1.1), f(cx - 8), f(cy + R * 0.4),
            f(cx + 6), f(cy - R * 0.2), f(cx), f(cy - R * 0.5)), "none", "#6b4a22", 8)
    s.path("M %s %s C %s %s %s %s %s %s" % (f(cx - 2), f(cy - R * 0.2), f(cx - R * 0.4), f(cy - R * 0.4),
            f(cx - R * 0.6), f(cy - R * 0.6), f(cx - R * 0.66), f(cy - R * 0.5)),
            "none", "#6b4a22", 5)
    for dx, dy, r in ((-0.60, -0.58, 0.50), (0.10, -0.76, 0.54), (0.62, -0.46, 0.46), (0.30, -0.28, 0.44)):
        s.circ(cx + R * dx, cy + R * dy, R * r, "#4e9c3a", "#2f6b22", 1.8)
    if branch:
        x1, y1, x2, y2 = branch
        s.path("M %s %s Q %s %s %s %s" % (f(cx + R * 0.3), f(cy - R * 0.62),
                f((x1 + cx) / 2), f(y1 - 16), f(x2), f(y2)), "none", "#6b4a22", 5)
    for a in (apples or []):
        apple(s, cx + a[0], cy + a[1], a[2], a[3])
    if hourglass_hook:
        s.circ(hourglass_hook[0], hourglass_hook[1], 3.4, "#8a6a34")


def hourglass(s, cx, cy, W=44, H=96, hook=True):
    """透明沙漏：上仓装星星，下仓装微型齿轮。"""
    if hook:
        s.rect(cx - 3, cy - H / 2 - 14, 6, 14, "#8a6a34", None, 0)
    s.poly([(cx - W / 2, cy - H / 2), (cx + W / 2, cy - H / 2), (cx, cy)], "rgba(210,238,248,0.5)",
           "#5b8fa3", 1.8)
    s.poly([(cx, cy), (cx + W / 2, cy + H / 2), (cx - W / 2, cy + H / 2)], "rgba(210,238,248,0.5)",
           "#5b8fa3", 1.8)
    s.rect(cx - W / 2 - 6, cy - H / 2 - 5, W + 12, 8, "#a3763c", "#6b4a22", 1.6, rx=3)
    s.rect(cx - W / 2 - 6, cy + H / 2 - 3, W + 12, 8, "#a3763c", "#6b4a22", 1.6, rx=3)
    k = H / 96.0
    for dx, dy, r in ((-11, -20, 7.0), (6, -30, 6.0), (12, -13, 6.4), (-4, -36, 5.4),
                      (2, -12, 4.6)):
        s.star(cx + dx * k, cy + dy * k, r * k, "#ffd54a", "#c99a1c", 1.2)
    gear(s, cx - 8 * k, cy + 24 * k, 11 * k, 8)
    gear(s, cx + 10 * k, cy + 33 * k, 8.6 * k, 8)
    gear(s, cx - 1 * k, cy + 42 * k, 7.4 * k, 7)


def teacup_island(s, cx, cy, W=104):
    """茶杯 + 杯中小岛 + 岛上灯塔（灯塔顶由调用方放玻璃球）。"""
    s.path("M %s %s L %s %s Q %s %s %s %s L %s %s Q %s %s %s %s Z" % (
        f(cx - W / 2), f(cy), f(cx + W / 2), f(cy), f(cx + W * 0.40), f(cy + W * 0.42),
        f(cx - W * 0.40), f(cy + W * 0.42), f(cx - W / 2), f(cy),
        f(cx - W * 0.40), f(cy + W * 0.36), f(cx + W * 0.40), f(cy + W * 0.36)),
        "#fbfaf6", "#b9b2a4", 2)
    s.path("M %s %s a %s %s 0 0 0 %s 0" % (f(cx + W / 2 - 2), f(cy + 4), f(W * 0.22), f(W * 0.22),
            f(W * 0.44)), "none", "#b9b2a4", 5)
    s.ell(cx, cy + W * 0.42, W * 0.40, W * 0.10, "#efece2", "#b9b2a4", 1.6)
    # 小岛
    s.path("M %s %s q %s %s %s %s q %s %s %s 0 Z" % (
        f(cx - W * 0.28), f(cy + W * 0.28), f(W * 0.10), f(-W * 0.16), f(W * 0.28), f(-W * 0.02),
        f(W * 0.20), f(-W * 0.12), f(W * 0.30)), "#7cc05a", "#3f7d24", 1.6)
    return (cx, cy - W * 0.10)   # 灯塔底座


def lighthouse(s, cx, cy, H=52, W=18):
    s.poly([(cx - W / 2, cy + H), (cx + W / 2, cy + H), (cx + W * 0.34, cy), (cx - W * 0.34, cy)],
           "#fbfaf6", "#8d8577", 1.6)
    for i in range(3):
        yy = cy + H - (i + 0.5) * H / 3.4
        s.path("M %s %s L %s %s" % (f(cx - W * 0.46 + i * 0.6), f(yy),
                f(cx + W * 0.46 - i * 0.6), f(yy)), "#d8452f", 3.4)
    s.rect(cx - W * 0.42, cy - 9, W * 0.84, 9, "#39485a", "#1b2a38", 1.2, rx=2)
    s.poly([(cx - W * 0.5, cy - 9), (cx + W * 0.5, cy - 9), (cx, cy - 20)], "#5b6b7d", "#1b2a38", 1.2)


def glass_ball(s, cx, cy, r, uid):
    s.circ(cx, cy, r, "rgba(198,236,250,0.30)", "#7fb6cc", 2)
    s.circ(cx - r * 0.34, cy - r * 0.36, r * 0.20, "#ffffff", None, 0, op=0.65)
    s.circ(cx + r * 0.30, cy + r * 0.34, r * 0.13, "#ffffff", None, 0, op=0.40)


# ============ 递归微缩场景 ============
def mini_plane(s, cx, cy, L=54, nose=1, tag=""):
    """微缩飞机（仅作递归示意），nose=1 机头朝右，nose=-1 朝左。"""
    s.g([
        '<rect x="%s" y="%s" width="%s" height="%s" rx="%s" fill="#eef3f8" stroke="#5b6b7d" stroke-width="1"/>' % (
            f(cx - L / 2), f(cy - L * 0.11), f(L), f(L * 0.22), f(L * 0.11)),
        '<polygon points="%s" fill="#dbe5ee" stroke="#5b6b7d" stroke-width="0.8"/>' % (
            " ".join("%s,%s" % (f(x), f(y)) for x, y in [
                (cx - nose * L * 0.06, cy - L * 0.05), (cx + nose * L * 0.12, cy - L * 0.40),
                (cx + nose * L * 0.24, cy - L * 0.40), (cx + nose * L * 0.14, cy - L * 0.05)])),
        '<polygon points="%s" fill="#dbe5ee" stroke="#5b6b7d" stroke-width="0.8"/>' % (
            " ".join("%s,%s" % (f(x), f(y)) for x, y in [
                (cx + nose * L * 0.40, cy - L * 0.03), (cx + nose * L * 0.46, cy - L * 0.24),
                (cx + nose * L * 0.50, cy - L * 0.24), (cx + nose * L * 0.49, cy - L * 0.02)])),
    ])
    for k in (-0.16, 0.02, 0.20, 0.34):
        s.rect(cx + nose * L * k, cy - L * 0.30, L * 0.07, L * 0.09, "#cfd9e3", "#5b6b7d", 0.6, rx=1.5)
    s.circ(cx + nose * L * 0.44, cy - L * 0.02, L * 0.035, "#7fb6cc", "#3a5a6b", 0.6)


def mini_scene(s, cx, cy, k, uid):
    """第 k 层递归画面（k=1 或 2）。第 3 层以金色圆点终止。"""
    if k >= 3:
        s.circ(cx, cy, 4.6, "#f2c94c", "#a8791a", 1.2)
        return
    sc = 1.0 if k == 1 else 0.42
    mini_plane(s, cx, cy + 14 * sc, 62 * sc, nose=1 if k == 1 else -1)
    # 承托链缩影：翼上鹈鹕 → 熊 → 树 → 下一层玻璃球
    s.rect(cx - 26 * sc, cy + 10 * sc, 52 * sc, 5 * sc, "#dbe5ee", "#5b6b7d", 0.7)
    s.circ(cx - 8 * sc, cy + 5 * sc, 4.2 * sc, "#f6f2e6", "#b9ae95", 0.7)
    s.circ(cx + 2 * sc, cy - 2 * sc, 6 * sc, "#4e9c3a", "#2f6b22", 0.7)
    s.circ(cx + 12 * sc, cy - 6 * sc, 11 * sc, "rgba(198,236,250,0.35)", "#7fb6cc", 1.2)
    mini_scene(s, cx + 12 * sc, cy - 6 * sc, k + 1, uid)
