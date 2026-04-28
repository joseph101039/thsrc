---
name: deploy
description: Deploy Node.js server and/or UI frontend. Use when the user wants to push code changes to production.
disable-model-invocation: true
---

## Deploy Node.js Server

```bash
DOCKERHUB_USER=joseph50804 bash server/deploy-server.sh
```

`deploy-server.sh` will:
1. Build `linux/amd64` image via `docker buildx` and push to `joseph50804/thsrc-server:latest`
2. VM cron job auto-pulls every 5 minutes — no SSH required

Verify:
```bash
curl http://35.212.154.47:8081/
```

## Deploy UI Frontend

```bash
# Commit any ui/ changes to main first, then:
git push origin main:gh-pages
```

The site will be live at https://joseph101039.github.io/thsrc/ui/ within ~1 minute.

## After Deploying

If `GAS_URL` in `ui/js/api.js` changed (i.e. server IP/port changed), redeploy the UI frontend as well.