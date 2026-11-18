import asyncio, sys
from playwright.async_api import async_playwright
PAGES=[('home',''),('monster','M'),('abilities','abilities'),('book','book--heroes--tests'),('encounter','encounter'),('montage','montage--encounters-rooftop-chase'),('negotiation','negotiation--fall-of-blackbottom-lamprey'),('sessions','S'),('cards','cards'),('respite','respite'),('classes','classes--fury')]
async def main():
    theme=sys.argv[1] if len(sys.argv)>1 else 'light'; mob=len(sys.argv)>2 and sys.argv[2]=='m'
    only=sys.argv[3].split(',') if len(sys.argv)>3 else None
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width':390,'height':844} if mob else {'width':1440,'height':900}, device_scale_factor=2 if mob else 1, is_mobile=mob, has_touch=mob)
        pg = await ctx.new_page(); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8765/index.html'); await pg.evaluate(f"localStorage.setItem('st_theme2', JSON.stringify('{theme}'))")
        await pg.goto('http://127.0.0.1:8765/index.html'); await pg.wait_for_timeout(4500)
        for name,h in PAGES:
            if only and name not in only: continue
            if h=='M': h='monsters--'+(await pg.evaluate("__mt().MONS.find(m=>m.name==='Goblin Assassin').gid"))
            if h=='S':
                h = await pg.evaluate("(()=>{const S=JSON.parse(localStorage.getItem('st_sessions')||'[]');return S.length?'session--'+S[0].id+'--'+S[0].docs[0].id:'sessions'})()")
            await pg.evaluate(f"location.hash='{h}'"); await pg.wait_for_timeout(1300)
            if name=='encounter':
                if await pg.query_selector('#dok'): await pg.click('#dok'); await pg.wait_for_timeout(300)
                if not await pg.evaluate("document.querySelectorAll('.ent').length"):
                    await pg.click('#frombook'); await pg.wait_for_timeout(300)
                    await pg.evaluate("[...document.querySelectorAll('.beitem')].find(b=>/Sandy Shore/.test(b.textContent)).click()"); await pg.wait_for_timeout(1200)
            await pg.screenshot(path=f'shots/v-{"m-" if mob else ""}{theme}-{name}.png')
        print('errs', errs); await b.close()
asyncio.run(main())
