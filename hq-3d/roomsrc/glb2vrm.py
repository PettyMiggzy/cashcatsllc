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
import math
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



def _trs(node):
    """Local matrix of a glTF node, as a 4x4 list-of-lists."""
    t = node.get('translation') or [0.0, 0.0, 0.0]
    q = node.get('rotation') or [0.0, 0.0, 0.0, 1.0]
    sc = node.get('scale') or [1.0, 1.0, 1.0]
    x, y, z, w = q
    r = [[1 - 2*(y*y + z*z), 2*(x*y - z*w),     2*(x*z + y*w)],
         [2*(x*y + z*w),     1 - 2*(x*x + z*z), 2*(y*z - x*w)],
         [2*(x*z - y*w),     2*(y*z + x*w),     1 - 2*(x*x + y*y)]]
    m = [[r[i][j] * sc[j] for j in range(3)] + [t[i]] for i in range(3)]
    return m + [[0.0, 0.0, 0.0, 1.0]]


def _mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def world_pos(nodes, parent, i):
    """Rest-pose world position of a node, walking up the hierarchy."""
    chain = []
    while i is not None:
        chain.append(i)
        i = parent.get(i)
    m = [[1.0 if a == b else 0.0 for b in range(4)] for a in range(4)]
    for j in reversed(chain):
        m = _mul(m, _trs(nodes[j]))
    return [m[0][3], m[1][3], m[2][3]]


def _n3(v):
    n = math.sqrt(sum(c * c for c in v))
    return [c / n for c in v] if n > 1e-12 else [0.0, 0.0, 0.0]


def _cross(a, b):
    return [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]]


def _qnorm(q):
    n = math.sqrt(sum(c * c for c in q))
    return [c / n for c in q] if n > 1e-12 else [0.0, 0.0, 0.0, 1.0]


def _qmul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return [aw*bx + ax*bw + ay*bz - az*by,
            aw*by - ax*bz + ay*bw + az*bx,
            aw*bz + ax*by - ay*bx + az*bw,
            aw*bw - ax*bx - ay*by - az*bz]


def _qconj(q):
    return [-q[0], -q[1], -q[2], q[3]]


def _qrot(q, v):
    """Rotate a vector by a quaternion."""
    x, y, z, w = q
    t = [2 * (y*v[2] - z*v[1]), 2 * (z*v[0] - x*v[2]), 2 * (x*v[1] - y*v[0])]
    return [v[0] + w*t[0] + y*t[2] - z*t[1],
            v[1] + w*t[1] + z*t[0] - x*t[2],
            v[2] + w*t[2] + x*t[1] - y*t[0]]


def mat3_from_quat(q):
    x, y, z, w = q
    return [[1 - 2*(y*y + z*z), 2*(x*y - z*w),     2*(x*z + y*w)],
            [2*(x*y + z*w),     1 - 2*(x*x + z*z), 2*(y*z - x*w)],
            [2*(x*z - y*w),     2*(y*z + x*w),     1 - 2*(x*x + y*y)]]


def _qbetween(a, b):
    """Shortest rotation taking direction a onto direction b."""
    a, b = _n3(a), _n3(b)
    d = sum(a[i] * b[i] for i in range(3))
    if d > 0.999999:
        return [0.0, 0.0, 0.0, 1.0]
    if d < -0.999999:
        axis = _n3(_cross([1.0, 0.0, 0.0] if abs(a[0]) < 0.9 else [0.0, 1.0, 0.0], a))
        return [axis[0], axis[1], axis[2], 0.0]
    c = _cross(a, b)
    return _qnorm([c[0], c[1], c[2], 1.0 + d])


