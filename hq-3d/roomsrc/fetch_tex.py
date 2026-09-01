"""
Ground textures, from Poly Haven, tiled and ready to stretch.

Every ground plane in this world was a flat colour: the Seam grey, the Cat
Park a pure green, the shore a pale blue. That reads as cartoon more than any
building does, because real ground is never one value, and a big untextured
plane is the first thing the eye calls fake.

Two constraints shape this:

  Prims take exactly one albedo map and no repeat control. Prim.js sets
  `material.map` and stops, and the material is cached and shared by every
  prim with the same key, so there is nowhere to hang a per-surface repeat.
  A 1k image stretched over an 80m field is mush. The tiling has to be baked
  into the pixels, which is what tile.py already does for the plaza.

  There is no normal map on that path either, so the diffuse carries all of
  it. That rules out textures whose detail lives in their relief and favours
  ones that read from colour alone.

tile.py's tiled() builds the whole sheet at source resolution and resizes at
the end, which at 24 tiles means composing a 24k-pixel-square image to throw
almost all of it away. This downsamples each tile first and composes at the
output size, so a 24x24 sheet costs the same as a 2x2 one.

GROUNDS is the list: a name, a Poly Haven slug, and how many times it repeats
across its plane. Counts are metres-per-tile against the size of the surface,
not taste — too few is a blurry smear, too many moires into noise at distance.

    python3 roomsrc/fetch_tex.py [--force]
"""
import json, os, sys, urllib.request
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.join(ROOT, 'tex')
RAW = os.path.join(TEX, 'raw')
API = 'https://api.polyhaven.com'
UA = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
                    '(KHTML, like Gecko) Chrome/120 Safari/537.36'}
SHEET = 2048        # the grounds are the biggest surfaces in the world
RES = '1k'

# name -> (poly haven slug, tiles across the sheet, target mean colour)
#
# The grounds are laid as a grid of prims rather than one plane (see ground()
# in lands.js), so the repeat you actually see is this count times the grid.
#
# The target is not decoration. These are photographic albedos and they are
# both darker and browner than anyone expects: measured, sparse_grass averages
# #4f3d15, which is mud. Every grass texture on Poly Haven is red-dominant,
# because real grass photographed flat is khaki — true, and useless for a park
# lawn, which would read as dead. So the sheet is scaled per channel to land
# its mean on the target while keeping every bit of the photo's variation.
# Structure from the photograph, colour from the world.
GROUNDS = {
    't_grass':  ('sparse_grass',     12, '#6d8a4c'),
    't_gravel': ('gravel',           14, '#8a8378'),
    't_sand':   ('coast_sand_02',    10, '#cbb894'),
    't_forest': ('forest_ground_04', 12, '#6f5c40'),
    't_field':  ('park_dirt',        10, '#8a7047'),
    't_path':   ('grass_path_2',      8, '#94886a'),
}


def get(url, timeout=180):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read()


def retint(im, target):
    """
    Scale each channel so the image's mean lands on target.

    A flat multiply rather than a hue rotation, so every relative difference
    in the photograph survives: the blades stay lighter than the soil between
    them by the same ratio, the whole thing just sits at a different colour.
    Channels are clamped, which costs a little contrast at the top end on a
    strong push and nothing at all on a small one.
    """
    r, g, b = [int(target[i:i + 2], 16) for i in (1, 3, 5)]
    mr, mg, mb = [c / 255.0 for c in im.resize((1, 1)).getpixel((0, 0))]
    ks = [(r / 255.0) / max(mr, 1e-3), (g / 255.0) / max(mg, 1e-3), (b / 255.0) / max(mb, 1e-3)]
    return Image.merge('RGB', [ch.point(lambda v, k=k: min(255, int(v * k)))
                               for ch, k in zip(im.split(), ks)])


