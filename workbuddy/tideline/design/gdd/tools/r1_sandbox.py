# -*- coding: utf-8 -*-
"""
R1 数值沙盘 · 深水 vs 浅滩冲浪路径 期望收益模型
《潮线 TIDELINE》 Phase 1 门控依据
"""
import io, itertools

L = 125.0            # 平均战利品价值 (泳客100 / 冲浪者150)
T_STALK = 8.0        # 潜行接近耗时
A_STALK = 5.0        # 潜行阶段 ALARM 增量
T_APPROACH = 5.0     # 追加目标时的接近耗时
A_APPROACH = 5.0     # 追加目标时的 ALARM 增量
T_DEEP = 14.0        # 深水返程耗时
A_DEEP_SLOPE = -2.0  # 深水返程 ALARM 斜率 /s
T_SURF = 15.0        # 冲浪返程耗时
A_SURF_SLOPE = 0.5   # 冲浪返程 ALARM 斜率 /s
DECAY_WAIT = 4.0     # 深海等待时 ALARM 衰减 /s
A0 = 0.0             # 稳态起始 ALARM（玩家可通过等待维持）
ALARM_CAP = 100.0

def clamp(x, lo, hi):
    return max(lo, min(hi, x))

def cycle(k, route, m_surf, A_grab, p_beach, expo, scale, cap):
    """返回一次完整循环（k 次捕食 + 返程 + 等待）的得分速率"""
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
    return dict(A_avg=A_avg, p=p, t_cycle=t_cycle, rate=rate, m=m, t_wait=t_wait)

def evaluate(m_surf, A_grab, p_beach, expo, scale, cap, ks=(1, 2, 3, 4)):
    rows = {}
    for k in ks:
        d = cycle(k, 'deep', m_surf, A_grab, p_beach, expo, scale, cap)
        s = cycle(k, 'surf', m_surf, A_grab, p_beach, expo, scale, cap)
        rows[k] = (d, s, s['rate'] / d['rate'] if d['rate'] > 0 else 0)
    # 最优押注数（两条路中取较优者）
    best_k = max(ks, key=lambda k: max(rows[k][0]['rate'], rows[k][1]['rate']))
    return rows, best_k

out = io.StringIO()
def w(s=''):
    out.write(s + '\n')

w('=' * 78)
w('R1 数值沙盘 · 深水 vs 浅滩冲浪路径')
w('=' * 78)
w('')
w('【模型假设】')
w('  L=%.0f  T_stalk=%.0fs(+%.0f ALARM)  追加目标 %.0fs(+%.0f ALARM)' % (L, T_STALK, A_STALK, T_APPROACH, A_APPROACH))
w('  深水返程 %.0fs  ALARM %.1f/s   冲浪返程 %.0fs  ALARM %+.1f/s' % (T_DEEP, A_DEEP_SLOPE, T_SURF, A_SURF_SLOPE))
w('  深海等待衰减 %.1f/s   ALARM 上限 %.0f' % (DECAY_WAIT, ALARM_CAP))
w('  得分速率 = L*k*m*(1-p)/T_cycle')
w('')
w('=' * 78)
w('【A】基准参数扫描：m_surf × A_grab（专家 p_beach=0.03）')
w('=' * 78)
w('')
w('%-6s %-6s | %-34s | %-8s' % ('m_surf', 'A_grab', '各 k 的 surf/deep 比值 (k=1..4)', '最优k'))
w('-' * 78)

results = []
for m_surf in [1.6, 1.8, 2.0, 2.2, 2.6, 3.0]:
    for A_grab in [15, 20, 25]:
        rows, best_k = evaluate(m_surf, A_grab, 0.03, 2.0, 0.60, 0.60)
        ratios = [rows[k][2] for k in (1, 2, 3, 4)]
        w('%-6.1f %-6d | %s | k=%d' % (m_surf, A_grab,
          '  '.join('%.2f' % r for r in ratios), best_k))
        results.append((m_surf, A_grab, ratios, best_k))

