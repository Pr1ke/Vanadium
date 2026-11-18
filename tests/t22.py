import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width':1440,'height':900})
        pg = await ctx.new_page(); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8765/index.html#import'); await pg.wait_for_timeout(5000)
        await pg.set_input_files('#pdffile','/mnt/user-data/uploads/fd8c6eff-Crack_the_Sun_Act_1_Monsters.pdf')
        await pg.wait_for_selector('#pvsave', timeout=60000); await pg.click('#pvsave'); await pg.wait_for_timeout(2500)
        gid = await pg.evaluate("__mt().MONS.find(m=>m.name==='Bleeding Tree')?.gid")
        await pg.evaluate(f"location.hash='monsters--{gid}'"); await pg.wait_for_timeout(1200)
        await pg.screenshot(path='shots/im5.png', full_page=False)
        await pg.evaluate("document.querySelector('.ent, .lp-right')?.scrollBy(0,700)"); 
        await pg.goto('http://127.0.0.1:8765/index.html#encounter'); await pg.wait_for_timeout(5000)
        print(await pg.evaluate("__mt().MONS.filter(m=>m.pack&&m.pack.startsWith('imp-')).length"))
        print('errs', errs); await b.close()
asyncio.run(main())