def _qfrom_mat(m):
    """Rotation quaternion of a 4x4, with any scale divided out."""
    col = [_n3([m[0][j], m[1][j], m[2][j]]) for j in range(3)]
    r = [[col[j][i] for j in range(3)] for i in range(3)]
    t = r[0][0] + r[1][1] + r[2][2]
    if t > 0:
        s = math.sqrt(t + 1.0) * 2
        q = [(r[2][1] - r[1][2]) / s, (r[0][2] - r[2][0]) / s, (r[1][0] - r[0][1]) / s, 0.25 * s]
    elif r[0][0] > r[1][1] and r[0][0] > r[2][2]:
        s = math.sqrt(1.0 + r[0][0] - r[1][1] - r[2][2]) * 2
        q = [0.25 * s, (r[0][1] + r[1][0]) / s, (r[0][2] + r[2][0]) / s, (r[2][1] - r[1][2]) / s]
    elif r[1][1] > r[2][2]:
        s = math.sqrt(1.0 + r[1][1] - r[0][0] - r[2][2]) * 2
        q = [(r[0][1] + r[1][0]) / s, 0.25 * s, (r[1][2] + r[2][1]) / s, (r[0][2] - r[2][0]) / s]
    else:
        s = math.sqrt(1.0 + r[2][2] - r[0][0] - r[1][1]) * 2
        q = [(r[0][2] + r[2][0]) / s, (r[1][2] + r[2][1]) / s, 0.25 * s, (r[1][0] - r[0][1]) / s]
    return _qnorm(q)


def world_mat(nodes, parent, i):
    """Rest-pose world matrix of a node, walking up the hierarchy."""
    chain = []
    while i is not None:
        chain.append(i)
        i = parent.get(i)
    m = [[1.0 if a == b else 0.0 for b in range(4)] for a in range(4)]
    for j in reversed(chain):
        m = _mul(m, _trs(nodes[j]))
    return m


def _decompose(m):
    """4x4 -> glTF translation / rotation / scale, assuming uniform scale."""
    sc = [math.sqrt(sum(m[i][j] ** 2 for i in range(3))) for j in range(3)]
    r = [[m[i][j] / sc[j] if sc[j] > 1e-12 else 0.0 for j in range(3)] for i in range(3)]
    return ([m[0][3], m[1][3], m[2][3]],
            _qfrom_mat([row + [0.0] for row in r] + [[0.0, 0.0, 0.0, 1.0]]),
            sc)


def bake_onto_root_bone(gltf, nodes, parent, correction):
    """
    Fold a world-space correction into the skeleton's own root bone.

    It cannot go on a wrapper node above the rig. Hyperfy lifts the skeleton
    out of the scene graph to skip matrix updates it does not need:

        const rootBone = skeleton.bones[0]
        rootBone.parent.remove(rootBone)

    Everything above that bone is discarded at that moment — and the bind
    matrices were captured while it was still there, so a wrapper carrying
    the height scale and the turn does not merely get ignored, it leaves the
    skin stretched against bind matrices that still expect it. That is the
    heap of fur on the floor. Tripo parents the rig to an Armature node, so
    the wrapper always landed on the wrong side of that line.

    So bake the correction, plus any transform the ancestors were carrying,
    into the root bone, and flatten those ancestors to identity. Nothing is
    left above the bone for anyone to drop.
    """
    skin = gltf['skins'][0]
    b0 = skin.get('skeleton')
    if b0 is None:
        b0 = skin['joints'][0]

    chain = []
    i = parent.get(b0)
    while i is not None:
        chain.append(i)
        i = parent.get(i)

    above = [[1.0 if a == b else 0.0 for b in range(4)] for a in range(4)]
    for j in reversed(chain):
        above = _mul(above, _trs(nodes[j]))

    m = _mul(correction, _mul(above, _trs(nodes[b0])))
    t, q, sc = _decompose(m)
    nodes[b0]['translation'] = [round(v, 6) for v in t]
    nodes[b0]['rotation'] = [round(v, 6) for v in q]
    nodes[b0]['scale'] = [round(v, 6) for v in sc]

    for j in chain:
        for key in ('translation', 'rotation', 'scale', 'matrix'):
            nodes[j].pop(key, None)
    return nodes[b0].get('name'), len(chain)


def _floats(gltf, binary, acc_index):
    """Byte offset and element count of a tightly-packed float accessor."""
    acc = gltf['accessors'][acc_index]
    if acc.get('componentType') != 5126 or 'bufferView' not in acc:
        return None
    bv = gltf['bufferViews'][acc['bufferView']]
    if bv.get('byteStride') not in (None, 0) and bv['byteStride'] != {
            'VEC3': 12, 'MAT4': 64}.get(acc['type'], 0):
        return None   # interleaved; leave it alone
    return bv.get('byteOffset', 0) + acc.get('byteOffset', 0), acc['count']


