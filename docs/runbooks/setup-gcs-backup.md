# GCS DB Backup — 一次性 Infra 建置

> 執行環境:**本機 laptop**,以擁有 `sincere-office-494609-m3` project owner / storage admin 權限的身份登入 gcloud(`gcloud auth login` + `gcloud config set project sincere-office-494609-m3`)。
> 不要 ssh 進 VM 跑這些指令 — VM 的 service account 沒有 bucket 建立或 IAM 設定的權限。

## 設計目標

零月費。透過以下設定確保不超出 Always Free Tier:

- **Bucket location**: `us-west1` single region — 與 GCE VM 同 region,GCS 寫入零 egress;Always Free Tier 5GB-month 涵蓋
- **Storage class**: STANDARD(只此一種落在 free tier)
- **Lifecycle**: 30 天自動刪除,確保總空間 < 5GB(以目前 SQLite ~ 3MB 算,30 份 ≈ 90MB)
- **不啟用** versioning / replication / multi-region — 任一啟用都會脫離 free tier

## 1. 建立 bucket

```bash
gcloud storage buckets create gs://sincere-office-thsrc-db-backup \
  --location=us-west1 \
  --uniform-bucket-level-access \
  --project=sincere-office-494609-m3
```

## 2. 設定 30 天 lifecycle

```bash
cat > /tmp/lifecycle.json <<'EOF'
{
  "rule": [
    {
      "action": {"type": "Delete"},
      "condition": {"age": 30}
    }
  ]
}
EOF

gsutil lifecycle set /tmp/lifecycle.json gs://sincere-office-thsrc-db-backup
```

## 3. 確認設定

```bash
gsutil lifecycle get gs://sincere-office-thsrc-db-backup
gcloud storage buckets describe gs://sincere-office-thsrc-db-backup \
  --format="value(location,storageClass)"
```

預期輸出:`US-WEST1  STANDARD`

## 4. 取得 VM service account

```bash
gcloud compute instances describe instance-20260427-141455 \
  --zone=us-west1-b --project=sincere-office-494609-m3 \
  --format="value(serviceAccounts[0].email)"
```

## 5. 授予 bucket-level objectAdmin(避免 project-wide 權限)

```bash
SA=$(gcloud compute instances describe instance-20260427-141455 \
  --zone=us-west1-b --project=sincere-office-494609-m3 \
  --format="value(serviceAccounts[0].email)")

gsutil iam ch serviceAccount:${SA}:roles/storage.objectAdmin \
  gs://sincere-office-thsrc-db-backup
```

## 6. 在 VM 上驗證認證

```bash
gcloud compute ssh instance-20260427-141455 \
  --zone=us-west1-b --project=sincere-office-494609-m3 \
  --command="echo test | gsutil cp - gs://sincere-office-thsrc-db-backup/test.txt && gsutil rm gs://sincere-office-thsrc-db-backup/test.txt"
```

預期:成功上傳並刪除。

## 7. 拒絕清單(會脫離免費額度)

- ❌ `--enable-versioning` — 已刪物件仍佔空間
- ❌ 跨 region replication / dual-region / multi-region
- ❌ 改 storage class 為 `US`(multi-region)
- ❌ Bucket 上開啟 public access
