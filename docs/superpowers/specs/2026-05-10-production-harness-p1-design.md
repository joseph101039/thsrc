# Production Harness P1 Design Spec

**Date:** 2026-05-10
**Status:** Draft
**Predecessor:** [P0 design](./2026-05-09-production-harness-p0-design.md)

---

## 1. Context

P0 補上了 logging / health probes / SQLite → GCS 備份。系統現在「跑得了」與「壞了看得到 log」,但仍然缺:

- **告警** — backup 失敗或 service 503 沒有人會知道,只能等下次手動檢查 log
- **指標** — 看不到 CPU / RAM / disk / RPS / p95 / booking 成功率隨時間變化;一旦 e2-micro 952MB 接近上限,沒有先警訊
- **可回滾的部署** — 目前 `latest` + watchtower,壞了沒得 rollback

P0 spec 已將這些列為「非目標,留給 P1+」。本 spec 針對 **P1 首期** — 在零月費前提下補上這三件事。

## 2. Goals & Non-Goals

### Goals

- **G1:Image versioning + rollback** — 每次部署同時打 SemVer git tag(`v1.2.3`)與 `latest`,rollback 流程文件化
- **G2:Metrics 收集 + 視覺化** — VM 主機指標(CPU / RAM / disk / 網路)+ container 指標(per-container RAM / CPU)+ 應用層指標(server RPS / p95 / booking 成功率)推送到 Grafana Cloud
- **G3:告警** — 透過 LINE Messaging API push message,由兩個來源觸發:
  - VM cron 內 backup-db.sh 失敗時直接 push(不依賴 metrics)
  - Grafana Cloud alert rule 觸發 webhook(disk / memory / CPU / readiness 等)
- **G4:零月費** — 全部落在 Grafana Cloud free tier(10K active series)、LINE Messaging API free tier(每月 200 則 push)、Docker Hub free 範圍內

### 非目標(留給 P1 二期或 P2+)

- Booking 成功率告警(需先有歷史基線,至少跑兩週 metrics 後再評估閾值)
- Audit log
- Distributed tracing
- 多環境(staging / prod 分離)
- Schema migration 自動化
- Auto-rollback(目前先做手動 rollback runbook)

## 3. 設計

### 3.1 Image Versioning + Rollback

**Tagging 策略:**

| Tag 形式 | 何時打 | 用途 |
|---|---|---|
| `:vMAJOR.MINOR.PATCH` | 每次 deploy 由 deploy script 強制要求 | 不可變參考點;rollback 目標 |
| `:latest` | 每次 deploy 同時更新 | watchtower 5 分鐘自動 pull |

**SemVer bump 規則:**

- `MAJOR` — Breaking change(API 異動、DB schema migration 不向後相容、env var 改名等)
- `MINOR` — 新功能(新 endpoint、新 background job、新 admin 功能)
- `PATCH` — Bug fix / docs / refactor / 觀測性增強(本 P1 都算 PATCH)

第一個 tag:**`v0.1.0`**(P0 完成的狀態,代表已具備可部署 production harness 的最小可行版本)。

**Deploy flow 變更:**

```
deploy-server.sh:
  1. 檢查 working tree clean (git diff --quiet)
  2. 取最新 git tag (semver),根據 --bump=patch|minor|major flag 計算下一個
  3. docker buildx build -t :vNEXT -t :latest --push
  4. git tag -a vNEXT -m "deploy: <commit subject>"; git push origin vNEXT
```

**Rollback flow:**

1. 在 Docker Hub 找到要回滾的 tag(`docker pull joseph50804/thsrc-server:v1.2.2`)
2. 本機 `docker tag joseph50804/thsrc-server:v1.2.2 joseph50804/thsrc-server:latest`
3. `docker push joseph50804/thsrc-server:latest`
4. 等 ≤ 5 分鐘 watchtower 自動 pull,或在 VM 上手動 `docker compose pull server && docker compose up -d server` 加速

詳細寫成 `docs/runbooks/rollback-server.md`。

### 3.2 Metrics(Grafana Cloud)

