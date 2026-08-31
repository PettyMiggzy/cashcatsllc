import hashlib, json, os, sqlite3, datetime
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import texprops
ROOT=os.path.dirname(os.path.abspath(__file__)); HQ=os.path.dirname(ROOT)
DB=os.path.join(HQ,'world','db.sqlite'); ASSETS=os.path.join(HQ,'world','assets')

def put(path, ext):
    d=open(path,'rb').read(); h=hashlib.sha256(d).hexdigest()
    dst=os.path.join(ASSETS,f'{h}.{ext}')
    if not os.path.exists(dst): open(dst,'wb').write(d)
    return f'asset://{h}.{ext}'

now=datetime.datetime.utcnow().isoformat()+'Z'
con=sqlite3.connect(DB)
script=put(os.path.join(ROOT,'workshop.js'),'js')
model =put(os.path.join(ROOT,'cats.glb'),'glb')
gold  =put(os.path.join(ROOT,'gold_cat.png'),'png')

BP='cashcats-workshop'
bp={'id':BP,'version':1,'name':'The Workshop','image':None,'author':None,'url':None,'desc':None,
    'model':model,'script':script,
    'props':dict(texprops.props(), **texprops.cast(), **{'gold':{'type':'image','name':'gold_cat.png','url':gold}}),
    'preload':True,'public':False,'locked':False,'frozen':False,'unique':False,
    'scene':False,'disabled':False}
con.execute('insert or replace into blueprints (id,data,createdAt,updatedAt) values (?,?,?,?)',
            (BP,json.dumps(bp),now,now))
EID='cashcatsWorkshop'
ent={'id':EID,'type':'app','blueprint':BP,'position':[21,0,0],'quaternion':[0,0,0,1],
     'scale':[1,1,1],'mover':None,'uploader':None,'pinned':True,'state':{}}
con.execute('insert or replace into entities (id,data,createdAt,updatedAt) values (?,?,?,?)',
            (EID,json.dumps(ent),now,now))
con.commit()
print('workshop installed at x=21 |', con.execute('select count(*) from entities').fetchone()[0],'entities')
con.close()
