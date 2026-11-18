"""Turn the block stream into site data: book chapters + typed entities."""
import json, re, sys, html, collections

B = json.load(open(sys.argv[1]))
OUT = sys.argv[2]

def strip_a(h):
    return re.sub(r'</?a[^>]*>', '', h or '')

def plain(h):
    return html.unescape(re.sub(r'<[^>]+>', '', h or '')).strip()

def slug(s):
    s = plain(s).lower().replace('’', '').replace("'", '')
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')

# ---------- cleanup ----------
blocks = []
for b in B:
    if b['pg'] < 8: continue
    if b.get('label') is None or not str(b.get('label')).isdigit():
        b['label'] = str(b['pg'] - 15) if b['pg'] > 15 else ''
    for k in ('html',):
        if k in b: b[k] = strip_a(b[k])
    if b['t'] == 'ability':
        b['flavor'] = strip_a(b['flavor']); b['distance'] = strip_a(b['distance']); b['target'] = strip_a(b['target'])
        for r in b['rows']: r['html'] = strip_a(r['html'])
        # fold stray first rows that are really target text
        if not b['target'] and b['rows'] and b['rows'][0]['k'] == 'field' and not re.match(r'\s*(<b>)?[A-Z][^:]{0,40}:', b['rows'][0]['html']):
            b['target'] = b['rows'].pop(0)['html']
        for r in b['rows']:
            if r['k'] == 'field':
                r['html'] = re.sub(r'^\s*([A-Z][A-Za-z0-9+ ’\'\-]{0,40}:)(?!</b>)\s*', lambda m: '<b>%s</b> ' % m[1], r['html']) if not r['html'].startswith('<b>') else r['html']
            if r['k'] == 'roll':
                r['html'] = plain(r['html']).rstrip(':').strip()
    if b['t'] == 'table':
        b['head'] = [plain(h) for h in b['head']]
        b['rows'] = [[strip_a(c) for c in r] for r in b['rows']]
        # split merged "Level Features"
        if b['head'] and b['head'][0].startswith('Level ') and b['head'][0] != 'Level':
            rest = b['head'][0][6:]
            b['head'] = ['Level', rest] + b['head'][1:]
            nr = []
            for r in b['rows']:
                c0 = r[0]
                m = re.match(r'^\s*(\d+(?:st|nd|rd|th))\s+(.*)$', plain(c0), re.S)
                if m: nr.append([m[1], m[2]] + r[1:])
                else: nr.append(['', c0] + r[1:])
            b['rows'] = nr
    if b['t'] == 'h':
        b['text'] = plain(b['text'])
        if not b['text']: continue
        if re.fullmatch(r'Chapter \d+', b['text']): continue
    blocks.append(b)

# drop caption duplicates: heading immediately followed by a heading of same/higher level, with a duplicate name elsewhere
names = collections.Counter(b['text'] for b in blocks if b['t'] == 'h')
clean = []
for i, b in enumerate(blocks):
    if b['t'] == 'h' and b['lvl'] >= 3 and names[b['text']] > 1 and i + 1 < len(blocks):
        n = blocks[i + 1]
        if n['t'] == 'h' and n['lvl'] <= b['lvl'] + 0:
            names[b['text']] -= 1
            continue
    clean.append(b)
blocks = clean

# title-case big names
def tcase(s):
    return ' '.join(w.capitalize() if w.isupper() else w for w in s.split())
for b in blocks:
    if b['t'] == 'h' and b['lvl'] == 1 and b['text'].isupper():
        b['text'] = tcase(b['text'])

# ---------- ids & chapters ----------
chapters = []
cur = None
used = set()
for i, b in enumerate(blocks):
    b['i'] = i
    if b['t'] == 'h' and b['lvl'] == 0:
        cur = dict(id=slug(b['text']), title=b['text'], blocks=[])
        chapters.append(cur)
    if cur is None:
        cur = dict(id='front', title='Front Matter', blocks=[]); chapters.append(cur)
    if b['t'] == 'h':
        base = slug(b['text']) or 'h'
        hid = base; k = 2
        while (cur['id'], hid) in used: hid = '%s-%d' % (base, k); k += 1
        used.add((cur['id'], hid)); b['id'] = hid
    b['ch'] = cur['id']
    cur['blocks'].append(i)

