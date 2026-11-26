"""Build the 5e (SRD 5.2) data for Vanadium from the pinned 5e-database files in srd/.

  python src/systems/srd5/mkdata.py      (run by npm run build, before mksite.py)

Writes site/data/srd5.json (rules: spells, magic items, classes, species, backgrounds, feats,
conditions, equipment, and a reference "rulebook" assembled from the data) and
site/data/srd5-monsters.json (the monsters as a book: one chapter per letter).
Entry bodies use Vanadium's block format ({t:'p'|'li'|'h'|'table', ...}) so the core book reader
and entry pages render them. Output is deterministic (sorted, no timestamps).
"""
import html, json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
SRC = os.path.join(HERE, 'srd')
OUT = os.path.join(ROOT, 'site', 'data')


def ld(name):
    return json.load(open(os.path.join(SRC, f'5e-SRD-{name}.json'), encoding='utf-8'))


# ---------- text ----------
def clean(t):
    t = (t or '').replace('\r', '')
    return re.sub(r'(?<=[a-z])- (?=[a-z])', '', t)   # words split across PDF lines: "ex- pended" -> "expended"


def inline(s):
    s = html.escape(clean(s), quote=False)
    s = re.sub(r'\*\*\*(.+?)\*\*\*', r'<b><i>\1</i></b>', s)
    s = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', s)
    s = re.sub(r'(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])', r'<i>\1</i>', s)
    s = re.sub(r'(?<![\w_])_(?!\s)(.+?)(?<!\s)_(?![\w_])', r'<i>\1</i>', s)
    s = s.replace('**', '')   # unmatched markers in the source (e.g. Unconscious)
    return re.sub(r'\s+', ' ', s).strip()


def plain(s):
    return re.sub(r'<[^>]+>', '', inline(s)).replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')


def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', str(s).lower().replace("'", '').replace('’', '')).strip('-') or 'x'


def P(h, small=False): return {'t': 'p', 'style': 'small' if small else 'body', 'html': h}
def H(text, lvl=2): return {'t': 'h', 'lvl': lvl, 'text': text, 'id': slug(text)}
def T(head, rows): return {'t': 'table', 'head': head, 'rows': rows}


def md_blocks(text):
    """the data's light markdown (paragraph lines, **bold**, - lists, | tables |) -> blocks"""
    out, lines, i = [], [l.strip() for l in clean(text).split('\n')], 0
    while i < len(lines):
        l = lines[i]
        if not l: i += 1; continue
        if l.startswith('|'):
            rows = []
            while i < len(lines) and lines[i].startswith('|'):
                cells = [c.strip() for c in lines[i].strip('|').split('|')]
                if not all(re.fullmatch(r':?-{2,}:?', c) for c in cells if c): rows.append(cells)
                i += 1
            if rows: out.append(T([plain(c) for c in rows[0]], [[inline(c) for c in r] for r in rows[1:]]))
            continue
        m = re.match(r'^(#{1,6})\s+(.*)', l)
        if m: out.append(H(plain(m.group(2)), min(6, len(m.group(1)) + 2))); i += 1; continue
        if re.match(r'^[-*•]\s+', l): out.append({'t': 'li', 'html': inline(re.sub(r'^[-*•]\s+', '', l))}); i += 1; continue
        out.append(P(inline(l))); i += 1
    return out


def names(xs, key='name'): return ', '.join(x[key] for x in xs or [])
def strip_prefix(n): return re.sub(r'^(Skill|Saving Throw|Tool):\s*', '', n)


# ---------- spells ----------
def spells():
    out = []
    for s in ld('Spells'):
        body = md_blocks(s['description'])
        if s.get('higher_level'):
            hl = md_blocks(s['higher_level'])
            label = 'Cantrip Upgrade.' if s['level'] == 0 else 'Using a Higher-Level Spell Slot.'
            if hl and hl[0]['t'] == 'p' and not hl[0]['html'].startswith('<b>'): hl[0]['html'] = f'<b><i>{label}</i></b> ' + hl[0]['html']
            body += hl
        rng, comp_list = s['range'], s.get('components') or []
        m = re.match(r'^(.*?)\s+Components?:\s*(.*)$', rng)   # source bug in 9 spells: "Touch Component: V, S", components empty
        if m and not comp_list: rng, comp_list = m.group(1), [c.strip() for c in m.group(2).split(',') if c.strip()]
        comps = ', '.join(comp_list) + (f" ({s['material']})" if s.get('material') else '')
        out.append({'id': s['index'], 'name': s['name'], 'level': s['level'], 'school': s['school']['name'],
                    'classes': [c['name'] for c in s.get('classes', [])], 'time': s['casting_time'], 'range': rng,
                    'components': comps, 'duration': ('Concentration, up to ' + s['duration'][0].lower() + s['duration'][1:]) if s.get('concentration') and not s['duration'].lower().startswith('concentration') else s['duration'],
                    'conc': bool(s.get('concentration')), 'ritual': bool(s.get('ritual')), 'body': body})
    return sorted(out, key=lambda x: x['name'])


