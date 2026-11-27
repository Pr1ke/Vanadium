"""Tests the 5e JSON importer (5etools data format) and the 5e cards in a browser.

  python tests/s5import_test.py                     (after npm run build; uses tests/fixtures/5etools)
  python tests/s5import_test.py --folder DIR        also import every JSON file in DIR (e.g. your own
                                                    dndbeyond/ folder, which is git-ignored) and report
                                                    totals, notes and JS errors; nothing is written to the repo

The fixture is invented content in the same format: a monster with a _copy variant, an adventure
(read-aloud, sidebar, list, table, picture, stat block reference, cross-links), spells with
sources.json, and a class with a subclass. Prints PASS/FAIL; exits 1 on any failure.
"""
import asyncio, glob, os, socket, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
FIX = sorted(glob.glob(os.path.join(HERE, 'fixtures', '5etools', '*.json')))
FOLDER = sys.argv[sys.argv.index('--folder') + 1] if '--folder' in sys.argv else None
results = []
def check(name, ok, detail=''):
    results.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else f'  [{str(detail)[:300]}]'))


async def main():
    from playwright.async_api import async_playwright
    port = (lambda s: (s.bind(('127.0.0.1', 0)), s.getsockname()[1], s.close())[1])(socket.socket())
    srv = subprocess.Popen([sys.executable, os.path.join(ROOT, 'serve.py'), '--no-update', '--port', str(port)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.2); errors = []
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width': 1366, 'height': 900}, accept_downloads=True)
            await ctx.add_init_script('if (!sessionStorage.getItem("t")) { sessionStorage.setItem("t", 1); localStorage.clear(); localStorage.setItem("vanadium_system", "srd5"); }')
            pg = await ctx.new_page()
            pg.on('pageerror', lambda e: errors.append(str(e)))
            pg.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and errors.append(m.text))
            async def ready(): await pg.wait_for_function("document.querySelector('#loading')?.style.display === 'none'", timeout=60000); await pg.wait_for_timeout(1500)
            go = lambda h: pg.evaluate("h => { location.hash = h; }", h)
            text = lambda sel='#main': pg.evaluate("s => document.querySelector(s)?.innerText || ''", sel)
            await pg.goto(f'http://127.0.0.1:{port}/index.html#import'); await ready()
            check('5e import page takes JSON files and folders', await pg.evaluate("document.querySelector('#impfiles').accept.includes('.json') && document.querySelector('#impfiles').multiple && !!document.querySelector('#impdirin')"))

            # ---- the fixture ----
            await pg.set_input_files('#impfiles', FIX); await pg.wait_for_selector('#pvsave', timeout=60000)
            rows = await pg.evaluate("[...document.querySelectorAll('.pvfiles > div')].map(d => [d.querySelector('.pvt').value, d.innerText.replace(/\\s+/g, ' ')])")
            kinds = ' | '.join(r[1] for r in rows)
            check('preview: adventure, monsters, spells and class found', len(rows) == 4 and '2 chapters' in kinds and '2 monsters' in kinds and '2 spells' in kinds and '1 class' in kinds, rows)
            await pg.fill('[data-pt="0"]', 'Reedmoor Pond'); await pg.click('#pvsave'); await pg.wait_for_function("location.hash === '#library'", timeout=60000); await pg.wait_for_timeout(600)
            lib = await text()
            check('library shows the imports (with the edited title)', 'Reedmoor Pond' in lib and 'TST — Monsters' in lib and 'TST — Spells' in lib, lib[:300])
            n_lib = await pg.evaluate("document.querySelectorAll('.bookc').length")
            await go(''); await pg.wait_for_timeout(600)
            tiles = await pg.evaluate("[...document.querySelectorAll('.home .tile b')].map(b => b.textContent)")
            menu = await pg.evaluate("document.querySelector('#menu').textContent")
            check('home and menu: one Imports entry, no tile or menu item per imported book', 'Imports' in tiles and 'Reedmoor Pond' not in tiles and 'Reedmoor' not in menu and 'Imports' in menu, tiles)
            await go('#imports'); await pg.wait_for_timeout(500); t = await text()
            check('Imports page lists every import, grouped', all(x in t for x in ['Adventures', 'Reedmoor Pond', 'Bestiaries', 'TST — Monsters', 'Spells and classes', 'TST — Spells', 'Lamplighter (class)']), t[:300])
            await pg.fill('#s5-impq', 'reed'); await pg.wait_for_timeout(300)
            check('Imports page filter', await pg.evaluate("document.querySelectorAll('.s5imp').length") == 1)
            await pg.fill('#s5-impq', '')
            await go('#monsters--glimmer-toad~tst'); await pg.wait_for_timeout(500); t = await text('#lview')
            check('monster: 5e stat block from the JSON', all(x in t for x in ['Small Beast, Unaligned', 'AC 13 (natural armor)', 'HP 18 (4d6 + 4)', 'Swim 40 ft.', 'save +5', 'Stealth +5', 'Darkvision 60 ft.; Passive Perception 11', 'CR 1/2 (XP 100; PB +2)', 'Melee Weapon Attack:']), t[:500])
            check('monster: {@hit}/{@damage} are dice buttons, {@condition} links', await pg.evaluate("!!document.querySelector('#lview button.s5-roll[data-dice=\"1d20+5\"]') && !!document.querySelector('#lview button.s5-roll[data-dice=\"1d6 + 3\"]') && !!document.querySelector('#lview [data-go=\"conditions--prone\"]')"))
            await go('#monsters--glimmer-toad-matriarch~tst'); await pg.wait_for_timeout(500); t = await text('#lview')
            check('_copy variant: base stats + its own HP/CR + text replaced + action appended', all(x in t for x in ['HP 33 (6d8 + 6)', 'CR 2 (XP 450', 'The matriarch can breathe air', 'Croak.']), t[:500])
            await go('#book--imp-5et-tst-adventure'); await pg.wait_for_timeout(800)
            bm = await text('#bmain')
            check('adventure: chapter text, read-aloud box, sidebar, list, table', all(x in bm for x in ['glows at night', 'Lanterns bob', 'Running the Pond', 'Old Shrine.', 'Pond Events', '1–2', 'Fog rolls in.']) and await pg.evaluate("!!document.querySelector('#bmain .s5read') && !!document.querySelector('#bmain .s5inset')"), bm[:400])
            check('adventure: stat block shown in place, pictures skipped (nothing fetched)', await pg.evaluate("document.querySelectorAll('#bmain .s5mon').length") == 1 and await pg.evaluate("document.querySelectorAll('#bmain img').length") == 0)
            check('adventure: chapters in the navigation', await pg.evaluate("document.querySelectorAll('#bnav a.ch').length") == 2)
            await pg.click('#bmain a[data-s5find^="creature|Glimmer Toad"]'); await pg.wait_for_timeout(500)
            check('creature cross-link opens the monster', (await pg.evaluate("location.hash")) == '#monsters--glimmer-toad~tst', await pg.evaluate("location.hash"))
            await go('#spells'); await pg.wait_for_timeout(500)
            check('spells list: SRD and imported together (341 = 339 + 2)', await text('#lcount') == '341 / 341', await text('#lcount'))
            await go('#spells--test-spark~tst'); await pg.wait_for_timeout(400); t = await text('#lview')
            check('imported spell: level, school, classes (sources.json), fields, higher levels, source', all(x in t for x in ['Level 1 Evocation (Sorcerer, Wizard)', '60 feet', 'V, S, M (a pinch of soot)', 'Instantaneous', 'Using a Higher-Level Spell Slot.', 'TST']), t[:400])
            await go('#spells--quiet-ward~tst'); await pg.wait_for_timeout(400); t = await text('#lview')
            check('imported spell: ritual, touch, concentration duration', all(x in t for x in ['1 minute or Ritual', 'Touch', 'Concentration, up to 1 hour']), t[:300])
            await go('#classes--lamplighter~tst'); await pg.wait_for_timeout(400); t = await text('#lview')
            check('imported class: table, features, subclass', all(x in t for x in ['Lamplighter Features', 'Lamps', 'Level 1: Kindle', 'Subclass: Path of Embers', 'Ember Burst.']), t[:400])
            await pg.fill('#q', 'test spark'); await pg.wait_for_timeout(400); s = await text('#sres')
            check('search finds imported spells', 'Test Spark' in s, s[:100]); await pg.fill('#q', ''); await pg.keyboard.press('Escape')

            # ---- importing the same files again replaces, removing a book removes its entries ----
            await go('#import'); await pg.wait_for_timeout(500); await pg.set_input_files('#impfiles', FIX); await pg.wait_for_selector('#pvsave', timeout=60000)
            check('re-import says it replaces the earlier import', 'replaces your earlier import' in await text('.pvfiles'))
            await pg.click('#pvsave'); await pg.wait_for_function("location.hash === '#library'", timeout=60000); await pg.wait_for_timeout(500)
            check('re-import does not duplicate books', await pg.evaluate("document.querySelectorAll('.bookc').length") == n_lib)
            await pg.click('[data-delpack="imp-5et-tst-spells"]'); await pg.wait_for_timeout(300); await pg.click('.btn[data-r="1"]'); await pg.wait_for_timeout(500)
            await go('#spells'); await pg.wait_for_timeout(400)
            check('removing a book removes its spells from the list', await text('#lcount') == '339 / 339', await text('#lcount'))

            # ---- 5e cards ----
            await go('#cards'); await pg.wait_for_timeout(1300)
            tabs = await pg.evaluate("[...document.querySelectorAll('[data-ctab]')].map(b => b.dataset.ctab).join()")
            check('5e card tabs: magic items, spells, quests', tabs == 'item,spell,quest', tabs)
            await pg.fill('#c5-q', 'bag of hold'); await pg.wait_for_timeout(300); await pg.dispatch_event('#c5-qres [data-add5c]', 'mousedown'); await pg.wait_for_timeout(700)
            await pg.click('[data-ctab="spell"]'); await pg.wait_for_timeout(600)
            await pg.select_option('#c5-cls', 'Wizard'); await pg.select_option('#c5-lvl', '9'); await pg.click('#c5-addcl'); await pg.wait_for_timeout(700)
            deck = await pg.evaluate("[...document.querySelectorAll('.cdeck-r b')].map(b => b.textContent)")
            check('cards: an item from search, all level-9 wizard spells', 'Bag of Holding' in deck and 'Wish' in deck and len(deck) >= 5, deck)
            await pg.click('[data-ctab="quest"]'); await pg.wait_for_timeout(500); await pg.click('#q-new'); await pg.wait_for_timeout(300)
            labels = await pg.evaluate("[...document.querySelectorAll('[data-rl=\"0\"] option')].map(o => o.textContent).join()")
            check('quest editor offers 5e rewards', labels == 'XP,Gold,Magic Item,Other', labels)
            await pg.fill('#qe-t', 'Clear the pond'); await pg.click('#qe-ok'); await pg.wait_for_timeout(500)
            async with pg.expect_download(timeout=60000) as dl: await pg.click('#c-pdf')
            pt = subprocess.run(['node', os.path.join(HERE, 'pdftext.mjs'), str(await (await dl.value).path())], capture_output=True, text=True, encoding='utf-8', cwd=HERE).stdout
            check('card PDF: magic item, spell (with its fields) and quest', all(x in pt for x in ['Bag of Holding', 'Wondrous Item, Uncommon', 'Wish', 'Casting Time:', 'Clear the pond', 'MAGIC ITEM', 'SPELL']), pt[:300])

            # ---- Draw Steel never sees 5e imports ----
            await pg.select_option('#syssel', 'drawsteel'); await pg.wait_for_load_state(); await ready()
            await go('#library'); await pg.wait_for_timeout(500)
            check('Draw Steel library does not show 5e imports', 'Reedmoor' not in await text() and 'TST' not in await text())
            await pg.select_option('#syssel', 'srd5'); await pg.wait_for_load_state(); await ready()

            # ---- optional: a real folder (local only) ----
            if FOLDER:
                files = sorted(glob.glob(os.path.join(FOLDER, '**', '*.json'), recursive=True))
                await go('#import'); await pg.wait_for_timeout(500); t0 = time.time()
                await pg.set_input_files('#impfiles', files); await pg.wait_for_selector('#pvsave, .stage .warn', timeout=600000)
                n = await pg.evaluate("document.querySelectorAll('.pvfiles > div').length"); notes = await pg.evaluate("[...document.querySelectorAll('details.note div')].map(d => d.textContent)")
                print(f'folder: {len(files)} files -> {n} books in {time.time() - t0:.1f}s; {len(notes)} notes'); [print('   note:', x) for x in notes[:20]]
                await pg.click('#pvsave'); await pg.wait_for_function("location.hash === '#library'", timeout=600000); await pg.wait_for_timeout(800)
                for h in ['#monsters', '#spells', '#classes']:
                    await go(h); await pg.wait_for_timeout(1200); print('   ', h, await text('#lcount'))
                bad = 0
                for pid in await pg.evaluate("PACKS_LIST = [...document.querySelectorAll('[data-delpack]')].map(b => b.dataset.delpack)"):
                    await go('#book--' + pid); await pg.wait_for_timeout(250)
                print('   opened every imported book; errors so far:', len(errors))
                check('folder import: books found and no JS errors', n > 0 and not errors, '; '.join(errors)[:300])
            check('no JavaScript errors', not errors, '; '.join(errors)[:300])
            await b.close()
    finally:
        srv.terminate()

asyncio.run(main())
print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
