"""
Give the kit buildings a surface.

THE PROBLEM

Every building in this world is a Kenney panel: 286 triangles carrying one
palette swatch and nothing else. Measured against a Poly Haven barrel in the
same frame — 1042 triangles, albedo + normal + roughness — the barrel reads as
real and the wall reads as cardboard. It is not the renderer. glbToNodes has
wired normalMap the whole time. The walls simply have no normals to wire.

WHY THIS IS NOT JUST "ADD A TEXTURE"

The kit's UVs are not surface UVs. Every face maps to a single point on a
512px palette atlas — that is how the colour scheme works, and it is why the
colours could be retuned so cleanly earlier. Lay a tiling brick map on those
UVs and every face samples one texel of it. Useless.

THE WAY THROUGH

glTF lets each map name its own UV set, and this engine honours it —
GLTFLoader does `texture.channel = mapDef.texCoord`. So the palette UVs stay
exactly where they are on TEXCOORD_0 and keep doing the colour, and this adds
a second UV set, TEXCOORD_1, built by box projection, purely for the normal
and roughness maps to sit on.

Box projection: take each vertex's normal, find its dominant axis, and use the
other two position components as UV, divided by a tile size in metres. Faces
pointing up get their UV from x,z; faces pointing along X get it from z,y. It
is the standard trick and it costs nothing at runtime because it is baked into
the file. Seams appear where a surface curves through 45 degrees, which on
architecture — flat planes meeting at right angles — is nowhere.

No tiling sheet is baked. glTF's default wrap is REPEAT, so UVs measured in
metres tile by themselves. Mirroring would be wrong for a normal map anyway:
a mirrored tile needs its X channel negated or the light arrives from the
wrong side along every seam.

    python3 roomsrc/bump_kit.py [kit ...] [--dry]
"""
import json, os, struct, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
PACKS = os.path.join(ROOT, 'packs')
TEX = os.path.join(ROOT, 'tex')

# Which kits get a surface. The nature kit is left alone — trees and rocks are
# not made of stucco, and their silhouette is the whole point of them.
KITS = ['fantasy-town-kit', 'city-kit-commercial', 'city-kit-industrial',
        'pirate-kit', 'modular-cave-kit']


def used_models():
    """
    Only the models the world actually places.

    Every bumped file embeds its own copy of the normal map, because glTF has
    no way for one .glb to reference another's image. Bumping all 167 town-kit
    models cost 157MB for the thirty-odd the world has ever placed. texprops
    knows which those are, so ask it.
    """
    sys.path.insert(0, ROOT)
    import texprops
    return set(os.path.basename(v) for v in texprops.MODELS.values())

TILE = 2.4          # metres per repeat of the surface map
SCALE = 1.6         # normal strength. 0.85 was there and you had to look for it

# Which surface a model gets, by what its filename says it is. A roof wants
# roof tiles and a wall wants stucco; one map on everything gave the roofs the
# grain of a plastered wall, which is better than nothing and still wrong.
SURFACE = [('roof', 'n_roof.jpg'), ('fence', 'n_wood.jpg'), ('wood', 'n_wood.jpg'),
           ('door', 'n_wood.jpg'), ('stall', 'n_wood.jpg'), ('cart', 'n_wood.jpg'),
           ('pier', 'n_wood.jpg'), ('deck', 'n_wood.jpg')]
DEFAULT_SURF = 'n_wall.jpg'


def surf_for(fname):
    low = fname.lower()
    for frag, tex in SURFACE:
        if frag in low:
            return tex
    return DEFAULT_SURF
MARK = 'ccl_bumped'

# The version of the surfacing that produced a file, stamped into it.
#
# Same trap embed_tex fell into: a bare "done" mark is a one-way door. Change
# TILE, SCALE, or which surface a model gets, and every box that ran the old
# version keeps the old result forever while a fresh one gets the new — and
# nothing says so. embed_tex.sweep_stale() is the only thing that can repair
# that, because repairing means refetching the pristine pack, so it reads this
# number. Bump it whenever the surfacing should reach existing boxes.
BUMP = 1


def read_glb(path):
    d = open(path, 'rb').read()
    off, js, bin_ = 12, None, b''
    while off < len(d):
        ln, ty = struct.unpack_from('<II', d, off); off += 8
        if ty == 0x4E4F534A: js = json.loads(d[off:off + ln])
        elif ty == 0x004E4942: bin_ = d[off:off + ln]
        off += ln
    return js, bin_


def write_glb(path, js, bin_):
    j = json.dumps(js, separators=(',', ':')).encode()
    j += b' ' * ((4 - len(j) % 4) % 4)
    b = bin_ + b'\0' * ((4 - len(bin_) % 4) % 4)
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(j) + 8 + len(b))
    out += struct.pack('<II', len(j), 0x4E4F534A) + j
    out += struct.pack('<II', len(b), 0x004E4942) + b
    open(path, 'wb').write(out)


