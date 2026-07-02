# CI Build & GitHub Pages Deployment

**Date:** 2026-07-02  
**Status:** Approved

## Goal

Extend CI to build `core/frontend` and a MkDocs documentation site, then deploy both to GitHub Pages on every successful push to `main`. Also update the README with a screenshot and features section.

## Workflow Architecture

Extend `build-and-release.yaml` with a `pages` job that runs in parallel with `release` after `build` succeeds:

```
build ──┬──► release   (existing — snapshot JAR to GitHub Releases)
        └──► pages     (new — frontend + docs to GitHub Pages)
```

**`pages` job:**
- Runs only on push to `main` (not on PRs)
- Depends on `build` job (gates deployment behind a successful Maven build)
- Installs Node, runs `npm ci && npm run build` in `core/frontend/`
- Installs Python, runs `mkdocs build` from repo root
- Merges outputs: MkDocs `site/` at root, Vite `core/frontend/dist/` at `/app/`
- Deploys via `actions/upload-pages-artifact` + `actions/deploy-pages@v4`

**Permissions added to workflow:**
- `pages: write`
- `id-token: write`

GitHub Pages must be configured in the repo settings to use "GitHub Actions" as the source.

## MkDocs Site

**Config file:** `mkdocs.yml` at repo root  
**Source directory:** `docs-site/` (new, separate from `docs/` which holds internal agent/review files)  
**Theme:** Material for MkDocs (dark/light mode, search, clean layout)

**Nav structure:**
```
Home           → docs-site/index.md  (mirrors README)
Getting Started → docs-site/getting-started.md  (install + build)
Usage
  CLI Commands  → docs-site/cli.md
  Web UI        → docs-site/web-ui.md
Live Demo       → /app/  (external link to deployed frontend)
```

**Build output:** `site/` (added to `.gitignore`)

## README Updates

1. **Screenshot** — add `page-full.png` below the project description
2. **Features section** — short bullet list:
   - Notebook-style analysis with SQL cells
   - Built-in templates (GC, heap allocation, threading, exceptions)
   - Interactive charts with brushable time ranges
   - Variable controls for parameterized queries
   - AI-assisted query suggestions
   - Export and share notebooks

## File Changes Summary

| File | Action |
|------|--------|
| `.github/workflows/build-and-release.yaml` | Add `pages` job |
| `mkdocs.yml` | Create |
| `docs-site/index.md` | Create (home page) |
| `docs-site/getting-started.md` | Create |
| `docs-site/cli.md` | Create |
| `docs-site/web-ui.md` | Create |
| `.gitignore` | Add `site/` |
| `README.md` | Add screenshot + features section |

## Out of Scope

- `frontend-v2/` deployment
- Internal `docs/` content (reviews, agent-state, plans) — not published
- Frontend tests in CI (existing workflow already skips tests with `-DskipTests`)