def bake(src, n, out, target=None):
    """
    Mirror-tile src n times across a SHEET-square jpg.

    Mirroring ([I, flip_h] over [flip_v, flip_hv]) is seamless at every edge
    by construction, so the block repeats without a join. It costs symmetry,
    which ground cover hides well.
    """
    cell = max(16, SHEET // n)              # one source tile, at output scale
    im = Image.open(src).convert('RGB').resize((cell, cell), Image.LANCZOS)
    if target:
        im = retint(im, target)
    block = Image.new('RGB', (cell * 2, cell * 2))
    block.paste(im, (0, 0))
    block.paste(im.transpose(Image.FLIP_LEFT_RIGHT), (cell, 0))
    block.paste(im.transpose(Image.FLIP_TOP_BOTTOM), (0, cell))
    block.paste(im.transpose(Image.ROTATE_180), (cell, cell))
    sheet = Image.new('RGB', (SHEET, SHEET))
    for x in range(0, SHEET, block.width):
        for y in range(0, SHEET, block.height):
            sheet.paste(block, (x, y))
    # 72, not 88. These are noisy ground cover and the artefacts hide in the
    # noise — measured on the gravel sheet, 88 and 80 both land near 1.7MB and
    # 72 halves it to 925KB at the same 2048 resolution. Dropping resolution
    # instead would have cost real sharpness underfoot for less.
    sheet.save(out, quality=72, optimize=True)


def make_water(out, px=1024, tiles=6):
    """
    A seamless ripple, generated rather than downloaded.

    Poly Haven has no water texture and there is no need for one. Water in this
    engine does not need a picture of water — prims carry metalness and
    roughness, and every surface here is lit by the HDRI, so a low-roughness
    plane reflects the actual sky and that is most of the way there. What the
    texture adds is break-up: without it the reflection is one flat mirror and
    the eye reads a sheet of plastic.

    So this is deliberately faint. Sum a few sine waves at whole-number
    frequencies, which makes it tile exactly, and keep the amplitude low enough
    that it reads as surface rather than as pattern.
    """
    import math
    im = Image.new('RGB', (px, px))
    q = im.load()
    W = [(3, 5, 1.0, 0.0), (7, 2, 0.6, 1.1), (2, 9, 0.5, 2.3), (11, 6, 0.3, 0.7)]
    base = (0x3f, 0x8f, 0xb4)
    for y in range(px):
        v = y / px * 2 * math.pi * tiles
        for x in range(px):
            u = x / px * 2 * math.pi * tiles
            a = 0.0
            for fx, fy, amp, ph in W:
                a += amp * math.sin(u * fx + v * fy + ph)
            a /= sum(w[2] for w in W)                 # -1..1
            k = 1.0 + a * 0.085                       # a whisper, not a pattern
            q[x, y] = tuple(min(255, int(c * k)) for c in base)
    im.save(out, quality=92)


def main():
    force = '--force' in sys.argv
    os.makedirs(RAW, exist_ok=True)
    w = os.path.join(TEX, 't_water.jpg')
    if force or not os.path.exists(w):
        make_water(w)
        print('  %-10s %-20s generated  %4dKB' % ('t_water', '(sine ripple)', os.path.getsize(w) // 1024))
    else:
        print('  %-10s have' % 't_water')

    for name, (slug, n, target) in sorted(GROUNDS.items()):
        out = os.path.join(TEX, name + '.jpg')
        if os.path.exists(out) and not force:
            print('  %-10s have' % name)
            continue
        raw = os.path.join(RAW, slug + '.jpg')
        if not os.path.exists(raw):
            try:
                files = json.loads(get('%s/files/%s' % (API, slug)))
                url = files['Diffuse'][RES]['jpg']['url']
            except Exception as e:
                print('  %-10s api: %s' % (name, e)); continue
            try:
                open(raw, 'wb').write(get(url))
            except Exception as e:
                print('  %-10s fetch: %s' % (name, e)); continue
        try:
            bake(raw, n, out, target)
        except Exception as e:
            print('  %-10s bake: %s' % (name, e)); continue
        print('  %-10s %-20s %2d tiles  %-8s %4dKB' % (
            name, slug, n, target, os.path.getsize(out) // 1024))


if __name__ == '__main__':
    main()
