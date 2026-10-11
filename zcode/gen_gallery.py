# -*- coding: utf-8 -*-
"""生成 SVG-AI-TEST 仓库主页 index.html（静态画廊）"""
import html, os

ROOT = r"SVG-AI-TEST"

# ---------- 案例一 作品清单 ----------
C1 = "case1-complex-plane"
works1 = [
    dict(agent="ZCode Agent · GLM-5.3-Flash", main=f"{C1}/sky_plane-ZCode-GLM5.3Flash.svg", kind="svg",
         note="本仓库同源作品：孙悟空驾驶四发客机，鹈鹕骑车、北极熊、秦始皇打螺丝、递归玻璃球一条完整承托链；含 3840×2160 高清 PNG 预览。",
         extras=[f"{C1}/sky_plane-ZCode-GLM5.3Flash.png"]),
    dict(agent="WorkBuddy Agent · DeepSeek 4.1 Flash（用时 14m37s）", main=f"{C1}/plane-circus-chain-wb-ds4.1flash-14m37s.svg", kind="svg",
         note="同题作品：飞机马戏团式承托链；画布 2200×1900，附 PNG 渲染图。",
         extras=[f"{C1}/plane-circus-chain-wb-ds4.1flash.png"]),
    dict(agent="WorkBuddy Agent · SpaceBunny", main=f"{C1}/qin-29-illustration-wb-SpaceBunny.svg", kind="svg",
         note="「qin-29」主题插画，画布 3000×2400。"),
    dict(agent="豆包 · DB 2.1 Pro（用时 55m21s）", main=f"{C1}/qin-airplane-fantasy-db-2.1pro-55m21s.svg", kind="svg",
         note="「qin-airplane-fantasy」幻想插画，画布 2400×1600。"),
    dict(agent="Qwen 3.8 Max（用时约 90 分钟）", main=f"{C1}/qin_flight_Qwen3.8Max-90m.svg", kind="svg",
         note="竖版构图 2000×3200，附 1400×2240 预览图。",
         extras=[f"{C1}/qin_flight_preview_QWen3.8Max.png"]),
    dict(agent="GPT-6 Astra Mid（用时 25m39s）", main=f"{C1}/sky-paradox-GPT-6AstraMid-25m39s.svg", kind="svg",
         note="「sky-paradox」竖版 2800×3900，附高清 PNG。",
         extras=[f"{C1}/sky-paradox-GPT-6AstraMid.png"]),
    dict(agent="Qoder IDE · Qwen3.8-Flash", main=f"{C1}/大秦御号-高空奇景-Qoder-Qwen3.8-Flash.svg", kind="svg",
         note="「大秦御号 · 高空奇景」，画布 2480×2160。",
         extras=[f"{C1}/大秦御号-高空奇景-Qoder-Qwen3.8-Flash优化.svg"]),
    dict(agent="Qoder IDE · Qwen3.8-Flash（优化修订版）", main=f"{C1}/大秦御号-高空奇景-Qoder-Qwen3.8-Flash优化.svg", kind="svg",
         note="上一作品的优化修订版：同画布 2480×2160，针对细节与约束完成度作了改进，体积 65 KB → 72 KB。"),
    dict(agent="DeepSeek 网页版（对话截图）", main=f"{C1}/DeepSeek-WebChat.png", kind="img",
         note="网页对话直接生成，仅留存截图（1790×1303）。"),
    dict(agent="MiniMax 文生图（非 SVG）", main=f"{C1}/MiniMax文生图(不是SVG).jpg", kind="img",
         note="走文生图路线的对照样本（3017×1280）。"),
    dict(agent="他人 · GPT 文生图 ①（非 SVG）", main=f"{C1}/他人-GPT0.jpg", kind="img",
         note="外部 GPT 文生图对照样本（2164×1280）。"),
    dict(agent="他人 · GPT 文生图 ②（非 SVG）", main=f"{C1}/他人-GPT1文生图(不是SVG).jpg", kind="img",
         note="外部 GPT 文生图对照样本（1440×1019）。"),
    dict(agent="Pavo Agens Video 2.5（生成视频）", main=f"{C1}/Pavo-AgensVideo-2.5.mp4", kind="video",
         note="视频路线对照样本，6.5 MB。"),
    dict(agent="Pavo Agens Video 2.5 Flash（生成视频）", main=f"{C1}/Pavo-AgensVideo-2.5-Flash.mp4", kind="video",
         note="视频路线对照样本（Flash 档），10.5 MB。"),
    dict(agent="DSHarness · AgnesAI 3.0 Flash", main=f"{C1}/QIN-30_airliner_puzzle-DSHarness-AgnesAI3.0Flash.svg", kind="svg",
         note="「QIN-30 airliner puzzle」：换一道题（30 座客机版）的 SVG 作答，画布待查。"),
    dict(agent="WorkBuddy · AgnesAI 3.0 Flash（验证拼图）", main=f"{C1}/c15_verify-wb-agnes3.0flash.svg", kind="svg",
         note="「c15 验证」拼图式作品，附 PNG 渲染图（655 KB）。",
         extras=[f"{C1}/c15_verify-wb-agnes3.0flash.png"]),
]

