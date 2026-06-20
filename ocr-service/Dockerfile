FROM python:3.11-slim

# poppler-utils requis par pdf2image
RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils \
    tesseract-ocr \
    tesseract-ocr-fra \
    tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Le code source est monté en volume — pas de COPY .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
