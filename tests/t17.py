import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width':1440,'height':900}, accept_downloads=True)
        pg = await ctx.new_page(); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8765/index.html#encounter'); await pg.wait_for_timeout(4500)
        await pg.click('#dok'); await pg.wait_for_timeout(300)
        await pg.click('#frombook'); await pg.wait_for_timeout(300)
        n = await pg.evaluate("(()=>{const b=[...document.querySelectorAll('.beitem')];return b.length})()")
        # find a table with captain (minion squad + non-minion in same row)
        await pg.evaluate("[...document.querySelectorAll('.beitem')].find(b=>/Bone Brawl|Alleys/.test(b.textContent)).click()"); await pg.wait_for_timeout(1200)
        for i in range(3):
            await pg.click('#stonebtn'); await pg.wait_for_timeout(300)
            print(await pg.evaluate("[...document.querySelectorAll('.ent')].map(e=>e.querySelector('.ent-n a').textContent+': '+[...e.querySelectorAll('.stone')].map(s=>s.title).join(', ')).join(' | ')"))
        await pg.screenshot(path='shots/s3.png')
        async with pg.expect_download(timeout=30000) as dl:
            await pg.click('#encpdf')
        d = await dl.value; await d.save_as('/home/claude/shots/stones2.pdf')
        print('errs', errs); await b.close()
asyncio.run(main())
