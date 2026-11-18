import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(); pg = await ctx.new_page(); reqs=[]; errs=[]
        pg.on('request', lambda r: reqs.append(r.url.split('/')[-1]) if 'data/' in r.url else None); pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8765/index.html'); await pg.wait_for_timeout(4000)
        print('first', reqs, await pg.evaluate("document.querySelectorAll('.negc,.card,a').length"))
        reqs.clear(); await pg.reload(); await pg.wait_for_timeout(3000)
        print('second', reqs, errs, await pg.evaluate("caches.keys()"))
        await pg.goto('http://127.0.0.1:8765/index.html#montage'); await pg.wait_for_timeout(1500); print(await pg.evaluate("document.querySelectorAll('.mtc').length"))
        await b.close()
asyncio.run(main())
