"""
Make the fetched CC0 packs render correctly.

Two separate faults, both of which make a kit look cheap in a PBR renderer and
neither of which is visible until you actually look at the world:

Kenney's kits ship one shared `Textures/colormap.png` per pack and every model
points at it by relative URI. That is why 329 nature models fit in 3.6MB — and
it is also why every single one of them renders untextured once the file is
content-addressed into the world store as `asset://<sha>.glb`, because there is
no longer any such thing as a relative path. The engine says so exactly once
per model and then carries on:

    THREE.GLTFLoader: Couldn't load texture Textures/colormap.png

The fix is to move the PNG into the GLB's binary chunk and repoint the image at
a bufferView. It costs ~11KB per model, which is the whole texture, and the
renderer then batches them all onto one material anyway.

2. Untextured kits (nature-kit, 329 models) carry their colour on the material
   instead, and ship it as `metallicFactor: 1` — a Blender export default that
   nobody notices in a flat viewport. Under an HDRI every tree, rock and crop
   comes out dark, desaturated and faintly wet, because a fully metallic
   surface has no diffuse colour at all. They are painted wood and leaves, so
   they are dielectric: metalness 0, and a roughness that is not a mirror.

    python3 roomsrc/embed_tex.py            # every pack
    python3 roomsrc/embed_tex.py nature-kit # just one
"""
import json, os, struct, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
PACKS = os.path.join(ROOT, 'packs')
JSON_CHUNK, BIN_CHUNK = 0x4E4F534A, 0x004E4942


def read_glb(path):
    d = open(path, 'rb').read()
    if d[:4] != b'glTF':
        return None, None
    off, js, bin_ = 12, None, b''
    while off < len(d):
        ln, ty = struct.unpack_from('<II', d, off)
        off += 8
        if ty == JSON_CHUNK:
            js = json.loads(d[off:off + ln])
        elif ty == BIN_CHUNK:
            bin_ = d[off:off + ln]
        off += ln
    return js, bin_


def write_glb(path, js, bin_):
    jb = json.dumps(js, separators=(',', ':')).encode()
    jb += b' ' * ((4 - len(jb) % 4) % 4)          # chunks are 4-byte aligned
    bb = bin_ + b'\0' * ((4 - len(bin_) % 4) % 4)
    out = b'glTF' + struct.pack('<II', 2, 12 + 8 + len(jb) + 8 + len(bb))
    out += struct.pack('<II', len(jb), JSON_CHUNK) + jb
    out += struct.pack('<II', len(bb), BIN_CHUNK) + bb
    open(path, 'wb').write(out)


SRGB_FIXED = 'ccl_srgb_basecolor'


def fix_materials(js):
    """
    Painted props are dielectric, and their colours are in the wrong space.

    Two separate faults in the same place:

    1. metallicFactor 1. A fully metallic surface has no diffuse colour at all,
       so the base colour becomes a specular tint and the model comes out dark
       and faintly wet. Painted wood and leaves are dielectric.

    2. baseColorFactor is authored as sRGB but glTF defines it as LINEAR, so
       three.js decodes a value that was never encoded. Everything drifts pale
       and cyan: nature-kit's leafsGreen [0.16, 0.79, 0.67] should display as a
       teal-green #29c9ab and instead comes out #6de6d6, and woodBark should be
       a warm #e28357 bark and lands on #f1bc9c salmon. Across 329 models that
       is the difference between a wood and an Easter egg. Squaring the value
       into real linear space puts the authored colour back on screen.

       Only factor-coloured materials need it. Anything with a baseColorTexture
       is already decoded correctly through the texture's own sRGB flag, which
       is why the textured kits looked right and the untextured one did not.
    """
    changed = False
    if not js.get('extras', {}).get(SRGB_FIXED):
        for m in js.get('materials', []):
            pbr = m.get('pbrMetallicRoughness')
            if not pbr or pbr.get('baseColorTexture'):
                continue
            f = pbr.get('baseColorFactor')
            if not f:
                continue
            pbr['baseColorFactor'] = [round(c ** 2.2, 6) for c in f[:3]] + list(f[3:])
            changed = True
        js.setdefault('extras', {})[SRGB_FIXED] = True
        changed = True
    for m in js.get('materials', []):
        pbr = m.get('pbrMetallicRoughness')
        if not pbr:
            continue
        # An unassigned slot exported as pure white. nature-kit's standalone
        # boulders carry it on the rock body itself, so a quarry built from
        # them is a quarry made of snow. The cliff pieces are fine — they use a
        # proper brown 'dirt' with 'grass' on top — so only the literal
        # untinted default is touched.
        if m.get('name') == '_defaultMat' and pbr.get('baseColorFactor', [0])[:3] == [1.0, 1.0, 1.0]:
            pbr['baseColorFactor'] = [0.29, 0.24, 0.19, 1.0]
            changed = True
        if pbr.get('metallicFactor', 1) > 0.05:
            pbr['metallicFactor'] = 0.0
            changed = True
        # roughness 1 is flat and dead; 0.75 keeps a little sheen on the highlights
        if pbr.get('roughnessFactor', 1) > 0.95:
            pbr['roughnessFactor'] = 0.75
            changed = True
    return changed


def embed(path, cache):
    js, bin_ = read_glb(path)
    if not js:
        return False
    changed = fix_materials(js)
    for img in js.get('images') or []:
        uri = img.get('uri')
        if not uri or uri.startswith('data:'):
            continue
        src = os.path.normpath(os.path.join(os.path.dirname(path), uri))
        if not os.path.exists(src):
            # kits name the folder Textures/ but ship colormap.png beside the models
            alt = os.path.join(os.path.dirname(path), os.path.basename(uri))
            if not os.path.exists(alt):
                print('    ! no texture for %s (%s)' % (os.path.basename(path), uri))
                continue
            src = alt
        if src not in cache:
            cache[src] = open(src, 'rb').read()
        png = cache[src]
        # bin chunk offsets must stay 4-aligned for the accessors that follow
        pad = (4 - len(bin_) % 4) % 4
        bin_ += b'\0' * pad
        js.setdefault('bufferViews', []).append(
            {'buffer': 0, 'byteOffset': len(bin_), 'byteLength': len(png)})
        img.pop('uri')
        img['bufferView'] = len(js['bufferViews']) - 1
        img['mimeType'] = 'image/png' if src.lower().endswith('.png') else 'image/jpeg'
        bin_ += png
        changed = True
    if changed:
        if bin_:
            js['buffers'] = [{'byteLength': len(bin_)}]
        write_glb(path, js, bin_)
    return changed


def main(only):
    cache = {}
    total = 0
    for pack in sorted(os.listdir(PACKS)):
        if only and pack not in only:
            continue
        d = os.path.join(PACKS, pack)
        if not os.path.isdir(d):
            continue
        n = 0
        for f in sorted(os.listdir(d)):
            if f.endswith('.glb') and embed(os.path.join(d, f), cache):
                n += 1
        total += n
        print('  %-24s %3d fixed' % (pack, n))
    print('%d models corrected' % total)


if __name__ == '__main__':
    main(set(sys.argv[1:]))
