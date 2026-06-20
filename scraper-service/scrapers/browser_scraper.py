"""Scraper méthode 'browser' — Playwright asyncio."""
from playwright.async_api import async_playwright
from .base import BaseScraper


class BrowserScraper(BaseScraper):
    async def search(self, ref: str) -> list[dict]:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()
            await page.goto(f"{self.url}/search?q={ref}", timeout=20000)
            await page.wait_for_load_state("networkidle", timeout=10000)
            # Extraction générique — à surcharger par source si nécessaire
            items = await page.evaluate("""() => {
                return Array.from(document.querySelectorAll('.product-miniature, .product-item')).map(el => ({
                    name: el.querySelector('.product-title, h2')?.innerText?.trim() || '',
                    price: parseFloat(el.querySelector('.price')?.innerText?.replace(/[^0-9.,]/g,'').replace(',','.')) || 0,
                    link: el.querySelector('a')?.href || '',
                    image: el.querySelector('img')?.src || '',
                    manufacturer: '',
                    ref: ''
                }));
            }""")
            await browser.close()

        return [
            {**item, "devise": self.devise, "inc_vat": self.inc_vat, "source": self.id}
            for item in items
        ]
