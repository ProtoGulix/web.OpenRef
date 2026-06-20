import os
import asyncpg

_pool = None
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/openref")


async def get_pool():
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(DATABASE_URL)
    return _pool


async def fetch_sources(marque: str) -> list[dict]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, name, url, origine, devise, inc_vat, method, marques
            FROM source
            WHERE actif = true
              AND (marques @> ARRAY[$1]::TEXT[] OR marques @> ARRAY['*']::TEXT[])
            """,
            marque,
        )
    return [dict(r) for r in rows]
