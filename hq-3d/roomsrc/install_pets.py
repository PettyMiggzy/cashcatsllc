"""Install the Chibi Rating — the boss field and the pet system."""
import hashlib, json, os, sqlite3, datetime, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
HQ = os.path.dirname(ROOT)
DB = os.path.join(HQ, 'world', 'db.sqlite')
ASSETS = os.path.join(HQ, 'world', 'assets')

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



def check_js(path):
    """
    Refuse to install a script that does not parse.

    A room whose script throws on load is simply not there, and nothing says
    so — the world comes up with a hole where a building should be. Both
    syntax errors in this build would have shipped silently.
    """
    import subprocess
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
con = sqlite3.connect(DB)
check_js(os.path.join(ROOT, 'pets.js'))
script = put(os.path.join(ROOT, 'pets.js'), 'js')
# A script-only room still needs a model: the loader calls endsWith on the
# url, so a null model takes the whole world down on boot.
model = put(os.path.join(ROOT, 'empty.glb'), 'glb')

BP = 'cashcats-pets'
# Every boss in the bestiary, not just the ones that can spawn: the Raid and
# Dungeon entries are statted and waiting on somewhere to stand, and shipping
# their models now means adding the area later is a spawn point rather than
# another asset pass.
BEASTS = ['p_lion', 'p_tiger', 'p_elephant', 'p_polar', 'p_panda',
          'p_fox', 'p_deer', 'p_hog']
bp = {'id': BP, 'version': 1, 'name': 'World of CashCats — the Chibi Rating',
      'image': None, 'author': None,
      'url': None, 'desc': None, 'model': model, 'script': script,
      'props': dict(texprops.props(['gravel', 'paving', 'wood']),
                    **texprops.models(BEASTS)),
      'preload': False, 'public': False, 'locked': False, 'frozen': False,
      'unique': False, 'scene': False, 'disabled': False}
con.execute('insert or replace into blueprints (id,data,createdAt,updatedAt) values (?,?,?,?)',
            (BP, json.dumps(bp), now, now))

# At the origin, like the campus: the app proxy exposes no position, so the
# script works in world coordinates and places itself.
EID = 'cashcatsPets'
ent = {'id': EID, 'type': 'app', 'blueprint': BP, 'position': [0, 0, 0],
       'quaternion': [0, 0, 0, 1], 'scale': [1, 1, 1], 'mover': None,
       'uploader': None, 'pinned': True, 'state': {}}
con.execute('insert or replace into entities (id,data,createdAt,updatedAt) values (?,?,?,?)',
            (EID, json.dumps(ent), now, now))

con.commit()
n = con.execute('select count(*) from entities').fetchone()[0]
print('chibi rating installed | %d props | boss field at [0,0,-48]' % len(bp['props']))
print('%d entities' % n)
