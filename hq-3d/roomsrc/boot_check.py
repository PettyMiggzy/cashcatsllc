"""
Boot the world headless and fail if any room's script crashed.

Run it with the world server STOPPED, and run the installers with it stopped
too: they rewrite world/db.sqlite, which the running server holds open, and a
concurrent write to it takes the live server down mid-session.

`node --check` proves a script parses. It does not prove the script runs, and
the two failures that actually shipped in this build were both runtime:

  - a room installed with model=None, so the loader called .endsWith() on it
  - `app.load(...)`, which does not exist — it is `world.load(...)`

Both killed a script outright. Neither showed up anywhere a person would look:
the world came up, the server said "listening", and the plaza was simply
missing its skyline, its trees, its lamps and its statues. Nothing said so.

This boots the real server against the real database, watches stdout for the
engine's own crash reporting, and exits non-zero if it sees any. Run it after
the installers and before the deploy.
"""
import os, re, signal, subprocess, sys, time

HQ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# The engine prints "script crashed" then the error; the loader prints its own.
BAD = re.compile(
    r'script crashed'
    r'|is not a function'
    r'|Cannot read propert'
    r'|is not defined'
    r'|cannot load type'
    r'|crash-block',
    re.I)

# Warnings the engine emits on a healthy boot. Not our problem, not failures.
OK = re.compile(r'triangles are too big|Couldn.t load texture blob', re.I)


def main(seconds=25):
    env = dict(os.environ, PORT=os.environ.get('BOOT_CHECK_PORT', '3199'))
    p = subprocess.Popen(['npm', 'start'], cwd=HQ, env=env, stdout=subprocess.PIPE,
                         stderr=subprocess.STDOUT, text=True, bufsize=1,
                         preexec_fn=os.setsid)
    lines, faults, listening = [], [], False
    deadline = time.time() + seconds
    try:
        os.set_blocking(p.stdout.fileno(), False)
        while time.time() < deadline:
            line = p.stdout.readline()
            if not line:
                if p.poll() is not None:
                    break
                time.sleep(0.05)
                continue
            lines.append(line.rstrip())
            if 'server listening' in line:
                listening = True
                deadline = min(deadline, time.time() + 12)  # let scripts settle
            if BAD.search(line) and not OK.search(line):
                faults.append(line.rstrip())
    finally:
        try:
            os.killpg(os.getpgid(p.pid), signal.SIGTERM)
            p.wait(timeout=10)
        except Exception:
            pass

    if not listening:
        print('boot check: server never came up')
        print('\n'.join(lines[-25:]))
        return 1
    if faults:
        print('boot check: %d script fault(s) — a room is broken and the world '
              'would come up with a hole in it\n' % len(faults))
        # the two lines after a fault carry the stack frame worth reading
        for i, ln in enumerate(lines):
            if ln in faults:
                print('\n'.join('    ' + x for x in lines[i:i + 4]))
                print()
        return 1
    print('boot check: clean — %d lines, no script faults' % len(lines))
    return 0


if __name__ == '__main__':
    sys.exit(main())
