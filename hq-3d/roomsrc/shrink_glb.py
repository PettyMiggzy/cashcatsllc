#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Re-encode the textures inside a .glb so a prop is not shipped at poster size.

    python3 roomsrc/shrink_glb.py packs/casino/cards.glb 1024

The casino models came off Sketchfab with the resolution their authors
uploaded, which is the right choice for a turntable render and the wrong one
for a prop a player sees at arm's length across a 16m room. The playing cards
carried two 4096x4096 PNGs -- 3.6MB of the file -- for a fanned hand about a
metre wide. At 1024 that is 16x fewer pixels for a card whose pips are already
smaller than a screen pixel at any distance you actually stand.

The geometry is untouched. This only rewrites image bufferViews, then rebuilds
the buffer and the JSON offsets around them, so a model that was correct before
is still correct after -- just lighter.
"""
import io, json, os, struct, sys

try:
    from PIL import Image
except ImportError:
    raise SystemExit('needs pillow: apt-get install -y python3-pil')


def read_glb(path):
    d = open(path, 'rb').read()
    magic, ver, total = struct.unpack('<III', d[:12])
    if magic != 0x46546C67:
        raise SystemExit('%s is not a glb' % path)
    off, js, binc = 12, None, b''
    while off < len(d):
        ln, kind = struct.unpack('<II', d[off:off + 8])
        chunk = d[off + 8:off + 8 + ln]
        if kind == 0x4E4F534A:
            js = json.loads(chunk)
        elif kind == 0x004E4942:
            binc = chunk
        off += 8 + ln
    return js, binc


def write_glb(path, js, binc):
    jb = json.dumps(js, separators=(',', ':')).encode('utf-8')
    jb += b' ' * ((4 - len(jb) % 4) % 4)
    bb = binc + b'\0' * ((4 - len(binc) % 4) % 4)
    total = 12 + 8 + len(jb) + 8 + len(bb)
    out = struct.pack('<III', 0x46546C67, 2, total)
    out += struct.pack('<II', len(jb), 0x4E4F534A) + jb
    out += struct.pack('<II', len(bb), 0x004E4942) + bb
    open(path, 'wb').write(out)


def shrink(path, cap):
    js, binc = read_glb(path)
    views = js.get('bufferViews', [])
    # Which bufferViews are images, and what each should become. Everything
    # else -- positions, indices, animation samplers -- is copied through
    # byte for byte.
    new_blob = {}
    over, kept = 0, 0
    for img in js.get('images', []):
        bv = img.get('bufferView')
        if bv is None:
            continue
        v = views[bv]
        s = v.get('byteOffset', 0)
        raw = binc[s:s + v['byteLength']]
        try:
            im = Image.open(io.BytesIO(raw))
            im.load()
        except Exception:
            continue
        w, h = im.size
        if max(w, h) <= cap:
            continue
        over += 1
        scale = cap / float(max(w, h))
        im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
        buf = io.BytesIO()
        # Keep alpha as PNG; everything else becomes JPEG, which is what the
        # size is actually in.
        if im.mode in ('RGBA', 'LA', 'P') and 'transparency' in getattr(im, 'info', {}) or im.mode == 'RGBA':
            im.save(buf, 'PNG', optimize=True)
            mime = 'image/png'
        else:
            im.convert('RGB').save(buf, 'JPEG', quality=88, optimize=True)
            mime = 'image/jpeg'
        blob = buf.getvalue()
        # Only take the swap if it actually saved something. The chandelier's
        # five 2048x2048 maps are near-flat colour and compressed to 60KB each
        # as PNG; re-encoding them to 1024 JPEG made the file BIGGER, and the
        # first run of this script shipped a 4.7MB model at 5.4MB while
        # reporting five successful reductions. Fewer pixels is not fewer bytes.
        if len(blob) >= len(raw):
            kept += 1
            continue
        new_blob[bv] = (blob, mime, (w, h), im.size)
        img['mimeType'] = mime

    if not new_blob:
        # Two different nothings, and saying the wrong one is how a model that
        # needed shrinking gets signed off as already small.
        why = ('%d already smaller re-encoded, left alone' % kept) if kept \
              else 'nothing over %dpx' % cap
        print('  %-22s unchanged (%s)' % (os.path.basename(path), why))
        return 0

    # Rebuild the buffer in bufferView order so every offset stays sorted and
    # the accessors that point at the untouched views keep working.
    order = sorted(range(len(views)), key=lambda i: views[i].get('byteOffset', 0))
    out = bytearray()
    for i in order:
        v = views[i]
        if i in new_blob:
            data = new_blob[i][0]
        else:
            s = v.get('byteOffset', 0)
            data = binc[s:s + v['byteLength']]
        while len(out) % 4:
            out.append(0)
        v['byteOffset'] = len(out)
        v['byteLength'] = len(data)
        out += data
    js['buffers'][0]['byteLength'] = len(out)
    js['buffers'][0].pop('uri', None)

    before = os.path.getsize(path)
    write_glb(path, js, bytes(out))
    after = os.path.getsize(path)
    print('  %-22s %.2f -> %.2f MB' % (os.path.basename(path), before / 1e6, after / 1e6))
    for bv, (_, mime, was, now) in sorted(new_blob.items()):
        print('      %dx%d -> %dx%d  %s' % (was[0], was[1], now[0], now[1], mime))
    return before - after


if __name__ == '__main__':
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    root = os.path.dirname(os.path.abspath(__file__))
    cap = int(sys.argv[2]) if len(sys.argv) > 2 else 1024
    p = sys.argv[1]
    if not os.path.isabs(p):
        p = os.path.join(root, p)
    sys.exit(0 if shrink(p, cap) >= 0 else 1)
