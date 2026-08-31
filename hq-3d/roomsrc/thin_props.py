#!/usr/bin/env python3
"""
Cut generated props down to something a world can actually carry.

    python3 roomsrc/thin_props.py                  # everything in props/
    python3 roomsrc/thin_props.py bench lamp       # just these

Tripo returns what it returns: a park bench came back at 333,136 triangles
and 10.2MB, with three 2048x2048 textures. Twenty of those is 200MB of
downloads and six and a half million triangles for street furniture — the
world gets slower for every prop added, which is the opposite of the point.

Two passes. gltfpack thins the mesh (-noq matters: quantised vertex data is
integers, and anything downstream reading positions as floats then measures
the model in the tens of thousands of metres). Then the textures come down to
a size that suits the thing they are painted on.

A bench ends around 3k triangles and 150KB, which is what a bench costs.
"""
import io
import os
import struct
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
HQ = os.path.dirname(ROOT)
sys.path.insert(0, ROOT)
from glb2vrm import read_glb, write_glb            # noqa: E402

try:
    from PIL import Image
except ImportError:
    sys.exit('needs pillow: pip install pillow')

SIMPLIFY = 0.02      # keep this share of the triangles
TEX_MAX = 512        # a prop is seen from metres away, not held up to the eye
JPEG_Q = 86


def thin_mesh(src, dst):
    subprocess.check_call(['npx', 'gltfpack', '-i', src, '-o', dst,
                           '-si', str(SIMPLIFY), '-kn', '-noq'],
                          cwd=HQ, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def thin_textures(path):
    gltf, binary = read_glb(path)
    changed = 0
    for im in gltf.get('images', []):
        if 'bufferView' not in im:
            continue
        bv = gltf['bufferViews'][im['bufferView']]
        off = bv.get('byteOffset', 0)
        raw = bytes(binary[off:off + bv['byteLength']])
        try:
            img = Image.open(io.BytesIO(raw))
        except Exception:
            continue
        if max(img.size) <= TEX_MAX:
            continue
        img = img.convert('RGB')
        img.thumbnail((TEX_MAX, TEX_MAX), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format='JPEG', quality=JPEG_Q)
        data = buf.getvalue()

        # append and repoint rather than splice: rewriting a view in place
        # would shift every byte offset after it
        while len(binary) % 4:
            binary.append(0)
        gltf['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary),
                                    'byteLength': len(data)})
        binary += data
        im['bufferView'] = len(gltf['bufferViews']) - 1
        im['mimeType'] = 'image/jpeg'
        changed += 1
    if changed:
        gltf['buffers'][0]['byteLength'] = len(binary)
        write_glb(gltf, binary, path)
    return changed


def compact(path):
    """
    Drop orphaned bytes from the buffer.

    Replacing a texture appends the new image and repoints the view at it,
    because rewriting one view in place would shift every offset after it.
    That leaves the original bytes sitting in the buffer, referenced by
    nothing — a thinned bench was 0.81MB of which 0.72MB was the 2048px
    textures it no longer used. Rebuild the buffer from the views that are
    still pointed at, and rewrite their offsets.
    """
    gltf, binary = read_glb(path)
    views = gltf.get('bufferViews', [])
    used = set()
    for a in gltf.get('accessors', []):
        if 'bufferView' in a:
            used.add(a['bufferView'])
        sp = a.get('sparse') or {}
        for part in ('indices', 'values'):
            if part in sp and 'bufferView' in sp[part]:
                used.add(sp[part]['bufferView'])
    for im in gltf.get('images', []):
        if 'bufferView' in im:
            used.add(im['bufferView'])

    out = bytearray()
    remap = {}
    for i, bv in enumerate(views):
        if i not in used:
            continue
        off = bv.get('byteOffset', 0)
        data = bytes(binary[off:off + bv['byteLength']])
        while len(out) % 4:
            out.append(0)
        remap[i] = len(views) if False else len(remap)
        bv['byteOffset'] = len(out)
        out += data

    kept = [bv for i, bv in enumerate(views) if i in used]
    gltf['bufferViews'] = kept

    def fix(holder):
        if 'bufferView' in holder:
            holder['bufferView'] = remap[holder['bufferView']]
    for a in gltf.get('accessors', []):
        fix(a)
        sp = a.get('sparse') or {}
        for part in ('indices', 'values'):
            if part in sp:
                fix(sp[part])
    for im in gltf.get('images', []):
        fix(im)

    gltf['buffers'][0]['byteLength'] = len(out)
    write_glb(gltf, out, path)


def tris(path):
    gltf, _ = read_glb(path)
    return sum(gltf['accessors'][p['indices']]['count'] // 3
               for m in gltf.get('meshes', []) for p in m['primitives'] if 'indices' in p)


def main(which):
    d = os.path.join(ROOT, 'props')
    if not os.path.isdir(d):
        sys.exit('no props yet — run tripo_props.py first')
    names = which or sorted(f[:-4] for f in os.listdir(d)
                            if f.endswith('.glb') and not f.endswith('_raw.glb'))
    for n in names:
        src = os.path.join(d, '%s.glb' % n)
        if not os.path.exists(src):
            print('%-14s missing' % n)
            continue
        raw = os.path.join(d, '%s_raw.glb' % n)
        if not os.path.exists(raw):
            os.rename(src, raw)          # keep the original to re-thin from
        before_t, before_b = tris(raw), os.path.getsize(raw)
        thin_mesh(raw, src)
        thin_textures(src)
        compact(src)
        print('%-14s %7d -> %6d tris   %6.2f -> %5.2f MB' % (
            n, before_t, tris(src), before_b / 1e6, os.path.getsize(src) / 1e6))


if __name__ == '__main__':
    main([a for a in sys.argv[1:] if not a.startswith('-')])