# ---------- 案例三 作品清单（黑悟空风格成图对比） ----------
C3 = "case3-black-myth-heroine"
works3 = [
    dict(agent="ChatGPT · 5.6 Sol xhigh（综合 90.1 分 🥇）", main=f"{C3}/ChatGPT5.6Sol.png", kind="img",
         note="最像可直接进入写实动作 RPG 宣传物料的成图：人体、材质、空间和交付完整性最强。"),
    dict(agent="Qwen 3.8 Max（综合 88.0 分 🥈）", main=f"{C3}/Qwen3.8-Max.png", kind="img",
         note="最准确抓住「性感妖女」：蜘蛛精叙事鲜明、冲击力强；水印和回避手部拉低综合分。"),
    dict(agent="Qwen 3.8 Max · 成品展示页", main=f"{C3}/Qwen3.8-Max-成品图.png", kind="img",
         note="由 Qwen 原图制作的成品展示页。"),
    dict(agent="WorkBuddy · KimiK3（综合 85.5 分 🥉）", main=f"{C3}/wb-KimiK3.png", kind="img",
         note="九尾狐概念最有记忆点，冷色氛围优秀；与黑神话的直接关联和性感度稍弱。"),
    dict(agent="Trae · Seedream（综合 80.0 分）", main=f"{C3}/Trae-Seedream.jpg", kind="img",
         note="最有全身战斗英雄海报感，分辨率最高；更像通用玄幻 MMO。"),
    dict(agent="WorkBuddy · Hy3（综合 79.0 分）", main=f"{C3}/wb-Hy3.png", kind="img",
         note="国风水墨和金甲完成度不错；气质偏明亮端庄，离黑神话的阴郁写实感较远。"),
]

