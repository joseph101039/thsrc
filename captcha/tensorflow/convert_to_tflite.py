#!/usr/bin/env python3
"""Convert captcha_model_cpu.keras -> captcha_model.tflite (float32, no quantization).

The source model must have been trained with LSTM implementation=1 (train_captcha_cpu.py).
GPU-trained models (CudnnRNNV3 kernel) cannot be converted to standard TFLite.

Usage:
  python convert_to_tflite.py
  python convert_to_tflite.py --src captcha_model_cpu.keras --dst captcha_model.tflite
"""

import argparse
import sys
from pathlib import Path

BASE_DIR = Path(__file__).parent

parser = argparse.ArgumentParser()
parser.add_argument("--src", default=str(BASE_DIR / "captcha_model_cpu.keras"))
parser.add_argument("--dst", default=str(BASE_DIR / "captcha_model.tflite"))
args = parser.parse_args()

SRC = Path(args.src)
DST = Path(args.dst)

if not SRC.exists():
    print(f"[錯誤] 找不到模型：{SRC}", file=sys.stderr)
    print("請先執行：python tensorflow/train_captcha_cpu.py", file=sys.stderr)
    sys.exit(1)

import os
# Disable all GPU/Metal devices before TF initializes — forces CPU-only LSTM ops in the graph
os.environ["CUDA_VISIBLE_DEVICES"] = ""
os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"

try:
    import tensorflow as tf
except ImportError:
    print("[錯誤] 請在 tensorflow venv 中執行：source tensorflow/.venv/bin/activate", file=sys.stderr)
    sys.exit(1)

# Hide GPU after import as belt-and-suspenders
tf.config.set_visible_devices([], "GPU")

print(f"載入模型：{SRC} ...")
model = tf.keras.models.load_model(str(SRC), compile=False)

print("轉換為 TFLite（float32）...")
converter = tf.lite.TFLiteConverter.from_keras_model(model)
tflite_model = converter.convert()

DST.write_bytes(tflite_model)
print(f"完成：{DST}  ({len(tflite_model) / 1e6:.1f} MB)")
