# CI Build & GitHub Pages Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend CI to deploy a MkDocs documentation site + built `core/frontend` to GitHub Pages on every successful push to `main`, and update the README with a screenshot and features section.

**Architecture:** Add a `pages` job to the existing `build-and-release.yaml` workflow that runs after `build` succeeds. It builds the Vite frontend (output: `core/frontend/dist/`) and MkDocs site (output: `site/`), merges them (docs at `/`, frontend at `/app/`), and deploys via `actions/deploy-pages`. A new `docs-site/` directory holds MkDocs source pages; `mkdocs.yml` at root configures the site.

**Tech Stack:** GitHub Actions, MkDocs Material (Python), Vite 6 / React 19 (Node 22), `actions/configure-pages`, `actions/upload-pages-artifact`, `actions/deploy-pages@v4`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `.github/workflows/build-and-release.yaml` | Modify | Add `pages` job + `pages`/`id-token` permissions |
| `mkdocs.yml` | Create | MkDocs site configuration |
| `docs-site/index.md` | Create | Home page (project overview, pulled from README content) |
| `docs-site/getting-started.md` | Create | Installation + build instructions |
| `docs-site/cli.md` | Create | CLI command reference |
| `docs-site/web-ui.md` | Create | Web UI / notebook feature docs |
| `.gitignore` | Modify | Add `site/` |
| `README.md` | Modify | Add screenshot + features section |

---

### Task 1: Add `site/` to .gitignore and create `docs-site/` skeleton

**Files:**
- Modify: `.gitignore`
- Create: `docs-site/index.md`
- Create: `docs-site/getting-started.md`
- Create: `docs-site/cli.md`
- Create: `docs-site/web-ui.md`

- [ ] **Step 1: Add `site/` to .gitignore**

Open `.gitignore` and add at the end:

```
/site/
```

- [ ] **Step 2: Create `docs-site/index.md`**

```markdown
# JFR Query

![JFR Query Notebook UI](../page-full.png)

Analyse Java Flight Recorder files with SQL. JFR Query transforms a `.jfr` recording into a
[DuckDB](https://duckdb.org/) database and lets you query it with the full power of SQL —
or explore it through a notebook-style web UI.

## Features

- **Notebook-style analysis** — compose SQL cells, prose, and charts in one document
- **Built-in templates** — ready-made analyses for GC, heap allocation, threading, and exceptions
- **Interactive charts** — line, bar, scatter, heatmap, and flame graphs with brushable time ranges
- **Variable controls** — parameterised queries with sliders, dropdowns, and text inputs
- **Inline scalars** — embed `${SELECT …}` expressions directly in prose
- **AI-assisted queries** — context-aware SQL suggestions powered by Google Gemini
- **Live demo** — try the UI without installing anything: [Open demo →](app/index.html)

## Quick Start

```shell
# Download and run
java -jar query.jar serve myrecording.jfr
```

See [Getting Started](getting-started.md) for full install instructions.
```

- [ ] **Step 3: Create `docs-site/getting-started.md`**

```markdown
# Getting Started

## Requirements

- Java 21+
- (Optional) [jbang](https://www.jbang.dev/) for zero-install usage

## Install via jbang

```shell
jbang jfr-query@parttimenerd/jfr-query
```

## Download pre-built JAR

Download the [latest snapshot](https://github.com/parttimenerd/jfr-query/releases/download/snapshot/query.jar):

```shell
curl -L -o query.jar https://github.com/parttimenerd/jfr-query/releases/download/snapshot/query.jar
java -jar query.jar --help
```

## Build from source

```shell
git clone https://github.com/parttimenerd/jfr-query.git
cd jfr-query
mvn clean package
java -jar target/query.jar --help
```

Requires Java 21 and Maven 3.8+. The frontend is built automatically during `mvn package`.

## Start the web UI

```shell
java -jar query.jar serve path/to/recording.jfr
# Open http://localhost:4244 in your browser
```

Pass `--port` to change the port. Pass `--templates-dir` to load custom notebook templates.
```

- [ ] **Step 4: Create `docs-site/cli.md`**

