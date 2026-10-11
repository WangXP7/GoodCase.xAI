# -*- coding: utf-8 -*-
"""《自行车骑鹈鹕》参数化生成器：v2/v3 静态迭代 + SMIL 动画 SVG + GIF 逐帧输出"""
import math, os

ROOT = r"."
TAU = math.tau

def rot(px, py, cx, cy, deg):
    a = math.radians(deg)
    dx, dy = px - cx, py - cy
    return (cx + dx * math.cos(a) - dy * math.sin(a), cy + dx * math.sin(a) + dy * math.cos(a))

def leg_ik(hip, foot_x, foot_y, L=62):
    dx, dy = foot_x - hip[0], foot_y - hip[1]
    d = math.hypot(dx, dy)
    d = min(d, 2 * L - 1)
    ux, uy = dx / d, dy / d
    fx, fy = hip[0] + ux * d, hip[1] + uy * d
    a, h = d / 2, math.sqrt(max(L * L - (d / 2) ** 2, 0))
    nx, ny = uy, -ux
    if nx > 0: nx, ny = -nx, -ny
    return (hip[0], hip[1]), (hip[0] + ux * a + nx * h, hip[1] + uy * a + ny * h), (fx, fy)

def pose(t):
    u = TAU * t
    bob = 2 - 4 * abs(math.sin(u))                    # 身体起伏（每步一沉）
    pitch = 1.2 * math.sin(2 * u + 0.6)               # 身体俯仰
    hipN = (585, 672 + bob)
    hipF = (668, 672 + bob)
    fnx = hipN[0] + 38 * math.cos(u)
    fnlift = 26 * max(0.0, -math.sin(u))
    ffx = hipF[0] + 38 * math.cos(u + math.pi)
    fflift = 26 * max(0.0, -math.sin(u + math.pi))
    headTilt = 2.4 * math.sin(2 * u + 1.1)
    billTilt = 2.2 * math.sin(2 * u + 2.1)
    bikeBob = bob * 0.85
    bikePitch = pitch * 0.5
    crank = 360 * t
    flag = 8 * math.sin(2 * u + 0.8)
    return dict(t=t, u=u, bob=bob, pitch=pitch, hipN=hipN, hipF=hipF,
                fnx=fnx, fnlift=fnlift, ffx=ffx, fflift=fflift,
                headTilt=headTilt, billTilt=billTilt,
                bikeBob=bikeBob, bikePitch=bikePitch, crank=crank, flag=flag)

def rein_path(P):
    grip = (502, 344 + P["bikeBob"])
    b1 = rot(348, 386, 470, 545, P["headTilt"])
    b2 = rot(b1[0], b1[1], 398, 374, P["billTilt"])
    sag = 30 + 5 * math.sin(2 * P["u"] + 1.0)
    m1 = (grip[0] * 0.55 + b2[0] * 0.45, max(grip[1], b2[1]) + sag)
    m2 = (grip[0] * 0.30 + b2[0] * 0.70, max(grip[1], b2[1]) + sag * 0.7)
    return (f"M {grip[0]:.1f},{grip[1]:.1f} C {m1[0]:.1f},{m1[1]:.1f} {m2[0]:.1f},{m2[1]:.1f} {b2[0]:.1f},{b2[1]:.1f}",
            b2)

def foot_svg(fx, fy, lift, color, dark):
    tilt = -18 * min(1, lift / 26)
    g = f'<g transform="rotate({tilt:.1f} {fx:.1f} {fy:.1f})">'
    g += (f'<path d="M {fx+28:.1f},{fy-9:.1f} L {fx-30:.1f},{fy+1:.1f} L {fx+20:.1f},{fy+8:.1f} Z" '
          f'fill="{color}" stroke="{dark}" stroke-width="1.5"/>')
    g += f'<path d="M {fx-22:.1f},{fy:.1f} l 8,4 M {fx-12:.1f},{fy-1:.1f} l 7,4" stroke="{dark}" stroke-width="1.2" fill="none"/>'
    return g + "</g>"

