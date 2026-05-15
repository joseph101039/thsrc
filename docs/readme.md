# THSRC 自動訂票代理系統 — 交付文件入口

> 自動代理使用者操作台灣高鐵訂票網站(`irs.thsrc.com.tw`),支援預約搶票、區間搜尋、自動重試、LINE 終態通知。

本目錄為對開發團隊與利害關係人的**交付文件總覽**。所有正式文件皆從這裡進入。

---

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
