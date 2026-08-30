import hashlib, json, os, shutil, sqlite3, datetime, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
HQ   = os.path.dirname(ROOT)
DB   = os.path.join(HQ, 'world', 'db.sqlite')
ASSETS = os.path.join(HQ, 'world', 'assets')

def put_asset(path, ext):
    data = open(path,'rb').read()
    h = hashlib.sha256(data).hexdigest()
    dest = os.path.join(ASSETS, f'{h}.{ext}')
    if not os.path.exists(dest):
        open(dest,'wb').write(data)
    return f'asset://{h}.{ext}', h

now = datetime.datetime.utcnow().isoformat()+'Z'
con = sqlite3.connect(DB)

# 1. the room script
script_url,_ = put_asset(os.path.join(ROOT,'filing_office.js'), 'js')
model_url,_  = put_asset(os.path.join(ROOT,'empty.glb'), 'glb')

# 2. the real CashCats logo from cashcatllc.help
logo_src = os.path.join(HQ,'..','assets','cashcat.png')
logo_url, logo_hash = put_asset(logo_src, 'png')

BP = 'cashcats-filing-office'
blueprint = {
    'id': BP,
    'version': 1,
    'name': 'The Filing Office',
    'image': None, 'author': None, 'url': None, 'desc': None,
    'model': model_url,
    'script': script_url,
    'props': {
        'logo': { 'type':'image', 'name':'cashcat.png', 'url': logo_url }
    },
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
