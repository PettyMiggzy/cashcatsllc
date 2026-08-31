import hashlib, json, os, shutil, sqlite3, datetime, sys
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ROOT = os.path.dirname(os.path.abspath(__file__))
HQ   = os.path.dirname(ROOT)
DB   = os.path.join(HQ, 'world', 'db.sqlite')
ASSETS = os.path.join(HQ, 'world', 'assets')

def check_js(path):
    """
    Refuse to install a script that does not parse.

    A room whose script throws on load is simply not there, and nothing says
    so — the world comes up with a hole where a building should be.
    """
    import subprocess
    r = subprocess.run(['node', '--check', path], capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit('%s does not parse:\n%s' % (os.path.basename(path), r.stderr.strip()[:400]))


def put_asset(path, ext):
    data = open(path,'rb').read()
    h = hashlib.sha256(data).hexdigest()
    dest = os.path.join(ASSETS, f'{h}.{ext}')
    if not os.path.exists(dest):
        open(dest,'wb').write(data)
    return f'asset://{h}.{ext}', h

now = datetime.datetime.utcnow().isoformat()+'Z'
import texprops
con = sqlite3.connect(DB)

# 1. the room script
check_js(os.path.join(ROOT, 'filing_office.js'))
script_url,_ = put_asset(os.path.join(ROOT,'filing_office.js'), 'js')
model_url,_  = put_asset(os.path.join(ROOT,'empty.glb'), 'glb')

# 2. the real CashCats logo from cashcatllc.help
logo_src = os.path.join(HQ,'..','assets','cashcat.png')
logo_url, logo_hash = put_asset(logo_src, 'png')
npc_stamp_url,_   = put_asset(os.path.join(ROOT,'npc_stamp.png'), 'png')
npc_folders_url,_ = put_asset(os.path.join(ROOT,'npc_folders.png'), 'png')
npc_cabinet_url,_ = put_asset(os.path.join(ROOT,'npc_cabinet.png'), 'png')

BP = 'cashcats-filing-office'
blueprint = {
    'id': BP,
    'version': 1,
    'name': 'The Filing Office',
    'image': None, 'author': None, 'url': None, 'desc': None,
    'model': model_url,
    'script': script_url,
    'props': dict(texprops.props(), **{
        'logo':       { 'type':'image', 'name':'cashcat.png',   'url': logo_url },
        'npcStamp':   { 'type':'image', 'name':'npc_stamp.png',   'url': npc_stamp_url },
        'npcFolders': { 'type':'image', 'name':'npc_folders.png', 'url': npc_folders_url },
        'npcCabinet': { 'type':'image', 'name':'npc_cabinet.png', 'url': npc_cabinet_url },
    }),
    'preload': True,
    'public': False,
    'locked': False,
    'frozen': False,
    'unique': False,
    'scene': False,
    'disabled': False,
}
con.execute('insert or replace into blueprints (id,data,createdAt,updatedAt) values (?,?,?,?)',
            (BP, json.dumps(blueprint), now, now))

EID = 'cashcatsFilingOffice'
entity = {
    'id': EID, 'type':'app', 'blueprint': BP,
    'position':[0,0,0], 'quaternion':[0,0,0,1], 'scale':[1,1,1],
    'mover':None,'uploader':None,'pinned':True,'state':{},
}
con.execute('insert or replace into entities (id,data,createdAt,updatedAt) values (?,?,?,?)',
            (EID, json.dumps(entity), now, now))
con.commit()

print('script :', script_url)
print('logo   :', logo_url)
print('rows   :', con.execute('select count(*) from blueprints').fetchone()[0], 'blueprints,',
                  con.execute('select count(*) from entities').fetchone()[0], 'entities')
con.close()
