# Setup LINE Messaging API for alerts

> 給未來重建 / 換 channel 用。本專案 alert 推送改走 LINE **Messaging API**(LINE Notify
> 已在 2025 終止服務,不可用)。整個流程約 10 分鐘,完成後拿到兩個值:
>
> - `LINE_CHANNEL_ACCESS_TOKEN`(channel-level,長字串)
> - `LINE_USER_ID`(你自己的 LINE user ID,`U` 開頭 33 字元)
>
> 兩個值寫進 `.env`,server 端的 `services/lineNotifier.js` 會用它們對 LINE API push。

---

## 1. 建立 LINE Developers Provider 與 Channel

1. 進 https://developers.line.biz/console/ 用 LINE 帳號登入
2. **Provider** 沒有就建一個(免費,任意名稱,例如 `personal`)
3. Provider 內 **Create a new channel** → 選 **Messaging API**
4. 填:
   - **Channel name**:`thsrc-alerts`(或任意)
   - **Channel description**:THSRC backend alert
   - **Category / Subcategory**:任選
   - 同意條款 → Create

---

## 2. 拿 Channel Access Token

1. 進剛建的 channel → **Messaging API** 分頁
2. 拉到 **Channel access token**(注意不是「Channel secret」,那是 webhook 簽章用的)
3. 點 **Issue**(Long-lived)→ 複製產生的 token(只會顯示一次,**立刻存好**)

> 這個 token 等同密碼,可以代表 channel 推訊息給任何 friend / group。Compromise 時去同
> 一頁面點 **Reissue** 立刻撤銷。

---

## 3. 拿你自己的 LINE User ID

LINE 不會在 UI 直接顯示 User ID,要透過 API 才能拿到。最簡單:

### 方法 A:從 channel basic info(若你只想推給自己且自己是 channel owner)

1. 進 channel → **Basic settings**
2. 拉到 **Your user ID**(這是「以開發者身份」的 user ID,可作為 push target)
3. 複製 `U` 開頭的 33 字元字串

### 方法 B:用 webhook 撈(若 A 找不到 / 想推給其他 LINE 帳號)

1. Channel → **Messaging API** 分頁 → **Webhook URL** 設 `https://webhook.site/<你的隨機路徑>`(免費 webhook 接收服務)
2. 開啟 **Use webhook**
3. 用 LINE App 加這個 channel 的官方帳號為好友(QR code 在 Messaging API 分頁)
4. 在 LINE App 對 channel 發任意訊息
5. 回 webhook.site 看收到的 payload,`events[0].source.userId` 就是你要的 User ID

---

## 4. 寫進 `.env`

> ⚠️ 動手前驗證 `.env` 已 git-ignored:
> ```bash
> grep -q '^\.env$' .gitignore && echo OK
> ```

加進 `/Users/joseph/projects/nodejs/thsrc/.env`:

```bash
LINE_CHANNEL_ACCESS_TOKEN=<step 2 拿到的 token>
LINE_USER_ID=<step 3 拿到的 U… ID>
ALERT_WEBHOOK_TOKEN=<openssl rand -hex 32 自己產>
```

`ALERT_WEBHOOK_TOKEN` 用來保護 server 的 `/alerts/grafana` webhook 端點,等下要貼到
Grafana Cloud Alerting 的 contact point header。

---

## 5. 本地測試 LINE push

```bash
cd server
LINE_CHANNEL_ACCESS_TOKEN=xxx LINE_USER_ID=Uxxx node --experimental-sqlite -e '
const { pushText } = require("./src/services/lineNotifier");
pushText("[test] alert from local").then(r => console.log(r));
'
```

收到「`[test] alert from local`」LINE 訊息表示成功。

---

## 6. 部署到 GCE VM

依 setup-grafana-cloud.md 第 4 節同樣做法,把 3 個新 env 用 `scp` 推到 VM(不要用
`gcloud --command='cat >> ~/.env <<EOF'`,secret 會留在 audit log)。

部署完後:

```bash
gcloud compute ssh instance-20260427-141455 \
  --zone=us-west1-b --project=sincere-office-494609-m3 \
  --command='cd ~ && docker compose up -d server'
```

> ⚠️ **重要**:`docker compose restart server` **不會重新讀** `env_file`(只重啟 process)。
> 換 token 必須 `docker compose up -d server`(會 recreate container 重新 inject env)。

> ⚠️ **Docker socket 信任邊界**:能 `docker exec` 進 server container 的 user(VM 上需
> docker group / sudo)可執行 `env | grep LINE` 撈出 `LINE_CHANNEL_ACCESS_TOKEN` 與
> `ALERT_WEBHOOK_TOKEN`。本 VM 只有你 SSH 可達,風險可控。若未來開放他人 SSH 進 VM
> 操作 docker,務必先 rotate 兩個 token。

---

## 7. 在 Grafana Cloud Alerting 上設 contact point

1. 進 https://joseph101039.grafana.net/alerting/notifications
2. **Contact points** → **+ Add contact point**
3. 設定:
   - **Name**:`thsrc-line`
   - **Integration**:**Webhook**
   - **URL**:`https://api.joseph101039.uk/alerts/grafana`
   - **HTTP method**:POST
   - 展開 **Optional Webhook settings**:
     - **Authorization header — Scheme**:`Bearer`
     - **Authorization header — Credentials**:貼上 `ALERT_WEBHOOK_TOKEN` 的值
4. **Test**(右上角)→ LINE 應收到測試訊息
5. **Save contact point**

---

## 8. 異常處理

**`401 Unauthorized` from LINE push API**
- Token 過期或被 reissue。回 step 2 重產 token,更新 `.env` + 重啟 server

**LINE 收不到 / `400 The user hasn't added the LINE Official Account as a friend`**
- 你必須先加這個 channel 的 LINE Official Account 為好友(QR code 在 Messaging API 分頁)
- Messaging API push 不能對「未加好友」的 user 發送

**Free tier 額度**
- LINE Messaging API:每月 200 通免費,夠 1-2 條 alert 規則使用
- 超過會 429 直接拒絕(不會扣費)。本專案以 `pushText` 為粒度 + 30 分鐘 dedup,正常情況遠低於 200/月

---

## Token 輪替

可疑洩漏 → step 2 點 **Reissue** → 更新 `.env` + 重啟 server + alloy 不需動。
舊 token 立刻失效。
