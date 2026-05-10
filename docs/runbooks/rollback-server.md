# Rollback server image

> 適用情境:剛部署的版本壞了,要快速回到上一版。
> Captcha image 走 `captcha/apiserver/deploy-gce.sh` 另一條路線,本 runbook 不涵蓋。

## 何時 rollback?

- `/healthz` 持續 200,但 `/readyz` 持續 503
- API 路徑回 5xx 急速上升
- VM 上 `docker logs joseph-server-1` 出現新錯誤洪水
- Booking 開始大量失敗

決定 rollback 前先看 server log 5 分鐘確認不是暫時錯誤。

## 1. 找出要回到的版本

最近 10 個版本:

```bash
git tag -l 'v*' --sort=-v:refname | head -10
```

每個 tag 的 commit 訊息看作為回滾參考:

```bash
git tag -l 'v*' --sort=-v:refname --format='%(refname:short)  %(subject)' | head -10
```

通常選**前一個 tag**(目前是壞的 tag 的下一格)。

## 2. 把目標 tag 重新標成 latest 推回 Docker Hub

```bash
TARGET="v1.0.5"   # 改成你要回到的版本

docker pull joseph50804/thsrc-server:${TARGET}
docker tag joseph50804/thsrc-server:${TARGET} joseph50804/thsrc-server:latest
docker push joseph50804/thsrc-server:latest
```

## 3. 立即在 VM 生效(不等 watchtower 5 分鐘)

```bash
gcloud compute ssh instance-20260427-141455 \
  --zone=us-west1-b --project=sincere-office-494609-m3 \
  --command="cd ~ && docker compose pull server && docker compose up -d server scheduler"
```

`scheduler` 與 `server` 共用同一 image,要一起重起。

## 4. 驗證

```bash
curl https://api.joseph101039.uk/healthz
# {"status":"ok"}

curl https://api.joseph101039.uk/readyz
# {"db":"ok","scheduler":"ok"}
```

兩個都回 200 即代表 rollback 成功。

## 5. 後續

- 把壞掉的版本(例如 `v1.0.6`)從 Docker Hub UI 刪除,避免 watchtower 之後又拉到。Git tag 通常保留作為紀錄(commit 還在)。
- **Git tag 不要刪**:即使 `v1.0.6` 是壞的,deploy script 從現有 tag 算下一個 SemVer。下次部署會 bump 到 `v1.0.7`(跳過 `v1.0.6`),這是預期行為,版本號不重用。
- 在後續修好的 commit 上重新 deploy → 會 bump 成下一個 PATCH(例如 `v1.0.7`)。
- Post-mortem:在 commit 訊息或 PR 中說明為何 rollback 與後續修復計畫。

## 常見坑

- **docker tag 推回後,VM 不立即更新** — watchtower 預設每 5 min 檢查一次。要立即生效執行 step 3。
- **scheduler 用同一 image 但 docker compose pull 沒帶到** — 必須 `up -d server scheduler` 兩個一起,否則 scheduler 還在跑壞版本。
- **git tag 不該刪除** — 即使該版本壞了。tag 是 immutable 紀錄,刪了會讓事後追蹤困難。
