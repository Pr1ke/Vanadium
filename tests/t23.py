import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(); errs=[]; reqs=[]
        pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m: m.type=='error' and errs.append(m.text))
        pg.on('request',lambda r: r.method!='GET' and reqs.append(r.method+' '+r.url))
        for h in ['','#monsters','#montage','#negotiation','#encounter','#cards','#library','#sessions','#book--monsters','#import','#respite']:
            await pg.goto('http://127.0.0.1:8765/index.html'+h); await pg.wait_for_timeout(1500)
            t=await pg.evaluate("document.querySelector('#main')?.innerText.slice(0,90).replace(/\\n/g,' | ')")
            print(h or 'home', '->', t)
        print('img refs', await pg.evaluate("document.querySelectorAll('img[src*=\"data/img\"]').length"))
        # import a PDF with images if available
        import glob; f=[x for x in glob.glob('/mnt/user-data/uploads/**/*.pdf',recursive=True) if 'ottom' in x or 'ncounter' in x]
        print('pdf', f[:1])
        if f:
            await pg.goto('http://127.0.0.1:8765/index.html#import'); await pg.wait_for_timeout(800)
            await pg.set_input_files('input[type=file]', f[0]); await pg.wait_for_timeout(60000)
            print(await pg.evaluate("document.querySelector('#main').innerText.slice(0,300)"))
        print('non-GET requests', reqs); print('errs', errs)
        await b.close()
asyncio.run(main())
