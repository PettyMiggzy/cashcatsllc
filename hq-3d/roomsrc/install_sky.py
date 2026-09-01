"""Install the Sky — the lighting rig for the whole world."""
import hashlib, json, os, sqlite3, datetime, subprocess

ROOT = os.path.dirname(os.path.abspath(__file__))
HQ   = os.path.dirname(ROOT)
DB     = os.path.join(HQ, 'world', 'db.sqlite')
ASSETS = os.path.join(HQ, 'world', 'assets')


def check_js(path):
    r = subprocess.run(['node', '--check', path], capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit('%s does not parse:\n%s' % (os.path.basename(path), r.stderr.strip()[:400]))


def put(path, ext):
    d = open(path, 'rb').read()
    h = hashlib.sha256(d).hexdigest()
    dst = os.path.join(ASSETS, '%s.%s' % (h, ext))
    if not os.path.exists(dst):
        open(dst, 'wb').write(d)
    return 'asset://%s.%s' % (h, ext)


now = datetime.datetime.utcnow().isoformat() + 'Z'
import texprops

# A running server holds its blueprints in memory from boot, so installing
# under one writes the database and changes nothing the player sees. That cost
# an afternoon: three rounds of "the fix did not take" on renders shot against
# the blueprint the server had loaded before the fix existed. Say so loudly.
def _warn_if_serving(port=3000):
    import socket
    s = socket.socket()
    s.settimeout(0.25)
    try:
        s.connect(('127.0.0.1', port))
    except Exception:
        return
    finally:
        s.close()
    print('  !! a server is running on :%d — it is still serving the blueprints'
          '\n     it loaded at boot. Restart it or this install changes nothing.' % port)


_warn_if_serving()


con = sqlite3.connect(DB)

check_js(os.path.join(ROOT, 'sky.js'))
script = put(os.path.join(ROOT, 'sky.js'), 'js')
# empty.glb, never None: the loader calls .endsWith() on the model url, so a
# script-only room installed with model=None takes the whole world down on boot.
model = put(os.path.join(ROOT, 'empty.glb'), 'glb')

BP = 'cashcats-sky'
bp = {'id': BP, 'version': 1, 'name': 'World of CashCats — the Sky',
      'image': None, 'author': None, 'url': None, 'desc': None,
      'model': model, 'script': script,
      # every sky the world can be under, so a weather change is not a download
      'props': dict(texprops.props()),
      'preload': True, 'public': False, 'locked': False, 'frozen': False,
      'unique': False, 'scene': False, 'disabled': False}
con.execute('insert or replace into blueprints (id,data,createdAt,updatedAt) values (?,?,?,?)',
            (BP, json.dumps(bp), now, now))

EID = 'cashcatsSky'
ent = {'id': EID, 'type': 'app', 'blueprint': BP, 'position': [0, 0, 0],
       'quaternion': [0, 0, 0, 1], 'scale': [1, 1, 1], 'mover': None,
       'uploader': None, 'pinned': True, 'state': {}}
con.execute('insert or replace into entities (id,data,createdAt,updatedAt) values (?,?,?,?)',
            (EID, json.dumps(ent), now, now))
con.commit()
print("sky installed |", len(bp['props']), 'props |',
      con.execute('select count(*) from entities').fetchone()[0], 'entities')
con.close()
