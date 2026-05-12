# VM 記憶體使用率告警 (vm-memory-high)

GCE e2-micro VM 上限 1GB,記憶體吃滿會直接 OOM kill scheduler / server。
此規則在 VM 真實記憶體壓力持續 10 分鐘高於 85% 時透過 LINE 告警。

## Grafana Cloud Alert Rule 設定

到 Grafana Cloud → Alerting → Alert rules → New rule,依下列參數建立:

| 欄位 | 值 |
|---|---|
| Name | `vm-memory-high` |
| Folder | `thsrc` (或既有資料夾) |
| Group | `vm-health` |
| Rule type | Grafana managed alert |
| Query A | `(node_memory_MemTotal_bytes{job="host"} - node_memory_MemAvailable_bytes{job="host"}) / node_memory_MemTotal_bytes{job="host"}` |
| Reduce B | `last()` of A |
| Threshold C | `IS ABOVE 0.85` of B |
| Pending period | `10m` |
| Evaluation interval | `1m` |
| No data | OK |
| Error | Error |

### Labels
- `severity = warning`
- `service = vm-host`

### Annotations
- `summary`: `VM 記憶體使用率持續 10 分鐘高於 85%`
- `description`: `Current usage: {{ $values.B }}` (Grafana 會把 reduce 結果代入)

### 記憶體公式說明

`(MemTotal - MemAvailable) / MemTotal` 計算的是「真實壓力」,
`MemAvailable` 是 kernel 已扣除可回收 cache 後的可用值;不用 `MemFree`
是因為 free 不含 cache 會被 disk cache 誤觸發。與 dashboard panel-9
公式一致,使用者看到的數值與告警判定基準相同。

## Notification Policy (重複間隔 1 小時)

到 Grafana Cloud → Alerting → Notification policies,為對應 contact point
(LINE webhook → `/alerts/grafana`)的 policy 設:

| 欄位 | 值 |
|---|---|
| Group by | `alertname, severity` |
| Group wait | `30s` |
| Group interval | `5m` |
| **Repeat interval** | **`1h`** |

`Repeat interval = 1h` 是條件 #4 (一次後 1 小時不再重發) 的關鍵 —
Grafana 端就 throttle 住,server 的 30 分鐘 dedup 不會被觸發。

## 前端開關

`/v1/alerts/rules` 端點已存在並會自動列出此規則 (沿用既有 alert rule pause/unpause)。
建立規則後,後台 settings 頁的「告警規則」區塊會自動出現 `vm-memory-high`,
管理員可用既有 toggle 暫停/恢復,無前端 code 變更。

## 驗證

```bash
# 1. 模擬高記憶體 — 在 VM 上跑 stress-ng
gcloud compute ssh instance-20260427-141455 --zone=us-west1-b --project=sincere-office-494609-m3 \
  --command="sudo apt-get install -y stress-ng && stress-ng --vm 1 --vm-bytes 900M --timeout 12m"

# 2. 等 11 分鐘 (10m pending + 1m eval),觀察 LINE 是否收到 firing
# 3. Ctrl-C 停止 stress-ng,等 5 分鐘觀察是否收到 resolved
```

## 復原

到 Grafana Cloud → Alerting 刪除 `vm-memory-high` rule;`/v1/alerts/rules`
列表會自動移除該項。