**為何 Grafana Cloud 而非自架 Prometheus + Grafana:**

- VM 952MB RAM 已被 captcha (~88MB) + server (~150MB) + scheduler (~150MB) + watchtower (~10MB) + alloy (~50MB) 吃近 50%。再加 Prometheus(常駐 storage、scrape 間隔)+ Grafana 會吃滿
- Free tier 容量足夠:10K active series 對個人專案綽綽有餘(預估實際使用 < 200 series)
- 雲端 UI 不依賴 VM,VM 重建期間仍可看歷史

**Architecture:**

```
┌──────────────────────── VM (e2-micro) ──────────────────────┐
│                                                              │
│   ┌───────────┐  ┌────────────┐  ┌────────────┐             │
│   │  server   │  │ scheduler  │  │  captcha   │             │
│   │           │  │            │  │            │             │
│   │ /metrics  │  │            │  │            │             │
│   │ prom-     │  │            │  │            │             │
│   │ client    │  │            │  │            │             │
│   └─────┬─────┘  └────────────┘  └────────────┘             │
│         │                                                    │
│         │ scrape :8081/metrics                              │
│         │                                                    │
│   ┌─────▼──────────────────────────────────────────┐        │
│   │            grafana/alloy (container)            │        │
│   │  - node_exporter receiver (host metrics)       │        │
│   │  - cAdvisor receiver (Docker per-container)    │        │
│   │  - prometheus.scrape → server :8081/metrics    │        │
│   │  - prometheus.remote_write → Grafana Cloud     │        │
│   └─────┬──────────────────────────────────────────┘        │
│         │                                                    │
└─────────┼────────────────────────────────────────────────────┘
          │ HTTPS push every 60s
          ▼
   ┌───────────────────────┐
   │   Grafana Cloud       │
   │   - hosted Prometheus │
   │   - hosted Grafana    │
   │   - alert rules       │
   └─────────┬─────────────┘
             │ webhook on alert fire
             ▼
   ┌───────────────────────┐
   │  notifier (server)    │
   │  POST /alerts/grafana │
   │  → LINE push          │
   └───────────────────────┘
```

**Server 端應用層指標(prom-client):**

| Metric | Type | Labels |
|---|---|---|
| `http_requests_total` | counter | `method`, `route`, `status_code` |
| `http_request_duration_seconds` | histogram | `method`, `route` |
| `bookings_total` | counter | `outcome` = `success` / `retry` / `failed` |
| `captcha_solver_duration_seconds` | histogram | — |
| `scheduler_heartbeat_seconds_since_last` | gauge | — |
| Default Node.js metrics(GC、event loop lag、CPU)| 各 | — |

**Alloy 收集的主機 / container 指標**(透過 prometheus.exporter.unix 與 cAdvisor):

| 來源 | 重要 series 範例 |
|---|---|
| `node_exporter` | `node_cpu_seconds_total`、`node_memory_MemAvailable_bytes`、`node_filesystem_avail_bytes`、`node_disk_io_time_seconds_total` |
| `cAdvisor` | `container_memory_usage_bytes{name=...}`、`container_cpu_usage_seconds_total{name=...}` |

**Authentication 與 secrets:**

- Grafana Cloud 申請 stack 後拿 `prometheus.remote_write` URL + 一組 token
- 寫進 VM 上 `~/alloy.env`(0600,git ignore),docker compose 透過 `env_file` 讀
- spec 不直接寫 token

**docker-compose.yml 新增:**

```yaml
alloy:
  image: grafana/alloy:latest
  volumes:
    - /:/host/rootfs:ro,rslave              # node_exporter 用
    - /sys:/host/sys:ro,rslave
    - /proc:/host/proc:ro,rslave
    - /var/run/docker.sock:/var/run/docker.sock:ro    # cAdvisor 用
    - ./alloy/config.alloy:/etc/alloy/config.alloy:ro
  env_file: alloy.env
  command: run /etc/alloy/config.alloy --server.http.listen-addr=0.0.0.0:12345
  restart: unless-stopped
  ports: []                                  # 不對外曝露
```

