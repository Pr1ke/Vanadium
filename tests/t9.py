import asyncio, json
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width':1440,'height':900})
        pg = await ctx.new_page(); errs=[]
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8765/index.html#montage'); await pg.wait_for_timeout(5000)
        await pg.screenshot(path='shots/m1.png')
        info = await pg.evaluate("""(()=>{const X=__mt();X.refreshMontages();return X.MT_BOOK.map(m=>[m.pack,m.name,m.challenges.length,m.challenges.filter(c=>c.round>1).length,m.events.length,Object.keys(m.outcomes).join('/'),m.scene.length,m.challenges.filter(c=>!c.chars.length).length])})()""")
        for i in info: print(i)
        print('negs', await pg.evaluate("(()=>{const X=__mt();X.refreshNegotiations();return X.allNegs().filter(n=>n.pack==='encounters').length})()"))
        print('dastards', await pg.evaluate("(()=>{const MONS=__mt().MONS;return [MONS.filter(m=>m.dastard).length, MONS.filter(m=>m.dastard&&!m.lore).map(m=>m.name)]})()"))
        print('enc tables', await pg.evaluate("__mt().bookEncounterTables().length"))
        miss = await pg.evaluate("""(()=>{const {bookEncounterTables,parseCreatureCell,matchMonster}=__mt();const out=[];for(const x of bookEncounterTables())for(const r of x.table.rows)for(const it of parseCreatureCell(r[1]||'')){if(!matchMonster(it.text,x.pack))out.push(x.name+': '+it.n+' '+it.text)}return out})()""")
        print('unmatched', len(miss)); print('\n'.join(miss[:40]))
        print('errs', errs)
        await b.close()
asyncio.run(main())
