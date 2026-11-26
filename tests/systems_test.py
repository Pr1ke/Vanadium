"""Tests the game-system switch and per-system data (multi-system step 2).

  python tests/systems_test.py        (after npm run build)

Makes a throw-away copy of site/ with a tiny second system (tests/fixtures/sample-system) added
to app.js, then in a browser:
  - Draw Steel stays the default and keeps its existing data and an untagged (old) import
  - the switch appears, and switching reloads into the sample system
  - the sample system starts empty: no Draw Steel sessions, pins, cards or imports
  - data made in the sample system goes to st_sample_* keys; Draw Steel keys are untouched
  - a PDF imported under the sample system is tagged and only shows there
  - switching back shows Draw Steel's data again; the theme is shared
Prints PASS/FAIL per check; exits 1 on any failure.
"""
import asyncio, json, os, re, shutil, socket, subprocess, sys, tempfile, time, importlib.util

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
FIX = os.path.join(HERE, 'fixtures', 'sample-system')
spec = importlib.util.spec_from_file_location('snapshot', os.path.join(HERE, 'snapshot.py')); snap = importlib.util.module_from_spec(spec); spec.loader.exec_module(snap)

results = []
def check(name, ok, detail=''):
    results.append(ok); print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else f'  [{detail}]'))


def make_site(tmp):
    site = os.path.join(tmp, 'site')
    shutil.copytree(os.path.join(ROOT, 'site'), site, ignore=shutil.ignore_patterns('.vanadium*'))
    shutil.copy(os.path.join(FIX, 'sample.json'), os.path.join(site, 'data', 'sample.json'))
    p = os.path.join(site, 'app.js'); js = open(p, encoding='utf-8').read()
    i = js.rindex('boot();')
    js = js[:i] + open(os.path.join(FIX, 'sample.js'), encoding='utf-8').read() + '\n' + js[i:]
    m = re.search(r"const SYSTEM_IDS = JSON.parse\('(\[[^']*\])'\);", js); assert m, 'SYSTEM_IDS not found'
    ids = json.loads(m.group(1)) + ['sample']   # the build's systems plus the test fixture
    js = js.replace(m.group(0), "const SYSTEM_IDS = JSON.parse('%s');" % json.dumps(ids))
    open(p, 'w', encoding='utf-8').write(js)
    return site


