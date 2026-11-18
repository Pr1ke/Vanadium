import asyncio,sys
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(); errs=[]; reqs=[]
        pg.on('pageerror',lambda e:errs.append(str(e)))
        pg.on('request',lambda r: r.method!='GET' and reqs.append(r.method+' '+r.url))
        await pg.goto('http://127.0.0.1:8765/index.html#import'); await pg.wait_for_timeout(4000)
        await pg.set_input_files('#pdffile',sys.argv[1])
        await pg.wait_for_selector('#pvsave', timeout=280000); await pg.click('#pvsave'); await pg.wait_for_timeout(3000)
        info=(await pg.evaluate("(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('steeltools',1);q.onsuccess=()=>r(q.result)});const all=await new Promise(r=>{const g=db.transaction('packs').objectStore('packs').getAll();g.onsuccess=()=>r(g.result)});return all.map(p=>({id:p.id,title:p.title,mons:(p.monsters||[]).length,imgs:(p.images||[]).length,first:(p.images||[])[0]?.slice(0,22)}))})()"))[-1]
        print(info)
        await pg.reload(); await pg.wait_for_timeout(4000)
        print('after reload', await pg.evaluate("(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('steeltools',1);q.onsuccess=()=>r(q.result)});const all=await new Promise(r=>{const g=db.transaction('packs').objectStore('packs').getAll();g.onsuccess=()=>r(g.result)});return all.map(p=>({id:p.id,title:p.title,mons:(p.monsters||[]).length,imgs:(p.images||[]).length,first:(p.images||[])[0]?.slice(0,22)}))})()"))
        await pg.evaluate(f"location.hash='book--{info['id']}--chapter-1-firefall'"); await pg.wait_for_timeout(2000)
        print('book text', (await pg.evaluate("document.querySelector('#main').innerText"))[:150].replace('\n',' | '))
        print('imgs any', await pg.evaluate("[...document.querySelectorAll('#main img')].map(i=>i.src.slice(0,20)).slice(0,3)"))
        print('book imgs shown', await pg.evaluate("document.querySelectorAll('.bkimg img').length"))
        await pg.goto('http://127.0.0.1:8765/index.html#montage'); await pg.wait_for_timeout(2000)
        print('montage page', (await pg.evaluate("document.querySelector('#main').innerText"))[:200].replace('\n',' | '))
        print('non-GET', reqs, 'errs', errs); await b.close()
asyncio.run(main())
