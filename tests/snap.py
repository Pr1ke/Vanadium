import asyncio, re
from playwright.async_api import async_playwright
PAGES=[('home',''),('monster','monsters--'),('book','book--heroes--tests'),('encounter','encounter'),('montage','montage--encounters-rooftop-chase'),('negotiation','negotiation--fall-of-blackbottom-lamprey'),('session','sessions'),('cards','cards'),('abilities','abilities')]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        for mob in (False,True):
            ctx = await b.new_context(viewport={'width':390,'height':844} if mob else {'width':1440,'height':900}, device_scale_factor=2 if mob else 1, is_mobile=mob, has_touch=mob)
            pg = await ctx.new_page()
            await pg.goto('http://127.0.0.1:8765/index.html'); await pg.wait_for_timeout(4500)
            await pg.evaluate("""(()=>{const d=__mt();const E=JSON.parse(localStorage.getItem('st_enc')||'null');})()""")
            for name,h in PAGES:
                if mob and name not in ('home','monster','encounter','book'): continue
                if name=='monster': h='monsters--'+(await pg.evaluate("__mt().MONS.find(m=>m.name==='Goblin Assassin')?.gid||__mt().MONS[0].gid"))
                await pg.evaluate(f"location.hash='{h}'"); await pg.wait_for_timeout(1200)
                if name=='encounter':
                    if await pg.query_selector('#dok'): await pg.click('#dok'); await pg.wait_for_timeout(300)
                    if not await pg.evaluate("document.querySelectorAll('.ent').length"):
                        await pg.click('#frombook'); await pg.wait_for_timeout(300)
                        await pg.evaluate("[...document.querySelectorAll('.beitem')].find(b=>/Sandy Shore/.test(b.textContent)).click()"); await pg.wait_for_timeout(1200)
                tag=('m-' if mob else '')+name
                await pg.screenshot(path=f'.superdesign/snap/{tag}.png')
                if not mob:
                    html = await pg.evaluate("(()=>{const c=document.body.cloneNode(true);c.querySelectorAll('script,svg path').forEach(x=>x.remove());c.querySelectorAll('#roller,#sheet,#peek,#msearch,#hov,#toast,#scrim,#tabbar').forEach(x=>x.remove());return c.innerHTML})()")
                    html = re.sub(r'\s+',' ',html)
                    open(f'.superdesign/snap/{tag}.html','w').write(html)
                    print(tag, len(html))
            await ctx.close()
        await b.close()
asyncio.run(main())