async def main():
    from playwright.async_api import async_playwright
    tmp = tempfile.mkdtemp(prefix='vanadium-systems-')
    site = make_site(tmp)
    port = (lambda s: (s.bind(('127.0.0.1', 0)), s.getsockname()[1], s.close())[1])(socket.socket())
    srv = subprocess.Popen([sys.executable, os.path.join(ROOT, 'serve.py'), '--site', site, '--port', str(port)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.2); base = f'http://127.0.0.1:{port}/index.html'
    errors = []
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width': 1280, 'height': 900})
            seed = snap.seed_state()
            await ctx.add_init_script('(() => { if (localStorage.getItem("seeded")) return; localStorage.setItem("seeded", 1);'
                                      + ''.join(f'localStorage.setItem({json.dumps(k)}, {json.dumps(json.dumps(v))});' for k, v in seed.items()) + '})()')
            pg = await ctx.new_page()
            pg.on('pageerror', lambda e: errors.append(str(e)))
            pg.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and errors.append(m.text))
            async def ready():
                await pg.wait_for_function("document.querySelector('#loading')?.style.display === 'none'", timeout=60000); await pg.wait_for_timeout(1500)
            async def go(h): await pg.evaluate("h => { location.hash = h; }", h); await pg.wait_for_timeout(500)
            main_text = lambda: pg.evaluate("document.querySelector('#main').innerText")
            ls = lambda k: pg.evaluate("k => localStorage.getItem(k)", k)

            # ---- Draw Steel (default) with existing data and an old, untagged import ----
            await pg.goto(base); await ready()
            await pg.evaluate("""() => new Promise((res, rej) => { const q = indexedDB.open('steeltools', 1);
                q.onupgradeneeded = () => q.result.createObjectStore('packs', { keyPath: 'id' });
                q.onsuccess = () => { const t = q.result.transaction('packs', 'readwrite');
                  t.objectStore('packs').put({ id: 'imp-old-book', title: 'Old Import', kind: 'adventure', chapters: [{ id: 'c1', title: 'Chapter 1', blocks: [{ t: 'h', lvl: 1, text: 'Chapter 1', id: 'c1' }, { t: 'p', style: 'body', html: 'Old text.' }] }], monsters: [], abilities: [] });
                  t.oncomplete = () => { q.result.close(); res(); }; t.onerror = () => rej(t.error); }; q.onerror = () => rej(q.error); })""")
            await pg.reload(); await ready()
            ds_keys_before = await pg.evaluate("JSON.stringify(Object.keys(localStorage).filter(k => k.startsWith('st_') && !k.startsWith('st_sample_')).sort().map(k => [k, localStorage.getItem(k)]))")
            sel = await pg.query_selector('#syssel')
            check('switch is shown when there are several systems', sel is not None and await sel.is_visible())
            opts = await pg.evaluate("[...document.querySelectorAll('#syssel option')].map(o => o.value + (o.selected ? '*' : '')).join(',')")
            check('switch lists every system, Draw Steel selected', opts.startswith('drawsteel*,') and opts.endswith(',sample'), opts)
            check('Draw Steel menu and footer', 'Heroes' in await pg.evaluate("document.querySelector('#menu').textContent") and 'DRAW STEEL' in await pg.evaluate("document.querySelector('footer').innerText"))
            await go('#library'); lib = await main_text()
            check('Draw Steel library shows its books and the old untagged import', 'Draw Steel: Heroes' in lib and 'Old Import' in lib, lib[:200])
            await go('#sessions'); check('Draw Steel sessions show the seeded session', 'Session 1' in await main_text())

            # ---- switch to the sample system ----
            await pg.select_option('#syssel', 'sample'); await pg.wait_for_load_state(); await ready()
            check('switching reloads into the sample system', await pg.query_selector('#samplehome') is not None and await ls('vanadium_system') == 'sample')
            check('sample menu, footer and switch value', 'Spells' in await pg.evaluate("document.querySelector('#menu').textContent") and await pg.evaluate("document.querySelector('footer').innerText") == 'Sample System footer notice' and await pg.evaluate("document.querySelector('#syssel').value") == 'sample')
            await go('#library'); lib = await main_text()
            check('sample library: own rulebook only, no Draw Steel books or imports', 'Sample Rules' in lib and 'Draw Steel' not in lib and 'Old Import' not in lib, lib[:200])
            await go('#sessions'); check('sample sessions start empty', 'No sessions yet.' in await main_text())
            check('sample pins start at 0', await pg.evaluate("document.querySelector('#pincount').innerText") == '0')
            await go('#cards'); await pg.wait_for_timeout(900); t = await main_text()
            check('sample cards: empty deck, quest tab only', 'No cards yet.' in t and await pg.evaluate("[...document.querySelectorAll('[data-ctab]')].map(b => b.dataset.ctab).join()") == 'quest', t[:200])
            await go('#spells'); check('sample list page works', 'Light' in await main_text() and 'Spark' in await main_text())
            await go('#spells--spark'); check('sample entry page works', 'A spark jumps' in await main_text())
            await go('#book--srd--intro'); check('sample rulebook reader works', 'Say the words' in await main_text())
            await go('#sessions'); await pg.click('#snew'); await pg.wait_for_timeout(500)
            s_sample = json.loads(await ls('st_sample_sessions') or '[]')
            check('a session made in the sample system is stored under st_sample_sessions', len(s_sample) == 1, str(s_sample)[:120])
            # import a PDF under the sample system
            pdf = os.path.join(tmp, 'fixture.pdf'); subprocess.run(['node', os.path.join(HERE, 'make_fixture_pdf.mjs'), pdf], check=True, stdout=subprocess.DEVNULL)
            await go('#import'); await pg.set_input_files('#pdffile', pdf); await pg.wait_for_selector('#pvsave', timeout=60000)
            await pg.click('#pvsave'); await pg.wait_for_timeout(1200)
            packs = await pg.evaluate("""() => new Promise(res => { const q = indexedDB.open('steeltools', 1); q.onsuccess = () => { const r = q.result.transaction('packs').objectStore('packs').getAll(); r.onsuccess = () => { res(r.result.map(p => [p.title, p.system || null])); q.result.close(); }; }; })""")
            check('the import is tagged with the sample system', ['Snapshot Test Adventure', 'sample'] in packs, str(packs))
            await go('#library'); check('sample library shows its own import', 'Snapshot Test Adventure' in await main_text())
            # the theme is shared
            await pg.click('#themebtn'); theme = await ls('st_theme2')

            # ---- back to Draw Steel ----
            await pg.select_option('#syssel', 'drawsteel'); await pg.wait_for_load_state(); await ready()
            check('switching back to Draw Steel', 'Heroes' in await pg.evaluate("document.querySelector('#menu').textContent") and await ls('vanadium_system') == 'drawsteel')
            await go('#library'); lib = await main_text()
            check('Draw Steel library: old import back, sample import not shown', 'Old Import' in lib and 'Snapshot Test Adventure' not in lib, lib[:200])
            await go('#sessions'); t = await main_text()
            n = await pg.evaluate("document.querySelectorAll('#main a.sesc').length")
            check('Draw Steel sessions unchanged (only the seeded one)', n == 1 and '2026-01-02' in t, f'{n} sessions: {t[:200]}')
            check('Draw Steel pins unchanged', await pg.evaluate("document.querySelector('#pincount').innerText") == '3')
            ds_keys_after = await pg.evaluate("JSON.stringify(Object.keys(localStorage).filter(k => k.startsWith('st_') && !k.startsWith('st_sample_') && k !== 'st_theme2' && k !== 'st_updchk').sort().map(k => [k, localStorage.getItem(k)]))")
            strip_shared = lambda s: json.dumps([kv for kv in json.loads(s) if kv[0] not in ('st_theme2', 'st_updchk')])
            check('no Draw Steel key was changed by working in the sample system', strip_shared(ds_keys_before) == strip_shared(ds_keys_after))
            check('the theme is shared between systems', await pg.evaluate("document.documentElement.dataset.theme") == json.loads(theme))
            check('no JavaScript errors', not errors, '; '.join(errors)[:300])
            await b.close()
    finally:
        srv.terminate(); shutil.rmtree(tmp, ignore_errors=True)
    print(f"\n{sum(results)}/{len(results)} checks passed")
    sys.exit(0 if all(results) else 1)

asyncio.run(main())