w('')
w('【筛选条件】')
w('  C1 低 ALARM 优势：ratio(k=1) >= 1.50')
w('  C2 高 ALARM 反超：存在 k 使 ratio(k) < 1.00   （深水在某些状态更优 → 无主导策略）')
w('  C3 押注有牙齿：最优 k >= 2                    （否则 Bank-or-Push 失效）')
w('')
w('%-6s %-6s | %-6s %-6s %-6s | 结论' % ('m_surf', 'A_grab', 'C1', 'C2', 'C3'))
w('-' * 78)
passing = []
for m_surf, A_grab, ratios, best_k in results:
    c1 = ratios[0] >= 1.50
    c2 = any(r < 1.00 for r in ratios)
    c3 = best_k >= 2
    ok = c1 and c2 and c3
    if ok:
        passing.append((m_surf, A_grab, ratios, best_k))
    w('%-6.1f %-6d | %-6s %-6s %-6s | %s' % (m_surf, A_grab,
      ('OK' if c1 else '--'), ('OK' if c2 else '--'), ('OK' if c3 else '--'),
      '*** 通过 ***' if ok else ''))

w('')
w('=' * 78)
w('【B】C1 与 C2 的互斥性验证（核心发现）')
w('=' * 78)
w('')
c1_only = [r for r in results if r[2][0] >= 1.50]
both = [r for r in results if r[2][0] >= 1.50 and any(x < 1.00 for x in r[2])]
w('  满足 C1（低 ALARM 优势 >=1.5x）的配置数：%d' % len(c1_only))
w('  同时满足 C1 与 C2 的配置数            ：%d' % len(both))
w('')
if passing:
    w('  ✅ 存在可行配置，两条路径可以平衡。推荐如下：')
    w('')
    for m_surf, A_grab, ratios, best_k in passing:
        w('     m_surf=%.1f  A_grab=%d   ratios(k=1..4)=%s   最优k=%d'
          % (m_surf, A_grab, ' / '.join('%.2f' % r for r in ratios), best_k))
else:
    w('  ⚠️ 在扫描范围内未找到同时满足三条的配置。')
w('')

# ---------- 选定配置的详细展开 ----------
if passing:
    m_surf, A_grab, ratios, best_k = passing[0]
    for pick in passing[:2]:
        m_surf, A_grab, ratios, best_k = pick
        w('=' * 78)
        w('【C】推荐配置详解：m_surf=%.1f, A_grab=%d' % (m_surf, A_grab))
        w('=' * 78)
        w('')
        for skill, pb in (('专家 (p_beach=0.03)', 0.03), ('新手 (p_beach=0.15)', 0.15)):
            w('  --- %s ---' % skill)
            w('  %-4s %-10s %-24s %-24s' % ('k', 'ALARM(avg)', '深水  速率(p)', '冲浪  速率(p)'))
            for k in (1, 2, 3, 4):
                d = cycle(k, 'deep', m_surf, A_grab, pb, 2.0, 0.60, 0.60)
                s = cycle(k, 'surf', m_surf, A_grab, pb, 2.0, 0.60, 0.60)
                w('  %-4d %-10.1f %-24s %-24s' % (
                    k, s['A_avg'],
                    '%.2f (p=%.3f)' % (d['rate'], d['p']),
                    '%.2f (p=%.3f)' % (s['rate'], s['p'])))
            rows, bk = evaluate(m_surf, A_grab, pb, 2.0, 0.60, 0.60)
            rs = [rows[k][2] for k in (1, 2, 3, 4)]
            w('  比值 surf/deep: %s   最优押注数 k=%d' % ('  '.join('%.2f' % r for r in rs), bk))
            w('')

