from pathlib import Path
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "build"
BUILD.mkdir(exist_ok=True)

size = 256
image = Image.new("RGBA", (size, size), (27, 17, 13, 255))
draw = ImageDraw.Draw(image)

# Warm desk vignette.
for radius in range(176, 10, -4):
    alpha = int(110 * (radius / 176))
    color = (77 + radius // 8, 40 + radius // 13, 23, alpha)
    draw.ellipse((128 - radius, 128 - radius, 128 + radius, 128 + radius), fill=color)

# Fat woolly body built from original procedural circles.
wool = (241, 232, 209, 255)
shade = (207, 194, 168, 255)
for x, y, r in [
    (75, 117, 43), (105, 91, 43), (143, 88, 44), (174, 112, 42),
    (83, 152, 44), (121, 157, 46), (160, 151, 45), (123, 119, 57)
]:
    draw.ellipse((x-r, y-r, x+r, y+r), fill=shade)
    draw.ellipse((x-r, y-r-4, x+r, y+r-4), fill=wool)

# Face, ears, eyes and coin slot.
face = (71, 55, 45, 255)
draw.ellipse((87, 104, 168, 190), fill=face)
draw.polygon([(92, 126), (62, 112), (84, 148)], fill=face)
draw.polygon([(163, 126), (194, 112), (171, 148)], fill=face)
draw.ellipse((105, 129, 118, 143), fill=(15, 13, 12, 255))
draw.ellipse((138, 129, 151, 143), fill=(15, 13, 12, 255))
draw.ellipse((109, 131, 113, 135), fill=(255, 255, 255, 255))
draw.ellipse((142, 131, 146, 135), fill=(255, 255, 255, 255))
draw.rounded_rectangle((108, 167, 148, 180), radius=6, fill=(35, 27, 23, 255))
draw.rounded_rectangle((100, 54, 156, 65), radius=5, fill=(37, 28, 23, 255))

# Small golden hammer motif.
gold = (235, 184, 72, 255)
handle = (126, 75, 43, 255)
draw.rounded_rectangle((184, 46, 202, 126), radius=8, fill=handle)
draw.rounded_rectangle((158, 29, 229, 65), radius=9, fill=gold)
draw.line((169, 37, 218, 37), fill=(255, 221, 132, 255), width=4)

png = BUILD / "icon.png"
ico = BUILD / "icon.ico"
image.save(png)
image.save(ico, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print(f"generated {png} and {ico}")
