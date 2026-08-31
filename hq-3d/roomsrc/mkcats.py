#!/usr/bin/env python3
"""
Sculpt the cast as real meshes and write them into a single .glb.

Assembling primitives was the wrong tool: you can always see the spheres,
and the joins between body parts are hard edges where a real animal is
continuous. This instead defines each cat as a field of overlapping
ellipsoidal metaballs, so neighbouring parts blend into one another, and
pulls a single smooth surface out of that field with marching cubes.

Venice has no 3D model — 338 models across text, image, video, music,
embedding, tts, upscale, inpaint and asr, and not one mesh generator — so
the geometry is generated here rather than fetched.

    python3 roomsrc/mkcats.py roomsrc/cats.glb

Every cat is emitted at the origin, facing +Z, feet at y=0, under a node
named `cat_<key>`. Placement is left to whichever app loads the file.
"""
import json
import struct
import sys

import numpy as np
from skimage import measure

# Each part is an ellipsoid signed-distance field, and the parts are combined
# with an exponential smooth-minimum so neighbours fuse into one continuous
# body instead of reading as separate lumps.
#
# The first attempt used Wyvill metaballs, where a lone blob's surface sits at
# only ~0.45 of its stated radius. Every part came out thin and the tail broke
# into beads. An SDF means a radius means what it says.
# Larger k means a TIGHTER union. Summing exponentials across many overlapping
# parts inflates the surface the way metaballs do, so a soft k melts the head
# into the shoulders and swallows the legs. 26 keeps the parts legible while
# still fusing them.
BLEND = 26.0


def blob(c, r):
    return {'c': np.array(c, dtype=np.float32), 'r': np.array(r, dtype=np.float32)}


def taper(a, b, ra, rb, n=5):
    """A chain of shrinking blobs from a to b — legs, tails, ears."""
    a, b = np.array(a, dtype=np.float32), np.array(b, dtype=np.float32)
    out = []
    for i in range(n):
        t = i / (n - 1)
        c = a + (b - a) * t
        s = ra + (rb - ra) * t
        out.append(blob(c, [s, s, s]))
    return out


def cat_blobs(pose='sit', girth=1.0, headR=1.0, earH=1.0, bodyLen=1.0, mouth=False):
    g = 0.6 + 0.4 * girth
    B = []
    if pose == 'sit':
        B += [blob((0, 0.34, -0.16), (0.54 * g, 0.36, 0.62 * g)),
              blob((0, 0.62, -0.22), (0.46 * g, 0.36, 0.50)),
              blob((0, 0.80, 0.02), (0.38 * g, 0.40, 0.36)),
              blob((0, 1.02, 0.06), (0.30 * g, 0.26, 0.28)),
              blob((0, 1.16, 0.07), (0.185, 0.17, 0.19))]
        for sx in (-1, 1):
            B += taper((sx * 0.18, 0.58, 0.26), (sx * 0.18, 0.10, 0.32), 0.11, 0.09, 4)
            B += [blob((sx * 0.18, 0.07, 0.42), (0.11, 0.08, 0.17)),
                  blob((sx * 0.34 * g, 0.11, 0.02), (0.14, 0.10, 0.23))]
        hy, hz = 1.40, 0.10
        tail0 = (0.18, 0.14, -0.52)
    else:
        L = 0.60 * bodyLen
        B += [blob((0, 0.88, 0.0), (0.34 * g, 0.33, L)),
              blob((0, 0.92, L * 0.70), (0.31 * g, 0.31, 0.30)),
              blob((0, 0.86, -L * 0.74), (0.33 * g, 0.32, 0.30))]
        for sx in (-1, 1):
            for sz in (1, -1):
                B += taper((sx * 0.21, 0.80, sz * L * 0.64), (sx * 0.21, 0.10, sz * L * 0.64), 0.10, 0.085, 4)
                B += [blob((sx * 0.21, 0.07, sz * L * 0.64 + 0.04), (0.11, 0.08, 0.15))]
        B += taper((0, 0.95, L + 0.02), (0, 1.16, L + 0.20), 0.17, 0.15, 3)
        hy, hz = 1.24, L + 0.32
        tail0 = (0.14, 0.86, -L - 0.20)

    h = 0.30 * headR
    B += [blob((0, hy, hz), (h, h * 0.94, h * 0.98)),
          blob((0, hy - 0.05, hz + h * 0.72), (h * 0.56, h * 0.44, h * 0.50)),
          blob((0, hy - 0.01, hz + h * 1.02), (h * 0.22, h * 0.18, h * 0.20))]
    for sx in (-1, 1):
        B.append(blob((sx * h * 0.74, hy - 0.05, hz + 0.02), (h * 0.38, h * 0.42, h * 0.38)))
        # ears: a short taper, which marching cubes rounds into a real ear
        B += taper((sx * h * 0.60, hy + h * 0.56, hz - 0.02),
                   (sx * h * 0.86, hy + h * 0.56 + 0.26 * earH, hz - 0.05),
                   0.115 * headR, 0.045 * headR, 5)
    if mouth:
        B.append(blob((0, hy - 0.16, hz + h * 0.80), (h * 0.36, h * 0.40, h * 0.34)))

    B += taper(tail0, (tail0[0] + 0.66, tail0[1] + 0.66, tail0[2] - 0.02), 0.085, 0.05, 11)
    return B


