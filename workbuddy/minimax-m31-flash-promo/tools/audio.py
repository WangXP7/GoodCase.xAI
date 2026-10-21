# -*- coding: utf-8 -*-
"""
MINIMAX M3.1 FLASH · 宣传片配乐合成
-----------------------------------
纯 numpy/scipy 程序化生成一条 40s 立体声配乐，完全不使用采样素材。
结构：低频 drone 床 + 场景落点冲击 + 光爆前 riser + 高频玻璃质感点缀 + 合成混响。
输出: soundtrack.wav (44.1kHz / 16bit / stereo)
"""
import numpy as np
from scipy import signal
import wave
import os

SR = 44100
DUR = 40.0
N = int(SR * DUR)
rng = np.random.default_rng(20260928)

# 场景落点（与 promo.html 的 CUTS 严格对齐）
CUTS = [4.0, 11.0, 19.0, 27.0, 33.0]
CUT_GAIN = [0.62, 1.0, 0.78, 0.80, 1.06]


def tt(dur):
    return np.arange(int(dur * SR)) / SR


def env_exp(dur, tau, attack=0.004):
    t = tt(dur)
    a = np.clip(t / max(attack, 1e-6), 0, 1)
    return a * np.exp(-t / tau)


def sweep(f0, f1, dur, curve=0.55):
    """指数/幂次扫频正弦"""
    t = tt(dur)
    k = (t / dur) ** curve
    f = f0 * (f1 / f0) ** k
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph)


def bp(x, lo, hi, order=2):
    sos = signal.butter(order, [lo / (SR / 2), hi / (SR / 2)], btype='band', output='sos')
    return signal.sosfilt(sos, x)


def lp(x, fc, order=2):
    sos = signal.butter(order, fc / (SR / 2), btype='low', output='sos')
    return signal.sosfilt(sos, x)


def hp(x, fc, order=2):
    sos = signal.butter(order, fc / (SR / 2), btype='high', output='sos')
    return signal.sosfilt(sos, x)


# ───────────────────────────── 素材 ─────────────────────────────
def m_impact(gain=1.0):
    """落点：低频下潜 + 噪声拍击 + 短促金属感"""
    d = 1.6
    body = sweep(128, 38, d, 0.45) * env_exp(d, 0.30, 0.002)
    sub = np.sin(2 * np.pi * 46 * tt(d)) * env_exp(d, 0.55, 0.004) * 0.55
    nz = bp(rng.standard_normal(int(0.09 * SR)), 900, 7000) * env_exp(0.09, 0.018, 0.0005) * 0.5
    out = np.zeros(int(d * SR))
    out += body * 0.9 + sub + np.pad(nz, (0, len(out) - len(nz)))
    return out * gain


def m_riser(dur=0.85):
    """切点前的上扬噪声"""
    d = dur
    n = int(d * SR)
    x = rng.standard_normal(n)
    # 用两段不同频带叠加，制造从闷到亮的推升
    lo = bp(x, 180, 1200) * 0.55
    hi = bp(x, 1200, 9000) * 0.45
    t = np.arange(n) / n
    mix = lo * (1 - t) ** 1.2 + hi * t ** 2.4
    amp = (t ** 2.6) * (1 - np.clip((t - 0.965) / 0.035, 0, 1))
    tone = np.sin(2 * np.pi * (220 * (2 ** (t * 2.2))) * np.arange(n) / SR) * 0.10 * t ** 2
    return (mix * amp + tone) * 0.9


def m_bell(freqs, dur=3.2, gain=1.0):
    """玻璃/金属质感的点缀音"""
    out = np.zeros(int(dur * SR))
    for i, f in enumerate(freqs):
        d = dur * (1 - i * 0.12)
        s = np.sin(2 * np.pi * f * tt(d)) * env_exp(d, 0.35 + i * 0.05, 0.002)
        s += np.sin(2 * np.pi * f * 2.004 * tt(d)) * env_exp(d, 0.16, 0.001) * 0.25
        out[:len(s)] += s * (1 - i * 0.18)
    return out * gain


def m_tick(gain=1.0):
    d = 0.10
    x = rng.standard_normal(int(d * SR))
    x = bp(x, 3200, 11000) * env_exp(d, 0.012, 0.0004)
    return x * gain


def m_whoosh(dur=1.1):
    n = int(dur * SR)
    x = rng.standard_normal(n)
    t = np.arange(n) / n
    y = bp(x, 240, 3800)
    amp = np.sin(np.pi * t) ** 2.2
    return y * amp * 0.55


