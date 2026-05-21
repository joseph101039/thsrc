# E2E 整合測試設計

**日期：** 2026-05-21
**狀態：** 已核准
**目標：** 驗證前後端完整 user journey 及 API contract，覆蓋 happy path + 跨層失敗場景

---

## 1. 目標與範圍

### 測試目的
1. **User Journey**：真實瀏覽器執行前端 JS → fetch API → 後端處理 → DOM 渲染結果
2. **API Contract**：確保後端 response 格式與前端 JS 用到的欄位一致，防止 drift

### 不在範圍內
- 後端各種 400 邊界條件（已由 `server/test/` 覆蓋）
- 高鐵真實訂票流程（`immediate: true` 只測 mock 結果）
- scheduler retry 中間態（只測最終態 UI 呈現）
- CI 自動化（先求本機可跑，架構保留接 CI 的空間）

---

## 2. 技術選型

| 項目 | 選擇 | 理由 |
|------|------|------|
| 瀏覽器自動化 | **Playwright** | 現代 API、auto-wait、trace viewer、Node.js 生態契合 |
| 測試環境 | **docker-compose.test.yml + `-p thsrc-test`** | 與開發環境完全隔離，volume/network 獨立 |
| 帳號策略 | **每次測試自動 register**，測完整個 DB 丟掉 | 不依賴預先建立的帳號 |
| 立即訂票 mock | **`MOCK_BOOKING_ENGINE=true` 環境變數** | 不打高鐵，可測完整 UI flow |

---

## 3. 目錄結構

```
thsrc/
├── docker-compose.test.yml        # 測試專用 compose
├── package.json                   # 根目錄，新增 test:e2e scripts
└── tests/
    └── e2e/
        ├── package.json           # @playwright/test 依賴
        ├── playwright.config.js   # baseURL、timeout、globalSetup/Teardown
        ├── helpers/
        │   ├── docker.js          # globalSetup: compose up；globalTeardown: compose down -v
        │   └── auth.js            # register + login + 產生 storageState (localStorage JWT)
        ├── auth.spec.js
        ├── passengers.spec.js
        └── bookings.spec.js
```

---

## 4. 測試環境隔離

### docker-compose.test.yml 關鍵覆蓋

```yaml
services:
  server:
    build: ./server
    ports:
      - "8081:8081"
    environment:
      JWT_SECRET: e2e-test-secret
      MOCK_BOOKING_ENGINE: "true"
      MOCK_BOOKING_RESULT: "success"  # 預設 success；測試可呼叫 POST /test/mock-config 動態切換
    # 不啟 scheduler、alloy、watchtower

  ui:
    build:
      context: ./ui
    ports:
      - "8082:8082"
    environment:
      API_URL: http://localhost:8081
```

**隔離保證：**
- `-p thsrc-test`：獨立 Docker network + volume namespace
- `down -v`：測試結束後清掉整個 DB volume
- 不啟 scheduler：`immediate: false` 訂單永遠停在 `pending`，不會真的送出

### Mock Booking Engine

`server/src/services/bookingEngineService.js` 加入：

```js
async function runBooking(id, log) {
  if (process.env.MOCK_BOOKING_ENGINE === 'true') {
    const result = process.env.MOCK_BOOKING_RESULT || 'success';
    if (result === 'success') {
      await bookingRepo.updateStatus(id, CONFIG.BOOKING_STATUS.SUCCESS, { ticketNo: 'MOCK-12345' });
    } else {
      await bookingRepo.updateStatus(id, CONFIG.BOOKING_STATUS.FAILED, { reason: 'mock failure' });
    }
    return;
  }
  // 原有邏輯...
}
```

### 測試專用 mock-config endpoint

僅在 `MOCK_BOOKING_ENGINE=true` 時掛載，用於動態切換 mock 行為：

```
POST /test/mock-config
Body: { "result": "success" | "failure" }
```

- 掛載於 `src/routes/test.js`，僅當 `process.env.MOCK_BOOKING_ENGINE === 'true'` 時由 `api.js` 載入
- 更新 process 層級的 `global.__mockBookingResult`，`runBooking()` 讀這個值
- 生產環境完全不載入此 router，無安全疑慮

---

