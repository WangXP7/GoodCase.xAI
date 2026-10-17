# -*- coding: utf-8 -*-
"""
R1 数值沙盘 · 修正版（= 用真实代码实测到的死亡模型，替换 R1 的猜测模型）
《潮线 TIDELINE》 PH6-QA-003 后续 · 主理人问题 (3)

------------------------------------------------------------------
为什么需要修正版（三处被实测证伪的 R1 假设）：
  R1 原版把死亡建模成两条"平滑概率"：
    · 深水    p_deep(A) = clamp((A-40)/300, 0, 0.20)     ← 上限 0.20 的平滑曲线
    · 冲浪    p_beach   = 0.03(专家) / 0.15(新手)         ← 平滑"技巧曲线"
  真实代码（tests/bot-playtest.js 1400 局）实测：
    · 搁浅致死 p_beach = 0.000（≥2.4 次/s 连打即可 100% 脱困）；
      其形状是"2.4 次/s 附近的**二值悬崖**"，不是平滑曲线。
    · 100% 的死亡 = **tier-3 直升机系绳**，且它也是**悬崖**：
      ALARM ≥ 75 → 直升机出场 → 可观测满 3.0s 即死（唯一解法 = 3s 内钻到深海）。
      实测：k=1 从不跨 75（0 死）；k=2 跨 75 后 155/200 死（≈77.5%）；
      冲浪路线同档 166/200 死（≈83%）——**深/冲两路死亡率几乎相同**。

修正版只做一件事：把上面两条"悬崖"写进 cycle()，其余结构（L / T_* / A_* /
t_wait / 得分速率公式）与 R1 完全一致，以便**同口径**重推 C1/C2/C3。
本脚本**不改动 src/**，也不改动 R1 原脚本；它是一个独立的复核沙盘。
------------------------------------------------------------------
"""
import io, sys, json

# ---- 可调候选常数（vince-coyer 改完数值后，用 CLI 开关复跑本沙盘即得新判定）----
def _arg(name, default):
    pre = '--' + name + '='
    for a in sys.argv[1:]:
        if a.startswith(pre):
            return float(a[len(pre):])
    return default

CFG = {
    'm_surf':    _arg('m_surf', 1.1),     # 冲浪路线战利品倍率（= 1 + 0.2×每次返程收集数）
    'A_grab':    _arg('A_grab', 41.0),    # 每次捕食 ALARM 增量（R1 用 20；真实代码约当 41）
    'P75_deep':  _arg('P75_deep', 0.775), # 跨 75 悬崖后的深水致死率（实测 155/200）
    'P75_surf':  _arg('P75_surf', 0.830), # 跨 75 悬崖后的冲浪致死率（实测 166/200）
    'qte_hz':    _arg('qte_hz', 2.4),     # QTE 逃脱门槛（次/s）—— 改 QTE 机制后务必重设
    'tap_hz':    _arg('tap_hz', 6.0),     # 玩家连打频率（用于 p_beach 悬崖判定）
    'target_c1': _arg('target_c1', 1.5),  # C1 目标比值
    'target_k':  _arg('target_k', 2),     # C3 目标最优 k
}

# ---- 与 R1 完全一致的结构常量 ----
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

# ---- 修正：来自真实代码的死亡模型（替换 R1 的平滑概率）----
TETHER_TRIG = 75.0      # game.js / entities.js：ALARM>=75 → tier3 直升机（hasTether 恒真）
P75_DEEP = CFG['P75_deep']   # 实测 balanced  k=2 (A_peak≈92)：155/200
P75_SURF = CFG['P75_surf']   # 实测 surf_balanced k=2：166/200
QTE_HZ = CFG['qte_hz']       # 实测逃脱门槛 = QTE.NEED/QTE.WINDOW = 6/2.5（≥此频率 → p_beach=0）
M_SURF = CFG['m_surf']
A_GRAB = CFG['A_grab']
TAP_HZ = CFG['tap_hz']

def clamp(x, lo, hi):
    return max(lo, min(hi, x))