# ---------- 案例二 作品清单 ----------
C2 = "case2-pelican-bike"
works2 = [
    dict(agent="基准原创 SVG「海风骑行」（模型未标注）", main=f"{C2}/pelican-cycling.svg", kind="svg",
         note="系围巾的鹈鹕骑珊瑚红自行车（1440×1080），附 2880×2160 高清 PNG 与说明 README。",
         extras=[f"{C2}/pelican-cycling.png", f"{C2}/README.md"]),
    dict(agent="GLM-5.1（2026-04-07 快照）", main=f"{C2}/GLM-5.1-20260407.gif", kind="img",
         note="动图记录（GIF，21 帧，640×512）。"),
    dict(agent="GPT-4o（2024-10-25 快照）", main=f"{C2}/GPT-4o-20241025.png", kind="img",
         note="图片对照样本（800×800）。"),
    dict(agent="GPT-5（2025-08-07 快照）", main=f"{C2}/GPT-5-20250807.png", kind="img",
         note="图片对照样本（800×600）。"),
    dict(agent="GPT-5 mini（2025-08-07 快照）", main=f"{C2}/GPT-5-mini-20250807.png", kind="img",
         note="图片对照样本（800×600）。"),
    dict(agent="GPT-6 Astra（2026-09-09 快照）", main=f"{C2}/GPT-6-Astra-20260909.gif", kind="img",
         note="动图记录（GIF，60 帧，640×384）。"),
    dict(agent="WorkBuddy · DS v4.1 Flash（交互页）", main=f"{C2}/wb-ds-v4.1-flash.html", kind="html",
         note="「鹈鹕骑自行车 · Pelican on a Bicycle」独立交互页（19 KB）。"),
    dict(agent="WorkBuddy · DS v4.1 Flash · 3D 双版（交互页）", main=f"{C2}/pelican-bicycle-3d-standalone双版wb-dsv4.1flash.html", kind="html",
         note="「鹈鹕骑自行车 3D · 正常版」独立交互页，含双版本（553 KB）。"),
    dict(agent="Luna 5.6 · xhigh（交互页）", main=f"{C2}/pelican-cycling-5.6-Luna-xhigh.html", kind="html",
         note="「鹈鹕骑自行车」轻量交互页（6 KB）。"),
    dict(agent="双版本离线版（交互页）", main=f"{C2}/鹈鹕骑车-双版本离线.html", kind="html",
         note="「鹈鹕骑车 · 双版本离线版」（552 KB）。"),
    dict(agent="GPT 文生图测试（非 SVG）", main=f"{C2}/鹈鹕骑自行车GPT测试.jpg", kind="img",
         note="文生图对照样本（1080×1465）。"),
    dict(agent="WorkBuddy · Hy4Pre（反转题 · SMIL 动图）", main=f"{C2}/bicycle-rides-pelican-animated-wb-Hy4Pre.svg", kind="svg", anim=True,
         note="反转题「自行车骑鹈鹕」：自行车当骑手。动图版含 28 个动画元素，附静态版。",
         extras=[f"{C2}/bicycle-rides-pelican-wb-Hy4Pre.svg"]),
    dict(agent="DSHarness · MiMo 2.6 Flash（反转题 · SMIL 动图）", main=f"{C2}/bicycle_rides_pelican_v4_animated-dsh-mimo2.6flash.svg", kind="svg", anim=True,
         note="反转题动图版（44 个动画元素），附静态 v3。",
         extras=[f"{C2}/bicycle_rides_pelican_v3-dsh-mimo2.6flash.svg"]),
    dict(agent="DSHarness · AgnesAI 3.0 Flash（反转题 · SMIL 动图）", main=f"{C2}/bicycle_riding_pelican_v2_animated-dsh-agnes3.0flash.svg", kind="svg", anim=True,
         note="反转题动图版（18 个动画元素），附静态 v1。",
         extras=[f"{C2}/bicycle_riding_pelican_v1-dsh-agnes3.0flash.svg"]),
    dict(agent="ZCode Agent · GLM-5.3-Flash（反转题 · SMIL 动图）", main=f"{C2}/bike-rides-pelican-animated-ZCode-GLM5.3Flash.svg", kind="svg", anim=True,
         note="反转题动图版（19 个动画元素）：海滩木栈道、缰绳连长嘴、脚踏垂在身侧，附静态 v3。",
         extras=[f"{C2}/bike-rides-pelican-v3-ZCode-GLM5.3Flash.svg"]),
]

def esc(s): return html.escape(s, quote=True)

def badge(t, cls=""):
    return f'<span class="b {cls}">{esc(t)}</span>'

def thumb_of(path):
    t = "thumbs/" + path + ".jpg"
    return t if os.path.exists(os.path.join(ROOT, t.replace("/", os.sep))) else None

