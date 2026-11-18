import sys, asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        pg = await b.new_page(viewport={'width':1440,'height':900})
        errs=[]
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append('console:'+m.text) if m.type=='error' else None)
        await pg.goto('file:///home/claude/steeltools.html')
        await pg.wait_for_timeout(800)
        for h in sys.argv[1:]:
            name,hash_=h.split('=',1)
            await pg.evaluate(f"location.hash={hash_!r}")
            await pg.wait_for_timeout(700)
            await pg.screenshot(path=f'/home/claude/shots/{name}.png')
        print('ERRORS', errs)
        await b.close()
asyncio.run(main())
