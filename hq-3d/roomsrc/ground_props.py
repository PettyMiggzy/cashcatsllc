"""
Put the generated props on the ground.

Tripo returns every mesh normalised into a 1-unit box centred on the origin,
which means a prop placed at y=0 is buried to its waist, and the amount it is
buried differs per prop (a bench is 0.567 units tall, a haystack 0.911). Left
alone, a script has to carry a per-prop fudge factor, and it will be wrong.

So fix it once, in the asset. Each prop is wrapped in a root node that scales
it to exactly one unit tall and lifts it so its base sits on y=0. After this a
script can say

    model('well', [x, 0, z], rot, 2.4)      # a well 2.4 metres tall

and mean it. glTF applies T * R * S, so the scale runs first and the lift
after, which is the order that works.

Idempotent: a prop already carrying the marker node is left alone.

    python3 roomsrc/ground_props.py [name ...]
"""
import json, os, struct, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, 'props')
MARK = '__grounded'
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


def extent(js):
    """Bounding box straight off the accessors — every prop here is a flat
    scene of meshes with no node transforms, which is what Tripo emits."""
    mn = [1e9] * 3
    mx = [-1e9] * 3
    for m in js.get('meshes', []):
        for pr in m['primitives']:
            a = js['accessors'][pr['attributes']['POSITION']]
            if 'min' not in a:
                return None, None
            for i in range(3):
                mn[i] = min(mn[i], a['min'][i])
                mx[i] = max(mx[i], a['max'][i])
    return (None, None) if mn[0] > 1e8 else (mn, mx)


def ground(path):
    js, bin_ = read_glb(path)
    if not js:
        return 'unreadable'
    if any(n.get('name') == MARK for n in js.get('nodes', [])):
        return None                        # already done
    mn, mx = extent(js)
    if mn is None:
        return 'no bounds'
    h = mx[1] - mn[1]
    if h <= 1e-6:
        return 'flat'
    k = 1.0 / h
    # centre it in X and Z too: a prop whose origin is off to one side spins
    # around a point outside itself the moment you rotate it
    cx = (mn[0] + mx[0]) / 2.0
    cz = (mn[2] + mx[2]) / 2.0
    scene = js['scenes'][js.get('scene', 0)]
    js['nodes'].append({
        'name': MARK,
        'children': list(scene['nodes']),
        'scale': [k, k, k],
        'translation': [-cx * k, -mn[1] * k, -cz * k],
    })
    scene['nodes'] = [len(js['nodes']) - 1]
    write_glb(path, js, bin_)
    return 'h=%.3f -> 1.0' % h


def main(only):
    done = 0
    for f in sorted(os.listdir(OUT)):
        if not f.endswith('.glb') or f.endswith('_raw.glb'):
            continue
        key = f[:-4]
        if only and key not in only:
            continue
        r = ground(os.path.join(OUT, f))
        if r:
            print('  %-14s %s' % (key, r))
            done += 1
    print('%d props grounded (origin at base, one unit tall)' % done)


if __name__ == '__main__':
    main(set(sys.argv[1:]))
