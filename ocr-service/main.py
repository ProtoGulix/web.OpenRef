from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import split, detect, nomenclature, vues

app = FastAPI(title="OpenRef OCR Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(split.router,        prefix="/ocr")
app.include_router(detect.router,       prefix="/ocr")
app.include_router(nomenclature.router, prefix="/ocr")
app.include_router(vues.router,         prefix="/ocr")


@app.get("/health")
def health():
    return {"status": "ok"}
