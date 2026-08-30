#!/usr/bin/env python3
"""
Repaint the stock CC0 avatar into the Cash Cat, in place in the .vrm.

  python3 roomsrc/recolor_avatar.py <source.vrm> <out.vrm>

A .vrm is a GLB, so this pulls out the albedo PNG, rewrites its colours, and
splices the replacement back in — geometry, rig, UVs and the normal/mask
textures are untouched, which is why all 14 stock locomotion clips still
work afterwards. A generative image edit would destroy the UV layout, so the
recolour is done arithmetically instead.

Three things worth knowing before you change the numbers:

  * Fur is separated from the leather by HUE (fur ~0 deg, leather ~30 deg),
    not by saturation. The model's dark facial marking is hue ~0 at
    saturation ~0.5, so a saturation-based mask leaves it black while the
    rest of the head goes cream.
  * The fur mask is a soft weight. A hard cutoff bands visibly through the
    gradient around that marking.
  * The head island is atlas x 0-560, y 1360-2048 — confirmed by packing a
    colour-grid atlas and rendering it to see which cell landed on the
    muzzle. It needs a stronger lift than the body or the cat reads
    grey-faced rather than cream.
"""
import io
import json
import struct
import sys

import numpy as np
from PIL import Image

ALBEDO = 0          # index into gltf["images"]


def unpack(path):
    d = open(path, 'rb').read()
    _, _, length = struct.unpack('<III', d[:12])
    off, chunks = 12, []
    while off < length:
        clen, ctype = struct.unpack('<II', d[off:off + 8])
        chunks.append((ctype, off + 8, clen))
        off += 8 + clen
    gltf = json.loads(d[chunks[0][1]:chunks[0][1] + chunks[0][2]].decode('utf-8'))
    return gltf, bytearray(d[chunks[1][1]:chunks[1][1] + chunks[1][2]])


