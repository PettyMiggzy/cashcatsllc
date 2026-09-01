"""
Decimate the Poly Haven models. The normal map keeps the detail.

Fetched raw they are 188MB and 5.5 million triangles — a single cliff is
1.5 million on its own, because these are photoscans. The whole world before
this was 45MB, so dropping them in as-shipped would trade one problem for a
worse one.

The reason it is safe to cut hard is the same reason these models are worth
having at all: their surface detail lives in a normal map, not in geometry. A
cliff at 2% of its triangles lit by the same normal map looks very nearly
identical at any distance you actually stand from it, and nothing like the flat
box it replaces.

Ratios are per-kind rather than global — a chair silhouette falls apart long
before a boulder does.

    python3 roomsrc/thin_hq.py [--dry]
"""
import io, json, os, struct, subprocess, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
HQ = os.path.join(ROOT, 'hq')

# name fragment -> fraction of triangles to keep
RATIO = [
    ('cliff', 0.020), ('coast', 0.020), ('rocks', 0.03), ('boulder', 0.06),
    ('rock', 0.06), ('trunk', 0.06), ('dandelion', 0.12), ('fern', 0.15),
    ('plant', 0.15), ('crate', 0.25), ('barrel', 0.35), ('box', 0.35),
    # Architecture cuts hardest of all. A building facade is mostly flat
    # surfaces with mouldings on them, and the mouldings are in the normal
    # map — 270,000 triangles of window reveal buy nothing you can see from
    # the street. The apartment block at 6% still carries every course,
    # cornice and sill, because those were never geometry to begin with.
    ('facade', 0.06), ('fort', 0.14), ('pier', 0.12), ('ship', 0.18),
    ('gate', 0.22), ('door', 0.22), ('escape', 0.28), ('seating', 0.28),
    ('sapling', 0.10), ('fir', 0.10),
]
DEFAULT = 0.45
FLOOR = 900          # never take a prop below this many triangles


def tris(path):
    d = open(path, 'rb').read()
    off, j = 12, None
    while off < len(d):
        ln, ty = struct.unpack_from('<II', d, off); off += 8
        if ty == 0x4E4F534A:
            j = json.loads(d[off:off + ln])
        off += ln
    if not j:
        return 0
    return sum(j['accessors'][p['indices']]['count'] // 3
               for m in j.get('meshes', []) for p in m['primitives'] if 'indices' in p)


def ratio_for(name):
    low = name.lower()
    for frag, r in RATIO:
        if frag in low:
            return r
    return DEFAULT


def shrink_textures(path, size=512):
    """
    Halve the maps. Geometry was the first bill; this is the second.

    A 1k diffuse, a 1k normal and a 1k ARM is 600KB a model before the mesh,
    and most of these stand in the middle distance. 512 keeps the thing that
    makes them worth having — the normal map still reads as surface, which is
    the entire reason to prefer these over a flat box — at a quarter of the
    bytes.
    """
    from PIL import Image
    d = open(path, 'rb').read()
    off, js, bin_ = 12, None, b''
    while off < len(d):
        ln, ty = struct.unpack_from('<II', d, off); off += 8
        if ty == 0x4E4F534A:
            js = json.loads(d[off:off + ln])
        elif ty == 0x004E4942:
            bin_ = d[off:off + ln]
        off += ln
    if not js or not js.get('images'):
        return 0
    imgview = {im['bufferView']: i for i, im in enumerate(js['images']) if 'bufferView' in im}
    new = bytearray()
    for vi, bv in enumerate(js['bufferViews']):
        o, n = bv.get('byteOffset', 0), bv['byteLength']
        data = bytes(bin_[o:o + n])
        if vi in imgview:
            try:
                pic = Image.open(io.BytesIO(data))
                if max(pic.size) > size:
                    pic = pic.convert('RGB').resize((size, size), Image.LANCZOS)
                    buf = io.BytesIO(); pic.save(buf, 'JPEG', quality=86, optimize=True)
                    data = buf.getvalue()
                    js['images'][imgview[vi]]['mimeType'] = 'image/jpeg'
            except Exception:
                pass
        pad = (4 - len(new) % 4) % 4
        new += b'\0' * pad
        bv['byteOffset'] = len(new); bv['byteLength'] = len(data)
        new += data
    js['buffers'] = [{'byteLength': len(new)}]
    jb = json.dumps(js, separators=(',', ':')).encode()
    jb += b' ' * ((4 - len(jb) % 4) % 4)
    bb = bytes(new) + b'\0' * ((4 - len(new) % 4) % 4)
    out = b'glTF' + struct.pack('<II', 2, 12 + 8 + len(jb) + 8 + len(bb))
    out += struct.pack('<II', len(jb), 0x4E4F534A) + jb
    out += struct.pack('<II', len(bb), 0x004E4942) + bb
    open(path, 'wb').write(out)
    return len(out)


def main(dry):
    before = after = 0
    bb = ab = 0
    for f in sorted(os.listdir(HQ)):
        if not f.endswith('.glb') or f.endswith('.raw.glb'):
            continue
        path = os.path.join(HQ, f)
        raw = path[:-4] + '.raw.glb'
        src = raw if os.path.exists(raw) else path
        t0 = tris(src)
        s0 = os.path.getsize(src)
        r = ratio_for(f)
        keep = max(FLOOR / t0, r) if t0 else r
        before += t0; bb += s0
        if dry:
            print('  %-26s %8s -> %8s tris (x%.3f)' %
                  (f, '{:,}'.format(t0), '{:,}'.format(int(t0 * keep)), keep))
            continue
        if not os.path.exists(raw):
            os.rename(path, raw)
        cmd = ['npx', 'gltfpack', '-i', raw, '-o', path, '-si', '%.4f' % keep, '-kn', '-noq']
        p = subprocess.run(cmd, capture_output=True, text=True)
        if p.returncode != 0 or not os.path.exists(path):
            os.rename(raw, path)
            print('  %-26s gltfpack failed: %s' % (f, (p.stderr or '').strip()[:60]))
            continue
        shrink_textures(path)
        t1, s1 = tris(path), os.path.getsize(path)
        after += t1; ab += s1
        print('  %-26s %8s -> %7s tris   %6.1f -> %5.2f MB' %
              (f, '{:,}'.format(t0), '{:,}'.format(t1), s0 / 1048576, s1 / 1048576))
    if not dry:
        print('TOTAL %s -> %s tris,  %.0f -> %.0f MB' %
              ('{:,}'.format(before), '{:,}'.format(after), bb / 1048576, ab / 1048576))


if __name__ == '__main__':
    main('--dry' in sys.argv)
