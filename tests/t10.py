import asyncio, json, sys
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        mob = len(sys.argv)>1
        ctx = await b.new_context(viewport={'width':390,'height':844} if mob else {'width':1440,'height':900}, device_scale_factor=2 if mob else 1, is_mobile=mob, has_touch=mob)
        pg = await ctx.new_page(); errs=[]
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pre='mm' if mob else 'm'
        await pg.goto('http://127.0.0.1:8765/index.html#montage'); await pg.wait_for_timeout(5000)
        print(await pg.evaluate("(()=>{const X=__mt();X.refreshNegotiations();return X.allNegs().filter(n=>n.pack==='encounters').map(n=>n.name)})()"))
        await pg.screenshot(path=f'shots/{pre}1.png')
        await pg.evaluate("location.hash='montage--encounters-bait-and-ambush'"); await pg.wait_for_timeout(800)
        await pg.screenshot(path=f'shots/{pre}2.png', full_page=True)
        await pg.fill('#mt-h','4'); await pg.dispatch_event('#mt-h','change'); await pg.wait_for_timeout(200)
        await pg.click('#mt-begin'); await pg.wait_for_timeout(300)
        await pg.click('[data-ch="0"]'); await pg.wait_for_timeout(200)
        await pg.fill('#mt-skill','Sneak'); await pg.dispatch_event('#mt-skill','change')
        await pg.click('[data-tier="3"]'); await pg.click('#mt-apply'); await pg.wait_for_timeout(200)
        await pg.click('[data-act="assist"]'); await pg.click('[data-assist="1"]'); await pg.wait_for_timeout(200)
        await pg.click('[data-ch="1"]'); await pg.click('#mt-roll'); await pg.wait_for_timeout(200)
        await pg.screenshot(path=f'shots/{pre}3.png', full_page=True)
        await pg.click('#mt-apply'); await pg.wait_for_timeout(200)
        await pg.click('[data-act="ability"]'); await pg.click('#mt-useab'); await pg.wait_for_timeout(200)
        await pg.click('#mt-endround2'); await pg.wait_for_timeout(300)
        await pg.screenshot(path=f'shots/{pre}4.png', full_page=True)
        st = await pg.evaluate("JSON.parse(localStorage.getItem('st_mtgsess'))")
        k=list(st.keys())[0]; s=st[k]; print(s['succ'], s['fail'], s['round'], s['ended'], [l['text'] for l in s['log']])
        await pg.click('#mt-table'); await pg.wait_for_timeout(300); await pg.screenshot(path=f'shots/{pre}5.png'); await pg.click('.pv-x')
        # delve
        await pg.evaluate("location.hash='encounter'"); await pg.wait_for_timeout(600)
        await pg.click('#dok'); await pg.wait_for_timeout(300); await pg.click('#frombook'); await pg.wait_for_timeout(300); await pg.screenshot(path=f'shots/{pre}6.png')
        await pg.click('.beitem >> nth=5'); await pg.wait_for_timeout(1200)
        await pg.screenshot(path=f'shots/{pre}7.png')
        # dastard
        await pg.evaluate("location.hash='monsters--'+__mt().MONS.find(m=>m.dastard&&m.name==='Grandmother Garg')?.gid"); await pg.wait_for_timeout(800)
        await pg.screenshot(path=f'shots/{pre}8.png')
        print('errs', errs)
        await b.close()
asyncio.run(main())
