#!/usr/bin/env python3
"""
Pull a real HDRI from Poly Haven and use it to light the world.

    python3 roomsrc/fetch_sky.py                     # the default sky
    python3 roomsrc/fetch_sky.py kloppenheim_06_puresky
    python3 roomsrc/fetch_sky.py --list

The sky is what lights everything here. Hyperfy has no light nodes at all —
every surface in the world is lit from scene.environment, so the environment
map is not decoration, it is the entire lighting rig.

Which is why the world looked like painted foam board. mkhdr.py wrote a
generated JPEG into a .hdr container: 1024x512, no values above 1.0, no sun
disc. Nothing to cast a highlight, nothing to reflect, no colour bouncing off
anything. A real high-dynamic-range capture has a sun thousands of times
brighter than the sky around it, and that difference is what makes a surface
read as a surface.

Poly Haven is CC0 — public domain, commercial use, no attribution required.
Worth supporting anyway: polyhaven.com/support
"""
import json
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.join(ROOT, 'tex')
API = 'https://api.polyhaven.com'
# The api rejects urllib's default agent outright; curl works, python does not.
UA = {'User-Agent': 'Mozilla/5.0 (cashcats world builder)'}


def _open(url, timeout=90):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout)


def _save(url, dst):
    with _open(url, 300) as r, open(dst, 'wb') as f:
        f.write(r.read())

# Warm, low sun, clean horizon — it suits the brand's gold and reads well
# behind the cream buildings without fighting them.
# kloofendal_43d_clear, and the choice matters more than a filename.
#
# belfast_sunset_puresky is a PURE SKY — no ground in the capture — so it lights
# the world from the whole hemisphere with nothing occluding from below and
# nothing bouncing back. That is flat by construction: no contact shadow, no
# lit-and-shaded sides, every albedo washed a stop toward white. Since Hyperfy
# has no light nodes, the HDRI is not one input among several, it is the entire
# rig, so this was the exposure of the whole world.
#
# It also had to change HERE and not just in tex/. setup.sh runs this on every
# deploy, so leaving the old default would have re-downloaded the pure sky over
# the committed one and quietly undone the fix on the way to production.
DEFAULT = 'kloofendal_43d_clear'
RES = '2k'      # 4k is 17MB and every player downloads it; 2k lights the same


def files(hid):
    with _open('%s/files/%s' % (API, hid)) as r:
        return json.loads(r.read())


def get(hid=DEFAULT, res=RES):
    os.makedirs(TEX, exist_ok=True)
    f = files(hid)
    hdri = f.get('hdri', {})
    if res not in hdri:
        res = sorted(hdri)[0]
    url = hdri[res]['hdr']['url']
    dst = os.path.join(TEX, 'sky_env.hdr')
    print('  %s @ %s' % (hid, res))
    _save(url, dst)
    print('  -> %s (%.1f MB)' % (os.path.relpath(dst, ROOT), os.path.getsize(dst) / 1e6))

    # the visible panorama, so the backdrop matches the light
    tone = f.get('tonemapped') or {}
    if tone:
        try:
            u = list(tone.values())[0]['url'] if isinstance(list(tone.values())[0], dict) else None
        except Exception:
            u = None
        if u:
            bg = os.path.join(TEX, 'sky_bg.jpg')
            _save(u, bg)
            print('  -> %s (%.1f MB)' % (os.path.relpath(bg, ROOT), os.path.getsize(bg) / 1e6))
    print('\nCC0 / public domain, Poly Haven — support at polyhaven.com/support')


if __name__ == '__main__':
    a = [x for x in sys.argv[1:] if not x.startswith('-')]
    if '--list' in sys.argv:
        with _open('%s/assets?t=hdris&c=skies' % API) as r:
            for k in sorted(json.loads(r.read())):
                print(' ', k)
        raise SystemExit(0)
    get(a[0] if a else DEFAULT)
