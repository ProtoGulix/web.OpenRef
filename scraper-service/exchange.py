import httpx

_rates: dict = {}


async def fetch_rates() -> dict:
    """Récupère les taux EUR/GBP depuis l'API ouverte frankfurter.app."""
    global _rates
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get("https://api.frankfurter.app/latest?from=EUR&to=GBP")
            r.raise_for_status()
            data = r.json()
            gbp = data["rates"]["GBP"]
            _rates = {"EURGBP": gbp, "GBPEUR": round(1 / gbp, 6)}
    except Exception:
        _rates = {"EURGBP": 0.86, "GBPEUR": 1.163}
    return _rates


def get_cached_rates() -> dict:
    return _rates or {"EURGBP": 0.86, "GBPEUR": 1.163}