```markdown
# CLI Reference

## Global

```shell
java -jar query.jar [-hV] [COMMAND]
```

| Flag | Description |
|------|-------------|
| `-h, --help` | Show help |
| `-V, --version` | Print version |

## `import`

Import a JFR recording into a DuckDB database file.

```shell
java -jar query.jar import recording.jfr output.db
```

## `query`

Execute a SQL query or named view against a JFR recording.

```shell
java -jar query.jar query recording.jfr "hot-methods"
java -jar query.jar query recording.jfr "SELECT * FROM GarbageCollection LIMIT 10"
```

Named views (e.g. `hot-methods`) expand to `SELECT * FROM <view>`. List all views with `views`.

## `serve`

Start the notebook web UI.

```shell
java -jar query.jar serve recording.jfr [--port 4244] [--templates-dir ~/my-templates]
```

## `macros`

List available SQL macros.

```shell
java -jar query.jar macros recording.jfr
```

## `views`

List available SQL views.

```shell
java -jar query.jar views recording.jfr
```

## `context`

Print an AI-friendly schema description (tables, macros, views) suitable for pasting into an LLM.

```shell
java -jar query.jar context recording.jfr
```
```

- [ ] **Step 5: Create `docs-site/web-ui.md`**

```markdown
# Web UI & Notebooks

Start the UI with `java -jar query.jar serve recording.jfr`, then open `http://localhost:4244`.

## Notebook cells

A notebook is a sequence of cells. Each cell contains a SQL query and optionally renders its
result as a chart. Cells can reference each other's results via named aliases.

## Built-in templates

Open the template gallery with **New from template** in the top bar. Built-in templates cover:

| Template | What it shows |
|----------|--------------|
| GC Analysis | Pause times, GC cause breakdown, heap after GC |
| Heap Allocation | Top allocating methods, allocation over time |
| Threading | Thread count, lock contention, blocked threads |
| Exceptions | Exception frequency and stack traces |

Choose **Replace**, **Append**, or **Insert at top** when applying a template.

## Variable controls

Add `variables` in the notebook front-matter to expose sliders/inputs in the sidebar:

```yaml
variables:
  $$threshold_ms: '100'
```

Reference them in SQL as `$$threshold_ms`.

## Inline scalars

Embed query results inline in prose:

```
There were ${SELECT count(*) FROM GarbageCollection} GC events.
```

## Conditional blocks

Show a section only when a condition holds:

````
```{if SELECT max(duration_ms) > $$threshold_ms FROM gc_pauses}
### Warning: long pauses detected
```
````

## Custom templates

Pass `--templates-dir ~/my-templates` to `serve`. Any `.md` file at the top level is listed
in the gallery under a "user" badge. See the [template syntax](cli.md) section of the CLI docs.
```

- [ ] **Step 6: Commit**

```bash
git add .gitignore docs-site/
git commit -m "docs: add MkDocs docs-site source pages"
```

---

### Task 2: Create `mkdocs.yml`

**Files:**
- Create: `mkdocs.yml`

- [ ] **Step 1: Create `mkdocs.yml`**

```yaml
site_name: JFR Query
site_description: Analyse Java Flight Recorder files with SQL
site_url: https://parttimenerd.github.io/jfr-query/
repo_url: https://github.com/parttimenerd/jfr-query
repo_name: parttimenerd/jfr-query

docs_dir: docs-site

theme:
  name: material
  palette:
    - scheme: default
      toggle:
        icon: material/brightness-7
        name: Switch to dark mode
    - scheme: slate
      toggle:
        icon: material/brightness-4
        name: Switch to light mode
  features:
    - navigation.top
    - search.suggest
    - content.code.copy

nav:
  - Home: index.md
  - Getting Started: getting-started.md
  - Usage:
    - CLI Commands: cli.md
    - Web UI & Notebooks: web-ui.md
  - Live Demo: https://parttimenerd.github.io/jfr-query/app/

plugins:
  - search
```

- [ ] **Step 2: Verify MkDocs builds locally (optional but recommended)**

```bash
pip install mkdocs-material
mkdocs build --strict
# Should produce site/ directory with no errors
ls site/
```

Expected: `site/index.html`, `site/getting-started/index.html`, etc. No errors.

- [ ] **Step 3: Commit**

```bash
git add mkdocs.yml
git commit -m "docs: add mkdocs.yml with Material theme"
```

---

### Task 3: Update README with screenshot and features

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add screenshot and features section to README**

Replace the opening block of `README.md` (lines 1–17, from `JFR Query` through the prototype warning) with the following. Keep everything from `Try it out` onwards unchanged.

```markdown
JFR Query
=========

