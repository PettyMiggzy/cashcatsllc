"""Install The Homestead."""
import hashlib, json, os, sqlite3, datetime

ROOT = os.path.dirname(os.path.abspath(__file__))
HQ   = os.path.dirname(ROOT)
DB     = os.path.join(HQ, 'world', 'db.sqlite')
ASSETS = os.path.join(HQ, 'world', 'assets')

def put(path, ext):
    d = open(path, 'rb').read()
    h = hashlib.sha256(d).hexdigest()
    dst = os.path.join(ASSETS, '%s.%s' % (h, ext))
    if not os.path.exists(dst):
        open(dst, 'wb').write(d)
    return 'asset://%s.%s' % (h, ext)

now = datetime.datetime.utcnow().isoformat() + 'Z'
con = sqlite3.connect(DB)

script = put(os.path.join(ROOT, 'homestead.js'), 'js')
model  = put(os.path.join(ROOT, 'empty.glb'), 'glb')

BP = 'cashcats-homestead'
bp = {'id': BP, 'version': 1, 'name': 'The Homestead', 'image': None, 'author': None,
      'url': None, 'desc': None, 'model': model, 'script': script, 'props': {},
      'preload': True, 'public': False, 'locked': False, 'frozen': False,
      'unique': False, 'scene': False, 'disabled': False}
con.execute('insert or replace into blueprints (id,data,createdAt,updatedAt) values (?,?,?,?)',
            (BP, json.dumps(bp), now, now))

EID = 'cashcatsHomestead'
ent = {'id': EID, 'type': 'app', 'blueprint': BP, 'position': [-22, 0, 0],
       'quaternion': [0, 0, 0, 1], 'scale': [1, 1, 1], 'mover': None,
       'uploader': None, 'pinned': True, 'state': {}}
con.execute('insert or replace into entities (id,data,createdAt,updatedAt) values (?,?,?,?)',
            (EID, json.dumps(ent), now, now))
con.commit()
print('homestead installed at x=-22 |', con.execute('select count(*) from entities').fetchone()[0], 'entities')
con.close()
