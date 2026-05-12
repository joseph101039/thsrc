# 遷移 boot disk 從 pd-balanced 10GB 到 pd-standard 30GB

## 目的

GCE free tier 每月送 30 GB-月 **pd-standard**(HDD) 容量,但 pd-balanced(SSD) 不在
免費額度內。把 boot disk 從 pd-balanced 10 GB 換成 pd-standard 30 GB:

- **磁碟空間** 10 GB → 30 GB(目前 6.8 GB used,大量緩衝)
- **每月成本** ~$1 → **$0**(完全 free tier)
- **代價** IOPS 從 3000 降到 200,docker pull / image build 會變慢
  (對 thsrc workload 影響極小,SQLite WAL 幾乎全在記憶體)

## 前置確認

✅ Cloudflare tunnel 走 outbound (使用者域名 `api.joseph101039.uk` 不靠 IP)
✅ GCS backup 走 service account
✅ SSH 走 `gcloud compute ssh <name>` IAP(不靠 IP)
⚠️ Ephemeral NAT IP `35.212.154.47` **會變**(僅影響直連 IP 的用法,無對外服務)

## 影響

- **停機 ~15 分鐘**(snapshot 已建好的話 ~10 分鐘)
- 期間 scheduler 不跑,api 無回應
- 建議在使用者離峰時段執行(凌晨 03:00 台北最少 booking)
- 對外 `https://api.joseph101039.uk` cloudflare 端會回 502/521,直到 VM 起來

## 步驟

### 0. 變數設定

```bash
export PROJECT=sincere-office-494609-m3
export ZONE=us-west1-b
export VM=instance-20260427-141455
export DISK_OLD=instance-20260427-141455
export DISK_NEW=instance-20260427-141455-std30
export SNAPSHOT=migrate-to-std-$(date +%Y%m%d-%H%M)
```

### 1. 建 snapshot 當保險(VM 仍 running,可線上做)

```bash
gcloud compute disks snapshot $DISK_OLD \
  --snapshot-names=$SNAPSHOT \
  --zone=$ZONE \
  --project=$PROJECT \
  --description="Pre-migration to pd-standard $(date -Iseconds)"

# 等 status=READY
gcloud compute snapshots describe $SNAPSHOT --project=$PROJECT \
  --format='value(status,diskSizeGb)'
```

預期:`READY  10`。**沒看到 READY 不要往下走**。

### 2. 停 VM

```bash
gcloud compute instances stop $VM --zone=$ZONE --project=$PROJECT
```

⚠️ **此刻起服務中斷**。可用 cloudflare dashboard 看 tunnel 變 offline 確認。

### 3. 從 snapshot 建新 pd-standard 30 GB disk

```bash
gcloud compute disks create $DISK_NEW \
  --source-snapshot=$SNAPSHOT \
  --size=30 \
  --type=pd-standard \
  --zone=$ZONE \
  --project=$PROJECT
```

等 status=READY:
```bash
gcloud compute disks describe $DISK_NEW --zone=$ZONE --project=$PROJECT \
  --format='value(status,sizeGb,type.basename())'
```

預期:`READY  30  pd-standard`。

### 4. detach 舊 boot disk

```bash
gcloud compute instances detach-disk $VM \
  --disk=$DISK_OLD \
  --zone=$ZONE \
  --project=$PROJECT
```

### 5. attach 新 disk 為 boot

```bash
gcloud compute instances attach-disk $VM \
  --disk=$DISK_NEW \
  --boot \
  --device-name=persistent-disk-0 \
  --zone=$ZONE \
  --project=$PROJECT
```

### 6. 啟動 VM

```bash
gcloud compute instances start $VM --zone=$ZONE --project=$PROJECT

# 等 STATUS=RUNNING
gcloud compute instances describe $VM --zone=$ZONE --project=$PROJECT \
  --format='value(status,networkInterfaces[0].accessConfigs[0].natIP)'
```

📝 記下新的 NAT IP(會跟舊的 `35.212.154.47` 不同)。

### 7. 線上擴大 ext4 filesystem(snapshot 來源 disk 是 10 GB,需 grow 到 30 GB)

```bash
gcloud compute ssh $VM --zone=$ZONE --project=$PROJECT --command='
# 看 root partition
lsblk
echo "---"
# resize partition 到磁碟尾端
sudo growpart /dev/sda 1
# resize ext4
sudo resize2fs /dev/sda1
echo "---"
df -h /'
```

預期 `/` 顯示 ~30 GB total。

### 8. 驗證所有服務

```bash
gcloud compute ssh $VM --zone=$ZONE --project=$PROJECT --command='
echo "=== docker 容器 ==="
docker ps --format "table {{.Names}}\t{{.Status}}"
echo "=== 服務健康 ==="
curl -s http://localhost:8081/healthz | head -c 200; echo
echo "=== swap ==="
swapon --show
echo "=== cloudflared ==="
systemctl is-active cloudflared-thsrc'

# 對外驗證(透過 Cloudflare tunnel)
curl -sI https://api.joseph101039.uk/healthz | head -3
```

預期:
- 5 個 container 都 Up
- `/healthz` 回 200
- swap 1 GB 仍掛載(寫在 /etc/fstab,reboot 後仍生效)
- cloudflared active
- 對外 URL 200

### 9. 更新 CLAUDE.local.md 記錄新 IP(若有用到直連)

```bash
# IP 改變只影響 ssh 直連 / docs 範例,服務不影響
```

### 10. 觀察 24 小時後刪舊 disk(才真正省錢)

```bash
# 觀察期內若新 disk 有問題,見 Rollback 區
# 確認穩定後刪除舊 disk:
gcloud compute disks delete $DISK_OLD --zone=$ZONE --project=$PROJECT
# 也可保留 snapshot 1 個月當保險(snapshot storage free 5GB/月,10GB pd snapshot 約 ~3GB 實際大小)
```

## Rollback

如新 disk 啟動失敗或服務異常:

```bash
# 1. 停 VM
gcloud compute instances stop $VM --zone=$ZONE --project=$PROJECT

# 2. detach 壞的新 disk
gcloud compute instances detach-disk $VM --disk=$DISK_NEW --zone=$ZONE --project=$PROJECT

# 3. attach 舊 disk(尚未刪除)
gcloud compute instances attach-disk $VM --disk=$DISK_OLD --boot \
  --device-name=persistent-disk-0 --zone=$ZONE --project=$PROJECT

# 4. 啟動
gcloud compute instances start $VM --zone=$ZONE --project=$PROJECT

# 5. 刪掉壞的新 disk
gcloud compute disks delete $DISK_NEW --zone=$ZONE --project=$PROJECT
```

如果連舊 disk 都壞了,從 snapshot 重建:

```bash
gcloud compute disks create $DISK_OLD-restored \
  --source-snapshot=$SNAPSHOT \
  --size=10 \
  --type=pd-balanced \
  --zone=$ZONE --project=$PROJECT
# 然後 attach 為 boot
```

## 預期成果

| 指標 | Before | After |
|---|---|---|
| Disk type | pd-balanced | pd-standard |
| Disk size | 10 GB | 30 GB |
| Used % | 80% | ~23% |
| IOPS read/write | 3000 | 200 |
| 每月 disk 成本 | ~$1 | $0 (free tier) |
| NAT IP | `35.212.154.47` | 會變(不影響 api.joseph101039.uk) |
