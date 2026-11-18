import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        pg = await b.new_page(); await pg.goto('http://127.0.0.1:8765/index.html#montage'); await pg.wait_for_timeout(4500)
        print(await pg.evaluate("__mt().MT_BOOK.filter(m=>m.pack!=='encounters').map(m=>m.id+' '+JSON.stringify(m.src))"))
        await b.close()
asyncio.run(main())