def apply_scale(gltf, binary, s):
    """
    Resize the whole asset, without leaving a scale on any node.

    A scale parked on the root bone looks equivalent and is not. The
    animation retarget measures hip height off the posed skeleton — which
    already includes that scale — and then writes the result as a local
    position *under* the scaled bone, so the factor lands twice and the
    avatar floats half a metre off the ground. Scale the geometry, the bone
    offsets and the bind matrices instead, and there is no factor left over
    for anything to apply a second time.
    """
    for n in gltf.get('nodes', []):
        if n.get('translation'):
            n['translation'] = [v * s for v in n['translation']]

    done = set()
    for mesh in gltf.get('meshes', []):
        for prim in mesh.get('primitives', []):
            for name, ai in prim.get('attributes', {}).items():
                if name != 'POSITION' or ai in done:
                    continue
                done.add(ai)
                acc = gltf['accessors'][ai]
                for key in ('min', 'max'):
                    if key in acc:
                        acc[key] = [v * s for v in acc[key]]
                loc = _floats(gltf, binary, ai)
                if not loc:
                    continue
                off, count = loc
                vals = list(struct.unpack_from('<%df' % (count * 3), binary, off))
                struct.pack_into('<%df' % (count * 3), binary, off,
                                 *[v * s for v in vals])

    # The bind matrices invert the rest pose, so their translation moves with
    # it. Their rotation does not — a uniform scale commutes with rotation.
    for skin in gltf.get('skins', []):
        if 'inverseBindMatrices' not in skin:
            continue
        loc = _floats(gltf, binary, skin['inverseBindMatrices'])
        if not loc:
            continue
        off, count = loc
        vals = list(struct.unpack_from('<%df' % (count * 16), binary, off))
        for m in range(count):
            for k in (12, 13, 14):
                vals[m * 16 + k] *= s
        struct.pack_into('<%df' % (count * 16), binary, off, *vals)

    for anim in gltf.get('animations', []):
        for ch in anim.get('channels', []):
            if ch.get('target', {}).get('path') != 'translation':
                continue
            loc = _floats(gltf, binary, anim['samplers'][ch['sampler']]['output'])
            if not loc:
                continue
            off, count = loc
            vals = list(struct.unpack_from('<%df' % (count * 3), binary, off))
            struct.pack_into('<%df' % (count * 3), binary, off,
                             *[v * s for v in vals])


def _acc_array(gltf, binary, ai):
    """Read an accessor into a numpy array of shape (count, components)."""
    import numpy as np
    acc = gltf['accessors'][ai]
    comps = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[acc['type']]
    dtype, size = {5120: ('<i1', 1), 5121: ('<u1', 1), 5122: ('<i2', 2),
                   5123: ('<u2', 2), 5125: ('<u4', 4), 5126: ('<f4', 4)}[acc['componentType']]
    bv = gltf['bufferViews'][acc['bufferView']]
    off = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
    stride = bv.get('byteStride') or comps * size
    if stride == comps * size:
        a = np.frombuffer(bytes(binary[off:off + acc['count'] * stride]), dtype=dtype)
        return a.reshape(acc['count'], comps)
    rows = [np.frombuffer(bytes(binary[off + i * stride:off + i * stride + comps * size]),
                          dtype=dtype) for i in range(acc['count'])]
    return np.array(rows)


def _acc_write(gltf, binary, ai, arr):
    """Write a float accessor back in place, refreshing its min/max."""
    acc = gltf['accessors'][ai]
    comps = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[acc['type']]
    bv = gltf['bufferViews'][acc['bufferView']]
    off = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
    stride = bv.get('byteStride') or comps * 4
    flat = arr.astype('<f4')
    if stride == comps * 4:
        binary[off:off + flat.nbytes] = flat.tobytes()
    else:
        for i in range(acc['count']):
            binary[off + i * stride:off + i * stride + comps * 4] = flat[i].tobytes()
    if 'min' in acc or 'max' in acc:
        acc['min'] = [float(v) for v in arr.min(axis=0)]
        acc['max'] = [float(v) for v in arr.max(axis=0)]