# context path for each block
path = []
ctx = []
for b in blocks:
    if b['t'] == 'h' and b['lvl'] < 6:
        path = [p for p in path if p['lvl'] < b['lvl']] + [b]
    ctx.append([(p['lvl'], p['text']) for p in path])

def head_at(i, lvl):
    for l, t in ctx[i]:
        if l == lvl: return t
    return None

def section(i, stop_extra=None, include_sidebars=False):
    """blocks after heading i until next heading with lvl <= heading lvl (lvl-6 sidebars excluded)."""
    h = blocks[i]; lvl = h['lvl']; out = []
    j = i + 1; in_side = False
    while j < len(blocks):
        b = blocks[j]
        if b['t'] == 'h' and b['lvl'] <= lvl: break
        if b['t'] == 'h' and b['lvl'] == 0: break
        if b['t'] == 'h' and b['lvl'] == 6 and not include_sidebars:
            in_side = True; j += 1; continue
        if in_side and b['t'] in ('p', 'li') and b.get('style') in ('small', 'dark'):
            j += 1; continue
        in_side = False
        if b['t'] == 'quote': j += 1; continue
        out.append(j); j += 1
    return out

def lean(b):
    if b['t'] == 'ability' and b.get('aid'):
        return dict(t='ability', ref=b['aid'])
    d = {k: v for k, v in b.items() if k not in ('i', 'ch', 'label', 'pg')}
    return d

def ref(i):
    b = blocks[i]
    return dict(ch=b['ch'], pg=b['label'])

def body(idx):
    return [lean(blocks[k]) for k in idx]

def chapter_range(title):
    for c in chapters:
        if c['title'] == title: return c['blocks']
    raise KeyError(title)

E = collections.defaultdict(list)

def add(_kind, name, idx_head, items, **meta):
    e = dict(name=name, id=slug(name), src=ref(idx_head), body=items)
    e.update(meta)
    # unique ids
    ids = {x['id'] for x in E[_kind]}
    if e['id'] in ids:
        k = 2
        while '%s-%d' % (e['id'], k) in ids: k += 1
        e['id'] = '%s-%d' % (e['id'], k)
    E[_kind].append(e)
    return e

def is_h(b, lvl=None, text=None):
    return b['t'] == 'h' and (lvl is None or b['lvl'] == lvl) and (text is None or b['text'] == text)

# pre-assign ability ids
_seen = set()
for b0 in blocks:
    if b0['t'] == 'ability':
        base = slug(b0['name']); aid = base; k = 2
        while aid in _seen: aid = '%s-%d' % (base, k); k += 1
        _seen.add(aid); b0['aid'] = aid

# ---------- Conditions ----------
for i in chapter_range('Classes'):
    b = blocks[i]
    if is_h(b, 4) and head_at(i, 3) == 'Conditions':
        add('conditions', b['text'], i, body(section(i)))

# ---------- Glossary ----------
for i, b in enumerate(blocks):
    if b['t'] == 'p' and head_at(i, 1) == 'Glossary Index':
        m = re.match(r'^<b>([^<]+?):?\s*</b>\s*:?\s*(.*)$', b['html'], re.S)
        if m:
            term = m[1].strip().rstrip(':')
            d = m[2]
            pm = re.search(r'p\.\s*(\d+)\s*$', plain(d))
            g = add('glossary', term, i, [dict(t='p', style='body', html=d)], page=pm[1] if pm else None)
            if pm: g['src']['pg'] = pm[1]

