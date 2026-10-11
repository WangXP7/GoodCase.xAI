# -*- coding: utf-8 -*-
"""
DECOY BREACH · k=4 超标修复方案对比
====================================
问题：新判据（系绳免疫）下，k=4 比值仍为 1.252 > 1.2 验收线。
      致命占比需 >= 0.76 才达标，出场表推断仅 0.67。

目标：找一组参数，使
      (a) k=4 比值 <= 1.20        （防主导策略）
      (b) k=3 比值 仍 > 1.00      （技巧不能失效）
      (c) k=1 比值 仍 < 1.00      （低压力时诱饵略亏的设计意图）
      (d) 尽量用主题化手段，少动数值
"""
import io

L = 125.0
T_STALK = 8.0
A_STALK = 5.0
T_APPROACH = 5.0
A_APPROACH = 5.0
T_SURF = 15.0
A_SURF_SLOPE = 0.5
DECAY_WAIT = 4.0
A0 = 0.0
ALARM_CAP = 100.0

M_SURF = 2.6
A_GRAB = 20
P_BEACH = 0.03
FATAL_AT_4 = 2.0 / 3.0
FATAL_AT_3 = 0.5


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def base_cycle(k):
    A_peak = clamp(A0 + A_STALK + k * A_GRAB + (k - 1) * A_APPROACH, 0, ALARM_CAP)
    A_end = clamp(A_peak + A_SURF_SLOPE * T_SURF, 0, ALARM_CAP)
    A_avg = clamp(A_peak + A_SURF_SLOPE * T_SURF / 2.0, 0, ALARM_CAP)
    pen = clamp(0.60 * ((A_avg - 15.0) / 80.0) ** 2.0, 0.0, 0.60)
    p = clamp(P_BEACH + pen, 0.0, 0.95)
    t_wait = max(0.0, (A_end - A0) / DECAY_WAIT)
    t_cycle = T_STALK + (k - 1) * T_APPROACH + T_SURF + t_wait
    rate = (L * k) * M_SURF * (1 - p) / t_cycle
    return dict(A_avg=A_avg, p=p, t_cycle=t_cycle, rate=rate)


A_GRAB = 20


def decoy(k, fatal_ratio, coverage=0.60, n_redirect=2, alarm_cost=8,
          trawler_dull=1.0):
    """trawler_dull: 拖网渔船迟钝系数（1.0=正常, <1=反应迟钝）

    主题化手段：拖网渔船体型大、转向慢 → 被引开后到位更慢，
    有效覆盖窗口按此系数折减。这比加数值更可教学。
    """
    b = base_cycle(k)
    A = b['A_avg']
    n_enemies = max(1.0, A / 15.0)
    p_enemy = clamp(0.60 * ((A - 15.0) / 80.0) ** 2.0, 0.0, 0.60)

    p_lethal = p_enemy * fatal_ratio
    p_nonlethal = p_enemy * (1.0 - fatal_ratio)

    n_nonlethal = max(1.0, n_enemies * (1.0 - fatal_ratio))
    eff_nl = min(n_redirect / n_nonlethal, 1.0)

    # 非致命单位中，拖网渔船部分按迟钝系数折减
    p_new = clamp(P_BEACH + p_lethal
                  + p_nonlethal * (1 - coverage * eff_nl * trawler_dull),
                  0.0, 0.95)

    t_cycle = b['t_cycle'] + alarm_cost / DECAY_WAIT
    rate = (L * k) * M_SURF * (1 - p_new) / t_cycle
    return rate / b['rate'] if b['rate'] > 0 else 0


def fatal_for(k, A):
    if A < 75:
        return 0.0
    elif A < 90:
        return 0.5
    else:
        return 2.0 / 3.0


def evaluate(label, **kw):
    """返回各 k 的比值"""
    ratios = {}
    for k in (1, 2, 3, 4):
        b = base_cycle(k)
        fr = fatal_for(k, b['A_avg'])
        ratios[k] = decoy(k, fr, **kw)
    return label, ratios


schemes = [
    ("① 基准（无修复）", dict()),
    ("② ALARM 代价 +8→+12", dict(alarm_cost=12)),
    ("③ ALARM 代价 +8→+16", dict(alarm_cost=16)),
    ("④ ALARM 代价 +8→+20", dict(alarm_cost=20)),
    ("⑤ 覆盖率 60%→50%", dict(coverage=0.50)),
    ("⑥ 覆盖率 60%→45%", dict(coverage=0.45)),
    ("⑦ 重定向上限 2→1", dict(n_redirect=1)),
    ("⑧ 拖网迟钝 ×0.6", dict(trawler_dull=0.6)),
    ("⑨ 拖网迟钝 ×0.4", dict(trawler_dull=0.4)),
    ("⑩ 拖网迟钝 ×0.5 + ALARM+12", dict(trawler_dull=0.5, alarm_cost=12)),
    ("⑪ 拖网迟钝 ×0.6 + 覆盖率 55%", dict(trawler_dull=0.6, coverage=0.55)),
    ("⑫ 覆盖率 50% + ALARM+12", dict(coverage=0.50, alarm_cost=12)),
]

out = io.StringIO()


def w(s=''):
    out.write(s + '\n')


w('=' * 92)
w('DECOY BREACH · k=4 超标修复方案对比（专家 p_beach=0.03）')
w('=' * 92)
w('')
w('%-32s %-8s %-8s %-8s %-8s %-10s' % ('方案', 'k=1', 'k=2', 'k=3', 'k=4', '综合判定'))
w('-' * 92)

best = []
for label, kw in schemes:
    _, r = evaluate(label, **kw)
    ok4 = r[4] <= 1.20
    ok3 = r[3] > 1.00
    ok1 = r[1] < 1.00
    verdict = 'OK' if (ok4 and ok3 and ok1) else ('k4超标' if not ok4 else '误伤技巧')
    w('%-32s %-8.3f %-8.3f %-8.3f %-8.3f %-10s' % (
        label, r[1], r[2], r[3], r[4], verdict))
    if ok4 and ok3 and ok1:
        best.append((label, r))

w('')
w('【约束】')
w('  (a) k=4 <= 1.20  防主导策略（硬）')
w('  (b) k=3  >  1.00  技巧不失效（软，但重要）')
w('  (c) k=1  <  1.00  低压力时诱饵略亏的设计意图（软）')
w('')
if best:
    w('【达标方案】')
    for label, r in best:
        w('  ✅ %s  → k1=%.3f k2=%.3f k3=%.3f k4=%.3f' % (
            label, r[1], r[2], r[3], r[4]))
else:
    w('  ⚠️ 无方案同时满足全部三条约束')

print(out.getvalue())
with open('decoy_fix_compare.txt', 'w', encoding='utf-8') as f:
    f.write(out.getvalue())
