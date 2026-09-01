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


# A naturalistic palette for the untextured kits.
#
# Kenney's nature kit is not drab-realistic and was never meant to be: its
# foliage is #29c9ab, its stone #b8e2e8 ice blue, its bark and dirt #e28357
# salmon. That is a coherent art direction and it is why every render of this
# world came back teal and pink — 688 materials across every tree, rock, bush,
# log and stump in it, sitting next to photoscanned cliffs that are none of
# those colours. Two directions in one frame reads as the cheaper one.
#
# So the greens go green and the woods go brown, and the silhouettes — which
# are good, and which are the reason to use the kit at all — do not change.
# Berries, flowers and signage keep their accent colours; those are meant to
# pop and nothing about them says cartoon.
#
# Keyed on material name and written in sRGB, so it is idempotent and reads
# like a paint chart. fix_materials applies it before the sRGB->linear step.
PALETTE = {
    # foliage
    'grass':        '#5f8f42',
    'leafsGreen':   '#4f8438',
    'leafsDark':    '#3d6b2e',
    'leafsFall':    '#c8722f',
    # timber
    'wood':         '#9c7248',
    'woodDark':     '#6b4f38',
    'woodBark':     '#7d5f42',
    'woodBarkDark': '#5e4632',
    'woodInner':    '#d8bd97',
    'woodBirch':    '#e8e0cf',
    # ground and rock
    'dirt':         '#9a7550',
    'dirtDark':     '#7a5c3f',
    'stone':        '#a8a49c',
    'stoneDark':    '#83807a',
    'water':        '#5f9fbe',
    'colorTan':     '#cfa276',
}


def repaint(js):
    """Put PALETTE on any factor-only material it names. sRGB in, sRGB out."""
    changed = False
    for m in js.get('materials', []):
        hexc = PALETTE.get(m.get('name'))
        if not hexc:
            continue
        pbr = m.get('pbrMetallicRoughness')
        if not pbr or pbr.get('baseColorTexture') or not pbr.get('baseColorFactor'):
            continue
        rgb = [int(hexc[i:i + 2], 16) / 255.0 for i in (1, 3, 5)]
        want = [round(c, 6) for c in rgb] + list(pbr['baseColorFactor'][3:])
        if pbr['baseColorFactor'] != want:
            pbr['baseColorFactor'] = want
            changed = True
    return changed


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
    # Repaint first: PALETTE is written in sRGB, and the pass below is what
    # converts sRGB to linear. On a model already converted (the flag is set)
    # the same values have to be squared here instead, or a re-run would put
    # raw sRGB into a linear slot and the greens would come back fluorescent.
    linear = bool(js.get('extras', {}).get(SRGB_FIXED))
    if repaint(js):
        changed = True
        if linear:
            for m in js.get('materials', []):
                if m.get('name') in PALETTE:
                    pbr = m.get('pbrMetallicRoughness', {})
                    f = pbr.get('baseColorFactor')
                    if f:
                        pbr['baseColorFactor'] = [round(c ** 2.2, 6) for c in f[:3]] + list(f[3:])
    if not linear:
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


# Kit colormaps that need their whole atlas moved, keyed by the pack folder.
#
# The textured kits carry the same magenta cast the nature kit does, but in
# pixels rather than factors: measured over its non-black swatches, the cave
# kit's atlas averages #a28589. That is a pink rock, and it is what the mine
# portal has been the whole time — bright salmon against a photoscanned cliff.
#
# Only the cave kit is moved. Its atlas is rock and nothing else, so shifting
# the lot is safe; the town and pirate kits share the cast but also carry blue
# windows, green shutters and painted hulls that a blanket retint would wreck.
ATLAS = {'modular-cave-kit': '#8a8279'}


