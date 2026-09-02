# -*- coding: utf-8 -*-
"""
A water albedo that is not a tile.

t_water.jpg was a flat blue field with a faint regular diagonal crosshatch
over it -- which is, precisely, what bathroom tile looks like, and that is
what the lake read as. A regular grid is the one thing water never has.

Prims take ONE albedo map and nothing else (Prim.js getMaterial) -- no normal,
no roughness, no flow map -- so everything that makes this read as water has
to be in these pixels plus the material's roughness and metalness, which are
already 0.06 and 0.32 so the surface mirrors the HDRI sky.

What that leaves is: irregular low-frequency swell, higher-frequency ripple
riding on it, and a few bright glints. Built from value noise at four octaves
with the axes scaled differently so nothing lines up into a grid, then wrapped
so the sheet tiles seamlessly at the edges -- the lake is one 38x44m prim, so
the map is stretched, not repeated, but seamlessness costs nothing and keeps
it usable elsewhere.
"""
import math, os, random

SIZE = 1024
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tex', 't_water.jpg')

DEEP  = (0x2f, 0x84, 0xa8)     # trough
MID   = (0x55, 0xa8, 0xc8)
CREST = (0x9d, 0xd8, 0xe8)     # lit crest
GLINT = (0xf2, 0xfb, 0xff)


def value_noise(w, h, freq, seed):
    """Bilinear value noise on a wrapping lattice."""
    rnd = random.Random(seed)
    g = [[rnd.random() for _ in range(freq)] for _ in range(freq)]
    out = [[0.0] * w for _ in range(h)]
    for y in range(h):
        fy = y / h * freq
        y0 = int(fy) % freq; y1 = (y0 + 1) % freq; ty = fy - int(fy)
        ty = ty * ty * (3 - 2 * ty)                      # smoothstep
        for x in range(w):
            fx = x / w * freq
            x0 = int(fx) % freq; x1 = (x0 + 1) % freq; tx = fx - int(fx)
            tx = tx * tx * (3 - 2 * tx)
            a = g[y0][x0] * (1 - tx) + g[y0][x1] * tx
            b = g[y1][x0] * (1 - tx) + g[y1][x1] * tx
            out[y][x] = a * (1 - ty) + b * ty
    return out


def main():
    from PIL import Image
    w = h = SIZE
    # Four octaves. The frequencies are deliberately not multiples of each
    # other -- 3, 7, 17, 37 -- so no two layers ever line up and produce the
    # repeating diamond the old sheet had.
    layers = [(value_noise(w, h, 3, 11), 0.42),
              (value_noise(w, h, 7, 23), 0.24),
              (value_noise(w, h, 17, 37), 0.20),
              (value_noise(w, h, 37, 53), 0.14)]
    # A directional swell, so the surface has a heading rather than being
    # isotropic mush. Water in an open lake almost always does.
    px = Image.new('RGB', (w, h))
    put = px.load()
    for y in range(h):
        for x in range(w):
            n = sum(l[y][x] * k for l, k in layers)
            swell = 0.5 + 0.5 * math.sin((x * 0.9 + y * 2.1) / w * math.tau * 2.0 + n * 3.4)
            v = n * 0.86 + swell * 0.14   # swell as a hint, not as stripes
            v = min(1.0, max(0.0, (v - 0.30) / 0.45))     # stretch the range
            if v < 0.55:
                t = v / 0.55
                c = [DEEP[i] + (MID[i] - DEEP[i]) * t for i in range(3)]
            else:
                t = (v - 0.55) / 0.45
                c = [MID[i] + (CREST[i] - MID[i]) * t for i in range(3)]
            # glints on the very tops only, and sparse
            # Glints on the very tops only. At 0.93 over a wide band they came
            # out as fat white blobs that read as cloud reflections; narrow and
            # high, they read as sun catching a crest.
            if v > 0.965:
                t = (v - 0.965) / 0.035
                c = [c[i] + (GLINT[i] - c[i]) * (t ** 0.6) for i in range(3)]
            put[x, y] = (int(c[0]), int(c[1]), int(c[2]))
    px.save(OUT, quality=92)
    print('  wrote %s  (%d KB)' % (os.path.relpath(OUT), os.path.getsize(OUT) // 1024))


if __name__ == '__main__':
    main()
