"""
Shared texture props for every room.

The generated materials live in roomsrc/tex/ and are content-addressed into
the world asset store, then handed to each app as props so a script can do
`props.plaster.url` without knowing any hashes.
"""
import hashlib
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
HQ = os.path.dirname(ROOT)
ASSETS = os.path.join(HQ, 'world', 'assets')

# prop name -> (file, type)
TEXTURES = {
    'paving':      ('t_paving.jpg',       'image'),
    'pavingRoom':  ('t_paving_room.jpg',  'image'),
    'plaster':     ('t_plaster.jpg',      'image'),
    'wainscot':    ('t_wainscot.jpg',     'image'),
    'marbleFloor': ('t_marble_floor.jpg', 'image'),
    'marbleWall':  ('t_marble_wall.jpg',  'image'),
    'wood':        ('t_wood.jpg',         'image'),
    'soil':        ('t_soil.jpg',         'image'),
    'skyBg':       ('sky_bg.jpg',         'image'),
    'skyHdr':      ('sky_env.hdr',        'hdr'),
}


def put(path, ext):
    d = open(path, 'rb').read()
    h = hashlib.sha256(d).hexdigest()
    dst = os.path.join(ASSETS, '%s.%s' % (h, ext))
    if not os.path.exists(dst):
        open(dst, 'wb').write(d)
    return 'asset://%s.%s' % (h, ext)


def props(names=None):
    out = {}
    for key, (fname, kind) in TEXTURES.items():
        if names and key not in names:
            continue
        ext = fname.rsplit('.', 1)[1]
        url = put(os.path.join(ROOT, 'tex', fname), ext)
        out[key] = {'type': kind, 'name': fname, 'url': url}
    return out
