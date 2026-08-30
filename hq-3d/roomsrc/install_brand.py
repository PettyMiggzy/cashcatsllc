"""
Brand the world shell: title, description, share image, and the default
avatar. These live in the `settings` row of the world config table, which is
what the server reads when it renders index.html and what every client gets
in its snapshot.
"""
import hashlib, json, os, sqlite3

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

con = sqlite3.connect(DB)

row = con.execute("select value from config where key='settings'").fetchone()
settings = json.loads(row[0]) if row else {}

logo   = put(os.path.join(HQ, '..', 'assets', 'cashcat.png'), 'png')
avatar = put(os.path.join(HQ, 'src', 'world', 'assets', 'avatar.vrm'), 'vrm')

settings.update({
    'title': 'CashCats LLC — HQ',
    'desc': ('A holder-gated 3D world for $CASHCATSLLC. '
             'Filing Office, Workshop, Homestead and the Vault.'),
    'image':  {'type': 'image',  'name': 'cashcat.png', 'url': logo},
    'avatar': {'type': 'avatar', 'name': 'avatar.vrm',  'url': avatar},
})
settings.setdefault('customAvatars', True)
settings.setdefault('playerLimit', 0)

con.execute('insert or replace into config (key,value) values (?,?)',
            ('settings', json.dumps(settings)))
con.commit()
print('branded:', settings['title'])
print('  image  ->', logo)
print('  avatar ->', avatar)
con.close()
