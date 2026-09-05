#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Take the parked rooms out of the world.

    python3 roomsrc/park_rooms.py

Skipping an installer is not the same as removing a room. The installers write
into world/db.sqlite and it persists across deploys, so a room parked in
ROOMS_OFF.txt keeps loading from whatever the LAST run that included it wrote.
The world would look exactly as before and the park list would look broken.

This deletes the blueprint and every entity using it. Nothing is lost: the
installer is still in roomsrc, one line out of ROOMS_OFF.txt away from putting
the room back exactly as it was.
"""
import io, json, os, re, sqlite3, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(os.path.dirname(ROOT), 'world', 'db.sqlite')
OFF = os.path.join(ROOT, 'ROOMS_OFF.txt')

def blueprint_of(room):
    """
    Read the blueprint id out of the room's own installer.

    Not a table in this file. A hardcoded map is a third copy of the same fact
    and it drifts silently: a room whose id changed would keep loading with the
    park list looking correct. The installer is the thing that writes the id, so
    ask it.
    """
    f = os.path.join(ROOT, 'install_%s.py' % room)
    if not os.path.exists(f):
        return None
    m = re.search(r"""(?m)^BP\s*=\s*['"]([^'"]+)['"]""",
                  io.open(f, encoding='utf-8').read())
    return m.group(1) if m else None


def parked():
    if not os.path.exists(OFF):
        return []
    out = []
    for line in open(OFF, encoding='utf-8'):
        line = line.split('#')[0].strip()
        if line:
            out.append(line)
    return out


def check_campus(rooms):
    """
    campus.js keeps its own copy of the park list and must agree with ours.

    It has to: it is a sandboxed app script with no filesystem, so it cannot
    read ROOMS_OFF.txt. But parking a room deletes the walls that room drew,
    and campus.js is what draws the OUTSIDE of those walls -- so if the two
    lists drift, the plaza keeps a frontage, a nameplate, a paved path and a
    directory entry for a building that is no longer there. A door standing in
    open air reads as a world that failed to load.

    Two copies of a fact are fine as long as something fails loudly when they
    disagree. This is that something.
    """
    f = os.path.join(ROOT, 'campus.js')
    if not os.path.exists(f):
        return []
    m = re.search(r"(?m)^const OFF = \[([^\]]*)\]", io.open(f, encoding='utf-8').read())
    if not m:
        return ["campus.js has no `const OFF = [...]` line to check"]
    theirs = set(re.findall(r"'([^']+)'", m.group(1)))
    ours = set(rooms)
    bad = []
    for r in sorted(ours - theirs):
        bad.append('%s is parked but campus.js still builds its frontage' % r)
    for r in sorted(theirs - ours):
        bad.append('campus.js hides %s but it is not parked' % r)
    return bad


def main():
    rooms = parked()
    if not rooms:
        print('  nothing parked')
        return 0
    if not os.path.exists(DB):
        print('  no world db yet — nothing to remove')
        return 0
    con = sqlite3.connect(DB)

    drop = {}
    unknown = []
    for r in rooms:
        bid = blueprint_of(r)
        if not bid:
            # Carrying on here would print a clean summary for a room that is
            # still in the world. Say so and fail.
            unknown.append(r)
            continue
        drop[bid] = r

    # Match on the parsed blueprint field, not on a LIKE over the raw text. The
    # stored JSON is written with a space after each colon, so a pattern like
    # '"blueprint":"x"' silently matches nothing and leaves entities pointing
    # at blueprints this script just deleted — a world that loads broken apps.
    counts = dict((b, 0) for b in drop)
    kill = []
    for eid, data in con.execute('select id, data from entities'):
        try:
            bid = json.loads(data).get('blueprint')
        except (ValueError, TypeError):
            continue
        if bid in drop:
            counts[bid] += 1
            kill.append((eid,))
    con.executemany('delete from entities where id = ?', kill)

    gone = []
    for bid, r in drop.items():
        c = con.execute('delete from blueprints where id = ?', (bid,)).rowcount
        n = counts[bid]
        if c or n:
            gone.append('%s (%d entit%s)' % (r, n, 'y' if n == 1 else 'ies'))
    con.commit()

    left = [row[0] for row in con.execute('select id from blueprints')]
    # Anything still pointing at a blueprint that no longer exists would load as
    # a broken app in world. Report it rather than let it ship quietly.
    orphans = 0
    for eid, data in con.execute('select id, data from entities'):
        try:
            bid = json.loads(data).get('blueprint')
        except (ValueError, TypeError):
            continue
        if bid and bid not in left:
            orphans += 1
    con.close()
    print('  removed: %s' % (', '.join(gone) if gone else 'nothing — already out'))
    print('  world now holds %d blueprint(s): %s' % (len(left), ', '.join(sorted(left))))
    drift = check_campus(rooms)
    if drift:
        for d in drift:
            print('  ! ' + d)
        print('    roomsrc/campus.js and roomsrc/ROOMS_OFF.txt disagree')
        return 1
    if unknown:
        print('  ! no blueprint id found for: %s' % ', '.join(unknown))
        print('    those rooms are parked but still in the world')
        return 1
    if orphans:
        print('  ! %d entit%s still point at a missing blueprint'
              % (orphans, 'y' if orphans == 1 else 'ies'))
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
