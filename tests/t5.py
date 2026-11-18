import asyncio, time
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        pg = await (await b.new_context(viewport={'width':1280,'height':900})).new_page()
        logs=[]; pg.on('pageerror', lambda e: logs.append('ERR '+str(e))); pg.on('console', lambda m: logs.append(m.type+': '+m.text[:200]))
        await pg.goto('http://127.0.0.1:8765/index.html#import'); await pg.wait_for_timeout(2500)
        await pg.set_input_files('#pdffile', '/mnt/user-data/uploads/4335667c-Draw_Steel_Monsters_v1_compressed.pdf')
        for i in range(26):
            await pg.wait_for_timeout(4000)
            t = await pg.evaluate("(document.querySelector('#pt')||{}).textContent || (document.querySelector('#stage')||{}).innerText.slice(0,200)")
            print(i*4, t)
            if await pg.query_selector('#pvsave'): break
        print('\n'.join(logs[:30]))
        await b.close()
asyncio.run(main())
