#!/usr/bin/env python3
"""
THSRC Captcha Solver — FastAPI server
Runs the CRNN+CTC model and exposes a REST API for captcha prediction.
"""

from __future__ import annotations

import base64
import io
import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

# ─── Constants (must match train_captcha.py) ──────────────────────────────────
CHARS: str = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ"
NUM_CLASSES: int = len(CHARS)
NUM_CLASSES_CTC: int = NUM_CLASSES + 1
IDX2CHAR: dict[int, str] = {i: c for i, c in enumerate(CHARS)}
CAPTCHA_LEN: int = 4
IMG_W: int = 160
IMG_H: int = 50

MODEL_PATH = Path(os.environ.get("MODEL_PATH", "captcha_model.keras"))

# ─── Global model handle ──────────────────────────────────────────────────────
_model = None


def _load_model():
    global _model
    try:
        import tensorflow as tf  # noqa: F401
        from tensorflow import keras

        keras.config.enable_unsafe_deserialization()
        logger.info("Loading model from %s", MODEL_PATH)
        _model = keras.models.load_model(str(MODEL_PATH), compile=False)
        logger.info(
            "Model ready — input: %s, output: %s",
            _model.input_shape,
            _model.output_shape,
        )
    except Exception as e:
        logger.error("Failed to load model: %s", e)
        raise


@asynccontextmanager
async def lifespan(app: FastAPI):
    _load_model()
    yield


# ─── App ──────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="THSRC Captcha Solver API",
    description=(
        "Solves Taiwan High Speed Rail booking captchas using a CRNN+CTC model. "
        "Accepts image input as base64 string, raw bytes upload, or public URL."
    ),
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# ─── Image processing ─────────────────────────────────────────────────────────

def _preprocess(img_bgr: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    resized = cv2.resize(gray, (IMG_W, IMG_H), interpolation=cv2.INTER_AREA)
    return (resized.astype("float32") / 255.0)[..., np.newaxis]


def _ctc_decode(y_pred: np.ndarray) -> tuple[list[int], list[float]]:
    """Greedy CTC decode for a single sample. Returns (indices, confidences)."""
    argmax = np.argmax(y_pred, axis=-1)   # (T,)
    maxprob = np.max(y_pred, axis=-1)     # (T,)
    blank = NUM_CLASSES
    seq_idx: list[int] = []
    seq_conf: list[float] = []
    prev = -1
    for t in range(len(argmax)):
        c = int(argmax[t])
        if c != prev and c != blank:
            seq_idx.append(c)
            seq_conf.append(float(maxprob[t]))
        prev = c
    return seq_idx, seq_conf


def _predict_bgr(img_bgr: np.ndarray) -> tuple[str, list[float]]:
    x = _preprocess(img_bgr)[np.newaxis, ...]     # (1, H, W, 1)
    y_pred = _model.predict(x, verbose=0)[0]      # (T, 35)
    indices, confs = _ctc_decode(y_pred)
    text = "".join(IDX2CHAR.get(i, "?") for i in indices)
    return text, confs


def _decode_image_bytes(data: bytes) -> np.ndarray:
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Cannot decode image — unsupported format or corrupt data")
    return img


# ─── Request / Response schemas ───────────────────────────────────────────────

class SolveBase64Request(BaseModel):
    image: str = Field(
        ...,
        description=(
            "Base64-encoded captcha image. "
            "Data URI prefix (`data:image/...;base64,`) is stripped automatically."
        ),
        examples=["iVBORw0KGgoAAAANS..."],
    )


class SolveUrlRequest(BaseModel):
    url: str = Field(
        ...,
        description="Publicly accessible URL of the captcha image.",
        examples=["https://irs.thsrc.com.tw/..."],
    )


class SolveResponse(BaseModel):
    answer: str = Field(..., description="Predicted 4-character captcha string.", examples=["A3KZ"])
    confidence: list[float] = Field(
        ...,
        description="Per-character softmax confidence (0–1) from the CTC decode path.",
        examples=[[0.99, 0.87, 0.95, 1.0]],
    )
    elapsed_ms: float = Field(..., description="Server-side inference time in milliseconds.")


class HealthResponse(BaseModel):
    status: str
    model: str
    input_shape: str


class ErrorResponse(BaseModel):
    error: str


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.get(
    "/health",
    response_model=HealthResponse,
    summary="Health check",
    tags=["Utility"],
)
def health():
    """Returns service status and loaded model metadata."""
    if _model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    return {
        "status": "ok",
        "model": str(MODEL_PATH),
        "input_shape": str(_model.input_shape),
    }


@app.post(
    "/solve",
    response_model=SolveResponse,
    responses={400: {"model": ErrorResponse}, 503: {"model": ErrorResponse}},
    summary="Solve captcha from base64 image",
    tags=["Captcha"],
)
def solve_base64(body: SolveBase64Request):
    """
    Accepts a base64-encoded captcha image and returns the predicted text.

    - Strips `data:image/...;base64,` prefix automatically.
    - Returns per-character CTC confidence values.
    """
    if _model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    try:
        b64 = body.image
        if "," in b64:
            b64 = b64.split(",", 1)[1]
        img_bytes = base64.b64decode(b64)
        img = _decode_image_bytes(img_bytes)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}")

    t0 = time.perf_counter()
    answer, confidence = _predict_bgr(img)
    elapsed = (time.perf_counter() - t0) * 1000
    logger.info("solve: %s  conf=%s  %.1fms", answer, confidence, elapsed)
    return {"answer": answer, "confidence": confidence, "elapsed_ms": round(elapsed, 1)}