# ---------- magic items ----------
ITEM_TYPES = r'(Armor|Weapon|Wondrous Item|Potion|Ring|Rod|Scroll|Staff|Wand|Ammunition)'
def magic_items():
    out = []
    for m in ld('Magic-Items'):
        desc = clean(m.get('desc', '')); first, _, rest = desc.partition('\n')
        sub = ''
        if re.match(ITEM_TYPES, first.strip()): sub, desc = first.strip(), rest
        out.append({'id': m['index'], 'name': m['name'], 'type': m['equipment_category']['name'], 'rarity': m['rarity']['name'],
                    'attune': bool(m.get('attunement')), 'sub': inline(sub), 'variant': bool(m.get('variant')), 'body': md_blocks(desc)})
    return sorted(out, key=lambda x: x['name'])


# ---------- classes ----------
def class_cols(levels):
    """extra Class Features table columns from class_specific / spellcasting values"""
    def flat(l):
        row = {}
        for k, v in (l.get('class_specific') or {}).items():
            if isinstance(v, dict) and 'dice_count' in v: v = f"{v['dice_count']}d{v['dice_value']}"
            elif isinstance(v, (dict, list)): continue
            row[k] = v
        for k, v in (l.get('spellcasting') or {}).items():
            row['sc_' + k] = v
        return row
    rows = [flat(l) for l in levels]
    keys = []
    for r in rows:
        for k in r:
            if k not in keys and any(x.get(k) not in (None, 0, False, '') for x in rows): keys.append(k)
    def label(k):
        m = re.match(r'sc_spell_slots_level_(\d)', k)
        if m: return ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'][int(m.group(1))]
        return k.replace('sc_', '').replace('_', ' ').title().replace('Known', 'Known').replace('Cantrips Known', 'Cantrips')
    return keys, [label(k) for k in keys], rows


def classes():
    feats = ld('Features'); levels = ld('Levels'); subs = ld('Subclasses')
    out = []
    for c in ld('Classes'):
        lv = sorted([l for l in levels if l['class']['index'] == c['index'] and not l.get('subclass')], key=lambda l: l['level'])
        keys, labels, rows = class_cols(lv)
        fby = {f['index']: f for f in feats}
        saves = [p['name'].replace('Saving Throw: ', '') for p in c.get('saving_throws', [])] if c.get('saving_throws') and 'name' in c['saving_throws'][0] else []
        body = [P(f"<b>Primary Ability:</b> {html.escape(c.get('primary_ability', {}).get('desc', ''))} · <b>Hit Point Die:</b> d{c['hit_die']} per {c['name']} level"
                  + (f" · <b>Saving Throws:</b> {', '.join(saves)}" if saves else ''))]
        for pc in c.get('proficiency_choices', []):
            if pc.get('desc'): body.append(P('<b>Skill Proficiencies:</b> ' + inline(pc['desc'])))
        profs = [strip_prefix(p['name']) for p in c.get('proficiencies', []) if not p['name'].startswith('Saving Throw')]
        if profs: body.append(P('<b>Proficiencies:</b> ' + html.escape(', '.join(profs))))
        body.append(H(f"{c['name']} Features"))
        body.append(T(['Level', 'Proficiency Bonus', 'Class Features'] + labels,
                      [[str(l['level']), f"+{l['prof_bonus']}", html.escape(', '.join(f['name'] for f in l.get('features', [])) or '—')]
                       + ['—' if k.startswith('sc_spell_slots') and not r.get(k) else html.escape(str(r.get(k, '—'))) for k in keys] for l, r in zip(lv, rows)]))
        for l in lv:
            for fr in l.get('features', []):
                f = fby.get(fr['index'])
                if not f: continue
                body.append(H(f"Level {l['level']}: {f['name']}", 3)); body += md_blocks(f.get('description', ''))
        for s in [s for s in subs if s['class']['index'] == c['index']]:
            body.append(H(f"Subclass: {s['name']}"))
            if s.get('summary'): body.append(P(f"<i>{inline(s['summary'])}</i>"))
            body += md_blocks(s.get('description', ''))
            for f in sorted(s.get('features', []), key=lambda f: f.get('level', 0)):
                body.append(H(f"Level {f.get('level', '?')}: {f['name']}", 3)); body += md_blocks(f.get('description', ''))
        out.append({'id': c['index'], 'name': c['name'], 'hitDie': c['hit_die'], 'primary': c.get('primary_ability', {}).get('desc', ''),
                    'subclasses': [s['name'] for s in subs if s['class']['index'] == c['index']], 'body': body})
    return sorted(out, key=lambda x: x['name'])


