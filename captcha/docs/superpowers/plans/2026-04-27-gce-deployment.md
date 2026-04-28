# GCE Free Tier Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Deploy the captcha solver API to GCP e2-micro (free tier) using TFLite inference, Docker Hub, and Watchtower auto-update.

**Architecture:** Replace `tensorflow-cpu` with `tflite-runtime` in `apiserver/` to bring RAM from ~600 MB to ~50 MB. Bake `captcha_model.tflite` into the Docker image. Push to Docker Hub; Watchtower on the VM pulls automatically within 5 minutes.

**Tech Stack:** Python 3.11, FastAPI, tflite-runtime, Docker Hub, Watchtower, GCP e2-micro (Container-Optimized OS)

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `apiserver/requirements.txt` | **Modify** | `tensorflow-cpu` → `tflite-runtime==2.14.0` |
| `apiserver/main.py` | **Modify** | Replace Keras model loading/prediction with TFLite Interpreter |
| `apiserver/Dockerfile` | **Modify** | Copy `captcha_model.tflite` instead of `.keras` |
| `apiserver/deploy-gce.sh` | **Create** | Build multi-arch image and push to Docker Hub |
| `.gitignore` | **Verify** | `*.tflite` already excluded (added earlier) |

---

### Task 1: Update requirements.txt

**Files:**
- Modify: `apiserver/requirements.txt`

- [x] **Step 1: Replace tensorflow-cpu with tflite-runtime**

Edit `apiserver/requirements.txt` — replace line:
```
tensorflow-cpu==2.18.0
```
with:
```
tflite-runtime==2.14.0
```

- [x] **Step 2: Verify the file looks correct**

```bash
cat apiserver/requirements.txt
```

Expected — all lines unchanged except the tensorflow line:
```
fastapi==0.115.5
uvicorn[standard]==0.32.0
python-multipart==0.0.12
pydantic==2.9.2
opencv-python-headless==4.10.0.84
numpy==1.26.4
tflite-runtime==2.14.0
```

- [x] **Step 3: Commit**

```bash
git add apiserver/requirements.txt
git commit -m "feat: replace tensorflow-cpu with tflite-runtime in apiserver"
```

---

### Task 2: Update main.py — TFLite inference

**Files:**
- Modify: `apiserver/main.py`

Replace three sections: the import/model-loading block, the `_load_model()` function, and `_predict_bgr()`. Everything else (routes, schemas, CTC decode, preprocessing, error handling) stays identical.

- [x] **Step 1: Replace the model loading section (lines 41–61)**

Replace:
```python
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
```

With:
```python
MODEL_PATH = Path(os.environ.get("MODEL_PATH", "captcha_model.tflite"))

# ─── Global model handle ──────────────────────────────────────────────────────
_interpreter = None
_input_index: int = 0
_output_index: int = 0


def _load_model():
    global _interpreter, _input_index, _output_index
    try:
        try:
            from tflite_runtime.interpreter import Interpreter
        except ImportError:
            from tensorflow.lite.python.interpreter import Interpreter

        logger.info("Loading TFLite model from %s", MODEL_PATH)
        _interpreter = Interpreter(model_path=str(MODEL_PATH))
        _interpreter.allocate_tensors()
        _input_index = _interpreter.get_input_details()[0]["index"]
        _output_index = _interpreter.get_output_details()[0]["index"]
        input_shape = _interpreter.get_input_details()[0]["shape"]
        output_shape = _interpreter.get_output_details()[0]["shape"]
        logger.info("Model ready — input: %s, output: %s", input_shape, output_shape)
    except Exception as e:
        logger.error("Failed to load model: %s", e)
        raise
```

- [x] **Step 2: Replace `_predict_bgr()` (lines 117–122)**

Replace:
```python
def _predict_bgr(img_bgr: np.ndarray) -> tuple[str, list[float]]:
    x = _preprocess(img_bgr)[np.newaxis, ...]     # (1, H, W, 1)
    y_pred = _model.predict(x, verbose=0)[0]      # (T, 35)
    indices, confs = _ctc_decode(y_pred)
    text = "".join(IDX2CHAR.get(i, "?") for i in indices)
    return text, confs
```

With:
```python
def _predict_bgr(img_bgr: np.ndarray) -> tuple[str, list[float]]:
    if _interpreter is None:
        raise RuntimeError("Model not loaded")
    x = _preprocess(img_bgr)[np.newaxis, ...]     # (1, H, W, 1)
    _interpreter.set_tensor(_input_index, x)
    _interpreter.invoke()
    y_pred = _interpreter.get_tensor(_output_index)[0]  # (T, 35)
    indices, confs = _ctc_decode(y_pred)
    text = "".join(IDX2CHAR.get(i, "?") for i in indices)
    return text, confs
```