def recolor(png_bytes):
    src = Image.open(io.BytesIO(png_bytes)).convert('RGBA')
    a = np.array(src).astype(np.float32)
    rgb = a[..., :3] / 255.0

    mx = rgb.max(axis=-1); mn = rgb.min(axis=-1)
    v = mx
    d = mx - mn
    s = np.where(mx > 0, d / np.maximum(mx, 1e-6), 0)
    
    r, g, b = rgb[...,0], rgb[...,1], rgb[...,2]
    h = np.zeros_like(v)
    nz = d > 1e-6
    rmax = nz & (mx == r); gmax = nz & (mx == g) & ~rmax; bmax = nz & (mx == b) & ~rmax & ~gmax
    h[rmax] = ((g - b)[rmax] / d[rmax]) % 6
    h[gmax] = ((b - r)[gmax] / d[gmax]) + 2
    h[bmax] = ((r - g)[bmax] / d[bmax]) + 4
    h = h * 60.0
    
    # --- fur: mauve-grey -> the real cat's warm cream ---------------------------
    # The model has a near-black painted mask across the muzzle. A hard binary
    # mask either leaves it black or bands through the gradient around it, so the
    # fur is a SOFT weight instead: fur separates from the leather by HUE (fur
    # ~0 deg, leather ~30 deg), which lets the weight run to high saturation and
    # catch the dark marking without touching the clothing.
    def ramp(x, lo, hi):          # 1 below lo, 0 above hi, smooth between
        return np.clip((hi - x) / (hi - lo), 0.0, 1.0)
    
    hd = np.minimum(h, 360.0 - h)                 # hue distance from red
    w  = ramp(hd, 14.0, 30.0) * ramp(s, 0.45, 0.80) * np.clip((v - 0.015) / 0.035, 0, 1)
    
    tH = 38.0
    tS = 0.13 + 0.14 * s
    tV = np.clip(np.power(v, 0.45) * 0.95, 0, 1)  # lifts the dark marking to a
                                                  # warm tan rather than black
    # The head island is atlas x 0-560, y 1360-2048 (confirmed by rendering a
    # colour-grid atlas and reading which cell landed on the muzzle). The painted
    # face marking there is far darker than body shading, so it gets a stronger
    # lift on its own — otherwise the cat reads as grey-faced rather than cream.
    yy, xx = np.mgrid[0:h.shape[0], 0:h.shape[1]]
    head = (np.clip((560 + 40 - xx) / 40.0, 0, 1) *
            np.clip((yy - (1360 - 40)) / 40.0, 0, 1))
    tV = tV + (np.clip(0.34 + 0.62 * np.power(v, 0.7), 0, 1) - tV) * head
    
    H = h + (tH - h) * w
    S = s + (tS - s) * w
    V = v + (tV - v) * w
    
    # --- eyes: big cyan iris -> warm amber ---------------------------------------
    # these discs cover most of the face on this model, so anything near-black
    # reads as a mask rather than as eyes. amber suits a cream cat and the brand.
    eyes = (h > 172) & (h < 218) & (s > 0.38)
    H[eyes] = 33.0
    S[eyes] = 0.62
    V[eyes] = np.clip(v[eyes] * 0.82, 0, 1)
    
    # --- vest: muted green -> CashCats green ------------------------------------
    vest = (h >= 90) & (h <= 165) & (s > 0.12)
    H[vest] = 152.0
    S[vest] = np.clip(s[vest] * 2.2, 0, 0.78)
    V[vest] = np.clip(v[vest] * 1.12, 0, 1)
    
    # --- leather: push the browns towards the brand gold ------------------------
    tan = (h >= 20) & (h <= 48) & (s > 0.42)
    H[tan] = 40.0
    S[tan] = np.clip(s[tan] * 1.05, 0, 0.85)
    V[tan] = np.clip(v[tan] * 1.12, 0, 1)
    
    # hsv -> rgb
    Hp = H / 60.0
    C = V * S
    X = C * (1 - np.abs((Hp % 2) - 1))
    m = V - C
    z = np.zeros_like(V)
    i = np.floor(Hp).astype(np.int32) % 6
    sel = [i == k for k in range(6)]
    R = np.select(sel, [C, X, z, z, X, C]) + m
    G = np.select(sel, [X, C, C, X, z, z]) + m
    B = np.select(sel, [z, z, X, C, C, X]) + m

    out = a.copy()
    out[..., 0] = np.clip(R, 0, 1) * 255
    out[..., 1] = np.clip(G, 0, 1) * 255
    out[..., 2] = np.clip(B, 0, 1) * 255
    buf = io.BytesIO()
    Image.fromarray(out.astype(np.uint8), 'RGBA').save(buf, format='PNG')
    return buf.getvalue()


def main(src_path, out_path):
    gltf, blob = unpack(src_path)
    bv = gltf['bufferViews'][gltf['images'][ALBEDO]['bufferView']]
    off, old_len = bv.get('byteOffset', 0), bv['byteLength']

    new = recolor(bytes(blob[off:off + old_len]))
    delta = len(new) - old_len
    blob[off:off + old_len] = new
    for view in gltf['bufferViews']:          # every later view shifts
        o = view.get('byteOffset', 0)
        if o > off:
            view['byteOffset'] = o + delta
    bv['byteLength'] = len(new)
    gltf['buffers'][0]['byteLength'] = len(blob)

    js = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    js += b' ' * ((4 - len(js) % 4) % 4)      # both chunks are 4-byte aligned
    while len(blob) % 4:
        blob += b'\x00'

    glb = bytearray()
    glb += struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob))
    glb += struct.pack('<II', len(js), 0x4E4F534A) + js
    glb += struct.pack('<II', len(blob), 0x004E4942) + bytes(blob)
    open(out_path, 'wb').write(glb)
    print('wrote %s (%.1f MB)' % (out_path, len(glb) / 1e6))


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__.strip())
    main(sys.argv[1], sys.argv[2])
