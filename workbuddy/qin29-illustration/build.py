# -*- coding: utf-8 -*-
"""QIN-29 插画：主场景组装。

================================ 全部题目答案 ================================
糖果六类数量：圆苹果7 圆桃子9 圆西瓜8 / 星苹果7 星桃子6 星西瓜4  → 总和 41
最坏情况（取 28 颗仍不满足）：圆苹果7 圆桃子9 圆西瓜8 星苹果0 星桃子0 星西瓜4
  证 29 必成：若圆苹果、圆桃子均已出现，则星苹果7+星桃子6=13 至少取到 1 → 成立；
  否则圆苹果缺 → 7 颗全在圆西瓜/星类；圆桃子缺 → 9 颗全在星/圆西瓜，
  此时 7+9=16 必落在圆西瓜+星类共 19 颗中，取 29-16=13 颗 > 星类 11 颗 → 必取到圆西瓜或…
  —— 由穷举 4 类规避组合的最大值 = 28（7+9+8+4）得 N=29。
球拍球价     ：0.05 元      （A = 0.05×100 = 5）
机器题       ：5 分钟       （B = 5）
浮萍题       ：47 天        （C = 47）  → 密码锁 A+B+C = 57
9.11 ＜ 9.9 （实数比较）
strawberry 中字母 r 的个数 R = 3  → 温室 3 扇窗、车铃写 3
时钟 3:15，两针较小夹角 7.5°
跑步超第二名 → 第 2 名     → 熊鞍两侧共挂 P=2 盏灯
兄弟姐妹     ：4 个孩子     → 项圈背面标签 4
三门换门策略 ：2/3
生日悖论     ：23 人
汉诺塔 7 层  ：127 步
蜗牛         ：8 天
猫           ：5 只
先+20% 再-20%：96%
塞瓦洛维奇   ：不必然成立
元音背面检验 ：只翻 A（唯一元音）
核验条       ：41 / 2 / 8 / 4
============================================================================
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from svgkit import S, defs, f, FONT          # noqa: E402
import parts as P                             # noqa: E402

W, H = 3000, 2400
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "qin-29-illustration.svg")

# ---------------- 答案常量（唯一数据源） ----------------
N_CANDY = 29
CANDY = [("圆苹果", 7), ("圆桃子", 9), ("圆西瓜", 8), ("星苹果", 7), ("星桃子", 6), ("星西瓜", 4)]
CANDY_SUM = sum(v for _, v in CANDY)              # 41
WORST = [7, 9, 8, 0, 0, 4]                       # N-1 = 28
BALL_PRICE = "0.05"
A_CODE, B_CODE, C_CODE = 5, 5, 47
LOCK = A_CODE + B_CODE + C_CODE                  # 57
R_LETTER = 3
CLOCK_DEG = "7.5"
RACE_RANK = 2
SIBLINGS = 4
CANDY_6SUM = 41
EMPTY_HOLES = 2
ARMS = 8
ENGINES = 4

# ---------------- 承托链关键坐标（x=CHAIN 竖直贯通） ----------------
CHAIN = 620
BAR_INFO = {}
WING_SURF = 1930          # 机翼上表面：两轮触地点
BIKE_CY = WING_SURF - 40  # 轮心
PEL_CY = 1690             # 鹈鹕身体中心（坐在车座上）
WING_Y = 1706             # 鹈鹕展开双翼的承托面
BEAR_CY = 1570            # 熊身中心（后足/前足落在 WING_Y）
BEAR_FOOT_Y = 1706
QIN_SEAT = 1290           # 秦臀部（熊背）
QIN_HEAD = (CHAIN + 96, QIN_SEAT - 176)
CROWN_Y = 1080
TURTLE_CY = 1006
ELE_CY = 900
GH_TOP, GH_BOT = 520, 818
TREE_C = (556, 686)
HG_C = (742, 712)
OCT_C = (742, 566)
CUP_CY = 440
LIGH_C = (742, 416)
BALL_C = (742, 258)
BALL_R = 96

INK = "#1b2a38"


def rrect(s, x, y, w, h, r=10, fill="#fdfdf6", stroke=INK, sw=1.6, op=0.95):
    s.rect(x, y, w, h, fill, stroke, sw, rx=r, op=op)


def title_plate(s, x, y, w, t, h=28, fill="#1f3b57"):
    s.rect(x, y, w, h, fill, INK, 1.4, rx=6)
    s.text(x + w / 2, y + h - 9, t, 16, "#f4f8fb", "middle", "700")


# =====================================================================
def main():
    s = S(W, H)
    defs(s, "")

    # ---------------- 天空 ----------------
    s.add('<rect width="%d" height="%d" fill="url(#sky)"/>' % (W, H))
    s.add('<circle cx="520" cy="300" r="520" fill="url(#sun)"/>')
    s.add('<circle cx="520" cy="300" r="86" fill="#fff8e2" opacity="0.85"/>')
    for cx, cy, cw, ch, op in ((1500, 190, 620, 200, 0.5), (2350, 620, 700, 210, 0.42),
                               (1900, 1180, 760, 200, 0.36), (250, 900, 520, 170, 0.3),
                               (1000, 1960, 900, 180, 0.34), (2850, 1500, 600, 180, 0.3),
                               (120, 1780, 460, 160, 0.3)):
        s.cloud(cx, cy, cw, ch, "#ffffff", op)

    draw_plane(s)
    draw_pelican_rig(s)     # 先画鹈鹕与自行车（承托层）
    draw_stack(s)           # 再画熊/秦等（压在鹈鹕双翼之上）
    draw_cockpit(s)
    draw_fuselage_items(s)
    draw_lower_panels(s)
    draw_balloon_hanoi(s)
    draw_pond_cloud(s)
    draw_penguins(s)
    draw_wake(s)
    draw_candy_rig(s)
    draw_border_stamps(s)
    draw_verify_bar(s)
    draw_title(s)

    s.save(OUT)
    print("written:", OUT, "elements:", len(s.b))


# =====================================================================
# 飞机主体
# =====================================================================
def draw_plane(s):
    """机身、机翼、尾翼、四台发动机。机身中心线 y=1560，翼根在机身下缘。"""
    FY0, FY1 = 1490, 1636          # 机身上下缘
    # ---- 远侧机翼（画面右上，透视缩短） ----
    s.poly([(1800, 1470), (2560, 1060), (2620, 1112), (1900, 1540)],
           "#cfdae5", "#7b8b9c", 2)
    s.poly([(1800, 1470), (2560, 1060), (2576, 1074), (1812, 1488)], "#e8eff6", None, 0)
    # ---- 机身 ----
    s.path("M 1050 1560 C 1058 1500 1114 1476 1200 1472 L 2420 1452 "
           "C 2510 1450 2570 1476 2596 1512 C 2600 1530 2586 1548 2550 1558 "
           "L 1220 1690 C 1120 1700 1058 1636 1050 1560 Z",
           "url(#hull)", "#6b7a8a", 2.4)
    # 机身条纹
    s.path("M 1060 1570 C 1072 1524 1122 1502 1204 1500 L 2450 1480 "
           "C 2510 1479 2548 1494 2566 1512 L 2556 1526 C 2536 1510 2504 1498 2450 1498 "
           "L 1206 1518 C 1130 1520 1086 1540 1076 1578 Z", "#2f6fb0", None, 0)
    s.path("M 1068 1582 C 1080 1544 1126 1526 1200 1524 L 2460 1504 "
           "L 2458 1514 L 1200 1534 C 1132 1536 1092 1552 1082 1588 Z", "#e0a92e", None, 0)
    # 舷窗 + 货舱门
    for i in range(27):
        s.circ(1250 + i * 44, 1500 - i * 0.8, 6.2, "#cfe0ee", "#5b6b7d", 1.2)
    s.rect(1180, 1560, 88, 94, "#e8eef4", "#7b8b9c", 1.6, rx=6)
    # ---- 尾翼 ----
    s.poly([(2240, 1470), (2372, 1000), (2480, 992), (2520, 1460)], "#eef3f8", "#7b8b9c", 2.2)
    s.poly([(2286, 1446), (2388, 1044), (2440, 1040), (2472, 1442)], "#2f6fb0", None, 0)
    s.poly([(2400, 1520), (2570, 1390), (2480, 1420), (2460, 1540)], "#e4ecf3", "#7b8b9c", 1.8)
    s.poly([(2420, 1560), (2580, 1510), (2468, 1538), (2460, 1582)], "#d3dee8", "#7b8b9c", 1.6)
    # ---- 航班编号 QIN-29（机尾） ----
    s.rect(2296, 1098, 176, 74, "#fdfdf6", "#1b2a38", 2.4, rx=8, op=0.96)
    s.text(2384, 1148, "QIN-%d" % N_CANDY, 42, "#16202c", "middle", "800")
    s.text(2384, 1194, "航班编号", 15, "#5b6b7d", "middle", "400")

    # ---- 近侧机翼（画面左下，承托整条链） ----
    # 顶边在 x∈[400,790] 段水平且恰为 WING_SURF，两轮底 (520/720, WING_SURF) 真实相切。
    s.poly([(1560, 1660), (790, WING_SURF), (400, WING_SURF),
            (520, 2130), (1200, 2150), (1880, 1780)], "#dde6ee", "#7b8b9c", 2.4)
    s.poly([(1560, 1660), (790, WING_SURF), (400, WING_SURF),
            (404, WING_SURF + 18), (794, WING_SURF + 18), (1566, 1682)], "#f4f8fb", None, 0)
    s.path("M 1560 1660 L 790 %d L 400 %d" % (WING_SURF, WING_SURF), "none", "#9fb0c0", 3.4)
    # 翼面网格线（提示是实体翼面而非云）
    for i in range(1, 9):
        t = i / 9.0
        s.line(1560 - t * 1160, 1660 + t * 270, 1880 - t * 1360, 1780 + t * 370,
               "#a9b6c4", 1.2, op=0.5)

    # ---- 四台发动机：远翼 2 台 + 近翼 2 台，可分别数清 ----
    P.engine(s, 1960, 1330, 98, 44, -24, "3")
    P.engine(s, 2230, 1180, 90, 40, -24, "4")
    P.engine(s, 1230, 1700, 106, 48, 8, "1")
    P.engine(s, 990, 1800, 98, 44, 8, "2")
    s.text(1996, 1244, "发动机 3", 15, "#33424f", "middle", "800")
    s.text(2268, 1098, "发动机 4", 15, "#33424f", "middle", "800")
    s.text(1266, 1616, "发动机 1", 15, "#33424f", "middle", "800")
    s.text(1026, 1718, "发动机 2", 15, "#33424f", "middle", "800")


# =====================================================================
# 驾驶舱：孙悟空 + 金箍棒 + 两个支架
# =====================================================================
def draw_cockpit(s):
    """驾驶舱剖视：孙悟空（猴脸+金箍+握盘）、金箍棒横放两支架、3:15 时钟。
    放在机身左前方独立放大区，避免被其他面板遮挡。"""
    X0, Y0, X1, Y1 = 1010, 1010, 1720, 1290
    s.rect(X0 - 16, Y0 - 46, (X1 - X0) + 32, (Y1 - Y0) + 62, "#eaf4fa", "#1b3a55", 3, rx=14, op=0.97)
    s.rect(X0 - 16, Y0 - 46, (X1 - X0) + 32, 34, "#1f3b57", "#1b3a55", 2, rx=14)
    s.text((X0 + X1) / 2, Y0 - 22, "驾驶舱剖视 · 金箍棒横放于两个支架（不穿孙悟空／座椅／挡风玻璃）",
           15, "#f4f8fb", "middle", "800")
    # ---- 挡风玻璃（最左） ----
    s.poly([(X0, Y1 - 40), (X0, Y0 + 30), (X0 + 66, Y0 + 30), (X0 + 66, Y1 - 40)],
           "#cfe6f2", "#5b8fa3", 2.2)
    s.line(X0 + 33, Y0 + 30, X0 + 33, Y1 - 40, "#5b8fa3", 1.6)
    s.text(X0 + 33, Y0 + 20, "挡风玻璃", 12, "#33424f", "middle", "700")
    # ---- 座椅 ----
    s.rect(X0 + 96, Y1 - 118, 86, 76, "#8a5a3a", "#5b3a22", 2, rx=9)
    s.rect(X0 + 103, Y1 - 110, 72, 30, "#a06a44", None, 0, rx=6)
    s.text(X0 + 139, Y1 - 132, "座椅", 13, "#33424f", "middle", "700")
    # ---- 地板横梁（支架基座） ----
    s.rect(X0 + 200, Y1 - 54, 200, 9, "#7b8b9c", "#4a5a6a", 1.2, rx=3)
    # ---- 两个支架 ----
    for bx in (X0 + 244, X0 + 380):
        s.path("M %s %s L %s %s L %s %s L %s %s L %s %s L %s %s Z"
               % (f(bx - 8), f(Y1 - 54), f(bx - 8), f(Y1 - 108), f(bx + 8), f(Y1 - 108),
                  f(bx + 8), f(Y1 - 96), f(bx - 8), f(Y1 - 96), f(bx - 8), f(Y1 - 54)),
               "#8a9aab", "#4a5a6a", 1.4)
        s.rect(bx - 14, f(Y1 - 118), 28, 11, "#a9b6c4", "#4a5a6a", 1.2, rx=3)
        s.text(bx, Y1 - 126, "支架", 12, "#33424f", "middle", "700")
    # ---- 金箍棒（横放于两支架托座上） ----
    s.rect(X0 + 204, Y1 - 128, 216, 17, "#e8c33c", "#8a6a1a", 2, rx=8)
    s.rect(X0 + 204, Y1 - 128, 30, 17, "#b9861a", None, 0, rx=8)
    s.rect(X0 + 390, Y1 - 128, 30, 17, "#b9861a", None, 0, rx=8)
    for i in range(7):
        s.circ(X0 + 226 + i * 30, Y1 - 120, 3.2, "#a8791a")
    s.text(X0 + 312, Y1 - 138, "金箍棒", 14, "#7a5a12", "middle", "800")
    # ---- 3:15 时钟（驾驶舱内） ----
    ccx, ccy, cr = X0 + 520, Y0 + 128, 46
    s.circ(ccx, ccy, cr + 8, "#fdfdf6", INK, 2.6)
    s.circ(ccx, ccy, cr, "#fbfaf6", "#5b6b7d", 1.6)
    for i in range(12):
        a = math.radians(i * 30)
        r1 = cr - (10 if i % 3 == 0 else 5)
        s.line(ccx + r1 * math.sin(a), ccy - r1 * math.cos(a),
               ccx + (cr - 1) * math.sin(a), ccy - (cr - 1) * math.cos(a), INK, 2.4 if i % 3 == 0 else 1.2)
    s.text(ccx, ccy - cr - 18, "驾驶舱时钟", 13, "#33424f", "middle", "700")
    s.line(ccx, ccy, ccx + cr * 0.52 * math.sin(math.radians(97.5)),
           ccy - cr * 0.52 * math.cos(math.radians(97.5)), INK, 5)
    s.line(ccx, ccy, ccx + cr * 0.80 * math.sin(math.radians(90)),
           ccy - cr * 0.80 * math.cos(math.radians(90)), INK, 3.4)
    s.circ(ccx, ccy, 4, INK)
    s.text(ccx, ccy + cr + 30, "3:15（时针不恰好指向 3）", 13, INK, "middle", "700")
    s.text(ccx, ccy + cr + 56, "两针较小夹角 %s°" % CLOCK_DEG, 15, "#c0392b", "middle", "800")

    # ---- 孙悟空 ----
    hx, hy = X0 + 250, Y0 + 118
    s.path("M %s %s C %s %s %s %s %s %s C %s %s %s %s %s %s Z"
           % (f(hx - 46), f(hy + 128), f(hx - 40), f(hy + 66), f(hx - 24), f(hy + 48),
              f(hx), f(hy + 42), f(hx + 24), f(hy + 48), f(hx + 40), f(hy + 66),
              f(hx + 46), f(hy + 128)), "#3b4a5c", "#22303e", 2)
    # 双臂握驾驶盘
    s.path("M %s %s Q %s %s %s %s" % (f(hx - 26), f(hy + 76), f(hx - 56), f(hy + 96),
            f(hx - 62), f(hy + 86)), "none", "#3b4a5c", 13)
    s.path("M %s %s Q %s %s %s %s" % (f(hx + 26), f(hy + 76), f(hx + 56), f(hy + 96),
            f(hx + 62), f(hy + 86)), "none", "#3b4a5c", 13)
    s.circ(hx - 62, hy + 86, 10, "#e8c9a0", "#8a6a4a", 1.6)
    s.circ(hx + 62, hy + 86, 10, "#e8c9a0", "#8a6a4a", 1.6)
    s.rect(hx - 74, hy + 74, 148, 24, "#5b6b7d", "#2b3a4a", 1.8, rx=11)
    s.circ(hx, hy + 72, 16, "none", "#2b3a4a", 3.4)
    s.line(hx, hy + 72, hx, hy + 60, "#2b3a4a", 3.4)
    # 猴脸
    s.circ(hx, hy, 42, "#f0d3ab", "#8a6a4a", 2.2)
    s.path("M %s %s C %s %s %s %s %s %s C %s %s %s %s %s %s Z"
           % (f(hx - 38), f(hy - 8), f(hx - 38), f(hy - 38), f(hx + 38), f(hy - 38), f(hx + 38), f(hy - 8),
              f(hx + 38), f(hy + 15), f(hx - 38), f(hy + 15), f(hx - 38), f(hy - 8)),
           "#f7e2c4", None, 0)
    s.ell(hx, hy + 19, 25, 19, "#f7e2c4", "#c9a97e", 1.4)
    s.circ(hx - 8, hy + 15, 3.2, "#8a5a3a")
    s.circ(hx + 8, hy + 15, 3.2, "#8a5a3a")
    s.path("M %s %s q 9 10 18 0" % (f(hx - 9), f(hy + 23)), "none", "#8a5a3a", 2)
    s.circ(hx - 18, hy - 6, 6, "#ffffff", "#8a6a4a", 1.4)
    s.circ(hx + 18, hy - 6, 6, "#ffffff", "#8a6a4a", 1.4)
    s.circ(hx - 17, hy - 5, 3, "#1b2a38")
    s.circ(hx + 17, hy - 5, 3, "#1b2a38")
    s.circ(hx - 42, hy + 2, 11, "#f0d3ab", "#8a6a4a", 1.8)
    s.circ(hx + 42, hy + 2, 11, "#f0d3ab", "#8a6a4a", 1.8)
    s.circ(hx - 42, hy + 2, 5.5, "#d8ab7c")
    s.circ(hx + 42, hy + 2, 5.5, "#d8ab7c")
    # 金箍
    s.rect(hx - 44, hy - 40, 88, 22, "#e8c33c", "#8a6a1a", 2.2, rx=5)
    s.circ(hx, hy - 29, 10, "#f0d060", "#8a6a1a", 1.8)
    for i in range(6):
        s.circ(hx - 30 + i * 12, hy - 29, 2.6, "#a8791a")
    s.text(hx, hy - 62, "孙悟空", 18, "#16202c", "middle", "800")
    # 工牌（第 2 名）
    s.rect(hx - 42, hy + 92, 84, 32, "#fdfdf6", INK, 1.8, rx=5)
    s.text(hx, hy + 107, "工牌", 12, "#5b6b7d", "middle", "700")
    s.text(hx, hy + 122, "第%d名" % RACE_RANK, 15, "#16202c", "middle", "800")
    # 右袖「悟」（人物自身右侧 = 画面左侧）
    s.path("M %s %s L %s %s L %s %s L %s %s Z"
           % (f(hx - 42), f(hy + 82), f(hx - 64), f(hy + 100), f(hx - 52), f(hy + 100),
              f(hx - 40), f(hy + 88)), "#3b4a5c", "#22303e", 1.4)
    s.text(hx - 54, hy + 100, "悟", 17, "#e8c33c", "middle", "800")
    s.text(hx - 54, hy + 124, "右袖", 11, "#e8c33c", "middle", "700")


# =====================================================================
# 竖直承托链：熊 → 秦 → 冕板 → 龟 → 象 → 温室 → 树 → 沙漏 → 章鱼 → 杯 → 灯塔 → 玻璃球
# =====================================================================
def draw_stack(s):
    C = CHAIN
    draw_plate_and_lock(s)
    draw_bear(s)
    draw_qin(s)
    P.turtle(s, C + 96, TURTLE_CY, 112)
    s.text(C + 200, TURTLE_CY - 6, "龟", 16, "#2f5a24", "middle", "800")
    P.elephant(s, C + 96, ELE_CY, 168)
    s.text(C + 228, ELE_CY - 4, "微型象", 15, "#5b6470", "middle", "800")
    draw_greenhouse(s)


def draw_plate_and_lock(s):
    """鞍架 + 6 孔金属板（3 拧紧 / 1 拧入中 / 2 空孔）+ 密码锁 + 两盏灯。
    这些都放在熊背上方、秦身之前的独立小台上，避免被秦的躯干遮挡。"""
    C = CHAIN
    px, py, pw, ph = C - 96, 1150, 192, 112      # 金属板
    # ---- 鞍架（架在熊背上） ----
    s.rect(C - 110, 1262, 220, 20, "#8a9aab", "#4a5a6a", 1.8, rx=6)
    s.rect(C - 124, 1278, 248, 14, "#6b7a8a", "#4a5a6a", 1.6, rx=5)
    # 竖撑：明确落到熊背
    s.line(C - 84, 1262, C - 84, 1300, "#6b7a8a", 5)
    s.line(C + 84, 1262, C + 84, 1300, "#6b7a8a", 5)
    s.text(C, 1318, "鞍架（架于熊背）", 13, "#16202c", "middle", "800")
    # ---- 金属板 ----
    s.rect(px, py, pw, ph, "#c9d4de", "#5b6b7d", 2.4, rx=7)
    s.rect(px + 8, py + 8, pw - 16, ph - 16, "#dbe4ec", None, 0, rx=5)
    holes = [(C - 52, py + 34), (C, py + 34), (C + 52, py + 34),
             (C - 52, py + 80), (C, py + 80), (C + 52, py + 80)]
    for h in holes:
        P.empty_hole(s, h[0], h[1], 11)
    for h in holes[:3] + [holes[3]]:
        P.screw(s, h[0], h[1], 11)
    s.text(C, py - 12, "金属板 · 6 孔", 14, "#16202c", "middle", "800")
    s.line(C + 52, py + 20, C + 52, py + 2, "#c0392b", 1.6)
    s.text(C + 104, py + 6, "拧入中", 12, "#c0392b", "middle", "800")
    s.text(C - 62, py + 110, "3 已拧紧", 12, "#1b7a4a", "middle", "800")
    s.text(C + 62, py + 110, "2 空孔", 12, "#c0392b", "middle", "800")
    # ---- 电动螺丝刀：刀头压在「拧入中」那颗螺丝槽口上 ----
    tgt = (C + 52, py + 34)
    s.path("M %s %s L %s %s" % (f(C + 168), f(1096), f(tgt[0] + 14), f(tgt[1] - 16)),
           "none", "#5b6b7d", 10)
    s.rect(C + 158, 1080, 96, 32, "#2f6fb0", "#1b3a55", 2, rx=9)
    s.rect(C + 232, 1082, 22, 28, "#e8c33c", "#8a6a1a", 1.6, rx=5)
    s.circ(C + 164, 1084, 3.4, "#7ef0a8", None, 0)
    s.line(tgt[0] + 16, tgt[1] - 20, tgt[0] + 4, tgt[1] - 8, "#8d9aa8", 5)
    s.poly([(tgt[0] + 6, tgt[1] - 10), (tgt[0] - 2, tgt[1] + 2), (tgt[0] + 4, tgt[1] + 8),
            (tgt[0] + 12, tgt[1] - 2)], "#8d9aa8", "#4a5a6a", 1.4)
    s.line(tgt[0] - 6, tgt[1] + 6, tgt[0] + 6, tgt[1] - 6, "#2b3a4a", 4.4)
    s.text(C + 206, 1060, "电动螺丝刀", 13, "#1b3a55", "middle", "800")
    s.rect(C + 158, 1122, 104, 28, "#fdfdf6", INK, 1.6, rx=5)
    s.text(C + 210, 1141, "侧面答案 %d" % B_CODE, 13, "#16202c", "middle", "800")
    # ---- 密码锁 ----
    lx, ly = C + 268, 1200
    s.rect(lx, ly, 148, 82, "#3b4a5c", INK, 2.2, rx=9)
    s.rect(lx + 12, ly + 11, 124, 40, "#0f1b16", None, 0, rx=5)
    s.text(lx + 74, ly + 41, "%d" % LOCK, 32, "#7ef0a8", "middle", "800", family="monospace")
    s.text(lx + 74, ly + 70, "A+B+C = %d+%d+%d" % (A_CODE, B_CODE, C_CODE), 12,
           "#cfe0ee", "middle", "700")
    s.text(lx + 74, ly - 12, "密码锁", 14, "#1b3a55", "middle", "800")
    # ---- 两盏灯（鞍架两侧各一，共 P 盏） ----
    for lx2 in (C - 150, C + 150):
        s.path("M %s 1262 Q %s 1236 %s 1220" % (f(lx2), f(lx2 + (24 if lx2 < C else -24)), f(lx2)),
               "none", "#5b6b7d", 2.4)
        s.line(lx2, 1220, lx2, 1236, "#5b6b7d", 2.4)
        s.path("M %s 1236 l -15 0 l 7 34 l 16 0 l 7 -34 Z" % f(lx2), "#e0a92e", "#8a6a1a", 1.8)
        s.circ(lx2, 1252, 8, "#fff2c0", None, 0, op=0.92)
    s.text(C, 1352, "鞍架两侧合计 %d 盏灯（P=%d）" % (RACE_RANK, RACE_RANK), 13,
           "#16202c", "middle", "800")


def draw_bear(s):
    """北极熊横跨在鹈鹕展开的两翼上：后足落左翼、前足落右翼。"""
    C = CHAIN
    L = 460
    P.polar_bear(s, C, BEAR_CY, L)
    # 熊的足：明确压在鹈鹕翼面上
    s.circ(C - 205, WING_Y, 22, "none", "#c0392b", 2.6)
    s.circ(C + 205, WING_Y, 22, "none", "#c0392b", 2.6)
    s.line(C - 205, WING_Y - 28, C - 205, BEAR_CY + 60, "#c0392b", 2.2, dash="6 4")
    s.line(C + 205, WING_Y - 28, C + 205, BEAR_CY + 60, "#c0392b", 2.2, dash="6 4")
    s.text(C - 205, WING_Y + 52, "后足 · 画面左翼", 13, "#c0392b", "middle", "800")
    s.text(C + 205, WING_Y + 52, "前足 · 画面右翼", 13, "#c0392b", "middle", "800")
    s.text(C, BEAR_CY - 92, "北极熊", 20, "#16202c", "middle", "800")
    s.text(C, BEAR_CY - 70, "白厚毛 · 长吻 · 小圆耳 · 黑鼻（非熊猫/棕熊）", 13,
           "#33424f", "middle", "700")
    # ---- 项圈：大秦御用 ----
    cx0, cy0 = C + 108, BEAR_CY - 34
    s.path("M %s %s C %s %s %s %s %s %s L %s %s C %s %s %s %s %s %s Z"
           % (f(cx0), f(cy0), f(cx0 + 34), f(cy0 - 12), f(cx0 + 58), f(cy0 - 6),
              f(cx0 + 62), f(cy0 + 16), f(cx0 + 62), f(cy0 + 34),
              f(cx0 + 26), f(cy0 + 22), f(cx0), f(cy0 + 30), f(cx0), f(cy0)),
           "#c0392b", "#7b1f13", 2.2)
    s.text(cx0 + 30, cy0 + 22, "大秦御用", 15, "#ffe9a8", "middle", "800")
    # ---- 项圈背面标签：4 ----
    s.rect(cx0 - 96, cy0 - 40, 86, 38, "#fdfdf6", INK, 1.8, rx=6)
    s.text(cx0 - 53, cy0 - 8, "%d" % SIBLINGS, 22, "#16202c", "middle", "800")
    s.text(cx0 - 53, cy0 - 52, "项圈背面标签", 12, "#33424f", "middle", "700")
    s.line(cx0 - 10, cy0 - 22, cx0, cy0 + 4, "#5b6b7d", 1.6)


def draw_qin(s):
    """秦始皇骑熊：双腿分居熊身体两侧（不站在熊背上），黑色玄衣 + 冕旒。
    身体略偏右，让左侧的金属板/鞍架保持可见。"""
    C = CHAIN
    seat = QIN_SEAT
    BX = C + 96                      # 躯干中心（略偏右，让左侧金属板可见）
    # ---- 双腿：从髋部向下张开，末端落在熊身体左右两侧的熊背之上 ----
    for sgn, leglab in ((-1, "右腿·画面左"), (1, "左腿·画面右")):
        hipx = BX + sgn * 22
        kneex = C + sgn * 104
        footx = C + sgn * 126
        s.path("M %s %s Q %s %s %s %s Q %s %s %s %s"
               % (f(hipx), f(seat - 4), f(kneex - sgn * 14), f(seat + 34),
                  f(kneex), f(seat + 66), f(kneex + sgn * 8), f(seat + 92),
                  f(footx), f(seat + 108)),
               "none", "#0b0b10", 30)
        s.path("M %s %s Q %s %s %s %s Q %s %s %s %s"
               % (f(hipx), f(seat - 4), f(kneex - sgn * 14), f(seat + 34),
                  f(kneex), f(seat + 66), f(kneex + sgn * 8), f(seat + 92),
                  f(footx), f(seat + 108)),
               "none", "#1c1c25", 22)
        s.path("M %s %s l %s 0 l 5 24 l -36 0 l 5 -24 Z"
               % (f(footx - 18), f(seat + 108), f(36)), "#0b0b10", "#000", 1.6)
        s.text(footx + sgn * 26, seat + 160, leglab, 13, "#16202c", "middle", "800")
    s.text(C, seat + 176, "两腿分居熊身体左右两侧 · 末端落在熊背 · 未站在熊背上", 14, "#c0392b", "middle", "800")
    # ---- 玄衣躯干 ----
    s.path("M %s %s C %s %s %s %s %s %s L %s %s C %s %s %s %s %s %s Z"
           % (f(BX - 44), f(seat + 2), f(BX - 52), f(seat - 68), f(BX - 32), f(seat - 118),
              f(BX), f(seat - 132), f(BX + 32), f(seat - 118), f(BX + 52), f(seat - 68),
              f(BX + 44), f(seat + 2), f(BX + 16), f(seat - 6)), "#17171d", "#000", 2.2)
    s.path("M %s %s L %s %s L %s %s L %s %s Z"
           % (f(BX - 11), f(seat - 126), f(BX + 11), f(seat - 126),
              f(BX + 16), f(seat - 4), f(BX - 16), f(seat - 4)), "#c0392b", None, 0, op=0.9)
    s.text(BX, seat - 74, "秦始皇", 17, "#e8c33c", "middle", "800")
    s.text(BX, seat - 54, "黑色玄衣", 12, "#9aa7b4", "middle", "400")
    # ---- 手臂：右手持螺丝刀（画面右）、左手扶金属板（画面左） ----
    s.path("M %s %s Q %s %s %s %s" % (f(BX + 32), f(seat - 108), f(BX + 62), f(seat - 70),
            f(C + 176), f(1100)), "none", "#17171d", 22)
    s.path("M %s %s Q %s %s %s %s" % (f(BX - 32), f(seat - 108), f(BX - 66), f(seat - 74),
            f(C - 66), f(1160)), "none", "#17171d", 22)
    s.circ(C + 176, 1100, 11, "#e8c9a0", "#8a6a4a", 1.6)
    s.circ(C - 66, 1160, 11, "#e8c9a0", "#8a6a4a", 1.6)
    s.text(C + 232, 1084, "右手 · 螺丝刀", 13, "#c0392b", "middle", "800")
    s.text(C - 116, 1188, "左手 · 扶金属板", 13, "#c0392b", "middle", "800")
    # ---- 左袖「秦」（人物自身左侧 = 画面右侧） ----
    s.path("M %s %s L %s %s L %s %s L %s %s Z"
           % (f(BX + 26), f(seat - 116), f(BX + 52), f(seat - 100), f(BX + 50), f(seat - 72),
              f(BX + 30), f(seat - 84)), "#17171d", "#000", 1.6)
    s.text(BX + 42, seat - 90, "秦", 16, "#e0a92e", "middle", "800")
    s.text(BX + 42, seat - 64, "左袖", 11, "#e8c33c", "middle", "800")
    # ---- 头 + 冕（冕板 + 冕旒） ----
    hx, hy = BX, seat - 176
    s.circ(hx, hy, 30, "#e8c9a0", "#8a6a4a", 2)
    s.path("M %s %s q 15 11 30 0" % (f(hx - 15), f(hy + 4)), "none", "#8a5a3a", 2)
    s.circ(hx - 11, hy - 6, 3.2, INK)
    s.circ(hx + 11, hy - 6, 3.2, INK)
    s.circ(hx, hy + 1, 4.0, "#8a5a3a")
    s.rect(hx - 38, hy - 42, 76, 14, "#17171d", "#000", 1.8, rx=3)     # 冕板
    s.text(hx, hy - 52, "冕板", 12, "#e8c33c", "middle", "800")
    for i in range(6):
        bx = hx - 28 + i * 11
        s.line(bx, hy - 28, bx, hy - 4, "#c9a227", 1.2)
        s.circ(bx, hy - 1, 2.6, "#f0d060", "#8a6a1a", 0.9)
    s.text(hx + 92, hy - 8, "冕旒", 13, "#e8c33c", "middle", "800")
    s.text(hx - 92, hy - 8, "冕旒", 13, "#e8c33c", "middle", "800")


    P.turtle(s, C + 96, TURTLE_CY, 112)
    s.text(C + 200, TURTLE_CY - 6, "龟", 16, "#2f5a24", "middle", "800")
    P.elephant(s, C + 96, ELE_CY, 168)
    s.text(C + 228, ELE_CY - 4, "微型象", 15, "#5b6470", "middle", "800")
    draw_greenhouse(s)


def draw_plate_and_lock(s):
    """鞍架 + 6 孔金属板（3 拧紧 / 1 拧入中 / 2 空孔）+ 密码锁 + 两盏灯。
    这些都放在熊背上方、秦身之前的独立小台上，避免被秦的躯干遮挡。"""
    C = CHAIN
    px, py, pw, ph = C - 96, 1150, 192, 112      # 金属板
    # ---- 鞍架（架在熊背上） ----
    s.rect(C - 110, 1262, 220, 20, "#8a9aab", "#4a5a6a", 1.8, rx=6)
    s.rect(C - 124, 1278, 248, 14, "#6b7a8a", "#4a5a6a", 1.6, rx=5)
    # 竖撑：明确落到熊背
    s.line(C - 84, 1262, C - 84, 1300, "#6b7a8a", 5)
    s.line(C + 84, 1262, C + 84, 1300, "#6b7a8a", 5)
    s.text(C, 1318, "鞍架（架于熊背）", 13, "#16202c", "middle", "800")
    # ---- 金属板 ----
    s.rect(px, py, pw, ph, "#c9d4de", "#5b6b7d", 2.4, rx=7)
    s.rect(px + 8, py + 8, pw - 16, ph - 16, "#dbe4ec", None, 0, rx=5)
    holes = [(C - 52, py + 34), (C, py + 34), (C + 52, py + 34),
             (C - 52, py + 80), (C, py + 80), (C + 52, py + 80)]
    for h in holes:
        P.empty_hole(s, h[0], h[1], 11)
    for h in holes[:3] + [holes[3]]:
        P.screw(s, h[0], h[1], 11)
    s.text(C, py - 12, "金属板 · 6 孔", 14, "#16202c", "middle", "800")
    s.line(C + 52, py + 20, C + 52, py + 2, "#c0392b", 1.6)
    s.text(C + 104, py + 6, "拧入中", 12, "#c0392b", "middle", "800")
    s.text(C - 62, py + 110, "3 已拧紧", 12, "#1b7a4a", "middle", "800")
    s.text(C + 62, py + 110, "2 空孔", 12, "#c0392b", "middle", "800")
    # ---- 电动螺丝刀：刀头压在「拧入中」那颗螺丝槽口上 ----
    tgt = (C + 52, py + 34)
    s.path("M %s %s L %s %s" % (f(C + 168), f(1096), f(tgt[0] + 14), f(tgt[1] - 16)),
           "none", "#5b6b7d", 10)
    s.rect(C + 158, 1080, 96, 32, "#2f6fb0", "#1b3a55", 2, rx=9)
    s.rect(C + 232, 1082, 22, 28, "#e8c33c", "#8a6a1a", 1.6, rx=5)
    s.circ(C + 164, 1084, 3.4, "#7ef0a8", None, 0)
    s.line(tgt[0] + 16, tgt[1] - 20, tgt[0] + 4, tgt[1] - 8, "#8d9aa8", 5)
    s.poly([(tgt[0] + 6, tgt[1] - 10), (tgt[0] - 2, tgt[1] + 2), (tgt[0] + 4, tgt[1] + 8),
            (tgt[0] + 12, tgt[1] - 2)], "#8d9aa8", "#4a5a6a", 1.4)
    s.line(tgt[0] - 6, tgt[1] + 6, tgt[0] + 6, tgt[1] - 6, "#2b3a4a", 4.4)
    s.text(C + 206, 1060, "电动螺丝刀", 13, "#1b3a55", "middle", "800")
    s.rect(C + 158, 1122, 104, 28, "#fdfdf6", INK, 1.6, rx=5)
    s.text(C + 210, 1141, "侧面答案 %d" % B_CODE, 13, "#16202c", "middle", "800")
    # ---- 密码锁 ----
    lx, ly = C + 268, 1200
    s.rect(lx, ly, 148, 82, "#3b4a5c", INK, 2.2, rx=9)
    s.rect(lx + 12, ly + 11, 124, 40, "#0f1b16", None, 0, rx=5)
    s.text(lx + 74, ly + 41, "%d" % LOCK, 32, "#7ef0a8", "middle", "800", family="monospace")
    s.text(lx + 74, ly + 70, "A+B+C = %d+%d+%d" % (A_CODE, B_CODE, C_CODE), 12,
           "#cfe0ee", "middle", "700")
    s.text(lx + 74, ly - 12, "密码锁", 14, "#1b3a55", "middle", "800")
    # ---- 两盏灯（鞍架两侧各一，共 P 盏） ----
    for lx2 in (C - 150, C + 150):
        s.path("M %s 1262 Q %s 1236 %s 1220" % (f(lx2), f(lx2 + (24 if lx2 < C else -24)), f(lx2)),
               "none", "#5b6b7d", 2.4)
        s.line(lx2, 1220, lx2, 1236, "#5b6b7d", 2.4)
        s.path("M %s 1236 l -15 0 l 7 34 l 16 0 l 7 -34 Z" % f(lx2), "#e0a92e", "#8a6a1a", 1.8)
        s.circ(lx2, 1252, 8, "#fff2c0", None, 0, op=0.92)
    s.text(C, 1352, "鞍架两侧合计 %d 盏灯（P=%d）" % (RACE_RANK, RACE_RANK), 13,
           "#16202c", "middle", "800")


def draw_bear(s):
    """北极熊横跨在鹈鹕展开的两翼上：后足落左翼、前足落右翼。"""
    C = CHAIN
    L = 460
    P.polar_bear(s, C, BEAR_CY, L)
    # 熊的足：明确压在鹈鹕翼面上
    s.circ(C - 205, WING_Y, 22, "none", "#c0392b", 2.6)
    s.circ(C + 205, WING_Y, 22, "none", "#c0392b", 2.6)
    s.line(C - 205, WING_Y - 28, C - 205, BEAR_CY + 60, "#c0392b", 2.2, dash="6 4")
    s.line(C + 205, WING_Y - 28, C + 205, BEAR_CY + 60, "#c0392b", 2.2, dash="6 4")
    s.text(C - 205, WING_Y + 52, "后足 · 画面左翼", 13, "#c0392b", "middle", "800")
    s.text(C + 205, WING_Y + 52, "前足 · 画面右翼", 13, "#c0392b", "middle", "800")
    s.text(C, BEAR_CY - 92, "北极熊", 20, "#16202c", "middle", "800")
    s.text(C, BEAR_CY - 70, "白厚毛 · 长吻 · 小圆耳 · 黑鼻（非熊猫/棕熊）", 13,
           "#33424f", "middle", "700")
    # ---- 项圈：大秦御用 ----
    cx0, cy0 = C + 108, BEAR_CY - 34
    s.path("M %s %s C %s %s %s %s %s %s L %s %s C %s %s %s %s %s %s Z"
           % (f(cx0), f(cy0), f(cx0 + 34), f(cy0 - 12), f(cx0 + 58), f(cy0 - 6),
              f(cx0 + 62), f(cy0 + 16), f(cx0 + 62), f(cy0 + 34),
              f(cx0 + 26), f(cy0 + 22), f(cx0), f(cy0 + 30), f(cx0), f(cy0)),
           "#c0392b", "#7b1f13", 2.2)
    s.text(cx0 + 30, cy0 + 22, "大秦御用", 15, "#ffe9a8", "middle", "800")
    # ---- 项圈背面标签：4 ----
    s.rect(cx0 - 96, cy0 - 40, 86, 38, "#fdfdf6", INK, 1.8, rx=6)
    s.text(cx0 - 53, cy0 - 8, "%d" % SIBLINGS, 22, "#16202c", "middle", "800")
    s.text(cx0 - 53, cy0 - 52, "项圈背面标签", 12, "#33424f", "middle", "700")
    s.line(cx0 - 10, cy0 - 22, cx0, cy0 + 4, "#5b6b7d", 1.6)


def draw_qin(s):
    """秦始皇骑熊：双腿分居熊身体两侧（不站在熊背上），黑色玄衣 + 冕旒。"""
    C = CHAIN
    seat = QIN_SEAT
    # ---- 双腿：从髋部向外下张，落在熊身左右两侧之外（不站熊背） ----
    for sgn, leglab in ((-1, "右腿（画面左）"), (1, "左腿（画面右）")):
        hipx = C + sgn * 30
        kneex = C + sgn * 118
        footx = C + sgn * 138
        s.path("M %s %s Q %s %s %s %s Q %s %s %s %s"
               % (f(hipx), f(seat - 6), f(kneex - sgn * 8), f(seat + 40),
                  f(kneex), f(seat + 78), f(kneex + sgn * 10), f(seat + 108),
                  f(footx), f(seat + 124)),
               "none", "#0b0b10", 34)
        s.path("M %s %s Q %s %s %s %s Q %s %s %s %s"
               % (f(hipx), f(seat - 6), f(kneex - sgn * 8), f(seat + 40),
                  f(kneex), f(seat + 78), f(kneex + sgn * 10), f(seat + 108),
                  f(footx), f(seat + 124)),
               "none", "#1c1c25", 26)
        # 靴（悬于熊身外侧，落在熊背高度以下）
        s.path("M %s %s l %s 0 l 5 26 l -40 0 l 5 -26 Z"
               % (f(footx - 20), f(seat + 124), f(40)), "#0b0b10", "#000", 1.6)
        s.text(footx + sgn * 18, seat + 178, leglab, 13, "#16202c", "middle", "800")
    # 腿位说明：明确两腿分居熊身体两侧
    s.line(C - 250, seat + 200, C - 150, seat + 200, "#c0392b", 2.4)
    s.line(C + 150, seat + 200, C + 250, seat + 200, "#c0392b", 2.4)
    s.text(C, seat + 224, "两条腿分别落在熊身体左右两侧（未站在熊背上）", 14,
           "#c0392b", "middle", "800")
    # ---- 玄衣躯干（坐姿，上窄下宽） ----
    s.path("M %s %s C %s %s %s %s %s %s L %s %s C %s %s %s %s %s %s Z"
           % (f(C - 62), f(seat + 6), f(C - 74), f(seat - 90), f(C - 46), f(seat - 156),
              f(C), f(seat - 174), f(C + 46), f(seat - 156), f(C + 74), f(seat - 90),
              f(C + 62), f(seat + 6), f(C + 22), f(seat - 6)), "#17171d", "#000", 2.2)
    # 衣缘红带
    s.path("M %s %s L %s %s L %s %s L %s %s Z"
           % (f(C - 15), f(seat - 166), f(C + 15), f(seat - 166),
              f(C + 22), f(seat - 4), f(C - 22), f(seat - 4)), "#c0392b", None, 0, op=0.9)
    s.text(C, seat - 96, "秦始皇", 21, "#e8c33c", "middle", "800")
    s.text(C, seat - 72, "黑色玄衣", 13, "#9aa7b4", "middle", "400")
    # ---- 手臂：右手持螺丝刀、左手扶金属板 ----
    s.path("M %s %s Q %s %s %s %s" % (f(C + 44), f(seat - 140), f(C + 100), f(seat - 90),
            f(C + 150), f(1160)), "none", "#17171d", 26)
    s.path("M %s %s Q %s %s %s %s" % (f(C - 44), f(seat - 140), f(C - 96), f(seat - 96),
            f(C - 116), f(1210)), "none", "#17171d", 26)
    s.circ(C + 150, 1160, 12, "#e8c9a0", "#8a6a4a", 1.6)      # 右手（画面右）
    s.circ(C - 116, 1210, 12, "#e8c9a0", "#8a6a4a", 1.6)     # 左手（画面左）
    s.text(C + 150, 1128, "右手 · 螺丝刀", 13, "#e8c33c", "middle", "800")
    s.text(C - 116, 1250, "左手 · 扶金属板", 13, "#e8c33c", "middle", "800")
    # ---- 左袖「秦」（人物自身左侧 = 画面右侧） ----
    s.path("M %s %s L %s %s L %s %s L %s %s Z"
           % (f(C + 36), f(seat - 148), f(C + 68), f(seat - 128), f(C + 64), f(seat - 92),
              f(C + 40), f(seat - 108)), "#17171d", "#000", 1.6)
    s.text(C + 54, seat - 116, "秦", 18, "#e0a92e", "middle", "800")
    s.text(C + 54, seat - 86, "左袖", 12, "#e8c33c", "middle", "800")
    # ---- 头 + 冕（冕板 + 冕旒） ----
    hx, hy = QIN_HEAD
    s.circ(hx, hy, 36, "#e8c9a0", "#8a6a4a", 2)
    s.path("M %s %s q 17 13 34 0" % (f(hx - 17), f(hy + 5)), "none", "#8a5a3a", 2)
    s.circ(hx - 13, hy - 7, 3.6, INK)
    s.circ(hx + 13, hy - 7, 3.6, INK)
    s.circ(hx, hy + 1, 4.4, "#8a5a3a")
    s.rect(hx - 44, hy - 48, 88, 16, "#17171d", "#000", 1.8, rx=3)     # 冕板
    s.text(hx, hy - 58, "冕板", 13, "#e8c33c", "middle", "800")
    for k in (0, 1):
        for i in range(7):
            bx = hx - 33 + i * 11
            by = hy - 32
            s.line(bx, by, bx, by + 30, "#c9a227", 1.3)
            s.circ(bx, by + 33, 2.8, "#f0d060", "#8a6a1a", 0.9)
    s.text(hx + 108, hy - 10, "冕旒", 14, "#e8c33c", "middle", "800")
    s.text(hx - 108, hy - 10, "冕旒", 14, "#e8c33c", "middle", "800")
    # 冕板 → 龟 的承托说明
    s.line(hx, hy - 62, hx, TURTLE_CY - 26, "#1b7a4a", 2, dash="5 4")
    s.text(hx + 96, TURTLE_CY - 34, "冕板托龟", 12, "#1b7a4a", "start", "800")


def draw_greenhouse(s):
    x0, x1 = 440, 900
    y0, y1 = GH_BOT, GH_TOP + 40
    s.poly([(x0, y1), (x0, y0), (x1, y0), (x1, y1), ((x0 + x1) / 2, GH_TOP)],
           "url(#grn)", "#6fa8bd", 2.6)
    # 框架
    s.line(x0, y1, x0, y0, "#8fb8c8", 3)
    s.line(x1, y1, x1, y0, "#8fb8c8", 3)
    s.line(x0, y0, x1, y0, "#8fb8c8", 3)
    s.line(x0, y1, (x0 + x1) / 2, GH_TOP, "#8fb8c8", 3)
    s.line(x1, y1, (x0 + x1) / 2, GH_TOP, "#8fb8c8", 3)
    s.line(x0, y1, x1, y1, "#8fb8c8", 3)
    # 恰好 R=3 扇窗（不含门上的玻璃）
    for i in range(R_LETTER):
        wx = x0 + 118 + i * 100
        s.rect(wx, y0 - 96, 74, 58, "rgba(214,242,252,0.55)", "#4f8fa8", 2.4, rx=4)
        s.line(wx, y0 - 96, wx + 74, y0 - 38, "#4f8fa8", 1.4)
        s.line(wx + 74, y0 - 96, wx, y0 - 38, "#4f8fa8", 1.4)
    s.text(x0 + 268, y0 - 112, "温室恰好 %d 扇窗（不含门上玻璃）" % R_LETTER, 14,
           "#1b3a4a", "middle", "800")
    # 门 + 门牌（浮萍题 47）
    s.rect(x1 - 92, y0 - 104, 66, 104, "rgba(214,242,252,0.42)", "#4f8fa8", 2.4, rx=4)
    s.rect(x1 - 96, y0 - 132, 74, 26, "#e0a92e", "#8a6a1a", 1.8, rx=4)
    s.text(x1 - 59, y0 - 114, "%d" % C_CODE, 16, "#3a2a06", "middle", "800")
    s.text(x1 - 59, y0 - 122, "门牌", 9, "#6b4a12", "middle", "700")
    s.text(x1 - 59, y0 + 18, "门（玻璃不计窗）", 12, "#1b3a4a", "middle", "700")
    s.text((x0 + x1) / 2, y1 + 30, "透明温室（象背）", 16, "#1b3a4a", "middle", "800")

    # 苹果树：恰好 5 个苹果，4 红 1 绿，绿在最右
    apples = [(-30, -26, 13, False), (4, -44, 13, False), (34, -18, 13, False),
              (-12, 22, 13, False), (60, 8, 13, True)]
    P.apple_tree(s, TREE_C[0], TREE_C[1], 62, apples,
                 branch=(TREE_C[0] + 36, TREE_C[1] - 24, HG_C[0], HG_C[1] - 56),
                 hourglass_hook=(HG_C[0], HG_C[1] - 58))
    s.text(TREE_C[0], TREE_C[1] + 118, "苹果树：5 个 = 4 红 + 1 绿（最右）", 13, "#1b3a4a", "middle", "800")

    # 沙漏（上星下齿轮）
    P.hourglass(s, HG_C[0], HG_C[1], 62, 130)
    s.text(HG_C[0] + 44, HG_C[1] + 84, "沙漏：上仓=星星 · 下仓=微型齿轮", 13, "#1b3a4a", "start", "700")

    # 章鱼
    tips = P.octopus(s, OCT_C[0], OCT_C[1], 44, ARMS)
    # 宇航头盔
    s.path("M %s %s A 30 30 0 0 1 %s %s Z"
           % (f(OCT_C[0] - 30), f(OCT_C[1] - 8), f(OCT_C[0] + 30), f(OCT_C[1] - 8)),
           "rgba(214,242,252,0.75)", "#4f8fa8", 2.2)
    s.line(OCT_C[0] - 20, OCT_C[1] - 24, OCT_C[0] + 20, OCT_C[1] - 24, "#4f8fa8", 1.4)
    s.text(OCT_C[0], OCT_C[1] - 44, "宇航头盔", 12, "#1b3a4a", "middle", "700")
    s.text(OCT_C[0] + 46, OCT_C[1] + 8, "章鱼 8 腕足", 13, "#5a2a6a", "middle", "800")

    # 2 块小黑板 + 6 面小旗
    # 选取最外侧的两条腕足执黑板，其余六条执旗
    order = sorted(range(ARMS), key=lambda i: -abs(tips[i][0] - OCT_C[0]))
    bb_idx = sorted(order[:4:2])          # 左右最外侧各一
    flag_idx = [i for i in range(ARMS) if i not in bb_idx]
    bb_pos = [tips[i] for i in bb_idx]
    flag_pos = [tips[i] for i in flag_idx]
    bb_txt = [("球拍球价", BALL_PRICE), ("9.11 □ 9.9", "9.11 ＜ 9.9")]
    BB_FIX = [(OCT_C[0] - 236, OCT_C[1] - 118), (OCT_C[0] + 232, OCT_C[1] + 96)]
    for i, (bx, by) in enumerate(BB_FIX):
        s.line(bx, by, tips[bb_idx[i]][0], tips[bb_idx[i]][1], "#7a3d94", 3, dash="4 3")
        s.rect(bx - 84, by - 48, 168, 94, "#25333f", "#0f1720", 2.6, rx=6)
        s.rect(bx - 75, by - 39, 150, 76, "#16212b", None, 0, rx=4)
        s.text(bx, by - 12, bb_txt[i][0], 13, "#cfe0ee", "middle", "700")
        s.text(bx, by + 22, bb_txt[i][1], 26 if i == 0 else 18, "#ffd54a", "middle", "800")
    flag_cols = ["#e0392b", "#f0912a", "#e8c33c", "#4e9c3a", "#2f6fb0", "#8a48a8"]
    for i, (fx, fy) in enumerate(flag_pos):
        P.flag(s, fx, fy, 40, 28, flag_cols[i])
    s.text(OCT_C[0], OCT_C[1] + 96, "2 腕足执黑板 · 6 腕足执六色旗", 13, "#1b3a4a", "middle", "800")

    # 茶杯 → 岛 → 灯塔 → 玻璃球
    P.teacup_island(s, OCT_C[0], CUP_CY, 104)
    s.text(OCT_C[0] + 74, CUP_CY + 20, "茶杯", 14, "#7a6a4a", "start", "800")
    P.lighthouse(s, LIGH_C[0], LIGH_C[1], 48, 18)
    s.text(LIGH_C[0] + 44, LIGH_C[1] + 40, "灯塔", 13, "#5b6b7d", "start", "700")
    P.glass_ball(s, BALL_C[0], BALL_C[1], BALL_R, "")
    s.text(BALL_C[0], BALL_C[1] + 128, "透明玻璃球", 15, "#1b3a4a", "middle", "800")
    # 两层内部递归（第三层以金色圆点终止）
    P.mini_plane(s, BALL_C[0], BALL_C[1] + 26, 108, nose=1)
    s.text(BALL_C[0], BALL_C[1] + 92, "第1层：机头朝右", 12, "#1b3a4a", "middle", "700")
    s.circ(BALL_C[0] + 34, BALL_C[1] - 22, 26, "rgba(198,236,250,0.35)", "#7fb6cc", 2)
    P.mini_plane(s, BALL_C[0] + 34, BALL_C[1] - 18, 34, nose=-1)
    s.text(BALL_C[0] + 34, BALL_C[1] - 58, "第2层：朝左", 11, "#1b3a4a", "middle", "700")
    s.circ(BALL_C[0] + 34, BALL_C[1] - 20, 4.4, "#f2c94c", "#a8791a", 1.2)
    s.text(BALL_C[0] + 34, BALL_C[1] - 2, "第3层止于金点", 10, "#8a6a1a", "middle", "700")
    s.text(BALL_C[0] - 4, BALL_C[1] - 62, "最外层飞机：机头朝左", 12, "#1b3a4a", "middle", "700")


# =====================================================================
# 鹈鹕 + 自行车（两轮触机翼面）
# =====================================================================
def draw_pelican_rig(s):
    C = CHAIN
    info = P.bicycle(s, C, BIKE_CY, wheel_r=40, wb=200, face=-1)
    BAR_INFO.update(info)
    # ---- 两轮触地：明确标出接触点 ----
    for wx, wy, lab in ((info["wheel_back"][0], info["wheel_back"][1], "后轮"),
                        (info["wheel_front"][0], info["wheel_front"][1], "前轮")):
        s.circ(wx, wy, 10, "none", "#c0392b", 2.6)
        s.line(wx, wy - 30, wx, wy - 6, "#c0392b", 1.8)
        s.text(wx, wy - 36, lab, 13, "#c0392b", "middle", "800")
    s.line(C - 210, WING_SURF + 52, C + 210, WING_SURF + 52, "#1b3a4a", 2)
    s.text(C, WING_SURF + 76, "两轮底均与机翼上表面相切 · 不悬空 · 不触机身 · 不触云",
           15, "#1b3a4a", "middle", "800")
    # ---- 车架单词 strawberry（字母 r 为红色，其余白色） ----
    x0, y0 = info["top_tube"][0]
    x1, y1 = info["top_tube"][1]
    mid = ((x0 + x1) / 2, (y0 + y1) / 2)
    s.rich(mid[0], mid[1] - 14, [(ch, "#e0392b" if ch == "r" else "#ffffff") for ch in "strawberry"],
           26, "middle", "800", ls=1)
    s.text(mid[0], mid[1] + 20, "字母 r 共 %d 个（红色）" % R_LETTER, 13, "#e8eef4", "middle", "700")
    # ---- 车铃：写 r 的总数 ----
    bx, by = info["bar"][0] - 6, info["bar"][1] - 8
    s.circ(bx, by, 17, "#e8c33c", "#8a6a1a", 2.2)
    s.text(bx, by + 8, "%d" % R_LETTER, 19, "#3a2a06", "middle", "800")
    s.text(bx, by - 26, "车铃", 12, "#f2f6fa", "middle", "700")

    # ---- 鹈鹕：先画翼（承熊），再画身，最后双脚踩脚踏 ----
    P.pelican(s, C, PEL_CY - 40, 0.86, face=-1, wings=True, wing_span=560)
    p1, p2 = info["pedal1"], info["pedal2"]
    # 双腿：从身体下缘分别垂到两只脚踏（脚踏互成 180°，故一高一低）
    for p in (p1, p2):
        hx = C + (p[0] - C) * 0.30
        s.path("M %s %s L %s %s" % (f(hx), f(PEL_CY + 42), f(p[0]), f(p[1] - 8)),
               "none", "#e8c33c", 10)
        s.circ(hx, PEL_CY + 42, 6.5, "#efe9da", "#9a927e", 1.6)
        s.path("M %s %s l -16 8 l 0 10 l 32 0 l 0 -10 Z" % (f(p[0]), f(p[1] - 8)),
               "#f0912a", "#a85f16", 1.4)
    s.text(C + 56, PEL_CY + 84, "双足分别踩两只脚踏", 14, "#1b3a4a", "start", "800")
    # ---- 翼承托点 ----
    for wx, lab in ((C - 260, "左翼承熊后足"), (C + 260, "右翼承熊前足")):
        s.circ(wx, WING_Y, 15, "none", "#1b7a4a", 2.6)
        s.text(wx, WING_Y - 26, lab, 13, "#1b7a4a", "middle", "800")


def draw_cockpit_clock(s):
    cx, cy, r = 1620, 1462, 30
    s.circ(cx, cy, r + 6, "#fdfdf6", INK, 2.2)
    s.circ(cx, cy, r, "#fbfaf6", "#5b6b7d", 1.4)
    for i in range(12):
        a = math.radians(i * 30)
        r1 = r - (8 if i % 3 == 0 else 4)
        s.line(cx + r1 * math.sin(a), cy - r1 * math.cos(a),
               cx + (r - 1) * math.sin(a), cy - (r - 1) * math.cos(a), INK, 2 if i % 3 == 0 else 1)
    s.text(cx, cy - r - 10, "驾驶舱时钟", 12, "#33424f", "middle", "700")
    ha = math.radians(97.5)      # 3:15 → 时针 97.5°，不恰好指向 3
    ma = math.radians(90)
    s.line(cx, cy, cx + r * 0.52 * math.sin(ha), cy - r * 0.52 * math.cos(ha), INK, 4.4)
    s.line(cx, cy, cx + r * 0.80 * math.sin(ma), cy - r * 0.80 * math.cos(ma), INK, 3)
    s.circ(cx, cy, 3.4, INK)
    s.text(cx, cy + r + 24, "3:15", 16, INK, "middle", "800")
    s.text(cx, cy + r + 46, "较小夹角 %s°" % CLOCK_DEG, 14, "#c0392b", "middle", "800")


# =====================================================================
# 机身侧面小件：三门 / 卡片 / 平衡 / 登机牌 / 贴纸 / 色词 / 等长线
# =====================================================================
def draw_fuselage_items(s):
    # ---- 三门问题 ----
    dx, dy, dw, dh = 1520, 1368, 56, 78
    s.text(dx + dw + 10, dy - 10, "标准三门问题", 15, "#16202c", "start", "800")
    for i in range(3):
        x = dx + i * (dw + 22)
        opened = (i == 2)
        s.rect(x, dy, dw, dh, "#e8eef4" if not opened else "#5a4632",
               "#2b3a4a", 2, rx=5)
        s.circ(x + dw * 0.78, dy + dh / 2, 4, "#e8c33c", "#8a6a1a", 1.2)
        s.text(x + dw / 2, dy - 6, "%d 号门" % (i + 1), 13, "#16202c", "middle", "800")
        if i == 0:
            s.rect(x + 6, dy - 30, dw - 12, 22, "#ffe9a8", "#8a6a1a", 1.4, rx=4)
            s.text(x + dw / 2, dy - 14, "初选", 12, "#3a2a06", "middle", "800")
        if opened:
            s.poly([(x + dw, dy), (x + dw + 26, dy + 8), (x + dw + 26, dy + dh - 8), (x + dw, dy + dh)],
                   "#c9b394", "#7b6a4a", 1.6)
            s.circ(x + dw / 2, dy + dh * 0.62, 20, "#f0e6d2", "#a89a80", 1.6)
            s.ell(x + dw / 2 - 12, dy + dh * 0.5, 7, 4, "#a89a80", None, 0, rot=-30)
            s.ell(x + dw / 2 + 12, dy + dh * 0.5, 7, 4, "#a89a80", None, 0, rot=30)
            s.circ(x + dw / 2 - 8, dy + dh * 0.55, 2, INK)
            s.circ(x + dw / 2 + 8, dy + dh * 0.55, 2, INK)
            s.line(x + dw / 2 - 4, dy + dh * 0.68, x + dw / 2 + 4, dy + dh * 0.68, INK, 1.4)
            s.text(x + dw / 2, dy + dh + 20, "主持人开 3 号门（羊）", 12, "#7b1f13", "middle", "800")
    s.rect(dx + dw + 22, dy + dh + 22, 84, 28, "#e8c33c", "#8a6a1a", 1.6, rx=5)
    s.text(dx + dw + 64, dy + dh + 42, "换门 2/3", 15, "#3a2a06", "middle", "800")
    s.text(dx + dw + 64, dy + dh + 66, "初选 1 号 → 换门必胜 2/3", 12, "#33424f", "middle", "700")

    # ---- 四张两面卡片（只有必须翻看的 A 加金框） ----
    cxs, cy2 = 1380, 1690
    s.text(cxs + 108, cy2 - 92, "四张两面卡片 · 检验「元音背面必为偶数」", 15, "#16202c", "middle", "800")
    faces = ["A", "D", "4", "7"]
    backs = ["字", "字", "数", "数"]
    for i, (fc, bk) in enumerate(zip(faces, backs)):
        x = cxs + i * 58
        must = (fc == "A")
        s.rect(x, cy2 - 78, 48, 68, "#fdfdf6", "#e0a92e" if must else "#5b6b7d",
               4 if must else 1.8, rx=5)
        s.text(x + 24, cy2 - 32, fc, 26, INK, "middle", "800")
        s.line(x, cy2 - 44, x + 48, cy2 - 44, "#c9d4de", 1.2, dash="3 3")
        s.text(x + 24, cy2 - 6, "背面%s" % bk, 11, "#8d9aa8", "middle", "400")
        s.text(x + 24, cy2 + 30, "金框" if must else "无需翻", 11,
               "#a8791a" if must else "#8d9aa8", "middle", "800")
    s.text(cxs + 108, cy2 + 56, "仅 A（元音）必须翻看；D 为辅音、4/7 为数字", 12, "#33424f", "middle", "700")

    # ---- 货舱天平：1 kg 铁 vs 1 kg 棉花，水平 ----
    bx, by = 1210, 1660
    s.text(bx, by - 128, "货舱天平 · 两侧均 1 kg · 天平水平", 15, "#16202c", "middle", "800")
    s.rect(bx - 130, by - 118, 260, 176, "#eef3f8", "#5b6b7d", 2, rx=8, op=0.95)
    s.line(bx, by - 86, bx, by + 30, "#5b6b7d", 5)
    s.line(bx, by - 86, bx - 92, by - 86, "#5b6b7d", 4)
    s.line(bx, by - 86, bx + 92, by - 86, "#5b6b7d", 4)
    s.path("M %s %s L %s %s" % (f(bx), f(by - 86), f(bx - 92), f(by - 86)), "none", "#1b7a4a", 2, dash="6 4")
    s.poly([(bx - 122, by - 86), (bx - 62, by - 86), (bx - 78, by - 74), (bx - 106, by - 74)],
           "#8d9aa8", "#4a5a6a", 1.4)
    s.poly([(bx + 62, by - 86), (bx + 122, by - 86), (bx + 106, by - 74), (bx + 78, by - 74)],
           "#8d9aa8", "#4a5a6a", 1.4)
    s.rect(bx - 106, by - 116, 56, 30, "#6b7a8a", "#39485a", 1.8, rx=4)
    s.text(bx - 78, by - 95, "1 kg", 14, "#fdfdf6", "middle", "800")
    s.circ(bx + 92, by - 92, 24, "#fdfdf6", "#c9d4de", 1.6)
    s.circ(bx + 92, by - 92, 14, "#eef3f8", "#c9d4de", 1.4)
    s.text(bx + 92, by - 60, "1 kg", 14, "#33424f", "middle", "800")
    s.text(bx - 78, by - 40, "铁（体积小）", 12, "#33424f", "middle", "700")
    s.text(bx + 92, by - 40, "棉花（体积明显更大）", 12, "#33424f", "middle", "700")
    s.text(bx, by + 44, "棉花体积明显更大，但天平保持水平", 12, "#1b7a4a", "middle", "800")

    # ---- 登机牌 ----
    for i, (px, title, body, ans) in enumerate((
            (1000, "登机牌 A · 蜗牛", ["白天爬 3 米，夜间下滑 2 米", "井深 10 米，第几天爬出？"], "8 天"),
            (1000, "登机牌 B · 猫", ["5 只猫 5 分钟抓 5 只老鼠", "100 分钟抓 100 只需几只猫？"], "5 只"))):
        py = 1570 + i * 0
    # 登机牌单独放置（避免与天平重叠）
    s.rect(980, 1860, 320, 96, "#fdfdf6", INK, 2, rx=8)
    s.text(1140, 1566, "登机牌 A · 蜗牛", 14, "#16202c", "middle", "800")
    s.text(1140, 1588, "白天爬 3 米 / 夜滑 2 米，井深 10 米", 12, "#5b6b7d", "middle", "400")
    s.text(1140, 1606, "第几天爬出？", 12, "#5b6b7d", "middle", "400")
    s.rect(1256, 1578, 56, 30, "#e8c33c", "#8a6a1a", 1.6, rx=4)
    s.text(1284, 1599, "8 天", 14, "#3a2a06", "middle", "800")
    s.rect(980, 1686, 320, 96, "#fdfdf6", INK, 2, rx=8)
    s.text(1140, 1712, "登机牌 B · 猫", 14, "#16202c", "middle", "800")
    s.text(1140, 1734, "5 只猫 5 分钟抓 5 只老鼠", 12, "#5b6b7d", "middle", "400")
    s.text(1140, 1752, "100 分钟抓 100 只需几只猫？", 12, "#5b6b7d", "middle", "400")
    s.rect(1256, 1724, 56, 30, "#e8c33c", "#8a6a1a", 1.6, rx=4)
    s.text(1284, 1745, "5 只", 14, "#3a2a06", "middle", "800")

    # ---- 黄色维修贴纸：三盒标签 ----
    s.rect(1660, 1620, 320, 210, "#ffe9a8", "#8a6a1a", 2.4, rx=10)
    s.text(1820, 1648, "黄色维修贴纸 · 三盒标签全错", 15, "#3a2a06", "middle", "800")
    labels = ["全苹果", "全桃子", "苹果桃子混合"]
    for i, lb in enumerate(labels):
        x = 1686 + i * 96
        s.rect(x, 1660, 80, 74, "#fdfdf6", "#5b6b7d", 1.8, rx=5)
        s.text(x + 40, 1688, lb, 12, "#16202c", "middle", "700")
        s.circ(x + 40, 1714, 9, "#e0392b", None, 0)
    # 机械手伸进「苹果桃子混合」那只盒子（第 3 只）
    s.path("M %s 1790 L %s 1766 L %s 1750" % (f(1860), f(1860), f(1860)), "none", "#8d9aa8", 12)
    s.rect(1846, 1708, 28, 22, "#c9d4de", "#4a5a6a", 1.6, rx=4)
    s.line(1854, 1708, 1850, 1728, "#4a5a6a", 3)
    s.line(1860, 1708, 1860, 1728, "#4a5a6a", 3)
    s.line(1866, 1708, 1870, 1728, "#4a5a6a", 3)
    s.text(1820, 1818, "只从「苹果桃子混合」盒取 1 个", 13, "#8a1f13", "middle", "800")

    # ---- 色词干扰标牌 ----
    s.rect(2120, 1600, 300, 190, "#fdfdf6", INK, 2, rx=10)
    s.text(2270, 1628, "色词干扰标牌", 15, INK, "middle", "800")
    words = [("红", "#2f6fb0"), ("蓝", "#3f9c3a"), ("绿", "#d0392b")]
    for i, (wch, inkc) in enumerate(words):
        s.text(2170 + i * 100, 1690, wch, 40, inkc, "middle", "800")
    s.text(2270, 1722, "读墨色，不读字义", 14, INK, "middle", "800")
    s.text(2270, 1750, "按墨色读取：蓝 → 绿 → 红", 14, "#1b7a4a", "middle", "800")
    s.text(2270, 1774, "（字面 红蓝绿 ／ 墨色 蓝绿红）", 11, "#5b6b7d", "middle", "400")

    # ---- 等长线段 ----
    s.rect(2500, 1600, 300, 190, "#fdfdf6", INK, 2, rx=10)
    s.text(2650, 1628, "两条等长水平线段", 15, INK, "middle", "800")
    L, y1, y2 = 240, 1676, 1740
    x1, x2 = 2650 - L / 2, 2650 + L / 2
    s.line(x1, y1, x2, y1, "#2f6fb0", 4, marker="arm")
    s.line(x2, y1, x1, y1, "#2f6fb0", 4, marker="arm")
    s.line(x1, y2, x2, y2, "#d0392b", 4, marker="arm")
    s.line(x2, y2, x1, y2, "#d0392b", 4, marker="arm")
    s.text(2650, 1660, "向内箭头", 12, "#2f6fb0", "middle", "700")
    s.text(2650, 1724, "向外箭头", 12, "#d0392b", "middle", "700")
    s.text(2650, 1772, "两线本体长度相同：均 %d 单位 · 等长" % L, 12, INK, "middle", "800")

    # ---- 回文横幅 ----
    s.path("M 1740 1520 L 2260 1508 L 2260 1576 L 1740 1560 Z", "#c0392b", "#7b1f13", 2)
    s.path("M 1740 1520 L 1716 1512 L 1716 1568 L 1740 1560 Z", "#8a2a1a", "#7b1f13", 1.6)
    s.path("M 2260 1508 L 2284 1500 L 2284 1556 L 2260 1564 Z", "#8a2a1a", "#7b1f13", 1.6)
    s.text(1700, 1540, "上海自来水来自海上", 30, "#ffe9a8", "middle", "800", ls=3)
    s.text(1700, 1576, "机身回文横幅", 12, "#e8c9c0", "middle", "700")

    # ---- 尾流标记（与糖果图标分开） ----


# =====================================================================
def draw_lower_panels(s):
    # ---- 微型维修机器人 1：塞瓦洛维奇 ----
    rx, ry = 1420, 1900
    s.text(rx, ry - 150, "微型维修机器人", 14, INK, "middle", "800")
    s.rect(rx - 150, ry - 142, 300, 78, "#fdfdf6", INK, 2, rx=6)
    s.block(rx - 134, ry - 122, ["所有玫瑰都是花；", "有些花很快凋谢；", "因此有些玫瑰很快凋谢。"],
            12, 20, INK, "start", "400")
    s.rect(rx - 46, ry - 42, 92, 32, "#3b4a5c", "#1b2a38", 1.8, rx=5)
    s.text(rx, ry - 21, "不必然成立", 13, "#ffd54a", "middle", "800")
    s.rect(rx - 34, ry - 8, 68, 46, "#8d9aa8", "#4a5a6a", 2, rx=8)
    s.circ(rx - 16, ry + 2, 5, "#e8c33c")
    s.circ(rx + 16, ry + 2, 5, "#c0392b")
    s.line(rx - 22, ry + 20, rx + 22, ry + 20, "#4a5a6a", 3)
    s.line(rx - 20, ry + 38, rx - 24, ry + 56, "#5b6b7d", 4)
    s.line(rx + 20, ry + 38, rx + 24, ry + 56, "#5b6b7d", 4)

    # ---- 微型维修机器人 2：+20% 后 -20% ----
    rx2, ry2 = 1900, 1900
    s.rect(rx2 - 34, ry2 - 8, 68, 46, "#8d9aa8", "#4a5a6a", 2, rx=8)
    s.circ(rx2 - 16, ry2 + 2, 5, "#e8c33c")
    s.circ(rx2 + 16, ry2 + 2, 5, "#c0392b")
    s.line(rx2 - 22, ry2 + 20, rx2 + 22, ry2 + 20, "#4a5a6a", 3)
    s.line(rx2 - 20, ry2 + 38, rx2 - 24, ry2 + 56, "#5b6b7d", 4)
    s.line(rx2 + 20, ry2 + 38, rx2 + 24, ry2 + 56, "#5b6b7d", 4)
    s.rect(rx2 - 150, ry2 - 142, 300, 108, "#fdfdf6", INK, 2, rx=6)
    s.text(rx2, ry2 - 122, "先 +20%，再在增大后的值上 -20%", 13, INK, "middle", "700")
    s.text(rx2, ry2 - 100, "1.2 × 0.8 = 0.96", 13, "#5b6b7d", "middle", "400")
    s.text(rx2, ry2 - 78, "不是两次百分比直接抵消", 12, "#c0392b", "middle", "700")
    s.rect(rx2 - 52, ry2 - 42, 104, 32, "#1b7a4a", "#0d4a2a", 1.8, rx=5)
    s.text(rx2, ry2 - 21, "96%", 15, "#eaffe8", "middle", "800")

    # ---- 最坏情况记录板（右下） ----
    px, py, pw, ph = 2140, 2110, 720, 250
    s.rect(px, py, pw, ph, "#fdfdf6", INK, 2.6, rx=12)
    s.rect(px, py, pw, 34, "#c0392b", "#7b1f13", 2, rx=12)
    s.rect(px, py + 22, pw, 12, "#c0392b", None, 0)
    s.text(px + pw / 2, py + 24, "最坏情况记录板 · 取出 %d 颗（=N−1）仍不满足条件" % (N_CANDY - 1),
           15, "#ffe9a8", "middle", "800")
    cw = (pw - 40) / 6
    for i, (nm, v) in enumerate(CANDY):
        x = px + 20 + i * cw
        s.text(x + cw / 2, py + 60, nm, 12, INK, "middle", "700")
        s.rect(x + 4, py + 70, cw - 8, 54, "#eef3f8" if v else "#f6d9d6", "#5b6b7d", 1.6, rx=5)
        s.text(x + cw / 2, py + 108, str(v), 30, INK if v else "#c0392b", "middle", "800")
        s.text(x + cw / 2, py + 142, "取 %d" % v, 11, "#5b6b7d", "middle", "400")
    s.text(px + pw / 2, py + 176, "合计 %d 颗 = N−1" % sum(WORST), 14, "#1b2a38", "middle", "800")
    s.text(px + pw / 2, py + 200, "星苹果 = 星桃子 = 0 ⇒ 两组配对均不成立", 13, "#c0392b", "middle", "700")
    s.text(px + pw / 2, py + 226, "再取第 %d 颗必成立 ⇒ N = %d" % (N_CANDY, N_CANDY), 14,
           "#1b7a4a", "middle", "800")
    s.text(px + pw / 2, py + 250, "六类数量总和 = %d" % CANDY_SUM, 13, INK, "middle", "800")
    s.path("M %s %s L %s %s" % (f(px + 20), f(py + ph - 8), f(px + pw - 20), f(py + ph - 8)),
           "#e0a92e", 3)


# =====================================================================
def draw_balloon_hanoi(s):
    bx, by = 2660, 300
    s.ell(bx, by, 96, 108, "#e8c33c", "#8a6a1a", 2.6)
    s.ell(bx, by - 34, 74, 78, "#f0912a", None, 0, op=0.6)
    s.path("M %s %s L %s %s L %s %s Z" % (f(bx - 96), f(by - 6), f(bx + 96), f(by - 6),
            f(bx), f(by + 108)), "#d0392b", None, 0, op=0.5)
    s.line(bx - 60, by + 96, bx - 44, by + 156, "#8a6a4a", 2)
    s.line(bx + 60, by + 96, bx + 44, by + 156, "#8a6a4a", 2)
    s.rect(bx - 50, by + 156, 100, 66, "#a3763c", "#6b4a22", 2.2, rx=6)
    s.text(bx, by + 182, "生日悖论", 12, "#f7e6c8", "middle", "700")
    s.text(bx, by + 212, "至少 %d 人" % 23, 19, "#ffe9a8", "middle", "800")
    s.text(bx, by - 130, "独立热气球（不依托飞机）", 14, "#1b3a4a", "middle", "800")

    # 汉诺塔 7 层
    hx, hy = bx, by + 400
    s.text(hx, hy - 150, "七层汉诺塔", 15, "#1b3a4a", "middle", "800")
    s.rect(hx - 200, hy - 134, 400, 236, "#fdfdf6", INK, 2, rx=8, op=0.94)
    s.rect(hx - 170, hy + 66, 340, 12, "#a3763c", "#6b4a22", 1.6, rx=4)
    for i, px in enumerate((hx - 110, hx, hx + 110)):
        s.rect(px - 5, hy - 108, 10, 174, "#8d9aa8", "#4a5a6a", 1.4, rx=4)
        s.text(px, hy - 120, "柱%d" % (i + 1), 11, INK, "middle", "700")
    for k in range(7):
        w = 96 - k * 12
        y = hy + 60 - k * 20
        col = ["#e8c33c", "#f0912a", "#4e9c3a", "#2f6fb0", "#8a48a8", "#d0392b", "#3b4a5c"][k]
        s.rect(hx - 110 - w / 2, y - 16, w, 16, col, "#2b3a4a", 1.4, rx=4)
    s.text(hx, hy + 94, "最少步数 = 2⁷−1 = 127", 14, "#1b7a4a", "middle", "800")
    s.text(hx, hy + 116, "（大盘不压小盘）", 11, "#5b6b7d", "middle", "400")
    s.path("M %s %s L %s %s" % (f(bx), f(by + 222), f(hx), f(hy - 136)), "#8d9aa8", 2, dash="5 5")


# =====================================================================
def draw_pond_cloud(s):
    cx, cy = 1180, 1980
    s.text(cx, cy - 210, "远处云中池塘 · 狼 / 羊 / 菜过河", 16, "#1b3a4a", "middle", "800")
    s.cloud(cx, cy, 560, 250, "#ffffff", 0.95)
    s.ell(cx, cy - 20, 190, 62, "rgba(150,205,235,0.75)", "#4f8fa8", 2.2)
    s.text(cx, cy - 8, "池塘", 15, "#1b4a5a", "middle", "800")
    # 左岸：农夫 + 狼 + 羊 + 菜
    s.circ(cx - 250, cy - 44, 16, "#e8c9a0", "#8a6a4a", 1.4)
    s.path("M %s %s l -14 34 l 28 0 Z" % (f(cx - 264), f(cy - 30)), "#4a5a6a", None, 0)
    s.path("M %s %s l -22 6 l 4 -16 l 20 -4 Z" % (f(cx - 262), f(cy - 34)), "#8d9aa8", "#4a5a6a", 1.2)
    s.ell(cx - 172, cy - 40, 26, 15, "#a89a80", "#6b5f4a", 1.4)
    s.poly([(cx - 190, cy - 52), (cx - 176, cy - 66), (cx - 162, cy - 52)], "#a89a80", "#6b5f4a", 1.2)
    s.circ(cx - 108, cy - 40, 15, "#f2ece0", "#b3a892", 1.4)
    s.path("M %s %s q 14 -6 22 4" % (f(cx - 112), f(cy - 46)), "none", "#b3a892", 1.4)
    s.circ(cx - 44, cy - 36, 17, "#6fbf4a", "#3f7d24", 1.6)
    s.text(cx - 44, cy - 6, "菜", 11, "#3f7d24", "middle", "700")
    # 船
    s.path("M %s %s L %s %s L %s %s Z" % (f(cx + 70), f(cy + 4), f(cx + 150), f(cy + 4),
            f(cx + 110), f(cy + 26)), "#a3763c", "#6b4a22", 1.6)
    s.line(cx + 110, cy + 2, cx + 110, cy - 34, "#6b4a22", 2.4)
    s.text(cx + 110, cy + 44, "船（农夫+最多一件）", 11, "#5b6b7d", "middle", "700")
    # 合法顺序箭头
    steps = ["1 农夫带羊过河 →", "2 空船返航：农夫独自 ←", "3 农夫带狼过河 →",
             "4 空船返航：农夫独自 ←", "5 农夫带菜过河 →", "6 空船返航：农夫独自 ←", "7 农夫带羊过河 →"]
    for i, t in enumerate(steps):
        s.text(cx - 220, cy + 62 + i * 24, t, 14, INK, "start", "600")
    s.text(cx - 220, cy + 62 + 7 * 24 + 8, "空船返航均标明「农夫独自」", 12, "#c0392b", "start", "700")


# =====================================================================
def draw_penguins(s):
    px, py = 260, 1900
    s.text(px, py - 118, "远处浮冰上的三只企鹅", 15, INK, "middle", "800")
    s.path("M %s %s L %s %s L %s %s Z" % (f(px - 150), f(py + 40), f(px + 150), f(py + 40),
            f(px + 100), f(py - 10)), "#dff0f7", "#7fa8bc", 2)
    specs = [(-96, "#e0392b", False, False), (0, "#2f6fb0", True, False), (96, "#3f9c3a", False, True)]
    for dx, hat, fish, glasses in specs:
        x = px + dx
        s.ell(x, py - 20, 34, 48, "#22303e", "#0f1720", 2)
        s.ell(x, py - 26, 24, 34, "#fdfdf6", None, 0)
        s.circ(x, py - 58, 20, "#22303e", "#0f1720", 1.8)
        s.ell(x, py - 52, 14, 11, "#fdfdf6", None, 0)
        s.circ(x - 6, py - 62, 2.4, INK)
        s.circ(x + 6, py - 62, 2.4, INK)
        s.poly([(x - 8, py - 54), (x + 8, py - 54), (x, py - 46)], "#f0912a", None, 0)
        s.path("M %s %s q 18 -10 34 0 l -4 12 l -26 0 Z" % (f(x - 18), f(py - 78)),
               hat, "#1b2a38", 1.6)
        s.text(x, py - 90, {"#e0392b": "红帽", "#2f6fb0": "蓝帽", "#3f9c3a": "绿帽"}[hat],
               11, hat, "middle", "800")
        if fish:
            s.ell(x + 34, py - 6, 20, 11, "#5b9bd5", "#2f5f8f", 1.4)
            s.poly([(x + 52, py - 6), (x + 66, py - 12), (x + 66, py)], "#5b9bd5", "#2f5f8f", 1.2)
            s.circ(x + 22, py - 8, 2, INK)
            s.text(x + 40, py + 22, "拿鱼", 11, "#1b4a7a", "middle", "800")
        if glasses:
            s.circ(x - 7, py - 62, 7.5, "none", "#1b2a38", 1.8)
            s.circ(x + 7, py - 62, 7.5, "none", "#1b2a38", 1.8)
            s.line(x - 1, py - 62, x + 1, py - 62, "#1b2a38", 1.6)
            s.text(x, py + 22, "戴眼镜", 11, INK, "middle", "800")
        s.ell(x - 14, py + 22, 12, 6, "#f0912a", None, 0)
        s.ell(x + 14, py + 22, 12, 6, "#f0912a", None, 0)
    s.text(px, py + 62, "左红帽 · 中蓝帽且拿鱼 · 右绿帽且戴眼镜", 13, INK, "middle", "700")


# =====================================================================
def draw_wake(s):
    marks = [("圆", "#e0392b"), ("星", "#2f6fb0"), ("圆", "#3f9c3a"),
             ("星", "#e0392b"), ("圆", "#2f6fb0"), ("星", "#3f9c3a")]
    s.text(2200, 700, "尾流标记（与糖果图标区分）", 15, INK, "middle", "800")
    for i, (shape, col) in enumerate(marks):
        x = 2100 + i * 62
        y = 756
        if shape == "圆":
            s.circ(x, y, 20, col, "#1b2a38", 1.4)
        else:
            s.star(x, y, 23, col, "#1b2a38", 1.4)
        s.text(x, y + 42, str(i + 1), 13, INK, "middle", "800")
    s.text(2200, 820, "红圆 · 蓝星 · 绿圆 · 红星 · 蓝圆 · 绿星", 14, INK, "middle", "700")


# =====================================================================
def draw_candy_rig(s):
    # 黑色糖果袋（挂在车把上，袋口收紧）
    barx, bary = BAR_INFO['bar']
    bagx, bagy = barx - 54, bary + 66
    s.path("M %s %s L %s %s L %s %s L %s %s"
           % (f(barx), f(bary), f(barx - 4), f(bary + 26),
              f(bagx + 62), f(bagy - 46), f(bagx + 62), f(bagy - 38)),
           "none", "#5b6b7d", 2.6)
    s.path("M %s %s C %s %s %s %s %s %s L %s %s C %s %s %s %s %s %s Z"
           % (f(bagx - 44), f(bagy - 40), f(bagx - 58), f(bagy + 10), f(bagx - 56), f(bagy + 60),
              f(bagx - 40), f(bagy + 92), f(bagx + 40), f(bagy + 92),
              f(bagx + 56), f(bagy + 60), f(bagx + 58), f(bagy + 10), f(bagx + 44), f(bagy - 40)),
           "#1b1b1f", "#000", 2.2)
    s.rect(bagx - 16, bagy - 54, 32, 18, "#3a3a44", "#000", 1.6, rx=4)
    s.line(bagx - 22, bagy - 44, bagx + 22, bagy - 34, "#c0392b", 3)
    s.line(bagx + 22, bagy - 44, bagx - 22, bagy - 34, "#c0392b", 3)
    s.text(bagx, bagy + 24, "黑袋", 15, "#f2f6fa", "middle", "800")
    s.text(bagx, bagy + 44, "袋口收紧", 12, "#e8c33c", "middle", "700")
    s.text(bagx, bagy + 68, "凭手感盲取", 11, "#c9d4de", "middle", "400")

    # 袋旁完整数量表标签
    tx, ty, tw, th = 150, 1880, 380, 214
    s.path("M %s %s Q %s %s %s %s" % (f(bagx - 46), f(bagy + 80), f(bagx - 200), f(bagy + 150), f(tx + tw - 10), f(ty + 30)), "none", "#5b6b7d", 2, dash="5 5")
    s.rect(tx, ty, tw, th, "#fdfdf6", INK, 2, rx=8)
    s.text(tx + tw / 2, ty + 24, "糖果数量表（完整数据）", 14, INK, "middle", "800")
    s.line(tx + 96, ty + 34, tx + 96, ty + 128, "#5b6b7d", 1.2)
    s.line(tx, ty + 128, tx + tw, ty + 128, "#5b6b7d", 1.2)
    s.line(tx, ty + 88, tx + tw, ty + 88, "#5b6b7d", 1.2)
    for i, h in enumerate(["苹果味", "桃子味", "西瓜味"]):
        s.text(tx + 146 + i * 76, ty + 62, h, 13, INK, "middle", "700")
    s.text(tx + 48, ty + 108, "圆形", 13, INK, "middle", "700")
    s.text(tx + 48, ty + 152, "五角星形", 13, INK, "middle", "700")
    for r, (row, y) in enumerate((("圆形", ty + 108), ("五角星形", ty + 152))):
        for c, v in enumerate(CANDY[r * 3: r * 3 + 3]):
            s.text(tx + 146 + c * 76, y, str(v[1]), 20, INK, "middle", "800")
    s.text(tx + tw / 2, ty + 184, "总和 %d" % CANDY_SUM, 14, "#1b7a4a", "middle", "800")

    # 对话气泡：明显指向鹈鹕嘴巴，只含十进制数字
    tipx, tipy = CHAIN - 102, PEL_CY - 104
    bx, by, bw, bh = 176, 1214, 252, 118
    s.path("M %s %s L %s %s L %s %s Z"
           % (f(bx + bw), f(by + bh * 0.30), f(tipx), f(tipy), f(bx + bw), f(by + bh * 0.86)),
           "#fdfdf6", INK, 2.6)
    s.rect(bx, by, bw, bh, "#fdfdf6", INK, 2.6, rx=16)
    s.text(bx + bw / 2, by + 80, str(N_CANDY), 64, "#c0392b", "middle", "800", family="monospace")
    s.text(bx + bw / 2, by + 110, "鹈鹕喊出的数值", 13, INK, "middle", "700")
    s.text(bx + bw / 2, by - 12, "气泡内只放十进制数字", 12, "#5b6b7d", "middle", "400")
    s.text(302, 1392, "最少取出几颗，", 15, INK, "middle", "700")
    s.block(302, 1418, ["才能保证得到", "「圆苹果 + 星桃子」或", "「圆桃子 + 星苹果」", "中的至少一组？"],
            14, 22, INK, "middle", "400")


# =====================================================================
def draw_border_stamps(s):
    s.rect(0, 0, W, H, "none", "#1f3b57", 10)
    s.rect(16, 16, W - 32, H - 32, "none", "#e0a92e", 2.4)
    s.text(W / 2, 44, "套娃形检验章：第 k 章写 k²（k = 1…8），外轮廓逐个缩小", 17, "#1f3b57", "middle", "800")
    y = 128
    for k in range(1, 9):
        h = 152 - (k - 1) * 11
        P.matryoshka(s, 96, y, h, k, "#e8c33c" if k % 2 else "#e0803a", "#f5d98a" if k % 2 else "#f2b98a")
        s.text(96, y + h / 2 + 44, "k=%d" % k, 12, "#7b1f13", "middle", "700")
        y += h * 0.80


# =====================================================================
def draw_verify_bar(s):
    vw, vh = 1500, 96
    vx, vy = (W - vw) / 2, H - 136
    s.rect(vx, vy, vw, vh, "#1f3b57", "#e0a92e", 3, rx=14)
    s.text(vx + vw / 2, vy + 30, "核 验 条 · 与实际图形及题目数据逐项吻合", 19, "#ffe9a8", "middle", "800")
    items = [("糖果六类数量总和", CANDY_6SUM), ("六孔金属板空孔数", EMPTY_HOLES),
             ("章鱼腕足数", ARMS), ("飞机发动机数", ENGINES)]
    cw = (vw - 60) / 4
    for i, (lb, v) in enumerate(items):
        x = vx + 30 + i * cw
        s.text(x + cw / 2, vy + 58, lb, 14, "#cfe0ee", "middle", "400")
        s.rect(x + cw / 2 - 42, vy + 64, 84, 26, "#0f2436", "#4a7fa0", 1.4, rx=5)
        s.text(x + cw / 2, vy + 83, str(v), 20, "#7ef0a8", "middle", "800", family="monospace")


# =====================================================================
def draw_title(s):
    s.text(W / 2, 88, "四发大型客机 · 高空巡航", 34, "#0f2436", "middle", "800")
    s.text(W / 2, 124, "承托链：飞机 → 机翼 → 鹈鹕(自行车) → 鹈鹕双翼 → 北极熊 → 秦始皇 → 冕板 → 龟 → 象 → 温室 → 苹果树 → 沙漏 → 章鱼 → 头盔 → 茶杯 → 灯塔 → 玻璃球（内含两层递归）",
           14, "#1f3b57", "middle", "600")
    s.text(2100, 200, "近侧机翼（画面左下）承托整条链", 15, "#0f2436", "start", "800")
    s.text(2100, 226, "远侧机翼仅承载发动机 3、4", 13, "#33424f", "start", "600")


if __name__ == "__main__":
    main()
