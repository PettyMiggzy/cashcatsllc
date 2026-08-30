"""Install the campus app and move the world spawn onto the plaza."""
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
import texprops
con = sqlite3.connect(DB)

script = put(os.path.join(ROOT, 'campus.js'), 'js')
model  = put(os.path.join(ROOT, 'cats.glb'), 'glb')

BP = 'cashcats-campus'
bp = {'id': BP, 'version': 1, 'name': 'World of CashCats — Campus', 'image': None, 'author': None,
      'url': None, 'desc': None, 'model': model, 'script': script, 'props': dict(texprops.props(), **texprops.cast()),
      'preload': True, 'public': False, 'locked': False, 'frozen': False,
      'unique': False, 'scene': False, 'disabled': False}
con.execute('insert or replace into blueprints (id,data,createdAt,updatedAt) values (?,?,?,?)',
            (BP, json.dumps(bp), now, now))

EID = 'cashcatsCampus'
ent = {'id': EID, 'type': 'app', 'blueprint': BP, 'position': [0, 0, 0],
       'quaternion': [0, 0, 0, 1], 'scale': [1, 1, 1], 'mover': None,
       'uploader': None, 'pinned': True, 'state': {}}
con.execute('insert or replace into entities (id,data,createdAt,updatedAt) values (?,?,?,?)',
            (EID, json.dumps(ent), now, now))

# spawn on the plaza looking back at the Filing Office, not inside it.
# identity quaternion: the default forward is -Z, which is the office.
spawn = {'position': [0, 0, 17], 'quaternion': [0, 0, 0, 1]}
con.execute('insert or replace into config (key,value) values (?,?)',
            ('spawn', json.dumps(spawn)))

con.commit()
print('campus installed; spawn ->', spawn['position'])
print(con.execute('select count(*) from entities').fetchone()[0], 'entities')
con.close()
