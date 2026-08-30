#!/usr/bin/env python3
"""
Generate a rigged Cash Cat avatar as a VRM.

VRoid Studio is the usual way to get a rigged VRM, but it is a Windows/macOS
GUI application with no Linux build and no headless mode, so it cannot run
here. This builds the same end product directly instead: a skinned mesh on a
standard VRM humanoid skeleton, which is what lets Hyperfy drive it with the
fourteen stock locomotion and emote clips it already ships.

    python3 roomsrc/mkavatar.py roomsrc/cashcat_avatar.vrm

Deliberately VRM **0.0**, not 1.0: the avatar already working in this build is
0.0 with humanBones as a list, and matching a known-good file beats guessing at
a newer spec. The body is bipedal for the same reason — the stock clips are
humanoid, and a quadruped would have nothing to retarget onto.
"""
import json
import struct
import sys

import numpy as np

from mkcats import blob, taper, surface

# name, parent, world rest position. Authored facing +Z with the character's
# left at +X because that is easier to reason about; FLIP_Y180 below turns the
# whole thing round at the end.
SKELETON = [
    ('hips',          None,         (0.000, 0.860, 0.000)),
    ('spine',         'hips',       (0.000, 0.970, 0.000)),
    ('chest',         'spine',      (0.000, 1.080, 0.000)),
    ('upperChest',    'chest',      (0.000, 1.180, 0.000)),
    ('neck',          'upperChest', (0.000, 1.280, 0.000)),
    ('head',          'neck',       (0.000, 1.360, 0.000)),
    ('leftShoulder',  'upperChest', (0.040, 1.240, 0.000)),
    ('leftUpperArm',  'leftShoulder', (0.150, 1.240, 0.000)),
    ('leftLowerArm',  'leftUpperArm', (0.390, 1.240, 0.000)),
    ('leftHand',      'leftLowerArm', (0.610, 1.240, 0.000)),
    ('rightShoulder', 'upperChest', (-0.040, 1.240, 0.000)),
    ('rightUpperArm', 'rightShoulder', (-0.150, 1.240, 0.000)),
    ('rightLowerArm', 'rightUpperArm', (-0.390, 1.240, 0.000)),
    ('rightHand',     'rightLowerArm', (-0.610, 1.240, 0.000)),
    ('leftUpperLeg',  'hips',       (0.135, 0.840, 0.000)),
    ('leftLowerLeg',  'leftUpperLeg', (0.135, 0.460, 0.000)),
    ('leftFoot',      'leftLowerLeg', (0.135, 0.070, 0.000)),
    ('leftToes',      'leftFoot',   (0.135, 0.030, 0.100)),
    ('rightUpperLeg', 'hips',       (-0.135, 0.840, 0.000)),
    ('rightLowerLeg', 'rightUpperLeg', (-0.135, 0.460, 0.000)),
    ('rightFoot',     'rightLowerLeg', (-0.135, 0.070, 0.000)),
    ('rightToes',     'rightFoot',  (-0.135, 0.030, 0.100)),
    # not humanoid bones — they exist so the tail is skinned to something that
    # follows the hips rather than floating
    ('tail1',         'hips',       (0.000, 0.900, -0.110)),
    ('tail2',         'tail1',      (0.000, 1.000, -0.290)),
    ('tail3',         'tail2',      (0.000, 1.140, -0.430)),
    ('tail4',         'tail3',      (0.000, 1.270, -0.500)),
]
HUMANOID = [b for b, _, _ in SKELETON if not b.startswith('tail')]


def flip(p):
    """Rotate a point 180 degrees about Y — see the note in main()."""
    return (-p[0], p[1], -p[2])


