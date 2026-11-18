import json, sys, os, glob
from PIL import Image
pid = sys.argv[1]; maxd = int(sys.argv[2]) if len(sys.argv) > 2 else 1000
src = f'/tmp/imgraw/{pid}'; dst = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),'site','data','img',pid); os.makedirs(dst, exist_ok=True)
tot = 0
for j in sorted(glob.glob(src + '/*.json'), key=lambda p: int(os.path.basename(p)[:-5])):
    k = os.path.basename(j)[:-5]; m = json.load(open(j)); raw = open(f'{src}/{k}.raw', 'rb').read()
    mode = {1: 'L', 3: 'RGB', 4: 'RGBA'}[m['ch']]
    need = m['w'] * m['h'] * m['ch']
    if len(raw) < need: print('short', k); continue
    im = Image.frombytes(mode, (m['w'], m['h']), raw[:need])
    if mode == 'RGBA' and im.getextrema()[3][0] == 255: im = im.convert('RGB')
    md = maxd if m['w']*m['h'] < 2.5e6 else int(maxd*1.4)
    im.thumbnail((md, md), Image.LANCZOS)
    out = f'{dst}/{k}.webp'
    im.save(out, 'WEBP', quality=72, method=6)
    tot += os.path.getsize(out)
print(pid, 'files', len(glob.glob(dst + '/*.webp')), 'MB', round(tot / 1e6, 2))
