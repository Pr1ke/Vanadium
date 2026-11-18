import asyncio, time
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        for mob in (False, True):
          for h in ['', 'montage', 'encounter', 'negotiation', 'monsters', 'book--encounters--aixco-hollow', 'respite']:
            ctx = await b.new_context(viewport={'width':390,'height':844} if mob else {'width':1440,'height':900}, is_mobile=mob, has_touch=mob)
            pg = await ctx.new_page(); errs=[]
            pg.on('pageerror', lambda e: errs.append(str(e)))
            t=time.time(); await pg.goto('http://127.0.0.1:8765/index.html#'+h)
            try: await pg.wait_for_selector('#loading', state='hidden', timeout=20000); dt=round(time.time()-t,2)
            except Exception: dt='STUCK'
            await pg.wait_for_timeout(2500)
            print(mob, h or '(home)', dt, errs[:2]); await ctx.close()
        await b.close()
asyncio.run(main())
