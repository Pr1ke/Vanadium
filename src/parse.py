"""Parse pdftohtml -xml output of Draw Steel Heroes into a block stream (JSON)."""
import re, sys, json, html

SRC = sys.argv[1]
OUT = sys.argv[2]
x = open(SRC, encoding='utf-8').read()

fonts = {}
for m in re.finditer(r'<fontspec id="(\d+)" size="(\d+)" family="[^+]+\+([^"]+)" color="([^"]+)"', x):
    fonts[int(m[1])] = dict(size=int(m[2]), fam=m[3], color=m[4])

def white(f):
    c = fonts[f]['color'].lower()
    return c in ('#fffef6', '#ffffff', '#f2f3ea')

SKIP_FONTS = {0, 1, 2, 3, 10, 17}
for _f, _s in fonts.items():
    if _s['color'] in ('#6d6e71',) or (_s['fam'] == 'Newzald-Black' and _s['size'] == 14 and _s['color'] == '#fffef6'): SKIP_FONTS.add(_f)
HEAD = {}  # font -> level
for f, s in fonts.items():
    fam, sz = s['fam'], s['size']
    if fam == 'MCDM-Book' and sz >= 80: HEAD[f] = 0
    elif fam == 'MCDM-Book' and sz == 36: HEAD[f] = 1
    elif fam.startswith('Newzald-Black') and sz == 24: HEAD[f] = 2
    elif fam == 'Newzald' and sz in (21, 24): HEAD[f] = 3
    elif fam.startswith('Newzald-Black') and sz == 17: HEAD[f] = 4
    elif fam == 'Newzald' and sz in (15, 17, 18): HEAD[f] = 5
    elif fam == 'Newzald' and sz == 14: HEAD[f] = 6
    elif fam.startswith('Newzald-Black') and sz in (14, 21): HEAD[f] = 6
QUOTE = {f for f, s in fonts.items() if s['fam'].startswith('Newzald-Black') and s['size'] == 24 and white(f)}
for f in QUOTE: HEAD.pop(f, None)
TABLEHEAD = {f for f, s in fonts.items() if s['fam'].startswith('Newzald') and s['size'] in (10, 11)}
SMALL = {f for f, s in fonts.items() if s['fam'].startswith('BerlingskeSlab') and s['size'] <= 9}
GLYPH = {f for f, s in fonts.items() if s['fam'] == 'DrawSteelGlyphs'}
POT = {f for f, s in fonts.items() if s['fam'] == 'DrawSteelPotencies'}
TIER = {f for f, s in fonts.items() if s['fam'] == 'MCDM-Book' and s['size'] == 18}

ACTIONS = ['Free triggered action', 'Free Triggered action', 'Free Triggered', 'Triggered action', 'Triggered', 'Free maneuver', 'Main action', 'Maneuver',
           'No action', 'Move action', 'Free main action']

ACTL = sorted({a.lower() for a in ACTIONS}, key=len, reverse=True)
def CANON(a):
    a = a.lower()
    if a in ('triggered', 'triggered action'): return 'Triggered action'
    if a.startswith('free triggered'): return 'Free triggered action'
    return a[0].upper() + a[1:]

def pot(t):
    t = html.unescape(t).strip()
    m = re.fullmatch(r'([marip])<([wvs])', t, re.I)
    if m:
        return '<span class="pot">%s&lt;%s</span>' % (m[1].upper(), {'w': 'WEAK', 'v': 'AVERAGE', 's': 'STRONG'}[m[2].lower()])
    m = re.fullmatch(r'([marip])<(\d)\]*', t, re.I)
    if m:
        return '<span class="pot">%s&lt;%s</span>' % (m[1].upper(), m[2])
    if re.fullmatch(r'[MARIP]', t):
        return '<span class="chr">%s</span>' % t
    return html.escape(t)

def clean_inner(s):
    # keep b/i, convert links
    s = re.sub(r'<a href="book\.html#(\d+)">', lambda m: '<a data-pg="%s">' % m[1], s)
    s = re.sub(r'<a href="[^"]*">', '<a>', s)
    return s

