建立一個代理使用者定票台灣高鐵訂的網站

# 連線高鐵網站取得驗證碼流程

## 概覽

高鐵網站 `irs.thsrc.com.tw` 使用 **Apache Wicket** 框架 + **Akamai WAF** 防護。
訂票需三次 HTTP 請求（Init → S1 查詢班次 → S2 確認訂位），全程共用同一組 cookie jar。

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
└──────────────────────────┬──────────────────────────────────────┘
                           │ 合併 cookies1 + cookies2（後者同名覆蓋前者）
                           │ 解析出完整 cookieJar、formAction、captchaUrl
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
│  POST http://35.212.154.47:8080/solve                          │
│  Body: { image: "<base64 PNG>" }                                │
│                                                                 │
│  Response: { answer: "A3K7" }  ← 4 字元英數字                  │
│         or { detail: "Invalid image..." }  → 拋出 Error        │
└──────────────────────────┬──────────────────────────────────────┘
                           │ captchaAnswer = "A3K7"
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Step 4：thsrcQueryTrains()                                     │
│  POST https://irs.thsrc.com.tw/IMINT/;jsessionid=xxx?           │
│        wicket:interface=...BookingS1Form::IFormSubmitListener   │
│                                                                 │
│  Form fields:                                                   │
│    selectStartStation: 1 (台北)                                 │
│    selectDestinationStation: 12 (左營)                          │
│    toTimeInputField: 2026/04/30                                 │
│    toTimeTable: 900A  (對應 09:00)                              │
│    homeCaptcha:securityCode: A3K7                               │
│    SubmitButton: 開始查詢                                        │
│                                                                 │
│  Cookie: <完整 cookieJar>                                       │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                    ┌──────┴──────┐
                    │             │
              找到班次列表    無班次 / 驗證碼錯誤
              S2 form URL         │
                    │          handleRetry()
                    ▼          排程 2 分鐘後重試
┌─────────────────────────────────────────────────────────────────┐
│  Step 5：thsrcSubmitBooking()                                   │
│  POST https://irs.thsrc.com.tw/IMINT/...BookingS2Form...        │
│                                                                 │
│  Form fields:                                                   │
│    TrainQueryDataViewPanel:TrainGroup: <trainNo>                │
│    toPayment: 確認訂位                                           │
│    homeCaptcha:securityCode: A3K7  ← 同一組驗證碼              │
│                                                                 │
│  Cookie: <完整 cookieJar>                                       │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                    ┌──────┴──────┐
                    │             │
              訂位代號：XXXX    error class 出現
              → status=success  → handleRetry()
              → 寄 email 通知
```

## 關鍵限制

| 問題 | 原因 | 現況 |
|------|------|------|
| 第一次請求回 302，`redirect:'follow'` 會丟棄 Akamai cookie | node-fetch 自動跟隨重導向時不保留中間 response 的 Set-Cookie | `thsrcInit()` 改用 `redirect:'manual'` 手動處理兩段式請求 |
| `Connection: keep-alive` 缺少會 timeout | Akamai 在 TLS handshake 前就切斷沒有此 header 的連線 | 已加入 `BROWSER_HEADERS` |
| 只帶 `JSESSIONID` 會被 WAF 攔截 | Akamai Bot Manager 驗證完整 cookie 組合 | `thsrcInit()` 合併兩次 Set-Cookie 回傳完整 `cookieJar` |
| GCE VM us-west1 IP 被封鎖 | Akamai 封鎖非台灣 IP（IP 層級，headers 無效） | scheduler 必須在台灣 IP 機器上執行 |
| node-fetch TLS fingerprint 可能被識別 | Akamai 可辨識非瀏覽器的 TLS ClientHello | 本機 Mac 直跑 scheduler 可繞過 |

目前的測試結論：

測試結果整理如下：

```
┌──────────────────────────────┬────────────────────────────────────────────────────────┐                                                     
│             步驟             │                          狀態                          │
├──────────────────────────────┼────────────────────────────────────────────────────────┤
│ thsrcInit() — 兩段式 302→200 │ ✅ 成功，完整 cookie jar，正確的 formAction/captchaUrl │
├──────────────────────────────┼────────────────────────────────────────────────────────┤
│ thsrcGetCaptcha() — 取得 PNG │ ✅ 成功，回傳 PNG base64                               │                                                      
├──────────────────────────────┼────────────────────────────────────────────────────────┤                                                     
│ Captcha Solver API           │ ✅ 成功，回傳 4 字元答案                               │                                                      
├──────────────────────────────┼────────────────────────────────────────────────────────┤                                                     
│ thsrcQueryTrains() POST      │ ❌ 302 → 回首頁，S2 form 找不到                        │
├──────────────────────────────┼────────────────────────────────────────────────────────┤                                                     
│ curl 同樣 session 做 POST    │ ❌ 同樣失敗 → 確認非 node-fetch TLS 問題               │
└──────────────────────────────┴────────────────────────────────────────────────────────┘
```

根本原因尚未確認，但縮小到：高鐵 Wicket session 對 S1 form POST 的驗證失敗。可能是：
1. Akamai 在 POST 時發現 TLS fingerprint 不像真實 Chrome 而 block
2. 新 session 需要更多的 Akamai challenge-response 才能做 POST

目前 thsrcInit()、thsrcGetCaptcha()、cookie jar 完整性的修改都是正確且必要的，QueryTrains 的問題需要進一步分析 Akamai 的行為才能解決。

# 系統需求

建立一個  訂票網站，上輸入訂票資訊，包含出發地、目的地、日期、使用者身份等必要訂票資訊，選擇立即訂票，或是預約指定時間訂搶票。
使用者指定期望搭乘時間，允許搭乘區間，系統嘗試訂購允許搭乘區間內的車次，選擇最接近期望搭乘時間的車次訂購，直到成功訂購到票為止。

應建立最大訂票嘗試次數，超過次數後停止嘗試，並通知使用者訂票失敗。

建立歷史訂票紀錄，包含訂票資訊、訂票結果、訂票嘗試次數等資訊，供使用者查詢。成功後再次到訂票網站確認訂票資訊，並發送 email 通知使用者訂票成功，包含訂票資訊、訂票結果、訂票嘗試次數等資訊。





