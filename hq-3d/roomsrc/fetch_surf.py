"""
Surface maps for the kit buildings — normal and roughness, from Poly Haven.

The kit models are 286-triangle panels carrying one palette swatch. Their
colour is fine now; what they have never had is a surface. A wall with no
normal map returns the same value from every angle, so it reads as paper
whatever colour you paint it, and no amount of colour work fixes that.

The engine has always been able to do this — GLTFLoader sets
`texture.channel = mapDef.texCoord`, so a material can take its colour from
one UV set and its normals from another. That is the whole trick: the palette
UVs stay exactly as they are on TEXCOORD_0, and bump_kit.py adds a second,
box-projected UV set for these maps to sit on.

Nothing is tiled into a sheet here, unlike the ground textures. glTF's default
wrap is REPEAT, so a box projection measured in metres tiles these by itself —
and mirroring a normal map would be wrong anyway, since a mirrored tile needs
its X channel negated or the light comes from the wrong side along every seam.

    python3 roomsrc/fetch_surf.py [--force]
"""
import json, os, sys, urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.join(ROOT, 'tex')
API = 'https://api.polyhaven.com'
UA = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
                    '(KHTML, like Gecko) Chrome/120 Safari/537.36'}
RES = '1k'

# name -> (poly haven slug, which map)
#
# One surface per material family. White stucco is the wall: it is fine,
# even, and almost colourless as relief, so it adds tooth to a painted wall
# without arguing with whatever colour the palette put there.
SURF = {
    'n_wall':  ('white_stucco',     'nor_gl'),
    'r_wall':  ('white_stucco',     'Rough'),
    'n_roof':  ('clay_roof_tiles',  'nor_gl'),
    'n_wood':  ('wood_planks',      'nor_gl'),
}


def get(url, timeout=180):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read()


def main():
    force = '--force' in sys.argv
    for name, (slug, kind) in sorted(SURF.items()):
        out = os.path.join(TEX, name + '.jpg')
        if os.path.exists(out) and not force:
            print('  %-8s have' % name)
            continue
        try:
            files = json.loads(get('%s/files/%s' % (API, slug)))
            url = files[kind][RES]['jpg']['url']
            open(out, 'wb').write(get(url))
        except Exception as e:
            print('  %-8s %s: %s' % (name, slug, e))
            continue
        print('  %-8s %-18s %-8s %4dKB' % (name, slug, kind, os.path.getsize(out) // 1024))


if __name__ == '__main__':
    main()
