# -*- coding: utf-8 -*-
"""生成 fnOS/UGOS 应用图标（ICON_256.PNG / ICON.PNG 及 ui/images）。

无参数运行，输出到本脚本同级 fnos/ 目录：
  fnos/ICON_256.PNG        256x256
  fnos/ICON.PNG             64x64
  fnos/ui/images/256.png
  fnos/ui/images/64.png
"""
from PIL import Image, ImageDraw
from pathlib import Path

OUT = Path(__file__).resolve().parent / "fnos"


def rounded_gradient(size: int) -> Image.Image:
    img = Image.new("RGB", (size, size))
    px = img.load()
    top = (13, 148, 136)    # teal
    bottom = (30, 90, 210)  # blue
    for y in range(size):
        t = y / (size - 1)
        r = int(top[0] + (bottom[0] - top[0]) * t)
        g = int(top[1] + (bottom[1] - top[1]) * t)
        b = int(top[2] + (bottom[2] - top[2]) * t)
        for x in range(size):
            px[x, y] = (r, g, b)

    # 圆角蒙版
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    radius = int(size * 0.22)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def draw_glyph(img: Image.Image) -> Image.Image:
    size = img.size[0]
    d = ImageDraw.Draw(img)
    s = size / 256.0  # 设计坐标基于 256

    # SIM 卡（白色，右上斜切角）
    sim = [66 * s, 48 * s, 156 * s, 200 * s]
    cut = 26 * s
    d.polygon(
        [(sim[0], sim[1]), (sim[2] - cut, sim[1]), (sim[2], sim[1] + cut),
         (sim[2], sim[3]), (sim[0], sim[3])],
        fill=(255, 255, 255, 255),
    )

    # SIM 芯片（金色网格）
    chip = [88 * s, 78 * s, 134 * s, 118 * s]
    d.rounded_rectangle(chip, radius=4 * s, fill=(212, 175, 55, 255))
    for cx in (100 * s, 112 * s, 124 * s):
        d.line([(cx, chip[1]), (cx, chip[3])], fill=(160, 130, 40, 255), width=max(1, int(2 * s)))
    for cy in (98 * s,):
        d.line([(chip[0], cy), (chip[2], cy)], fill=(160, 130, 40, 255), width=max(1, int(2 * s)))

    # 聊天气泡（白色，右下角）
    bub = [140 * s, 128 * s, 218 * s, 184 * s]
    d.rounded_rectangle(bub, radius=14 * s, fill=(255, 255, 255, 255))
    d.polygon([(bub[0] + 14 * s, bub[3] - 1 * s), (bub[0] + 30 * s, bub[3] - 1 * s),
               (bub[0] + 16 * s, bub[3] + 16 * s)], fill=(255, 255, 255, 255))
    # 气泡内三点（主题色）
    for i, cx in enumerate((160 * s, 179 * s, 198 * s)):
        cy = 156 * s
        r = 6 * s
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(20, 130, 190, 255))

    return img


def main() -> None:
    images_dir = OUT / "ui" / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    for size, *names in (
        (256, OUT / "ICON_256.PNG", images_dir / "256.png"),
        (64, OUT / "ICON.PNG", images_dir / "64.png"),
    ):
        img = draw_glyph(rounded_gradient(size))
        for name in names:
            img.save(name)
            print(f"wrote {name}")


if __name__ == "__main__":
    main()
