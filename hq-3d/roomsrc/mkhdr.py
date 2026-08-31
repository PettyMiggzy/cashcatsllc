"""
Build a Radiance .hdr from an LDR panorama.

Hyperfy lights the whole world from scene.environment, which is loaded with
RGBELoader and so needs a real .hdr — not a PNG. Venice only produces LDR, so
the image is de-gamma'd back to linear, given a modest highlight boost so the
sky still reads as a light source, and written out in RGBE.
"""
import struct
import sys

import numpy as np
from PIL import Image


def to_rgbe(rgb):
    """float RGB -> 4x uint8 RGBE, the Radiance shared-exponent format."""
    mx = rgb.max(axis=-1)
    out = np.zeros(rgb.shape[:2] + (4,), dtype=np.uint8)
    nz = mx > 1e-8
    exp = np.zeros_like(mx)
    mant = np.zeros_like(mx)
    mant[nz], exp_i = np.frexp(mx[nz])
    exp[nz] = exp_i
    scale = np.zeros_like(mx)
    scale[nz] = mant[nz] * 256.0 / mx[nz]
    out[..., :3] = np.clip(rgb * scale[..., None], 0, 255).astype(np.uint8)
    out[..., 3] = np.clip(exp + 128, 0, 255).astype(np.uint8)
    out[~nz] = 0
    return out


def main(src, dst, size=(2048, 1024), boost=2.6):
    im = Image.open(src).convert('RGB').resize(size, Image.LANCZOS)
    a = np.asarray(im).astype(np.float32) / 255.0
    lin = np.power(a, 2.2)                      # undo display gamma
    # push the brightest part of the sky above 1.0 so it behaves like light
    lum = lin.mean(axis=-1, keepdims=True)
    lin = lin * (1.0 + (boost - 1.0) * np.clip((lum - 0.45) / 0.55, 0, 1))

    rgbe = to_rgbe(lin)
    h, w = rgbe.shape[:2]
    with open(dst, 'wb') as f:
        f.write(b'#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n')
        f.write(b'-Y %d +X %d\n' % (h, w))
        f.write(rgbe.tobytes())                 # flat, uncompressed scanlines
    print('wrote %s  %dx%d  %.1f MB' % (dst, w, h, (len(rgbe.tobytes()) / 1e6)))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
