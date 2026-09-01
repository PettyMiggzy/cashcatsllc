"""
Fetch high-detail CC0 models from Poly Haven and pack them into single GLBs.

Why this exists: prims in this engine take one albedo texture and nothing else
— no normal map, no roughness map, no AO — so anything built out of them is
flat by construction, and flat is what reads as cartoon. GLB models go through
the full PBR path (glbToNodes wires normalMap through), so detail has to arrive
as a model or it does not arrive at all.

Poly Haven has 521 CC0 models with proper PBR: a diffuse, a real normal map,
and an ARM (AO / roughness / metalness packed per channel). No attribution
required, commercial use fine.

The catch is that they ship as loose files — a .gltf pointing at a .bin and
three .jpgs — and this world content-addresses every asset to asset://<sha>.glb,
which destroys relative paths. Exactly the fault that made every Kenney model
render untextured. So each model is downloaded and repacked into one GLB with
the buffer and all its images inside it.

    python3 roomsrc/fetch_hq.py                 # the default set
    python3 roomsrc/fetch_hq.py --res 2k        # sharper, ~4x the bytes
    python3 roomsrc/fetch_hq.py --list props    # what is available
"""
import json, os, struct, sys, urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, 'hq')
API = 'https://api.polyhaven.com'
UA = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
                    '(KHTML, like Gecko) Chrome/126.0 Safari/537.36'}
JSON_CHUNK, BIN_CHUNK = 0x4E4F534A, 0x004E4942

# The set the world actually needs, by what it is for.
WANT = [
    # THE SEAM — real cliff faces, which is the thing the quarry never had
    'coastal_cliff_01', 'coastal_cliff_02', 'coastal_cliff_04',
    'boulder_01', 'namaqualand_boulder_02', 'namaqualand_boulder_03',
    'rock_moss_set_01', 'barrel_stove', 'crowbar_01', 'hatchet',
    # THE DOCKS
    'Barrel_01', 'Barrel_02', 'barrel_03', 'wooden_crate_02',
    'coast_rocks_01', 'coast_land_rocks_02',
    # THE CAT PARK — an actual cardboard box for the box yard
    'cardboard_box_01',
    # INTERIORS, which are the weakest thing left in the world
    'WoodenTable_02', 'WoodenChair_01', 'Shelf_01', 'ArmChair_01',
    'GothicCabinet_01', 'ClassicConsole_01', 'SchoolDesk_01',
    # PLANTING
    'fir_tree_01', 'fir_sapling_medium', 'dead_tree_trunk', 'fern_02',
    'potted_plant_02', 'dandelion_01',
]



def get(url, timeout=120):
    req = urllib.request.Request(url, headers=UA)
    return urllib.request.urlopen(req, timeout=timeout).read()


def catalogue():
    return json.loads(get(API + '/assets?t=models', timeout=90))


def pack(name, res):
    """Download one model's gltf + bin + textures and write a single .glb."""
    files = json.loads(get('%s/files/%s' % (API, name)))
    tier = (files.get('gltf') or {}).get(res)
    if not tier:
        return None, 'no %s gltf' % res
    entry = list(tier.values())[0]
    js = json.loads(get(entry['url']))
    blobs = {}
    for rel, meta in (entry.get('include') or {}).items():
        blobs[rel] = get(meta['url'])

    # one binary chunk: the existing buffer first, then every image appended
    buf_uri = (js.get('buffers') or [{}])[0].get('uri')
    if not buf_uri or buf_uri not in blobs:
        return None, 'buffer missing'
    bin_ = bytearray(blobs[buf_uri])
    js['buffers'] = [{'byteLength': 0}]           # length fixed at the end

    for img in js.get('images') or []:
        uri = img.get('uri')
        if not uri or uri not in blobs:
            continue
        data = blobs[uri]
        bin_ += b'\0' * ((4 - len(bin_) % 4) % 4)
        js.setdefault('bufferViews', []).append(
            {'buffer': 0, 'byteOffset': len(bin_), 'byteLength': len(data)})
        img.pop('uri')
        img['bufferView'] = len(js['bufferViews']) - 1
        img['mimeType'] = 'image/png' if uri.lower().endswith('.png') else 'image/jpeg'
        bin_ += data
    js['buffers'] = [{'byteLength': len(bin_)}]

    jb = json.dumps(js, separators=(',', ':')).encode()
    jb += b' ' * ((4 - len(jb) % 4) % 4)
    bb = bytes(bin_) + b'\0' * ((4 - len(bin_) % 4) % 4)
    out = b'glTF' + struct.pack('<II', 2, 12 + 8 + len(jb) + 8 + len(bb))
    out += struct.pack('<II', len(jb), JSON_CHUNK) + jb
    out += struct.pack('<II', len(bb), BIN_CHUNK) + bb

    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name + '.glb')
    open(path, 'wb').write(out)
    maps = len(js.get('images') or [])
    return path, '%.2f MB, %d map%s' % (len(out) / 1048576, maps, '' if maps == 1 else 's')


def main():
    res = '1k'
    if '--res' in sys.argv:
        res = sys.argv[sys.argv.index('--res') + 1]
    if '--list' in sys.argv:
        want = sys.argv[sys.argv.index('--list') + 1]
        cat = catalogue()
        hits = [k for k, v in cat.items() if want in ' '.join(v.get('categories', []))]
        print('%d models in %s:' % (len(hits), want))
        for h in sorted(hits):
            print('   ', h)
        return

    names = [a for a in sys.argv[1:] if not a.startswith('--') and a != res] or WANT
    cat = catalogue()
    made = skipped = 0
    for n in names:
        if os.path.exists(os.path.join(OUT, n + '.glb')):
            skipped += 1
            continue
        if n not in cat:
            print('  %-22s not in the catalogue' % n)
            continue
        try:
            path, note = pack(n, res)
            if path:
                print('  %-22s %s' % (n, note)); made += 1
            else:
                print('  %-22s %s' % (n, note))
        except Exception as e:
            print('  %-22s failed: %s' % (n, str(e)[:70]))
    print('%d fetched, %d already had, in %s' % (made, skipped, OUT))


if __name__ == '__main__':
    main()
