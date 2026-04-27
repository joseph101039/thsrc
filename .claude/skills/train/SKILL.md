---
name: train
description: Run the full THSRC captcha training pipeline — scrape new images, label them, then train the CRNN+CTC model. Use when retraining the model with fresh data.
disable-model-invocation: true
---

# Captcha Training Pipeline

Run each step in order. Activate the venv first.

```bash
source tensorflow/.venv/bin/activate
```

## Step 1: Scrape new captcha images

```bash
python3 tensorflow/scrape_captcha.py
```

Images land in `tensorflow/captcha_images/`. Requires system Chrome and a compatible ChromeDriver.

## Step 2: Label new images

```bash
python3 tensorflow/label_captcha.py --stats   # check current progress
python3 tensorflow/label_captcha.py            # start labeling (press Enter to confirm, Backspace to redo)
```

Labels are saved to `tensorflow/labels.json`.

## Step 3: Train the model

```bash
python3 tensorflow/train_captcha.py --epochs 300
```

Training uses EarlyStopping (patience=30) so it may stop before 300 epochs. Output model: `tensorflow/captcha_model.keras`.

## Step 4: Copy model to apiserver

```bash
cp tensorflow/captcha_model.keras apiserver/captcha_model.keras
```

## Step 5: Verify inference works

```bash
python3 tensorflow/predict_captcha.py --batch tensorflow/captcha_images/ --labels tensorflow/labels.json
```

Target: ≥97% string accuracy. If lower, collect more labeled data and retrain.