**配置檔位置:**`alloy/config.alloy`(checked in,不含 secrets)

### 3.3 告警(LINE Messaging API)

**Channel:** 既有 LINE channel(`Channel ID 2010027998`),push 給特定 user_id。

**通知模型:**

```
┌──────────────────────┐
│ backup-db.sh failure │ ─── direct curl ───┐
└──────────────────────┘                    │
                                            ▼
                                  ┌─────────────────────┐
                                  │ LINE Messaging API  │
                                  │ /v2/bot/message/push│
                                  └─────────────────────┘
                                            ▲
┌──────────────────────┐                    │
│ Grafana Cloud alert  │ ─── webhook ──┐    │
└──────────────────────┘               │    │
                                       ▼    │
                              ┌────────────────────┐
                              │ server             │
                              │ POST /alerts/grafana│ ──┘
                              │ → 格式化 + push     │
                              └────────────────────┘
```

**為什麼要走 server 中繼,而不是 Grafana Cloud 直接 push 到 LINE:**

- Grafana Cloud 內建 contact point 不支援 LINE Messaging API(只有 LINE Notify legacy 與通用 webhook)
- LINE Messaging API 的 push body 格式特殊(JSON payload + Bearer token),需要 server 把 Grafana 來的 generic JSON 轉換
- 中繼層也讓告警內容客製(中文、附 booking 統計、附 dashboard 連結)成為可能

**Server 新增:**

```
server/src/
  routes/
    alerts.js          - POST /alerts/grafana (Grafana Cloud webhook 接收)
  services/
    notifier.js        - sendLineMessage(text)
                       - 統一從 process.env.LINE_CHANNEL_TOKEN / LINE_USER_ID 讀
```

**Auth(防止外部惡意觸發 push):**

`/alerts/grafana` 加 shared secret header check,Grafana Cloud 在 webhook config 設 `Authorization: Bearer <random>` header。Secret 寫進 `.env` 的 `ALERT_WEBHOOK_SECRET`。

**P1 首期 alert rules:**

| Rule | 條件 | 來源 | 嚴重度 |
|---|---|---|---|
| Backup failed | backup-db.sh 退出非零 | cron 內 trap 直接 push | Critical |
| Backup stale | 24h 未上傳新物件(GCS object age > 24h) | Grafana alert(從 GCS metric 或 alloy 從 gsutil ls 報) | Critical |
| Disk >85% | `node_filesystem_avail_bytes / node_filesystem_size_bytes < 0.15` | Grafana alert | Warning |
| Memory <100MB available | `node_memory_MemAvailable_bytes < 100*1024*1024` 持續 5 min | Grafana alert | Warning |
| CPU 持續 90%+ | `rate(node_cpu_seconds_total{mode!="idle"}[5m]) > 0.9` 持續 10 min | Grafana alert | Warning |
| /readyz 持續 503 | server 上報 `up{job="server"}` 為 0 持續 5 min(Alloy scrape 失敗也視同) | Grafana alert | Critical |

**告警節流與合併(server-side 中繼處理):**

LINE Messaging API free tier 每月 200 則,需做兩層保護:

1. **Aggregation window(合併)** — 5 分鐘內到達的 alert 不立即 push,先放 buffer;窗口結束時把同窗口內的 alert 合成一則 LINE 訊息(條列式,含每條 fire time + summary)
2. **Dedup window(去重)** — 同一個 `alert_name`(例如 `disk_high`)在 30 分鐘內不再重發,即使期間又被觸發新事件也合併進前一則(避免反覆 push 用光額度)

**獨立的告警管理後台(非 sqladmin 通用 CRUD):**

`server/src/admin/` 加新頁面 `alerts.html`,直接 surface 告警系統各參數,提供:

- 全域 enabled toggle(關掉後 LINE 不發送但仍寫 server log)
- 全域節流參數:`aggregation_window_seconds`、`dedup_window_seconds`、`monthly_quota`
- 每個 alert type 的獨立開關 + 自訂閾值

