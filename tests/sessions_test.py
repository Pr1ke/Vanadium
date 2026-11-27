"""Checks folders inside sessions, in both game systems.

  python tests/sessions_test.py        (after npm run build)

Per system: create a folder "This town", add a page and an encounter into it, nest a second folder,
move items in and out, reorder inside a folder, fold a folder away, the folder PDF, the session
export's contents, removing a folder (its items move up, nothing is lost) and that it all survives a
reload. Prints PASS/FAIL per check; exits 1 on any failure.
"""
import asyncio, json, os, socket, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else f'  [{detail}]'))


async def run_system(p, port, system):
    errors = []
    b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width': 1366, 'height': 900}, accept_downloads=True)
    await ctx.add_init_script('if (!sessionStorage.getItem("x")) { sessionStorage.setItem("x", 1); localStorage.clear(); localStorage.setItem("vanadium_system", "%s"); }' % system)
    pg = await ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and errors.append(m.text))
    ready = lambda: pg.wait_for_function("document.querySelector('#loading')?.style.display === 'none'", timeout=60000)
    await pg.goto(f'http://127.0.0.1:{port}/index.html'); await ready(); await pg.wait_for_timeout(1500)
    go = lambda h: pg.evaluate("h => { location.hash = h; }", h)
    text = lambda sel='#main': pg.evaluate("s => document.querySelector(s)?.innerText || ''", sel)
    key = 'st_sessions' if system == 'drawsteel' else f'st_{system}_sessions'
    sess = lambda: pg.evaluate(f"JSON.parse(localStorage.getItem('{key}'))[0]")
    by = lambda S, t: next(d for d in S['docs'] if d['title'] == t)
    nav = lambda: pg.evaluate("[...document.querySelectorAll('#bnav .sdoc')].map(r => [r.querySelector('a').innerText.trim(), getComputedStyle(r).paddingLeft])")
    async def rename(t): await pg.fill('#d-title', t); await pg.dispatch_event('#d-title', 'change'); await pg.wait_for_timeout(300)
    async def pdf_text(sel):
        async with pg.expect_download(timeout=90000) as dl: await pg.click(sel)
        return subprocess.run(['node', os.path.join(HERE, 'pdftext.mjs'), str(await (await dl.value).path())], capture_output=True, text=True, encoding='utf-8', cwd=HERE).stdout
    tag = f'[{system}] '
    jsclick = lambda sel: pg.evaluate("s => document.querySelector(s).click()", sel)   # the arrows only show on hover

    await go('#sessions'); await pg.wait_for_timeout(400); await pg.click('#snew'); await pg.wait_for_timeout(600)
    S = await sess(); sid = S['id']
    check(tag + 'sidebar has a Folder button', await pg.evaluate("!!document.querySelector('[data-add=\"folder\"]')"))
    await pg.click('[data-add="folder"]'); await pg.wait_for_timeout(500)
    check(tag + 'a new folder opens with its name selected', await pg.evaluate("document.activeElement?.id") == 'd-title' and await pg.input_value('#d-title') == 'New folder')
    await rename('This town')
    town = by(await sess(), 'This town')['id']
    check(tag + 'folder page: empty, and Add says it adds into the folder', 'This folder is empty.' in await text('#bmain') and 'to 📁 This town' in await text('#bnav'), await text('#bnav'))
    await pg.click('[data-add="page"]'); await pg.wait_for_timeout(500)
    await rename('Lore of the town'); await pg.fill('#d-md', '# Lore\n\nThe mill burned twice.'); await pg.wait_for_timeout(500)
    S = await sess(); check(tag + 'a page added in the folder lives in the folder', by(S, 'Lore of the town').get('parent') == town)
    await pg.click('[data-add="enc"]'); await pg.wait_for_timeout(300); await pg.click('[data-pk="new"]'); await pg.wait_for_timeout(600)
    S = await sess(); enc = [d for d in S['docs'] if d['type'] == 'enc'][0]
    check(tag + 'an encounter added next to that page goes into the same folder', enc.get('parent') == town, enc)
    rows = await nav()
    check(tag + 'sidebar: folder with its count, contents indented under it', rows[1][0].startswith('📂This town') and rows[1][0].endswith('2') and [r[1] for r in rows[2:4]] == ['16px', '16px'] and rows[0][1] != '16px', rows)
    # nest: a second folder at the top, then moved into This town
    await go(f'#session--{sid}'); await pg.wait_for_timeout(400); await pg.click('[data-add="folder"]'); await pg.wait_for_timeout(500); await rename('The tavern')
    S = await sess(); tav = by(S, 'The tavern')
    check(tag + 'a folder added from the overview is at the top level', 'parent' not in tav)
    await pg.select_option('#d-move', town); await pg.wait_for_timeout(400)
    S = await sess(); check(tag + 'Move to: a folder can go inside another folder', by(S, 'The tavern').get('parent') == town)
    opts = await pg.evaluate("[...document.querySelectorAll('#d-move option')].map(o => o.textContent.trim())")
    await go(f'#session--{sid}--{town}'); await pg.wait_for_timeout(400)
    opts2 = await pg.evaluate("[...document.querySelectorAll('#d-move option')].map(o => o.textContent.trim())")
    check(tag + 'a folder can\'t be moved into itself or a folder inside it', not any('This town' in o for o in opts) is False and not any('The tavern' in o or 'This town' in o for o in opts2), (opts, opts2))
    # move the page into the tavern, reorder inside This town
    await go(f'#session--{sid}--{by(S, "Lore of the town")["id"]}'); await pg.wait_for_timeout(400)
    await pg.select_option('#d-move', tav['id']); await pg.wait_for_timeout(400)
    rows = await nav(); names = [r[0] for r in rows]
    check(tag + 'moved page shows two levels deep', [r for r in rows if 'Lore of the town' in r[0]][0][1] == '32px', rows)
    i_enc = await pg.evaluate(f"JSON.parse(localStorage.getItem('{key}'))[0].docs.findIndex(d => d.type === 'enc')")
    before = names.index(next(n for n in names if 'The tavern' in n)) > names.index(next(n for n in names if n.endswith(enc['title'])))
    await jsclick(f'#bnav [data-dn="{i_enc}"]' if before else f'#bnav [data-up="{i_enc}"]'); await pg.wait_for_timeout(400)
    names2 = [r[0] for r in await nav()]
    after = names2.index(next(n for n in names2 if 'The tavern' in n)) > names2.index(next(n for n in names2 if n.endswith(enc['title'])))
    check(tag + '↑/↓ swaps neighbours inside a folder', before != after, (names, names2))
    first = (await sess())['docs'][0]['id']
    await jsclick('#bnav [data-up="0"]'); await pg.wait_for_timeout(300)
    check(tag + '↑ on the first item does nothing', (await sess())['docs'][0]['id'] == first)
    # folding
    await pg.click(f'[data-ftog="{town}"]'); await pg.wait_for_timeout(300)
    names3 = [r[0] for r in await nav()]
    check(tag + 'closing a folder hides what is in it', any('This town' in n for n in names3) and not any('tavern' in n or 'Lore' in n for n in names3), names3)
    await pg.reload(); await ready(); await pg.wait_for_timeout(1200)
    check(tag + 'folders, their contents and the closed state survive a reload', (await sess())['docs'] and by(await sess(), 'This town').get('collapsed') is True and by(await sess(), 'Lore of the town').get('parent') == tav['id'])
    await pg.click(f'[data-ftog="{town}"]'); await pg.wait_for_timeout(300)
    # overview, hub
    await go(f'#session--{sid}'); await pg.wait_for_timeout(400)
    ov = await pg.evaluate("[...document.querySelectorAll('.soverview .beitem')].map(a => [a.querySelector('b').innerText, a.style.getPropertyValue('--d')])")
    check(tag + 'overview lists the tree with depth', [o[1] for o in ov if 'Lore of the town' in o[0]] == ['2'] and any('This town' in o[0] for o in ov), ov)
    await go('#sessions'); await pg.wait_for_timeout(400)
    check(tag + 'session list counts items, not folders', '3 items' in await text('.sesc'), await text('.sesc'))
    # PDFs
    await go(f'#session--{sid}--{town}'); await pg.wait_for_timeout(400)
    pt = await pdf_text('#d-pdf')
    check(tag + 'folder PDF prints what is inside (incl. sub-folders)', 'The mill burned twice.' in pt, pt[:300])
    await go(f'#session--{sid}'); await pg.wait_for_timeout(400)
    pt = await pdf_text('#s-export'); cont = pt.split('Contents', 1)[-1][:600]
    check(tag + 'session export: contents grouped under folder names', 'This town' in cont and 'The tavern' in cont and cont.index('This town') < cont.index('The tavern') < cont.index('Lore of the town') and 'The mill burned twice.' in pt, cont)
    # removing a folder keeps its contents
    await go(f'#session--{sid}--{town}'); await pg.wait_for_timeout(400); await pg.click('#d-del'); await pg.wait_for_timeout(300)
    msg = await pg.evaluate("document.querySelector('[data-r=\"1\"]')?.parentElement.parentElement.innerText || ''")
    await pg.click('[data-r="1"]'); await pg.wait_for_timeout(500)
    S = await sess()
    check(tag + 'removing a folder says its items move up', 'move up one level' in msg, msg)
    check(tag + 'removing a folder keeps everything in it (moved up a level)', not any(d['id'] == town for d in S['docs']) and len(S['docs']) == 4 and 'parent' not in by(S, 'The tavern') and [d for d in S['docs'] if d['type'] == 'enc'][0].get('parent') is None and by(S, 'Lore of the town').get('parent') == tav['id'], S['docs'])
    check(tag + 'no JS errors', not errors, errors[:3])
    await b.close()


async def main():
    from playwright.async_api import async_playwright
    port = (lambda s: (s.bind(('127.0.0.1', 0)), s.getsockname()[1], s.close())[1])(socket.socket())
    srv = subprocess.Popen([sys.executable, os.path.join(ROOT, 'serve.py'), '--no-update', '--port', str(port)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.2)
    try:
        async with async_playwright() as p:
            for system in ['drawsteel', 'srd5']: await run_system(p, port, system)
    finally:
        srv.terminate()
    print(f'\n{sum(results)}/{len(results)} passed'); sys.exit(0 if all(results) else 1)

asyncio.run(main())
