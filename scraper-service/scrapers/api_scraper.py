"""Scraper méthode 'api' — appels JSON directs (Algolia, Doofinder, Clerk.io...)."""
import json
import httpx
from bs4 import BeautifulSoup
import re

from .base import BaseScraper


# ── JohnCraddock ──────────────────────────────────────────────────────────────
async def _scrape_jc(client: httpx.AsyncClient, ref: str) -> list[dict]:
    """HTML + JSON embarqué dans la page (dataLayer ecommerce impressions)."""
    site = "https://www.johncraddockltd.co.uk"
    r = await client.get(f"{site}/_api/search.php?q={ref}", timeout=15)
    r.raise_for_status()
    text = r.text

    soup = BeautifulSoup(text, "html.parser")
    links = [f"{site}{a['href']}" for a in soup.find_all("a") if a.get_text(strip=True) == "View"]

    # JSON embarqué dans le JS de la page
    import regex
    pattern = regex.compile(r'\{(?:[^{}]|(?R))*\}')
    json_blocks = pattern.findall(text)

    items = []
    if json_blocks:
        try:
            data = json.loads(json_blocks[0])
            impressions = data.get("ecommerce", {}).get("impressions", [])
            for i, spare in enumerate(impressions):
                if " Use " in f" {spare.get('name', '')} ":
                    continue
                items.append({
                    "link": links[i] if i < len(links) else f"{site}/search?q={ref}",
                    "price": float(spare.get("price", 0)),
                    "name": spare.get("name", ""),
                    "ref": str(spare.get("id", ref)),
                    "image": "",
                    "manufacturer": spare.get("brand", ""),
                })
        except Exception:
            pass
    return items


# ── LRParts (Clerk.io) ────────────────────────────────────────────────────────
async def _scrape_lp(client: httpx.AsyncClient, ref: str) -> list[dict]:
    payload = json.dumps({
        "template": "live-search",
        "query": ref,
        "key": "M3D9eNAWdhgJh4sVPKxfi2viNHGoVBMO",
    })
    r = await client.get(f"https://api.clerk.io/v2/?payload={payload}", timeout=15)
    r.raise_for_status()
    data = r.json()
    items = []
    for p in data.get("product_data", []):
        items.append({
            "link": p.get("url", ""),
            "price": float(p.get("price", 0)),
            "name": p.get("name", ""),
            "ref": str(p.get("id", ref)),
            "image": p.get("image", ""),
            "manufacturer": "",
        })
    return items


# ── Doofinder (LandService + BestOfLand) ─────────────────────────────────────
async def _scrape_doofinder(client: httpx.AsyncClient, hashid: str, origine: str, ref: str) -> list[dict]:
    url = f"https://eu1-search.doofinder.com/5/search?hashid={hashid}&query={ref}"
    r = await client.get(url, headers={"Origin": origine}, timeout=15)
    r.raise_for_status()
    data = r.json()
    items = []
    if data.get("query_name") == "match_and":
        for p in data.get("results", []):
            items.append({
                "link": p.get("link", ""),
                "price": float(p.get("price", 0)),
                "name": p.get("title", ""),
                "ref": str(p.get("mpn", ref)),
                "image": p.get("image_link", ""),
                "manufacturer": p.get("brand", ""),
            })
    return items


async def _scrape_ls(client: httpx.AsyncClient, ref: str) -> list[dict]:
    return await _scrape_doofinder(
        client,
        hashid="e517b3b916cd126250a46db6e9696c5f",
        origine="https://www.land-service.com",
        ref=ref,
    )


async def _scrape_bol(client: httpx.AsyncClient, ref: str) -> list[dict]:
    return await _scrape_doofinder(
        client,
        hashid="090701841bea429cd906143b5bf7d800",
        origine="https://www.best-of-land.com",
        ref=ref,
    )


# ── RoverParts (Algolia) ──────────────────────────────────────────────────────
async def _scrape_rp(client: httpx.AsyncClient, ref: str) -> list[dict]:
    url = "https://2qsh1yko9z-dsn.algolia.net/1/indexes/*/queries?x-algolia-application-id=2QSH1YKO9Z&x-algolia-api-key=2f9e1a80c81354832c8ee661e2d64486"
    payload = json.dumps({
        "requests": [{"indexName": "roverTaxonomy", "params": f"query={ref}"}]
    })
    r = await client.post(
        url,
        content=payload,
        headers={"Origin": "https://www.roverparts.com", "Content-Type": "application/json"},
        timeout=15,
    )
    r.raise_for_status()
    data = r.json()
    items = []
    for hit in data.get("results", [{}])[0].get("hits", []):
        if not str(hit.get("WEBNO", "")).startswith(ref):
            continue
        items.append({
            "link": f"https://www.roverparts.com{hit.get('PARTURL', '')}",
            "price": float(hit.get("PRICE", 0)),
            "name": hit.get("DESCRIPTION", ""),
            "ref": hit.get("PRODUCT_ID", ref),
            "image": "",
            "manufacturer": hit.get("MFR", ""),
        })
    return items


# ── Dispatch ──────────────────────────────────────────────────────────────────
_ADAPTERS = {
    "jc":  _scrape_jc,
    "lp":  _scrape_lp,
    "ls":  _scrape_ls,
    "bol": _scrape_bol,
    "rp":  _scrape_rp,
}


class ApiScraper(BaseScraper):
    async def search(self, ref: str) -> list[dict]:
        adapter = _ADAPTERS.get(self.id)
        if adapter is None:
            return []
        async with httpx.AsyncClient() as client:
            raw = await adapter(client, ref)
        return [
            {**item, "devise": self.devise, "inc_vat": self.inc_vat, "source": self.id}
            for item in raw
        ]