def preview(w):
    kind = w["kind"]
    url = w["main"]
    if kind == "video":
        media = (f'<video class="media" controls preload="metadata" src="{esc(url)}" '
                 f'onclick="event.stopPropagation()"></video>')
        zoom = ""
    elif kind == "html":
        media = (f'<iframe class="media" loading="lazy" src="{esc(url)}" title="{esc(w["agent"])}" '
                 f'onclick="event.stopPropagation()"></iframe>'
                 f'<a class="pop" href="{esc(url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">新窗口打开 ↗</a>')
        zoom = ""
    else:
        disp = url
        full = url
        if kind == "img":
            t = thumb_of(url)
            if t: disp = t
        media = (f'<img class="media" loading="lazy" decoding="async" src="{esc(disp)}" alt="" '
                 f'onerror="this.closest(&#39;.preview&#39;).classList.add(&#39;broken&#39;)">')
        zoom = " zoom"
    return (f'<div class="preview{zoom}" data-kind="{kind}" data-src="{esc(url)}" '
            f'data-full="{esc(url)}" tabindex="0">{media}'
            f'<button class="rbtn" title="重新加载本框" onclick="reloadPreview(this)">↻</button></div>')

def card(w, meta):
    ext = {"jpg": "img", "jpeg": "img", "png": "img", "gif": "img", "mp4": "video"}.get(
        w["main"].rsplit(".", 1)[-1].lower(), w["main"].rsplit(".", 1)[-1].lower())
    tb = {"svg": ("SVG", "ok"), "img": ("图片", "img"), "video": ("视频", "video"), "html": ("交互页", "html")}[ext]
    bits = [badge(f".{ext}", tb[1]), badge(meta["size"])]
    if w.get("anim"):
        bits.append(badge("SMIL 动图", "video"))
    if "xml" in meta:
        bits.append(badge("XML 有效" if meta["xml"] else "XML 异常", "ok" if meta["xml"] else "warn"))
    if "dim" in meta:
        bits.append(badge(meta["dim"]))
    if "frames" in meta and meta["frames"] > 1:
        bits.append(badge(f"{meta['frames']} 帧"))
    extras = ""
    for e in w.get("extras", []):
        en = os.path.basename(e)
        eext = en.rsplit(".", 1)[-1].lower()
        if eext in ("png", "jpg", "jpeg", "gif"):
            te = thumb_of(e) or e
            extras += (f'<a class="thumb" href="{esc(e)}" target="_blank" rel="noopener" title="{esc(en)}">'
                       f'<img loading="lazy" src="{esc(te)}" alt="{esc(en)}"></a>')
        else:
            extras += (f'<a class="doc" href="{esc(e)}" target="_blank" rel="noopener">📄 {esc(en)}</a>')
    if extras:
        extras = f'<div class="extras">{extras}</div>'
    links = (f'<div class="links"><a href="{esc(w["main"])}" target="_blank" rel="noopener">查看原文件 ↗</a>'
             f'<a href="{esc(w["main"])}" download>下载</a></div>')
    return (f'<figure class="card" data-type="{w["kind"]}">{preview(w)}'
            f'<figcaption><div class="agent">{esc(w["agent"])}</div>'
            f'<div class="fname">{esc(os.path.basename(w["main"]))}</div>'
            f'<div class="badges">{"".join(bits)}</div>'
            f'<p class="note">{esc(w["note"])}</p>{extras}{links}</figcaption></figure>')

# ---------- 元数据 ----------
import json, re
import xml.etree.ElementTree as ET
from PIL import Image
def meta_of(path):
    p = os.path.join(ROOT, path)
    size = os.path.getsize(p)
    info = {"size": (f"{size/1024:.0f} KB" if size < 1048576 else f"{size/1048576:.1f} MB")}
    ext = path.rsplit(".", 1)[-1].lower()
    if ext == "svg":
        try:
            ET.parse(p); info["xml"] = True
        except Exception:
            info["xml"] = False
        head = open(p, encoding="utf-8", errors="ignore").read(4000)
        vb = re.search(r'viewBox\s*=\s*"([^"]+)"', head)
        info["dim"] = vb.group(1).replace("0 0 ", "") if vb else "?"
    elif ext in ("png", "jpg", "jpeg", "gif"):
        im = Image.open(p)
        info["dim"] = f"{im.width}×{im.height}"
        n = getattr(im, "n_frames", 1)
        if n > 1: info["frames"] = n
    return info