def rebuild_rest(gltf, binary, nodes, parent):
    """
    Move the mesh onto the rest pose the nodes now describe, and leave every
    bone with no rest rotation at all.

    This is what makes the difference between a rig that animates and one
    that does not. An emote clip is normalised — each rotation is written as
    though the bone it drives had no rest orientation — and Hyperfy applies
    it straight to the bone. Avatars authored the usual way get away with it
    because their bones really are unrotated at rest; every one of the working
    avatars measures 0,0,0 on every bone. A rig from a character generator is
    Mixamo-oriented, every bone turned to run down its own limb, and the same
    clip then means something else entirely: the cat ends up flat on the
    floor with its feet above its head.

    So re-parameterise. Each joint keeps exactly the world position it has
    and gives up its rotation; the mesh is skinned into that pose once, here,
    and the bind matrices are rewritten to match. Nothing moves — the rest
    pose looks identical — but every rotation in the file is now measured
    from the same place the clips assume.
    """
    import numpy as np

    joints = []
    for skin in gltf['skins']:
        joints.extend(skin['joints'])
    joints = sorted(set(joints))

    wm = {j: np.array(world_mat(nodes, parent, j), dtype=np.float64) for j in joints}
    p = {j: wm[j][:3, 3].copy() for j in joints}

    moved = set()
    for skin in gltf['skins']:
        inv = _acc_array(gltf, binary, skin['inverseBindMatrices']).astype(np.float64)
        inv = inv.reshape(-1, 4, 4).transpose(0, 2, 1)      # glTF stores columns
        sj = skin['joints']
        # where each joint carries its vertices: out of the old bind pose,
        # into the rest pose the nodes describe right now
        xf = np.zeros((len(sj), 4, 4))
        for k, j in enumerate(sj):
            xf[k] = wm[j] @ inv[k]
            inv[k] = np.eye(4)
            inv[k][:3, 3] = -p[j]

        out = inv.transpose(0, 2, 1).reshape(-1, 16)
        _acc_write(gltf, binary, skin['inverseBindMatrices'], out)

        for node in nodes:
            if node.get('skin') != gltf['skins'].index(skin) or 'mesh' not in node:
                continue
            for prim in gltf['meshes'][node['mesh']]['primitives']:
                at = prim['attributes']
                key = (at['POSITION'], at.get('NORMAL'))
                if key in moved:
                    continue
                moved.add(key)
                jn = _acc_array(gltf, binary, at['JOINTS_0']).astype(np.int64)
                # weights may be stored as normalised integers; renormalising
                # the rows handles that and any rounding drift in one go
                w = _acc_array(gltf, binary, at['WEIGHTS_0']).astype(np.float64)
                w = w / np.maximum(w.sum(axis=1, keepdims=True), 1e-8)

                v = _acc_array(gltf, binary, at['POSITION']).astype(np.float64)
                acc = np.zeros_like(v)
                nrm = None
                if at.get('NORMAL') is not None:
                    n = _acc_array(gltf, binary, at['NORMAL']).astype(np.float64)
                    nrm = np.zeros_like(n)
                for i in range(jn.shape[1]):
                    m = xf[jn[:, i]]
                    wi = w[:, i:i + 1]
                    acc += wi * (np.einsum('nij,nj->ni', m[:, :3, :3], v) + m[:, :3, 3])
                    if nrm is not None:
                        nrm += wi * np.einsum('nij,nj->ni', m[:, :3, :3], n)
                _acc_write(gltf, binary, at['POSITION'], acc)
                if nrm is not None:
                    ln = np.linalg.norm(nrm, axis=1, keepdims=True)
                    _acc_write(gltf, binary, at['NORMAL'], nrm / np.maximum(ln, 1e-8))

    # finally, strip every rest rotation and scale off the joints themselves
    for j in joints:
        pj = parent.get(j)
        base = p[pj] if pj in p else np.zeros(3)
        nodes[j]['translation'] = [round(float(v), 6) for v in (p[j] - base)]
        nodes[j].pop('rotation', None)
        nodes[j].pop('scale', None)
        nodes[j].pop('matrix', None)
    return len(joints)


