# 24h 滾輪時間選擇器設計

## 背景

`booking.html` 的時間輸入欄位使用 `<input type="time">`，在 iOS Safari 強制顯示為 12h AM/PM 格式，與使用者預期的 24h 輸入不符。本改動為手機用戶（iOS Safari 為主）提供原生 24h 體驗。

## 需求

- 4 個時間欄位（期望時間、允許最早、允許最晚、預約時間）一律 24h 顯示
- 支援滾輪選擇（點擊箭頭或觸控滑動）
- 保留手動文字輸入（`HH:MM` 格式）
- 手打與滾輪雙向同步
- 分鐘刻度：每 10 分鐘（00, 10, 20, 30, 40, 50）

## UI 設計

點擊 time input → input 正下方展開 picker panel；點擊 panel 外或按「確認」關閉。同一時間只有一個 picker 展開。

```
┌──────────────────────┐
│  ▲          ▲        │
│  08   :    30        │
│  ▼          ▼        │
│        確認          │
└──────────────────────┘
```

- 左欄：小時 00–23（24 格，循環）
- 右欄：分鐘 00, 10, 20, 30, 40, 50（6 格，循環）
- 確認 → 寫回 input（`HH:MM`）並關閉

## 文字輸入行為

- `type="text" inputmode="numeric" placeholder="HH:MM" maxlength="5"`
- `blur` 時驗證：regex `^([01]\d|2[0-3]):[0-5]\d$`
- 驗證失敗 → input 加 `.input-error` class（紅框）
- 驗證成功 → 下次開 picker 時滾輪對齊已輸入值

## 實作範圍

| 檔案 | 變更 |
|------|------|
| `ui/js/time-picker.js` | 新增：picker DOM、滾輪邏輯、touch/click/blur 事件 |
| `ui/booking.html` | 4 個 `type="time"` → `type="text"`；引入 `time-picker.js` |
| `ui/js/booking.js` | 加 `isValidTime()` 驗證；submit 時驗證 4 個 time 欄位 |
| `ui/css/style.css` | 加 picker panel 樣式、`.input-error` 紅框 |

Server 端不需修改（時間格式已是 `HH:MM`）。

## 不在範圍內

- 鍵盤導航（Tab/方向鍵操作 picker）
- 分鐘刻度細到 1 分鐘
- 動畫慣性滾動
