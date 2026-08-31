#!/usr/bin/env python3
"""
Give each cat its own colour, so five cats read as five characters.

    python3 roomsrc/recolor_cast.py            # all of them
    python3 roomsrc/recolor_cast.py pop long   # just these

Three of the five came back cream-furred in the same green vest, because
three of the five prompts asked for a cream cat in a green vest. On a
portrait sheet they are clearly different animals; in the game, seen from
behind at ten metres, Cash and Pop are the same cat. A demo of switching
character had to be re-shot at the orange one before the swap showed up at
all.

The deep fix is at the prompt, and those are rewritten. This is the fix for
the models already made: the texture atlas keeps the vest and the fur in
clearly separate colour bands, so rotating only the green pixels repaints
the clothing and leaves the animal alone. Cash Cat keeps green — it is the
brand, and the one cat whose look is not up for discussion.
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
from glb2vrm import read_glb, write_glb        # noqa: E402

try:
    from PIL import Image
except ImportError:
    sys.exit('needs pillow: pip install pillow')

# target hue in degrees, and how much to scale saturation and value.
# Serious Cat goes almost to charcoal — a stern grey tabby in a black
# waistcoat, which reads instantly against four coloured ones.
COLOURS = {
    'cash':    None,                  # green, unchanged: it is the brand
    'long':    (212, 1.00, 1.05),     # deep blue
    'serious': (215, 0.18, 0.55),     # near-black charcoal
    'apple':   (5,   1.05, 1.00),     # red, to go with the ginger fur
    'pop':     (288, 0.95, 1.05),     # violet
}

# The vest sits in a narrow green band; cream and pink fur sit near 20-40
# degrees at low saturation, so nothing of the cat itself is caught.
HUE_LO, HUE_HI = 95, 185
SAT_MIN = 40


def recolour(img, hue, sat_mul, val_mul):
    rgb = img.convert('RGB')
    hsv = rgb.convert('HSV')
    H, S, V = [list(c.getdata()) for c in hsv.split()]
    target = int(hue * 255 / 360)
    hit = 0
    for i in range(len(H)):
        h, s = H[i], S[i]
        if s >= SAT_MIN and HUE_LO * 255 // 360 <= h <= HUE_HI * 255 // 360:
            H[i] = target
            S[i] = min(255, int(s * sat_mul))
            V[i] = min(255, int(V[i] * val_mul))
            hit += 1
    out = Image.merge('HSV', [
        Image.new('L', img.size), Image.new('L', img.size), Image.new('L', img.size)])
    bands = []
    for data in (H, S, V):
        band = Image.new('L', img.size)
        band.putdata(data)
        bands.append(band)
    return Image.merge('HSV', bands).convert('RGB'), hit / float(len(H))


def basecolour_images(gltf):
    """Only the base colour maps. A hue rotation on a normal map is a disaster."""
    keep = set()
    for m in gltf.get('materials', []):
        ti = m.get('pbrMetallicRoughness', {}).get('baseColorTexture', {}).get('index')
        if ti is None:
            continue
        src = gltf['textures'][ti].get('source')
        if src is not None:
            keep.add(src)
    return keep


def main(which):
    for key in which:
        spec = COLOURS[key]
        path = os.path.join(ROOT, 'cast_vrm', 'cat_%s.vrm' % key)
        if not os.path.exists(path):
            print('%-8s no model yet, skipping' % key)
            continue
        if spec is None:
            print('%-8s green, left alone (brand)' % key)
            continue

        gltf, binary = read_glb(path)
        targets = basecolour_images(gltf)
        changed = 0
        for idx in sorted(targets):
            im = gltf['images'][idx]
            if 'bufferView' not in im:
                continue
            bv = gltf['bufferViews'][im['bufferView']]
            off = bv.get('byteOffset', 0)
            raw = bytes(binary[off:off + bv['byteLength']])
            img = Image.open(io.BytesIO(raw))
            new, frac = recolour(img, *spec)
            buf = io.BytesIO()
            new.save(buf, format='JPEG', quality=92)
            data = buf.getvalue()

            # append and repoint rather than splice: rewriting one view in
            # place would shift every offset after it
            while len(binary) % 4:
                binary.append(0)
            gltf['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary),
                                        'byteLength': len(data)})
            binary += data
            im['bufferView'] = len(gltf['bufferViews']) - 1
            im['mimeType'] = 'image/jpeg'
            changed += 1
            print('%-8s image %d: %.1f%% of pixels were vest' % (key, idx, frac * 100))

        gltf['buffers'][0]['byteLength'] = len(binary)
        write_glb(gltf, binary, path)
        print('%-8s -> hue %d, %d map%s repainted' % (key, spec[0], changed,
                                                      '' if changed == 1 else 's'))


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if a in COLOURS] or list(COLOURS)
    main(args)
