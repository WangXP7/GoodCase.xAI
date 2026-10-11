# -*- coding: utf-8 -*-
"""
R1 沙盘 · DECOY BREACH 判据修订后的 k=4 数值复核
==================================================
背景：
  原裁定「直升机 T3/T4 免疫」在 v1.4 被推翻，改为
  「有锁定系绳 → 免疫；无 → 受影响」。

  原 k=4 超标 1.25 是用「T3/T4 全免疫」修的。
  新判据下拖网渔船（T3a，水面，无系绳）不再免疫，
  因此需要复核：k=4 的比值是否仍 <= 1.2？

模型细化：
  原模型把敌人当作抽象整体： n_enemies = A/15
  新模型拆为两类：
    - 致命单位（直升机 T3b / 捕鲨队 T4）：恒带系绳 → 免疫
    - 非致命单位（漂浮垃圾 T1 / 救生员·摩托艇 T2 / 拖网渔船 T3a）：无系绳 → 可重定向
  诱饵只能削弱「非致命单位」贡献的那部分死亡概率。

  由于沙盘的 n_enemies = A/15 是抽象密度（A=100 时约 6.7 个），
  与 GDD-02 出场表的实体单位数（最多 3-4 个）不直接对应，
  本脚本不做单一假设，而是扫描致命占比的敏感性，给出结论的稳健区间。
"""
import io

# ---------- 复用沙盘常量 ----------
L = 125.0
T_STALK = 8.0
A_STALK = 5.0
T_APPROACH = 5.0
A_APPROACH = 5.0
T_DEEP = 14.0
A_DEEP_SLOPE = -2.0
T_SURF = 15.0
A_SURF_SLOPE = 0.5
DECAY_WAIT = 4.0
A0 = 0.0
ALARM_CAP = 100.0

M_SURF = 2.6      # 推荐配置
A_GRAB = 20       # 推荐配置
P_BEACH = 0.03    # 专家


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def cycle(k, route, m_surf, A_grab, p_beach, expo=2.0, scale=0.60, cap=0.60):
    """复现沙盘的 cycle()"""
    A_peak = clamp(A0 + A_STALK + k * A_grab + (k - 1) * A_APPROACH, 0, ALARM_CAP)
    if route == 'deep':
        t_ret = T_DEEP
        A_end = clamp(A_peak + A_DEEP_SLOPE * T_DEEP, 0, ALARM_CAP)
        A_avg = clamp(A_peak + A_DEEP_SLOPE * T_DEEP / 2.0, 0, ALARM_CAP)
        m = 1.0
        p = clamp((A_avg - 40.0) / 300.0, 0.0, 0.20)
    else:
        t_ret = T_SURF
        A_end = clamp(A_peak + A_SURF_SLOPE * T_SURF, 0, ALARM_CAP)
        A_avg = clamp(A_peak + A_SURF_SLOPE * T_SURF / 2.0, 0, ALARM_CAP)
        m = m_surf
        pen = clamp(scale * ((A_avg - 15.0) / 80.0) ** expo, 0.0, cap)
        p = clamp(p_beach + pen, 0.0, 0.95)
    t_wait = max(0.0, (A_end - A0) / DECAY_WAIT)
    t_cycle = T_STALK + (k - 1) * T_APPROACH + t_ret + t_wait
    rate = (L * k) * m * (1 - p) / t_cycle
    return dict(A_avg=A_avg, A_peak=A_peak, p=p, t_cycle=t_cycle, rate=rate, m=m)


def decoy_original(k, coverage=0.60, n_redirect=2, alarm_cost=8):
    """原模型：所有敌人都可被重定向（v1.3 旧判据）"""
    base = cycle(k, 'surf', M_SURF, A_GRAB, P_BEACH)
    A = base['A_avg']
    n_enemies = max(1.0, A / 15.0)
    eff = min(n_redirect / n_enemies, 1.0)
    p_enemy = clamp(0.60 * ((A - 15.0) / 80.0) ** 2.0, 0.0, 0.60)
    p_new = clamp(P_BEACH + p_enemy * (1 - coverage * eff), 0.0, 0.95)
    t_wait_extra = alarm_cost / DECAY_WAIT
    t_cycle = base['t_cycle'] + t_wait_extra
    rate = (L * k) * M_SURF * (1 - p_new) / t_cycle
    return rate, base['rate'], p_new, base['p'], A


def decoy_v2(k, fatal_ratio, coverage=0.60, n_redirect=2, alarm_cost=8):
    """新模型：致命单位免疫，只有非致命单位可被重定向

    fatal_ratio: 敌人中「致命单位」的占比（0=全非致命, 1=全致命）
    """
    base = cycle(k, 'surf', M_SURF, A_GRAB, P_BEACH)
    A = base['A_avg']
    n_enemies = max(1.0, A / 15.0)
    p_enemy = clamp(0.60 * ((A - 15.0) / 80.0) ** 2.0, 0.0, 0.60)

    # 拆分：致命部分免疫，非致命部分可被削弱
    p_lethal = p_enemy * fatal_ratio
    p_nonlethal = p_enemy * (1.0 - fatal_ratio)

    n_nonlethal = max(1.0, n_enemies * (1.0 - fatal_ratio))
    eff_nl = min(n_redirect / n_nonlethal, 1.0)

    p_new = clamp(P_BEACH + p_lethal + p_nonlethal * (1 - coverage * eff_nl), 0.0, 0.95)

    t_wait_extra = alarm_cost / DECAY_WAIT
    t_cycle = base['t_cycle'] + t_wait_extra
    rate = (L * k) * M_SURF * (1 - p_new) / t_cycle
    return rate, base['rate'], p_new, base['p'], A


