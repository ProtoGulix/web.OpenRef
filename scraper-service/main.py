from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import scrape

app = FastAPI(title="OpenRef Scraper Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(scrape.router, prefix="/scrape")


@app.get("/health")
def health():
    return {"status": "ok"}
