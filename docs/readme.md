建立一個代理使用者台灣高鐵訂票的網站

# 系統架構與資料流

## 系統需求

建立一個訂票網站，上輸入訂票資訊，包含出發地、目的地、日期、使用者身份等必要訂票資訊，選擇立即訂票，或是預約指定時間搶票。使用者指定期望搭乘時間、允許搭乘區間，系統嘗試訂購允許搭乘區間內的車次，選擇最接近期望搭乘時間的車次訂購，直到成功訂購到票為止。建立最大訂票嘗試次數，超過次數後停止嘗試。建立歷史訂票紀錄，包含訂票資訊、訂票結果、每次嘗試記錄等，供使用者查詢。

---

# 高鐵訂票完整流程

## 概覽

高鐵網站 `irs.thsrc.com.tw` 使用 **Apache Wicket** 框架 + **Akamai WAF** 防護。
訂票需五個步驟（Init → GetCaptcha → SolveCapcha → S1 查詢班次 → S2→S3→S4 確認訂位），全程共用同一組 cookie jar。

## 流程圖

```
┌─────────────────────────────────────────────────────────────────┐
│  Step 1a：thsrcInit() — 第一次請求（不帶 cookie）               │
│  GET https://irs.thsrc.com.tw/IMINT/   redirect: manual        │
│                                                                 │
│  Request Headers:                                               │
│    User-Agent: Chrome/147                                       │
│    Accept: text/html,...                                        │
│    Accept-Language: zh-TW,zh;q=0.9                             │
│    Connection: keep-alive          ← 缺少此 header 會 timeout  │
│    sec-ch-ua / sec-ch-ua-platform  ← Akamai bot 偵測用         │
│    Sec-Fetch-Dest: document                                     │
│    Sec-Fetch-Mode: navigate                                     │
│    Sec-Fetch-Site: none                                         │
│    Sec-Fetch-User: ?1                                           │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTP 302 Found
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  302 Response（不含 body）                                      │
│                                                                 │
│  Set-Cookie: TS01e7362d=xxx        ← Akamai TLS fingerprint    │
│  Set-Cookie: _abck=xxx             ← Akamai Bot Manager        │
│  Set-Cookie: bm_sz=xxx             ← Akamai Bot Manager        │
│  Set-Cookie: ak_bmsc=xxx           ← Akamai Bot Manager        │
│  Set-Cookie: IRS-SESSION=xxx       ← 高鐵應用層 session        │
│  Set-Cookie: THSRC-IRS=xxx         ← 高鐵應用層                │
│                                                                 │
│  ⚠ redirect:'follow' 會丟棄這些 cookie，必須用 'manual'        │
└──────────────────────────┬──────────────────────────────────────┘
                           │ 收集 cookies1，組成 cookieJar1
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Step 1b：thsrcInit() — 第二次請求（帶入第一次 cookie）         │
│  GET https://irs.thsrc.com.tw/IMINT/   redirect: follow        │
│                                                                 │
│  Cookie: <cookieJar1>              ← 帶入 302 拿到的所有 cookie │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTP 200
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  200 Response                                                   │
│                                                                 │
│  Set-Cookie: JSESSIONID=xxx        ← Wicket session（此次才有）│
│  Set-Cookie: bm_sv / bm_mi        ← Akamai 更新               │
│                                                                 │
│  Body HTML 包含：                                               │
│    action="/IMINT/;jsessionid=xxx?wicket:interface=...          │
│              BookingS1Form::IFormSubmitListener"  → formAction  │
│    src="/IMINT/?wicket:interface=...passCode::                  │
│              IResourceListener&wicket:antiCache=xxx" → captchaUrl│
│    name="bookingMethod" value="radio31"  → bookingMethod        │
└──────────────────────────┬──────────────────────────────────────┘
                           │ 合併 cookies1 + cookies2（後者同名覆蓋前者）
                           │ 解析出完整 cookieJar、formAction、captchaUrl、bookingMethod
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Step 2：thsrcGetCaptcha()                                      │
│  GET https://irs.thsrc.com.tw/IMINT/?wicket:interface=          │
│        ...passCode::IResourceListener&wicket:antiCache=xxx      │
│                                                                 │
│  Request Headers:                                               │
│    Cookie: <完整 cookieJar>        ← 必須帶所有 Akamai cookie  │
│    Referer: https://irs.thsrc.com.tw/IMINT/                    │
│    Sec-Fetch-Dest: image                                        │
│    Sec-Fetch-Mode: no-cors                                      │
│    Sec-Fetch-Site: same-origin                                  │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                    ┌──────┴──────┐
                    │             │
              Content-Type    Content-Type
              image/png       text/html
                    │             │
                    ▼             ▼
             回傳 PNG 圖片    WAF 攔截，回傳錯誤頁面
             轉 base64        拋出 Error（進入 retry）
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────┐
│  Step 3：Captcha Solver API                                     │
│  POST http://35.212.154.47:8080/solve                           │
│  Body: { image: "<base64 PNG>" }                                │
│                                                                 │
│  Response: { answer: "A3K7", confidence: [0.99, 0.99, ...] }   │
│         or { detail: "Invalid image..." }  → 拋出 Error        │
└──────────────────────────┬──────────────────────────────────────┘
                           │ captchaAnswer = "A3K7"
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Step 4：thsrcQueryTrains()                                     │
│  POST https://irs.thsrc.com.tw/IMINT/;jsessionid=xxx?           │
│        wicket:interface=...BookingS1Form::IFormSubmitListener   │
│                                          redirect: manual       │
│                                                                 │
│  Form fields:                                                   │
│    bookingMethod: radio31            ← Wicket 動態生成的 ID     │
│    selectStartStation: 1 (台北)                                 │
│    selectDestinationStation: 12 (左營)                          │
│    toTimeInputField: 2026/04/30                                 │
│    toTimeTable: 900A                 ← 對應 09:00               │
│    ticketPanel:rows:0:ticketAmount: 1F  ← 全票 1 張            │
│    homeCaptcha:securityCode: A3K7                               │
│    SubmitButton: 開始查詢                                        │
│                                                                 │
│  Cookie: <完整 cookieJar>                                       │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTP 302 → 合併新 cookie → GET redirect
                           │ HTTP 200：S2 頁面
                           │
                    ┌──────┴──────┐
                    │             │
              找到班次列表    無班次 / 驗證碼錯誤
              S2 form URL         │
                    │       createBookingAttempt(success:false)
                    │          handleRetry() → 排程 2 分鐘後重試
                    ▼
┌─────────────────────────────────────────────────────────────────┐
│  S2 頁面：班次列表                                              │
│                                                                 │
│  HTML 包含：                                                    │
│    <input QueryDeparture="09:01" QueryArrival="11:00"           │
│           QueryCode="1307"                                      │
│           name="TrainQueryDataViewPanel:TrainGroup"             │
│           value="radio25">         ← Wicket 動態 radio ID      │
│                                                                 │
│  selectBestTrain()：選出最接近 desiredTime 的班次               │
└──────────────────────────┬──────────────────────────────────────┘
                           │ bestTrain.radioValue = "radio25"
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Step 5a：thsrcSubmitBooking() — S2 POST（選車次）              │
│  POST https://irs.thsrc.com.tw/IMINT/...BookingS2Form...        │
│                                          redirect: manual       │
│                                                                 │
│  Form fields:                                                   │
│    TrainQueryDataViewPanel:TrainGroup: radio25  ← Wicket ID    │
│    ticketPanel:rows:0:ticketAmount: 1F                          │
│    toPayment: 確認訂位                                           │
│    homeCaptcha:securityCode: A3K7  ← 同一組驗證碼              │
│                                                                 │
│  Cookie: <完整 cookieJar>                                       │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTP 302 → 合併新 cookie → GET redirect
                           │ HTTP 200：S3 頁面（乘客資料表單）
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Step 5b：thsrcSubmitBooking() — S3 POST（填乘客資料）          │
│  POST https://irs.thsrc.com.tw/IMINT/...BookingS3Form...        │
│                                          redirect: manual       │
│                                                                 │
│  Form fields:                                                   │
│    BookingS3FormSP:hf:0: ""                                     │
│    idInputRadio: 0                 ← 0 = 身份證                 │
│    dummyId: A123456789             ← 身份證號                   │
│    dummyPhone: 0912345678                                       │
│    email: user@example.com                                      │
│    TicketMemberSystemInputPanel:...:memberSystemRadioGroup:     │
│      radio45                       ← 非會員（動態取自 S3 HTML） │
│    agree: on                                                    │
│    SubmitButton: 確定                                            │
│                                                                 │
│  Cookie: <合併後 cookieJar>                                     │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTP 302 → 合併新 cookie → GET redirect
                           │ HTTP 200：S4 頁面（付款確認）
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  S4 頁面：parseBookingResult()                                  │
│                                                                 │
│  HTML 包含：                                                    │
│    <td>訂位代號</td>                                            │
│    <td class="td-data">                                         │
│      <p class="pnr-code"><span>05991354</span></p>              │
│                                                                 │
│  Regex：訂位代號<\/td>[\s\S]{0,300}?<p[^>]*pnr[^>]*>           │
│          [\s\S]{0,50}?<span>\s*(\d{6,10})\s*<\/span>           │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                    ┌──────┴──────┐
                    │             │
              ticketNo: 05991354  error class 出現
                    │             │
                    ▼             ▼
          status = success   createBookingAttempt(success:false)
          createBookingAttempt   handleRetry()
          (success:true)
```