# ---------- Ancestries ----------
anc_names = []
rng = chapter_range('Ancestries')
for i in rng:
    b = blocks[i]
    if is_h(b, 1):
        sec = section(i)
        # include the intro paragraph(s) that precede (same page) the title
        name = b['text']
        traits = []; sig = None; points = None
        for k in sec:
            bb = blocks[k]
            if is_h(bb, 3) and bb['text'].startswith('Signature Trait'):
                sig = bb['text'].split(':', 1)[-1].strip()
            if is_h(bb, 4):
                m = re.match(r'(.*?)\s*\((\d+) Points?\)', bb['text'])
                if m: traits.append(dict(name=m[1], cost=int(m[2])))
            if bb['t'] == 'p':
                m = re.search(r'You have (\d+) ancestry points', plain(bb.get('html', '')))
                if m: points = int(m[1])
        a = add('ancestries', name, i, body(sec), signature=sig, traits=traits, points=points)
        anc_names.append(name)

# ---------- Cultures (aspects) ----------
for i in chapter_range('Background'):
    b = blocks[i]
    if is_h(b, 4) and head_at(i, 3) in ('Environment', 'Organization', 'Upbringing') and head_at(i, 1) == 'Culture':
        sec = section(i)
        txt = ' '.join(plain(blocks[k].get('html', '')) for k in sec)
        m = re.search(r'Skill Options?:\s*(.*?)(?:\.|$)', txt)
        add('cultures', b['text'], i, body(sec), aspect=head_at(i, 3), skills=m[1] if m else '')

# ---------- Careers ----------
for i in chapter_range('Background'):
    b = blocks[i]
    if is_h(b, 3) and head_at(i, 2) == 'Careers A to Z':
        sec = section(i)
        info = {}
        for k in sec:
            t = plain(blocks[k].get('html', ''))
            for lab in ('Skills', 'Languages', 'Renown', 'Wealth', 'Project Points', 'Perk'):
                if t.startswith(lab + ':'): info[lab.lower().replace(' ', '')] = t.split(':', 1)[1].strip()
        add('careers', b['text'], i, body(sec), **info)

# ---------- Classes ----------
classes = []
for i in chapter_range('Classes'):
    b = blocks[i]
    if is_h(b, 1) and b['text'] not in ('Glossary Index',):
        sec = section(i)
        # include sidebars in class pages
        sec_full = section(i, include_sidebars=True)
        resource = None; prim = None; subclass_label = None
        for k in sec:
            t = plain(blocks[k].get('html', ''))
            m = re.match(r'(?:Heroic Resource|Primary Characteristics?):\s*(.*)', t)
            if t.startswith('Primary Characteristic'): prim = t.split(':', 1)[1].strip()
        for k in sec:
            bb = blocks[k]
            if is_h(bb, 3) and bb['text'] and head_at(k, 2) == '1st-Level Features' and resource is None:
                pass
        add('classes', b['text'], i, body(sec_full))
        classes.append(b['text'])

# class resources: from heroic ability costs
# ---------- Kits ----------
for i in chapter_range('Kits'):
    b = blocks[i]
    if is_h(b, 3) and head_at(i, 2) == 'Kits A to Z' and b['text'] != 'Kit Features':
        sec = section(i)
        bon = {}
        for k in sec:
            t = plain(blocks[k].get('html', ''))
            m = re.match(r'(Stamina Bonus|Speed Bonus|Stability Bonus|Melee Damage Bonus|Ranged Damage Bonus|Melee Distance Bonus|Ranged Distance Bonus|Disengage Bonus):\s*(.*)', t)
            if m: bon[m[1]] = m[2]
            if t.startswith('Equipment') or (head_at(k, 4) == 'Equipment' and blocks[k]['t'] == 'p'):
                bon.setdefault('Equipment', t)
        add('kits', b['text'], i, body(sec), bonuses=bon, kkind='Standard')
# Stormwight kits (fury)
for i in chapter_range('Classes'):
    b = blocks[i]
    if b['t'] == 'h' and b['lvl'] == 3 and head_at(i, 2) == 'Stormwight Kits' and b['text'] != 'Kit Features':
        add('kits', b['text'], i, body(section(i)), bonuses={}, kkind='Stormwight (Fury)')

# ---------- Perks ----------
for i in chapter_range('Perks'):
    b = blocks[i]
    if is_h(b, 3):
        t2 = head_at(i, 2) or 'Crafting Perks'
        if t2 == 'Perk Types': t2 = 'Crafting Perks'
        if b['text'] in ('Perks and Tests',): continue
        add('perks', b['text'], i, body(section(i)), type=t2.replace(' Perks', ''))

