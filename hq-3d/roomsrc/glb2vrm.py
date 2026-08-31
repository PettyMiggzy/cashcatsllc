#!/usr/bin/env python3
"""
Turn a rigged .glb into a .vrm that Hyperfy can wear.

This is the last mile of the character pipeline. Every AI character service
worth using — Tripo, Meshy, and Mixamo before them — will hand you a rigged
GLB or FBX with a conventional bone hierarchy. What none of them emit is the
VRM humanoid extension, which is the only thing Hyperfy reads in order to
retarget its fourteen stock clips onto your model.

So: bring any rigged humanoid GLB, get a wearable avatar.

    python3 roomsrc/glb2vrm.py in.glb out.vrm --name "Pop Cat"
    python3 roomsrc/glb2vrm.py in.glb out.vrm --faces=-z     # already VRM-facing

(argparse needs the = on --faces=-z, or it reads -z as a flag.)

Bone names are matched against the conventions those tools actually use —
Mixamo (Hips / LeftUpLeg / LeftArm), VRoid (J_Bip_L_UpperArm), Unreal
(upperarm_l) and plain snake/camel case — so in practice nothing needs
renaming by hand. Anything it cannot place is reported rather than guessed at.
"""
import argparse
import json
import re
import struct
import sys

# VRM bone -> the normalised names various exporters use for it.
# Normalising strips case, separators and the mixamorig prefix, so
# "mixamorig:LeftUpLeg", "Left_Up_Leg" and "leftupleg" all collapse together.
ALIASES = {
    'hips':          ['hips', 'pelvis', 'bip01pelvis', 'jbipchips'],
    'spine':         ['spine', 'spine01', 'jbipcspine'],
    'chest':         ['spine1', 'chest', 'spine02', 'jbipcchest'],
    'upperChest':    ['spine2', 'upperchest', 'spine03', 'jbipcupperchest'],
    'neck':          ['neck', 'jbipcneck'],
    'head':          ['head', 'jbipchead'],
    'leftShoulder':  ['leftshoulder', 'shoulderl', 'claviclel', 'jbiplshoulder'],
    'leftUpperArm':  ['leftarm', 'leftupperarm', 'upperarml', 'arml', 'jbipllowerarm'
                      .replace('lower', 'upper')],
    'leftLowerArm':  ['leftforearm', 'leftlowerarm', 'lowerarml', 'forearml',
                      'jbipllowerarm'],
    'leftHand':      ['lefthand', 'handl', 'jbiplhand'],
    'leftUpperLeg':  ['leftupleg', 'leftupperleg', 'thighl', 'uplegl', 'jbipllowerleg'
                      .replace('lower', 'upper')],
    'leftLowerLeg':  ['leftleg', 'leftlowerleg', 'calfl', 'shinl', 'jbipllowerleg'],
    'leftFoot':      ['leftfoot', 'footl', 'jbiplfoot'],
    'leftToes':      ['lefttoebase', 'lefttoes', 'toel', 'balll', 'jbipltoes'],
}
for _b in [b for b in list(ALIASES) if b.startswith('left')]:
    ALIASES['right' + _b[4:]] = [a.replace('left', 'right', 1) if a.startswith('left')
                                 else (a[:-1] + 'r' if a.endswith('l') else a.replace('l', 'r', 1))
                                 for a in ALIASES[_b]]

REQUIRED = ['hips', 'spine', 'head',
            'leftUpperArm', 'leftLowerArm', 'leftHand',
            'rightUpperArm', 'rightLowerArm', 'rightHand',
            'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
            'rightUpperLeg', 'rightLowerLeg', 'rightFoot']


def norm(name):
    n = (name or '').lower()
    n = n.replace('mixamorig', '')
    return re.sub(r'[^a-z0-9]', '', n)


def read_glb(path):
    d = open(path, 'rb').read()
    magic, _, length = struct.unpack('<III', d[:12])
    if magic != 0x46546C67:
        sys.exit('%s is not a glb' % path)
    off, chunks = 12, []
    while off < length:
        clen, ctype = struct.unpack('<II', d[off:off + 8])
        chunks.append((ctype, off + 8, clen))
        off += 8 + clen
    gltf = json.loads(d[chunks[0][1]:chunks[0][1] + chunks[0][2]].decode('utf-8'))
    binary = bytearray(d[chunks[1][1]:chunks[1][1] + chunks[1][2]]) if len(chunks) > 1 else bytearray()
    return gltf, binary


