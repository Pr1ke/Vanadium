"""Checks the 5e (SRD 5.2) system in a browser (multi-system step 3).

  python tests/srd5_test.py        (after npm run build)

Content: list sizes, a spell page, a stat block, condition links and hover previews, search, the
reference book and the monsters book, pins, and the CC BY attribution in the footer and in an
exported PDF. Also: no Wizards of the Coast trademarks anywhere in the built site, no dice roller
shown (none yet), no JS errors. Prints PASS/FAIL per check; exits 1 on any failure.
"""
import asyncio, json, os, re, socket, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE); SITE = os.path.join(ROOT, 'site')
results = []
def check(name, ok, detail=''):
    results.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else f'  [{detail}]'))


def static_checks():
    D = json.load(open(os.path.join(SITE, 'data', 'srd5.json'), encoding='utf-8'))
    M = json.load(open(os.path.join(SITE, 'data', 'srd5-monsters.json'), encoding='utf-8'))
    check('data: 339 spells, 341 monsters, 262 magic items, 12 classes', (len(D['spells']), len(M['monsters']), len(D['items']), len(D['classes'])) == (339, 341, 262, 12))
    check('data: no spell has components stuck in its range', not [s['name'] for s in D['spells'] if 'Component' in s['range']])
    blob = json.dumps(D, ensure_ascii=False) + json.dumps(M, ensure_ascii=False)
    check('data: no markdown left over', '**' not in blob)
    built = blob + open(os.path.join(SITE, 'app.js'), encoding='utf-8').read() + open(os.path.join(SITE, 'index.html'), encoding='utf-8').read()
    tm = sorted(set(re.findall(r'Dungeons\s*&(?:amp;)?\s*Dragons|\bD&(?:amp;)?D\b|Forgotten Realms|Beholder|Mind Flayer|Monster Manual|Player.s Handbook', built)))
    check('no Wizards of the Coast trademarks in the built site', not tm, tm)


