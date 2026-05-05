# Claude PR Code Review Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GitHub Actions workflow that automatically posts a Claude code review comment (in Traditional Chinese) on every PR targeting `main`.

**Architecture:** A single GitHub Actions workflow file uses `anthropics/claude-code-action@v1` to send the PR diff to `claude-sonnet-4-6`. The action posts the review as a PR comment. No custom scripts required — configuration is entirely in YAML.

**Tech Stack:** GitHub Actions, `anthropics/claude-code-action@v1`, `ANTHROPIC_API_KEY` secret

---

### Task 1: Create the GitHub Actions workflow file

**Files:**
- Create: `.github/workflows/claude-review.yml`

- [ ] **Step 1: Create the workflow file**

Create `.github/workflows/claude-review.yml` with the following content:

```yaml
name: Claude PR Code Review

on:
  pull_request:
    types: [opened, synchronize, reopened]
    branches:
      - main

permissions:
  pull-requests: write
  contents: read

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Claude Code Review
        uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          model: claude-sonnet-4-6
          direct_prompt: |
            Please review the code changes in this Pull Request in English.

            Review areas:
            1. **Logic errors** — potential bugs, edge cases, unexpected behavior
            2. **Security vulnerabilities** — OWASP Top 10, injection, auth issues, sensitive data exposure
            3. **Code quality** — naming clarity, code duplication, SOLID principles
            4. **Performance issues** — N+1 queries, unnecessary computation, memory leaks
            5. **Maintainability** — coupling, readability, module boundaries

            Output format:
            - Start with a brief overall summary (2-3 sentences)
            - Group issues by severity: 🔴 Critical, 🟡 Suggestion, 🟢 Minor
            - For each issue: location, description, recommended fix
            - If no issues found, explain why the code quality is good
```

- [ ] **Step 2: Verify the file exists**

```bash
cat .github/workflows/claude-review.yml
```

Expected: full YAML content printed without errors.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/claude-review.yml
git commit -m "feat: add Claude PR code review bot via GitHub Actions"
```

---

### Task 2: Add ANTHROPIC_API_KEY secret to GitHub repo

**Files:** (none — this is a manual GitHub UI step)

- [ ] **Step 1: Open the repo secrets page**

Navigate to: `https://github.com/joseph101039/thsrc/settings/secrets/actions`

- [ ] **Step 2: Add the secret**

Click **New repository secret**, set:
- Name: `ANTHROPIC_API_KEY`
- Value: your Anthropic API key (from https://console.anthropic.com/)

Click **Add secret**.

- [ ] **Step 3: Verify**

The secret `ANTHROPIC_API_KEY` should appear in the secrets list (value is hidden).

---

### Task 3: Verify the bot works end-to-end

- [ ] **Step 1: Push the workflow branch and open a test PR**

```bash
git checkout -b test-claude-review-bot
# make a trivial change, e.g. add a comment to server/src/api.js
echo "// test" >> server/src/api.js
git add server/src/api.js
git commit -m "test: trigger Claude review bot"
git push origin test-claude-review-bot
```

Then open a PR from `test-claude-review-bot` → `main` on GitHub.

- [ ] **Step 2: Check the Actions tab**

Go to `https://github.com/joseph101039/thsrc/actions` and confirm the `Claude PR Code Review` workflow runs.

Expected: workflow completes successfully (green check).

- [ ] **Step 3: Verify PR comment**

On the PR page, confirm Claude posted a review comment in Traditional Chinese covering the five review areas.

- [ ] **Step 4: Clean up test branch**

```bash
git checkout main
git branch -d test-claude-review-bot
git push origin --delete test-claude-review-bot
```

Also close/delete the test PR on GitHub.
