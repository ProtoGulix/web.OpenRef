from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import ocr

app = FastAPI(title="OpenRef OCR Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ocr.router, prefix="/ocr")


@app.get("/health")
def health():
    return {"status": "ok"}
