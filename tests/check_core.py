"""Checks that core files don't use names defined by a game system module directly
(they must go through SYS.* hooks), so the core stays system-neutral.

  python tests/check_core.py

Lists every top-level name declared in src/systems/<id>/*.js and reports core files that
mention one. sess.js and cards.js are still Draw Steel-specific (step 1b) and are reported
separately, without failing the check.
"""
import glob, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'src')
CORE = ['app.js', 'print.js', 'sync.js', 'sess.js', 'cards.js']
PENDING = []   # core files not yet behind hooks (none since step 1b)

decl = re.compile(r'^(?:async\s+)?(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*))', re.M)


def strip_js(src):
    """drop comments and string/template contents so prose doesn't count as a use"""
    src = re.sub(r'/\*.*?\*/', '', src, flags=re.S)
    src = re.sub(r'(?m)(^|[^:\\])//.*$', r'\1', src)
    return re.sub(r"'(?:\\.|[^'\\\n])*'|\"(?:\\.|[^\"\\\n])*\"", "''", src)


names = {}
for f in glob.glob(os.path.join(SRC, 'systems', '*', '*.js')):
    for m in decl.finditer(open(f, encoding='utf-8').read()):
        names[m.group(1) or m.group(2)] = os.path.relpath(f, SRC)

def uses(fname):
    src = strip_js(open(os.path.join(SRC, fname), encoding='utf-8').read())
    # a name the file declares itself (e.g. a local `const chars`) is its own, not the system's
    own = set(re.findall(r'\b(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)', src))
    return sorted({n for n in names if n not in own and re.search(r'(?<![\w$.])' + re.escape(n) + r'(?![\w$])', src)})

bad = 0
for f in CORE:
    u = uses(f)
    print(f'{f:9} {"ok" if not u else "uses system names: " + ", ".join(f"{n} ({names[n]})" for n in u)}')
    bad += len(u)
for f in PENDING:
    u = uses(f)
    print(f'{f:9} (pending 1b) {len(u)} system names: {", ".join(u)}')
print(f'\n{len(names)} names declared by system modules; core is {"system-neutral" if not bad else "NOT neutral"}')
sys.exit(1 if bad else 0)