ARM_CHAINS = {
    'left':  ['leftUpperArm', 'leftLowerArm', 'leftHand'],
    'right': ['rightUpperArm', 'rightLowerArm', 'rightHand'],
}


def tpose_arms(nodes, parent, found, yaw, left_x):
    """
    Straighten both arms out sideways, so the rest pose is a real T-pose.

    VRM says the rest pose is a T-pose, and every consumer takes it at its
    word: Hyperfy adds a fixed 75 degree arms-down rotation on load, and its
    animations are retargeted on the same assumption. Tripo hands back an
    A-pose instead — arms already at the sides, and running along Z rather
    than X. Rotating an already-lowered arm about Z does not lower it
    further, it swings it out and up, which is the flailing sprawl.

    So bake the T-pose in. Each arm segment is turned to point along the
    character's own left or right, in the frame the rig has *before* the
    yaw correction is applied (the yaw goes on a root node later). The mesh
    follows because the bind matrices are untouched: moving the rest pose
    moves the skin with it, and Hyperfy's 75 degrees then puts the arms
    back down where Tripo had them.
    """
    unturn = [0.0, math.sin(-yaw / 2), 0.0, math.cos(-yaw / 2)]
    turned = 0
    for side, names in ARM_CHAINS.items():
        sign = left_x if side == 'left' else -left_x
        target = _qrot(unturn, [sign, 0.0, 0.0])
        idx = [found[n] for n in names if n in found]
        for a, b in zip(idx, idx[1:]):
            wa, wb = world_mat(nodes, parent, a), world_mat(nodes, parent, b)
            cur = [wb[i][3] - wa[i][3] for i in range(3)]
            if math.sqrt(sum(c * c for c in cur)) < 1e-6:
                continue
            q = _qbetween(cur, target)
            if abs(q[3]) > 0.999999:
                continue
            pw = parent.get(a)
            pq = _qfrom_mat(world_mat(nodes, parent, pw)) if pw is not None else [0.0, 0.0, 0.0, 1.0]
            local = _qmul(_qconj(pq), _qmul(q, _qfrom_mat(wa)))
            nodes[a]['rotation'] = [round(v, 6) for v in _qnorm(local)]
            turned += 1
    return turned


