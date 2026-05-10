# Setup Grafana Cloud (Free Tier)

> 目標:申請 Grafana Cloud 免費方案,取得 Prometheus `remote_write` 端點與 token,
> 給本專案的 Alloy collector 使用。免費方案目前限制:
> - 10K active series(本專案 server 約用 < 200 series,有充裕空間)
> - 14 天 metrics 保留
> - 無需信用卡

整個流程約 10 分鐘,完成後請把產出的 3 個值貼到本機 `.env`(不要 commit)。

---

## 1. 註冊 Grafana Cloud 帳號

1. 開啟 https://grafana.com/auth/sign-up/create-user
2. 用 GitHub / Google 登入即可(免信用卡)
3. 第一次登入會要求建立 stack:
   - **Stack name:** `thsrc`(或任何你喜歡的名字)
   - **Region:** `us-east`(美東,延遲對 GCE us-west1 可接受;歐洲區延遲較高)
   - **Cloud:** AWS(預設即可)
4. 點 **Create stack**,等 1–2 分鐘 provision 完成

完成後會進入 stack 首頁,網址形如 `https://<stack-name>.grafana.net/`。

---

## 2. 取得 Prometheus `remote_write` 設定

1. 在 Grafana Cloud Portal(https://grafana.com/orgs/<your-org>/stacks)點 **Details** 進入你的 stack
2. 左側找 **Prometheus** → 點 **Send Metrics**(或 **Configure**)
3. 畫面會出現一段 `remote_write` 設定範例,記下三個值:

   | 欄位 | 範例 | 用途 |
   |---|---|---|
   | URL | `https://prometheus-prod-XX-prod-us-east-0.grafana.net/api/prom/push` | Alloy 推送的目的地 |
   | Username (Instance ID) | `1234567`(純數字) | basic auth 帳號 |
   | Password / Token | 點 **Generate now** 產生的字串 | basic auth 密碼 |

   > Token 只會顯示一次,**立刻複製**。如果遺失,只能重新產生一個。

4. (可選)在同畫面下方有 **Test connection** 按鈕,可先空跑驗證 token 有效。

---

## 3. 寫入本機 `.env`(monorepo 根目錄)

> ⚠️ **動手前務必確認 `.env` 已在 `.gitignore` 內**:
> ```bash
> grep -E '^\.env$|^\.env$' .gitignore && echo "OK: .env is git-ignored"
> ```
> 若沒輸出,先把 `.env` 加進 `.gitignore` 並 commit,再寫入 secrets。
> Token 一旦 commit 進 git history 即無法輕易撤回(必須 rotate token + force push)。

把上面 3 個值加到 `/Users/joseph/projects/nodejs/thsrc/.env`:

```bash
# Grafana Cloud — Prometheus remote_write
GRAFANA_PROM_URL=https://prometheus-prod-XX-prod-us-east-0.grafana.net/api/prom/push
GRAFANA_PROM_USER=REPLACE_WITH_INSTANCE_ID
GRAFANA_PROM_TOKEN=glc_REPLACE_ME

# /metrics 端點的 Bearer token(同時保護 server:8081/metrics 與 scheduler:8082/metrics;自己生一個亂數)
# macOS: openssl rand -hex 32
METRICS_TOKEN=REPLACE_WITH_32_BYTE_HEX
```

`METRICS_TOKEN` 用來保護 server 的 `/metrics` 端點,Alloy 會在 scrape 時帶上。
產生指令:

```bash
openssl rand -hex 32
```

---

## 4. 部署到 GCE VM

部署 PR-5 之後,VM 上的 `~/.env` 也要加上面 4 個變數。

> ⚠️ **不要用 `gcloud --command='cat >> ~/.env <<EOF ...'`**:secret 會留在本機 shell history、
> 遠端 shell history、以及 GCP audit log。改用 `scp` 把預先寫好的 secret 片段檔案丟上去:

```bash
# 1. 本機產一個只含這次新增 4 行的暫存檔(不要把整份 .env 上傳)
cat > /tmp/grafana-env-fragment <<'EOF'
GRAFANA_PROM_URL=...
GRAFANA_PROM_USER=...
GRAFANA_PROM_TOKEN=...
METRICS_TOKEN=...
EOF
chmod 600 /tmp/grafana-env-fragment

# 2. scp 上 VM(走 OS Login / IAP,不會進 audit --command payload)
gcloud compute scp /tmp/grafana-env-fragment \
  instance-20260427-141455:/tmp/grafana-env-fragment \
  --zone=us-west1-b --project=sincere-office-494609-m3

# 3. SSH 進去把片段附加到 ~/.env、設權限、刪暫存
gcloud compute ssh instance-20260427-141455 \
  --zone=us-west1-b --project=sincere-office-494609-m3 \
  --command='cat /tmp/grafana-env-fragment >> ~/.env && chmod 600 ~/.env && rm /tmp/grafana-env-fragment'

# 4. 本機刪暫存 + 清 shell history(可選)
rm /tmp/grafana-env-fragment
# 若用 zsh:history -c 清當前 session;~/.zsh_history 會在離開 session 時被覆寫
```

接著重新拉新 image + 啟動 alloy:

```bash
gcloud compute ssh instance-20260427-141455 \
  --zone=us-west1-b --project=sincere-office-494609-m3 \
  --command='cd ~ && docker compose pull && docker compose up -d server scheduler alloy'
```

---

## 5. 驗證資料有抵達 Grafana Cloud

1. 進 stack:`https://<stack-name>.grafana.net/`
2. 左側 **Explore** → data source 選 **grafanacloud-<stack>-prom**
3. 查詢:`up{job="thsrc-server"}`,應該看到一條值為 `1` 的時序
4. 同樣 `up{job="thsrc-scheduler"}` 也應該為 `1`(scheduler 跑在 :8082,Alloy 走 internal network 抓)
5. 也可查 `thsrc_booking_pending` 確認 server 業務指標有送上來

若 Explore 沒資料:
- VM 上 `docker logs joseph-alloy-1 --tail 50` 看 alloy 是否報 401(token 錯)/ 連線錯誤
- 確認 alloy 跟 server 在同一 docker network(`docker network inspect joseph_default`)

---

## 6. 匯入 Dashboard

repo 內有預先做好的 dashboard JSON:`docs/dashboards/thsrc-overview.json`

1. 進 stack:`https://<stack-name>.grafana.net/dashboards`
2. 右上角 **New** → **Import**
3. **Upload JSON file** 選 `docs/dashboards/thsrc-overview.json`
4. **Prometheus** data source 選 `grafanacloud-<stack>-prom`
5. 點 **Import**

Dashboard 包含:
- Server up/down 狀態
- HTTP 請求 rate / 延遲 p50/p95/p99
- Pending booking gauge
- Booking outcomes(success/failed/retrying 每分鐘累計)
- Captcha solve 延遲
- Process RSS 記憶體

匯入後若需調整,直接在 Grafana UI 編輯即可(JSON 是起始模板,非單一真相來源)。

## 7. Token 輪替 / 撤銷

Grafana Cloud Portal → stack → Prometheus → **Access Policies / API Keys** 可撤銷舊 token、產新 token。
撤銷後記得同步更新 `.env` 並重啟 alloy:`docker compose restart alloy`。

---

## 異常處理

**`401 Unauthorized` from remote_write**
- Username 不是 email,而是 **Instance ID**(純數字)
- Token 是否複製完整(開頭通常是 `glc_`)

**`out of order sample` 或 `duplicate sample`**
- 多個 alloy / 多個 server 同時推同一組 label。確認 compose 只跑一個 alloy

**Free tier 額度用光**
- Stack 首頁的 **Billing** / **Usage** 看 active series 數
- 本專案預期 < 500;若超出檢查是否誤開高 cardinality label(例如 `request_id` 當 label)