def cycle(k, route, m_surf, A_grab, tap_hz):
    """修正版循环：死亡 = tether 悬崖（+ 冲浪路线的 beaching 悬崖）"""
    A_peak = clamp(A0 + A_STALK + k * A_grab + (k - 1) * A_APPROACH, 0, ALARM_CAP)
    if route == 'deep':
        t_ret = T_DEEP
        A_end = clamp(A_peak + A_DEEP_SLOPE * T_DEEP, 0, ALARM_CAP)
        m = 1.0
        p_beach = 0.0
        p_tether = 0.0 if A_peak < TETHER_TRIG else P75_DEEP
    else:
        t_ret = T_SURF
        A_end = clamp(A_peak + A_SURF_SLOPE * T_SURF, 0, ALARM_CAP)
        m = m_surf
        p_beach = 0.0 if tap_hz >= QTE_HZ else 1.0          # 二值悬崖
        p_tether = 0.0 if A_peak < TETHER_TRIG else P75_SURF
    p = 1.0 - (1.0 - p_beach) * (1.0 - p_tether)
    t_wait = max(0.0, (A_end - A0) / DECAY_WAIT)
    t_cycle = T_STALK + (k - 1) * T_APPROACH + t_ret + t_wait
    rate = (L * k) * m * (1 - p) / t_cycle
    return dict(A_peak=A_peak, p=p, p_beach=p_beach, p_tether=p_tether,
                t_cycle=t_cycle, rate=rate, m=m)

def evaluate(m_surf, A_grab, tap_hz=6.0, ks=(1, 2, 3, 4)):
    rows = {}
    for k in ks:
        d = cycle(k, 'deep', m_surf, A_grab, tap_hz)
        s = cycle(k, 'surf', m_surf, A_grab, tap_hz)
        rows[k] = (d, s, (s['rate'] / d['rate']) if d['rate'] > 0 else 0.0)
    best_k = max(ks, key=lambda k: max(rows[k][0]['rate'], rows[k][1]['rate']))
    best_rate = max(rows[best_k][0]['rate'], rows[best_k][1]['rate'])
    return rows, best_k, best_rate

def first_cross_k(A_grab, ks=(1, 2, 3, 4)):
    """最小的、使 A_peak>=75（踩上 tether 悬崖）的 k"""
    for k in ks:
        A_peak = clamp(A_STALK + k * A_grab + (k - 1) * A_APPROACH, 0, ALARM_CAP)
        if A_peak >= TETHER_TRIG:
            return k, A_peak
    return None, None

out = io.StringIO()
def w(s=''):
    out.write(s + '\n')

w('=' * 78)
w('R1 数值沙盘 · 修正版（真实代码死亡模型：tether 悬崖 + beaching 悬崖）')
w('=' * 78)
w('')
w('【修正点】')
w('  · 深水 p_deep 平滑曲线 → 删除；改为 tether 悬崖：A_peak<75 → 0，否则 %.3f' % P75_DEEP)
w('  · 冲浪 p_beach 0.03/0.15 → 删除；改为二值悬崖：连打>=%.1f 次/s → 0，否则 1.0' % QTE_HZ)
w('  · 冲浪路线 P75 = %.3f（深/冲两路死亡率几乎相同，实测 0.775 vs 0.830）' % P75_SURF)
w('  · A_peak(k, A_grab) = 5 + k*A_grab + 5*(k-1)   （与 R1 同式）')
w('')

# ---------- 【A】直击主理人问题：R1 原参数(A_grab=20, m_surf=2.6) ----------
w('=' * 78)
w('【A】用 R1 原参数(A_grab=20) 跑修正模型')
w('=' * 78)
w('')
kc, apkc = first_cross_k(20)
w('  R1 的 A_grab=20 → A_peak(k)=%s' % ', '.join('k%d:%d' % (k, clamp(5 + k * 20 + 5 * (k - 1), 0, 100)) for k in (1, 2, 3, 4)))
w('  首次踩上 tether 悬崖（A_peak>=75）的 k = %s（A_peak=%d）' % (kc, apkc))
w('  （注：R1 建议 A_grab=20 → 75/20=3.75，即 k>=4 才踩线；这是 R1 与真实代码的关键分歧）')
w('')

w('  C1 检查（低 ALARM 冲浪 >= 深水 × 1.5，取 k=1）：')
w('  %-10s %-10s %-12s %-12s %-10s %-6s' % ('m_surf', '深水k=1', '冲浪k=1', '比值(冲/深)', 'C1(>=1.5)', '来源'))
src_note = {1.1: '实测约当(§4.4)', 2.6: 'R1 假设'}
for m_surf in [1.1, 1.5, 2.0, 2.6]:
    rows, bk, br = evaluate(m_surf, 20)
    ratio1 = rows[1][2]
    w('  %-10.1f %-10.3f %-12.3f %-12.3f %-10s %-6s' % (
        m_surf, rows[1][0]['rate'], rows[1][1]['rate'], ratio1,
        'OK' if ratio1 >= 1.5 else '--', src_note.get(m_surf, '')))
