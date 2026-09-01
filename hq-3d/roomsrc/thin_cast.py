"""
Shrink the cast's textures. Nothing else about the VRM is touched.

The five cats stand as statues on the spawn plaza and are also the wearable
avatars, so all five are resident from the moment anyone loads in. Tripo
returns them with three 2048x2048 maps each — fifteen of them — which is 319MB
of GPU texture once decoded with mipmaps, for models that occupy a few hundred
pixels of screen. It is the single largest thing in the world by a wide margin
and none of it is visible.

Only the image bytes are rewritten. Bones, skins, accessors, the VRM extension
and the rest pose that took days to get right are left exactly as they are —
this is a resize, not a re-export, and it cannot disturb the rig.

    python3 roomsrc/thin_cast.py [--size 512]
"""
import io, json, os, struct, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, 'cast_vrm')
JSON_CHUNK, BIN_CHUNK = 0x4E4F534A, 0x004E4942


def read_glb(path):
    d = open(path, 'rb').read()
    off, js, bin_ = 12, None, b''
    while off < len(d):
        ln, ty = struct.unpack_from('<II', d, off); off += 8
        if ty == JSON_CHUNK:
            js = json.loads(d[off:off + ln])
        elif ty == BIN_CHUNK:
            bin_ = d[off:off + ln]
        off += ln
    return js, bin_


def write_glb(path, js, bin_):
    jb = json.dumps(js, separators=(',', ':')).encode()
    jb += b' ' * ((4 - len(jb) % 4) % 4)
    bb = bin_ + b'\0' * ((4 - len(bin_) % 4) % 4)
    out = b'glTF' + struct.pack('<II', 2, 12 + 8 + len(jb) + 8 + len(bb))
    out += struct.pack('<II', len(jb), JSON_CHUNK) + jb
    out += struct.pack('<II', len(bb), BIN_CHUNK) + bb
    open(path, 'wb').write(out)


def thin(path, size):
    from PIL import Image
    js, bin_ = read_glb(path)
    imgs = js.get('images') or []
    if not imgs:
        return None
    # Rebuild the binary chunk in bufferView order so every offset stays valid.
    views = js['bufferViews']
    image_view = {im['bufferView']: i for i, im in enumerate(imgs) if 'bufferView' in im}
    new_bin = bytearray()
    before = after = 0
    for vi, bv in enumerate(views):
        o, n = bv.get('byteOffset', 0), bv['byteLength']
        data = bytes(bin_[o:o + n])
        if vi in image_view:
            im = imgs[image_view[vi]]
            pic = Image.open(io.BytesIO(data))
            before += pic.width * pic.height
            if max(pic.size) > size:
                pic = pic.convert('RGB').resize((size, size), Image.LANCZOS)
                buf = io.BytesIO()
                pic.save(buf, 'JPEG', quality=88, optimize=True)
                data = buf.getvalue()
                im['mimeType'] = 'image/jpeg'
            after += pic.width * pic.height
        pad = (4 - len(new_bin) % 4) % 4
        new_bin += b'\0' * pad
        bv['byteOffset'] = len(new_bin)
        bv['byteLength'] = len(data)
        new_bin += data
    js['buffers'] = [{'byteLength': len(new_bin)}]
    write_glb(path, js, bytes(new_bin))
    return before, after


def main(size):
    from PIL import Image  # noqa: F401  — fail early with a clear error
    tot_b = tot_a = 0
    for f in sorted(os.listdir(SRC)):
        if not f.endswith('.vrm'):
            continue
        r = thin(os.path.join(SRC, f), size)
        if not r:
            continue
        b, a = r
        tot_b += b; tot_a += a
        print('  %-16s %5.1f MB -> %5.1f MB of texture' %
              (f, b * 4 * 1.33 / 1048576, a * 4 * 1.33 / 1048576))
    print('cast texture, decoded with mips: %.0f MB -> %.0f MB' %
          (tot_b * 4 * 1.33 / 1048576, tot_a * 4 * 1.33 / 1048576))


if __name__ == '__main__':
    n = 512
    if '--size' in sys.argv:
        n = int(sys.argv[sys.argv.index('--size') + 1])
    main(n)