def build(t, level=2, anim=False):
    P = pose(t)
    K = 12
    def kf(fn):  # SMIL 关键帧值串（首尾相接）
        return ";".join(fn(k / K) for k in range(K + 1))
    A = (lambda attr, dur="1.2s": "") if not anim else None

    # ---- 环境常量 ----
    s = []
    s.append('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="960" viewBox="0 0 1280 960">')
    s.append('<desc>自行车骑鹈鹕：一辆戴头盔的自行车骑着大鹈鹕在海滩木栈道上前行。</desc>')
    s.append('''<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a9d9f2"/><stop offset="1" stop-color="#eef9ff"/></linearGradient>
<linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4cb8ec"/><stop offset="1" stop-color="#1493d2"/></linearGradient>
<linearGradient id="sand" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fde9a8"/><stop offset="1" stop-color="#f7d878"/></linearGradient>
<linearGradient id="frame" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f87171"/><stop offset="1" stop-color="#dc2626"/></linearGradient>
</defs>''')
    s.append('<rect width="1280" height="960" fill="url(#sky)"/>')

    # 太阳（光芒旋转）
    ray_rot = (f'<animateTransform attributeName="transform" type="rotate" from="0 1120 128" to="360 1120 128" dur="30s" repeatCount="indefinite"/>'
               if anim else "")
    s.append(f'''<g>{ray_rot}<circle cx="1120" cy="128" r="58" fill="#ffe27a" stroke="#ffd24d" stroke-width="3"/>
<g stroke="#ffd24d" stroke-width="4" stroke-linecap="round" opacity="0.85">
<line x1="1120" y1="42" x2="1120" y2="22"/><line x1="1120" y1="214" x2="1120" y2="234"/>
<line x1="1034" y1="128" x2="1014" y2="128"/><line x1="1206" y1="128" x2="1226" y2="128"/>
<line x1="1059" y1="67" x2="1045" y2="53"/><line x1="1181" y1="189" x2="1195" y2="203"/>
<line x1="1059" y1="189" x2="1045" y2="203"/><line x1="1181" y1="67" x2="1195" y2="53"/></g></g>''')

    # 云（漂移）
    c1 = ('<animateTransform attributeName="transform" type="translate" values="0,0;30,0;0,0" dur="10s" repeatCount="indefinite"/>' if anim else "")
    c2 = ('<animateTransform attributeName="transform" type="translate" values="0,0;-24,0;0,0" dur="12s" repeatCount="indefinite"/>' if anim else "")
    s.append(f'''<g fill="#ffffff" opacity="0.92"><g>{c1}<ellipse cx="205" cy="150" rx="58" ry="22"/><circle cx="185" cy="132" r="22"/><circle cx="222" cy="128" r="26"/></g>
<g>{c2}<ellipse cx="520" cy="100" rx="46" ry="17"/><circle cx="505" cy="86" r="17"/><circle cx="536" cy="84" r="20"/></g>
<g><ellipse cx="880" cy="170" rx="40" ry="15" opacity="0.8"/><circle cx="870" cy="158" r="14" opacity="0.8"/><circle cx="895" cy="156" r="17" opacity="0.8"/></g></g>''')

    # 海 + 波浪（漂移）+ 帆船 + 浪花
    wav = ('<animateTransform attributeName="transform" type="translate" values="-12,0;12,0;-12,0" dur="2.6s" repeatCount="indefinite"/>' if anim else "")
    s.append('<rect x="0" y="556" width="1280" height="134" fill="url(#sea)"/>')
    s.append('<line x1="0" y1="556" x2="1280" y2="556" stroke="#e8f7ff" stroke-width="2" opacity="0.8"/>')
    s.append(f'<g>{wav}<g stroke="#bfe9fb" stroke-width="3" fill="none" stroke-linecap="round" opacity="0.7">'
             '<path d="M 90,600 q 30,-8 60,0"/><path d="M 330,625 q 35,-9 70,0"/><path d="M 700,605 q 30,-8 60,0"/>'
             '<path d="M 1010,640 q 35,-9 70,0"/><path d="M 560,655 q 30,-8 60,0"/></g></g>')
    s.append('''<g><path d="M 752,545 l -10,0 4,-72 30,58 -30,4 24,10 -44,0 Z" fill="#f87171" opacity="0.9"/>
<path d="M 740,547 l -14,0 18,-78 Z" fill="#fef3c7"/><path d="M 692,548 l 84,0 -12,16 -60,0 Z" fill="#7f1d1d"/></g>''')
    s.append('<path d="M 0,686 q 40,-8 80,0 t 80,0 t 80,0 t 80,0 t 80,0 t 80,0 t 80,0 t 80,0 t 80,0 t 80,0 t 80,0 t 80,0 t 80,0 t 80,0 t 80,0 t 80,0" fill="none" stroke="#ffffff" stroke-width="4" opacity="0.75"/>')

    # 沙滩 + 脚印
    s.append('<rect x="0" y="688" width="1280" height="272" fill="url(#sand)"/>')
    s.append('''<g fill="#e7c25c" opacity="0.8"><circle cx="300" cy="880" r="3"/><circle cx="640" cy="910" r="3"/><circle cx="1000" cy="930" r="3"/>
<circle cx="180" cy="930" r="2.5"/><circle cx="860" cy="880" r="2.5"/><circle cx="1180" cy="915" r="3"/></g>''')
    if level >= 1:
        s.append('''<g fill="#d9b04f" opacity="0.85">
<ellipse cx="872" cy="898" rx="7" ry="4" transform="rotate(-14 872 898)"/><ellipse cx="896" cy="912" rx="7" ry="4" transform="rotate(-10 896 912)"/>
<ellipse cx="922" cy="896" rx="7" ry="4" transform="rotate(-16 922 896)"/><ellipse cx="948" cy="910" rx="7" ry="4" transform="rotate(-8 948 910)"/></g>''')
    s.append('''<path d="M 1120,905 l 6,14 15,2 -11,10 3,15 -13,-8 -13,8 3,-15 -11,-10 15,-2 Z" fill="#f472b6" stroke="#db2777" stroke-width="1.5" transform="rotate(-12 1120 922)"/>
<path d="M 975,908 q 10,-14 20,0 q -10,10 -20,0 Z" fill="#fda4af" stroke="#e11d48" stroke-width="1.2"/>
<path d="M 240,915 q 9,-12 18,0 q -9,9 -18,0 Z" fill="#fda4af" stroke="#e11d48" stroke-width="1.2"/>''')

    # 木栈道
    s.append('<rect x="0" y="700" width="1280" height="140" fill="#d8a468"/>')
    s.append('<rect x="0" y="700" width="1280" height="8" fill="#e8bb7e"/>')
    s.append('''<g stroke="#b97f4a" stroke-width="3" opacity="0.85">
<line x1="90" y1="708" x2="70" y2="840"/><line x1="260" y1="708" x2="248" y2="840"/><line x1="430" y1="708" x2="426" y2="840"/>
<line x1="600" y1="708" x2="604" y2="840"/><line x1="770" y1="708" x2="782" y2="840"/><line x1="940" y1="708" x2="960" y2="840"/>
<line x1="1110" y1="708" x2="1138" y2="840"/></g>''')
    s.append('<line x1="0" y1="840" x2="1280" y2="840" stroke="#b97f4a" stroke-width="3" opacity="0.6"/>')

    # 木牌
    s.append('''<g transform="rotate(-3 1030 640)"><rect x="1022" y="620" width="14" height="110" fill="#b97f4a" stroke="#8a5a2b" stroke-width="2"/>
<rect x="948" y="560" width="162" height="58" rx="8" fill="#fff7e6" stroke="#8a5a2b" stroke-width="3"/>
<text x="1029" y="586" font-family="Microsoft YaHei, sans-serif" font-size="21" font-weight="bold" fill="#7a4a1d" text-anchor="middle">海滩慢行</text>
<text x="1029" y="609" font-family="Microsoft YaHei, sans-serif" font-size="13" fill="#a1713c" text-anchor="middle">鹈鹕优先 · 勿喂链条</text></g>''')

    # 螃蟹
    claw = ('<animateTransform attributeName="transform" type="translate" values="0,0;0,-2.5;0,0" dur="0.6s" repeatCount="indefinite"/>' if anim else "")
    s.append(f'''<g>{claw}<ellipse cx="182" cy="872" rx="17" ry="11" fill="#ef6c4d" stroke="#c2410c" stroke-width="1.5"/>
<line x1="172" y1="864" x2="160" y2="850" stroke="#c2410c" stroke-width="3"/><circle cx="158" cy="846" r="6" fill="#ef6c4d" stroke="#c2410c" stroke-width="1.5"/>
<line x1="192" y1="864" x2="205" y2="850" stroke="#c2410c" stroke-width="3"/><circle cx="207" cy="846" r="6" fill="#ef6c4d" stroke="#c2410c" stroke-width="1.5"/>
<line x1="177" y1="854" x2="175" y2="844" stroke="#c2410c" stroke-width="2"/><line x1="187" y1="854" x2="189" y2="844" stroke="#c2410c" stroke-width="2"/>
<circle cx="175" cy="842" r="2" fill="#7c2d12"/><circle cx="189" cy="842" r="2" fill="#7c2d12"/>
<g stroke="#c2410c" stroke-width="2.5" stroke-linecap="round"><line x1="170" y1="880" x2="162" y2="890"/><line x1="178" y1="882" x2="174" y2="892"/>
<line x1="194" y1="880" x2="202" y2="890"/><line x1="187" y1="882" x2="191" y2="892"/></g></g>''')

    # 海鸥（起伏）
    gull = ('<animateTransform attributeName="transform" type="translate" values="0,0;0,7;0,0" dur="1.2s" repeatCount="indefinite"/>' if anim else "")
    s.append(f'<g transform="translate(952,168)">{gull}<path d="M -26,6 q 10,-14 26,-10 q 16,-4 26,10 q -14,10 -26,6 q -12,4 -26,-6 Z" fill="#f8fafc" stroke="#64748b" stroke-width="2"/>'
             '<path d="M -14,-2 q 12,-16 30,-8" fill="none" stroke="#64748b" stroke-width="2.5" stroke-linecap="round"/>'
             '<path d="M -22,-3 q -14,-4 -22,2" fill="none" stroke="#64748b" stroke-width="2.5" stroke-linecap="round"/>'
             '<circle cx="24" cy="-2" r="2.2" fill="#334155"/><path d="M 30,0 l 10,3 -10,3 Z" fill="#f59e0b"/></g>')

    # 阴影
    s.append('<ellipse cx="625" cy="806" rx="215" ry="18" fill="#3f2d16" opacity="0.16"/>')

    # ---- 腿（世界坐标，IK） ----
    def leg_svg(hip, fx, fy, lift, w, col, knee_col):
        h, k, f = leg_ik(hip, fx, fy)
        out = (f'<path d="M {h[0]:.1f},{h[1]:.1f} L {k[0]:.1f},{k[1]:.1f} L {f[0]:.1f},{f[1]:.1f}" fill="none" '
               f'stroke="{col}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"/>')
        out += f'<circle cx="{k[0]:.1f}" cy="{k[1]:.1f}" r="4.5" fill="{knee_col}"/>'
        out += foot_svg(f[0], f[1], lift, "#f59e0b", "#b45309")
        return out
    s.append(leg_svg(P["hipF"], P["ffx"], 786 - P["fflift"], P["fflift"], 11, "#d97706", "#b45309"))

    # ---- 身体组（起伏 + 俯仰） ----
    if anim:
        bob_v = ";".join(f"0,{2 - 4 * abs(math.sin(TAU * k / K)):.1f}" for k in range(K + 1))
        pit_v = ";".join(f"{1.2 * math.sin(TAU * k / K + 0.6):.2f} 620 600" for k in range(K + 1))
        body_t = (f'<animateTransform attributeName="transform" type="translate" values="{bob_v}" dur="1.2s" repeatCount="indefinite"/>')
        body_r = (f'<animateTransform attributeName="transform" type="rotate" values="{pit_v}" dur="1.2s" repeatCount="indefinite"/>')
    else:
        body_t = f'transform="translate(0,{P["bob"]:.1f})"'
        body_r = f'transform="rotate({P["pitch"]:.2f} 620 600)"'
    if anim:
        s.append(f'<g>{body_t}<g>{body_r}')
    else:
        s.append(f'<g {body_t}><g {body_r}>')
    s.append('<ellipse cx="620" cy="600" rx="172" ry="112" fill="#f8fafc" stroke="#94a3b8" stroke-width="3" transform="rotate(-8 620 600)"/>')
    s.append('<path d="M 764,542 C 800,524 826,522 842,532 C 830,546 812,552 794,552 C 812,558 828,570 836,584 C 816,586 792,578 772,564 Z" fill="#e8eef5" stroke="#94a3b8" stroke-width="2.5" stroke-linejoin="round"/>')
    s.append('<path d="M 545,565 Q 640,512 738,562 Q 655,622 548,606 Z" fill="#eef2f7" stroke="#aebccd" stroke-width="2.5"/>')
    s.append('<g stroke="#b9c6d6" stroke-width="2" fill="none" opacity="0.9"><path d="M 580,578 Q 650,548 716,572"/><path d="M 572,592 Q 648,566 716,586"/></g>')
    if level >= 2:
        s.append('<path d="M 500,560 Q 610,505 730,560" fill="none" stroke="#dbe3ec" stroke-width="4" opacity="0.8"/>')
    # 鞍垫 + 肚带（随身体）
    s.append('<path d="M 706,505 C 718,575 708,645 676,690" fill="none" stroke="#a16207" stroke-width="9" stroke-linecap="round"/>')
    s.append('<rect x="700" y="636" width="14" height="12" rx="2" fill="#fcd34d" stroke="#a16207" stroke-width="1.5" transform="rotate(8 707 642)"/>')
    s.append('<g transform="rotate(-8 652 495)"><rect x="582" y="478" width="140" height="42" rx="14" fill="#7c3aed" stroke="#5b21b6" stroke-width="3"/>'
             '<rect x="590" y="486" width="124" height="10" rx="5" fill="#f6c445" opacity="0.9"/>')
    if level >= 1:
        s.append('<g fill="#f6c445" opacity="0.75"><circle cx="612" cy="508" r="3"/><circle cx="636" cy="508" r="3"/><circle cx="660" cy="508" r="3"/><circle cx="684" cy="508" r="3"/></g>')
    s.append('<g stroke="#f6c445" stroke-width="3" stroke-linecap="round"><line x1="600" y1="520" x2="598" y2="530"/><line x1="625" y1="520" x2="624" y2="532"/><line x1="650" y1="520" x2="650" y2="530"/></g></g>')
    s.append('</g></g>')  # 身体组结束

    # 近侧腿
    s.append(leg_svg(P["hipN"], P["fnx"], 788 - P["fnlift"], P["fnlift"], 12, "#f59e0b", "#b45309"))

    # ---- 头颈组（点头 + 鸟喙俯仰） ----
    if anim:
        head_v = ";".join(f"{2.4 * math.sin(TAU * k / K + 1.1):.2f} 470 545" for k in range(K + 1))
        bill_v = ";".join(f"{2.2 * math.sin(TAU * k / K + 2.1):.2f} 398 374" for k in range(K + 1))
        head_a = f'<animateTransform attributeName="transform" type="rotate" values="{head_v}" dur="1.2s" repeatCount="indefinite"/>'
        bill_a = f'<animateTransform attributeName="transform" type="rotate" values="{bill_v}" dur="1.2s" repeatCount="indefinite"/>'
    else:
        head_a = f'transform="rotate({P["headTilt"]:.2f} 470 545)"'
        bill_a = f'transform="rotate({P["billTilt"]:.2f} 398 374)"'
    if anim:
        s.append(f'<g>{head_a}')
    else:
        s.append(f'<g {head_a}>')
    s.append('<path d="M 470,545 C 446,505 442,452 408,398" fill="none" stroke="#94a3b8" stroke-width="46" stroke-linecap="round"/>')
    s.append('<path d="M 470,545 C 446,505 442,452 408,398" fill="none" stroke="#f8fafc" stroke-width="37" stroke-linecap="round"/>')
    s.append('<path d="M 462,520 C 446,492 442,458 424,428" fill="none" stroke="#dbe3ec" stroke-width="4" stroke-linecap="round" opacity="0.8"/>')
    s.append('<circle cx="398" cy="374" r="41" fill="#f8fafc" stroke="#94a3b8" stroke-width="3"/>')
    s.append('<g stroke="#94a3b8" stroke-width="3" stroke-linecap="round" fill="none"><path d="M 404,334 q 6,-12 14,-16"/><path d="M 416,340 q 10,-9 18,-10"/></g>')
    s.append('<circle cx="382" cy="362" r="8" fill="#ffffff" stroke="#64748b" stroke-width="1.5"/><circle cx="384" cy="364" r="4.5" fill="#1e293b"/><circle cx="382" cy="361" r="1.6" fill="#ffffff"/>')
    s.append('<path d="M 371,353 q 11,-6 21,-2" fill="none" stroke="#475569" stroke-width="3.5" stroke-linecap="round"/>')
    if level >= 2:
        s.append('<path d="M 428,316 q 6,-10 12,-2 q -8,4 -12,2 Z" fill="#7dd3fc" stroke="#38bdf8" stroke-width="1.2" opacity="0.9"/>'
                 + ('<animate attributeName="opacity" values="0.2;0.95;0.2" dur="1.2s" repeatCount="indefinite"/>' if anim else ''))
    if anim:
        s.append(f'<g>{bill_a}')
    else:
        s.append(f'<g {bill_a}>')
    s.append('<path d="M 366,360 C 300,366 222,380 174,394 L 176,404 C 226,396 306,388 368,386 Z" fill="#f59e0b" stroke="#b45309" stroke-width="2"/>')
    s.append('<path d="M 174,394 q -6,2 -4,9 q 6,1 8,-4" fill="#d97706" stroke="#b45309" stroke-width="1.5"/>')
    s.append('<line x1="350" y1="368" x2="352" y2="384" stroke="#b45309" stroke-width="1.5" opacity="0.7"/>')
    s.append('<path d="M 358,390 C 336,452 268,472 216,442 C 196,430 186,414 180,401 C 232,414 300,410 360,393 Z" fill="#fbbf24" stroke="#b45309" stroke-width="2.5"/>')
    s.append('<path d="M 320,428 C 292,446 252,450 224,438" fill="none" stroke="#d97706" stroke-width="2" opacity="0.6"/>')
    s.append('<path d="M 232,430 l 26,-12 -8,16 12,10 -30,-4 Z" fill="#60a5fa" stroke="#2563eb" stroke-width="1.5"/>')
    s.append('</g></g>')

    # ---- 自行车组（随身体起伏 + 踏频） ----
    if anim:
        bb_v = ";".join(f"0,{2 - 4 * abs(math.sin(TAU * k / K)) * 0.85:.1f}" for k in range(K + 1))
        bp_v = ";".join(f"{1.2 * math.sin(TAU * k / K + 0.6) * 0.5:.2f} 600 470" for k in range(K + 1))
        bike_t = (f'<animateTransform attributeName="transform" type="translate" values="{bb_v}" dur="1.2s" repeatCount="indefinite"/>')
        bike_r = (f'<animateTransform attributeName="transform" type="rotate" values="{bp_v}" dur="1.2s" repeatCount="indefinite"/>')
        crank_a = ('<animateTransform attributeName="transform" type="rotate" from="0 582 474" to="360 582 474" dur="1.2s" repeatCount="indefinite"/>')
        ped1 = ('<g transform="translate(582,474)"><rect x="-10" y="-3" width="20" height="6" rx="3" fill="#1e293b"/>'
                '<animateMotion path="M 0,-28 a 28,28 0 1 1 -0.01,0" dur="1.2s" repeatCount="indefinite"/></g>')
        ped2 = ('<g transform="translate(582,474)"><rect x="-11" y="-3.5" width="22" height="7" rx="3.5" fill="#ef4444" stroke="#b91c1c" stroke-width="1.2"/>'
                '<animateMotion path="M 0,28 a 28,28 0 1 0 0.01,0" dur="1.2s" repeatCount="indefinite"/></g>')
        flag_a = ('<animateTransform attributeName="transform" type="rotate" values="'
                  + ";".join(f"{8 * math.sin(TAU * k / K + 0.8):.1f} 662 442" for k in range(K + 1))
                  + '" dur="1.2s" repeatCount="indefinite"/>')
        rein_v = []
        for k in range(K + 1):
            q = pose(k / K)
            rp, _ = rein_path(q)
            rein_v.append(rp)
        rein_a = (f'<animate attributeName="d" values="{";".join(rein_v)}" dur="1.2s" repeatCount="indefinite"/>')
    else:
        bike_t = f'transform="translate(0,{P["bikeBob"]:.1f})"'
        bike_r = f'transform="rotate({P["bikePitch"]:.2f} 600 470)"'
        crank_a = ""
        ped1 = ""
        ped2 = ""
        sx, cy_ = math.sin(math.radians(P["crank"])), math.cos(math.radians(P["crank"]))
        p1 = (582 + 28 * sx, 474 - 28 * cy_); p2 = (582 - 28 * sx, 474 + 28 * cy_)
        ped1 = (f'<line x1="{p1[0]:.1f}" y1="{p1[1]:.1f}" x2="{p2[0]:.1f}" y2="{p2[1]:.1f}" stroke="#475569" stroke-width="5" stroke-linecap="round"/>'
                f'<rect x="{p1[0]-10:.1f}" y="{p1[1]-3:.1f}" width="20" height="6" rx="3" fill="#1e293b"/>'
                f'<rect x="{p2[0]-11:.1f}" y="{p2[1]-3.5:.1f}" width="22" height="7" rx="3.5" fill="#ef4444" stroke="#b91c1c" stroke-width="1.2"/>')
        flag_a = f'transform="rotate({P["flag"]:.1f} 662 442)"'
        rp, _ = rein_path(P)
        rein_a = ""
    if anim:
        s.append(f'<g>{bike_t}<g>{bike_r}')
    else:
        s.append(f'<g {bike_t}><g {bike_r}>')
    s.append('<circle cx="655" cy="470" r="38" fill="#f1f5f9" stroke="#334155" stroke-width="6"/><circle cx="655" cy="470" r="29" fill="none" stroke="#94a3b8" stroke-width="2.5"/>'
             '<g stroke="#b6c2d4" stroke-width="1.6"><line x1="655" y1="441" x2="655" y2="499"/><line x1="626" y1="470" x2="684" y2="470"/>'
             '<line x1="634" y1="449" x2="676" y2="491"/><line x1="676" y1="449" x2="634" y2="491"/></g><circle cx="655" cy="470" r="5" fill="#475569"/>')
    if level >= 2:
        s.append('<circle cx="655" cy="470" r="38" fill="none" stroke="#0f172a" stroke-width="2" stroke-dasharray="3 7" opacity="0.55"/>')
    s.append('<ellipse cx="655" cy="509" rx="30" ry="5" fill="#3f2d16" opacity="0.2"/>')
    frame_stroke = "url(#frame)" if level >= 2 else "#ef4444"
    s.append(f'''<g stroke="{frame_stroke}" stroke-width="9" stroke-linecap="round" fill="none">
<line x1="655" y1="470" x2="582" y2="474"/><line x1="582" y1="474" x2="612" y2="432"/><line x1="655" y1="470" x2="612" y2="432"/>
<line x1="612" y1="432" x2="532" y2="392"/><line x1="582" y1="474" x2="528" y2="402"/></g>''')
    s.append('<path d="M 598,424 q 18,-8 36,0 l -4,10 q -14,4 -28,0 Z" fill="#1e293b" stroke="#0f172a" stroke-width="1.5"/>')
    s.append('<circle cx="505" cy="385" r="37" fill="#f1f5f9" stroke="#334155" stroke-width="6"/><circle cx="505" cy="385" r="28" fill="none" stroke="#94a3b8" stroke-width="2.5"/>'
             '<g stroke="#b6c2d4" stroke-width="1.6"><line x1="505" y1="357" x2="505" y2="413"/><line x1="477" y1="385" x2="533" y2="385"/>'
             '<line x1="485" y1="365" x2="525" y2="405"/><line x1="525" y1="365" x2="485" y2="405"/></g><circle cx="505" cy="385" r="5" fill="#475569"/>')
    if level >= 2:
        s.append('<circle cx="505" cy="385" r="37" fill="none" stroke="#0f172a" stroke-width="2" stroke-dasharray="3 7" opacity="0.55"/>')
    s.append('<line x1="529" y1="402" x2="505" y2="385" stroke="#ef4444" stroke-width="9" stroke-linecap="round"/>')
    s.append('<line x1="530" y1="390" x2="534" y2="356" stroke="#ef4444" stroke-width="8" stroke-linecap="round"/>')
    s.append('<path d="M 534,352 q -20,-12 -32,0" fill="none" stroke="#334155" stroke-width="7" stroke-linecap="round"/><circle cx="502" cy="352" r="5" fill="#1e293b"/>')
    s.append('<circle cx="545" cy="344" r="7" fill="#f6c445" stroke="#b8860b" stroke-width="1.5"/><line x1="545" y1="337" x2="545" y2="332" stroke="#b8860b" stroke-width="2"/>')
    s.append('<path d="M 512,338 a 22,22 0 0 1 44,0 l 0,4 -44,0 Z" fill="#ef4444" stroke="#b91c1c" stroke-width="2"/>'
             '<path d="M 534,316 a 22,22 0 0 1 22,22" fill="none" stroke="#fecaca" stroke-width="4" stroke-linecap="round"/>'
             '<rect x="510" y="340" width="48" height="5" rx="2.5" fill="#b91c1c"/><path d="M 512,342 l -12,6 14,2 Z" fill="#b91c1c"/>')
    s.append('<line x1="662" y1="442" x2="700" y2="366" stroke="#64748b" stroke-width="3" stroke-linecap="round"/>')
    if anim:
        s.append(f'<g>{flag_a}<path d="M 700,366 l 38,10 -38,14 Z" fill="#f6c445" stroke="#d9a406" stroke-width="1.5"/></g>')
    else:
        s.append(f'<g {flag_a}><path d="M 700,366 l 38,10 -38,14 Z" fill="#f6c445" stroke="#d9a406" stroke-width="1.5"/></g>')
    if level >= 1:
        s.append('<circle cx="522" cy="402" r="6" fill="#fde68a" stroke="#d97706" stroke-width="2"/>')
        s.append('<g transform="rotate(-45 556 442)"><rect x="548" y="428" width="14" height="26" rx="6" fill="#38bdf8" stroke="#0369a1" stroke-width="1.5"/>'
                 '<rect x="550" y="424" width="10" height="6" rx="2" fill="#0369a1"/></g>')
        s.append('<path d="M 516,350 C 552,412 578,430 604,438" fill="none" stroke="#64748b" stroke-width="1.8" opacity="0.85"/>')
        s.append('<g transform="rotate(-8 704 520)"><rect x="688" y="512" width="34" height="22" rx="6" fill="#a16207" stroke="#713f12" stroke-width="2"/>'
                 '<path d="M 692,512 q 13,-10 26,0" fill="none" stroke="#713f12" stroke-width="2"/></g>')
    s.append('<circle cx="582" cy="474" r="14" fill="none" stroke="#475569" stroke-width="4"/><circle cx="582" cy="474" r="5" fill="#475569"/>')
    if anim:
        s.append(f'<g>{crank_a}<line x1="582" y1="446" x2="582" y2="502" stroke="#475569" stroke-width="5" stroke-linecap="round"/></g>')
        s.append(ped1 + ped2)
    else:
        s.append(ped1)
    s.append('</g></g>')  # 自行车组结束

    # 缰绳（世界坐标，随头/车动）
    if anim:
        s.append(f'<path d="{rein_v[0]}" fill="none" stroke="#92400e" stroke-width="3" stroke-linecap="round" opacity="0.95">{rein_a}</path>')
    else:
        s.append(f'<path d="{rp}" fill="none" stroke="#92400e" stroke-width="3" stroke-linecap="round" opacity="0.95"/>')
    s.append('<line x1="346" y1="374" x2="350" y2="396" stroke="#92400e" stroke-width="4" stroke-linecap="round"/>'
             '<circle cx="348" cy="386" r="4" fill="#f6c445" stroke="#92400e" stroke-width="1.5"/>')
    if level >= 2:
        huff = ('<animate attributeName="opacity" values="0;.55;0" dur="1.2s" repeatCount="indefinite"/>' if anim else ' opacity="0.35"')
        s.append(f'<g fill="#dbeafe" stroke="#93c5fd" stroke-width="1.2">{huff}<circle cx="160" cy="396" r="5"/><circle cx="146" cy="402" r="3.5"/></g>')

    # 尘土（循环飘散）
    if anim:
        for i in range(3):
            s.append(f'<circle cx="792" cy="784" r="10" fill="#e8d9ae">'
                     f'<animate attributeName="cx" values="786;842" dur="0.6s" begin="{i*0.2:.1f}s" repeatCount="indefinite"/>'
                     f'<animate attributeName="cy" values="786;772" dur="0.6s" begin="{i*0.2:.1f}s" repeatCount="indefinite"/>'
                     f'<animate attributeName="opacity" values="0.75;0" dur="0.6s" begin="{i*0.2:.1f}s" repeatCount="indefinite"/></circle>')
    else:
        pp = (2 * t) % 1.0
        for i in range(3):
            ph = (pp + i / 3) % 1.0
            s.append(f'<circle cx="{790+34*ph:.0f}" cy="{784-10*ph:.0f}" r="{5+8*ph:.1f}" fill="#e8d9ae" opacity="{0.7*(1-ph):.2f}"/>')
    s.append('<g stroke="#94a3b8" stroke-width="3" stroke-linecap="round" opacity="0.45">'
             '<line x1="856" y1="560" x2="926" y2="552"/><line x1="868" y1="596" x2="948" y2="590"/><line x1="856" y1="632" x2="922" y2="628"/></g>')

    # 标题与边框
    s.append('<text x="66" y="76" font-family="Microsoft YaHei, PingFang SC, sans-serif" font-size="36" font-weight="bold" fill="#0f2d4d">《自行车骑鹈鹕》</text>')
    s.append('<text x="68" y="112" font-family="Microsoft YaHei, PingFang SC, sans-serif" font-size="17" fill="#46648a">自行车是骑手，鹈鹕是坐骑 —— 缰绳已握，头盔已戴，链条已扣紧</text>')
    s.append('<rect x="10" y="10" width="1260" height="940" rx="18" fill="none" stroke="#0f2d4d" stroke-width="4" opacity="0.55"/>')
    s.append('<rect x="20" y="20" width="1240" height="920" rx="12" fill="none" stroke="#c9a227" stroke-width="1.6" opacity="0.7"/>')
    s.append('</svg>')
    return "\n".join(s)

if __name__ == "__main__":
    out = {}
    out["bike-rides-pelican-v2.svg"] = build(0.22, level=1, anim=False)   # 第一轮迭代
    out["bike-rides-pelican-v3.svg"] = build(0.30, level=2, anim=False)   # 第二轮迭代（最终静态）
    out["bike-rides-pelican-animated.svg"] = build(0, level=2, anim=True) # SMIL 自循环动图
    os.makedirs(os.path.join(ROOT, "frames"), exist_ok=True)
    for i in range(24):                                                    # GIF 逐帧
        out[f"frames/f{i:02d}.svg"] = build(i / 24, level=2, anim=False)
    for name, content in out.items():
        p = os.path.join(ROOT, name)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as f:
            f.write(content)
    import xml.etree.ElementTree as ET
    for name in out:
        ET.parse(os.path.join(ROOT, name))
    print(f"written {len(out)} files, all XML valid")