def read_vec3(js, bin_, ai):
    """Floats out of an accessor. These kits are all float32 and tightly packed."""
    a = js['accessors'][ai]
    bv = js['bufferViews'][a['bufferView']]
    base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride') or 12
    n = a['count']
    out = []
    for i in range(n):
        out.append(struct.unpack_from('<3f', bin_, base + i * stride))
    return out


def add_accessor(js, bin_, uvs):
    """Append a TEXCOORD accessor and return its index and the new bin."""
    pad = (4 - len(bin_) % 4) % 4
    bin_ += b'\0' * pad
    off = len(bin_)
    data = b''.join(struct.pack('<2f', u, v) for u, v in uvs)
    bin_ += data
    js.setdefault('bufferViews', []).append(
        {'buffer': 0, 'byteOffset': off, 'byteLength': len(data), 'target': 34962})
    js.setdefault('accessors', []).append({
        'bufferView': len(js['bufferViews']) - 1, 'componentType': 5126,
        'count': len(uvs), 'type': 'VEC2'})
    return len(js['accessors']) - 1, bin_


def add_image(js, bin_, path):
    png = open(path, 'rb').read()
    pad = (4 - len(bin_) % 4) % 4
    bin_ += b'\0' * pad
    js.setdefault('bufferViews', []).append(
        {'buffer': 0, 'byteOffset': len(bin_), 'byteLength': len(png)})
    bin_ += png
    js.setdefault('images', []).append({
        'bufferView': len(js['bufferViews']) - 1,
        'mimeType': 'image/png' if path.lower().endswith('.png') else 'image/jpeg'})
    js.setdefault('textures', []).append({'source': len(js['images']) - 1})
    return len(js['textures']) - 1, bin_


def box_uv(pos, nrm):
    """Project onto the plane the normal points least along."""
    ax, ay, az = abs(nrm[0]), abs(nrm[1]), abs(nrm[2])
    if ay >= ax and ay >= az:      # floor or roof
        u, v = pos[0], pos[2]
    elif ax >= az:                 # facing along X
        u, v = pos[2], pos[1]
    else:                          # facing along Z
        u, v = pos[0], pos[1]
    return u / TILE, v / TILE


def bump(path):
    js, bin_ = read_glb(path)
    if not js or js.get('extras', {}).get(MARK):
        return False
    mats = js.get('materials') or []
    if not mats:
        return False

    tex, bin_ = add_image(js, bin_, os.path.join(TEX, surf_for(os.path.basename(path))))
    rough, bin_ = add_image(js, bin_, os.path.join(TEX, 'r_wall.jpg'))

    touched = False
    for mesh in js.get('meshes', []):
        for pr in mesh['primitives']:
            at = pr['attributes']
            if 'POSITION' not in at or 'NORMAL' not in at:
                continue
            if 'TEXCOORD_1' in at:
                continue
            pos = read_vec3(js, bin_, at['POSITION'])
            nrm = read_vec3(js, bin_, at['NORMAL'])
            uvs = [box_uv(p, n) for p, n in zip(pos, nrm)]
            ai, bin_ = add_accessor(js, bin_, uvs)
            at['TEXCOORD_1'] = ai
            touched = True
    if not touched:
        return False

    for m in mats:
        if 'normalTexture' in m:
            continue
        m['normalTexture'] = {'index': tex, 'texCoord': 1, 'scale': SCALE}
        # Roughness on the same projection. glTF packs roughness in green, and
        # a greyscale map read that way is close enough — what matters is that
        # the highlight stops being uniform across a whole wall.
        pbr = m.setdefault('pbrMetallicRoughness', {})
        pbr['metallicRoughnessTexture'] = {'index': rough, 'texCoord': 1}
        pbr.setdefault('roughnessFactor', 0.9)
        pbr['metallicFactor'] = 0.0

    js.setdefault('extras', {})[MARK] = True
    js['extras']['ccl_bump_v'] = BUMP
    write_glb(path, js, bin_)
    return True


def main():
    global USED
    USED = used_models()
    dry = '--dry' in sys.argv
    only = [a for a in sys.argv[1:] if not a.startswith('--')]
    total = 0
    for kit in (only or KITS):
        d = os.path.join(PACKS, kit)
        if not os.path.isdir(d):
            print('  %-24s not fetched' % kit); continue
        n = 0
        for f in sorted(os.listdir(d)):
            if not f.endswith('.glb') or f not in USED:
                continue
            if dry:
                n += 1; continue
            try:
                if bump(os.path.join(d, f)):
                    n += 1
            except Exception as e:
                print('    ! %s: %s' % (f, str(e)[:70]))
        print('  %-24s %4d bumped' % (kit, n))
        total += n
    print('%d models given a surface' % total)


if __name__ == '__main__':
    main()