w('  → C1 需要 m_surf >= %.2f；实测冲浪只收 ~0.5 个/返程 → m_surf ≈ 1.1' %
  (1.5 / (evaluate(1.0, 20)[0][1][2])))   # ratio 与 m_surf 线性：ratio = m_surf * f
w('')
w('  C3 检查（全局最优 k >= 2）：')
for m_surf in [1.1, 2.6]:
    rows, bk, br = evaluate(m_surf, 20)
    w('    m_surf=%.1f：各 k 的 max(深,冲) 速率 = %s → 最优 k=%d  %s' % (
        m_surf,
        ', '.join('k%d:%.2f' % (k, max(rows[k][0]['rate'], rows[k][1]['rate'])) for k in (1, 2, 3, 4)),
        bk, 'C3 OK' if bk >= 2 else 'C3 --'))
w('')

# ---------- 【B】把 A_grab 对齐真实代码（真实在 k=2 就踩线）----------
w('=' * 78)
w('【B】把 ALARM 对齐真实代码：真实代码 k=2 就跨 75（实测 maxAlarm≈92）')
w('=' * 78)
w('')
w('  反推：A_peak(2) = 5 + 2*A_grab + 5 = 92  →  A_grab ≈ 41')
w('  %-10s %-14s %-10s %-12s' % ('A_grab', 'A_peak(k1..k4)', '首踩线k', '最优k'))
for A_grab in [20, 30, 41, 45]:
    kc2, ap = first_cross_k(A_grab)
    rows, bk, br = evaluate(1.1, A_grab)
    w('  %-10d %-14s %-10s %-12s' % (
        A_grab,
        ','.join(str(clamp(5 + k * A_grab + 5 * (k - 1), 0, 100)) for k in (1, 2, 3, 4)),
        ('k=%d' % kc2) if kc2 else '>4',
        'k=%d %s' % (bk, '(C3 OK)' if bk >= 2 else '(C3 --)')))
w('')
w('  → 关键发现：C3 是否成立，完全取决于「首次踩上 75 悬崖的 k」。')
w('     · 若 A_grab=20（R1）→ 首踩线在 k>=4 → 最优 k=2~3 → C3 表面成立')
w('     · 若 A_grab≈41（真实代码 k=2 就踩线）→ k>=2 全部落崖 → 最优 k=1 → C3 证伪')
w('    真实代码属后者（balanced k=2 死亡 155/200）→ **C3 证伪**。')
w('')

# ---------- 【C】与真实 bot 结果并排 ----------
w('=' * 78)
w('【C】修正沙盘 vs 真实 bot 实测（同口径：得分速率随 k 的走向）')
w('=' * 78)
w('')
w('  %-6s %-22s %-22s' % ('k', '修正沙盘最优速率(A_grab=41)', '真实 bot 实测(分/s)'))
real = {1: ('conservative', 19.41), 2: ('smart_k2', 11.53), 3: ('smart_k3', 8.27), 4: ('aggressive', 2.66)}
rows41, bk41, br41 = evaluate(1.1, 41)
for k in (1, 2, 3, 4):
    model_max = max(rows41[k][0]['rate'], rows41[k][1]['rate'])
    w('  %-6d %-22.3f %-22s' % (k, model_max, '%s %.2f' % real[k]))
w('  （绝对值不可比：R1 的 T_* 行程时间是假设值，实测整循环短得多——')
w('    见 bot 报告 §4.5。可比的是「随 k 的走向」：两列都随 k 单调下降。）')
w('')
w('  修正沙盘(A_grab=41)：最优 k=%d，速率 %.3f' % (bk41, br41))
w('  真实 bot 实测 ：最优 k=1（19.41 > 11.53 > 8.27 > 2.66）')
w('  → **两者一致：最优 k=1**。')
w('')

