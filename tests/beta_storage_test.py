"""Checks that the copy in vanadiumBeta/ keeps its browser storage apart from the main copy (src/ns.js).

  python tests/beta_storage_test.py        (after npm run build)

Serves two copies of site/ on one address, /vanadium/ and /vanadiumBeta/, as on the real host, and
checks: beta's saved data, sync key, IndexedDB and caches are prefixed "vanadiumBeta:"; neither copy
sees the other's data; length/key()/clear() only cover beta's own keys; the Respite iframe is
prefixed too; the main copy is unchanged. Prints PASS/FAIL per check; exits 1 on any failure.
"""
import asyncio, os, shutil, socket, subprocess, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else f'  [{detail}]'))


async def main():
    from playwright.async_api import async_playwright
    tmp = tempfile.mkdtemp(prefix='vbeta-')
    for name in ['vanadium', 'vanadiumBeta']:
        shutil.copytree(os.path.join(ROOT, 'site'), os.path.join(tmp, name), ignore=shutil.ignore_patterns('img', 'vanadium-img', '.vanadium*'))
    port = (lambda s: (s.bind(('127.0.0.1', 0)), s.getsockname()[1], s.close())[1])(socket.socket())
    srv = subprocess.Popen([sys.executable, os.path.join(ROOT, 'serve.py'), '--site', tmp, '--port', str(port)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.2); errors = []
    base = f'http://127.0.0.1:{port}'
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width': 1366, 'height': 900})
            async def open_copy(path):
                pg = await ctx.new_page(); pg.on('pageerror', lambda e: errors.append(f'{path}: {e}'))
                await pg.goto(f'{base}/{path}/index.html')
                await pg.wait_for_function("document.querySelector('#loading')?.style.display === 'none'", timeout=60000); await pg.wait_for_timeout(1500)
                return pg
            main_pg = await open_copy('vanadium')
            check('main copy: no prefix', await main_pg.evaluate("window.VANADIUM_NS === undefined"))
            await main_pg.evaluate("localStorage.setItem('st_sessions', JSON.stringify([{id:'smain', name:'Main night', date:'', docs:[]}])); localStorage.setItem('st_sync_key', 'MAINKEY'); localStorage.setItem('st_theme2', '\"dark\"')")
            beta = await open_copy('vanadiumBeta')
            check('beta copy: prefix vanadiumBeta:', await beta.evaluate("window.VANADIUM_NS") == 'vanadiumBeta:')
            seen = await beta.evaluate("() => [localStorage.getItem('st_sessions'), localStorage.getItem('st_sync_key'), localStorage.getItem('st_theme2')]")
            check('beta doesn\'t see main\'s sessions, sync key or theme', seen[:2] == [None, None] and seen[2] != '"dark"', seen)
            await beta.evaluate("location.hash = '#sessions'"); await beta.wait_for_timeout(400)
            check('beta: sessions list is empty', 'No sessions yet.' in await beta.evaluate("document.querySelector('#main').innerText"))
            await beta.click('#snew'); await beta.wait_for_timeout(500)
            await beta.evaluate("localStorage.setItem('st_sync_key', 'BETAKEY')")
            raw = await main_pg.evaluate("Object.keys(localStorage).sort()")
            check('beta writes land under vanadiumBeta: keys', 'vanadiumBeta:st_sessions' in raw and 'vanadiumBeta:st_sync_key' in raw and not any(k.startswith('vanadiumBeta:vanadiumBeta:') for k in raw), raw)
            check('main keeps its own sessions and sync key', await main_pg.evaluate("[JSON.parse(localStorage.getItem('st_sessions')).length, localStorage.getItem('st_sync_key')]") == [1, 'MAINKEY'])
            bk = await beta.evaluate("(() => { const o = []; for (let i = 0; i < localStorage.length; i++) o.push(localStorage.key(i)); return o; })()")
            check('beta: length/key() list only its own keys, without the prefix', 'st_sessions' in bk and 'st_sync_key' in bk and not any(k.startswith('vanadiumBeta:') for k in bk) and 'st_updchk' not in [k for k in bk if k.startswith('vanadiumBeta')], bk)
            # IndexedDB and caches
            await beta.evaluate("new Promise(r => { const q = indexedDB.open('probe-db', 1); q.onsuccess = () => { q.result.close(); r(); }; q.onerror = r; })")
            dbs = await main_pg.evaluate("indexedDB.databases().then(d => d.map(x => x.name).sort())")
            check('beta IndexedDB databases are prefixed', 'vanadiumBeta:probe-db' in dbs and 'probe-db' not in dbs, dbs)
            ck = await main_pg.evaluate("caches.keys()"); bck = await beta.evaluate("caches.keys()")
            check('beta caches are prefixed; each copy only lists its own', any(k.startswith('vanadiumBeta:steeltools-') for k in ck) and any(k.startswith('steeltools-') for k in ck) and all(k.startswith('steeltools-') for k in bck) and bck, (ck, bck))
            # Respite iframe
            await beta.evaluate("location.hash = '#respite'"); await beta.wait_for_timeout(1500)
            fr = next((f for f in beta.frames if 'respite' in f.url), None)
            if fr:
                await fr.evaluate("localStorage.setItem('respite-probe', '1')")
                check('Respite iframe in beta is prefixed too', await main_pg.evaluate("[localStorage.getItem('vanadiumBeta:respite-probe'), localStorage.getItem('respite-probe')]") == ['1', None])
            else:
                check('Respite iframe in beta is prefixed too', False, 'no respite frame')
            await beta.evaluate("localStorage.clear()")
            check('beta clear() leaves main\'s data alone', await main_pg.evaluate("[localStorage.getItem('st_sync_key'), Object.keys(localStorage).filter(k => k.startsWith('vanadiumBeta:')).length]") == ['MAINKEY', 0])
            await main_pg.reload(); await main_pg.wait_for_function("document.querySelector('#loading')?.style.display === 'none'", timeout=60000); await main_pg.wait_for_timeout(800)
            await main_pg.evaluate("location.hash = '#sessions'"); await main_pg.wait_for_timeout(400)
            check('main still shows its session after all that', 'Main night' in await main_pg.evaluate("document.querySelector('#main').innerText"))
            check('no JS errors', not errors, errors[:3])
            await b.close()
    finally:
        srv.terminate(); shutil.rmtree(tmp, ignore_errors=True)
    print(f'\n{sum(results)}/{len(results)} passed'); sys.exit(0 if all(results) else 1)

asyncio.run(main())
