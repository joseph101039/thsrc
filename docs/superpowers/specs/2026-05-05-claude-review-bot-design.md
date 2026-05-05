# Claude PR Code Review Bot — Design Spec

**Date:** 2026-05-05  
**Repo:** joseph101039/thsrc

## Overview

Automatically run Claude code review on every pull request targeting `main`, posting results as a PR comment in Traditional Chinese.

## Trigger Conditions

- Event: `pull_request`
- Types: `opened`, `synchronize`, `reopened`
- Base branch: `main`

## Implementation

Use Anthropic's official `anthropics/claude-code-action` GitHub Action.

**File:** `.github/workflows/claude-review.yml`

## Configuration

| Setting | Value |
|---|---|
| Model | `claude-sonnet-4-6` |
| Output | PR comment (Traditional Chinese) |
| Secret | `ANTHROPIC_API_KEY` (repo-level) |

## Permissions

```yaml
permissions:
  pull-requests: write
  contents: read
```

## Review Scope

The prompt instructs Claude to review for:
1. 邏輯錯誤 (logic errors)
2. 安全漏洞 (security vulnerabilities — OWASP Top 10)
3. 程式碼品質 (code quality, readability, naming)
4. 效能問題 (performance)
5. 可維護性 (maintainability, coupling, SOLID)

Output language: **繁體中文**

## Required Setup (Manual)

1. Go to `github.com/joseph101039/thsrc` → Settings → Secrets → Actions
2. Add secret: `ANTHROPIC_API_KEY` = your Anthropic API key

## Out of Scope

- Inline PR review comments (only top-level PR comment)
- Manual trigger (`/review` command)
- Multi-model routing based on PR size
