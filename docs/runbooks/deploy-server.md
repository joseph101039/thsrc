# Deploy server image

## 前置條件

1. **Working tree clean** — `git status` 無未提交變更(deploy script 會強制檢查)
2. **在 main 分支** — `git rev-parse --abbrev-ref HEAD` 顯示 `main`(deploy script 會強制檢查)
3. **已 pull 最新 main** — `git pull origin main`
4. **Docker 登入過 Docker Hub** — `docker login`(或 `~/.docker/config.json` 已有 token)
5. **能 push git tag** — `git push origin <tag>` 不要被遠端拒絕

## SemVer Bump 規則

| Bump | 何時用 | 範例 |
|---|---|---|
| `patch` (預設) | Bug fix、docs、refactor、效能優化、觀測性增強 | 修登入錯誤、補 log、重構 controller |
| `minor` | 新功能(向後相容) | 新 endpoint、新 admin 頁面、新 background job |
| `major` | Breaking change(不向後相容) | API 異動、env var 改名、DB schema migration 不向後相容 |

範例:`v1.0.5` patch → `v1.0.6`;`v1.0.5` minor → `v1.1.0`;`v1.0.5` major → `v2.0.0`。
若沒有任何 git tag,首次 patch deploy 會產生 `v0.0.1`(從 `v0.0.0` 起算)。

## Dry-run

部署前想看 NEXT 會是什麼,可以加 `DRY_RUN=1`:

```bash
DRY_RUN=1 bash server/deploy-server.sh minor
# [dry-run] 從 v1.0.0 bump minor → v1.1.0
# [dry-run] would push joseph50804/thsrc-server:v1.1.0 + :latest
# [dry-run] would push git tag v1.1.0
```

不會 build 也不會 push。

## 部署

```bash
# patch bump (預設)
DOCKERHUB_USER=joseph50804 bash server/deploy-server.sh

# minor bump
DOCKERHUB_USER=joseph50804 bash server/deploy-server.sh minor

# major bump
DOCKERHUB_USER=joseph50804 bash server/deploy-server.sh major
```

Script 會:

1. 讀 `git tag -l 'v*'` 取最新 SemVer
2. 依 bump 類型計算下一個版本(例:`v1.0.5` patch → `v1.0.6`)
3. `docker buildx build --platform linux/amd64 -t :NEXT -t :latest --push`
4. `git tag -a NEXT -m "deploy: <commit subject>"` 並 `git push origin NEXT`

## 部署後

### 1. 等 watchtower(5 分鐘內)或立即生效

```bash
# 立即生效(可選,等不了 watchtower 時用)
gcloud compute ssh instance-20260427-141455 \
  --zone=us-west1-b --project=sincere-office-494609-m3 \
  --command="cd ~ && docker compose pull server scheduler && docker compose up -d server scheduler"
```

> 注意:server 與 scheduler 共用同一 image,要一起 pull/up。

### 2. 驗證健康

```bash
curl https://api.joseph101039.uk/healthz
curl https://api.joseph101039.uk/readyz
```

兩者皆 200 即代表新版啟動正常。

### 3. 看啟動 log

```bash
gcloud compute ssh instance-20260427-141455 \
  --zone=us-west1-b --project=sincere-office-494609-m3 \
  --command="docker logs --tail=50 joseph-server-1"
```

## Rollback

部署後發現壞掉時,參考 `docs/runbooks/rollback-server.md`。

## 異常情境處理

**git tag 推成功了,但 docker buildx 失敗:**

git tag 已在 origin 但 Docker Hub 沒有對應 image。下一次 watchtower 拉 latest 仍是舊版,不會壞;但 git tag 是 orphan。可選擇刪除:

```bash
git tag -d <orphan-tag>
git push origin :refs/tags/<orphan-tag>
```

或保留作為「曾嘗試部署」紀錄,下次再 deploy 會自動 bump 到下一個 PATCH。

## Captcha image

Captcha image 走另一條 deploy 路線,SemVer 暫不適用:

```bash
DOCKERHUB_USER=joseph50804 ./captcha/apiserver/deploy-gce.sh
```

未來若要把 captcha 也納入 SemVer,需另外改 captcha 的 deploy script。