## 5. 測試場景清單（14 個）

### auth.spec.js

| # | 場景 | 類型 |
|---|------|------|
| 1 | 註冊新帳號 → 成功登入 → 跳轉首頁 | happy path |
| 2 | 登入錯誤密碼 → UI 顯示錯誤訊息 | 失敗 |
| 3 | Token 過期（mock 401 response）→ 自動跳回 login 頁 | 失敗 |

### passengers.spec.js

| # | 場景 | 類型 |
|---|------|------|
| 4 | 新增旅客（完整欄位）→ 列表出現新旅客 | happy path |
| 5 | 編輯旅客姓名 → 列表更新 | happy path |
| 6 | 刪除旅客 → 列表移除 | happy path |
| 7 | 新增旅客缺必填欄位 → UI 顯示錯誤提示 | 失敗 |

### bookings.spec.js

| # | 場景 | 觸發方式 | 類型 |
|---|------|----------|------|
| 8 | 建立預約單（`immediate: false`）→ 訂單列表顯示 pending | 正常送出 | happy path |
| 9 | 建立立即訂票（`immediate: true`，mock success）→ UI 顯示成功 | `MOCK_BOOKING_RESULT=success` | happy path (mock) |
| 10 | 建立立即訂票（`immediate: true`，mock failure）→ UI 顯示失敗訊息 | `MOCK_BOOKING_RESULT=failure` | 失敗 (mock) |
| 11 | 取消 pending 訂單 → 狀態更新為 cancelled | 正常取消 | happy path |
| 12 | 訂票表單缺必填欄位（如出發站）→ UI 阻擋送出，顯示提示 | 前端 validation | 失敗 |
| 13 | 選擇過去時間預約 → 後端拒絕 400 → UI 顯示錯誤訊息 | `scheduledAt` 傳過去時間 | 失敗 |
| 14 | 取消已在 running 的訂單 → UI 顯示「進行中無法取消」 | mock 訂單狀態為 running | 失敗 |

---

## 6. Playwright 設定

### playwright.config.js

```js
module.exports = {
  testDir: '.',
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:8082',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    headless: true,
  },
  globalSetup: './helpers/docker.js',    // compose up + healthcheck
  globalTeardown: './helpers/docker.js', // compose down -v
};
```

### helpers/docker.js 職責

- `setup()`：執行 `docker-compose -p thsrc-test -f docker-compose.test.yml up -d --build`，輪詢 `GET /healthz` 和 `GET /readyz` 直到 pass（最多等 60 秒）
- `teardown()`：執行 `docker-compose -p thsrc-test -f docker-compose.test.yml down -v`

### helpers/auth.js 職責

- `registerAndLogin()`：打 `POST /v1/auth/register` + `POST /v1/auth/login`，回傳 JWT
- `createStorageState(jwt)`：產生 Playwright `storageState` JSON（寫入 `localStorage.thsrc_jwt`）
- 各 spec 在 `beforeAll` 呼叫，`beforeEach` 帶入 `storageState`

---

## 7. 執行指令

```bash
# 安裝 Playwright（首次）
cd tests/e2e && npm install && npx playwright install chromium

# 跑全部 E2E（自動 compose up → test → compose down）
npm run test:e2e

# Playwright UI（互動式除錯）
npm run test:e2e:ui

# Headed mode（看瀏覽器跑）
npm run test:e2e:headed
```

### 根目錄 package.json scripts

```json
{
  "scripts": {
    "test:e2e": "cd tests/e2e && npx playwright test",
    "test:e2e:ui": "cd tests/e2e && npx playwright test --ui",
    "test:e2e:headed": "cd tests/e2e && npx playwright test --headed"
  }
}
```

---

## 8. 與現有測試的分工

| 層次 | 工具 | 位置 | 負責範圍 |
|------|------|------|----------|
| 後端單元/API | node:test | `server/test/*.test.js` | 400 邊界條件、業務邏輯、DB 操作 |
| 後端外部整合 | node:test | `server/test/thsrc.integration.test.js` | 高鐵網站連線（需 `RUN_NETWORK_TESTS=1`） |
| 前後端 E2E | Playwright | `tests/e2e/*.spec.js` | User journey、跨層失敗、API contract drift |