def body_blobs():
    B = [blob((0, 0.870, 0.000), (0.195, 0.135, 0.150)),      # pelvis
         blob((0, 1.000, 0.000), (0.185, 0.130, 0.140)),      # belly
         blob((0, 1.140, 0.005), (0.200, 0.140, 0.150)),      # chest
         blob((0, 1.245, 0.000), (0.205, 0.095, 0.135)),      # shoulders
         blob((0, 1.305, 0.010), (0.072, 0.065, 0.072)),      # neck
         blob((0, 1.430, 0.020), (0.152, 0.140, 0.150)),      # head
         blob((0, 1.386, 0.135), (0.082, 0.064, 0.078)),      # muzzle
         blob((0, 1.408, 0.190), (0.024, 0.021, 0.021))]      # nose
    for sx in (-1, 1):
        B.append(blob((sx * 0.108, 1.396, 0.060), (0.062, 0.068, 0.062)))   # cheek
        B += taper((sx * 0.090, 1.520, 0.005), (sx * 0.128, 1.672, -0.010),
                   0.066, 0.022, 6)                                          # ear
        B += taper((sx * 0.170, 1.240, 0.000), (sx * 0.600, 1.240, 0.000),
                   0.066, 0.044, 6)                                          # arm
        B.append(blob((sx * 0.648, 1.234, 0.012), (0.058, 0.046, 0.066)))     # hand
        B += taper((sx * 0.135, 0.820, 0.000), (sx * 0.135, 0.100, 0.000),
                   0.098, 0.062, 6)                                          # leg
        B.append(blob((sx * 0.135, 0.048, 0.050), (0.068, 0.045, 0.115)))     # foot
    B += taper((0, 0.890, -0.140), (0, 1.300, -0.560), 0.062, 0.026, 10)      # tail
    return B


def skin_weights(verts, bones, parent_of, pos_of, n_infl=4):
    """Nearest-segment weighting. Crude next to hand-painted, fine for a body
    this simple, and it keeps the joints from tearing."""
    segs = []
    for name in bones:
        p = np.array(pos_of[name], dtype=np.float32)
        kids = [k for k in bones if parent_of.get(k) == name]
        q = np.array(pos_of[kids[0]], dtype=np.float32) if kids else p + np.float32(0.05)
        segs.append((p, q))

    D = np.empty((len(verts), len(segs)), dtype=np.float32)
    for i, (p, q) in enumerate(segs):
        d = q - p
        L2 = float(d @ d) or 1e-8
        t = np.clip(((verts - p) @ d) / L2, 0.0, 1.0)[:, None]
        D[:, i] = np.linalg.norm(verts - (p + t * d), axis=1)

    w = 1.0 / (D ** 3 + 1e-4)
    idx = np.argsort(-w, axis=1)[:, :n_infl]
    top = np.take_along_axis(w, idx, axis=1)
    top /= top.sum(axis=1, keepdims=True)
    return idx.astype(np.uint16), top.astype(np.float32)


