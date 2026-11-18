import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width':1440,'height':900}, accept_downloads=True)
        pg = await ctx.new_page(); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append('c:'+m.text) if m.type=='error' else None)
        async def dl(sel, name):
            try:
                async with pg.expect_download(timeout=15000) as d:
                    await pg.click(sel)
                v = await d.value; await v.save_as('/home/claude/shots/'+name); print('saved', name)
            except Exception as e:
                print('FAIL', name, errs[-3:], await pg.evaluate("document.querySelector('#toast')?.textContent"))
        await pg.goto('http://127.0.0.1:8765/index.html#montage--encounters-bait-and-ambush'); await pg.wait_for_timeout(4500)
        await dl('#mt-pdf','montage.pdf')
        await pg.evaluate("location.hash='negotiation--fall-of-blackbottom-lamprey'"); await pg.wait_for_timeout(800)
        await dl('#ng-pdf','neg.pdf')
        # sessions
        await pg.evaluate("location.hash='sessions'"); await pg.wait_for_timeout(500)
        await pg.click('#snew'); await pg.wait_for_timeout(500)
        await pg.screenshot(path='shots/se1.png')
        await pg.click('[data-add="page"]'); await pg.wait_for_timeout(400)
        await pg.fill('#d-md', '# The Docks\n\nThe heroes arrive at **dawn**. *Fog* everywhere.\n\n> The gulls scream as the fog parts.\n\n- Talk to the harbormaster\n- [ ] Find the ledger\n- [x] Pay the toll\n\n| NPC | Wants |\n|---|---|\n| Mara | Gold |\n\n---\n\n1. First\n2. Second')
        await pg.dispatch_event('#d-md','input'); await pg.wait_for_timeout(500)
        await pg.screenshot(path='shots/se2.png')
        await pg.click('#d-edit'); await pg.wait_for_timeout(300)
        await pg.click('[data-add="mtg"]'); await pg.wait_for_timeout(300)
        await pg.fill('#pk-q','rooftop'); await pg.click('.beitem:visible'); await pg.wait_for_timeout(400)
        await pg.click('[data-add="neg"]'); await pg.wait_for_timeout(300)
        await pg.fill('#pk-q','lamprey'); await pg.click('.beitem:visible'); await pg.wait_for_timeout(400)
        await pg.click('[data-add="enc"]'); await pg.wait_for_timeout(300)
        await pg.click('.beitem >> text=From a book…'); await pg.wait_for_timeout(300)
        await pg.evaluate("[...document.querySelectorAll('.beitem')].find(b=>/Sandy Shore/.test(b.textContent)).click()"); await pg.wait_for_timeout(600)
        await pg.screenshot(path='shots/se3.png')
        await pg.click('#d-open'); await pg.wait_for_timeout(800)
        await pg.click('[data-inc="0:0"]'); await pg.wait_for_timeout(300)
        await pg.screenshot(path='shots/se4.png')
        await pg.click('.sessbar a'); await pg.wait_for_timeout(600)
        print('after edit', await pg.evaluate("document.querySelector('.ent-n a')?.textContent"))
        await dl('#s-export','session.pdf')
        # cards
        await pg.evaluate("location.hash='cards'"); await pg.wait_for_timeout(500)
        await pg.wait_for_selector('#c-q', timeout=30000); await pg.fill('#c-q', 'black ash dart'); await pg.wait_for_timeout(300); await pg.dispatch_event('#c-qres [data-addi] >> nth=0', 'mousedown'); await pg.wait_for_timeout(200)
        await pg.wait_for_selector('#c-q', timeout=30000); await pg.fill('#c-q', 'adaptive secon'); await pg.wait_for_timeout(300); await pg.dispatch_event('#c-qres [data-addi] >> nth=0', 'mousedown'); await pg.wait_for_timeout(200)
        await pg.select_option('#c-addall', 'Trinket'); await pg.wait_for_timeout(300)
        await pg.screenshot(path='shots/c1.png')
        await dl('#c-pdf','cards.pdf')
        print('errs', errs); await b.close()
asyncio.run(main())
