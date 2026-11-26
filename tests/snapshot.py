"""Before/after snapshot of the whole app, for refactors that must not change what users see.

  python tests/snapshot.py snap-before.json     # serves site/ itself on a free port
  ... refactor, npm run build ...
  python tests/snapshot.py snap-after.json
  python tests/snapshot.py --diff snap-before.json snap-after.json

Seeds fixed test data (a card deck, an encounter, pins), loads the app once, then crawls every
page reachable from the menu and the home page: each list page, up to 3 entries per list,
class pages, book chapters, and the tools. For every page it stores #main's HTML, the title and
any JS errors. It also records the menu, a few searches, the roller, and whether the cards and
encounter PDF exports produce a file. Needs: pip install playwright && playwright install chromium
"""
import asyncio, json, os, re, socket, subprocess, sys, time, difflib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SITE = os.path.join(ROOT, 'site')


def seed_state():
    heroes = json.load(open(os.path.join(SITE, 'data', 'heroes.json'), encoding='utf-8'))
    mons = json.load(open(os.path.join(SITE, 'data', 'monsters.json'), encoding='utf-8'))['monsters']
    tr = heroes['treasures']
    pick = lambda typ: next(t['id'] for t in tr if t.get('type') == typ)
    ret = next(m for m in mons if 'Retainer' in (m.get('role') or ''))
    foes = [m for m in mons if m.get('ev') and 'Retainer' not in (m.get('role') or '')][:3]
    cards = {'deck': [{'k': 'item', 'id': pick('Consumable'), 'n': 2}, {'k': 'item', 'id': pick('Trinket'), 'n': 1},
                      {'k': 'item', 'id': pick('Leveled'), 'n': 1}, {'k': 'quest', 'id': 'q1', 'n': 1}, {'k': 'follower', 'id': 'f1', 'n': 1}],
             'quests': [{'id': 'q1', 'title': 'Find the Ember Gem', 'text': 'Recover the gem from the old mine.\nBring it back intact.', 'rewards': [{'label': 'Victories', 'value': '2'}]}],
             'followers': [{'id': 'f1', 'type': 'retainer', 'gid': ret['id'], 'name': 'Brannoc'}], 'tab': 'item'}
    enc = {'id': 'etest', 'name': 'Mine ambush', 'heroes': 4, 'level': 2, 'victories': 1, 'retainers': 0, 'setup': False,
           'groups': [{'id': 'g1', 'name': 'Group 1', 'entries': [{'gid': foes[0]['id'], 'n': 2}, {'gid': foes[1]['id'], 'n': 1}]},
                      {'id': 'g2', 'name': 'Group 2', 'entries': [{'gid': foes[2]['id'], 'n': 1}]}]}
    pins = ['abilities--' + heroes['abilities'][0]['id'], 'monsters--' + foes[0]['id'], 'conditions--' + heroes['conditions'][0]['id']]
    sessions = [{'id': 'stest', 'name': 'Session 1', 'date': '2026-01-02', 'heroes': 4, 'level': 2, 'victories': 1, 'docs': [
        {'id': 'd1', 'type': 'page', 'title': 'Session plan', 'md': '# Plan\n\n- Fight in the mine\n- [ ] Loose end\n\n> Read-aloud: the shaft is dark.\n\n| A | B |\n|---|---|\n| 1 | 2 |'},
        {'id': 'd2', 'type': 'enc', 'title': 'Mine ambush', 'enc': enc},
        {'id': 'd3', 'type': 'mtg', 'ref': 'heroes-fight-fire', 'title': 'Fight Fire'},
        {'id': 'd4', 'type': 'neg', 'ref': 'heroes-zola-honeycut', 'title': 'Zola Honeycut'}]}]
    return {'st_cards': cards, 'st_enc': enc, 'st_encs': [enc], 'st_pins': pins, 'st_sessions': sessions, 'st_theme2': 'light'}


def norm(html):
    html = re.sub(r'\s+', ' ', html or '')
    html = re.sub(r'\?v=[0-9a-f]{10}', '?v=<v>', html)  # asset version changes with every source edit
    html = re.sub(r'\b([esqfnmd])(?=[0-9a-z]*\d)[0-9a-z]{8,}\b', r'\1<id>', html)  # ids made from Date.now() (always contain a digit; words don't)
    return html.strip()


async def pdf_text(dl):
    """text of a downloaded PDF (tests/pdftext.mjs), so exports are compared by content, not just 'a file came out'"""
    path = await dl.path()
    r = subprocess.run(['node', os.path.join(HERE, 'pdftext.mjs'), str(path)], capture_output=True, text=True, encoding='utf-8', cwd=HERE)
    return norm(r.stdout) if r.returncode == 0 else 'pdftext failed: ' + r.stderr[-300:]


