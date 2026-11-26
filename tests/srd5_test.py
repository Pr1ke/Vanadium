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
            check('dice roller available: button and phone tab shown', await pg.evaluate("!document.querySelector('#fab').hidden && !document.querySelector('#tabbar [data-tab=roll]').hidden"))
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
            # ---- step 4: dice ----
            await go('#monsters--adult-black-dragon'); await pg.wait_for_timeout(500)
            check('stat block shows the SRD initiative', 'Initiative +12 (22)' in await text('#lview'))
            await pg.click('#lview button.s5-roll[data-dice="1d20+11"]'); await pg.wait_for_timeout(300)
            tot = int(await pg.evaluate("document.querySelector('#r5log .tot').textContent")); bd = await text('#r5log .tt')
            check('attack button rolls d20 + 11', 12 <= tot <= 31 and bd.startswith('1d20 [') and bd.endswith('+ 11'), f'{tot} {bd}')
            await pg.select_option('#r5adv', '1'); await pg.click('#lview .s5-abs button.s5-save'); await pg.wait_for_timeout(300)
            check('advantage rolls two d20s and keeps the higher', ' adv' in await text('#r5log .rl .tt'), await text('#r5log .rl .tt'))
            await pg.select_option('#r5adv', '0')
            await pg.fill('#r5expr', '2d6 + 3'); await pg.click('#r5go'); await pg.wait_for_timeout(300)
            tot = int(await pg.evaluate("document.querySelector('#r5log .tot').textContent"))
            check('typed expression 2d6 + 3 totals 5–15', 5 <= tot <= 15, tot)
            dmg = await pg.evaluate("[...document.querySelectorAll('#lview button.s5-roll')].map(b => b.dataset.dice)")
            check('damage dice in actions are clickable', '2d6 + 6' in dmg and '12d8' in dmg, dmg[:12])
            await pg.click('#rclose')
            # ---- step 4: encounter difficulty (SRD 5.2 XP Budget per Character) ----
            await go('#encounter'); await pg.wait_for_timeout(500)
            budget = lambda: pg.evaluate("document.querySelector('.s5budl').innerText.replace(/\\s+/g, ' ')")
            check('4 level-1 characters: budgets 200 / 300 / 400 XP (SRD example)', await budget() == 'Low 200 XP Moderate 300 XP High 400 XP', await budget())
            await go('#monsters--bugbear-warrior'); await pg.wait_for_timeout(300); await pg.click('#lview [data-addenc5]')
            await go('#encounter'); await pg.wait_for_timeout(500)
            check('1 Bugbear Warrior (200 XP) is a Low encounter for them (SRD example 1)', (await text('.s5diff')).startswith('Low') and '200 XP' in await text('.s5diff'), await text('.s5diff'))
            for k in ('2', '3'):
                await pg.fill(f'[data-pl="{k}"]', '5'); await pg.press(f'[data-pl="{k}"]', 'Tab'); await pg.wait_for_timeout(300)
            check('mixed levels add up per character: 1,1,5,5 -> 1,100 / 1,650 / 2,400', await budget() == 'Low 1,100 XP Moderate 1,650 XP High 2,400 XP', await budget())
            await pg.fill('#s5-pall', '1'); await pg.press('#s5-pall', 'Tab'); await pg.wait_for_timeout(300)
            for _ in range(2): await pg.click('[data-einc="0"]'); await pg.wait_for_timeout(200)
            check('3 Bugbear Warriors (600 XP) are beyond High for 4 level-1 characters', (await text('.s5diff')).startswith('Beyond High'), await text('.s5diff'))
            async with pg.expect_download(timeout=60000) as dl: await pg.click('#s5-pdf')
            pt = subprocess.run(['node', os.path.join(HERE, 'pdftext.mjs'), str(await (await dl.value).path())], capture_output=True, text=True, encoding='utf-8', cwd=HERE).stdout
            check('encounter PDF: budgets, creatures, stat block, licence line', all(x in pt for x in ['XP budget', '3 × Bugbear Warrior', 'Initiative', 'SRD 5.2 material']), pt[:200])
            # ---- step 4: initiative ----
            await pg.click('#s5-init'); await pg.wait_for_timeout(600)
            rows = await pg.evaluate("[...document.querySelectorAll('.s5irow')].map(r => [r.querySelector('.s5iname').firstElementChild.textContent, r.querySelector('.s5iinit').value])")
            mons = [r for r in rows if r[0].startswith('Bugbear')]
            check('initiative: 4 characters + 3 bugbears, monsters rolled d20 + 2', len(rows) == 7 and len(mons) == 3 and all(3 <= int(v) <= 22 for _, v in mons), rows)
            first = rows[0][0]
            for _ in range(7): await pg.click('#i5-next'); await pg.wait_for_timeout(120)
            check('turns cycle and the round advances', 'Round 2' in await text('.s5round') and first in await text('.s5round'), await text('.s5round'))
            i = [k for k, r in enumerate(rows) if r[0].startswith('Bugbear')][0]
            await pg.fill(f'[data-ihp="{i}"]', '−9'); await pg.press(f'[data-ihp="{i}"]', 'Enter'); await pg.wait_for_timeout(300)
            hp = await pg.evaluate(f"document.querySelectorAll('.s5irow')[{i}].querySelector('.s5ihp b').textContent")
            await pg.select_option(f'[data-icond="{i}"]', 'Prone'); await pg.wait_for_timeout(300)
            check('damage lowers HP (33 − 9 = 24) and conditions stick', hp == '24' and 'Prone' in await pg.evaluate(f"document.querySelectorAll('.s5irow')[{i}].innerText"), hp)
            await pg.reload(); await pg.wait_for_function("document.querySelector('#loading')?.style.display === 'none'", timeout=60000); await pg.wait_for_timeout(1200)
            check('the tracker survives a reload', 'Round 2' in await text('.s5round') and await pg.evaluate("localStorage.getItem('st_srd5_init')") is not None)
            # ---- step 4: sessions hold 5e encounters ----
            await go('#sessions'); await pg.wait_for_timeout(400); await pg.click('#snew'); await pg.wait_for_timeout(500)
            await pg.click('[data-add="enc"]'); await pg.wait_for_timeout(300); await pg.click('[data-pk="cur"]'); await pg.wait_for_timeout(600)
            t = await text('#bmain')
            check('a session can hold a 5e encounter (difficulty shown)', 'Beyond High' in t and 'Bugbear Warrior' in t, t[:200])
            sess = (await pg.evaluate("location.hash")).split('--d')[0]
            await go(sess); await pg.wait_for_timeout(500)
            async with pg.expect_download(timeout=90000) as dl: await pg.click('#s-export')
            pt = subprocess.run(['node', os.path.join(HERE, 'pdftext.mjs'), str(await (await dl.value).path())], capture_output=True, text=True, encoding='utf-8', cwd=HERE).stdout
            check('session export: cover with party line, the encounter sheet', '4 characters, level' in pt and 'Bugbear Warrior' in pt, pt[:200])
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