# ---------- species, backgrounds, feats, conditions, equipment ----------
def species():
    traits = ld('Traits'); subsp = {s['index']: s for s in ld('Subspecies')}
    out = []
    for s in ld('Species'):
        body = [P(f"<b>Creature Type:</b> {html.escape(s.get('type', ''))} · <b>Size:</b> {html.escape(str(s.get('size', '')))} · <b>Speed:</b> {s.get('speed', '')} feet")]
        for t in [t for t in traits if any(x['index'] == s['index'] for x in t.get('species', []))]:
            body.append(H(t['name'], 3)); body += md_blocks(t.get('description', ''))
        if s.get('subspecies'):
            body.append(H('Options', 3))
            for ss in s['subspecies']:
                x = subsp.get(ss['index'], {})
                body.append({'t': 'li', 'html': f"<b>{html.escape(ss['name'])}</b>" + (f" — {html.escape(x['damage_type']['name'])} damage" if x.get('damage_type') else '')})
        out.append({'id': s['index'], 'name': s['name'], 'size': str(s.get('size', '')), 'speed': s.get('speed', ''), 'body': body})
    return sorted(out, key=lambda x: x['name'])


def backgrounds():
    out = []
    for b in ld('Backgrounds'):
        skills = [strip_prefix(p['name']) for p in b.get('proficiencies', []) if p['name'].startswith('Skill')]
        tools = [strip_prefix(p['name']) for p in b.get('proficiencies', []) if not p['name'].startswith('Skill')]
        feat = b.get('feat') or {}
        body = [P('<b>Ability Scores:</b> ' + html.escape(', '.join(a['name'] for a in b.get('ability_scores', [])))),
                P('<b>Feat:</b> ' + html.escape(feat.get('name', '—') + (f" ({feat['note']})" if feat.get('note') else ''))),
                P('<b>Skill Proficiencies:</b> ' + html.escape(', '.join(skills) or '—'))]
        if tools: body.append(P('<b>Tool Proficiency:</b> ' + html.escape(', '.join(tools))))
        for eo in b.get('equipment_options', []):
            if eo.get('desc'): body.append(P('<b>Equipment:</b> ' + inline(eo['desc'])))
        out.append({'id': b['index'], 'name': b['name'], 'feat': feat.get('name', ''), 'skills': skills, 'body': body})
    return sorted(out, key=lambda x: x['name'])


FEAT_TYPES = {'origin': 'Origin', 'general': 'General', 'fighting-style': 'Fighting Style', 'epic-boon': 'Epic Boon'}
def feats():
    return sorted([{'id': f['index'], 'name': f['name'], 'type': FEAT_TYPES.get(f.get('type'), str(f.get('type', '')).replace('-', ' ').title()),
                    'body': md_blocks(f.get('description', ''))} for f in ld('Feats')], key=lambda x: x['name'])


def conditions():
    return sorted([{'id': c['index'], 'name': c['name'], 'body': md_blocks(c.get('description', ''))} for c in ld('Conditions')], key=lambda x: x['name'])