async def main():
    from playwright.async_api import async_playwright
    port = (lambda s: (s.bind(('127.0.0.1', 0)), s.getsockname()[1], s.close())[1])(socket.socket())
    srv = subprocess.Popen([sys.executable, os.path.join(ROOT, 'serve.py'), '--no-update', '--port', str(port)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.2); errors = []
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width': 1366, 'height': 900}, accept_downloads=True)
            await ctx.add_init_script('if (!sessionStorage.getItem("s5")) { sessionStorage.setItem("s5", 1); localStorage.clear(); localStorage.setItem("vanadium_system", "srd5"); }')
            pg = await ctx.new_page()
            pg.on('pageerror', lambda e: errors.append(str(e)))
            pg.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and errors.append(m.text))
            await pg.goto(f'http://127.0.0.1:{port}/index.html')
            await pg.wait_for_function("document.querySelector('#loading')?.style.display === 'none'", timeout=60000); await pg.wait_for_timeout(1500)
            go = lambda h: pg.evaluate("h => { location.hash = h; }", h)
            text = lambda sel='#main': pg.evaluate("s => document.querySelector(s)?.innerText || ''", sel)

            check('5e is active: switch, menu, home', await pg.evaluate("document.querySelector('#syssel').value") == 'srd5' and 'Characters' in await pg.evaluate("document.querySelector('#menu').textContent") and '5e rules' in await text())
            check('footer has the SRD 5.2 CC BY attribution', 'System Reference Document 5.2' in await text('footer') and 'Creative Commons Attribution 4.0' in await text('footer'))
            check('no dice roller yet: button and phone tab hidden', await pg.evaluate("document.querySelector('#fab').hidden && document.querySelector('#tabbar [data-tab=roll]').hidden"))
            for t, n in [('spells', 339), ('monsters', 341), ('items', 262), ('classes', 12), ('species', 9), ('backgrounds', 4), ('feats', 17), ('conditions', 15), ('equipment', 182)]:
                await go('#' + t); await pg.wait_for_timeout(350)
                c = await text('#lcount'); check(f'list {t}: {n} entries', c == f'{n} / {n}', c)
            await go('#spells--fireball'); await pg.wait_for_timeout(400); t = await text('#lview')
            check('spell page: level, school, classes, fields, higher-level text', all(x in t for x in ['Level 3 Evocation (Sorcerer, Wizard)', '150 feet', 'V, S, M (a ball of bat guano and sulfur)', 'Instantaneous', 'Using a Higher-Level Spell Slot.']), t[:300])
            await go('#spells--guidance'); await pg.wait_for_timeout(300); t = await text('#lview')
            check('fixed spell: Guidance range "Touch", components "V, S"', 'Touch' in t and 'V, S' in t and 'Component:' not in t, t[:300])
            await go('#monsters--adult-black-dragon'); await pg.wait_for_timeout(400); t = await text('#lview')
            check('stat block: AC, HP, abilities, saves, CR, recharge, legendary', all(x in t for x in ['AC 19', 'HP 195 (17d12 + 85)', 'save +7', 'CR 14 (XP 11,500, or 13,000 in lair; PB +5)', 'Acid Breath (Recharge 5–6)', 'LEGENDARY ACTIONS']), t[:400])
            check('stat block: spells are links', await pg.evaluate("document.querySelectorAll('#lview .s5-spl a[data-go^=\"spells--\"]').length") == 5)
            await go('#spells--animal-friendship'); await pg.wait_for_timeout(400)
            lnk = await pg.query_selector('#lview .lnk[data-go="conditions--charmed"]')
            check('conditions are linked in rules text', lnk is not None)
            if lnk:
                await lnk.hover(); await pg.wait_for_timeout(600); h = await text('#hov')
                check('hover preview shows the condition', 'Charmed' in h and 'condition' in h.lower(), h[:200])
            await pg.fill('#q', 'fireball'); await pg.wait_for_timeout(400); s = await text('#sres')
            check('search finds Fireball as a spell', [x.lower() for x in s.split('\n')[:2]] == ['spell', 'fireball'], s[:120]); await pg.fill('#q', ''); await pg.keyboard.press('Escape')
            await go('#book--srd52--conditions'); await pg.wait_for_timeout(500)
            check('reference book: 7 chapters, conditions chapter, title not repeated',
                  await pg.evaluate("document.querySelectorAll('#bnav a.ch').length") == 7 and 'Unconscious' in await text('#bmain') and await pg.evaluate("[...document.querySelectorAll('#bmain h2, #bmain h1')].filter(h => h.textContent.trim() === 'Conditions').length") == 1)
            await go('#book--srd5-monsters--g'); await pg.wait_for_timeout(800)
            check('monsters book: chapter G shows stat blocks', await pg.evaluate("document.querySelectorAll('#bmain .s5mon').length") > 5 and 'Goblin Warrior' in await text('#bmain'))
            await go('#items--bag-of-holding'); await pg.wait_for_timeout(300)
            check('magic item subtitle has type and rarity', 'Wondrous Item, Uncommon' in await text('#lview .meta'), await text('#lview .meta'))
            await go('#classes--wizard'); await pg.wait_for_timeout(300); t = await text('#lview')
            check('class page: feature table with spell slots, features, subclass', all(x in t for x in ['Wizard Features', 'Prepared Spells', '9th', 'Level 1: Spellcasting', 'Subclass: ']), t[:200])
            await go('#monsters--goblin-warrior'); await pg.wait_for_timeout(300); await pg.click('#lview .ent-tools [data-pin]'); await go('#spells--fireball'); await pg.wait_for_timeout(300); await pg.click('#lview .ent-tools [data-pin]')
            await go('#pinned'); await pg.wait_for_timeout(400); t = await text()
            check('pins: grouped monsters (with XP total) and spells', 'Monsters · 50 XP total' in t and 'Spells' in t and await pg.evaluate("localStorage.getItem('st_srd5_pins')") is not None, t[:200])
            # a quest card PDF carries the SRD attribution
            await go('#cards'); await pg.wait_for_timeout(1200); await pg.click('#q-new'); await pg.fill('#qe-t', 'Find the lost bell'); await pg.click('#qe-ok'); await pg.wait_for_timeout(500)
            async with pg.expect_download(timeout=60000) as dl: await pg.click('#c-pdf')
            path = await (await dl.value).path()
            pt = subprocess.run(['node', os.path.join(HERE, 'pdftext.mjs'), str(path)], capture_output=True, text=True, encoding='utf-8', cwd=HERE).stdout
            check('card PDF: quest card and SRD 5.2 licence line', 'Find the lost bell' in pt and 'SRD 5.2 material by Wizards of the Coast LLC, licensed CC BY 4.0' in pt, pt[:200])
            mob = await ctx.new_page(); await mob.set_viewport_size({'width': 390, 'height': 844})
            await mob.goto(f'http://127.0.0.1:{port}/index.html'); await mob.wait_for_function("document.querySelector('#loading')?.style.display === 'none'", timeout=60000); await mob.wait_for_timeout(1200)
            await mob.click('#tabbar button[data-tab="browse"]'); await mob.wait_for_timeout(300)
            sheet = await mob.evaluate("document.querySelector('#sheet').innerText")
            check('phone: Browse sheet lists 5e sections and the attribution', all(x.lower() in sheet.lower() for x in ['Spells', 'Monsters', 'Classes', 'System Reference Document 5.2']), sheet[:200])
            check('no JavaScript errors', not errors, '; '.join(errors)[:300])
            await b.close()
    finally:
        srv.terminate()

static_checks()
asyncio.run(main())
print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