# ---------- Complications ----------
for i in chapter_range('Complications'):
    b = blocks[i]
    if is_h(b, 3) and b['text'] not in ('Benefit and Drawback', 'Modifying the Story', 'Choosing a Complication'):
        add('complications', b['text'], i, body(section(i)))

# ---------- Skills ----------
for i in chapter_range('Tests'):
    b = blocks[i]
    if b['t'] == 'table' and b['head'][:2] == ['Skill', 'Use']:
        grp = None
        # find caption heading just before
        for k in range(i - 1, i - 4, -1):
            if blocks[k]['t'] == 'h': grp = blocks[k]['text']; break
        for r in b['rows']:
            if len(r) >= 2 and plain(r[0]):
                add('skills', plain(r[0]), i, [dict(t='p', style='body', html=r[1])], group=(grp or '').replace(' Skills', ''))

# ---------- Treasures ----------
for i in chapter_range('Rewards'):
    b = blocks[i]
    if is_h(b, 4) and head_at(i, 1) == 'Treasures':
        t2 = head_at(i, 2); t3 = head_at(i, 3) or ''
        if t2 not in ('Consumables', 'Trinkets', 'Leveled Treasures', 'Artifacts'): continue
        sec = section(i)
        if not sec: continue
        ech = re.match(r'(\d)(?:st|nd|rd|th)-Echelon', t3)
        sub = ''
        m = re.match(r'Leveled (\w+) Treasures', t3)
        if m: sub = m[1]
        if t3.startswith('Other Leveled'): sub = 'Other'
        kws = ''; first = plain(blocks[sec[0]].get('html', '')) if blocks[sec[0]]['t'] == 'p' else ''
        if blocks[sec[0]]['t'] == 'p' and blocks[sec[0]].get('html', '').startswith('<b>Keywords'):
            kws = first.split(':', 1)[1].strip()
        add('treasures', b['text'], i, body(sec), type=t2.rstrip('s') if t2 != 'Leveled Treasures' else 'Leveled', echelon=int(ech[1]) if ech else None,
            sub=sub, keywords=kws)

# ---------- Titles ----------
for i in chapter_range('Rewards'):
    b = blocks[i]
    if is_h(b, 3) and head_at(i, 1) == 'Titles':
        t2 = head_at(i, 2) or ''
        m = re.match(r'(\d)(?:st|nd|rd|th)-Echelon Titles', t2)
        if not m: continue
        sec = section(i)
        pre = ''
        for k in sec:
            t = plain(blocks[k].get('html', ''))
            if t.startswith('Prerequisite'): pre = t.split(':', 1)[-1].strip(); break
        add('titles', b['text'], i, body(sec), echelon=int(m[1]), prereq=pre)

# ---------- Gods ----------
for i in chapter_range('Gods and Religion'):
    b = blocks[i]
    if is_h(b, 4) and head_at(i, 2) not in (None, 'Churches and Temples', 'Interspecies Worship', 'Evil Gods and Saints', 'Afterlife in Orden', 'Conduits and Censors'):
        sec = section(i)
        if not sec: continue
        dom = ''
        for k in sec:
            t = plain(blocks[k].get('html', ''))
            if t.startswith('Domains:'): dom = t.split(':', 1)[1].strip()
        add('gods', b['text'], i, body(sec), pantheon=head_at(i, 2), sub=head_at(i, 3) or '', domains=dom)

