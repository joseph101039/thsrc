FROM python:3.11-slim

WORKDIR /app

# Install system deps for OpenCV
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libgl1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .
COPY captcha_model.keras .

ENV MODEL_PATH=captcha_model.keras
ENV PORT=8080

EXPOSE 8080

CMD ["python", "main.py"]
