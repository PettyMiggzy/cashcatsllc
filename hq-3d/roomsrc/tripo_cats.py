#!/usr/bin/env python3
"""
Turn the cast portraits into rigged, wearable VRM avatars via Tripo.

    export TRIPO_KEY=tsk_...
    python3 roomsrc/tripo_cats.py            # all five
    python3 roomsrc/tripo_cats.py pop cash   # just these

Pipeline, per cat:

    cast/cat_<name>.png
      -> POST /v2/openapi/upload            image_token          (free)
      -> POST /v2/openapi/task              image_to_model       (costs credits)
      -> GET  /v2/openapi/task/{id}         poll to success
      -> POST /v3/animations/rig            biped, spec=mixamo   (costs credits)
      -> GET  /v3/tasks/{id}                poll to success
      -> download the rigged glb
      -> glb2vrm.py                         wearable avatar

spec=mixamo matters: it makes Tripo emit Mixamo bone names, which is exactly
what glb2vrm.py already maps, so no renaming is needed in between.

rig_type=biped matters too. Hyperfy's fourteen stock clips are humanoid, so a
quadruped rig would have nothing to retarget onto — these are cat *people*,
which is also what the avatar has always been.

State is written to cast_vrm/state.json after every step, so a run that dies
(credits, network) resumes instead of paying twice for the same model.
"""
import json
import os
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, 'cast_vrm')
STATE = os.path.join(OUT, 'state.json')

V2 = 'https://api.tripo3d.ai/v2/openapi'
V3 = 'https://openapi.tripo3d.ai/v3'

CATS = {
    'cash':    ('../../assets/cashcat.png', 'Cash Cat'),
    'long':    ('cast/cat_long.png',        'Long Cat'),
    'serious': ('cast/cat_serious.png',     'Serious Cat'),
    'apple':   ('cast/cat_apple.png',       'Apple Cat'),
    'pop':     ('cast/cat_pop.png',         'Pop Cat'),
}

KEY = os.environ.get('TRIPO_KEY')
if not KEY:
    sys.exit('set TRIPO_KEY (never commit it — this repo is public)')
AUTH = {'Authorization': 'Bearer ' + KEY}


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
            sys.exit('\nOut of Tripo credits — top up and re-run; finished steps are cached.\n  ' + detail)
        raise SystemExit('HTTP %d from %s\n  %s' % (e.code, url, detail))


def upload(path):
    """Multipart by hand — no requests library in this container."""
    boundary = '----cashcats%d' % time.time_ns()
    name = os.path.basename(path)
    body = (b'--' + boundary.encode() + b'\r\n'
            b'Content-Disposition: form-data; name="file"; filename="' + name.encode() + b'"\r\n'
            b'Content-Type: image/png\r\n\r\n' + open(path, 'rb').read() +
            b'\r\n--' + boundary.encode() + b'--\r\n')
    req = urllib.request.Request(V2 + '/upload', data=body, method='POST')
    for k, v in AUTH.items():
        req.add_header(k, v)
    req.add_header('Content-Type', 'multipart/form-data; boundary=' + boundary)
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read())['data']['image_token']


def wait(url, label, every=6, limit=1800):
    t0 = time.time()
    last = None
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
    if os.path.exists(STATE):
        return json.load(open(STATE))
    return {}


def save_state(s):
    os.makedirs(OUT, exist_ok=True)
    json.dump(s, open(STATE, 'w'), indent=1)


def main(which):
    os.makedirs(OUT, exist_ok=True)
    state = load_state()
    for key in which:
        rel, title = CATS[key]
        src = os.path.normpath(os.path.join(ROOT, rel))
        st = state.setdefault(key, {})
        print('\n== %s (%s)' % (title, os.path.basename(src)))

        if not st.get('image_token'):
            st['image_token'] = upload(src)
            save_state(state); print('    uploaded ->', st['image_token'][:8])

        if not st.get('model_task'):
            r = call(V2 + '/task', {
                'type': 'image_to_model',
                'file': {'type': 'png', 'file_token': st['image_token']},
                'texture': True, 'pbr': True,
            })
            st['model_task'] = r['data']['task_id']
            save_state(state); print('    model task', st['model_task'])
        if not st.get('model_done'):
            wait(V2 + '/task/' + st['model_task'], 'model')
            st['model_done'] = True
            save_state(state)

        if not st.get('rig_task'):
            r = call(V3 + '/animations/rig', {
                'input': st['model_task'],
                # Required. Left unset the API picks a version it then rejects
                # ("invalid model 'v2.5-20250123'"). v1.0 is the humanoid rigger;
                # v2.5-20260210 is the one for quadrupeds and other creatures.
                'model': 'v1.0-20240301',
                'rig_type': 'biped',       # humanoid: the stock clips are humanoid
                'spec': 'mixamo',          # bone names glb2vrm.py already maps
                'out_format': 'glb',
            })
            st['rig_task'] = (r.get('data') or r).get('task_id') or (r.get('data') or r).get('id')
            save_state(state); print('    rig task', st['rig_task'])
        d = wait(V3 + '/tasks/' + st['rig_task'], 'rig')

        url = (d.get('output') or {}).get('model') or d.get('model_url') or (d.get('result') or {}).get('model')
        if not url:
            raise SystemExit('    no model url in: ' + json.dumps(d)[:400])
        glb = os.path.join(OUT, 'cat_%s_rigged.glb' % key)
        urllib.request.urlretrieve(url, glb)
        print('    downloaded %s (%.1f MB)' % (os.path.basename(glb), os.path.getsize(glb) / 1e6))

        vrm = os.path.join(OUT, 'cat_%s.vrm' % key)
        subprocess.check_call([sys.executable, os.path.join(ROOT, 'glb2vrm.py'),
                               glb, vrm, '--name', title])
        st['vrm'] = vrm
        save_state(state)
        print('    -> %s' % vrm)

    print('\ndone. wearable avatars in %s' % OUT)


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if a in CATS] or list(CATS)
    main(args)