def measure_yaw(nodes, parent, found, left_x):
    """
    How far the rig is turned away from the VRM convention, in radians.

    The character's left shoulder belongs at -X, which is where the avatars
    that already animate correctly put theirs. So the vector from the right
    shoulder to the left one, flattened onto the ground plane, should point
    that way. Measuring beats asking, because
    generators disagree: Tripo hands back a rig whose arms run along Z, and
    Hyperfy's hard-coded arms-down rotation assumes they run along X.

    Measure it at the shoulders, not the hands. In the A-pose Tripo returns
    the hands hang loose and swing forward of the body, so the hand-to-hand
    vector is mostly noise — it read 271 degrees on a rig that wanted 91,
    and turned the cat around to face backwards. Shoulders sit high on the
    ribcage and cannot dangle.
    """
    lh = world_pos(nodes, parent, found['leftUpperArm'])
    rh = world_pos(nodes, parent, found['rightUpperArm'])
    dx, dz = lh[0] - rh[0], lh[2] - rh[2]
    if math.hypot(dx, dz) < 1e-6:
        return 0.0
    # A rotation of theta about +Y adds theta to the compass angle
    # atan2(-z, x), so the correction is target-minus-current, not the
    # other way round. Getting that backwards turns the cat around to
    # face its own tail while leaving the arms looking perfectly fine,
    # because the arm bake is measured against the same wrong angle.
    here = math.atan2(-dz, dx)
    there = 0.0 if left_x > 0 else math.pi
    return there - here


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
    ap.add_argument('--spec', choices=['0.0', '1.0'], default='0.0',
                    help='which VRM spec to write. 0.0 by default, because that '
                         'is what Hyperfy animates against: its retarget mirrors '
                         'the clip for a 0.0 avatar and not for a 1.0 one, so a '
                         '1.0 file gets the mirror it needs withheld and stands '
                         'there with both arms in the air.')
    ap.add_argument('--no-rest', dest='rest', action='store_false',
                    help='leave the bind pose alone. By default the mesh is '
                         'skinned once into its rest pose so that no bone '
                         'carries a rest rotation, which is what the animation '
                         'retarget assumes and what every working avatar does.')
    ap.add_argument('--no-tpose', dest='tpose', action='store_false',
                    help='leave the rest pose alone. By default both arms are '
                         'straightened out sideways, because VRM promises a '
                         'T-pose and Hyperfy adds its own arms-down rotation on '
                         'top of whatever it is given.')
    ap.add_argument('--yaw', type=float, default=None, metavar='DEG',
                    help='override the measured turn. Normally the rig is measured '
                         'from its own hand positions, which handles the 180 degree '
                         'case (arms mirrored, both lifted into the air) and the 90 '
                         'degree one (arms driven into the floor) without being told.')
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

    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get('children', []):
            parent[c] = i

    left_x = -1.0
    yaw = (math.radians(a.yaw) if a.yaw is not None
           else measure_yaw(nodes, parent, found, left_x))
    deg = round(math.degrees(yaw)) % 360
    print('rig is turned %d deg from VRM facing — correcting' % deg if deg else
          'rig already faces the VRM way')

    if a.tpose:
        n = tpose_arms(nodes, parent, found, yaw, left_x)
        print('straightened %d arm segments into the T-pose VRM expects' % n)

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
        apply_scale(gltf, binary, scale)
        lo = [v * scale for v in lo]
        hi = [v * scale for v in hi]

    # Rather than rewrite every vertex, parent the existing scene under one
    # root carrying both the turn and the scale.
    # The turn has to pivot on the character, not on the world origin. A rig
    # whose hips sit 0.37m off-centre gets slid that far sideways by a plain
    # rotation, which walks the avatar around beside its own collider. So
    # rotate, then bring the hips back over the origin and drop the feet
    # onto the floor.
    hq = [0.0, math.sin(yaw / 2), 0.0, math.cos(yaw / 2)]
    hips = world_mat(nodes, parent, found['hips'])
    hx, _, hz = _qrot(hq, [hips[0][3], 0.0, hips[2][3]])
    offset = [-hx, -lo[1] if span > 0 else 0.0, -hz]

    ry = mat3_from_quat(hq)
    correction = [list(ry[i]) + [offset[i]] for i in range(3)]
    correction += [[0.0, 0.0, 0.0, 1.0]]

    bone, dropped = bake_onto_root_bone(gltf, nodes, parent, correction)
    print('baked the turn and the recentring onto %s'
          '%s' % (bone, ' (flattened %d node%s above it)'
                  % (dropped, '' if dropped == 1 else 's') if dropped else ''))

    if a.rest:
        n = rebuild_rest(gltf, binary, nodes, parent)
        print('rebuilt the rest pose: %d joints, none of them rotated' % n)

    gltf.setdefault('extensionsUsed', [])
    gltf.setdefault('extensions', {})

    if a.spec == '1.0':
        ext = 'VRMC_vrm'
        gltf['extensions'][ext] = {
            'specVersion': '1.0',
            'meta': {
                'name': a.name, 'version': '1', 'authors': [a.author],
                'licenseUrl': 'https://vrm.dev/licenses/1.0/',
                'avatarPermission': 'everyone',
                'allowExcessivelyViolentUsage': False,
                'allowExcessivelySexualUsage': False,
                'commercialUsage': 'corporation',
                'allowPoliticalOrReligiousUsage': False,
                'allowAntisocialOrHateUsage': False,
                'creditNotation': 'unnecessary',
                'allowRedistribution': True,
                'modification': 'allowModification',
            },
            'humanoid': {'humanBones': {b: {'node': found[b]} for b in sorted(found)}},
            'firstPerson': {'meshAnnotations': []},
            'expressions': {'preset': {}},
        }
    else:
        ext = 'VRM'
        gltf['extensions'][ext] = {
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

    if ext not in gltf['extensionsUsed']:
        gltf['extensionsUsed'].append(ext)

    write_glb(gltf, binary, a.dst)
    print('mapped %d humanoid bones (%d required, all present)' % (len(found), len(REQUIRED)))
    print('wrote %s' % a.dst)


if __name__ == '__main__':
    main()