pages = re.split(r'<page number="', x)[1:]
items = []
for p in pages:
    pn = int(p.split('"', 1)[0])
    label = None
    for m in re.finditer(r'<text top="(-?\d+)" left="(-?\d+)" width="(\d+)" height="(\d+)" font="(\d+)">(.*?)</text>', p, re.S):
        top, left, w, h, f, t = int(m[1]), int(m[2]), int(m[3]), int(m[4]), int(m[5]), m[6]
        if f == 3:
            label = re.sub('<.*?>', '', t).strip()
        if f in SKIP_FONTS: continue
        if left > 860 or top > 1120: continue
        items.append(dict(pg=pn, top=top, left=left, w=w, h=h, f=f, t=clean_inner(t)))
    # attach label
    for it in items:
        if it['pg'] == pn: it['label'] = label

print('items', len(items), file=sys.stderr)

def plain(t):
    return html.unescape(re.sub('<.*?>', '', t))

# ---- group into lines ----
lines = []
for it in items:
    if lines:
        L = lines[-1]
        last = L['items'][-1]
        if it['pg'] == L['pg'] and abs(it['top'] - last['top']) <= 5 and it['left'] >= last['left'] + last['w'] - 4 \
                and it['left'] - (last['left'] + last['w']) < 300 \
                and not (last['f'] in HEAD and HEAD[last['f']] == 1 and len(plain(last['t']).strip()) == 1) \
                and ((it['f'] in HEAD) == (last['f'] in HEAD) or last['f'] in GLYPH or it['f'] in GLYPH or it['f'] in POT or last['f'] in POT or it['f'] in TIER or last['f'] in TIER):
            L['items'].append(it)
            continue
    lines.append(dict(pg=it['pg'], label=it.get('label'), top=it['top'], left=it['left'], items=[it]))

def line_font(L):
    for it in L['items']:
        if plain(it['t']).strip() and it['f'] not in GLYPH and it['f'] not in POT:
            return it['f']
    return L['items'][0]['f']

def render_items(its):
    out = ''
    for it in its:
        f, t = it['f'], it['t']
        if f in POT:
            out += pot(re.sub('<.*?>', '', t))
        elif f in GLYPH:
            g = plain(t).strip()
            if g == '¥': continue
            out += {'e': '', 'x': '', 'N': '', 't': '', 'v': ''}.get(g, '')
        elif f in TIER:
            out += ''
        elif fonts[f]['fam'].endswith('-DBd') and '<b>' not in t:
            out += '<b>' + t + '</b>'
        else:
            out += t
    return out

for L in lines:
    L['f'] = line_font(L)
    L['text'] = plain(''.join(i['t'] for i in L['items'] if i['f'] not in GLYPH and i['f'] not in POT and i['f'] not in TIER)).strip()
    L['right'] = max(i['left'] + i['w'] for i in L['items'])

def colbase(left):
    return 72 if left < 440 else 456

# ---- blocks ----
blocks = []
def emit(b):
    blocks.append(b)

def norm_html(h):
    h = re.sub(r'(</span>)\s+([,;.])', r'\1\2', h)
    h = re.sub(r'</b>\s*<b>', ' ', h)
    h = re.sub(r'</i>\s*<i>', ' ', h)
    h = re.sub(r'\s+', ' ', h).strip()
    h = h.replace('<b></b>', '').replace('<i></i>', '')
    return h

def join(a, b):
    a = a.rstrip()
    pa = re.sub('<[^>]*>$', '', a)
    if re.search(r'[a-z]-$', re.sub(r'(<[^>]*>)+$', '', a)) and re.match(r'(<[^>]*>)*[a-z]', b.lstrip()):
        # dehyphenate
        m = re.search(r'-((<[^>]*>)*)$', a)
        return a[:m.start()] + m.group(1) + b.lstrip()
    if re.search(r'[—–/]$', re.sub(r'(<[^>]*>)+$', '', a)):
        return a + b.lstrip()
    return a + ' ' + b.lstrip()

TIERMAP = {'á': 1, 'é': 2, 'í': 3}

i = 0
N = len(lines)
cur = None  # current paragraph block

def flush():
    global cur
    if cur:
        cur['html'] = norm_html(cur['html'])
        if cur['html']:
            emit(cur)
    cur = None

