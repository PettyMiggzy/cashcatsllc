#!/usr/bin/env python3
"""
Fetch the CC0 asset packs the world is built from.

    python3 roomsrc/fetch_packs.py            # everything below
    python3 roomsrc/fetch_packs.py pirate-kit # just one
    python3 roomsrc/fetch_packs.py --list

These are Kenney's, public domain, free for commercial use. They are proper
game assets — a whole building is a few hundred triangles, where a generated
one arrives at half a million. Generation is for the things nobody else has
made: the cats, and props with CashCats written on them.

kenney.nl puts the real download behind a donation prompt, and the zip url
lives in that modal rather than on any button. So: read the page, take the
url out of the modal, download, unpack, keep the glTF.

Please consider donating at https://kenney.nl/donate — the licence does not
ask for it, which is exactly why it is worth doing.
"""
import io
import os
import re
import shutil
import sys
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, 'packs')

# slug -> what we want it for
PACKS = {
    'city-kit-commercial': 'shops and offices for the campus',
    'city-kit-roads':      'roads, pavements, crossings',
    'city-kit-industrial': 'warehouses and yards',
    'fantasy-town-kit':    'the Homestead — cottages, market stalls, fences',
    'pirate-kit':          'FISHING — docks, jetties, boats, crates, water',
    'mini-forest':         'FORAGING — trees, stumps, mushrooms, bushes',
    'modular-cave-kit':    'MINING — rock walls, ore, cave mouths',
    'nature-kit':          'ground cover, rocks, plants',
    'furniture-kit':       'interiors for the offices',
    'cube-pets':           'small creatures',
}

UA = {'User-Agent': 'Mozilla/5.0 (cashcats world builder)'}


def zip_url(slug):
    """The real download lives in the donation modal, not on a button."""
    req = urllib.request.Request('https://kenney.nl/assets/' + slug, headers=UA)
    with urllib.request.urlopen(req, timeout=90) as r:
        html = r.read().decode('utf-8', 'replace')
    m = re.search(r"href='(https://kenney\.nl/media/pages/assets/[^']+\.zip)'", html)
    return m.group(1) if m else None


def fetch(slug):
    url = zip_url(slug)
    if not url:
        print('  %-22s no download link on the page' % slug)
        return 0
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=300) as r:
        blob = r.read()

    dest = os.path.join(OUT, slug)
    shutil.rmtree(dest, ignore_errors=True)
    os.makedirs(dest, exist_ok=True)

    kept = 0
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        names = z.namelist()
        # Prefer glTF; the packs also ship obj/fbx we have no use for.
        want = [n for n in names if n.lower().endswith(('.glb', '.gltf', '.bin'))]
        want += [n for n in names if n.lower().endswith(('.png', '.jpg'))
                 and '/textures/' in n.lower()]
        for n in want:
            if n.endswith('/'):
                continue
            target = os.path.join(dest, os.path.basename(n))
            with z.open(n) as src, open(target, 'wb') as out:
                shutil.copyfileobj(src, out)
            if n.lower().endswith(('.glb', '.gltf')):
                kept += 1
    print('  %-22s %3d models  (%.1f MB zip)  %s' % (slug, kept, len(blob) / 1e6, PACKS[slug]))
    return kept


def main(which):
    os.makedirs(OUT, exist_ok=True)
    total = 0
    for slug in which:
        try:
            total += fetch(slug)
        except Exception as e:
            print('  %-22s failed: %s' % (slug, str(e)[:70]))
    print('\n%d models in %s' % (total, OUT))
    print('CC0 / public domain, Kenney (kenney.nl) — donations at kenney.nl/donate')


if __name__ == '__main__':
    args = sys.argv[1:]
    if '--list' in args:
        for k, v in PACKS.items():
            print('  %-22s %s' % (k, v))
        raise SystemExit(0)
    main([a for a in args if a in PACKS] or list(PACKS))
