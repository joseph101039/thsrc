# PRD — THSRC 自動訂票代理系統

| 項目 | 內容 |
|---|---|
| 文件類型 | Product Requirements Document(產品需求文件) |
| 版本 | 1.0(現況回顧 / as-is) |
| 撰寫日期 | 2026-05-15 |
| 對應系統版本 | `main` 分支現行上線版本 |
| 目標讀者 | PM、後端 RD、前端 RD、QA、SRE/維運 |

---

## 1. 產品概述(Product Overview)

THSRC 自動訂票代理系統,協助使用者預先設定訂票條件,系統於開放訂票時間自動向台灣高鐵官網(`irs.thsrc.com.tw`)搶票,並透過 LINE 通知終態。系統整合 CAPTCHA 機器辨識服務,大幅降低使用者親自操作所需的時間與人力成本。

- **後端 API**:`https://api.joseph101039.uk`(Node.js + Express,部署於 GCE)
- **前端 UI**:`https://joseph101039.github.io/thsrc-booking/`(GitHub Pages,純 HTML/CSS/JS)
- **CAPTCHA 解題服務**:獨立 CRNN+CTC 模型 API
- **資料持久化**:SQLite(每日備份到 GCS)
- **觀測**:Grafana Cloud + LINE 告警

## 2. 問題陳述(Problem Statement)

1. 台灣高鐵熱門時段車票於開放當下幾分鐘內售罄,使用者需手動操作多步驟表單(查詢→輸入驗證碼→選車次→填乘客資料),容易錯失。
2. 高鐵網站採 Apache Wicket + Akamai WAF 防護,瀏覽器表單元素(radio ID、formAction)為動態值,使用一般 RPA 工具不穩定。
3. 無原生 API,圖形驗證碼需人工辨識,無法以排程方式完成自動訂票。

## 3. 產品目標(Goals)

| # | 目標 | 衡量指標 |
|---|---|---|
| G1 | 提供使用者預約搶票,於指定時間自動執行 | 排程命中率 ≥ 95%(scheduled_at 到觸發 ≤ 60s) |
| G2 | 訂票成功率高 | 單筆訂票成功率 ≥ 80%(在票源充足前提下) |
| G3 | 對使用者透明,終態主動通知 | 成功/失敗 LINE 通知到達率 ≥ 99% |
| G4 | 維護成本低,個人小規模 | 月度 GCP/Grafana/LINE 成本 ≤ $0(免費方案內) |
| G5 | 服務可用度 | `/readyz` 月可用度 ≥ 99% |

### 非目標(Non-Goals)

- 不支援團體票(>10 人)、企業票、學生團體票等特殊票種。
- 不代收付款;訂票成功後使用者需自行於高鐵 App / 超商 / 信用卡通路完成付款。
- 不協助使用者註冊高鐵會員、累積 TGo 點數。
- 不支援其他國家鐵路系統。

## 4. 目標使用者(User Personas)

| Persona | 描述 | 主要痛點 |
|---|---|---|
| **一般通勤者 / 旅客** | 熟悉手機操作,每月 1–4 次搭乘高鐵 | 開放訂票時段難搶到熱門車次 |
| **商務出差人士** | 出差頻繁,行程常臨時變動 | 退票/改票流程繁瑣 |
| **管理員(Admin)** | 系統擁有者本人,負責維運 | 需即時掌握告警、控制通知開關 |

## 5. 核心功能範疇(Feature Scope)

### 5.1 使用者端功能

1. **Google SSO 登入** — 僅允許 admin 預先加入的白名單 email。
2. **乘客資料管理** — CRUD 常用乘客檔案(身分證、姓名、電話、Email)。
3. **建立訂票** — 出發/目的地、日期、期望時間、允許區間、票種與乘客;支援「立即訂」與「預約時間搶票」。
4. **訂票清單與詳情** — 列出歷史訂票、狀態、訂位代號、每次嘗試紀錄。
5. **取消 / 退票** — 視狀態提供操作。
6. **LINE 終態通知** — 訂票成功/失敗自動推送(不含 PII)。