def main(out_path):
    names = [b for b, _, _ in SKELETON]
    parent_of = {b: p for b, p, _ in SKELETON}
    pos_of = {b: flip(c) for b, _, c in SKELETON}

    verts, faces, norms = surface(body_blobs(), step=0.012, pad=0.10)
    # VRM 0.0 avatars face -Z, which puts the character's LEFT at -X. Authoring
    # it facing +Z and rotating 180 about Y at the end is the same thing and
    # keeps the numbers above readable.
    #
    # This is not cosmetic. Hyperfy poses the arms down at load with
    #     leftUpperArm.rotation.z = +75deg
    # so if left and right are mirrored, that rotation lifts both arms into the
    # air instead of lowering them, and no clip ever corrects it.
    verts = verts * np.array([-1, 1, -1], dtype=np.float32)
    norms = norms * np.array([-1, 1, -1], dtype=np.float32)
    faces = faces.reshape(-1, 3)[:, ::-1].reshape(-1)   # mirroring flips winding
    joints, weights = skin_weights(verts, names, parent_of, pos_of)
    print('avatar: %d verts, %d tris, %d bones' % (len(verts), faces.size // 3, len(names)))

    buf = bytearray()
    views, accessors = [], []

    def push(data, target=None):
        while len(buf) % 4:
            buf.append(0)
        off = len(buf)
        buf.extend(data)
        v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
        if target:
            v['target'] = target
        views.append(v)
        return len(views) - 1

    def acc(view, ctype, count, typ, extra=None):
        a = {'bufferView': view, 'componentType': ctype, 'count': count, 'type': typ}
        if extra:
            a.update(extra)
        accessors.append(a)
        return len(accessors) - 1

    a_pos = acc(push(verts.tobytes(), 34962), 5126, len(verts), 'VEC3',
                {'min': verts.min(axis=0).tolist(), 'max': verts.max(axis=0).tolist()})
    a_nrm = acc(push(norms.tobytes(), 34962), 5126, len(norms), 'VEC3')
    a_jnt = acc(push(joints.tobytes(), 34962), 5123, len(joints), 'VEC4')
    a_wgt = acc(push(weights.tobytes(), 34962), 5126, len(weights), 'VEC4')
    a_idx = acc(push(faces.tobytes(), 34963), 5125, int(faces.size), 'SCALAR')

    # rest pose has no rotation, so the inverse bind is just -worldPos
    ibm = np.zeros((len(names), 16), dtype=np.float32)
    for i, n in enumerate(names):
        m = np.eye(4, dtype=np.float32)
        m[3, :3] = -np.array(pos_of[n], dtype=np.float32)   # column-major
        ibm[i] = m.reshape(-1)
    a_ibm = acc(push(ibm.tobytes()), 5126, len(names), 'MAT4')

    # nodes: 0 is the mesh, then one per bone
    nodes = [{'name': 'CashCatBody', 'mesh': 0, 'skin': 0}]
    node_of = {}
    for i, n in enumerate(names):
        node_of[n] = i + 1
        p = parent_of[n]
        base = np.array(pos_of[n]) - (np.array(pos_of[p]) if p else np.zeros(3))
        nodes.append({'name': n, 'translation': [float(v) for v in base]})
    for n in names:
        kids = [node_of[k] for k in names if parent_of.get(k) == n]
        if kids:
            nodes[node_of[n]]['children'] = kids

    gltf = {
        'asset': {'version': '2.0', 'generator': 'cashcats mkavatar.py'},
        'extensionsUsed': ['VRM'],
        'scene': 0,
        'scenes': [{'nodes': [0, node_of['hips']]}],
        'nodes': nodes,
        'meshes': [{'name': 'CashCat', 'primitives': [{
            'attributes': {'POSITION': a_pos, 'NORMAL': a_nrm,
                           'JOINTS_0': a_jnt, 'WEIGHTS_0': a_wgt},
            'indices': a_idx, 'material': 0}]}],
        'skins': [{'inverseBindMatrices': a_ibm,
                   'skeleton': node_of['hips'],
                   'joints': [node_of[n] for n in names]}],
        'materials': [{'name': 'fur', 'doubleSided': False,
                       'pbrMetallicRoughness': {
                           'baseColorFactor': [0.90, 0.86, 0.78, 1.0],
                           'metallicFactor': 0.0, 'roughnessFactor': 0.85}}],
        'accessors': accessors,
        'bufferViews': views,
        'buffers': [{'byteLength': len(buf)}],
        'extensions': {'VRM': {
            'exporterVersion': 'cashcats-1',
            'specVersion': '0.0',
            'meta': {'title': 'Cash Cat', 'version': '1',
                     'author': 'CashCats LLC', 'contactInformation': '',
                     'reference': '', 'allowedUserName': 'Everyone',
                     'violentUssageName': 'Disallow', 'sexualUssageName': 'Disallow',
                     'commercialUssageName': 'Allow', 'otherPermissionUrl': '',
                     'licenseName': 'CC0', 'otherLicenseUrl': ''},
            'humanoid': {'humanBones': [
                {'bone': b, 'node': node_of[b], 'useDefaultValues': True}
                for b in HUMANOID]},
            'firstPerson': {'firstPersonBone': node_of['head'],
                            'firstPersonBoneOffset': {'x': 0, 'y': 0.06, 'z': 0},
                            'meshAnnotations': []},
            'blendShapeMaster': {'blendShapeGroups': []},
            'secondaryAnimation': {'boneGroups': [], 'colliderGroups': []},
            'materialProperties': [{
                'name': 'fur', 'shader': 'VRM_USE_GLTFSHADER', 'renderQueue': 2000,
                'floatProperties': {}, 'vectorProperties': {},
                'textureProperties': {}, 'keywordMap': {}, 'tagMap': {}}],
        }},
    }

    js = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    js += b' ' * ((4 - len(js) % 4) % 4)
    while len(buf) % 4:
        buf.append(0)
    glb = bytearray()
    glb += struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(buf))
    glb += struct.pack('<II', len(js), 0x4E4F534A) + js
    glb += struct.pack('<II', len(buf), 0x004E4942) + bytes(buf)
    open(out_path, 'wb').write(glb)
    print('wrote %s  %.2f MB' % (out_path, len(glb) / 1e6))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'cashcat_avatar.vrm')
