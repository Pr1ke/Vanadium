import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width':1440,'height':900}, accept_downloads=True)
        pg = await ctx.new_page(); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8765/index.html#cards'); await pg.wait_for_timeout(4500)
        await pg.wait_for_selector('#c-q', timeout=30000); await pg.fill('#c-q', 'black ash dart'); await pg.wait_for_timeout(300); await pg.dispatch_event('#c-qres [data-addi] >> nth=0', 'mousedown'); await pg.wait_for_timeout(200)
        await pg.click('[data-ctab="quest"]'); await pg.wait_for_timeout(200)
        await pg.click('#q-adv'); await pg.wait_for_timeout(800)
        await pg.screenshot(path='shots/q1.png')
        print(await pg.evaluate("[...document.querySelectorAll('.qac')].map(x=>x.innerText.replace(/\\n/g,' | ')).join('\\n')"))
        await pg.click('#qa-ok'); await pg.wait_for_timeout(400)
        await pg.click('#q-new'); await pg.wait_for_timeout(200)
        await pg.fill('#qe-t','The Fey Satchel'); await pg.fill('#qe-x','Brother Aldo asked you to investigate the missing children of Harrowfield.')
        await pg.fill('[data-rv="0"]','2'); await pg.fill('[data-rv="1"]','Healing Potion')
        await pg.click('#qe-add'); await pg.select_option('[data-rl="2"]','Title'); await pg.fill('[data-rv="2"]','Fey Friend')
        await pg.click('#qe-add'); await pg.select_option('[data-rl="3"]','Project Source'); await pg.fill('[data-rv="3"]','Quantum Satchel')
        await pg.click('#qe-ok'); await pg.wait_for_timeout(300)
        await pg.click('[data-ctab="follower"]'); await pg.click('#f-ret'); await pg.wait_for_timeout(300)
        await pg.screenshot(path='shots/q2.png')
        await pg.click('#fe-ok'); await pg.wait_for_timeout(300)
        await pg.click('#f-art'); await pg.wait_for_timeout(200); await pg.fill('#fe-n','Grisha'); await pg.fill('#fe-a','Dwarf')
        for s in ['Alchemy','Blacksmithing','Carpentry','Jewelry']:
            await pg.check(f'[data-sk="{s}"]'); await pg.wait_for_timeout(80)
        await pg.fill('#fe-l1','Zaliac'); await pg.click('#fe-ok'); await pg.wait_for_timeout(300)
        await pg.screenshot(path='shots/q3.png', full_page=True)
        async with pg.expect_download(timeout=30000) as d:
            await pg.click('#c-pdf')
        v = await d.value; await v.save_as('/home/claude/shots/cards2.pdf')
        print('errs', errs); await b.close()
asyncio.run(main())
