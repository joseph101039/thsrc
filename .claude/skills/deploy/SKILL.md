---
name: deploy
description: Deploy GAS backend and/or UI frontend. Use when the user wants to push code changes to production.
disable-model-invocation: true
---

## Deploy GAS Backend

1. Push code to GAS:
   ```bash
   cd gas && clasp push --force
   ```

2. If only updating existing deployment (no URL change needed):
   ```bash
   clasp deploy --deploymentId "AKfycbx1uVUZpBU2OgkUUph625275GDvMgHmA724RLUpyFt-v6I-Bju3mPDeGPktSJAgap1gQQ" --description "describe what changed"
   ```

3. **If CORS settings need updating or a new URL is required:** `clasp deploy` cannot set access permissions. The user must manually create a new deployment in the GAS Editor:
   - Open: https://script.google.com/home/projects/1_vh44nd0AjNMYm3czo-XXUM6rB_BF42sWsLY95TMmuc1asw_terZmpL8
   - Deploy → New deployment → Web App
   - Execute as: 我 (Me)
   - Access: 所有人 (Anyone)
   - Copy the new deployment URL and update `ui/js/api.js`

## Deploy UI Frontend

```bash
# Commit any ui/ changes to main first, then:
git push origin main:gh-pages
```

The site will be live at https://joseph101039.github.io/thsrc/ui/ within ~1 minute.

## After Deploying Both

If `WEB_UI_URL` in `gas/BookingEngine.gs` or `GAS_URL` in `ui/js/api.js` changed, remind the user to update the other side and redeploy again.