cards1 = "".join(card(w, meta_of(w["main"])) for w in works1)
cards2 = "".join(card(w, meta_of(w["main"])) for w in works2)
cards3 = "".join(card(w, meta_of(w["main"])) for w in works3)
# 动态统计
from collections import Counter
cnt = Counter(); total = 0
for cur, _, fs in os.walk(ROOT):
    if ".git" in cur or "thumbs" in cur: continue
    for f in fs:
        p = os.path.join(cur, f); total += os.path.getsize(p)
        e = f.rsplit(".", 1)[-1].lower()
        cnt["svg" if e == "svg" else "img" if e in ("png","jpg","jpeg","gif") else
            "video" if e in ("mp4",) else "html" if e == "html" else
            "app" if e in ("exe","zip") else "doc"] += 1
parts = [f"{cnt['svg']} 份 SVG", f"{cnt['img']} 张图片/动图", f"{cnt['video']} 段视频",
         f"{cnt['html']} 个交互页", f"{cnt['app']} 个 Windows 应用/包", f"{cnt['doc']} 份文档"]
stats = ("3 个测试案例 · 25+ 组 Agent / 模型 · " + " · ".join(p for p in parts if not p.startswith("0 "))
         + f" · 共约 {total/1048576:.0f} MB")

prompt = esc(open(os.path.join(ROOT, C1, "复杂生图或SVG提示词.txt"), encoding="utf-8").read().strip())
readme2 = esc(open(os.path.join(ROOT, C2, "README.md"), encoding="utf-8").read().strip())
report3 = esc(open(os.path.join(ROOT, C3, "comparison-report.md"), encoding="utf-8").read().strip())


TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SVG-AI-TEST · AI Agent × 大模型 交叉验证画廊</title>
<meta name="description" content="两个 SVG 生成案例在不同 AI Agent + 大模型下的交叉验证对比：SVG 源文件、渲染图片与生成视频。">
<style>
:root{--bg:#0d1220;--panel:#141b2d;--panel2:#1a2338;--line:#27324e;--tx:#e8edf7;--mut:#93a0bd;
--acc:#6ea8fe;--acc2:#b08cff;--ok:#3ecf8e;--warn:#f0a24b;--video:#ff7d9c;--html:#5ad0c8;--img:#8fa8ff}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--tx);font-family:"Microsoft YaHei","PingFang SC",system-ui,sans-serif;line-height:1.6}
a{color:var(--acc);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:1280px;margin:0 auto;padding:0 20px}
header{padding:64px 0 36px;text-align:center;background:
 radial-gradient(900px 300px at 20% -10%,rgba(110,168,254,.18),transparent),
 radial-gradient(900px 300px at 80% -10%,rgba(176,140,255,.16),transparent)}
h1{font-size:clamp(26px,4vw,44px);background:linear-gradient(90deg,var(--acc),var(--acc2));
-webkit-background-clip:text;background-clip:text;color:transparent;letter-spacing:1px}
.sub{color:var(--mut);margin-top:10px;font-size:15px}
.stats{display:inline-flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:18px}
.stats span{background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:5px 14px;font-size:13px;color:#c6d2ea}
nav{position:sticky;top:0;z-index:50;background:rgba(13,18,32,.9);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
nav .wrap{display:flex;gap:8px;align-items:center;padding:10px 20px;flex-wrap:wrap}
nav a.case{padding:7px 16px;border-radius:999px;border:1px solid var(--line);color:#c6d2ea;font-size:14px}
nav a.case:hover{border-color:var(--acc);text-decoration:none}
.filters{margin-left:auto;display:flex;gap:6px;flex-wrap:wrap}
.filters button{background:var(--panel);border:1px solid var(--line);color:#c6d2ea;border-radius:999px;
padding:5px 13px;font-size:13px;cursor:pointer}
.filters button.on{background:linear-gradient(90deg,var(--acc),var(--acc2));border-color:transparent;color:#fff}
section{padding:44px 0 8px}
.case-h{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.case-h h2{font-size:24px}
.case-h .orig{color:var(--mut);font-size:13px}
.case-desc{color:#b9c4dd;font-size:14px;margin:10px 0 4px;max-width:960px}
details{background:var(--panel);border:1px solid var(--line);border-radius:12px;margin:14px 0 6px;overflow:hidden}
details summary{cursor:pointer;padding:10px 16px;font-size:14px;color:#c6d2ea;user-select:none}
details pre{white-space:pre-wrap;word-break:break-word;padding:4px 18px 16px;color:#aeb9d4;
font-size:12.5px;font-family:Consolas,monospace;max-height:340px;overflow:auto}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:18px;padding:18px 0 30px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:16px;overflow:hidden;
display:flex;flex-direction:column;transition:transform .15s,border-color .15s}
.card:hover{transform:translateY(-3px);border-color:#3a4a78}
.preview{position:relative;aspect-ratio:4/3;background:
 repeating-conic-gradient(#101728 0 25%,#0b101d 0 50%) 0 0/24px 24px;
 display:flex;align-items:center;justify-content:center;overflow:hidden;border-bottom:1px solid var(--line)}
.preview img,.preview video,.preview iframe{width:100%;height:100%;object-fit:contain;border:0;background:transparent}
.preview.zoom{cursor:zoom-in}
.preview.broken::after{content:"⚠ 资源加载失败 · 点右上角 ↻ 重试";color:var(--warn);font-size:13px;padding:12px;text-align:center}
.rbtn{position:absolute;right:10px;top:10px;width:30px;height:30px;border-radius:999px;
background:rgba(13,18,32,.88);border:1px solid var(--line);color:#d7e2f7;font-size:15px;
cursor:pointer;line-height:1;z-index:4}
.rbtn:hover{border-color:var(--acc);color:var(--acc)}
.preview .pop{right:48px}
.preview .pop{position:absolute;right:10px;top:10px;background:rgba(13,18,32,.85);border:1px solid var(--line);
 color:#c6d2ea;font-size:12px;padding:3px 10px;border-radius:999px}
.preview .pop:hover{text-decoration:none;border-color:var(--acc)}
figcaption{padding:14px 16px 16px;display:flex;flex-direction:column;gap:7px;flex:1}
.agent{font-weight:700;font-size:15px}
.fname{color:var(--mut);font-size:12px;word-break:break-all;font-family:Consolas,monospace}
.badges{display:flex;flex-wrap:wrap;gap:6px}
.b{font-size:11.5px;border-radius:999px;padding:2px 9px;background:var(--panel2);border:1px solid var(--line);color:#b9c4dd}
.b.ok{color:var(--ok);border-color:rgba(62,207,142,.4)}
.b.warn{color:var(--warn);border-color:rgba(240,162,75,.4)}
.b.video{color:var(--video);border-color:rgba(255,125,156,.4)}
.b.html{color:var(--html);border-color:rgba(90,208,200,.4)}
.b.img{color:var(--img);border-color:rgba(143,168,255,.4)}
.note{color:#aeb9d4;font-size:13px;flex:1}

.flist-head .note{margin-top:4px}
.extras{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.extras .thumb{width:64px;height:48px;border:1px solid var(--line);border-radius:8px;overflow:hidden;display:block;background:#0b101d}
.extras .thumb img{width:100%;height:100%;object-fit:cover}
.extras .doc{font-size:12px;border:1px solid var(--line);border-radius:8px;padding:4px 10px;word-break:break-all}
.links{display:flex;gap:14px;font-size:13px}
footer{border-top:1px solid var(--line);margin-top:30px;padding:26px 0 40px;color:var(--mut);font-size:13px;text-align:center}
#lb{position:fixed;inset:0;background:rgba(5,8,16,.92);display:none;z-index:100;align-items:center;justify-content:center;flex-direction:column;gap:12px;padding:24px}
#lb.on{display:flex}
#lb .box{max-width:94vw;max-height:82vh;display:flex;align-items:center;justify-content:center}
#lb img,#lb video{max-width:94vw;max-height:82vh;border-radius:10px;background:#0b101d}
#lb iframe{width:min(1100px,94vw);height:min(700px,74vh);border:0;border-radius:10px;background:#fff}
#lb .cap{color:#c6d2ea;font-size:14px}
#lb .x{position:absolute;right:18px;top:14px;font-size:26px;color:#c6d2ea;cursor:pointer;background:none;border:0}
@media(max-width:560px){.grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<header class="wrap">
  <h1>SVG-AI-TEST</h1>
  <div class="sub">AI Agent × 大模型 交叉验证对比 —— 同一组题目，各家成品一览（SVG 源文件 · 渲染图片 · 生成视频 · 交互页）</div>
  <div class="stats"><span>__STATS__</span></div>
</header>
<nav><div class="wrap">
  <a class="case" href="#case1">案例一 · 复杂多层 SVG（大秦御号客机）</a>
  <a class="case" href="#case2">案例二 · 鹈鹕骑自行车</a>
  <a class="case" href="#case3">案例三 · 黑悟空风成图</a>
  <div class="filters" id="filters">
    <button class="on" data-t="all">全部</button>
    <button data-t="svg">SVG</button>
    <button data-t="img">图片</button>
    <button data-t="video">视频</button>
    <button data-t="html">交互页</button>
  </div>
</div></nav>

<main class="wrap">
<section id="case1">
  <div class="case-h"><h2>🛩️ 案例一 · 复杂多层 SVG</h2><span class="orig">原目录：vs复杂多层SVG</span></div>
  <p class="case-desc">同一道超长提示词（机身/驾驶舱/机翼/尾翼/四发动机 + 孙悟空驾车 + 鹈鹕骑车 + 北极熊 + 秦始皇打螺丝 + 递归玻璃球等 60 余项硬性约束），考验模型的长指令遵循与空间结构能力。各家以 SVG、文生图或视频等不同形式交卷。</p>
  <details><summary>📜 查看完整提示词（复杂生图或SVG提示词.txt）</summary><pre>__PROMPT__</pre></details>
  <div class="grid">
__CARDS1__
  </div>
</section>

<section id="case2">
  <div class="case-h"><h2>🚲 案例二 · 鹈鹕骑自行车</h2><span class="orig">原目录：vs鹈鹕骑自行车SVG</span></div>
  <p class="case-desc">「海风骑行」题目：系着围巾的鹈鹕骑着珊瑚红色自行车穿过海边风景。不同大模型快照（GLM / GPT 系列）与 Agent（WorkBuddy、Luna）以动图、图片、交互 HTML 与 SVG 等形式交卷。</p>
  <details><summary>📜 查看题目说明（原目录 README.md）</summary><pre>__README2__</pre></details>
  <div class="grid">
__CARDS2__
  </div>
</section>


<section id="case3">
  <div class="case-h"><h2>🗡️ 案例三 · 黑悟空风格成图对比</h2><span class="orig">原目录：vs黑悟空大女主</span></div>
  <p class="case-desc">「黑悟空风格性感美女」同题成图：5 张独立成图 + 1 张 Qwen 原图制作的成品展示页，附带综合评分对比报告（ChatGPT 90.1 / Qwen 88.0 / KimiK3 85.5 / Seedream 80.0 / Hy3 79.0）。</p>
  <details><summary>📜 查看完整对比报告（comparison-report.md）</summary><pre>__REPORT3__</pre></details>
  <div class="grid">
__CARDS3__
  </div>
</section>
</main>

<footer>
  <div>SVG-AI-TEST · 交叉验证测试存档 · 由 AI Agent 整理生成 · 所有版权归各自作者所有</div>
  <div style="margin-top:6px"><a href="https://github.com/WangXP7/SVG-AI-TEST" target="_blank" rel="noopener">github.com/WangXP7/SVG-AI-TEST ↗</a></div>
</footer>

<div id="lb" role="dialog" aria-modal="true">
  <button class="x" onclick="lbClose()" aria-label="关闭">✕</button>
  <div class="box" id="lbBox"></div>
  <div class="cap" id="lbCap"></div>
</div>

<script>
const cards=[...document.querySelectorAll('.card')];
document.getElementById('filters').addEventListener('click',e=>{
  if(e.target.tagName!=='BUTTON')return;
  document.querySelectorAll('.filters button').forEach(b=>b.classList.toggle('on',b===e.target));
  const t=e.target.dataset.t;
  cards.forEach(c=>{c.style.display=(t==='all'||c.dataset.type===t)?'':'none';});
});
function reloadPreview(btn){
  const box = btn.closest('.preview');
  const kind = box.dataset.kind;
  const src0 = box.dataset.src;
  const bust = src0 + (src0.includes('?') ? '&' : '?') + 'r=' + Date.now();
  const old = box.querySelector('.media');
  let el = null;
  if(kind === 'video'){
    el = document.createElement('video');
    el.controls = true; el.preload = 'metadata'; el.src = bust;
  } else if(kind === 'html'){
    el = document.createElement('iframe');
    el.loading = 'eager'; el.src = bust;
  } else {
    el = document.createElement('img');
    el.loading = 'eager'; el.decoding = 'async'; el.alt = ''; el.src = bust;
    el.onerror = () => box.classList.add('broken');
  }
  el.className = 'media';
  if(old) old.replaceWith(el); else box.insertBefore(el, btn);
  box.classList.remove('broken');
}
const lb=document.getElementById('lb'),lbBox=document.getElementById('lbBox'),lbCap=document.getElementById('lbCap');
function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}
function lbOpen(el){
  const card=el.closest('.card');
  const url=el.dataset.full, kind=el.dataset.kind;
  const name=card?card.querySelector('.fname').textContent:'';
  const agent=card?card.querySelector('.agent').textContent:'';
  lbBox.innerHTML = kind==='svg' ? '<img src="'+url+'" alt="">'
    : '<video src="'+url+'" controls autoplay></video>';
  lbCap.innerHTML='<b>'+esc(agent)+'</b> — '+esc(name)+'　<a style="color:#8fb3ff" href="'+url+'" target="_blank" rel="noopener">打开原文件 ↗</a>';
  lb.classList.add('on');document.body.style.overflow='hidden';
}
function lbClose(){lb.classList.remove('on');lbBox.innerHTML='';document.body.style.overflow='';}
document.querySelectorAll('.preview.zoom').forEach(p=>{
  p.addEventListener('click',()=>lbOpen(p));
  p.addEventListener('keydown',e=>{if(e.key==='Enter')lbOpen(p);});
});
lb.addEventListener('click',e=>{if(e.target===lb)lbClose();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')lbClose();});
</script>
</body>
</html>
"""

out = (TEMPLATE
       .replace("__STATS__", stats)
       .replace("__PROMPT__", prompt)
       .replace("__README2__", readme2)
       .replace("__CARDS1__", cards1)
       .replace("__CARDS2__", cards2)
       .replace("__CARDS2__", cards2)
       .replace("__REPORT3__", report3)
       .replace("__CARDS3__", cards3))

with open(os.path.join(ROOT, "index.html"), "w", encoding="utf-8") as f:
    f.write(out)
print("index.html written:", len(out), "chars")
