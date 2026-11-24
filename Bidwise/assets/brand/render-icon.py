"""Draws the app icon PNGs from the geometry in bidwise-icon.svg (1024 design space),
at 4x supersampling. Needs Pillow and numpy.

  python -I assets/brand/render-icon.py <outDir>

Writes square.png (opaque, for the app icon), rounded.png (transparent corners) and
small.png (a 60 px check, enlarged).
"""
import sys
import numpy as np
from PIL import Image, ImageDraw

out = sys.argv[1]
SS = 4
N = 1024 * SS


def hexc(h):
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], float)


ys, xs = np.mgrid[0:N, 0:N]
t = ((xs + ys) / (2.0 * (N - 1)))[..., None]
img = hexc('#273352') * (1 - t) + hexc('#0f1422') * t


def mask_of(fn):
    m = Image.new('L', (N, N), 0)
    fn(ImageDraw.Draw(m))
    return np.asarray(m, float)[..., None] / 255.0


def paint(fill, m):
    global img
    img = img * (1 - m) + fill * m


def rrect(d, x, y, w, h, r):
    d.rounded_rectangle([x * SS, y * SS, (x + w) * SS - 1, (y + h) * SS - 1], radius=r * SS, fill=255)


def circ(d, cx, cy, r):
    d.ellipse([(cx - r) * SS, (cy - r) * SS, (cx + r) * SS, (cy + r) * SS], fill=255)


paint(hexc('#5f719a'), mask_of(lambda d: rrect(d, 196, 576, 156, 236, 42)))
paint(hexc('#8ca7d8'), mask_of(lambda d: rrect(d, 382, 452, 156, 360, 42)))
# Tallest bar: gradient #3b6ce7 (bottom, y 812) to #8db0ff (top, y 304).
g = np.clip((812 - ys / SS) / 508.0, 0, 1)[..., None]
paint(hexc('#3b6ce7') * (1 - g) + hexc('#8db0ff') * g, mask_of(lambda d: rrect(d, 568, 304, 156, 508, 42)))
paint(hexc('#131a2b'), mask_of(lambda d: circ(d, 716, 292, 151)))
paint(hexc('#10b981'), mask_of(lambda d: circ(d, 716, 292, 131)))


def tick(d):
    pts = [(651, 294), (699, 342), (784, 245)]
    w = 59
    d.line([(x * SS, y * SS) for x, y in pts], fill=255, width=w * SS, joint='curve')
    for x, y in (pts[0], pts[-1]):
        circ(d, x, y, w / 2)


paint(hexc('#ffffff'), mask_of(tick))
sq = Image.fromarray(np.clip(img + 0.5, 0, 255).astype('uint8')).resize((1024, 1024), Image.LANCZOS)
sq.save(out + '/square.png')
mk = Image.new('L', (N, N), 0)
ImageDraw.Draw(mk).rounded_rectangle([0, 0, N - 1, N - 1], radius=228 * SS, fill=255)
r = sq.convert('RGBA')
r.putalpha(mk.resize((1024, 1024), Image.LANCZOS))
r.save(out + '/rounded.png')
sq.resize((60, 60), Image.LANCZOS).resize((240, 240), Image.NEAREST).save(out + '/small.png')
print('ok', sq.size, sq.mode)
