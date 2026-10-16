#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
=============================================================================
 GoodCase.xAI · 画廊首页生成器
=============================================================================
 由 gallery.json（唯一真源）+ 仓库目录结构生成根 index.html，
 并同步 README.md 里的案例数，避免手改计数导致漂移。

 用法：
     python tools/build_gallery.py            # 生成并写盘
     python tools/build_gallery.py --check    # 只校验，不一致则退出码 1（可用于 CI）
     python tools/build_gallery.py --dry-run  # 打印将生成的页面，不写盘

 新增一个案例：
     1) 建目录 <命名空间>/<案例名>/，放入 index.html 与 README.md
        —— README.md 首行为 `# 中文标题`，紧跟一行 `> **Agent + 模型**`
     2) 在 gallery.json 的 entries 里加一条（title / desc / agent 可人工润色）
     3) python tools/build_gallery.py
     未登记到 gallery.json 的案例目录会被列出提醒（默认不上架），
     可用 --with-discovery 试看自动推导出的卡片。

 约定（脚本强制保证，不需要人工维护）：
     * 头部两个计数标签
     * 命名空间顺序（见 gallery.json 的 namespaces）
     * 命名空间内按目录名不区分大小写排序
     * 卡片缩进与标签格式 `Agent + 模型`（不再重复写命名空间）
=============================================================================
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, "gallery.json")
INDEX = os.path.join(ROOT, "index.html")
README = os.path.join(ROOT, "README.md")

