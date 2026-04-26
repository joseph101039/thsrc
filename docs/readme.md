建立一個代理使用者定票台灣高鐵訂的網站

# 高鐵訂票網址

- https://irs.thsrc.com.tw/IMINT/

# 建立環境

1. Google App Script: thsrc 專案
   https://script.google.com/home/projects/1_vh44nd0AjNMYm3czo-XXUM6rB_BF42sWsLY95TMmuc1asw_terZmpL8/edit
   - Apps Script 專案的專屬 ID: 1_vh44nd0AjNMYm3czo-XXUM6rB_BF42sWsLY95TMmuc1asw_terZmpL8
   - Web App URL: https://script.google.com/macros/s/AKfycbxt0Sp-zQrRCstkcENkrfbRLILgITtTyYtl4izs0nepX7U577K8FAQvHiShfZQ4KV6Obw/exec
   - Deployment ID: AKfycbxt0Sp-zQrRCstkcENkrfbRLILgITtTyYtl4izs0nepX7U577K8FAQvHiShfZQ4KV6Obw
2. 讓專案使用 App Script 連結的 Google Sheet 文件，作為資料庫
   - 檔名: thsrc
   - Sheet ID: 1oFh2T6MzB7KMokpsBBTThdyLzxbAhT0Xlo4exFXyEuA


# 系統需求

建立一個 blade 訂票網站，上輸入訂票資訊，包含出發地、目的地、日期、使用者身份等必要訂票資訊，選擇立即訂票，或是預約指定時間訂搶票。
使用者指定期望搭乘時間，允許搭乘區間，系統嘗試訂購允許搭乘區間內的車次，選擇最接近期望搭乘時間的車次訂購，直到成功訂購到票為止。

應建立最大訂票嘗試次數，超過次數後停止嘗試，並通知使用者訂票失敗。

建立歷史訂票紀錄，包含訂票資訊、訂票結果、訂票嘗試次數等資訊，供使用者查詢。成功後再次到訂票網站確認訂票資訊，並發送 email 通知使用者訂票成功，包含訂票資訊、訂票結果、訂票嘗試次數等資訊。





