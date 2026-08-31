#!/usr/bin/env python3
"""
Generate world props as meshes via Tripo.

    export TRIPO_KEY=tsk_...
    python3 roomsrc/tripo_props.py               # everything not already made
    python3 roomsrc/tripo_props.py bench lamp    # just these
    python3 roomsrc/tripo_props.py --list        # what would be made, and the cost

Props are text_to_model, not image_to_model: there is no reference art for a
bench, and writing one prompt beats generating a picture of a bench first and
paying to convert it. They are not rigged either, which is the whole saving —
a prop is a mesh, and the rig step is what costs on top.

Everything lands in roomsrc/props/ as .glb, ready for install_campus.py to
place. State is written after every step so a run that dies on credits or
network resumes instead of paying twice for the same mesh.
"""
import json
import os
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, 'props')
STATE = os.path.join(OUT, 'state.json')

V2 = 'https://api.tripo3d.ai/v2/openapi'

# One consistent art direction, or the plaza turns into a jumble. Everything
# below is described as the same kind of object: clean, stylised, matte, the
# look the buildings already have.
STYLE = ('stylised low-poly game asset, clean matte surfaces, soft warm '
         'lighting, neutral cream and forest green palette, single object, '
         'centred, no background, no base plinth')

PROPS = {
    # the plaza
    'bench':      'a simple wooden park bench with iron legs',
    'lamp':       'a tall street lamp post with a lantern head',
    'planter':    'a rectangular stone planter box with a low hedge in it',
    'fountain':   'a small round stone fountain, two tiers',
    'bin':        'a public litter bin, metal, slatted sides',
    'signpost':   'a wooden fingerpost signpost with three blank arms',
    'bollard':    'a short stone bollard with a rope loop',
    'planterRound': 'a large round terracotta planter with a small tree',

    # the homestead
    'crate':      'a wooden shipping crate, closed lid',
    'barrel':     'a wooden barrel with iron bands',
    'sack':       'a full hessian sack tied at the neck',
    'toolRack':   'a wooden rack holding farm tools, rake and hoe',
    'well':       'a round stone well with a wooden roof and bucket',
    'fence':      'a short section of wooden post and rail fence',
    'trough':     'a long wooden water trough',
    'haystack':   'a small round haystack',

    # the filing office and workshop
    'desk':       'a heavy wooden office desk with drawers',
    'chair':      'a wooden office chair with a leather seat',
    'cabinet':    'a tall wooden filing cabinet, four drawers',
    'shelf':      'a wooden bookshelf holding ledgers and boxes',
    'anvil':      'a blacksmith anvil on a wooden stump',
    'workbench':  'a workbench with a vice and scattered tools',
    'toolbox':    'a metal toolbox, closed',
    'lantern':    'a hand lantern with a glass panel',

    # the vault
    'chest':      'a treasure chest, iron banded, closed',
    'coinPile':   'a small pile of gold coins',
    'safe':       'a heavy iron safe with a dial',
    'pedestal':   'a short marble display pedestal',
}

KEY = os.environ.get('TRIPO_KEY')
AUTH = {'Authorization': 'Bearer ' + (KEY or '')}


def call(url, body=None, method=None, timeout=120):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method or ('POST' if data else 'GET'))
    for k, v in AUTH.items():
        req.add_header(k, v)
    if data:
        req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors='replace')[:300]
        if e.code == 403 and 'credit' in detail:
            sys.exit('\nOut of Tripo credits — top up and re-run; finished props are cached.\n  ' + detail)
        raise SystemExit('HTTP %d from %s\n  %s' % (e.code, url, detail))


def wait(url, label, every=6, limit=1800):
    t0, last = time.time(), None
    while time.time() - t0 < limit:
        d = call(url).get('data', {})
        st = d.get('status')
        if st != last:
            print('    %s: %s' % (label, st))
            last = st
        if st in ('success', 'succeed', 'completed'):
            return d
        if st in ('failed', 'banned', 'cancelled', 'expired', 'error'):
            raise SystemExit('    %s failed: %s' % (label, json.dumps(d)[:300]))
        time.sleep(every)
    raise SystemExit('    %s timed out' % label)


def load_state():
    return json.load(open(STATE)) if os.path.exists(STATE) else {}


def save_state(s):
    os.makedirs(OUT, exist_ok=True)
    json.dump(s, open(STATE, 'w'), indent=1)


def main(which):
    os.makedirs(OUT, exist_ok=True)
    state = load_state()
    made = 0
    for key in which:
        glb = os.path.join(OUT, '%s.glb' % key)
        if os.path.exists(glb):
            print('== %-14s already made, skipping' % key)
            continue
        st = state.setdefault(key, {})
        print('\n== %s' % key)

        if not st.get('task'):
            r = call(V2 + '/task', {
                'type': 'text_to_model',
                'prompt': '%s, %s' % (PROPS[key], STYLE),
                'texture': True, 'pbr': True,
            })
            st['task'] = r['data']['task_id']
            save_state(state)
            print('    task', st['task'])

        d = wait(V2 + '/task/' + st['task'], key)
        out = d.get('output') or d.get('result') or {}
        url = (out.get('pbr_model') or out.get('model_url')
               or out.get('model') or d.get('model_url'))
        if isinstance(url, dict):
            url = url.get('url')
        if not url:
            raise SystemExit('    no model url in: ' + json.dumps(d)[:400])
        urllib.request.urlretrieve(url, glb)
        raw = os.path.getsize(glb) / 1e6

        # Thin it before it is ever placed. Tripo hands back a park bench at
        # 333,136 triangles with three 2048px textures — twenty of those is
        # 200MB of downloads and six and a half million triangles of street
        # furniture, and the world gets slower for every prop you add.
        subprocess.check_call([sys.executable, os.path.join(ROOT, 'thin_props.py'), key])
        made += 1
        print('    -> %s (%.1f MB raw, %.2f MB shipped)'
              % (os.path.basename(glb), raw, os.path.getsize(glb) / 1e6))

    print('\ndone. %d new prop%s in %s' % (made, '' if made == 1 else 's', OUT))


if __name__ == '__main__':
    args = sys.argv[1:]
    if '--list' in args:
        todo = [k for k in PROPS if not os.path.exists(os.path.join(OUT, '%s.glb' % k))]
        for k in sorted(PROPS):
            done = os.path.exists(os.path.join(OUT, '%s.glb' % k))
            print('  %-14s %s  %s' % (k, 'made ' if done else '     ', PROPS[k]))
        print('\n%d of %d still to make.' % (len(todo), len(PROPS)))
        print('text_to_model with texture+pbr runs about 20-30 credits each,')
        print('so roughly %d-%d credits (about $%.0f-%.0f) for the rest.'
              % (len(todo) * 20, len(todo) * 30, len(todo) * 0.20, len(todo) * 0.30))
        raise SystemExit(0)
    if not KEY:
        sys.exit('set TRIPO_KEY (never commit it — this repo is public)')
    picked = [a for a in args if a in PROPS] or list(PROPS)
    main(picked)
