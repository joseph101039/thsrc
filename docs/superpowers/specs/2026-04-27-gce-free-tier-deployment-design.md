# GCP Free Tier Compute Engine Deployment Design

**Date:** 2026-04-27  
**Status:** Approved  
**Scope:** Deploy `apiserver/` to GCP e2-micro (free tier) using TFLite inference, Docker Hub, and Watchtower auto-update.

---

## Goal

Run the THSRC captcha solver API on GCP's always-free e2-micro instance. The primary constraint is the 1 GB RAM limit — `tensorflow-cpu` alone uses ~600 MB, leaving no room. The solution is to replace the TF inference backend with `tflite-runtime` (~30 MB footprint) while keeping all API logic unchanged.

---

## Architecture

```
Local machine
  └─ apiserver/deploy-gce.sh
       ├─ docker buildx build (linux/amd64)
       └─ push → Docker Hub: <user>/captcha-solver:latest

GCP e2-micro (Container-Optimized OS, us-central1)
  ├─ captcha-solver container (port 8080)
  │    ├─ FastAPI + uvicorn
  │    ├─ tflite-runtime interpreter
  │    └─ captcha_model.tflite (baked into image)
  └─ watchtower container
       └─ polls Docker Hub every 5 min → auto pull + restart
```

Firewall rule opens `tcp:8080` to `0.0.0.0/0`. No TLS, no domain — direct IP:8080 access (internal tooling).

---

## Components and Changes

### 1. Model Conversion (`tensorflow/convert_to_tflite.py`) — new file

One-time script to convert `captcha_model.keras` → `captcha_model.tflite` (float32, no quantization — preserves original accuracy).

```python
import tensorflow as tf

model = tf.keras.models.load_model("captcha_model.keras", compile=False)
converter = tf.lite.TFLiteConverter.from_keras_model(model)
tflite_model = converter.convert()
with open("captcha_model.tflite", "wb") as f:
    f.write(tflite_model)
print(f"Saved: {len(tflite_model) / 1e6:.1f} MB")
```

Run from `tensorflow/` directory with the training venv active.

### 2. `apiserver/requirements.txt` — modified

```diff
-tensorflow-cpu==2.18.0
+tflite-runtime==2.14.0
```

All other deps unchanged.

### 3. `apiserver/main.py` — modified (inference only)

Replace the model loading and prediction logic with `tflite_runtime`:

```python
# Load
from tflite_runtime.interpreter import Interpreter

interpreter = Interpreter(model_path=str(MODEL_PATH))
interpreter.allocate_tensors()
input_details = interpreter.get_input_details()
output_details = interpreter.get_output_details()

# Predict
def _predict_bgr(img_bgr):
    x = _preprocess(img_bgr)[np.newaxis, ...]  # (1, H, W, 1)
    interpreter.set_tensor(input_details[0]['index'], x)
    interpreter.invoke()
    y_pred = interpreter.get_tensor(output_details[0]['index'])[0]  # (T, 35)
    indices, confs = _ctc_decode(y_pred)
    text = "".join(IDX2CHAR.get(i, "?") for i in indices)
    return text, confs
```

CTC decode, preprocessing, routes, schemas, error handling — all unchanged.

### 4. `apiserver/Dockerfile` — modified

```diff
-COPY captcha_model.keras .
-ENV MODEL_PATH=captcha_model.keras
+COPY captcha_model.tflite .
+ENV MODEL_PATH=captcha_model.tflite
```

Image size drops from ~2.5 GB to ~400 MB (tflite-runtime is tiny).

### 5. `apiserver/deploy-gce.sh` — new file

Builds and pushes the image to Docker Hub. Watchtower on the VM picks up the new image automatically within 5 minutes.

```bash
#!/usr/bin/env bash
set -euo pipefail
DOCKERHUB_USER="${DOCKERHUB_USER:-youruser}"
IMAGE="${DOCKERHUB_USER}/captcha-solver"

cp ../tensorflow/captcha_model.tflite captcha_model.tflite
docker buildx build --platform linux/amd64 -t "${IMAGE}:latest" --push .
echo "Pushed ${IMAGE}:latest — Watchtower picks up in ≤5 min."
```

The existing `deploy.sh` (Cloud Run) is preserved unchanged.

### 6. `.gitignore` — modified

Add `*.tflite` alongside existing `*.keras` / `*.h5` exclusions (large binary, not version-controlled in git).

---

## GCP VM Setup (one-time, manual)

**Instance:** `e2-micro`, `us-central1-a` (or `us-west1-b` / `us-east1-b`), Container-Optimized OS  
**Disk:** 30 GB standard persistent disk  
**Firewall:** create rule `allow-captcha-8080` → `tcp:8080`, target tag `captcha-solver`

**VM startup-script** (set in metadata):

```bash
#!/bin/bash
docker run -d \
  --name captcha-solver \
  --restart unless-stopped \
  -p 8080:8080 \
  <DOCKERHUB_USER>/captcha-solver:latest

docker run -d \
  --name watchtower \
  --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock \
  containrrr/watchtower \
  --interval 300 \
  captcha-solver
```

---

## Memory Budget (e2-micro, 1 GB)

| Component | RAM |
|---|---|
| tflite-runtime + model | ~50 MB |
| FastAPI + uvicorn (1 worker) | ~50 MB |
| OS + Container-Optimized OS | ~300 MB |
| Headroom | ~600 MB |
| **Total** | **~400 MB / 1 GB** |

---

## Data Flow

```
Client
  → POST http://<VM_IP>:8080/solve   (base64 / upload / url)
  → FastAPI route handler
  → _decode_image_bytes → _preprocess → interpreter.invoke → _ctc_decode
  → {"answer": "A3KZ", "confidence": [...], "elapsed_ms": 12.3}
```

Inference latency on e2-micro (1 vCPU): estimated 50–200 ms (TFLite is CPU-efficient).

---

## Update Workflow

```
1. Train new model       → tensorflow/train_captcha.py
2. Convert               → python tensorflow/convert_to_tflite.py
3. Push new image        → cd apiserver && DOCKERHUB_USER=xxx ./deploy-gce.sh
4. Watchtower auto-pulls → new container live within 5 min (zero manual SSH)
```

---

## Out of Scope

- HTTPS / TLS (internal tool, no domain)
- API authentication (by design — internal use only)
- Health check monitoring / alerting
- Multi-region or HA setup