### 5.2 管理員功能

1. **使用者白名單管理** — 新增 / 刪除允許登入的 email。
2. **通知開關** — 訂票成功 / 失敗 LINE 通知 toggle。
3. **告警規則管理** — 列出 Grafana alert rules、暫停 / 啟用。

### 5.3 系統功能

1. **排程器** — 每 60s 掃描 `status='pending' AND scheduled_at <= now` 的訂票並執行。
2. **重試機制** — 失敗後排程 2 分鐘後重試,達 `maxRetries` 後標記 `failed`。
3. **卡住恢復** — `running` 狀態超過 10 分鐘自動重置回 `pending`。
4. **CAPTCHA 自動解題** — POST base64 PNG 到 solver API,confidence < 閾值或解題錯誤觸發 retry。
5. **告警與觀測** — Prometheus 指標、Grafana 儀表板、Grafana Alerting → LINE。
6. **每日資料備份** — SQLite VACUUM INTO → GCS,30 天 lifecycle。

## 6. 成功指標(Success Metrics / KPI)

| KPI | 目標值 | 量測方式 |
|---|---|---|
| 訂票排程觸發延遲(p95) | ≤ 60s | `thsrc_booking_pending` gauge + 排程器 log |
| 單次訂票嘗試耗時(p95) | ≤ 30s | `thsrc_booking_duration_seconds` histogram |
| CAPTCHA solver 回應(p95) | ≤ 2s | `thsrc_captcha_solve_duration_seconds` |
| API 可用度 | ≥ 99% | `/readyz` 200 比例 |
| 月 GCP 支出 | $0(Always Free) | GCP billing |

## 7. 技術限制(Constraints)

1. **資料合規** — 系統處理使用者身分證,須加密儲存 / 傳輸 token / log redact;不得寫入 prod 之外。
2. **高鐵站防護** — Akamai WAF,需保持完整 cookie jar、瀏覽器 header,避免被識別為 bot 而封鎖 IP。
3. **預算** — 必須維持在 GCP Always Free、Grafana Cloud Free、LINE Messaging API Free(200 通/月)內。
4. **單一 VM** — 目前 e2-micro(952MB RAM),無 HA;重啟期間服務不可用約 1–2 分鐘。
5. **法律** — 不協助黃牛、不大量搶票轉售;每帳號訂票需綁定真實乘客。

## 8. 風險與緩解(Risks)

| 風險 | 影響 | 緩解 |
|---|---|---|
| 高鐵站改版表單欄位 | 訂票全面失敗 | E2E 測試 + 監控成功率告警;以 regex/動態解析降低耦合 |
| Akamai bot detection 強化 | IP 被封 | 完整模擬瀏覽器 header;若被封即時告警 |
| CAPTCHA 模型準度下降 | 重試暴增,排程延遲 | Grafana 監控 solver 錯誤率;模型可重新訓練 |
| VM 重啟期間漏掉訂票 | 使用者錯失車次 | 排程器啟動會掃描所有 `pending` 補跑;`running` 卡住自動恢復 |
| LINE 200 通/月用罄 | 終態通知停發 | Admin 可關閉成功通知,僅留失敗通知 |

## 9. 里程碑現況(High-Level Roadmap)

當前版本為穩定上線狀態,後續方向(非本 PRD 強制要求):

- 多通知通道(Email、Telegram)。
- 票價計算 / 早鳥票自動選擇。
- 真正的乘客身分驗證(目前僅本人帳號自填)。
- HA / 災備(多區域 VM)。
- 行動 App。

## 10. 相關文件

- 系統架構與資料流:`docs/data_flow.md`
- FSD(功能規格):`docs/deliverables/2026-05-15-thsrc-system-fsd.md`
- User Stories:`docs/deliverables/2026-05-15-thsrc-system-user-stories.md`
- Use Cases:`docs/deliverables/2026-05-15-thsrc-system-use-cases.md`
- Runbooks:`docs/runbooks/`
- API 規格:`docs/swagger.yaml`(Swagger / OpenAPI)