def is_action_line(L):
    last = plain(L['items'][-1]['t']).strip().lower()
    return (len(L['items']) >= 2 and last in ACTL) or (L['f'] in (5, 39) and any(L['text'].lower().endswith(a) for a in ACTL))

def parse_ability(i):
    """lines[i] is the name line. Returns (block, next_i) or (None, i)."""
    L = lines[i]
    j = i + 1
    flavor = ''
    while j < N and j < i + 6 and lines[j]['f'] in (9, 13, 22) and not is_action_line(lines[j]):
        flavor = join(flavor, render_items(lines[j]['items'])) if flavor else render_items(lines[j]['items'])
        j += 1
    if j >= N or not is_action_line(lines[j]):
        return None, i
    K = lines[j]
    kw_items = K['items']
    action = ''
    kws = ''
    txt = [plain(it['t']).strip() for it in kw_items]
    full = ' '.join(t for t in txt if t)
    for a in ACTL:
        if full.lower().endswith(a):
            action = CANON(a)
            kws = full[:len(full) - len(a)].strip().rstrip(',').strip()
            break
    if kws in ('-', '—', '–'): kws = ''
    name = norm_html(render_items(L['items']))
    pname = plain(name).strip()
    cost = None
    m = re.match(r'(.*?)\s*\(([^)]*)\)\s*$', pname)
    if m and re.search(r'\d', m[2]):
        pname, cost = m[1].strip(), m[2].strip()
    ab = dict(t='ability', name=pname, cost=cost, flavor=norm_html(flavor), keywords=[k.strip() for k in kws.split(',') if k.strip()],
              action=action, distance='', target='', rows=[], pg=L['pg'], label=L['label'])
    base = L['left']
    j += 1
    # distance/target
    if j < N and any(it['f'] in GLYPH and plain(it['t']).strip() in ('e', 'x') for it in lines[j]['items']):
        D = lines[j]
        part = None; d = ''; tg = ''
        for it in D['items']:
            g = plain(it['t']).strip()
            if it['f'] in GLYPH and g == 'e': part = 'd'; continue
            if it['f'] in GLYPH and g == 'x': part = 't'; continue
            if part == 'd': d += render_items([it])
            elif part == 't': tg += render_items([it])
        ab['distance'] = norm_html(d); ab['target'] = norm_html(tg)
        j += 1
        # wrapped distance/target continuation lines
        while j < N and lines[j]['pg'] == D['pg'] and 0 < lines[j]['top'] - D['top'] < 22 and lines[j]['f'] == 6 and not re.match(r'(Power Roll|Effect|Trigger|Special)', lines[j]['text']):
            if lines[j]['left'] > base + 150:
                ab['target'] = norm_html(join(ab['target'], render_items(lines[j]['items'])))
            else:
                ab['distance'] = norm_html(join(ab['distance'], render_items(lines[j]['items'])))
            D = lines[j]; j += 1
    rows = ab['rows']
    prev = None
    while j < N:
        M = lines[j]
        if M['f'] in HEAD or M['f'] in TABLEHEAD: break
        if M['left'] < base - 2 and not any(it['f'] in TIER for it in M['items']): break
        if M['left'] < colbase(base) + 8: break
        tier = None
        for it in M['items']:
            if it['f'] in TIER:
                g = plain(it['t']).strip()
                tier = TIERMAP.get(g)
                break
        content = norm_html(render_items(M['items']))
        txt = M['text']
        if tier:
            r = dict(k='tier', n=tier, html=content); rows.append(r); prev = r
        elif re.match(r'^Power Roll', txt):
            r = dict(k='roll', html=content); rows.append(r); prev = r
        elif re.match(r'^[A-Z][^:]{0,40}:', txt) and M['items'][0]['f'] in (5, 39, 53, 55) and (M['left'] <= base + 4):
            r = dict(k='field', html=content); rows.append(r); prev = r
        elif prev is not None and M['pg'] == lines[j - 1]['pg'] and M['top'] - lines[j - 1]['top'] > 22 and M['left'] <= base + 4:
            r = dict(k='field', html=content); rows.append(r); prev = r
        elif prev is not None:
            prev['html'] = norm_html(join(prev['html'], content))
        else:
            r = dict(k='field', html=content); rows.append(r); prev = r
        j += 1
    # tidy roll rows
    for r in rows:
        if r['k'] == 'roll':
            r['html'] = re.sub(r'\s*:\s*$', '', r['html']).replace(' :', ':')
    return ab, j