def cost(c): return f"{c['quantity']} {c['unit']}" if isinstance(c, dict) else ''
def equipment():
    out = []
    for e in ld('Equipment'):
        cat = e['equipment_categories'][0]['name'] if e.get('equipment_categories') else 'Other'
        body = []
        if e.get('damage'): body.append(P(f"<b>Damage:</b> {e['damage']['damage_dice']} {e['damage']['damage_type']['name']}"
                                           + (f" (versatile {e['two_handed_damage']['damage_dice']})" if e.get('two_handed_damage') else '')))
        if e.get('range') and e['range'].get('long'): body.append(P(f"<b>Range:</b> {e['range']['normal']}/{e['range']['long']} feet"))
        if e.get('properties'): body.append(P('<b>Properties:</b> ' + html.escape(names(e['properties']))))
        if e.get('mastery'): body.append(P('<b>Mastery:</b> ' + html.escape(e['mastery']['name'])))
        if e.get('armor_class'):
            ac = e['armor_class']; body.append(P(f"<b>Armor Class:</b> {ac['base']}" + (' + Dex modifier' + (f" (max {ac['max_bonus']})" if ac.get('max_bonus') else '') if ac.get('dex_bonus') else '')
                                                 + (f" · <b>Strength:</b> {e['str_minimum']}" if e.get('str_minimum') else '') + (' · Disadvantage on Stealth' if e.get('stealth_disadvantage') else '')))
        desc = e.get('description') or e.get('desc')
        if isinstance(desc, list): desc = '\n'.join(desc)
        body += md_blocks(desc or '')
        out.append({'id': e['index'], 'name': e['name'], 'category': cat, 'cost': cost(e.get('cost')), 'weight': e.get('weight', ''), 'body': body})
    return sorted(out, key=lambda x: x['name'])


# ---------- the reference "rulebook" (core pack) ----------
ATTRIB = ('This work includes material from the System Reference Document 5.2 (“SRD 5.2”) by Wizards of the Coast LLC, available at '
          '<a href="https://www.dndbeyond.com/srd" target="_blank" rel="noopener">https://www.dndbeyond.com/srd</a>. The SRD 5.2 is licensed under the Creative Commons '
          'Attribution 4.0 International License, available at <a href="https://creativecommons.org/licenses/by/4.0/legalcode" target="_blank" rel="noopener">https://creativecommons.org/licenses/by/4.0/legalcode</a>.')
def book(eq):
    ch = lambda cid, title, blocks: {'id': cid, 'title': title, 'blocks': blocks}   # the book reader prints the chapter title itself
    abil, skills = ld('Ability-Scores'), ld('Skills')
    a_blocks = []
    for a in abil:
        a_blocks.append(H(a['full_name'])); a_blocks.append(P(html.escape(a.get('description', '')) + '.'))
        for s in [s for s in skills if s['ability_score']['index'] == a['index']]:
            a_blocks.append({'t': 'li', 'html': f"<b>{html.escape(s['name'])}.</b> {inline(s.get('description', ''))}"})
    c_blocks = []
    for c in sorted(ld('Conditions'), key=lambda c: c['name']): c_blocks.append(H(c['name'])); c_blocks += md_blocks(c.get('description', ''))
    w_blocks = [H('Weapon Properties')]
    for p in ld('Weapon-Properties'): w_blocks.append(P(f"<b>{html.escape(p['name'])}.</b> {inline(p.get('description', ''))}"))
    w_blocks.append(H('Mastery Properties'))
    for p in ld('Weapon-Mastery-Properties'): w_blocks.append(P(f"<b>{html.escape(p['name'])}.</b> {inline(p.get('description', ''))}"))
    weapons = [e for e in ld('Equipment') if e.get('damage')]
    w_blocks += [H('Weapons Table'), T(['Name', 'Damage', 'Properties', 'Mastery', 'Weight', 'Cost'],
                                  [[html.escape(e['name']), f"{e['damage']['damage_dice']} {e['damage']['damage_type']['name']}", html.escape(names(e.get('properties'))) or '—',
                                    html.escape((e.get('mastery') or {}).get('name', '—')), f"{e.get('weight', '—')} lb.", cost(e.get('cost'))] for e in sorted(weapons, key=lambda e: e['name'])])]
    armor = [e for e in ld('Equipment') if e.get('armor_class')]
    ar_blocks = [T(['Armor', 'Category', 'Armor Class', 'Strength', 'Stealth', 'Weight', 'Cost'],
                   [[html.escape(e['name']), html.escape(e['equipment_categories'][-1]['name'] if e.get('equipment_categories') else ''),
                     f"{e['armor_class']['base']}" + (' + Dex' + (f" (max {e['armor_class']['max_bonus']})" if e['armor_class'].get('max_bonus') else '') if e['armor_class'].get('dex_bonus') else ''),
                     str(e.get('str_minimum') or '—'), 'Disadvantage' if e.get('stealth_disadvantage') else '—', f"{e.get('weight', '—')} lb.", cost(e.get('cost'))]
                    for e in sorted(armor, key=lambda e: (e['armor_class']['base'], e['name']))])]
    misc = [H('Damage Types'), T(['Type', 'Examples'], [[html.escape(d['name']), inline(d.get('description', ''))] for d in ld('Damage-Types')]),
            H('Schools of Magic'), T(['School', 'Typical spells'], [[html.escape(s['name']), inline(s.get('description', ''))] for s in ld('Magic-Schools')]),
            H('Alignments'), *[P(f"<b>{html.escape(a['name'])} ({a.get('abbreviation', '')}).</b> {inline(a.get('description', ''))}") for a in ld('Alignments')],
            H('Languages'), T(['Language', 'Rare', 'Note'], [[html.escape(l['name']), 'Yes' if l.get('is_rare') else 'No', inline(l.get('note', '')) or '—'] for l in ld('Languages')])]
    po = ld('Poisons')
    p_blocks = [T(['Poison', 'Type', 'Cost'], [[html.escape(p['name']), html.escape(str(p.get('type', '')).title()), f"{p.get('cost', '—')} gp"] for p in po])]
    for p in po: p_blocks.append(H(p['name'], 3)); p_blocks += md_blocks(p.get('description', ''))
    about = [P('This is a quick reference built from the <b>System Reference Document 5.2</b>: the rules in Vanadium’s lists (spells, monsters, magic items, classes, species, backgrounds, feats, equipment) and the reference chapters in this book. '
               'The SRD’s running rules text (Playing the Game, the Rules Glossary) is not included yet.'),
             P(ATTRIB), P('Vanadium is not affiliated with or endorsed by Wizards of the Coast.', True)]
    return [ch('about', 'About this reference', about), ch('abilities', 'Abilities and Skills', a_blocks), ch('conditions', 'Conditions', c_blocks),
            ch('weapons', 'Weapons', w_blocks), ch('armor', 'Armor', ar_blocks), ch('reference', 'Damage, Magic, Alignment and Languages', misc), ch('poisons', 'Poisons', p_blocks)]