**Schema:**

```sql
-- 全域節流設定(單列)
CREATE TABLE alert_settings (
  id                          INTEGER PRIMARY KEY CHECK (id = 1),
  enabled                     INTEGER NOT NULL DEFAULT 1,
  aggregation_window_seconds  INTEGER NOT NULL DEFAULT 300,
  dedup_window_seconds        INTEGER NOT NULL DEFAULT 1800,
  monthly_quota               INTEGER NOT NULL DEFAULT 180,
  updated_at                  TEXT NOT NULL
);

-- 各 alert type 的開關 + 閾值(每個 P1 alert 一筆)
CREATE TABLE alert_rules (
  name           TEXT PRIMARY KEY,         -- 'backup_failed' / 'disk_high' / 'memory_low' / 'cpu_high' / 'readyz_down' / 'backup_stale'
  enabled        INTEGER NOT NULL DEFAULT 1,
  threshold_json TEXT,                     -- 例:{"percent": 85} for disk_high;NULL 代表此規則無閾值
  updated_at     TEXT NOT NULL
);
```

**Admin panel UI(`alerts.html`):**

```
┌─────────────────────────────────────────────────────┐
│ 告警管理                                             │
│                                                      │
│ ─── 全域設定 ───────────────────────────────────    │
│ [✓] 啟用告警                                         │
│ 合併窗口 [  300] 秒  |  去重窗口 [ 1800] 秒          │
│ 月度上限 [  180] 則                                  │
│ [儲存]                                               │
│                                                      │
│ ─── 規則總覽 ───────────────────────────────────    │
│ Rule          Enabled  Threshold        本月觸發    │
│ backup_failed   ✓      —                     0      │
│ backup_stale    ✓      24 h                  0      │
│ disk_high       ✓      85 %                  0      │
│ memory_low      ✓      100 MB                0      │
│ cpu_high        ✓      90 % / 10m            0      │
│ readyz_down     ✓      503 / 5m              0      │
│ [編輯]                                               │
└─────────────────────────────────────────────────────┘
```

**Notifier 行為:**

- 啟動時把全域設定 cache 進 memory;每 60 秒 reload(讓 admin 改了不需重啟生效)
- in-memory map `alert_name → { lastPushAt, pendingMessages[] }` 做雙層節流
- Process restart 時 buffer 清空(可接受 — 重啟通常代表已知異常)
- 接到 alert 時:先看 `alert_rules.enabled`;再看月度 quota;再進合併/去重邏輯
- 月度 quota 超過時改寫 high-priority server log,並在 admin panel 顯眼標示「本月已超出額度」

**閾值生效路徑(手動同步):**

`alert_rules.threshold_json` 是 source of truth。Admin panel UI 提供「同步到 Grafana」按鈕:

1. server `/admin/api/alerts/sync` endpoint 讀 `alert_rules`,組成 Grafana Cloud alert rule expression
2. 透過 Grafana Cloud Alerting API 用 service account token 把 rule 集合 PUT 上去
3. UI 顯示 sync 結果(成功筆數 / 失敗訊息 / last_synced_at)

**為什麼手動而非即時 sync:**

- 個人專案改閾值頻率極低(可能整年只改 1-2 次)
- 即時 sync 失敗(Grafana API 暫時不可用)會讓 save 操作 UX 受影響;手動可重試
- User 按完按鈕後對「現在 Grafana 用的是什麼閾值」明確,不會懷疑同步狀態

UI 顯示 staging vs synced 差異:若 SQLite 內某 rule `updated_at > last_synced_at`,在 alert_rules 列表標示「⚠ 待同步」。

### 3.4 Rollout 順序(三個 PR)

| PR | 範圍 | 依賴 |
|---|---|---|
| PR-4(image versioning + rollback runbook)| deploy-server.sh 改寫、捕第一個 v0.1.0 tag、rollback runbook | 無 |
| PR-5(metrics: alloy + prom-client + dashboard)| docker-compose alloy service、alloy/config.alloy、server prom-client middleware、Grafana Cloud stack 申請 + dashboard | 無 |
| PR-6(alerting: backup curl + alerts route + Grafana rules)| backup-db.sh 末段加 LINE push trap、server `/alerts/grafana` route、`alert_settings` table + admin panel 頁面、notifier 5min 合併 + 30min dedup、Grafana alert rules | PR-5 完成(disk/CPU/memory rules 須 metrics 已上報) |

