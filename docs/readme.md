# THSRC 自動訂票代理系統 — 交付文件入口

> 自動代理使用者操作台灣高鐵訂票網站(`irs.thsrc.com.tw`),支援預約搶票、區間搜尋、自動重試、LINE 終態通知。

本目錄為對開發團隊與利害關係人的**交付文件總覽**。所有正式文件皆從這裡進入。

---

## 前後端系統圖

> 受限 Google Compute Engine free-tier 的資源限制(2 vCPU， 1 GB RAM)，系統架構以**單機多容器**為主，透過 Docker Compose 編排。以下圖示與說明皆依此架構設計。
> 前端為 GitHub Pages 靜態站，透過 Cloudflare Named Tunnel 連到 GCE VM 上以 docker compose 編排的五個 service。

```
+----------------------------------------------------------------------+
|  [Frontend]  Browser -- GitHub Pages static site (HTML/CSS/JS)        |
|              https://joseph101039.github.io/thsrc-booking/            |
+----------------------------------+-----------------------------------+
                                   | HTTPS (JWT Bearer)
                                   v
                  +-------------------------------+
                  |  Cloudflare Named Tunnel      |
                  |  api.joseph101039.uk -> :8081 |
                  +---------------+---------------+
                                  |
+=================================+====================================+
|  GCE VM (e2-micro / us-west1-b) |                                     |
|   docker compose                v                                     |
|  +-------------------+   +-------------------+                        |
|  | server (Node.js)  |   | scheduler(Node.js) |                       |
|  | 對外 API,承接前端   |   | 定時輪詢資料庫       |                       |
|  | 與建立訂票          |   | 執行訂票/退票       |                        |
|  +----+---------+----+   +----+---------+----+                        |
|       |         |             |         |                             |
|       |         +-- db-data --+         |  ══ POST /solve             |
|       |            volume (SQLite,      |  (server 與 scheduler       |
|       |            兩服務共用)            |   訂票時皆呼叫)               |
|       |                                 v                             |
|       |                            +-------------------+              |
|       |                            | captcha (Python)  |              |
|       | scrape :8081 / :8082       | 圖形驗證碼辨識服務   |              |
|       | /metrics                   | CRNN+CTC 模型      |              |
|       |                            | 服務 (:8080)       |              |
|       v                            +-------------------+              |   
|  +----------------+   +----------------+                              |
|  | alloy          |   | watchtower     |                              |
|  | 收集指標並推送   |   | 自動更新各服務    |                              |
|  | 至雲端監控平台   |   | 的容器映像檔      |                              |
|  +-------+--------+   +----------------+                              |
+==========+===========================================================+
           | remote_write (Prometheus)
           v
   +----------------+   Alerting webhook    +----------------+
   | Grafana Cloud  | --- /alerts/grafana ->| LINE Messaging |
   | 儀表板/告警規則  |     回送至 server      | 訂票終態通知     |
   +----------------+                       +----------------+

外部相依:
  - irs.thsrc.com.tw  <- server / scheduler 對外連線高鐵網站 (Akamai WAF + Wicket)
  - GCS bucket        <- backup-db.sh 每日備份 SQLite (VM cron,不在 compose 內)
```

## 交付文件清單

| 類別 | 文件 | 路徑 |
|---|---|---|
| 產品需求 | PRD — Product Requirements Document | [`deliverables/2026-05-15-thsrc-system-prd.md`](deliverables/2026-05-15-thsrc-system-prd.md) |
| 功能規格 | FSD — Functional Specification Document | [`deliverables/2026-05-15-thsrc-system-fsd.md`](deliverables/2026-05-15-thsrc-system-fsd.md) |
| 使用者故事 | User Stories(5 Epic / 22 Story,含 AC) | [`deliverables/2026-05-15-thsrc-system-user-stories.md`](deliverables/2026-05-15-thsrc-system-user-stories.md) |
| 使用情境 | Use Cases(12 個 UC,含主流程 / 替代 / 例外) | [`deliverables/2026-05-15-thsrc-system-use-cases.md`](deliverables/2026-05-15-thsrc-system-use-cases.md) |
| 系統架構 | 系統架構與資料流圖、訂票狀態機、GCP 資源清單 | [`data_flow.md`](data_flow.md) |
| API 規格 | OpenAPI / Swagger 規格 | [`swagger.yaml`](swagger.yaml) |
| 運維文件 | Runbooks(部署、回滾、備份還原、GCS、Grafana、LINE Bot 設定) | [`runbooks/`](runbooks/) |
| 儀表板 | Grafana Dashboard JSON | [`dashboards/`](dashboards/) |
| 告警 | Grafana Alerting 規則文件 | [`alerts/`](alerts/) |

---

## 開發 / 維運入口

- **專案 README、Architecture Gotchas、Dev Workflow**:repo root [`CLAUDE.md`](../CLAUDE.md)。
- **全域工作流程(Brainstorm → Plan → Review → Commit → PR)**:`~/.claude/CLAUDE.md`(個人設定,未進版控)。

---

## 歷史 / 過往 design specs

`superpowers/specs/` 內收錄各功能演進的 design specs(依日期命名),屬內部規劃紀錄。對外交付以本目錄 `deliverables/` 為準。