# The shared Kenney palette, moved off neon.
#
# The town and pirate kits paint from the same atlas, so one table covers
# both. The first attempt at this matched exact palette swatches and moved the
# image by six values out of 255, because the flat swatches are only part of
# the sheet — the walls sample a gradient strip around #c27f5f, not a cell.
# So this works in hue bands instead, which is where the problem actually is.
#
# Measured over the atlas, ignoring its black padding: 40% of it sits at hue
# 10-30 (the terracotta walls and timber, which are fine), 18% at 210-220
# (windows and roof lead, also fine), 12% at 130-170 — the mint roofs — and 6%
# at 250-310, a violet and a magenta that belong in no village. Only the last
# two move.
#
# It is a shift, not a repaint. The village stays a bright village; a memecoin
# world has no business being drab. It just stops glowing.
BANDS = [
    # (hue from, hue to, hue pulled toward, blend, saturation x, value x, sat ceiling)
    (125, 172, 105, 0.55, 0.82, 0.86, 1.00),   # mint roofs -> a leafier green
    (245, 320, 285, 0.30, 0.55, 0.90, 1.00),   # neon violet and magenta, muted
    # The kit's masonry is blue-grey — #a0a8c9 and #868ba1 — which is why the
    # Pit's Roman colonnade came out periwinkle. The ceiling is what makes this
    # safe: the stone sits under a quarter saturation and the window glass
    # (#6794d9, #d0e8ff) well above it, so the columns go to stone and the
    # windows stay blue.
    (195, 240, 210, 0.00, 0.22, 1.00, 0.30),   # blue-grey masonry -> stone
]
SWATCH_KITS = ('fantasy-town-kit', 'pirate-kit')


def tone_bands(src, bands):
    """
    Move whole hue ranges of a colormap, leaving everything else alone.

    Done through a cache of distinct colours rather than per pixel: these
    atlases hold under two thousand of them across a quarter-million pixels.
    """
    import colorsys, io as _io
    from PIL import Image
    im = Image.open(_io.BytesIO(src)).convert('RGBA')
    px = im.load()
    w, h = im.size
    cache = {}

    def move(c):
        if c in cache:
            return cache[c]
        hh, ss, vv = colorsys.rgb_to_hsv(*[x / 255 for x in c])
        deg = hh * 360
        out = c
        for lo, hi, toward, blend, ks, kv, smax in bands:
            if lo <= deg <= hi and 0.12 < ss <= smax:
                deg = deg + (toward - deg) * blend
                r, g, b = colorsys.hsv_to_rgb(deg / 360, min(1, ss * ks), min(1, vv * kv))
                out = (int(r * 255), int(g * 255), int(b * 255))
                break
        cache[c] = out
        return out

    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if r + g + b < 24:
                continue
            px[x, y] = move((r, g, b)) + (a,)
    buf = _io.BytesIO()
    im.save(buf, 'PNG', optimize=True)
    return buf.getvalue()


def retint_atlas(src, target):
    """Scale a colormap's channels so its non-black mean lands on target."""
    from PIL import Image
    import io as _io
    im = Image.open(_io.BytesIO(src)).convert('RGBA')
    rgb = im.convert('RGB')
    px = [c for c in rgb.get_flattened_data() if sum(c) > 24]
    if not px:
        return src
    mean = [sum(c[i] for c in px) / len(px) / 255.0 for i in range(3)]
    want = [int(target[i:i + 2], 16) / 255.0 for i in (1, 3, 5)]
    ks = [w / max(m, 1e-3) for w, m in zip(want, mean)]
    r, g, b, a = im.split()
    out = Image.merge('RGBA', [ch.point(lambda v, k=k: min(255, int(v * k)))
                               for ch, k in zip((r, g, b), ks)] + [a])
    buf = _io.BytesIO()
    out.save(buf, 'PNG', optimize=True)
    return buf.getvalue()


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
            data = open(src, 'rb').read()
            kit = os.path.basename(os.path.dirname(path))
            if src.lower().endswith('.png'):
                if kit in ATLAS:
                    data = retint_atlas(data, ATLAS[kit])
                elif kit in SWATCH_KITS:
                    data = tone_bands(data, BANDS)
            cache[src] = data
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


def _need_pillow():
    """
    Say which package is missing, once, instead of a traceback per model.

    This ran on a server without Pillow and died five kits into the pack list
    with a bare ModuleNotFoundError, having already rewritten four. Half a
    correction is worse than none, because everything downstream — the boot
    check, the installers — reports success on top of it.
    """
    try:
        import PIL  # noqa: F401
    except ImportError:
        raise SystemExit(
            'embed_tex needs Pillow and it is not installed.\n'
            '  Ubuntu/Debian:  sudo apt-get install -y python3-pil\n'
            '  elsewhere:      pip install pillow\n'
            'Refusing to run: a partial pass leaves some kits corrected and '
            'the rest raw, which nothing downstream would notice.')


def main(only):
    _need_pillow()
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
