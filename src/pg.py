import re,sys
x=open(sys.argv[1]).read()
pages=re.split(r'<page number="',x)[1:]
want=set(int(a) for a in sys.argv[2:])
for p in pages:
    n=int(p.split('"')[0])
    if n not in want: continue
    print('=== PAGE',n)
    for m in re.finditer(r'<text top="(\d+)" left="(\d+)" width="(\d+)" height="(\d+)" font="(\d+)">(.*?)</text>',p):
        print(m[1],m[2],m[3],'f'+m[5],m[6])