---

## 關鍵限制

| 問題 | 原因 | 現況 |
|------|------|------|
| 第一次請求回 302，`redirect:'follow'` 會丟棄 Akamai cookie | node-fetch 自動跟隨重導向時不保留中間 response 的 Set-Cookie | `thsrcInit()` 改用 `redirect:'manual'` 手動處理兩段式請求 |
| `Connection: keep-alive` 缺少會 timeout | Akamai 在 TLS handshake 前就切斷沒有此 header 的連線 | 已加入 `BROWSER_HEADERS` |
| 只帶 `JSESSIONID` 會被 WAF 攔截 | Akamai Bot Manager 驗證完整 cookie 組合 | `thsrcInit()` 合併兩次 Set-Cookie 回傳完整 `cookieJar` |
| S1/S2/S3 POST 均回 302，需兩段式處理 | Wicket + Akamai 每次 POST 都回 302 帶新 cookie，再 GET 才拿到頁面 | `_postAndFollow()` helper 統一處理 POST→302→GET 並合併 cookie |
| PNR 包在 `<span>` 內 | S4 HTML 格式：`<p class="pnr-code"><span>XXXXXXXX</span></p>` | `parseBookingResult()` regex 加入 `<span>` 匹配 |
---

## 測試結果

| 步驟 | 狀態 |
|------|------|
| thsrcInit() — 兩段式 302→200 | ✅ 成功，完整 cookie jar，正確的 formAction/captchaUrl |
| thsrcGetCaptcha() — 取得 PNG | ✅ 成功，回傳 PNG base64 |
| Captcha Solver API | ✅ 成功，回傳 4 字元答案（confidence ≥ 0.92） |
| thsrcQueryTrains() — S1 POST | ✅ 成功，正確解析班次列表（QueryDeparture/QueryArrival/QueryCode） |
| thsrcSubmitBooking() — S2→S3→S4 | ✅ 成功，取得訂位代號（已驗證：05991354、06000727、06000820） |

