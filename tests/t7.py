import asyncio, sys
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        for mob in (False, True):
            ctx = await b.new_context(viewport={'width':390,'height':844} if mob else {'width':1440,'height':900}, device_scale_factor=2 if mob else 1, is_mobile=mob, has_touch=mob, accept_downloads=True)
            pg = await ctx.new_page(); errs=[]
            pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto('http://127.0.0.1:8765/index.html#respite'); await pg.wait_for_timeout(3500)
            pre='m' if mob else 'd'
            await pg.screenshot(path=f'shots/{pre}resp1.png')
            fr = pg.frame_locator('#respframe')
            await fr.locator('#respiteBtn').click(); await pg.wait_for_timeout(600)
            await pg.screenshot(path=f'shots/{pre}resp2.png')
            if not mob:
                await fr.locator('[data-w=imbue]').click(); await pg.wait_for_timeout(300)
                await fr.locator('#imN').fill('Old sword'); await fr.locator('[data-w=imbue-new]').click(); await pg.wait_for_timeout(400)
                await fr.locator('.pageref').first.click(); await pg.wait_for_timeout(1200)
                print('after pageref hash', await pg.evaluate('location.hash'))
                await pg.goto('http://127.0.0.1:8765/index.html#respite'); await pg.wait_for_timeout(2500)
                await fr.locator('[data-tab=settings]').click(); await pg.wait_for_timeout(300)
                async with pg.expect_download(timeout=15000) as dl:
                    await fr.locator('[data-act=export]').click()
                d = await dl.value; print('export', d.suggested_filename)
            print(pre, 'ERR', errs[:5])
            await ctx.close()
        await b.close()
asyncio.run(main())