table = None
def flush_table():
    global table
    if table:
        # normalise
        rows = []
        for r in table['rows']:
            cells = [norm_html(c) for c in r]
            if any(cells): rows.append(cells)
        table['rows'] = rows
        emit(table)
    table = None

while i < N:
    L = lines[i]
    f = L['f']
    text = L['text']
    if not text and not any(it['f'] in GLYPH and plain(it['t']).strip() == '¥' for it in L['items']):
        i += 1; continue
    # chapter title
    if f in HEAD and HEAD[f] == 0:
        flush(); flush_table()
        # merge consecutive chapter-title lines
        t = text; j = i + 1
        while j < N and lines[j]['f'] == f and lines[j]['pg'] == L['pg']:
            t += ' ' + lines[j]['text']; j += 1
        emit(dict(t='h', lvl=0, text=re.sub(r'\s+', ' ', t).strip(), pg=L['pg'], label=L['label']))
        i = j; continue
    # ability
    if f in HEAD and HEAD[f] == 5:
        ab, j = parse_ability(i)
        if ab:
            flush(); flush_table(); emit(ab); i = j; continue
    # table
    if f in TABLEHEAD:
        # start or continue table header
        if table is None or table.get('bodyStarted'):
            flush(); flush_table()
            table = dict(t='table', cols=[], rows=[], head=[], pg=L['pg'], label=L['label'], small=True)
            table['top'] = L['top']
        for it in L['items']:
            pt = plain(it['t']).strip()
            if not pt: continue
            hit = None
            for ci, c in enumerate(table['cols']):
                if abs(c - it['left']) <= 10: hit = ci
            if hit is not None and L['top'] != table.get('_lastTop'):
                table['head'][hit] += ' ' + it['t']
            else:
                table['cols'].append(it['left'])
                table['head'].append(it['t'])
        table['_lastTop'] = L['top']
        i += 1; continue
    if table is not None and (f in SMALL or f in POT or f in GLYPH or f in TIER) and f not in HEAD and L['pg'] == table['pg'] and L['left'] >= min(table['cols']) - 12 and L['left'] < max(table['cols']) + 330:
        table['bodyStarted'] = True
        cols = sorted(set(table['cols']))
        table['colsSorted'] = cols
        def colof(left):
            k = 0
            for ci, c in enumerate(cols):
                if left >= c - 8: k = ci
            return k
        for it in L['items']:
            if not plain(it['t']).strip() and it['f'] not in POT: continue
            ci = colof(it['left'])
            if not table['rows']:
                table['rows'].append([''] * len(cols)); table['_rowcol'] = -1
            row = table['rows'][-1]
            # new row condition
            if ci == 0 and table.get('_rowcol', -1) > 0:
                table['rows'].append([''] * len(cols)); row = table['rows'][-1]
            elif ci == 0 and row[0] and table.get('_rowcol') == 0 and it['top'] - table.get('_lastTop', 0) > 3 and len(cols) > 1 and not row[1]:
                # vertically stacked col0 lines — continuation
                pass
            seg = render_items([it])
            row[ci] = join(row[ci], seg) if row[ci] and it['top'] != table.get('_lastTop') else (row[ci] + seg)
            table['_rowcol'] = ci
            table['_lastTop'] = it['top']
        i += 1; continue
    elif table is not None:
        flush_table()

    if f in QUOTE and not re.match(r'^\s*[“"]', text):
        flush()
        t = text; j = i + 1
        while j < N and lines[j]['f'] == f and lines[j]['pg'] == L['pg']:
            t += ' ' + lines[j]['text']; j += 1
        emit(dict(t='h', lvl=2, text=re.sub(r'\s+', ' ', t).strip(), dark=True, pg=L['pg'], label=L['label']))
        i = j; continue
    if f in QUOTE:
        flush()
        t = text; j = i + 1
        while j < N and lines[j]['f'] == f and lines[j]['pg'] == L['pg']:
            t += ' ' + lines[j]['text']; j += 1
        attr = ''
        if j < N and lines[j]['f'] in HEAD and white(lines[j]['f']) and lines[j]['pg'] == L['pg']:
            attr = lines[j]['text']; j += 1
        emit(dict(t='quote', text=re.sub(r'\s+', ' ', t).strip(), attr=attr, pg=L['pg'], label=L['label']))
        i = j; continue
    if f in HEAD:
        flush()
        lvl = HEAD[f]
        t = norm_html(render_items(L['items']))
        j = i + 1
        # multi-line heading
        while j < N and lines[j]['f'] == f and lines[j]['pg'] == L['pg'] and 0 < lines[j]['top'] - lines[j - 1]['top'] < fonts[f]['size'] * 2.2:
            t = norm_html(t + ' ' + render_items(lines[j]['items'])); j += 1
        dark = white(f)
        # drop cap handling: single letter heading of lvl 1
        if lvl == 1 and len(plain(t).strip()) == 1:
            if j < N:
                lines[j]['dropcap'] = plain(t).strip()
            i = j; continue
        emit(dict(t='h', lvl=lvl, text=plain(t).strip(), dark=dark, pg=L['pg'], label=L['label']))
        i = j; continue

    style = 'dark' if white(f) else ('small' if f in SMALL else 'body')
    is_bullet = any(it['f'] in GLYPH and plain(it['t']).strip() == '¥' for it in L['items'])
    h = render_items(L['items'])
    if L.get('dropcap'):
        h = L['dropcap'] + h.lstrip()
    starts_label = bool(re.match(r'^(<b>)?[A-Z][\w’\'\- ,()/]{0,40}:(</b>)?', h.strip())) and L['items'][0]['f'] in (5, 39, 53, 55, 51, 65)
    new = False
    if cur is None or is_bullet or cur['style'] != style or starts_label:
        new = True
    else:
        prev = lines[i - 1]
        base = colbase(L['left'])
        if prev['pg'] == L['pg'] and L['top'] > prev['top']:
            gap = L['top'] - prev['top']
            lh = 17 if style != 'small' else 13
            if gap > lh * 1.45: new = True
            elif L['left'] - prev['left'] > 10 and cur['t'] != 'li' and not (cur.get('_lab') and L['left'] - cur['_left'] < 22): new = True  # first-line indent
        else:
            # column / page break: continue if not indented
            if L['left'] - base > 10 and cur['t'] != 'li' and not cur.get('_lab'): new = True
        if cur['t'] == 'li' and L['left'] < cur.get('_left', 0) - 6:
            new = True
    if new:
        flush()
        cur = dict(t='li' if is_bullet else 'p', style=style, html=h.strip(), pg=L['pg'], label=L['label'], _left=L['left'], _lab=starts_label)
        if is_bullet:
            # left of text after bullet
            tx = [it for it in L['items'] if not (it['f'] in GLYPH)]
            cur['_left'] = min((it['left'] for it in tx if plain(it['t']).strip()), default=L['left'])
    else:
        cur['html'] = join(cur['html'], h)
    i += 1
flush(); flush_table()

# move chapter titles & big name titles to start of their page
k = 0
while k < len(blocks):
    b = blocks[k]
    if b['t'] == 'h' and (b['lvl'] == 0 or (b['lvl'] == 1 and b['text'].isupper())):
        s0 = k
        while s0 > 0 and blocks[s0 - 1]['pg'] == b['pg'] and not (blocks[s0-1]['t']=='h' and blocks[s0-1]['lvl']<=b['lvl']):
            s0 -= 1
        if s0 < k:
            blocks.insert(s0, blocks.pop(k))
    k += 1
for b in blocks:
    b.pop('_left', None); b.pop('_lab', None)
    for k in list(b):
        if k.startswith('_') or k in ('cols', 'colsSorted', 'bodyStarted', 'top'): b.pop(k, None)

json.dump(blocks, open(OUT, 'w'), ensure_ascii=False)
print('blocks', len(blocks), 'abilities', sum(1 for b in blocks if b['t'] == 'ability'), 'tables', sum(1 for b in blocks if b['t'] == 'table'), file=sys.stderr)