async def snapshot(out, root):
    global ROOT, SITE
    ROOT, SITE = root, os.path.join(root, 'site')
    from playwright.async_api import async_playwright
    port = (lambda s: (s.bind(('127.0.0.1', 0)), s.getsockname()[1], s.close())[1])(socket.socket())
    srv = subprocess.Popen([sys.executable, os.path.join(ROOT, 'serve.py'), '--no-update', '--port', str(port)], cwd=ROOT,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.2)
    base = f'http://127.0.0.1:{port}/index.html'
    res = {'pages': {}, 'errors': [], 'extra': {}}
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            ctx = await b.new_context(viewport={'width': 1280, 'height': 900}, accept_downloads=True)
            seed = seed_state()
            # repeatable Math.random (stone colours etc.), then the seed data
            await ctx.add_init_script('(() => { let s = 42; Math.random = () => (s = (s * 16807) % 2147483647) / 2147483647; })()')
            await ctx.add_init_script('(() => { if (sessionStorage.getItem("seeded")) return; sessionStorage.setItem("seeded", 1);'
                                      + ''.join(f'localStorage.setItem({json.dumps(k)}, {json.dumps(json.dumps(v))});' for k, v in seed.items()) + '})()')
            pg = await ctx.new_page()
            cur = {'page': 'boot'}
            pg.on('pageerror', lambda e: res['errors'].append(f"{cur['page']}: {e}"))
            pg.on('console', lambda m: m.type == 'error' and res['errors'].append(f"{cur['page']}: console: {m.text}"))
            await pg.goto(base); await pg.wait_for_function("document.querySelector('#loading')?.style.display === 'none'", timeout=60000)
            await pg.wait_for_timeout(2500)  # built-in packs load in the background

            async def visit(h):
                cur['page'] = h or 'home'
                await pg.evaluate("h => { location.hash = h; }", h)
                await pg.wait_for_timeout(450)
                if h.startswith('#cards'): await pg.wait_for_timeout(900)  # icon set loads
                main = await pg.evaluate("document.querySelector('#main')?.innerHTML || ''")
                res['pages'][h or 'home'] = {'title': await pg.title(), 'html': norm(main)}
                links = await pg.evaluate("[...document.querySelectorAll('#main a[href^=\"#\"]')].map(a => a.getAttribute('href'))")
                # list pages: entries open by clicking rows; take 6 spread over the list (first .. last)
                rows = await pg.evaluate("[...document.querySelectorAll('#lbody tr.r[data-id]')].map(r => r.dataset.id)")
                if rows and '--' not in h:
                    n = len(rows); idx = sorted({0, 1, n // 4, n // 2, 3 * n // 4, n - 1})
                    entries.extend(h + '--' + rows[i] for i in idx if h + '--' + rows[i] not in entries)
                return links

            res['extra']['menu'] = norm(await pg.evaluate("document.querySelector('#menu').innerHTML"))
            seen, queue, entries = set(), [''], []
            queue += await pg.evaluate("[...document.querySelectorAll('#menu a[href^=\"#\"]')].map(a => a.getAttribute('href'))")
            per_prefix = {}
            while queue and len(seen) < 220:
                h = queue.pop(0)
                if h in seen or h.startswith('#!'): continue
                seen.add(h)
                links = await visit(h)
                for l in links:
                    if l in seen or l in queue or l.startswith('#!'): continue
                    key = l.split('--')[0] + ('--' + l.split('--')[1] if l.startswith('#book--') and l.count('--') >= 1 else '')
                    if l.count('--') >= 1:  # entries / chapters: keep the crawl bounded
                        per_prefix[key] = per_prefix.get(key, 0) + 1
                        if per_prefix[key] > (10 if key == '#session' else 4): continue
                    queue.append(l)
            for h in entries:  # list entries (stat blocks, abilities, …)
                if h not in seen: seen.add(h); await visit(h)
            # search
            for q in ['grab', 'goblin', 'fury', 'potion']:
                cur['page'] = 'search:' + q
                await pg.fill('#q', q); await pg.wait_for_timeout(400)
                res['extra']['search:' + q] = norm(await pg.evaluate("document.querySelector('#sres')?.innerHTML || ''"))
                await pg.fill('#q', ''); await pg.keyboard.press('Escape')
            # ---- interactions that go through system hooks ----
            X = res['extra']
            async def grab(sel): return norm(await pg.evaluate("s => document.querySelector(s)?.innerHTML || ''", sel))
            ab = next((h for h in entries if h.startswith('#abilities--')), None)
            if ab:  # roll button on an ability (seeded Math.random → same dice)
                cur['page'] = 'roll'; await visit(ab)
                if await pg.query_selector('#main .rollbtn'):
                    await pg.click('#main .rollbtn'); await pg.wait_for_timeout(300)
                    X['roll'] = await grab('#rlog') + ' | toast: ' + await pg.evaluate("document.querySelector('#toast').innerText")
            cur['page'] = 'hover'
            for h in [x for x in res['pages'] if x.startswith('#book--heroes--')]:  # hover preview of a linked condition
                await visit(h)
                if await pg.query_selector('#main .lnk[data-go]'):
                    await pg.hover('#main .lnk[data-go]'); await pg.wait_for_timeout(500); X['hover'] = await grab('#hov'); break
            mon = next((h for h in entries if h.startswith('#monsters--')), None)
            if mon:  # "+ Encounter" on a stat block
                cur['page'] = 'addenc'; await visit(mon)
                if await pg.query_selector('#main [data-addenc]'):
                    await pg.click('#main [data-addenc]'); await pg.wait_for_timeout(300)
                    X['addenc:toast'] = await pg.evaluate("document.querySelector('#toast').innerText"); await visit('#encounter'); X['addenc:encounter'] = res['pages']['#encounter']['html']
            # cards: every tab, the editors and the quests-from-adventure dialog
            async def dialog(click, key):
                if not await pg.query_selector(click): X[key] = 'no ' + click; return
                await pg.click(click); await pg.wait_for_timeout(400)
                X[key] = norm(await pg.evaluate("[...document.querySelectorAll('.dlg')].map(d => d.innerHTML).join('|')"))
                await pg.evaluate("document.querySelectorAll('.dlg').forEach(d => d.remove())")
            cur['page'] = 'cards'
            await visit('#cards')
            for tab in await pg.evaluate("[...document.querySelectorAll('[data-ctab]')].map(b => b.dataset.ctab)"):
                await pg.click(f'[data-ctab="{tab}"]'); await pg.wait_for_timeout(400); X['cards:tab:' + tab] = await grab('#main')
                for sel in ['#q-new', '#q-adv', '#f-ret', '#f-art', '#f-sage']:
                    if await pg.query_selector(sel): await dialog(sel, f'cards:{tab}:{sel}')
            await pg.click('[data-ctab="item"]'); await pg.wait_for_timeout(300)
            if await pg.query_selector('#c-q'):
                await pg.fill('#c-q', 'potion'); await pg.wait_for_timeout(300); X['cards:search'] = await grab('#c-qres'); await pg.fill('#c-q', '')
            await dialog('[data-cust="0"]', 'cards:customise')
            # sessions: the add pickers, each item's PDF, and the whole-session export
            cur['page'] = 'session'
            await visit('#session--stest')
            for kind in ['enc', 'mtg', 'neg']: await dialog(f'[data-add="{kind}"]', 'session:add:' + kind)
            for did in ['d1', 'd2', 'd3', 'd4']:
                await visit('#session--stest--' + did)
                try:
                    async with pg.expect_download(timeout=60000) as dl: await pg.click('#d-pdf')
                    d0 = await dl.value; X['session:pdf:' + did] = 'ok ' + d0.suggested_filename; X['session:pdf:' + did + ':text'] = await pdf_text(d0)
                except Exception as e: X['session:pdf:' + did] = 'FAILED ' + type(e).__name__
            await visit('#session--stest')
            try:
                async with pg.expect_download(timeout=90000) as dl: await pg.click('#s-export')
                d0 = await dl.value; X['session:export'] = 'ok ' + d0.suggested_filename; X['session:export:text'] = await pdf_text(d0)
            except Exception as e: X['session:export'] = 'FAILED ' + type(e).__name__
            # roller panel and footer (static markup today, rendered from the system later)
            X['roller'] = await grab('#roller'); X['footer'] = await pg.evaluate("document.querySelector('footer')?.innerHTML || ''")
            X['fab'] = await pg.evaluate("document.querySelector('#fab')?.outerHTML || ''")
            # import preview of a generated PDF (parser module + system import stats)
            pdf = os.path.join(os.path.dirname(os.path.abspath(out)), 'snapshot-fixture.pdf')
            subprocess.run(['node', os.path.join(HERE, 'make_fixture_pdf.mjs'), pdf], check=True, stdout=subprocess.DEVNULL)
            cur['page'] = 'import'; await visit('#import')
            await pg.set_input_files('#pdffile', pdf)
            try:
                await pg.wait_for_selector('#pvsave', timeout=60000); X['import:preview'] = await grab('#stage')
            except Exception as e: X['import:preview'] = 'FAILED ' + await grab('#stage')
            # mobile: Browse sheet and tap-to-peek on a linked term
            mob = await ctx.new_page(); await mob.set_viewport_size({'width': 390, 'height': 844})
            mob.on('pageerror', lambda e: res['errors'].append(f"mobile: {e}"))
            await mob.goto(base); await mob.wait_for_function("document.querySelector('#loading')?.style.display === 'none'", timeout=60000); await mob.wait_for_timeout(1500)
            await mob.click('#tabbar button[data-tab="browse"]'); await mob.wait_for_timeout(300)
            X['mobile:browse'] = norm(await mob.evaluate("document.querySelector('#sheet').innerHTML"))
            for h in [x for x in res['pages'] if x.startswith('#book--heroes--')]:
                await mob.evaluate("h => { location.hash = h; }", h); await mob.wait_for_timeout(500)
                if await mob.query_selector('#main .lnk[data-go]'):
                    await mob.click('#main .lnk[data-go]'); await mob.wait_for_timeout(300)
                    X['mobile:peek'] = norm(await mob.evaluate("document.querySelector('#peek').innerHTML")); break
            await mob.close()
            # PDF exports produce a file
            for h, sel in [('#cards', '#c-pdf'), ('#encounter', None)]:
                cur['page'] = 'export' + h
                await visit(h)
                btn = sel or await pg.evaluate("(() => { const b = [...document.querySelectorAll('#main button')].find(b => /pdf/i.test(b.textContent)); if (!b) return null; b.id = b.id || 'snap-pdf'; return '#' + b.id; })()")
                if not btn: res['extra']['export' + h] = 'no PDF button'; continue
                try:
                    async with pg.expect_download(timeout=60000) as dl:
                        await pg.click(btn)
                    d = await dl.value
                    res['extra']['export' + h] = 'ok ' + d.suggested_filename; res['extra']['export' + h + ':text'] = await pdf_text(d)
                except Exception as e:
                    toast = await pg.evaluate("document.querySelector('#toast')?.innerText || ''")
                    res['extra']['export' + h] = f'FAILED {type(e).__name__} toast={toast!r}'
            await b.close()
    finally:
        srv.terminate()
    json.dump(res, open(out, 'w', encoding='utf-8'), indent=0)
    print(f"{len(res['pages'])} pages, {len(res['errors'])} JS errors, exports: "
          + ', '.join(f"{k}={v}" for k, v in res['extra'].items() if k.startswith('export') and not k.endswith(':text')))
    for e in res['errors'][:20]: print('  ERR', e)


def diff(a, b):
    A, B = json.load(open(a, encoding='utf-8')), json.load(open(b, encoding='utf-8'))
    bad = 0
    for k in sorted(set(A['pages']) | set(B['pages'])):
        x, y = A['pages'].get(k), B['pages'].get(k)
        if x != y:
            bad += 1
            print(f'== page {k}: ' + ('only in before' if not y else 'only in after' if not x else 'differs'))
            if x and y:
                for l in list(difflib.unified_diff(re.split(r'(?=<)', x['html']), re.split(r'(?=<)', y['html']), lineterm='', n=0))[2:14]: print('   ', l[:200])
                if x['title'] != y['title']: print('    title:', x['title'], '->', y['title'])
    for k in sorted(set(A['extra']) | set(B['extra'])):
        if A['extra'].get(k) != B['extra'].get(k):
            bad += 1; print(f'== {k} differs:'); print('    before:', str(A['extra'].get(k))[:300]); print('    after: ', str(B['extra'].get(k))[:300])
    if A['errors'] != B['errors']: bad += 1; print('== JS errors before:', A['errors'], '\n   after:', B['errors'])
    print(f"\n{len(A['pages'])} vs {len(B['pages'])} pages; {'IDENTICAL' if not bad else str(bad) + ' differences'}")
    return bad


if __name__ == '__main__':
    if sys.argv[1] == '--diff': sys.exit(1 if diff(sys.argv[2], sys.argv[3]) else 0)
    # --root DIR: snapshot another checkout (e.g. a git worktree of main) instead of this one
    asyncio.run(snapshot(sys.argv[1], os.path.abspath(sys.argv[sys.argv.index('--root') + 1]) if '--root' in sys.argv else ROOT))
