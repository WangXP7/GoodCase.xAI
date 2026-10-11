# -*- coding: utf-8 -*-
"""为画廊大图生成轻量缩略图：thumbs/<case>/<name>.jpg"""
import os
from PIL import Image

ROOT = r"SVG-AI-TEST"

def make_thumb(src, dst, max_side=880, q=82):
    im = Image.open(src)
    im.thumbnail((max_side, max_side), Image.LANCZOS)
    if im.mode in ('RGBA', 'LA', 'P'):
        im = im.convert('RGBA')
        bg = Image.new('RGB', im.size, (11, 16, 29))
        bg.paste(im, mask=im.split()[-1])
        im = bg
    elif im.mode != 'RGB':
        im = im.convert('RGB')
    im.save(dst, 'JPEG', quality=q, progressive=True, optimize=True)
    return os.path.getsize(dst)

def main():
    n = 0
    for case in sorted(os.listdir(ROOT)):
        cp = os.path.join(ROOT, case)
        if not os.path.isdir(cp) or case.startswith('.') or case == 'thumbs':
            continue
        for root, _, files in os.walk(cp):
            if os.sep + 'thumbs' in root:
                continue
            for f in files:
                if f.rsplit('.', 1)[-1].lower() not in ('png', 'jpg', 'jpeg'):
                    continue
                src = os.path.join(root, f)
                if os.path.getsize(src) < 150 * 1024:
                    continue  # 小图不缩
                rel = os.path.relpath(src, ROOT).replace(os.sep, '/')
                dst = os.path.join(ROOT, 'thumbs', rel) + '.jpg'
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                s = make_thumb(src, dst)
                n += 1
                print(f"{s/1024:6.0f} KB  thumbs/{rel}.jpg")
    print('thumbs:', n)

if __name__ == '__main__':
    main()
