import asyncio
import json
from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from db import fetch_sources
from exchange import fetch_rates
from scrapers.factory import make_scraper

router = APIRouter()


async def _scrape_all(ref: str, marque: str):
    """Générateur SSE : scrape toutes les sources actives pour la marque."""
    rates = await fetch_rates()
    yield f"data: {json.dumps({'type': 'change', 'change': rates})}\n\n"

    sources = await fetch_sources(marque)

    async def scrape_one(source: dict):
        site_id = source["id"]
        yield f"data: {json.dumps({'type': 'site_start', 'site': site_id})}\n\n"
        try:
            scraper = make_scraper(source)
            items = await asyncio.wait_for(scraper.search(ref), timeout=20)
            yield f"data: {json.dumps({'type': 'site_done', 'site': site_id, 'count': len(items), 'items': items})}\n\n"
        except asyncio.TimeoutError:
            yield f"data: {json.dumps({'type': 'site_error', 'site': site_id, 'error': 'timeout'})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'site_error', 'site': site_id, 'error': str(e)})}\n\n"

    # Lancer toutes les sources en parallèle via une queue
    queue: asyncio.Queue = asyncio.Queue()
    import time
    start = time.monotonic()

    async def worker(source):
        async for event in scrape_one(source):
            await queue.put(event)
        await queue.put(None)  # signal fin pour cette source

    tasks = [asyncio.create_task(worker(s)) for s in sources]
    pending = len(tasks)

    while pending > 0:
        event = await queue.get()
        if event is None:
            pending -= 1
        else:
            yield event

    elapsed = round(time.monotonic() - start, 2)
    yield f"data: {json.dumps({'type': 'done', 'time': elapsed})}\n\n"


@router.get("/stream")
async def scrape_stream(
    ref: str = Query(..., description="Référence pièce"),
    marque: str = Query(..., description="Marque (ex: landrover)"),
):
    return StreamingResponse(
        _scrape_all(ref, marque),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
