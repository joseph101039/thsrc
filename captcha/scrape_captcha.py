#!/usr/bin/env python3
"""
THSRC Captcha Image Scraper (real Chrome via Selenium)
用真實 Chrome 瀏覽器抓取台灣高鐵訂票驗證碼圖片。

流程：
  每張圖建立全新 Chrome driver → 載入訂票頁 → element.screenshot() → quit driver
  完全隔離，避免 renderer OOM crash。
  儲存為 captcha_001.png … captcha_NNN.png
"""

import sys
import time
import random
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options
from selenium.common.exceptions import TimeoutException, WebDriverException

# ── 設定 ──────────────────────────────────────────────────────────────────────
BOOKING_URL  = "https://irs.thsrc.com.tw/IMINT/"
OUTPUT_DIR   = Path(__file__).parent / "captcha_images"
TOTAL        = 100
DELAY_MIN    = 1.5
DELAY_MAX    = 3.0
NAV_TIMEOUT  = 90   # 秒
MAX_RETRIES  = 3    # 每張圖最多重試次數（含重建 driver）
# ──────────────────────────────────────────────────────────────────────────────


def make_driver() -> webdriver.Chrome:
    opts = Options()
    opts.add_argument("--window-size=430,932")
    opts.add_argument("--lang=zh-TW")
    opts.set_capability("pageLoadStrategy", "normal")
    return webdriver.Chrome(options=opts)


def dismiss_cookie_banner(driver):
    try:
        btn = driver.find_element(By.CSS_SELECTOR,
            "#cookiePolicy button, .cookie-policy-container button")
        btn.click()
        time.sleep(0.5)
    except Exception:
        try:
            driver.execute_script(
                "const el = document.getElementById('cookiePolicy'); if(el) el.style.display='none';"
            )
        except Exception:
            pass


def grab_one(dest: Path) -> bool:
    """建立新 driver，載入頁面，截圖驗證碼，quit。回傳是否成功。"""
    driver = make_driver()
    try:
        driver.get(BOOKING_URL)
        WebDriverWait(driver, NAV_TIMEOUT).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, "img[src*='homeCaptcha']"))
        )
        time.sleep(1.0)
        dismiss_cookie_banner(driver)

        img = driver.find_element(By.CSS_SELECTOR, "img[src*='homeCaptcha']")
        size = img.size
        if size['width'] == 0 or size['height'] == 0:
            return False
        img.screenshot(str(dest))
        return dest.exists() and dest.stat().st_size > 100
    except (TimeoutException, WebDriverException) as e:
        print(f"  grab 失敗：{e}", file=sys.stderr)
        return False
    finally:
        try:
            driver.quit()
        except Exception:
            pass


def next_index(output_dir: Path) -> int:
    """回傳下一個可用的編號（現有最大編號 + 1，從 1 開始）。"""
    existing = [
        int(p.stem.split("_")[-1])
        for p in output_dir.glob("captcha_*.png")
        if p.stem.split("_")[-1].isdigit()
    ]
    return max(existing, default=0) + 1


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"輸出資料夾：{OUTPUT_DIR}")
    print(f"目標張數：{TOTAL}\n")

    success = 0
    fail    = 0
    idx     = next_index(OUTPUT_DIR)

    while success < TOTAL:
        filename = OUTPUT_DIR / f"captcha_{idx:03d}.png"
        print(f"[{success + 1:3d}/{TOTAL}] 抓取中…", end=" ", flush=True)

        ok = False
        for attempt in range(MAX_RETRIES):
            if filename.exists():
                filename.unlink()
            ok = grab_one(filename)
            if ok:
                break
            print(f"  重試 {attempt+1}/{MAX_RETRIES}…", end=" ", flush=True)
            time.sleep(3)

        if ok:
            size_kb = filename.stat().st_size // 1024
            print(f"✓ {filename.name}  ({size_kb} KB)")
            success += 1
            idx += 1
        else:
            print(f"✗ 失敗", file=sys.stderr)
            if filename.exists():
                filename.unlink()
            fail += 1

        if success < TOTAL:
            time.sleep(random.uniform(DELAY_MIN, DELAY_MAX))

    print(f"\n完成！成功 {success} 張 / 失敗 {fail} 張")
    print(f"圖片儲存於：{OUTPUT_DIR}")


if __name__ == "__main__":
    main()