- [x] **Step 3: Update the `/health` route to use interpreter (lines 183–190)**

Replace:
```python
    if _model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    return {
        "status": "ok",
        "model": str(MODEL_PATH),
        "input_shape": str(_model.input_shape),
    }
```

With:
```python
    if _interpreter is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    input_shape = _interpreter.get_input_details()[0]["shape"]
    return {
        "status": "ok",
        "model": str(MODEL_PATH),
        "input_shape": str(input_shape),
    }
```

- [x] **Step 4: Replace the three `_model is None` guards in routes**

In `solve_base64`, `solve_upload`, and `solve_url`, replace:
```python
    if _model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
```
With:
```python
    if _interpreter is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
```

- [x] **Step 5: Verify the server starts with the TFLite model**

```bash
cd apiserver
cp ../tensorflow/captcha_model.tflite .
pip install tflite-runtime==2.14.0 2>/dev/null || pip install tensorflow 2>/dev/null
MODEL_PATH=captcha_model.tflite python main.py &
sleep 3
curl -s http://localhost:8080/health | python3 -m json.tool
kill %1
```

Expected:
```json
{
    "status": "ok",
    "model": "captcha_model.tflite",
    "input_shape": "[1 50 160  1]"
}
```

- [x] **Step 6: Commit**

```bash
git add apiserver/main.py
git commit -m "feat: switch apiserver inference to tflite-runtime"
```

---

### Task 3: Update Dockerfile

**Files:**
- Modify: `apiserver/Dockerfile`

- [x] **Step 1: Swap model file references**

Replace:
```dockerfile
COPY captcha_model.keras .

ENV MODEL_PATH=captcha_model.keras
```

With:
```dockerfile
COPY captcha_model.tflite .

ENV MODEL_PATH=captcha_model.tflite
```

- [x] **Step 2: Commit**

```bash
git add apiserver/Dockerfile
git commit -m "feat: Dockerfile copies captcha_model.tflite for GCE deployment"
```

---

### Task 4: Create deploy-gce.sh

**Files:**
- Create: `apiserver/deploy-gce.sh`

- [x] **Step 1: Create the script**

```bash
#!/usr/bin/env bash
set -euo pipefail

DOCKERHUB_USER="${DOCKERHUB_USER:-}"
if [[ -z "$DOCKERHUB_USER" ]]; then
  echo "[錯誤] 請設定 DOCKERHUB_USER 環境變數，例如："
  echo "  DOCKERHUB_USER=youruser ./deploy-gce.sh"
  exit 1
fi

IMAGE="${DOCKERHUB_USER}/captcha-solver"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TFLITE_SRC="$(cd "$SCRIPT_DIR/.." && pwd)/tensorflow/captcha_model.tflite"

if [[ ! -f "$TFLITE_SRC" ]]; then
  echo "[錯誤] 找不到 TFLite 模型：$TFLITE_SRC"
  echo "請先執行：python tensorflow/convert_to_tflite.py"
  exit 1
fi

echo "[部署] 複製 TFLite 模型..."
cp "$TFLITE_SRC" "$SCRIPT_DIR/captcha_model.tflite"

echo "[部署] 建構並推送 linux/amd64 映像..."
docker buildx build \
  --platform linux/amd64 \
  -t "${IMAGE}:latest" \
  --push \
  "$SCRIPT_DIR"

echo "[完成] 已推送 ${IMAGE}:latest"
echo "Watchtower 將在 5 分鐘內自動更新 VM 上的容器。"
```

- [x] **Step 2: Make executable and commit**

```bash
chmod +x apiserver/deploy-gce.sh
git add apiserver/deploy-gce.sh
git commit -m "feat: add deploy-gce.sh for Docker Hub push + Watchtower auto-update"
```

---

### Task 5: Verify .gitignore excludes .tflite

**Files:**
- Read: `.gitignore`

- [x] **Step 1: Confirm *.tflite is excluded**

```bash
git check-ignore -v tensorflow/captcha_model.tflite apiserver/captcha_model.tflite 2>/dev/null || grep tflite .gitignore
```

Expected: both paths matched by `.gitignore` rule.

If missing, add it:
```bash
echo "*.tflite" >> .gitignore
git add .gitignore
git commit -m "chore: gitignore *.tflite model binaries"
```