# ───────────────────────────── 分层 ─────────────────────────────
def build_drone():
    """低频底座：只负责重量，中高频交给 pad 层"""
    t = np.arange(N) / SR
    lfo1 = 0.5 + 0.5 * np.sin(2 * np.pi * 0.037 * t)
    lfo2 = 0.5 + 0.5 * np.sin(2 * np.pi * 0.061 * t + 1.7)
    lfo3 = 0.5 + 0.5 * np.sin(2 * np.pi * 0.019 * t + 3.1)

    a1 = np.sin(2 * np.pi * 55.0 * t)
    a2 = np.sin(2 * np.pi * 82.41 * t)
    a3 = np.sin(2 * np.pi * 110.0 * t + 0.4)
    a6 = np.sin(2 * np.pi * 55.4 * t + 1.1)
    body = (a1 * (0.62 + 0.38 * lfo1) + a2 * (0.30 + 0.22 * lfo2) +
            a3 * (0.16 + 0.12 * lfo3) + a6 * 0.34)
    body = lp(body, 260, 2)
    return body


def build_pad():
    """中频和声垫：给画面留出可听的主体，避免只有隆隆低频"""
    t = np.arange(N) / SR
    lfo = 0.5 + 0.5 * np.sin(2 * np.pi * 0.043 * t + 0.8)
    lfo2 = 0.5 + 0.5 * np.sin(2 * np.pi * 0.071 * t + 2.4)
    out = np.zeros(N)
    # A 小调色彩的和声堆叠（A3 / E4 / A4 / C5）
    for f, g, ph in [(220.0, .34, 0.0), (329.63, .22, 1.2), (440.0, .17, 2.1), (523.25, .10, 3.3)]:
        out += np.sin(2 * np.pi * f * t + ph) * g * (0.75 + 0.25 * lfo)
        out += np.sin(2 * np.pi * f * 1.003 * t + ph) * g * 0.5 * (0.7 + 0.3 * lfo2)
    out = bp(out, 150, 1400, 2)
    # 轻微高频泛音，避免发闷
    spark = (np.sin(2 * np.pi * 1320.0 * t) * 0.020 * (0.35 + 0.65 * lfo2) +
             np.sin(2 * np.pi * 1980.0 * t + 1.0) * 0.012 * (0.3 + 0.7 * lfo))
    return out, spark


def section_gain(t):
    """按段落自动推拉整体能量，制造起伏"""
    pts = [(0, .50), (2.2, .72), (4.0, .82), (10.6, .86), (11.6, 1.00),
           (18.6, 1.00), (20.0, .84), (26.6, .84), (27.6, .96), (32.8, 1.02),
           (35.0, .92), (38.4, .80), (40.0, .55)]
    xs = np.array([p[0] for p in pts])
    ys = np.array([p[1] for p in pts])
    t = np.arange(N) / SR
    g = np.interp(t, xs, ys)
    # 平滑，避免折线感（用 FFT 均匀滤波，避免 O(N·K) 的直接卷积）
    k = max(3, int(SR * 0.25))
    ker = np.ones(k) / k
    nfft = 1 << int(np.ceil(np.log2(len(g) + k)))
    gs = np.fft.irfft(np.fft.rfft(g, nfft) * np.fft.rfft(ker, nfft), nfft)[:len(g)]
    gs = np.clip(gs, 0, None)
    return gs


def place(buf, sig, at, gain=1.0, pan=0.0):
    """把单声道信号以等功率声像叠加到立体声缓冲"""
    i = int(at * SR)
    if i >= N:
        return
    n = min(len(sig), N - i)
    gl = np.cos((pan + 1) * np.pi / 4) * np.sqrt(2) * 0.7071
    gr = np.sin((pan + 1) * np.pi / 4) * np.sqrt(2) * 0.7071
    buf[0, i:i + n] += sig[:n] * gain * gl
    buf[1, i:i + n] += sig[:n] * gain * gr