# ---------------------------------------------------------------- 页面模板 --
# 头部（CSS + <header> + <nav>）与尾部逐字保留既有样式，只有两个计数是动态的。
HEAD = r"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>GoodCase.xAI · AI 编程好案例画廊</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#0b0e14; color:#dfe5ee; font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif; min-height:100vh; }
  header { padding:52px 6vw 26px; border-bottom:1px solid #1c2230; }
  h1 { font-size:30px; letter-spacing:.06em; }
  h1 b { color:#7aa2ff; }
  header p { margin-top:10px; color:#8b94a7; font-size:14px; line-height:1.7; }
  nav.tags { padding:18px 6vw 0; display:flex; gap:10px; flex-wrap:wrap; }
  .tag { font-size:12px; padding:5px 12px; border:1px solid #2a3245; border-radius:999px; color:#9fb0d0; }
  main { padding:28px 6vw 70px; display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:16px; }
  .card { display:block; background:#11151f; border:1px solid #1e2534; border-radius:12px; padding:18px 18px 16px;
          text-decoration:none; color:inherit; transition:all .18s; position:relative; }
  .card:hover { border-color:#3b5bdb; transform:translateY(-2px); box-shadow:0 8px 24px rgba(59,91,219,.18); }
  .card .ns { font-size:11px; letter-spacing:.08em; color:#6f7b93; margin-bottom:10px; overflow-wrap:anywhere; }
  .card h2 { font-size:15px; color:#e8edf7; margin-bottom:8px; word-break:break-all; }
  .card p { font-size:12.5px; color:#8b94a7; line-height:1.6; min-height:38px; }
  .card .open { position:absolute; right:16px; bottom:12px; font-size:12px; color:#7aa2ff; opacity:0; transition:opacity .18s; }
  .card:hover .open { opacity:1; }
  footer { padding:24px 6vw 40px; color:#5c6577; font-size:12px; border-top:1px solid #1c2230; }
</style>

<link rel="stylesheet" href="gallery.css?v=20261016">
<script src="gallery-data.js?v=20261016" defer></script>
<script src="gallery.js?v=20261016" defer></script>
</head>
<body>
<header>
  <h1>GoodCase<b>.xAI</b> · AI 编程好案例画廊</h1>
  <p>同一套工作环境下, 由 AI Agent 独立完成的成品案例集: 3D 展示、小游戏、工具面板、设计文档工程。
     按 AI 工具命名空间分组, 持续补充中。</p>
</header>
<nav class="tags">
  <span class="tag">共 %%TOTAL%% 个案例</span>
  <span class="tag">%%BREAKDOWN%%</span>
  <span class="tag">GitHub Pages 在线运行</span>
</nav>
<main>"""

TAIL = """</main>
<footer>GoodCase.xAI · generated gallery · 由 AI Agent 构建的每个案例均可直接打开运行</footer>
</body>
</html>
"""

CARD = (
    '    <a class="card" href="{href}">\n'
    '      <div class="ns">{agent}</div>\n'
    '      <h2>{title}</h2>\n'
    '      <p>{desc}</p>\n'
    '      <span class="open">打开 \u2192</span>\n'
    '    </a>\n'
)

ENTRY_CANDIDATES = ("index.html", "src/index.html", "dist/index.html", "README.md")


# ------------------------------------------------------------------ helpers --
def find_namespaces(root):
    """仓库里实际存在的命名空间目录（跳过隐藏目录与工具目录）"""
    skip = {"tools", ".git", ".github", "node_modules"}
    return sorted(
        d for d in os.listdir(root)
        if os.path.isdir(os.path.join(root, d))
        and not d.startswith(".")
        and d not in skip
    )


def count_pages(ns, d):
    """案例目录下的 html 页数（用于 `+N 页` 后缀）"""
    base = os.path.join(ROOT, ns) if d == "." else os.path.join(ROOT, ns, d)
    if not os.path.isdir(base):
        return 0
    n = 0
    for _, _, files in os.walk(base):
        n += sum(1 for f in files if f.lower().endswith((".html", ".htm")))
    return n


def detect_entry(ns, d):
    base = os.path.join(ROOT, ns) if d == "." else os.path.join(ROOT, ns, d)
    for cand in ENTRY_CANDIDATES:
        if os.path.isfile(os.path.join(base, cand)):
            return cand
    if os.path.isdir(base):
        for f in sorted(os.listdir(base)):
            if f.lower().endswith((".html", ".htm")):
                return f
    return None


def parse_readme(path):
    """从案例 README.md 推导 (title, agent, desc)"""
    try:
        with open(path, encoding="utf-8") as fh:
            lines = fh.read().splitlines()
    except OSError:
        return None, None, None

    title = agent = None
    desc_parts, started = [], False
    for raw in lines:
        s = raw.strip()
        if title is None and s.startswith("# "):
            title = s[2:].strip()
            continue
        if agent is None:
            m = re.match(r"^>\s*\*\*(.+?)\*\*\s*$", s)
            if m:
                agent = m.group(1).strip()
                started = True
                continue
        if started:
            if not s:
                if desc_parts:
                    break
                continue
            # 跳过图片 / 表格 / 引用 / 列表 / 次级标题
            if s.startswith(("![", "|", ">", "-", "*", "#", "```", "<")):
                if desc_parts:
                    break
                continue
            desc_parts.append(s)
            if len(" ".join(desc_parts)) > 120:
                break
    desc = " ".join(desc_parts)
    desc = re.sub(r"[*`]", "", desc).strip()
    return title, agent, desc


def scan_unregistered(root, known):
    """磁盘上存在但未登记的案例目录 -> [(ns, dir, entry)]

    默认只用于提醒，不自动上架：画廊是策展，发布应当是明确动作；
    这样也保证 --check 的结果与运行环境无关（换台机器跑一致）。
    """
    out = []
    for ns in find_namespaces(root):
        nsdir = os.path.join(root, ns)
        for d in sorted(os.listdir(nsdir)):
            if not os.path.isdir(os.path.join(nsdir, d)):
                continue
            if (ns, d) in known:
                continue
            entry = detect_entry(ns, d)
            if entry is None:
                continue          # 无入口文件的资源目录（如 frames/ render/），忽略
            out.append((ns, d, entry))
    return out


def discover(root, known):
    """把未登记的案例目录推导成卡片（仅 --with-discovery 时使用）"""
    found = []
    for ns, d, entry in scan_unregistered(root, known):
        title, agent, desc = parse_readme(os.path.join(root, ns, d, "README.md"))
        n = count_pages(ns, d)
        title = title or d
        if n > 1:
            title = "%s +%d 页" % (title, n - 1)
        found.append({
            "ns": ns, "dir": d, "entry": entry,
            "title": title, "desc": desc or title,
            "agent": agent or ns.capitalize(),
            "_auto": True,
        })
    return found


def esc(s):
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def render(manifest, auto):
    entries = [e for e in manifest["entries"] if not e.get("_hidden")]
    entries = entries + auto
    order = [n["id"] for n in manifest["namespaces"]]
    label = {n["id"]: n["label"] for n in manifest["namespaces"]}

    # 命名空间之外的新目录也要能显示出来
    for e in auto:
        if e["ns"] not in order:
            order.append(e["ns"])
            label[e["ns"]] = e["ns"].capitalize()

    def sort_key(e):
        # 目录型案例按目录名排；命名空间根目录下的独立文件按文件名排。
        # 条目的 "sort" 字段可覆盖默认排序键（例如把某个总览页钉在最前）。
        display = e["dir"] if e["dir"] != "." else os.path.splitext(e["entry"])[0]
        return (order.index(e["ns"]), e.get("sort", display).lower(), e["entry"].lower())

    blocks, counts, auto_dirs = [], [], []
    for ns in order:
        group = sorted([e for e in entries if e["ns"] == ns], key=sort_key)
        if not group:
            continue
        counts.append("%s %d" % (label[ns], len(group)))
        for e in group:
            href = e["entry"] if e["dir"] == "." else "%s/%s" % (e["dir"], e["entry"])
            href = "%s/%s" % (ns, href)
            blocks.append(CARD.format(
                href=esc(href), agent=esc(e["agent"]),
                title=esc(e["title"]), desc=esc(e["desc"])))
            if e.get("_auto"):
                auto_dirs.append("%s/%s" % (ns, e["dir"]))

    total = sum(int(c.rsplit(" ", 1)[1]) for c in counts)
    head = HEAD.replace("%%TOTAL%%", str(total)).replace("%%BREAKDOWN%%", " · ".join(counts))
    return head + "\n" + "".join(blocks) + TAIL, total, auto_dirs


def sync_readme(total, write):
    """把 README 里的 `index.html ← ... N 个案例入口` 同步为最新数字"""
    try:
        with open(README, encoding="utf-8") as fh:
            text = fh.read()
    except OSError:
        return None
    new = re.sub(
        r"(^index\.html(?:\s+)←\s+画廊首页).*$",
        lambda m: "%s(自动生成, %d 个案例入口)" % (m.group(1), total),
        text, count=1, flags=re.M)
    if new == text:
        return False
    if write:
        with open(README, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(new)
    return True


def main():
    ap = argparse.ArgumentParser(description="生成 GoodCase.xAI 画廊首页")
    ap.add_argument("--check", action="store_true", help="只校验，不一致则退出码 1")
    ap.add_argument("--dry-run", action="store_true", help="不写盘")
    ap.add_argument("--with-discovery", action="store_true",
                    help="把未登记的案例目录也推导成卡片一并写入（默认只提醒）")
    args = ap.parse_args()

    with open(MANIFEST, encoding="utf-8") as fh:
        manifest = json.load(fh)
    known = {(e["ns"], e["dir"]) for e in manifest["entries"]}

    unreg = scan_unregistered(ROOT, known)
    auto = discover(ROOT, known) if args.with_discovery else []
    page, total, auto_dirs = render(manifest, auto)

    old = ""
    if os.path.isfile(INDEX):
        with open(INDEX, encoding="utf-8") as fh:
            old = fh.read()

    if args.check:
        same = (page == old)
        print("[check] index.html %s (共 %d 个案例)" % ("一致" if same else "不一致", total))
        for d in sorted(set(auto_dirs) | {"%s/%s" % (a, b) for a, b, _ in unreg}):
            print("[check] 未登记案例：%s" % d)
        return 0 if same else 1

    if args.dry_run:
        sys.stdout.write(page)
        return 0

    with open(INDEX, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(page)
    readme_changed = sync_readme(total, True)
    counts = " · ".join(
        "%s %d" % (ns["label"], sum(1 for e in manifest["entries"] + auto if e["ns"] == ns["id"]))
        for ns in manifest["namespaces"])
    print("[build] index.html 已生成：共 %d 个案例（%s）" % (total, counts))
    print("[build] README.md 案例数 %s"
          % ("未找到 README" if readme_changed is None
             else ("已同步" if readme_changed else "无需改动")))
    if unreg:
        print("[warn] 以下目录存在但未登记到 gallery.json，本次未加入页面：")
        for a, b, _ in unreg:
            print("        - %s/%s" % (a, b))
        print("        确认要上架后请登记到 gallery.json；或用 --with-discovery 先看效果")
    return 0


if __name__ == "__main__":
    sys.exit(main())
