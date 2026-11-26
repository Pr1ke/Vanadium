"""One-off: read each monster's Initiative from the official SRD 5.2 PDF's text, because the
5e-database data leaves it out (2024 stat blocks list e.g. "AC 19 Initiative +12 (22)").

  node tests/pdftext.mjs SRD_CC_v5.2.pdf > srd.txt      (the PDF from https://www.dndbeyond.com/srd)
  python src/systems/srd5/extract_initiative.py srd.txt

Writes srd/initiative.json ({monster index: "+12"}), which mkdata.py merges into the monsters.
A monster matches when its name is followed by "AC <its AC> Initiative ..." within its stat block.
The PDF itself is never committed.
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
text = re.sub(r'\s+', ' ', open(sys.argv[1], encoding='utf-8').read())
mons = json.load(open(os.path.join(HERE, 'srd', '5e-SRD-Monsters.json'), encoding='utf-8'))
out, missing = {}, []
for m in mons:
    ac = (m.get('armor_class') or [{}])[0].get('value')
    name = re.escape(m['name']).replace(r'\ ', r'\s+')
    hit = re.search(name + r'\b.{0,160}?AC ' + str(ac) + r' Initiative ([+−\-–]\d+) \((\d+)\)', text)
    if not hit:   # shape-changer forms ("Werewolf, Wolf Form") share their base creature's initiative;
        base = re.escape(re.sub(r',\s*[^,]*Form$', '', m['name'])).replace(r'\ ', r'\s+')   # else match by name without the AC check
        hit = re.search(base + r'\b.{0,160}?AC \d+ Initiative ([+−\-–]\d+) \((\d+)\)', text)
    if hit: out[m['index']] = hit.group(1).replace('-', '−').replace('–', '−')
    else: missing.append(m['name'])
json.dump(dict(sorted(out.items())), open(os.path.join(HERE, 'srd', 'initiative.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print(f'{len(out)} of {len(mons)} monsters have an initiative; missing: {len(missing)}', missing[:20])