def write_glb(gltf, binary, path):
    js = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    js += b' ' * ((4 - len(js) % 4) % 4)
    while len(binary) % 4:
        binary.append(0)
    out = bytearray()
    out += struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binary))
    out += struct.pack('<II', len(js), 0x4E4F534A) + js
    out += struct.pack('<II', len(binary), 0x004E4942) + bytes(binary)
    open(path, 'wb').write(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('dst')
    ap.add_argument('--name', default='CashCat')
    ap.add_argument('--author', default='CashCats LLC')
    ap.add_argument('--license', default='CC0')
    ap.add_argument('--height', type=float, default=1.7, metavar='M',
                    help='scale the avatar to this height in metres (0 to leave '
                         'as-is). Generators have no sense of scale — a cat came '
                         'back 0.74m and read as a lump on the floor.')
    ap.add_argument('--faces', choices=['+z', '-z'], default='+z', metavar='DIR',
                    help='which way the source model faces. VRM 0.0 wants -z, and '
                         'most rigged exports are +z, so the default adds a 180 '
                         'degree root rotation. Get this wrong and left/right '
                         'mirror, which silently lifts both arms into the air.')
    a = ap.parse_args()

    gltf, binary = read_glb(a.src)
    nodes = gltf.get('nodes', [])
    if not gltf.get('skins'):
        sys.exit('no skin in %s — this needs a RIGGED model, not just a mesh' % a.src)

    # only consider nodes that are actually skeleton joints
    joints = set()
    for skin in gltf['skins']:
        joints.update(skin.get('joints', []))

    lookup = {}
    for bone, names in ALIASES.items():
        for n in names:
            lookup.setdefault(n, bone)

    found, clashes = {}, []
    for i in sorted(joints):
        bone = lookup.get(norm(nodes[i].get('name')))
        if not bone:
            continue
        if bone in found:
            clashes.append((bone, nodes[found[bone]].get('name'), nodes[i].get('name')))
            continue
        found[bone] = i

    missing = [b for b in REQUIRED if b not in found]
    for bone, kept, dropped in clashes:
        print('  note: %s matched twice (%s, %s) — kept the first' % (bone, kept, dropped))
    if missing:
        print('unmapped required bones: %s' % ', '.join(missing))
        print('joint names present:')
        for i in sorted(joints)[:40]:
            print('   ', nodes[i].get('name'))
        sys.exit('cannot build a humanoid without those — rename them or extend ALIASES')

    # Measure the model from the POSITION accessors, which carry min/max.
    lo = [1e9] * 3
    hi = [-1e9] * 3
    for mesh in gltf.get('meshes', []):
        for prim in mesh.get('primitives', []):
            ac = gltf['accessors'][prim['attributes']['POSITION']]
            if 'min' not in ac:
                continue
            for i in range(3):
                lo[i] = min(lo[i], ac['min'][i])
                hi[i] = max(hi[i], ac['max'][i])
    span = hi[1] - lo[1] if hi[1] > lo[1] else 0.0

    scale = 1.0
    if a.height and span > 0:
        scale = a.height / span
        print('model is %.2fm tall -> scaling x%.3f to %.2fm' % (span, scale, a.height))

    # VRM 0.0 models face -z. Rather than rewrite every vertex, parent the
    # existing scene under one root that carries both the turn and the scale.
    need_root = a.faces == '+z' or abs(scale - 1.0) > 1e-6
    if need_root:
        root = {'name': 'VRMRoot',
                'children': list(gltf['scenes'][gltf.get('scene', 0)]['nodes'])}
        if a.faces == '+z':
            root['rotation'] = [0.0, 1.0, 0.0, 0.0]
        if abs(scale - 1.0) > 1e-6:
            root['scale'] = [scale, scale, scale]
        nodes.append(root)
        gltf['scenes'][gltf.get('scene', 0)]['nodes'] = [len(nodes) - 1]

    gltf.setdefault('extensionsUsed', [])
    if 'VRM' not in gltf['extensionsUsed']:
        gltf['extensionsUsed'].append('VRM')
    gltf.setdefault('extensions', {})['VRM'] = {
        'exporterVersion': 'cashcats glb2vrm',
        'specVersion': '0.0',
        'meta': {'title': a.name, 'version': '1', 'author': a.author,
                 'contactInformation': '', 'reference': '',
                 'allowedUserName': 'Everyone', 'violentUssageName': 'Disallow',
                 'sexualUssageName': 'Disallow', 'commercialUssageName': 'Allow',
                 'otherPermissionUrl': '', 'licenseName': a.license,
                 'otherLicenseUrl': ''},
        'humanoid': {'humanBones': [{'bone': b, 'node': found[b], 'useDefaultValues': True}
                                    for b in sorted(found)]},
        'firstPerson': {'firstPersonBone': found['head'],
                        'firstPersonBoneOffset': {'x': 0, 'y': 0.06, 'z': 0},
                        'meshAnnotations': []},
        'blendShapeMaster': {'blendShapeGroups': []},
        'secondaryAnimation': {'boneGroups': [], 'colliderGroups': []},
        'materialProperties': [
            {'name': m.get('name', 'mat%d' % i), 'shader': 'VRM_USE_GLTFSHADER',
             'renderQueue': 2000, 'floatProperties': {}, 'vectorProperties': {},
             'textureProperties': {}, 'keywordMap': {}, 'tagMap': {}}
            for i, m in enumerate(gltf.get('materials', []))],
    }

    write_glb(gltf, binary, a.dst)
    print('mapped %d humanoid bones (%d required, all present)' % (len(found), len(REQUIRED)))
    print('wrote %s' % a.dst)


if __name__ == '__main__':
    main()