def build():
    t = np.arange(N) / SR
    body = build_drone()
    pad, spark = build_pad()

    # 归一化各层后按设计比例混合
    def norm(x, target):
        return x / (np.max(np.abs(x)) + 1e-9) * target

    def rms(x, target):
        return x / (np.sqrt((x ** 2).mean()) + 1e-9) * target

    mono = norm(body, 0.34) + norm(pad, 0.30)
    mono += rms(spark, 0.020)
    # 空气层：3k 以上的宽带噪声，给画面"通透感"
    air = hp(rng.standard_normal(N), 2900, 2) * (0.55 + 0.45 * np.sin(2 * np.pi * 0.033 * t))
    mono += rms(air, 0.028)

    dry = np.zeros((2, N))
    dry[0] += mono
    dry[1] += mono * 0.99

    # 1) 场景落点
    for b, g in zip(CUTS, CUT_GAIN):
        pan = rng.uniform(-0.12, 0.12)
        place(dry, m_impact(), b - 0.02, 0.72 * g, pan)

    # 2) 每个落点前的 riser
    for b, g in zip(CUTS[1:], CUT_GAIN[1:]):
        place(dry, m_riser(0.80), b - 0.80, 0.30 * g, 0.0)

    # 3) 开场：第一道光的"点"声
    place(dry, m_bell([1174.7, 1760.0, 2637.0], 3.6, 1.0), 0.62, 0.15, 0.0)
    place(dry, m_impact(0.55), 0.55, 0.40, 0.0)

    # 4) 标题金属反光：一记明亮铃音
    place(dry, m_bell([880.0, 1320.0, 1760.0, 2640.0], 4.2, 1.0), 4.55, 0.20, 0.0)
    place(dry, m_bell([659.3, 987.8, 1318.5], 3.0, 1.0), 7.10, 0.12, -0.25)

    # 5) 能力段：稀疏的玻璃点击，落在 0.75s 网格
    tb = 11.35
    k = 0
    while tb < 18.6:
        if k % 2 == 0:
            place(dry, m_tick(1.0), tb, 0.085, rng.uniform(-0.5, 0.5))
        tb += 0.375
        k += 1

    # 6) 闭环段：脉冲在环上走的"机械"感
    tb = 21.4
    while tb < 24.4:
        place(dry, m_tick(0.7), tb, 0.06, (tb - 21.4) / 3.0 * 1.6 - 0.8)
        tb += 0.5

    # 7) 闭环闭合：一记明亮确认音
    place(dry, m_bell([987.8, 1479.9, 1975.5], 3.4, 1.0), 24.45, 0.16, 0.0)

    # 8) 成形段
    place(dry, m_whoosh(1.4), 27.05, 0.26, 0.0)
    place(dry, m_bell([523.3, 784.0, 1046.5], 3.8, 1.0), 28.15, 0.11, 0.2)

    # 9) 落版：最重的一击 + 长尾
    place(dry, m_impact(1.15), 33.0, 0.80, 0.0)
    place(dry, m_bell([440.0, 660.0, 880.0, 1320.0], 5.0, 1.0), 33.02, 0.18, 0.0)
    place(dry, m_bell([659.3, 987.8], 4.0, 1.0), 36.2, 0.09, 0.0)

    # 10) 收尾 whoosh
    place(dry, m_whoosh(1.8), 38.05, 0.16, 0.0)

    # 段落自动增益
    dry *= section_gain(t)
    return dry


def make_ir(seconds=2.6, decay=3.2):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = rng.standard_normal((2, n)) * np.exp(-t * decay)
    # 早期反射
    for d, g in [(0.011, 0.32), (0.019, 0.24), (0.031, 0.18), (0.047, 0.13)]:
        i = int(d * SR)
        ir[0, i] += g
        ir[1, i + 37] += g
    # 保持一定相干性：单声道折叠时不至于相位抵消
    ir[1] = ir[0] * 0.55 + ir[1] * 0.45
    ir = np.stack([lp(ir[0], 5600, 2), lp(ir[1], 5200, 2)])
    ir /= np.max(np.abs(ir)) + 1e-9
    return ir


def reverb(x, ir, wet=0.30):
    out = np.zeros_like(x)
    for c in range(2):
        w = signal.fftconvolve(x[c], ir[c], mode='full')[:x.shape[1]]
        out[c] = w
    return x * (1 - wet) + out * wet


def master(x):
    # 轻压 + 软限幅
    x = np.tanh(x * 1.22) * 0.88
    # 20Hz 高通去直流
    x = np.stack([hp(x[0], 26, 2), hp(x[1], 26, 2)])
    peak = np.max(np.abs(x)) + 1e-9
    x = x / peak * 0.89
    # 收尾整体淡出
    t = np.arange(N) / SR
    fade = 1 - np.clip((t - 38.6) / 1.4, 0, 1) ** 1.5
    x *= fade
    # 开头淡入，避免爆音
    x *= np.clip(t / 0.05, 0, 1)
    return x


def write_wav(path, x):
    data = np.clip(x.T, -1, 1)
    pcm = (data * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


if __name__ == '__main__':
    here = os.path.dirname(os.path.abspath(__file__))
    dry = build()
    ir = make_ir()
    wet = reverb(dry, ir, 0.34)
    out = master(wet)
    p = os.path.join(here, '..', 'soundtrack.wav')
    write_wav(p, out)
    dur = out.shape[1] / SR
    print(f'wrote {os.path.abspath(p)}')
    print(f'duration={dur:.2f}s  peak={np.max(np.abs(out)):.3f}  '
          f'rms={np.sqrt(np.mean(out**2)):.3f}')
