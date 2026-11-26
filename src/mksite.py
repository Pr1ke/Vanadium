import os,builtins
def open(p,m='r',*a,**k):
    # UTF-8 and no newline translation, so the build is identical on Windows/macOS/Linux
    if 'b' not in m: k.setdefault('encoding','utf-8'); k.setdefault('newline','')
    return builtins.open(p,m,*a,**k)
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC=ROOT+'/src'; SITE=ROOT+'/site'
import re,shutil
a=open(SRC+'/app.html').read()
head=a[:a.index('</style>')]
extra=open(SRC+'/extra.css').read()
body=open(SRC+'/body.html').read()
head=head.replace('<meta name="viewport" content="width=device-width, initial-scale=1">','<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<meta name="theme-color" content="#ffffff">')
head=head.replace('<title>','<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22%3E%3Cpath d=%22M16 2 L19 18 L16 22 L13 18Z%22 fill=%22%23cfd6de%22/%3E%3Cpath d=%22M9 20h14v3H9z%22 fill=%22%23e0703a%22/%3E%3C/svg%3E">\n<title>')
head=head.replace('family=Inter:wght@400;500;600','family=Inter:wght@400;500;600;700').replace('<title>Vanadium','<title>Vanadium')
html=head+extra+open(SRC+'/vanadium.css').read()+'</style>\n</head>\n'+body
open(SITE+'/index.html','w').write(html)
# app.js = core (src/app.js up to its trailing boot();) + each game system's files (they call
# registerSystem) + core modules + boot(). One global script, so order only matters for code that
# runs at load time: systems come after the core helpers they use.
SYSTEM_FILES={'drawsteel':['drawsteel.js','enc.js','neg.js','mtg.js','ds-print.js']}
CORE_MODULES=['print.js','sess.js','cards.js']
js=open(SRC+'/app.js').read(); i=js.rindex('boot();')
parts=[open(SRC+'/systems/%s/%s'%(s,f)).read() for s,fs in SYSTEM_FILES.items() for f in fs]+[open(SRC+'/'+f).read() for f in CORE_MODULES]
import hashlib,glob,gzip
rj=lambda f: open(f,'rb').read().replace(b'\r\n',b'\n')  # a Windows checkout has CRLF; build the same bytes everywhere
h=hashlib.md5(b''.join(rj(f) for f in sorted(glob.glob(SITE+'/data/*.json')))).hexdigest()[:10]
for f in glob.glob(SITE+'/data/*.json'):
    open(f[:-5]+'.gz.txt','wb').write(__import__('base64').b64encode(gzip.compress(rj(f),9,mtime=0)))
# asset version: changes whenever any source changes; added as ?v= to sync.js, app.js and respite.html
# so browsers never keep running an old copy after an update (hosts often let them cache heuristically)
av=hashlib.md5(b''.join(open(f,'rb').read().replace(b'\r\n',b'\n') for f in sorted(glob.glob(SRC+'/**/*',recursive=True))+[ROOT+'/importer/dsparse.mjs'] if os.path.isfile(f))).hexdigest()[:10]
html=html.replace('<script src="sync.js">','<script src="sync.js?v=%s" data-v="%s">'%(av,av))
open(SITE+'/index.html','w').write(html)
open(SITE+'/app.js','w').write((js[:i]+'\n'.join(parts)+'\n'+js[i:]).replace('__DATAV__',h).replace('__ASSETV__',av))
for p in (ROOT+'/node_modules/pdf-lib/dist/pdf-lib.esm.min.js','/opt/npm-tools/node_modules/pdf-lib/dist/pdf-lib.esm.min.js'):
    if os.path.exists(p): shutil.copy(p,SITE+'/lib/pdf-lib.esm.min.js'); break
shutil.copy(ROOT+'/importer/dsparse.mjs',SITE+'/lib/dsparse.mjs')
shutil.copy(SRC+'/update.php',SITE+'/update.php')  # self-updater for PHP hosts
shutil.copy(SRC+'/sync.php',SITE+'/sync.php')      # sync server for PHP hosts
shutil.copy(SRC+'/sync.js',SITE+'/sync.js')        # sync client; loads app.js
shutil.copy(SRC+'/card.php',SITE+'/card.php')      # public card JPGs behind the QR codes
q=ROOT+'/node_modules/qrcode-generator/qrcode.js'   # qrcode-generator 1.4.4 (MIT), vendored like pdf-lib
if os.path.exists(q): shutil.copy(q,SITE+'/lib/qrcode.js')