# ---------- monsters ----------
SIZE_ORDER = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan']
def cr_str(v): return {0.125: '1/8', 0.25: '1/4', 0.5: '1/2'}.get(v, str(int(v)) if float(v).is_integer() else str(v))
def mod(score): m = (score - 10) // 2; return f"+{m}" if m >= 0 else f"−{-m}"
def title(s): return ' '.join(w if w in ('of', 'or', 'and') else w[:1].upper() + w[1:] for w in str(s).split(' '))
def usage(u):
    if not u: return ''
    t = u.get('type')
    if t == 'per day': return f" ({u['times']}/Day" + (f", or {u['times_in_lair']}/Day in Lair" if u.get('times_in_lair') else '') + ')'
    if t == 'recharge on roll': return f" (Recharge {u['min_value']}–6)" if u.get('min_value', 6) < 6 else ' (Recharge 6)'
    if t == 'recharge after rest': return ' (Recharges after a ' + ' or '.join(r.title() for r in u.get('rest_types', ['Short', 'Long'])) + ' Rest)'
    return ''
def ability(a):
    d = {'name': a['name'] + usage(a.get('usage')), 'html': inline(a.get('desc', ''))}
    sc = a.get('spellcasting')
    if sc and sc.get('spells'):
        groups = {}
        for s in sc['spells']:
            u = s.get('usage') or {}; key = 'At Will' if u.get('type') == 'at will' else (f"{u.get('times')}/Day Each" if u.get('type') == 'per day' else 'Spells')
            groups.setdefault(key, []).append(f'<a class="lnk" data-go="spells--{s["index"]}">{html.escape(s["name"])}</a>')
        d['spells'] = [f"<b>{k}:</b> " + ', '.join(v) for k, v in groups.items()]
    return d
