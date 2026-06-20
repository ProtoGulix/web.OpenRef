"""Scraper méthode 'html' — requests + BeautifulSoup, parsers spécifiques par site."""
import string
import httpx
from bs4 import BeautifulSoup
from .base import BaseScraper

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0 Safari/537.36"
    )
}


# ── SeriesForever (PrestaShop — endpoint suggestions) ─────────────────────────
async def _scrape_sf(client: httpx.AsyncClient, base_url: str, ref: str) -> list[dict]:
    url = f"{base_url}/fr/module/searchsuggestions/default?action=get_suggestions"
    r = await client.post(
        url,
        content=f"query={ref}&action=get_suggestions",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=15,
    )
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")

    def _get(html, cls):
        s = BeautifulSoup(str(html), "html.parser")
        v = s.find("div", {"class": cls})
        if v:
            import re
            m = re.search(r">(.*?)<", str(v))
            return m[1] if m else ""
        return ""

    items = []
    for a in soup.find_all("a"):
        if a.get("href") == "#":
            continue
        ref_found = _get(a, "reference")
        if ref_found != ref:
            continue
        price_str = _get(a, "price")[:-2].replace(",", ".")
        try:
            price = float(price_str)
        except ValueError:
            continue
        items.append({
            "link": a.get("href", ""),
            "price": price,
            "name": _get(a, "name"),
            "ref": ref_found,
            "image": "",
            "manufacturer": _get(a, "manufacturer"),
        })
    return items


# ── PaddockSpares (Magento — endpoint JSON suggest) ───────────────────────────
async def _scrape_pad(client: httpx.AsyncClient, base_url: str, ref: str) -> list[dict]:
    r = await client.get(
        f"{base_url}/search/ajax/suggest/?q={ref}",
        timeout=15,
    )
    r.raise_for_status()
    items = []
    for p in r.json():
        if p.get("type") != "product" or not p.get("title"):
            continue
        soup = BeautifulSoup(str(p.get("price", "")), "html.parser")
        span = soup.find("span", {"class": "price-excluding-tax"})
        try:
            price = float(span["data-price-amount"]) if span else 0.0
        except (KeyError, ValueError):
            price = 0.0
        items.append({
            "link": p.get("url", ""),
            "price": price,
            "name": p.get("title", ""),
            "ref": ref,
            "image": p.get("image", ""),
            "manufacturer": "",
        })
    return items


# ── BritishParts (endpoint JSON autocomplete) ─────────────────────────────────
async def _scrape_bp(client: httpx.AsyncClient, base_url: str, ref: str) -> list[dict]:
    r = await client.post(
        f"{base_url}/autocomplete/search/json?q={ref}",
        timeout=15,
    )
    r.raise_for_status()
    items = []
    for p in r.json().get("products", []):
        soup = BeautifulSoup(str(p.get("price", "")), "html.parser")
        span = soup.find("span", {"class": "product-content__price--ex"})
        if span:
            price_str = span.get_text().translate({ord(c): None for c in string.whitespace})[1:]
            try:
                price = float(price_str)
            except ValueError:
                price = 0.0
        else:
            price = 0.0
        items.append({
            "link": f"{base_url}{p.get('url', '')}",
            "price": price,
            "name": p.get("title", ""),
            "ref": p.get("reference", ref),
            "image": p.get("image", ""),
            "manufacturer": "",
        })
    return items


# ── Dispatch ──────────────────────────────────────────────────────────────────
_PARSERS = {
    "sf":  _scrape_sf,
    "pad": _scrape_pad,
    "bp":  _scrape_bp,
}


class HtmlScraper(BaseScraper):
    async def search(self, ref: str) -> list[dict]:
        parser = _PARSERS.get(self.id)
        if parser is None:
            return []
        async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True) as client:
            raw = await parser(client, self.url, ref)
        return [
            {**item, "devise": self.devise, "inc_vat": self.inc_vat, "source": self.id}
            for item in raw
        ]
