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
        await pg.evaluate("[...document.querySelectorAll('.beitem')].find(b=>/Sandy Shore/.test(b.textContent)||/Aixco/.test(b.textContent)).click()"); await pg.wait_for_timeout(1200)
        await pg.screenshot(path='shots/s1.png')
        print(await pg.evaluate("JSON.stringify(JSON.parse(localStorage.getItem('st_enc')).stones)"))
        async with pg.expect_download(timeout=30000) as dl:
            await pg.click('#encpdf')
        d = await dl.value; await d.save_as('/home/claude/shots/stones.pdf')
        await pg.click('#stonecfg'); await pg.wait_for_timeout(300); await pg.screenshot(path='shots/s2.png')
        print('errs', errs); await b.close()
asyncio.run(main())