![Duke, the Java mascot riding a duck](img/duck_duke.jpeg)

Working on JFR files using SQL. Essentially transforming JFR files into a DuckDB database
and then using [DuckDB](https://duckdb.org/) to query it, with support for all JFR views.

Previously, we tried to use the JFR query language directly, but it is quite limited.

The purpose of this project is to ease the pain of exploring JFR files and finding interesting
patterns in them.

_If you are looking for the tool based on the JFR internal language, you can find it at
[jfr-query-experiments](https://github.com/parttimenerd/jfr-query-experiments)._

**This is an early prototype, to see what's possible. The database schema might change at any point.**

## Features

![JFR Query Notebook UI](page-full.png)

- **Notebook-style analysis** — compose SQL cells, prose, and charts in a single document
- **Built-in templates** — ready-made analyses for GC, heap allocation, threading, and exceptions
- **Interactive charts** — line, bar, scatter, heatmap, and flame graphs with brushable time ranges
- **Variable controls** — parameterised queries with sliders, dropdowns, and text inputs
- **Inline scalars** — embed `${SELECT …}` query results directly in prose
- **AI-assisted queries** — context-aware SQL suggestions powered by Google Gemini
```

- [ ] **Step 2: Verify the README renders correctly**

```bash
# Quick check — look for the Features heading and img tag
grep -n "Features\|page-full" README.md
```

Expected output shows both lines present.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add screenshot and features section to README"
```

---

### Task 4: Add `pages` job to CI workflow

**Files:**
- Modify: `.github/workflows/build-and-release.yaml`

- [ ] **Step 1: Update workflow permissions**

In `build-and-release.yaml`, replace the `permissions` block:

```yaml
# before:
permissions:
  contents: write
  packages: read
  issues: read
```

with:

```yaml
permissions:
  contents: write
  packages: read
  issues: read
  pages: write
  id-token: write
```

- [ ] **Step 2: Add `pages` job at the end of the workflow file**

Append the following job after the existing `release` job:

```yaml
  pages:
    needs: build
    if: github.event_name == 'push' && (github.ref == 'refs/heads/main' || github.ref == 'refs/heads/master') || github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: core/frontend/package-lock.json

      - name: Build frontend
        working-directory: core/frontend
        run: |
          npm ci
          npm run build

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Install MkDocs Material
        run: pip install mkdocs-material

      - name: Build docs
        run: mkdocs build --strict

      - name: Assemble Pages artifact
        run: |
          mkdir -p _pages/app
          cp -r site/. _pages/
          cp -r core/frontend/dist/. _pages/app/

      - name: Configure Pages
        uses: actions/configure-pages@v4

      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: _pages

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 3: Verify YAML is valid**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/build-and-release.yaml'))" && echo "YAML valid"
```

Expected: `YAML valid`

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/build-and-release.yaml
git commit -m "ci: add pages job to deploy frontend + MkDocs to GitHub Pages"
```

---

### Task 5: Enable GitHub Pages in repo settings

This task is a manual step — it cannot be done via code.

- [ ] **Step 1: Open repo settings**

Go to `https://github.com/parttimenerd/jfr-query/settings/pages`

- [ ] **Step 2: Set Pages source to GitHub Actions**

Under **Build and deployment → Source**, select **GitHub Actions** (not a branch).

Save. No branch or folder selection is needed — the workflow handles the upload.

- [ ] **Step 3: Push the branch and verify CI**

```bash
git push origin main
```

Open `https://github.com/parttimenerd/jfr-query/actions` and watch the **Build and Release** workflow. The `pages` job should appear after `build` succeeds.

- [ ] **Step 4: Verify deployed site**

Once the `pages` job completes, open `https://parttimenerd.github.io/jfr-query/` (may take ~1 minute to propagate).

Check:
- `https://parttimenerd.github.io/jfr-query/` — MkDocs home page loads
- `https://parttimenerd.github.io/jfr-query/getting-started/` — Getting started page loads
- `https://parttimenerd.github.io/jfr-query/app/` — React frontend loads
