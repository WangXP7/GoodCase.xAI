# -*- coding: utf-8 -*-
"""极小 SVG 构建工具集（纯字符串拼接，无第三方依赖）。"""

FONT = "'Noto Sans SC','Source Han Sans SC','PingFang SC','Microsoft YaHei','SimHei',sans-serif"
MONO = "'DejaVu Sans Mono','Consolas',monospace"


def esc(t):
    return (str(t).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def f(v):
    """数字格式化：整数不带小数点。"""
    if isinstance(v, int):
        return str(v)
    r = round(float(v), 2)
    if r == int(r):
        return str(int(r))
    return ("%.2f" % r).rstrip("0").rstrip(".")


class S:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.b = []

    def add(self, s):
        self.b.append(s)

    # ---------- 基本图元 ----------
    def rect(self, x, y, w, h, fill="none", stroke="none", sw=1, rx=0, op=None,
             dash=None, cap=None, join=None, filt=None):
        a = ['<rect x="%s" y="%s" width="%s" height="%s"' % (f(x), f(y), f(w), f(h))]
        a.append(' fill="%s"' % fill)
        if stroke != "none":
            a.append(' stroke="%s" stroke-width="%s"' % (stroke, f(sw)))
        if rx:
            a.append(' rx="%s"' % f(rx))
        if op is not None:
            a.append(' opacity="%s"' % f(op))
        if dash:
            a.append(' stroke-dasharray="%s"' % dash)
        if cap:
            a.append(' stroke-linecap="%s"' % cap)
        if join:
            a.append(' stroke-linejoin="%s"' % join)
        if filt:
            a.append(' filter="url(#%s)"' % filt)
        a.append("/>")
        self.add("".join(a))

    def circ(self, cx, cy, r, fill="none", stroke="none", sw=1, op=None, dash=None):
        self.add('<circle cx="%s" cy="%s" r="%s" fill="%s"%s%s%s/>' % (
            f(cx), f(cy), f(r), fill,
            ' stroke="%s" stroke-width="%s"' % (stroke, f(sw)) if stroke != "none" else "",
            ' opacity="%s"' % f(op) if op is not None else "",
            ' stroke-dasharray="%s"' % dash if dash else ""))

    def ell(self, cx, cy, rx, ry, fill="none", stroke="none", sw=1, rot=0, op=None):
        t = ' transform="rotate(%s %s %s)"' % (f(rot), f(cx), f(cy)) if rot else ""
        self.add('<ellipse cx="%s" cy="%s" rx="%s" ry="%s" fill="%s"%s%s%s/>' % (
            f(cx), f(cy), f(rx), f(ry), fill,
            ' stroke="%s" stroke-width="%s"' % (stroke, f(sw)) if stroke != "none" else "",
            ' opacity="%s"' % f(op) if op is not None else "", t))

    def line(self, x1, y1, x2, y2, stroke="#333", sw=1, dash=None, cap="round", op=None,
             marker=None):
        a = ['<line x1="%s" y1="%s" x2="%s" y2="%s"' % (f(x1), f(y1), f(x2), f(y2))]
        a.append(' stroke="%s" stroke-width="%s"' % (stroke, f(sw)))
        if dash:
            a.append(' stroke-dasharray="%s"' % dash)
        a.append(' stroke-linecap="%s"' % cap)
        if op is not None:
            a.append(' opacity="%s"' % f(op))
        if marker:
            a.append(' marker-end="url(#%s)"' % marker)
        a.append("/>")
        self.add("".join(a))

    def path(self, d, fill="none", stroke="none", sw=1, op=None, dash=None,
             cap="round", join="round", marker=None):
        a = ['<path d="%s" fill="%s"' % (d, fill)]
        if stroke != "none":
            a.append(' stroke="%s" stroke-width="%s"' % (stroke, f(sw)))
        if op is not None:
            a.append(' opacity="%s"' % f(op))
        if dash:
            a.append(' stroke-dasharray="%s"' % dash)
        a.append(' stroke-linecap="%s" stroke-linejoin="%s"' % (cap, join))
        if marker:
            a.append(' marker-end="url(#%s)"' % marker)
        a.append("/>")
        self.add("".join(a))

    def poly(self, pts, fill="none", stroke="none", sw=1, op=None, join="round"):
        p = " ".join("%s,%s" % (f(x), f(y)) for x, y in pts)
        a = ['<polygon points="%s" fill="%s"' % (p, fill)]
        if stroke != "none":
            a.append(' stroke="%s" stroke-width="%s"' % (stroke, f(sw)))
        if op is not None:
            a.append(' opacity="%s"' % f(op))
        a.append(' stroke-linejoin="%s"/>' % join)
        self.add("".join(a))

    def g(self, content, transform=None, op=None):
        at = ' transform="%s"' % transform if transform else ""
        if op is not None:
            at += ' opacity="%s"' % f(op)
        self.add("<g%s>%s</g>" % (at, "".join(content)))

    # ---------- 文本 ----------
    def text(self, x, y, t, size=15, fill="#16202c", anchor="middle", weight="400",
             ls=None, op=None, rot=None, family=None, style=None):
        a = ['<text x="%s" y="%s" font-size="%s" fill="%s" text-anchor="%s" font-weight="%s"'
             % (f(x), f(y), f(size), fill, anchor, weight)]
        a.append(' font-family="%s"' % (family or FONT))
        if ls:
            a.append(' letter-spacing="%s"' % f(ls))
        if op is not None:
            a.append(' opacity="%s"' % f(op))
        if rot:
            a.append(' transform="rotate(%s %s %s)"' % (f(rot), f(x), f(y)))
        if style:
            a.append(' font-style="%s"' % style)
        a.append(">%s</text>" % esc(t))
        self.add("".join(a))

    def rich(self, x, y, parts, size=15, anchor="middle", weight="400", ls=None):
        """parts: [(text, fill, weight_or_None), ...] 同一行内多色多字重。"""
        a = ['<text x="%s" y="%s" font-size="%s" text-anchor="%s" font-weight="%s" font-family="%s"'
             % (f(x), f(y), f(size), anchor, weight, FONT)]
        if ls:
            a.append(' letter-spacing="%s"' % f(ls))
        a.append(">")
        for p in parts:
            t, fl = p[0], p[1]
            wt = p[2] if len(p) > 2 else None
            a.append('<tspan fill="%s"%s>%s</tspan>' % (fl, ' font-weight="%s"' % wt if wt else "", esc(t)))
        a.append("</text>")
        self.add("".join(a))

    def block(self, x, y, lines, size=14, lh=20, fill="#16202c", anchor="start",
              weight="400", op=None):
        """多行文本，y 为第一行基线。"""
        a = ['<text x="%s" y="%s" font-size="%s" fill="%s" text-anchor="%s" font-weight="%s"'
             ' font-family="%s"' % (f(x), f(y), f(size), fill, anchor, weight, FONT)]
        if op is not None:
            a.append(' opacity="%s"' % f(op))
        a.append(">")
        for i, ln in enumerate(lines):
            dy = 0 if i == 0 else lh
            a.append('<tspan x="%s" dy="%s">%s</tspan>' % (f(x), f(dy), esc(ln)))
        a.append("</text>")
        self.add("".join(a))

    # ---------- 复合形状 ----------
    def star(self, cx, cy, r, fill="#f2c14e", stroke="none", sw=1, n=5, inner=0.42, rot=-90):
        import math
        pts = []
        for i in range(n * 2):
            ang = math.radians(rot + i * 180.0 / n)
            rr = r if i % 2 == 0 else r * inner
            pts.append((cx + rr * math.cos(ang), cy + rr * math.sin(ang)))
        self.poly(pts, fill, stroke, sw)

    def gear(self, cx, cy, r, teeth=8, fill="#b9c6d4", stroke="#5b6b7d", sw=1, hole=0.38):
        import math
        pts = []
        for i in range(teeth * 2):
            ang = math.radians(i * 180.0 / teeth)
            rr = r if i % 2 == 0 else r * 0.76
            pts.append((cx + rr * math.cos(ang), cy + rr * math.sin(ang)))
        self.poly(pts, fill, stroke, sw, join="miter")
        self.circ(cx, cy, r * hole, "#eef3f8", stroke, max(0.6, sw * 0.8))

    LOBES = ((-0.31, 0.05, 0.25), (0.29, 0.04, 0.23), (0.0, -0.02, 0.33),
             (-0.13, -0.17, 0.23), (0.15, -0.16, 0.21), (-0.02, 0.21, 0.33))

    def cloud(self, cx, cy, w, h, fill="#ffffff", op=0.9, lobes=None, stroke="none", sw=1):
        seg = []
        for dx, dy, rr in (lobes or self.LOBES):
            seg.append('<ellipse cx="%s" cy="%s" rx="%s" ry="%s" fill="%s"%s/>' % (
                f(cx + dx * w), f(cy + dy * h), f(rr * w), f(rr * h * 1.12), fill,
                ' stroke="%s" stroke-width="%s"' % (stroke, f(sw)) if stroke != "none" else ""))
        self.g(seg, op=op)

    def plate(self, x, y, w, h, title=None, fill="#fdfdf6", stroke="#2b3a4a", sw=1.6,
              rx=8, tsize=17, tfill="#16202c"):
        """带标题的说明底板。"""
        self.rect(x, y, w, h, fill, stroke, sw, rx=rx, op=0.94)
        if title:
            self.rect(x, y, w, 30, "#1f3b57", rx=rx, op=0.95)
            self.rect(x, y + 18, w, 12, "#1f3b57", op=0.95)
            self.text(x + w / 2, y + 21, title, tsize, "#f4f8fb", "middle", "700")

    def doc(self):
        return ('<?xml version="1.0" encoding="UTF-8"?>\n'
                '<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" '
                'viewBox="0 0 %d %d" font-family="%s">\n%s\n</svg>\n'
                % (self.w, self.h, self.w, self.h, FONT, "\n".join(self.b)))

    def save(self, path):
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(self.doc())


# ---------------- 常用 defs ----------------
def defs(S_, uid):
    S_.add('''<defs>
<linearGradient id="sky%s" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#0e2a4d"/><stop offset="0.34" stop-color="#1d4d7d"/>
  <stop offset="0.66" stop-color="#3f7fae"/><stop offset="0.88" stop-color="#8db9cf"/>
  <stop offset="1" stop-color="#f0cf9c"/>
</linearGradient>
<radialGradient id="sun%s" cx="0.5" cy="0.5" r="0.5">
  <stop offset="0" stop-color="#fff6dd" stop-opacity="0.95"/>
  <stop offset="0.45" stop-color="#ffe6ad" stop-opacity="0.35"/>
  <stop offset="1" stop-color="#ffd88a" stop-opacity="0"/>
</radialGradient>
<linearGradient id="hull%s" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#ffffff"/><stop offset="0.55" stop-color="#eef3f8"/>
  <stop offset="1" stop-color="#c3d2df"/>
</linearGradient>
<linearGradient id="glass%s" x1="0" y1="0" x2="0.3" y2="1">
  <stop offset="0" stop-color="#dff4fb" stop-opacity="0.62"/>
  <stop offset="1" stop-color="#9fd0e4" stop-opacity="0.34"/>
</linearGradient>
<linearGradient id="grn%s" x1="0" y1="0" x2="0.4" y2="1">
  <stop offset="0" stop-color="#e8fbff" stop-opacity="0.55"/>
  <stop offset="1" stop-color="#a8dced" stop-opacity="0.3"/>
</linearGradient>
<marker id="ar%s" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
  <path d="M0,1 L10,5 L0,9 z" fill="context-stroke"/></marker>
<marker id="arm%s" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto">
  <path d="M0,1 L10,5 L0,9 z" fill="#c0392b"/></marker>
</defs>''' % (uid, uid, uid, uid, uid, uid, uid))