def surface(blobs, step=0.023, pad=0.14):
    # step is the whole quality/weight dial. 0.016 looks marginally crisper and
    # costs about twice the triangles, which is the wrong trade for a statue
    # you mostly see from several metres away in a browser.
    lo = np.min([b['c'] - b['r'] for b in blobs], axis=0) - pad
    hi = np.max([b['c'] + b['r'] for b in blobs], axis=0) + pad
    dims = np.maximum(((hi - lo) / step).astype(int) + 1, 8)
    xs = [lo[i] + np.arange(dims[i]) * step for i in range(3)]

    # accumulate exp(-k*d) per part, then res = -log(sum)/k. inside is negative.
    acc = np.zeros(tuple(dims), dtype=np.float32)
    for b in blobs:
        reach = b['r'].max() + pad
        i0 = np.maximum(((b['c'] - reach - lo) / step).astype(int), 0)
        i1 = np.minimum(((b['c'] + reach - lo) / step).astype(int) + 2, dims)
        if np.any(i1 <= i0):
            continue
        gx = xs[0][i0[0]:i1[0]][:, None, None]
        gy = xs[1][i0[1]:i1[1]][None, :, None]
        gz = xs[2][i0[2]:i1[2]][None, None, :]
        u = np.sqrt(((gx - b['c'][0]) / b['r'][0]) ** 2 +
                    ((gy - b['c'][1]) / b['r'][1]) ** 2 +
                    ((gz - b['c'][2]) / b['r'][2]) ** 2)
        d = (u - 1.0) * float(b['r'].min())      # approximate signed distance
        acc[i0[0]:i1[0], i0[1]:i1[1], i0[2]:i1[2]] += np.exp(-BLEND * d, dtype=np.float32)

    field = np.where(acc > 1e-12, -np.log(np.maximum(acc, 1e-12)) / BLEND, 1.0)
    verts, faces, normals, _ = measure.marching_cubes(field.astype(np.float32), 0.0,
                                                      spacing=(step,) * 3)
    verts = verts + lo
    verts[:, 1] -= verts[:, 1].min()      # sit the feet on y = 0
    return verts.astype(np.float32), faces.astype(np.uint32), (-normals).astype(np.float32)


CATS = [
    ('cash',    dict(pose='sit',   girth=1.00, headR=1.00, earH=1.05), 'gold'),
    ('long',    dict(pose='stand', girth=0.82, headR=0.94, bodyLen=2.10), 'stone'),
    ('serious', dict(pose='sit',   girth=1.18, headR=1.12, earH=0.88), 'stone'),
    ('apple',   dict(pose='sit',   girth=1.34, headR=1.26, earH=0.82), 'stone'),
    ('pop',     dict(pose='sit',   girth=0.95, headR=1.06, earH=1.12, mouth=True), 'stone'),
]

MATERIALS = [
    {'name': 'stone', 'pbrMetallicRoughness': {
        'baseColorFactor': [0.86, 0.83, 0.75, 1.0], 'metallicFactor': 0.0,
        'roughnessFactor': 0.85}},
    {'name': 'gold', 'pbrMetallicRoughness': {
        'baseColorFactor': [0.94, 0.76, 0.28, 1.0], 'metallicFactor': 0.95,
        'roughnessFactor': 0.26}},
]


def main(out_path):
    buf = bytearray()
    views, accessors, meshes, nodes = [], [], [], []

    def push(data, target=None):
        while len(buf) % 4:
            buf.append(0)
        off = len(buf)
        buf.extend(data)
        v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
        if target:
            v['target'] = target
        views.append(v)
        return len(views) - 1

    for key, kw, mat in CATS:
        verts, faces, norms = surface(cat_blobs(**kw))
        vi = push(verts.tobytes(), 34962)
        ni = push(norms.tobytes(), 34962)
        fi = push(faces.tobytes(), 34963)
        accessors.append({'bufferView': vi, 'componentType': 5126, 'count': len(verts),
                          'type': 'VEC3', 'min': verts.min(axis=0).tolist(),
                          'max': verts.max(axis=0).tolist()})
        accessors.append({'bufferView': ni, 'componentType': 5126, 'count': len(norms),
                          'type': 'VEC3'})
        accessors.append({'bufferView': fi, 'componentType': 5125,
                          'count': int(faces.size), 'type': 'SCALAR'})
        a = len(accessors) - 3
        meshes.append({'name': 'mesh_' + key, 'primitives': [
            {'attributes': {'POSITION': a, 'NORMAL': a + 1}, 'indices': a + 2,
             'material': 1 if mat == 'gold' else 0}]})
        nodes.append({'name': 'cat_' + key, 'mesh': len(meshes) - 1})
        print('%-8s %6d verts %6d tris  %s' % (key, len(verts), len(faces), mat))

    gltf = {'asset': {'version': '2.0', 'generator': 'cashcats mkcats.py'},
            'scene': 0, 'scenes': [{'nodes': list(range(len(nodes)))}],
            'nodes': nodes, 'meshes': meshes, 'materials': MATERIALS,
            'accessors': accessors, 'bufferViews': views,
            'buffers': [{'byteLength': len(buf)}]}

    js = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    js += b' ' * ((4 - len(js) % 4) % 4)
    while len(buf) % 4:
        buf.append(0)
    glb = bytearray()
    glb += struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(buf))
    glb += struct.pack('<II', len(js), 0x4E4F534A) + js
    glb += struct.pack('<II', len(buf), 0x004E4942) + bytes(buf)
    open(out_path, 'wb').write(glb)
    print('wrote %s  %.2f MB' % (out_path, len(glb) / 1e6))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'cats.glb')