---

## 訂票狀態機（Booking State Machine）

```
                        ┌─────────────────────────────────────────┐
                        │              建立訂票                    │
                        │         bookingRepo.create()            │
                        └──────────────────┬──────────────────────┘
                                           │
                                           ▼
                                      ┌─────────┐
                                      │ pending │  等待排程器觸發
                                      └────┬────┘
                                           │
                   ┌───────────────────────┼──────────────────────┐
                   │                       │                      │
                   │ 使用者取消             │ 排程器觸發            │
                   │ POST /cancel          │ tryClaimBooking()     │
                   ▼                       ▼                      │
             ┌───────────┐           ┌─────────┐                  │
             │ cancelled │           │ running │  搶票執行中       │
             └───────────┘           └────┬────┘                  │
             createAttempt                │                       │
             (使用者取消)          ┌───────┴────────┐              │
                                   │                │              │
                              訂票成功          訂票失敗            │
                                   │           handleRetry()       │
                                   ▼                │              │
                              ┌─────────┐           │              │
                              │ success │           │              │
                              └────┬────┘    retry < maxRetries    │
                                   │                │              │
                             ┌─────┴─────┐         │ 重設 pending  │
                             │  退票流程  │         └──────────────►┘
                             └─────┬─────┘
                             POST /refund    retry >= maxRetries
                                   │                │
                                   ▼                ▼
                             ┌──────────┐     ┌────────┐
                             │ refunding│     │ failed │  已達最大重試次數
                             └─────┬────┘     └────────┘
                                   │
                    ┌──────────────┼─────────────────┐
                    │              │                  │
                 退票成功       退票失敗         卡住逾時(>10min)
                    │          POST /refund           │
                    ▼          可重試                 │
              ┌──────────┐         │        scheduler 重設 refunding
              │ refunded │         ▼
              └──────────┘  ┌──────────────┐
                            │ refund_failed│  可再次點退票重試
                            └──────────────┘
```

### 允許的狀態轉換摘要

| 從 | 到 | 觸發者 |
|----|----|--------|
| pending | running | scheduler `tryClaimBooking()` |
| pending | cancelled | 使用者 POST `/cancel` |
| running | success | `_doBooking()` 成功 |
| running | pending | `handleRetry()` 重試（scheduledAt = now + 2min）；或 scheduler 重設卡住 running（>10min） |
| running | failed | `handleRetry()` 達最大重試次數 |
| success | refunding | 使用者 POST `/refund` |
| refunding | refunded | `runRefund()` 成功 |
| refunding | refund_failed | `runRefund()` 失敗 |
| refunding | refunding | scheduler 重設卡住的 refunding（>10min） |
| refund_failed | refunding | 使用者再次 POST `/refund` |

### 可執行操作對應狀態

| 狀態 | 取消 | 退票 | 刪除 |
|------|------|------|------|
| pending | ✅ | — | — |
| running | — | — | — |
| success | — | ✅ | ✅ |
| failed | — | — | ✅ |
| cancelled | — | — | ✅ |
| refunding | — | — | — |
| refunded | — | — | ✅ |
| refund_failed | — | ✅ (重試) | ✅ |
