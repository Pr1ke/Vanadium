# Last build step: write site/version.json, a fingerprint of the generated site.
# serve.py compares it with the copy on GitHub to decide whether to download a new build,
# and the app compares it with the one it booted with to offer a reload.
import os, json, hashlib, time
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, 'site')
OUT = os.path.join(SITE, 'version.json')

h = hashlib.sha256()
for dp, dns, fns in os.walk(SITE):
    dns.sort()
    for fn in sorted(fns):
        p = os.path.join(dp, fn)
        if p == OUT: continue
        rel = os.path.relpath(p, SITE).replace(os.sep, '/')
        # normalise CRLF so a Windows checkout and a Linux checkout hash the same
        h.update(rel.encode() + b'\0' + open(p, 'rb').read().replace(b'\r\n', b'\n') + b'\0')
build = h.hexdigest()[:16]

old = None
try: old = json.load(open(OUT, encoding='utf-8'))
except Exception: pass
if old and old.get('build') == build:
    print('version.json unchanged', build)  # keep the old timestamp so nothing looks new
else:
    with open(OUT, 'w', encoding='utf-8', newline='') as f:
        json.dump({'build': build, 'built': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}, f)
        f.write('\n')
    print('version.json', build)
