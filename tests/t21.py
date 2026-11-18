import asyncio, time
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width':1440,'height':900})
        pg = await ctx.new_page(); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8765/index.html#book--fall-of-blackbottom--chapter-1-firefall'); await pg.wait_for_timeout(6000)
        print('bk imgs', await pg.evaluate("document.querySelectorAll('figure.bkimg img').length"))
        await pg.evaluate("document.querySelectorAll('figure.bkimg')[2].scrollIntoView({block:'center'})"); await pg.wait_for_timeout(800)
        await pg.screenshot(path='shots/im1.png')
        gid = await pg.evaluate("__mt().MONS.find(m=>m.name==='Dwarf Catchpole').gid")
        await pg.evaluate(f"location.hash='monsters--{gid}'"); await pg.wait_for_timeout(1500)
        await pg.screenshot(path='shots/im2.png')
        await pg.click('.mon-art img'); await pg.wait_for_timeout(400); await pg.screenshot(path='shots/im3.png'); await pg.click('.lightbox')
        # import crack the sun
        await pg.evaluate("location.hash='import'"); await pg.wait_for_timeout(600)
        t=time.time()
        await pg.set_input_files('#pdffile','/mnt/user-data/uploads/fd8c6eff-Crack_the_Sun_Act_1_Monsters.pdf')
        await pg.wait_for_selector('.pvstats', timeout=120000); print('cts import s', round(time.time()-t,1))
        print(await pg.evaluate("document.querySelector('.pvstats').innerText.replace(/\\n/g,' ')"))
        await pg.screenshot(path='shots/im4.png', full_page=True)
        # browser image extraction on blackbottom
        await pg.evaluate("location.hash='library'"); await pg.wait_for_timeout(300); await pg.evaluate("location.hash='import'"); await pg.wait_for_timeout(600)
        t=time.time()
        await pg.set_input_files('#pdffile','/mnt/user-data/uploads/10602b2c-Fall_of_Blackbottom_v1.0.pdf')
        await pg.wait_for_selector('.pvstats', timeout=400000); print('bb import s', round(time.time()-t,1))
        print(await pg.evaluate("document.querySelector('.pvstats').innerText.replace(/\\n/g,' ')"))
        print(await pg.evaluate("(()=>{const i=pending?null:null;return 1})()") if False else '')
        print('errs', errs); await b.close()
asyncio.run(main())