@app.post(
    "/solve/upload",
    response_model=SolveResponse,
    responses={400: {"model": ErrorResponse}, 503: {"model": ErrorResponse}},
    summary="Solve captcha from uploaded file",
    tags=["Captcha"],
)
async def solve_upload(file: UploadFile = File(..., description="Captcha image file (PNG/JPEG)")):
    """
    Accepts a multipart file upload and returns the predicted captcha text.
    Useful for testing with `curl -F file=@captcha.png`.
    """
    if _model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    try:
        data = await file.read()
        img = _decode_image_bytes(data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}")

    t0 = time.perf_counter()
    answer, confidence = _predict_bgr(img)
    elapsed = (time.perf_counter() - t0) * 1000
    logger.info("solve/upload: %s  conf=%s  %.1fms", answer, confidence, elapsed)
    return {"answer": answer, "confidence": confidence, "elapsed_ms": round(elapsed, 1)}


@app.post(
    "/solve/url",
    response_model=SolveResponse,
    responses={400: {"model": ErrorResponse}, 503: {"model": ErrorResponse}},
    summary="Solve captcha from image URL",
    tags=["Captcha"],
)
def solve_url(body: SolveUrlRequest):
    """
    Downloads the image from a public URL and returns the predicted captcha text.
    Intended for direct GAS / server-side integration where the captcha URL is known.
    """
    if _model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    try:
        import urllib.request
        with urllib.request.urlopen(body.url, timeout=10) as resp:
            img_bytes = resp.read()
        img = _decode_image_bytes(img_bytes)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch image: {e}")

    t0 = time.perf_counter()
    answer, confidence = _predict_bgr(img)
    elapsed = (time.perf_counter() - t0) * 1000
    logger.info("solve/url: %s  conf=%s  %.1fms", answer, confidence, elapsed)
    return {"answer": answer, "confidence": confidence, "elapsed_ms": round(elapsed, 1)}


# ─── Global error handler ─────────────────────────────────────────────────────

@app.exception_handler(Exception)
async def generic_error_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error: %s", exc)
    return JSONResponse(status_code=500, content={"error": str(exc)})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.environ.get("PORT", 8080)), reload=False)
