import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width':1440,'height':900})
        pg = await ctx.new_page(); errs=[]
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8765/index.html#book--encounters--rooftop-chase'); await pg.wait_for_timeout(5000)
        await pg.screenshot(path='shots/b1.png')
        await pg.evaluate("location.hash='book--encounters--aixco-hollow'"); await pg.wait_for_timeout(1000)
        n = await pg.evaluate("document.querySelectorAll('.loadencbtn').length"); print('loadbtns', n)
        await pg.evaluate("document.querySelector('.loadencbtn').scrollIntoView({block:'center'})"); await pg.wait_for_timeout(300)
        await pg.screenshot(path='shots/b2.png')
        print('mtbtns', await pg.evaluate("location.hash='book--encounters--bait-and-ambush'") , end=' ')
        await pg.wait_for_timeout(800); print(await pg.evaluate("document.querySelectorAll('.negrunbtn').length"))
        await pg.evaluate("location.hash='book--heroes--tests'"); await pg.wait_for_timeout(800); print('heroes mt', await pg.evaluate("[...document.querySelectorAll('.negrunbtn')].map(a=>a.textContent)"))
        # search
        await pg.fill('#q','rooftop'); await pg.wait_for_timeout(500); print(await pg.evaluate("[...document.querySelectorAll('.sr')].slice(0,4).map(x=>x.textContent)"))
        print('errs', errs); await b.close()
asyncio.run(main())
