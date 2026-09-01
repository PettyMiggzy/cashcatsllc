import hashlib, json, os, sqlite3, datetime
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import texprops
ROOT=os.path.dirname(os.path.abspath(__file__)); HQ=os.path.dirname(ROOT)
DB=os.path.join(HQ,'world','db.sqlite'); ASSETS=os.path.join(HQ,'world','assets')

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
    d=open(path,'rb').read(); h=hashlib.sha256(d).hexdigest()
    dst=os.path.join(ASSETS,f'{h}.{ext}')
    if not os.path.exists(dst): open(dst,'wb').write(d)
    return f'asset://{h}.{ext}'

now=datetime.datetime.utcnow().isoformat()+'Z'
con=sqlite3.connect(DB)
check_js(os.path.join(ROOT, 'workshop.js'))
script=put(os.path.join(ROOT,'workshop.js'),'js')
model =put(os.path.join(ROOT,'cats.glb'),'glb')
gold  =put(os.path.join(ROOT,'gold_cat.png'),'png')

BP='cashcats-workshop'
bp={'id':BP,'version':1,'name':'The Workshop','image':None,'author':None,'url':None,'desc':None,
    'model':model,'script':script,
    'props':dict(texprops.props(), **texprops.cast(), **texprops.gear(), **{'gold':{'type':'image','name':'gold_cat.png','url':gold}}),
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