PR-4 與 PR-5 可並行;PR-6 需等 PR-5。

## 4. 用量估算

| 資源 | 預估用量 | Free tier 上限 | 餘裕 |
|---|---|---|---|
| Grafana Cloud active series | ~200 | 10000 | 50× |
| Grafana Cloud log ingestion | 0(本 P1 不送 log)| 50 GB/月 | 全餘 |
| LINE Messaging API push messages | < 30 / 月(假設一週一次 backup 偶發失敗 + 月度漂移)| 200 / 月 | 6× |
| Docker Hub image storage | 額外 ~50 個 SemVer tag,共 ~500MB | 無上限,但保留期限策略 | 需手動清理舊 tag(列入 PR-4 runbook) |
| VM RAM 增加 | alloy ~50MB | 952MB(目前用 ~50%)| 仍 < 60% |

## 5. 風險與緩解

| 風險 | 緩解 |
|---|---|
| LINE API token / Channel access token 洩漏 | 寫 `.env`,server image 不烘焙;`server/src/services/notifier.js` 啟動時 fail-fast 若 env 缺 |
| Grafana Cloud webhook 來源沒驗證,任何人可以打 server `/alerts/grafana` 觸發 LINE 灌爆 | shared secret header check;節流 LRU |
| alloy 拉滿 RAM 或炸 e2-micro | 設 `mem_limit: 128m`;觀察一週後若不夠則調整 |
| 200 則 / 月用完 | 節流 30 min 一則;Critical 加 push,Warning 限制單日上限 |
| watchtower 自動 pull `:latest`,但 rollback 時 watchtower 還沒拉新 latest 之前舊版繼續跑 | rollback runbook 標明:推 `:latest` 後執行 `docker compose pull && up -d` 強制立即生效 |
| Grafana Cloud free tier 政策變動(過去 PromQL 5K → 10K series 已調過一次) | 每季 review 一次用量;若超出可改 self-hosted Prometheus(屆時記憶體應已不是問題) |
| backup 失敗 → LINE push 也失敗(network、token expired)| backup script 寫 fallback log 到 GCS bucket 的 `errors/` 路徑;P2 加 dead-letter 機制 |

## 6. Decision log

| 決定 | 替代方案 | 為何選擇 |
|---|---|---|
| LINE Messaging API | Discord webhook、SendGrid email | 你已有 LINE channel,個人 LINE 收訊及時 |
| SemVer 熟成規則 | 每 PR 自動 +PATCH | 你選熟成規則。MAJOR/MINOR/PATCH 區分能讓未來看 git tag 知道變更性質 |
| Grafana Cloud free tier | VM 自架 Prometheus + Grafana、GCP Cloud Monitoring | RAM 受限 + 雲端 UI 永遠可用 + 免費容量足 |
| Alloy 走 docker compose service | VM host 安裝 | 你選 docker compose,VM 重建友善 |
| Grafana Cloud → server `/alerts/grafana` → LINE 中繼 | Grafana Cloud 直接 webhook to LINE Notify | LINE Notify 已 EOL;Messaging API 需要 Bearer token + JSON 結構,Grafana 內建 contact point 無此 flavor |
| backup 失敗直接 cron 內 curl LINE,不走 server 中繼 | 統一走 server | 避免循環依賴(server 掛了 backup 仍要能告警) |

## 7. Resolved Questions

- ✅ Grafana Cloud stack region — `us-east`
- ✅ Disk 警告閾值 — `85%`(目前用量遠低於此,留出充裕反應時間)
- ✅ LINE 告警合併與節流 — 5 min aggregation + 30 min dedup,參數寫 SQLite `alert_settings` 表,從 admin panel 調整
