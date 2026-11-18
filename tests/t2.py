import sys, asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        mob = len(sys.argv)>1 and sys.argv[1]=='m'
        ctx = await b.new_context(viewport={'width':390,'height':844} if mob else {'width':1440,'height':900}, device_scale_factor=2 if mob else 1, is_mobile=mob, has_touch=mob)
        pg = await ctx.new_page()
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append('console:'+m.text) if m.type in ('error','warning') else None)
        await pg.goto('http://127.0.0.1:8765/index.html'); await pg.wait_for_timeout(2500)
        for h in sys.argv[2:]:
            name,hash_=h.split('=',1)
            if hash_.startswith('JS:'): await pg.evaluate(hash_[3:]); await pg.wait_for_timeout(600)
            elif hash_.startswith('CLICK:'): await pg.click(hash_[6:]); await pg.wait_for_timeout(600)
            else:
                await pg.evaluate(f"location.hash={hash_!r}"); await pg.wait_for_timeout(900)
            await pg.screenshot(path=f'/home/claude/shots/{name}.png')
        print('ERRORS', errs[:10])
        await b.close()
asyncio.run(main())
