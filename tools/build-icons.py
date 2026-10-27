"""从代码绘制 ARK/SIM 图标，生成浏览器与 Windows 使用的图像。"""
import os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public' / 'icons'
FONT = next(p for p in [
    Path(os.environ.get('ARKSIM_ICON_FONT', '')),
    Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts' / 'ariblk.ttf',
    Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts' / 'arialbd.ttf',
    Path('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'),
] if p.is_file())


def draw_icon(size):
    scale = 4
    side = 512 * scale
    icon = Image.new('RGBA', (side, side))
    draw = ImageDraw.Draw(icon)

    def points(values):
        return [(int(x * scale), int(y * scale)) for x, y in values]

    diamond = points([(256, 14), (498, 256), (256, 498), (14, 256), (256, 14)])
    draw.polygon(points([(256, 24), (494, 262), (256, 500), (18, 262)]), fill='#00000055')
    draw.polygon(diamond, fill='#161b1f')
    font = ImageFont.truetype(str(FONT), 142 * scale)
    for word, baseline in [('ARK', 216), ('SIM', 392)]:
        draw.text((256 * scale, baseline * scale), word, font=font, anchor='ms',
                  fill='white', stroke_width=3 * scale, stroke_fill='#050607')
    if size >= 48:
        draw.polygon(points([(83, 234), (429, 234), (407, 278), (105, 278)]), fill='#e1e5e3')
        label = ImageFont.truetype(str(FONT), 29 * scale)
        draw.text((256 * scale, 266 * scale), 'RHODES ISLAND', font=label, anchor='ms', fill='#080a0b')
    draw.line(diamond, fill='#08090a', width=11 * scale, joint='curve')
    draw.line(points([(256, 25), (487, 256), (256, 487), (25, 256), (256, 25)]),
              fill='#55504a', width=3 * scale, joint='curve')
    return icon.resize((size, size), Image.Resampling.LANCZOS)


if __name__ == '__main__':
    images = {size: draw_icon(size) for size in [16, 24, 32, 48, 64, 128, 180, 192, 256, 512]}
    for size in [16, 32, 48]:
        images[size].save(OUT / f'favicon-{size}.png')
    for size in [192, 512]:
        images[size].save(OUT / f'app-{size}.png')
        background = Image.new('RGBA', (size, size), '#161b1f')
        mark = images[size].resize((round(size * .76), round(size * .76)), Image.Resampling.LANCZOS)
        margin = (size - mark.width) // 2
        background.alpha_composite(mark, (margin, margin))
        background.save(OUT / f'app-maskable-{size}.png')
    images[180].save(OUT / 'apple-touch-icon.png')
    sizes = [(size, size) for size in [16, 24, 32, 48, 64, 128, 256]]
    images[256].save(OUT / 'favicon.ico', format='ICO', sizes=sizes,
                     append_images=[images[size] for size in [16, 24, 32, 48, 64, 128]])
