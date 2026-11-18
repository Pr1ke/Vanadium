import asyncio, sys
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width':1440,'height':1000}, accept_downloads=True)
        pg = await ctx.new_page(); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8765/index.html#cards'); await pg.wait_for_timeout(6000)
        await pg.click('[data-ctab="item"]'); await pg.wait_for_timeout(300)
        for q in ['healing','ring','blade','cloak']:
            await pg.fill('#c-q', q); await pg.wait_for_timeout(250)
            await pg.dispatch_event('#c-qres [data-addi] >> nth=0', 'mousedown'); await pg.wait_for_timeout(400)
        await pg.fill('#c-q','dar'); await pg.wait_for_timeout(300)
        await pg.screenshot(path='shots/cv0.png')
        await pg.press('#c-q','Escape')
        await pg.screenshot(path='shots/cv1.png', full_page=True)
        await pg.click('.cgrid .icard >> nth=0'); await pg.wait_for_timeout(400)
        await pg.click('#cc-pick'); await pg.wait_for_timeout(800)
        await pg.fill('#ip-q','dragon'); await pg.wait_for_timeout(700)
        await pg.screenshot(path='shots/cv2.png')
        await pg.click('#ip-res [data-ic] >> nth=2'); await pg.wait_for_timeout(300)
        await pg.click('[data-col="#b0406f"]'); await pg.wait_for_timeout(200)
        await pg.screenshot(path='shots/cv3.png')
        await pg.click('#cc-ok'); await pg.wait_for_timeout(300)
        for st in ['modern','classic','bold','minimal']:
            await pg.click(f'[data-cstyle="{st}"]'); await pg.wait_for_timeout(400)
            await pg.screenshot(path=f'shots/cs-{st}.png', full_page=True)
            async with pg.expect_download(timeout=60000) as d:
                await pg.click('#c-pdf')
            v = await d.value; await v.save_as(f'/home/claude/shots/cards-{st}.pdf')
        print('errs', errs); await b.close()
asyncio.run(main())
