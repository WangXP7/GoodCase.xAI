#!/usr/bin/env python3
from pathlib import Path
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'models' / 'people' / '25D'
OUT = SRC / 'classes'

SHEETS = {
    'idle': {
        'path': SRC / 'idle' / 'Sprite Sheet' / 'idle full sprite sheet (transparent BG).png',
        'cell': 64,
    },
    'walk': {
        'path': SRC / 'walk' / 'Sprite Sheet' / 'walk complete sprite sheet (transparent BG).png',
        'cell': 64,
    },
    'attack': {
        'path': SRC / 'attack' / 'Sprite Sheet' / 'attack full sprite sheet (transparent BG).png',
        'cell': 96,
    },
}

CLASSES = ['knight', 'baird', 'wizard', 'knave']


def frame_box(frame):
    box = frame.getbbox()
    if not box:
      return (frame.width // 3, frame.height // 4, frame.width * 2 // 3, frame.height * 3 // 4)
    return box


def draw_poly(d, points, fill, outline=(38, 32, 28, 230), width=1):
    d.polygon(points, fill=fill)
    d.line(points + [points[0]], fill=outline, width=width)


def overlay_knight(frame):
    d = ImageDraw.Draw(frame)
    x0, y0, x1, y1 = frame_box(frame)
    w = x1 - x0
    h = y1 - y0
    cx = (x0 + x1) / 2
    metal = (174, 184, 194, 220)
    dark = (74, 82, 92, 230)
    d.ellipse((cx - w * 0.34, y0 + h * 0.05, cx + w * 0.34, y0 + h * 0.30), fill=metal, outline=dark, width=1)
    d.rectangle((cx - w * 0.22, y0 + h * 0.43, cx + w * 0.22, y0 + h * 0.72), fill=(150, 160, 172, 190), outline=dark, width=1)
    d.line((cx - w * 0.20, y0 + h * 0.55, cx + w * 0.20, y0 + h * 0.67), fill=(78, 108, 152, 230), width=1)
    draw_poly(d, [(x1 - w * 0.18, y0 + h * 0.50), (x1 + w * 0.18, y0 + h * 0.60), (x1 + w * 0.04, y0 + h * 0.82), (x1 - w * 0.20, y0 + h * 0.72)], (68, 94, 132, 210))
    return frame


def overlay_baird(frame):
    d = ImageDraw.Draw(frame)
    x0, y0, x1, y1 = frame_box(frame)
    w = x1 - x0
    h = y1 - y0
    cx = (x0 + x1) / 2
    draw_poly(d, [(cx - w * 0.30, y0 + h * 0.42), (cx + w * 0.30, y0 + h * 0.42), (cx + w * 0.38, y1), (cx - w * 0.38, y1)], (54, 126, 91, 178))
    d.line((cx - w * 0.22, y0 + h * 0.55, cx + w * 0.22, y0 + h * 0.55), fill=(217, 171, 75, 235), width=1)
    d.ellipse((x1 - w * 0.26, y0 + h * 0.54, x1 + w * 0.22, y0 + h * 0.78), fill=(125, 80, 43, 225), outline=(46, 32, 24, 230), width=1)
    d.line((x1 - w * 0.20, y0 + h * 0.53, x1 + w * 0.18, y0 + h * 0.77), fill=(222, 180, 82, 240), width=1)
    d.line((cx - w * 0.10, y0 + h * 0.08, cx + w * 0.34, y0 - h * 0.06), fill=(224, 72, 63, 230), width=1)
    return frame


def overlay_wizard(frame):
    d = ImageDraw.Draw(frame)
    x0, y0, x1, y1 = frame_box(frame)
    w = x1 - x0
    h = y1 - y0
    cx = (x0 + x1) / 2
    robe = (103, 75, 168, 205)
    brim = (66, 50, 112, 235)
    d.ellipse((cx - w * 0.42, y0 + h * 0.25, cx + w * 0.42, y0 + h * 0.36), fill=brim, outline=(39, 31, 64, 240), width=1)
    draw_poly(d, [(cx, y0 - h * 0.16), (cx + w * 0.34, y0 + h * 0.30), (cx - w * 0.34, y0 + h * 0.30)], robe)
    draw_poly(d, [(cx - w * 0.32, y0 + h * 0.46), (cx + w * 0.32, y0 + h * 0.46), (cx + w * 0.45, y1), (cx - w * 0.45, y1)], robe)
    d.line((x0 - w * 0.18, y0 + h * 0.45, x0 - w * 0.30, y1), fill=(100, 70, 39, 235), width=2)
    d.ellipse((x0 - w * 0.26, y0 + h * 0.39, x0 - w * 0.10, y0 + h * 0.50), fill=(238, 207, 91, 240))
    return frame


def overlay_knave(frame):
    d = ImageDraw.Draw(frame)
    x0, y0, x1, y1 = frame_box(frame)
    w = x1 - x0
    h = y1 - y0
    cx = (x0 + x1) / 2
    hood = (42, 55, 67, 190)
    tunic = (54, 82, 86, 178)
    draw_poly(d, [(cx - w * 0.30, y0 + h * 0.12), (cx, y0 - h * 0.03), (cx + w * 0.30, y0 + h * 0.12), (cx + w * 0.24, y0 + h * 0.36), (cx - w * 0.24, y0 + h * 0.36)], hood)
    draw_poly(d, [(cx - w * 0.32, y0 + h * 0.46), (cx + w * 0.32, y0 + h * 0.46), (cx + w * 0.42, y1), (cx - w * 0.42, y1)], tunic)
    d.line((cx - w * 0.34, y0 + h * 0.54, cx + w * 0.34, y0 + h * 0.70), fill=(168, 55, 48, 225), width=2)
    d.line((cx - w * 0.34, y0 + h * 0.82, cx + w * 0.32, y0 + h * 0.70), fill=(104, 65, 38, 225), width=1)
    return frame


OVERLAYS = {
    'knight': overlay_knight,
    'baird': overlay_baird,
    'wizard': overlay_wizard,
    'knave': overlay_knave,
}


def generate_sheet(action, info, class_name):
    src = Image.open(info['path']).convert('RGBA')
    cell = info['cell']
    out = Image.new('RGBA', src.size, (0, 0, 0, 0))
    overlay = OVERLAYS[class_name]
    for y in range(0, src.height, cell):
        for x in range(0, src.width, cell):
            frame = src.crop((x, y, x + cell, y + cell)).copy()
            frame = overlay(frame)
            out.alpha_composite(frame, (x, y))
    return out


def main():
    for class_name in CLASSES:
        target = OUT / class_name
        target.mkdir(parents=True, exist_ok=True)
        for action, info in SHEETS.items():
            generate_sheet(action, info, class_name).save(target / f'{action}.png')


if __name__ == '__main__':
    main()
