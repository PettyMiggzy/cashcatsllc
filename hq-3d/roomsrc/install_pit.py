"""Install The Pit — the arena out past the Workshop."""
import hashlib, json, os, sqlite3, datetime, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
HQ = os.path.dirname(ROOT)
DB = os.path.join(HQ, 'world', 'db.sqlite')
ASSETS = os.path.join(HQ, 'world', 'assets')

import texprops


def put(path, ext):
    d = open(path, 'rb').read()
    h = hashlib.sha256(d).hexdigest()
    dst = os.path.join(ASSETS, '%s.%s' % (h, ext))
    if not os.path.exists(dst):
        open(dst, 'wb').write(d)
    return 'asset://%s.%s' % (h, ext)


now = datetime.datetime.utcnow().isoformat() + 'Z'
con = sqlite3.connect(DB)
script = put(os.path.join(ROOT, 'pit.js'), 'js')
# A script-only room still needs a model: the loader calls endsWith on the
# url, so a null model takes the whole world down on boot.
model = put(os.path.join(ROOT, 'empty.glb'), 'glb')

BP = 'cashcats-pit'
bp = {'id': BP, 'version': 1, 'name': 'The Pit', 'image': None, 'author': None,
      'url': None, 'desc': None, 'model': model, 'script': script,
      'props': texprops.props(['paving', 'marbleFloor', 'wood']),
      'preload': True, 'public': False, 'locked': False, 'frozen': False,
      'unique': False, 'scene': False, 'disabled': False}
con.execute('insert or replace into blueprints (id,data,createdAt,updatedAt) values (?,?,?,?)',
            (BP, json.dumps(bp), now, now))

# At the origin, like the campus: the app proxy exposes no position, so the
# script works in world coordinates and places itself.
EID = 'cashcatsPit'
ent = {'id': EID, 'type': 'app', 'blueprint': BP, 'position': [0, 0, 0],
       'quaternion': [0, 0, 0, 1], 'scale': [1, 1, 1], 'mover': None,
       'uploader': None, 'pinned': True, 'state': {}}
con.execute('insert or replace into entities (id,data,createdAt,updatedAt) values (?,?,?,?)',
            (EID, json.dumps(ent), now, now))

con.commit()
n = con.execute('select count(*) from entities').fetchone()[0]
print('the pit installed at [48,0,0]')
print('%d entities' % n)