def monsters():
    out = []
    for m in ld('Monsters'):
        ac = (m.get('armor_class') or [{}])[0]
        prof = {p['proficiency']['index']: p['value'] for p in m.get('proficiencies', [])}
        ab = {k: m[n] for k, n in [('str', 'strength'), ('dex', 'dexterity'), ('con', 'constitution'), ('int', 'intelligence'), ('wis', 'wisdom'), ('cha', 'charisma')]}
        saves = {k: (f"+{prof['saving-throw-' + k]}" if prof['saving-throw-' + k] >= 0 else f"−{-prof['saving-throw-' + k]}") if 'saving-throw-' + k in prof else mod(v) for k, v in ab.items()}
        skills = ', '.join(f"{title(k[6:].replace('-', ' '))} {'+' if v >= 0 else '−'}{abs(v)}" for k, v in prof.items() if k.startswith('skill-'))
        sp = m.get('speed', {}); speed = ', '.join(([sp['walk']] if 'walk' in sp else []) + [f"{k.title()} {v}" for k, v in sp.items() if k not in ('walk', 'hover')])
        if sp.get('hover'): speed += ' (hover)'
        senses = m.get('senses', {}); sense = ', '.join(f"{k.replace('_', ' ').title()} {v}" for k, v in senses.items() if k != 'passive_perception')
        sense = (sense + '; ' if sense else '') + f"Passive Perception {senses.get('passive_perception', '—')}"
        hp_roll = re.sub(r'\s*([+-])\s*', r' \1 ', m.get('hit_points_roll') or m.get('hit_dice') or '').replace('-', '−')
        cond = ', '.join(c['name'] if isinstance(c, dict) else str(c) for c in m.get('condition_immunities', []))
        imm = '; '.join(x for x in [', '.join(title(d) for d in m.get('damage_immunities', [])), cond] if x)
        xp = f"{m.get('xp', 0):,}" + (f", or {m['xp_in_lair']:,} in lair" if m.get('xp_in_lair') else '')
        out.append({'id': m['index'], 'name': m['name'], 'size': m['size'], 'type': title(m['type']), 'alignment': title(m.get('alignment', '')),
                    'ac': ac.get('value'), 'acNote': names(ac.get('armor', [])) if ac.get('armor') else '', 'init': mod(ab['dex']),
                    'hp': m['hit_points'], 'hpRoll': hp_roll, 'speed': speed, 'ab': ab, 'saves': saves, 'skills': skills,
                    'vuln': ', '.join(title(d) for d in m.get('damage_vulnerabilities', [])), 'resist': ', '.join(title(d) for d in m.get('damage_resistances', [])),
                    'immune': imm, 'senses': sense, 'languages': m.get('languages') or '—', 'gear': names(m.get('gear', []), 'name') if m.get('gear') and isinstance(m['gear'][0], dict) and 'name' in m['gear'][0] else '',
                    'cr': cr_str(m['challenge_rating']), 'crNum': m['challenge_rating'], 'xp': xp, 'pb': f"+{m.get('proficiency_bonus', 2)}",
                    'traits': [ability(a) for a in m.get('special_abilities', [])], 'actions': [ability(a) for a in m.get('actions', [])],
                    'bonus': [ability(a) for a in m.get('bonus_actions', [])], 'reactions': [ability(a) for a in m.get('reactions', [])],
                    'legendary': [ability(a) for a in m.get('legendary_actions', [])], 'group': title(m['type'])})
    out.sort(key=lambda x: x['name'])
    chapters = []
    for letter in sorted({x['name'][0].upper() for x in out}):
        ms = [x for x in out if x['name'][0].upper() == letter]
        chapters.append({'id': letter.lower(), 'title': f'Monsters: {letter}', 'blocks': [b for x in ms for b in (H(x['name']), {'t': 'monster', 'ref': x['id']})]})
    for x in out: x['ch'] = x['name'][0].lower()
    return {'title': 'SRD 5.2 Monsters', 'chapters': chapters, 'monsters': out, 'abilities': []}


def main():
    eq = equipment()
    data = {'book': book(eq), 'spells': spells(), 'items': magic_items(), 'classes': classes(), 'species': species(), 'backgrounds': backgrounds(),
            'feats': feats(), 'conditions': conditions(), 'equipment': eq}
    os.makedirs(OUT, exist_ok=True)
    dump = lambda p, d: open(os.path.join(OUT, p), 'w', encoding='utf-8', newline='').write(json.dumps(d, ensure_ascii=False, separators=(',', ':')))
    dump('srd5.json', data); mons = monsters(); dump('srd5-monsters.json', mons)
    print('srd5.json:', {k: len(v) for k, v in data.items()}, '| monsters:', len(mons['monsters']), 'in', len(mons['chapters']), 'chapters')


if __name__ == '__main__':
    main()
