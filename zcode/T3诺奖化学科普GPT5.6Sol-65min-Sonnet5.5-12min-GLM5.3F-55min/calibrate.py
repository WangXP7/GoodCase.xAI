# 手性放大实验台（手性放大实验台.html）的 Python 复核脚本
# 模型：Frank (1953) 思路的教学模型 —— 自催化 + 固有对映选择性 eemax + 异手封存 q（储库机制）
# 接力语义与页面一致：取上一批产物作下一批催化剂（保留 ee），按相同浓度标准投料再加 A0eq 当量前体
# 所有参数均为教学示意，未对真实 Soai 反应实验数据拟合（真实体系涉及锌醇盐四聚体等，见 00 文档）
import random

def run_batch(ee0, q, eemax, sigma, kappa=0.5, A0eq=30.0, seed=1,
              scale=100000.0, steps=24000, dt=0.0005, k0=0.001):
    rng = random.Random(seed)
    R = scale/2*(1+ee0/100); D = scale/2*(1-ee0/100); A = A0eq*scale
    for i in range(steps):
        m = min(R, D)
        Ra, Da = R - q*m, D - q*m                     # 异手封存：少数派被惰性复合物锁住
        f = (A/scale)*kappa
        base = (A/scale)*k0/2                          # 非手性本底（供 ee0=0 时随机涨落起步）
        pR = f*(Ra*(1+eemax)/2 + Da*(1-eemax)/2) + base
        pD = f*(Da*(1+eemax)/2 + Ra*(1-eemax)/2) + base
        nR = sigma*pR*rng.gauss(0,1) if sigma > 0 else 0.0   # 统计涨落 ∝ 各自产量
        nD = sigma*pD*rng.gauss(0,1) if sigma > 0 else 0.0
        R = max(0.0, R + (pR+nR)*dt); D = max(0.0, D + (pD+nD)*dt)
        A -= (pR+pD)*dt
        if A <= scale*1e-6:                            # 指数衰减不会精确归零，按实用阈值判定耗尽
            A = 0; break
    return 100*(R-D)/(R+D)

def relay(ee0, q, eemax, sigma, n, A0eq, seed=1, kappa=0.5):
    ees = [ee0]; e = ee0
    for b in range(n):
        e = run_batch(ee0=e, q=q, eemax=eemax, sigma=sigma, A0eq=A0eq, seed=seed+b, kappa=kappa)
        ees.append(e)
    return ees

if __name__ == '__main__':
    # 页面五个预设情景（与 HTML 内置参数一致）
    print('P1 Soai1995示意 :', [round(x,1) for x in relay(5,       0.50, 0.95,  0,   3, 80)])  # 期望 ~[52.9, 84.0, 89.2]
    print('P2 无中生有    :', [round(x,2) for x in relay(0.00005, 0.95, 0.998, 0,   3, 30)])  # 期望 ~[91.9, 99.5, 99.8]
    print('P3 完美复印机  :', [round(x,4) for x in relay(0.1,     0,    1.0,   0,   3, 30)])  # 期望恒 0.1
    print('P4 复印走样    :', [round(x,1) for x in relay(86,      0,    0.5,   0,   3, 5)])   # 期望 ~[34.8, 14.2, 5.8]
    wins = {'R': 0, 'D': 0}
    for s in range(1, 21):
        e = run_batch(ee0=0, q=0.95, eemax=0.998, sigma=0.2, A0eq=30, seed=s)
        wins['R' if e > 0 else 'D'] += 1
    print('P5 随机破缺 20 种子获胜者分布:', wins)  # 期望接近 R:D = 11:9（对称）