# ---------- 【D】C1/C2/C3 最终判定 ----------
w('=' * 78)
w('【D】修正模型下的 C1 / C2 / C3 判定')
w('=' * 78)
w('')
rows_real, bk_real, _ = evaluate(1.1, 41)
r1 = rows_real[1][2]
c1 = r1 >= 1.5
c2 = any(rows_real[k][2] < 1.0 for k in (1, 2, 3, 4))
c3 = bk_real >= 2
w('  C1（低 ALARM 冲浪 >= 深水×1.5）：k=1 比值 = %.3f  → %s' % (r1, 'OK' if c1 else '**证伪**'))
w('     原因：C1 的唯一来源是 m_surf；实测 m_surf≈1.1（需 >=2.12）→ 比值≈0.78 <1.5。')
w('  C2（存在 k 使深水反超，比值<1.0）：修正模型 k=1..4 比值 = %s  → %s' % (
    ', '.join('k%d:%.2f' % (k, rows_real[k][2]) for k in (1, 2, 3, 4)),
    'OK' if c2 else '--'))
w('  C3（全局最优 k>=2）：最优 k=%d  → %s' % (bk_real, 'OK' if c3 else '**证伪**'))
w('     原因：真实代码 k=2 即跨 75 悬崖 → k>=2 近乎必死 → 最优 k=1。')
w('')
w('=' * 78)
w('一句话：即使把 R1 的死亡模型换成真实代码的「悬崖」模型，')
w('        C1 与 C3 **仍然不成立**（C1 因 m_surf 不兑现；C3 因 75 悬崖落在 k=2）。')
w('        故 R1 的 C1 / C3 判定为「已证伪」(refuted)。')
w('=' * 78)

# ---------- 【E】当前候选常数下的验收门判定（供 vince-coyer 迭代常数）----------
w('=' * 78)
w('【E】★ 当前候选常数下的验收门判定（模型层）')
w('=' * 78)
w('')
w('  候选常数：m_surf=%.3f  A_grab=%.1f  P75_deep=%.3f  P75_surf=%.3f  qte_hz=%.2f  tap_hz=%.2f' % (
    M_SURF, A_GRAB, P75_DEEP, P75_SURF, QTE_HZ, TAP_HZ))
rows_c, bk_c, br_c = evaluate(M_SURF, A_GRAB, TAP_HZ)
c1_c = rows_c[1][2]
c1_pass = c1_c >= CFG['target_c1']
# 显著：最优 k 的速率 ≥ 1.15 × 最佳 k=1 速率
bestk1_rate = rows_c[1][0]['rate']
bestrate_c = max(rows_c[bk_c][0]['rate'], rows_c[bk_c][1]['rate'])
margin_c = (bestrate_c / bestk1_rate) if bestk1_rate > 0 else 0.0
c3_pass = (bk_c >= CFG['target_k']) and (margin_c >= 1.15)
w('  C1（k=1 冲浪/深水）= %.3f   目标 ≥ %.2f   → %s' % (c1_c, CFG['target_c1'], 'PASS' if c1_pass else 'FAIL'))
w('  C3（最优 k）= %d           目标 ≥ %d   倍数=%.3f(≥1.15)   → %s' % (
    bk_c, CFG['target_k'], margin_c, 'PASS' if c3_pass else 'FAIL'))
w('')
w('  ═══════ 模型层验收门总判定: %s ═══════' % ('PASS' if (c1_pass and c3_pass) else 'FAIL'))
w('  （改动前基线预期 FAIL；改完常数后用同一条命令复跑应转 PASS。）')
w('  复跑： python design/gdd/tools/r1_sandbox_corrected.py --m_surf=<x> --A_grab=<y> [...]')
w('')
w('=' * 78)

# 机器可读判定
try:
    cfgj = {
        'cfg': CFG, 'c1': c1_c, 'c1Pass': bool(c1_pass),
        'c3BestK': int(bk_c), 'c3Margin': margin_c, 'c3Pass': bool(c3_pass),
        'overall': bool(c1_pass and c3_pass),
        'rates': {str(k): max(rows_c[k][0]['rate'], rows_c[k][1]['rate']) for k in rows_c}
    }
    with io.open(r'D:\68.AIGC\xWorkBuddy\GoodCase\tideline\tests\_bot-out\r1-model-gate.json', 'w', encoding='utf-8') as fj:
        fj.write(json.dumps(cfgj, ensure_ascii=False, indent=2))
except Exception as _e:
    pass

txt = out.getvalue()
with io.open(r'D:\68.AIGC\xWorkBuddy\GoodCase\tideline\tests\_bot-out\r1-corrected-out.txt', 'w', encoding='utf-8') as f:
    f.write(txt)
# 同时把纯文本打到 stdout（供重定向）
try:
    print(txt)
except Exception:
    pass
