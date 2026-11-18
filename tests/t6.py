import asyncio, sys
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        mob = len(sys.argv)>1 and sys.argv[1]=='m'
        ctx = await b.new_context(viewport={'width':390,'height':844} if mob else {'width':1440,'height':900}, device_scale_factor=2 if mob else 1, is_mobile=mob, has_touch=mob, accept_downloads=True)
        pg = await ctx.new_page()
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type=='error' else None)
        pre = 'm' if mob else 'd'
        await pg.goto('http://127.0.0.1:8765/index.html#encounter'); await pg.wait_for_timeout(3000)
        await pg.screenshot(path=f'shots/{pre}enc0.png')
        await pg.fill('#dh','5'); await pg.fill('#dl','1'); await pg.fill('#dv','2'); await pg.click('#dok'); await pg.wait_for_timeout(400)
        if mob: await pg.click('#openpick'); await pg.wait_for_timeout(400)
        await pg.fill('#pq','goblin'); await pg.wait_for_timeout(300)
        for name in ['Goblin Monarch','Goblin Warrior','Goblin Runner','Goblin Sniper','Goblin Assassin','Goblin Cursespitter']:
            gid = await pg.evaluate(f"(()=>{{const r=[...document.querySelectorAll('.prow')].find(x=>x.querySelector('a').textContent==={name!r}); return r&&r.querySelector('[data-add]').dataset.add}})()")
            if gid: await pg.click(f'[data-add="{gid}"]'); await pg.wait_for_timeout(200)
        await pg.click('[data-kind=obstacles]'); await pg.fill('#pq','brambles'); await pg.wait_for_timeout(300)
        b0 = await pg.query_selector('[data-add]')
        if b0: await b0.click(); await pg.wait_for_timeout(300)
        if mob: await pg.screenshot(path=f'shots/{pre}enc1p.png'); await pg.click('#closepick'); await pg.wait_for_timeout(300)
        await pg.click('#autogrp'); await pg.wait_for_timeout(400)
        await pg.screenshot(path=f'shots/{pre}enc1.png', full_page=False)
        await pg.click('#encpdf'); await pg.wait_for_timeout(5000)
        print('toast', await pg.evaluate("document.querySelector('#toast').textContent"), errs)
        async with pg.expect_download(timeout=30000) as dl:
            await pg.click('#encpdf')
        d = await dl.value
        await d.save_as(f'/home/claude/shots/{pre}enc.pdf')
        print('saved', d.suggested_filename)
        print('ERR', errs[:8])
        await b.close()
asyncio.run(main())
