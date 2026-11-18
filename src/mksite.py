import os
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
js=open(SRC+'/app.js').read(); enc=open(SRC+'/enc.js').read()
i=js.rindex('boot();'); neg=open(SRC+'/neg.js').read()+'\n'+open(SRC+'/mtg.js').read()+'\n'+open(SRC+'/print.js').read()+'\n'+open(SRC+'/sess.js').read()+'\n'+open(SRC+'/cards.js').read()
import hashlib,glob,gzip
h=hashlib.md5(b''.join(open(f,'rb').read() for f in sorted(glob.glob(SITE+'/data/*.json')))).hexdigest()[:10]
for f in glob.glob(SITE+'/data/*.json'):
    open(f[:-5]+'.gz.txt','wb').write(__import__('base64').b64encode(gzip.compress(open(f,'rb').read(),9,mtime=0)))
open(SITE+'/app.js','w').write((js[:i]+enc+'\n'+neg+'\n'+js[i:]).replace('__DATAV__',h))
shutil.copy('/opt/npm-tools/node_modules/pdf-lib/dist/pdf-lib.esm.min.js',SITE+'/lib/pdf-lib.esm.min.js')
shutil.copy(ROOT+'/importer/dsparse.mjs',SITE+'/lib/dsparse.mjs')
