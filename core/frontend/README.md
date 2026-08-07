<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# JFR SQL Notebook

An interactive notebook for analyzing Java Flight Recorder (JFR) files using DuckDB and AI assistance. Write SQL queries, visualize results with built-in plot types, and use AI to generate queries and suggest visualizations.

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:
   ```
   npm install
   ```

2. Configure your AI provider via environment variables (optional but recommended):
   ```
   cp .env.local.example .env.local
   # Edit .env.local and fill in at least one key
   ```

   | Variable | Provider | Where to get it |
   |---|---|---|
   | `GEMINI_API_KEY` | Google Gemini | https://aistudio.google.com/apikey |
   | `OPENAI_API_KEY` | OpenAI GPT | https://platform.openai.com/api-keys |
   | `ANTHROPIC_API_KEY` | Anthropic Claude | https://console.anthropic.com/settings/keys |
   | `GARDENER_API_KEY` | Gardener Answering Machine | SAP internal — requires VPN |

   You can also enter API keys manually via the **Settings** (⚙) button in the app at any time.

3. Run the app:
   ```
   npm run dev
   ```

## Features

- **SQL Notebook** — Write and run DuckDB SQL queries against JFR data directly in the browser
- **Schema Explorer** — Browse all 100+ JFR event tables and views in the sidebar
- **AI Assistant** — Ask questions in natural language; the AI writes SQL and suggests visualizations
- **Plot Engine** — Built-in chart types (LINE_CHART, BAR_CHART, TABLE, and more) with a custom DSL
- **Variables** — Define `$variable` values per-cell or notebook-wide for reusable queries
- **Custom Views & Macros** — Save SQL snippets as reusable views or parameterized macros
- **Load Notebook** — Load a `.md` notebook file from disk using the toolbar button
- **Undo/Redo** — Full history for all notebook edits

## AI Providers

The app supports four AI backends. Select your provider and configure the API key in **Settings**:

- **Google Gemini** — Uses `gemini-2.5-flash` by default
- **OpenAI GPT** — Uses `gpt-4o` (advanced) and `gpt-4o-mini` (basic) by default
- **Anthropic Claude** — Uses `claude-sonnet-4-6` by default
- **Gardener Answering Machine** — SAP-internal multi-provider gateway (requires VPN); supports Claude, Gemini, and GPT models

## Testing

**Unit / component tests** (Vitest):

```
npm test
```

**End-to-end tests** (Playwright) — requires the dev server to be running (`npm run dev`):

```
npx playwright test e2e/
```

Set `SKIP_E2E=1` to skip e2e tests in CI environments where no browser is available:

```
SKIP_E2E=1 npx playwright test e2e/
```

Test files live in `core/frontend/e2e/` and follow the naming convention `<feature>.spec.ts`. Each spec uses `test.describe.serial` with graceful `test.skip()` guards so tests are safe to run against any build (demo, local dev, or CI).
