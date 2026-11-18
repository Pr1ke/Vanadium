import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        pg = await b.new_page(viewport={'width':1440,'height':900})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('file:///home/claude/steeltools.html#abilities--repent'); await pg.wait_for_timeout(800)
        await pg.click('#lview .rollbtn'); await pg.wait_for_timeout(300)
        await pg.click('#lview .ab-pin'); await pg.wait_for_timeout(200)
        await pg.click('#lfb'); await pg.click('.pill[data-v="Talent"]'); await pg.wait_for_timeout(200)
        await pg.screenshot(path='shots/i1.png')
        await pg.fill('#q','prone'); await pg.wait_for_timeout(300)
        await pg.screenshot(path='shots/i2.png')
        await pg.keyboard.press('Enter'); await pg.wait_for_timeout(500)
        print('hash', await pg.evaluate('location.hash'))
        await pg.goto('file:///home/claude/steeltools.html#classes--talent'); await pg.wait_for_timeout(600)
        await pg.click('.tab[data-tab=abilities]'); await pg.wait_for_timeout(400)
        await pg.screenshot(path='shots/i3.png')
        await pg.click('.pref >> nth=0') if await pg.locator('.pref').count() else None
        await pg.wait_for_timeout(600); print('hash2', await pg.evaluate('location.hash'))
        await pg.screenshot(path='shots/i4.png')
        m = await b.new_page(viewport={'width':390,'height':800})
        await m.goto('file:///home/claude/steeltools.html#kits--sword-and-board'); await m.wait_for_timeout(800)
        await m.screenshot(path='shots/m1.png')
        print('ERRORS', errs)
        await b.close()
asyncio.run(main())