# ---------- DECOY BREACH ----------
w('=' * 78)
w('【D】DECOY BREACH 验证：期望收益 <= 直冲 x 1.2')
w('=' * 78)
w('')
w('模型：重定向最多 2 个敌人；敌人停机 = 2.5s调查 + 2*往返/敌速')
w('      熟练操作可覆盖返程窗口约 60%%；代价 = -1体力 + ALARM +8')
w('')
def decoy_rate(k, m_surf, A_grab, p_beach, coverage=0.60, n_redirect=2, alarm_cost=8):
    base = cycle(k, 'surf', m_surf, A_grab, p_beach, 2.0, 0.60, 0.60)
    A = base['A_avg']
    n_enemies = max(1.0, A / 15.0)
    eff = min(n_redirect / n_enemies, 1.0)
    p_enemy = clamp(0.60 * ((A - 15.0) / 80.0) ** 2.0, 0.0, 0.60)
    p_new = clamp(p_beach + p_enemy * (1 - coverage * eff), 0.0, 0.95)
    t_wait_extra = alarm_cost / DECAY_WAIT
    t_cycle = base['t_cycle'] + t_wait_extra
    return (L * k) * m_surf * (1 - p_new) / t_cycle, base['rate'], p_new, base['p']

if passing:
    m_surf, A_grab, _, _ = passing[0]
    w('  %-4s %-12s %-12s %-10s %-8s' % ('k', '直冲速率', '诱饵速率', '比值', '判定'))
    w('  ' + '-' * 56)
    for k in (1, 2, 3, 4):
        dr, br, pn, pb0 = decoy_rate(k, m_surf, A_grab, 0.03)
        ratio = dr / br if br > 0 else 0
        w('  %-4d %-12.3f %-12.3f %-10.3f %-8s' % (
            k, br, dr, ratio, 'OK' if ratio <= 1.20 else '*** 超標 ***'))
    w('')

w('=' * 78)
w('【E】敏感性分析：哪些杠杆最影响比值')
w('=' * 78)
w('')
if passing:
    m0, g0, _, _ = passing[0]
    base_r1 = evaluate(m0, g0, 0.03, 2.0, 0.60, 0.60)[0][1][2]
    w('  基准 (m=%.1f, A_grab=%d, expo=2.0, scale=0.60): ratio(k=1)=%.3f' % (m0, g0, base_r1))
    w('')
    w('  %-34s %-10s %-10s' % ('变量', '新比值', '变化'))
    w('  ' + '-' * 56)
    tests = [
        ('m_surf +20%',  dict(m_surf=m0*1.2)),
        ('m_surf -20%',  dict(m_surf=m0*0.8)),
        ('A_grab +5',    dict(A_grab=g0+5)),
        ('A_grab -5',    dict(A_grab=g0-5)),
        ('死亡曲线 expo 2.0->1.5', dict(expo=1.5)),
        ('死亡曲线 expo 2.0->2.5', dict(expo=2.5)),
        ('冲浪 ALARM 斜率 0.5->1.5', dict(slope=1.5)),
        ('深海衰减 4->6 /s', dict(decay=6.0)),
    ]
    for name, kw in tests:
        mm = kw.get('m_surf', m0); gg = kw.get('A_grab', g0)
        ex = kw.get('expo', 2.0); sl = kw.get('slope', A_SURF_SLOPE)
        dc = kw.get('decay', DECAY_WAIT)
        globals()['A_SURF_SLOPE'] = sl
        globals()['DECAY_WAIT'] = dc
        r = evaluate(mm, gg, 0.03, ex, 0.60, 0.60)[0][1][2]
        globals()['A_SURF_SLOPE'] = 0.5
        globals()['DECAY_WAIT'] = 4.0
        w('  %-34s %-10.3f %+10.3f' % (name, r, r - base_r1))

w('')
w('=' * 78)
w('说明：本沙盘为一阶解析模型，参数均为假设值，未经 playtest 校准。')
w('=' * 78)

txt = out.getvalue()
with io.open(r'<案例工作目录>\design\gdd\_sandbox_out.txt', 'w', encoding='utf-8') as f:
    f.write(txt)
print('done')