# ---------- Abilities ----------
ORD = r'(\d+)(?:st|nd|rd|th)-Level'
for i, b in enumerate(blocks):
    if b['t'] != 'ability': continue
    ch = [c for c in chapters if c['id'] == b['ch']][0]['title']
    h1 = head_at(i, 1); h2 = head_at(i, 2) or ''; h3 = head_at(i, 3) or ''; h4 = head_at(i, 4) or ''; h5 = head_at(i, 5) or ''
    source = ch; group = ''; level = None; sub = ''
    if ch == 'Classes' and h1 and h1 != 'Glossary Index':
        source = h1; group = 'Class'
        m = re.match(ORD, h2)
        if m: level = int(m[1])
        for h in (h5, h4, h3):
            m = re.match(ORD + r' (.+?) Abilit', h)
            if m and m[2] not in ('Order', 'Domain', 'Aspect', 'College', 'Doctrine', 'Tradition', 'Element', 'Circle', 'Class', 'Specialization', 'Subclass'):
                sub = m[2]; break
        if h2 == 'Stormwight Kits':
            group = 'Kit'; sub = h3 if h3 != 'Kit Features' else 'Stormwight'
    elif ch == 'Ancestries':
        source = h1 or 'Ancestries'; group = 'Ancestry'
    elif ch == 'Kits':
        source = h3 or 'Kits'; group = 'Kit'
    elif ch == 'Perks':
        source = h3 or 'Perks'; group = 'Perk'
    elif ch == 'Complications':
        source = h3 or 'Complications'; group = 'Complication'
    elif ch == 'Rewards':
        group = 'Title' if h1 == 'Titles' else 'Treasure'; source = (h3 if h1 == 'Titles' else h4) or h1
    elif ch in ('The Basics', 'Combat', 'Tests', 'Making a Hero'):
        group = 'Common'; source = ch
    else:
        group = 'Other'
    kind = 'Signature' if 'Signature' in (h3 + h4 + h5) else ''
    res = None; costn = None
    if b['cost']:
        m = re.match(r'(\d+)\+?\s*(.*)', b['cost'])
        if m: costn = int(m[1]); res = m[2]
        if group == 'Class': kind = 'Heroic'
    roll = next((plain(r['html']) for r in b['rows'] if r['k'] == 'roll'), '')
    chars = re.findall(r'Might|Agility|Reason|Intuition|Presence', roll)
    ab = add('abilities', b['name'], i, None, cost=b['cost'], costN=costn, resource=res, flavor=b['flavor'], keywords=b['keywords'], action=b['action'],
             distance=b['distance'], target=b['target'], rows=b['rows'], source=source, group=group, level=level, sub=sub, kind=kind or ('Signature' if group == 'Kit' else ''),
             chars=sorted(set(chars)))
    ab.pop('body')
    ab['id'] = b['aid']

# class resource names
cres = collections.Counter()
for a in E['abilities']:
    if a['group'] == 'Class' and a['resource']: cres[(a['source'], a['resource'])] += 1
CR = {}
for (c, r), n in cres.most_common():
    CR.setdefault(c, r)
for c in E['classes']:
    c['resource'] = CR.get(c['name'])
    # basics
    for blk in c['body']:
        t = plain(blk.get('html', ''))
        if t.startswith('Primary Characteristic'): c['primary'] = t.split(':', 1)[1].strip()
        m = re.match(r'Starting Stamina at 1st Level:\s*(.*)', t)
        if m: c['stamina'] = m[1]
    c['abilityCount'] = sum(1 for a in E['abilities'] if a['source'] == c['name'])

# ---------- Book ----------
book = []
for c in chapters:
    bl = []
    for i in c['blocks']:
        b = blocks[i]
        d = lean(b); d['pg'] = b['label']
        if b['t'] == 'ability': d = dict(t='ability', ref=b['aid'], pg=b['label'])
        bl.append(d)
    book.append(dict(id=c['id'], title=c['title'], blocks=bl))

CHFIX = re.compile(r'\b([MARIP]) (ight|gility|eason|ntuition|resence)\b')
def fixall(o):
    if isinstance(o, str): return CHFIX.sub(r'\1\2', o)
    if isinstance(o, list): return [fixall(x) for x in o]
    if isinstance(o, dict): return {k: fixall(v) for k, v in o.items()}
    return o
E = fixall(dict(E)); book = fixall(book)
# compact ability storage in book: abilities referenced by id
data = dict(book=book, **E)
s = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
open(OUT, 'w').write(s)
print({k: len(v) for k, v in E.items()}, 'bytes', len(s), file=sys.stderr)
