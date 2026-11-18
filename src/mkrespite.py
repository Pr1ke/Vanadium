import os,builtins
def open(p,m='r',*a,**k):
    # UTF-8 and no newline translation, so the build is identical on Windows/macOS/Linux
    if 'b' not in m: k.setdefault('encoding','utf-8'); k.setdefault('newline','')
    return builtins.open(p,m,*a,**k)
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC=ROOT+'/src'; SITE=ROOT+'/site'
import re
src=open(SRC+'/respite-base.html').read()
m=re.search(r'(<style[^>]*>)(.*?)(</style>)',src,re.S)
css=m.group(2).split('\n')
# keep structural base (1-214) + phones (378-end); drop the two ornate theme layers
keep='\n'.join(css[:214]+css[377:])
new=keep+'\n'+open(SRC+'/respite-vanadium.css').read()
out=src[:m.start()]+m.group(1)+new+m.group(3)+src[m.end():]
out=re.sub(r'<link href="https://fonts.googleapis.com/css2\?family=Cormorant[^>]*>','<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Serif+4:ital,wght@0,400;1,400&display=swap" rel="stylesheet">',out)
sync='''<script>(function(){function ap(){try{var t=JSON.parse(localStorage.getItem('st_theme2')||'"light"');document.documentElement.dataset.theme=t;}catch(e){}}ap();window.addEventListener('storage',ap);window.__stTheme=ap;})();</script>'''
out=out.replace('</head>',sync+'\n</head>',1)
out=out.replace('<title>Respite · Draw Steel Downtime','<title>Respite · Vanadium')
open(SITE+'/respite.html','w').write(out)
print(len(out))