def fatal_ratio_by_alarm(A):
    """按 GDD-02 出场表推断致命单位占比

    T0/T1/T2 (A<75)  : 无致命单位                      -> 0.00
    T3      (75-89)  : 直升机(致命) + 拖网渔船(非致命)   -> 0.50
    T4      (>=90)   : + 捕鲨队(致命)                   -> 0.67
    """
    if A < 75:
        return 0.0
    elif A < 90:
        return 0.5
    else:
        return 2.0 / 3.0


out = io.StringIO()


def w(s=''):
    out.write(s + '\n')


w('=' * 80)
w('DECOY BREACH · 判据修订后 k=4 数值复核')
w('配置 m_surf=%.1f  A_grab=%d  p_beach=%.2f（专家）' % (M_SURF, A_GRAB, P_BEACH))
w('=' * 80)
w('')

# ---- 1. 复现原模型（校验脚本正确性）----
w('【1】复现原模型（校验用，应 = 沙盘 §4 表格）')
w('%s' % '-' * 80)
w('  %-4s %-12s %-12s %-10s %-8s' % ('k', '直冲速率', '诱饵速率', '比值', '判定'))
for k in (1, 2, 3, 4):
    dr, br, pn, pb, A = decoy_original(k)
    ratio = dr / br if br > 0 else 0
    w('  %-4d %-12.3f %-12.3f %-10.3f %-8s' % (
        k, br, dr, ratio, 'OK' if ratio <= 1.20 else '*** 超标 ***'))
w('')

# ---- 2. 按 ALARM 推断致命占比，算出各 k 的比值 ----
w('【2】新判据下（致命占比按出场表推断）')
w('%s' % '-' * 80)
w('  %-4s %-9s %-9s %-12s %-12s %-10s %-8s' % (
    'k', 'ALARM', '致命占比', '直冲速率', '诱饵速率', '比值', '判定'))
for k in (1, 2, 3, 4):
    _, br, _, _, A = decoy_original(k)
    fr = fatal_ratio_by_alarm(A)
    dr, br2, pn, pb, A2 = decoy_v2(k, fr)
    ratio = dr / br2 if br2 > 0 else 0
    w('  %-4d %-9.1f %-9.2f %-12.3f %-12.3f %-10.3f %-8s' % (
        k, A, fr, br2, dr, ratio, 'OK' if ratio <= 1.20 else '*** 超标 ***'))
w('')

# ---- 3. 敏感性扫描：致命占比从 0 到 1 ----
w('【3】敏感性扫描 · k=4 的比值随致命占比变化')
w('%s' % '-' * 80)
w('  %-12s %-12s %-10s %-8s' % ('致命占比', '诱饵速率', '比值', '判定'))
for fr in (0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 2 / 3, 0.75, 0.9, 1.0):
    dr, br, pn, pb, A = decoy_v2(4, fr)
    ratio = dr / br if br > 0 else 0
    w('  %-12.2f %-12.3f %-10.3f %-8s' % (
        fr, dr, ratio, 'OK' if ratio <= 1.20 else '*** 超标 ***'))
w('')

# ---- 4. 同理看 k=3 ----
w('【4】敏感性扫描 · k=3 的比值随致命占比变化（确认技巧不被误伤）')
w('%s' % '-' * 80)
w('  %-12s %-12s %-10s %-8s' % ('致命占比', '诱饵速率', '比值', '判定'))
for fr in (0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 2 / 3, 0.75, 0.9, 1.0):
    dr, br, pn, pb, A = decoy_v2(3, fr)
    ratio = dr / br if br > 0 else 0
    w('  %-12.2f %-12.3f %-10.3f %-8s' % (
        fr, dr, ratio, 'OK' if ratio <= 1.20 else '*** 超标 ***'))
w('')

# ---- 5. 结论 ----
w('【5】结论')
w('%s' % '-' * 80)

_, br4, _, _, A4 = decoy_original(4)
fr4 = fatal_ratio_by_alarm(A4)
dr4, _, _, _, _ = decoy_v2(4, fr4)
r4 = dr4 / br4

# 找临界致命占比
threshold = None
for i in range(0, 101):
    fr = i / 100.0
    dr, br, _, _, _ = decoy_v2(4, fr)
    if dr / br <= 1.20:
        threshold = fr
        break

w('  k=4 时 ALARM = %.1f → 致命占比 = %.2f' % (A4, fr4))
w('  该情形下诱饵/直冲比值 = %.3f  → %s' % (r4, '达标' if r4 <= 1.20 else '超标'))
w('')
if threshold is not None:
    w('  临界致命占比 = %.2f（致命单位占比 >= 此值时 k=4 达标）' % threshold)
    w('  出场表推断的 %.2f 已%s该临界值' % (fr4, '超过' if fr4 >= threshold else '低于'))
w('')

print(out.getvalue())

with open('decoy_k4_result.txt', 'w', encoding='utf-8') as f:
    f.write(out.getvalue())
