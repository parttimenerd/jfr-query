# AI Assistant — Provider Configuration

The AI assistant answers questions, writes SQL, and suggests plots. It supports several
provider backends — from cloud APIs to fully local in-browser inference.

Open **Settings** (⚙ in the top toolbar) to configure.

---

## Provider overview

| Provider | Where it runs | API key required | Works on GitHub Pages |
|---|---|---|---|
| Anthropic (Claude) | Anthropic cloud | Yes | Yes (direct API) |
| OpenAI | OpenAI cloud | Yes | Yes (direct API) |
| Google Gemini | Google cloud | Yes | Yes (direct API) |
| Local OpenAI-compatible | Your machine | Optional | Dev-mode only ‡ |
| In-browser (Qwen2.5-0.5B) | Your browser | No | Yes |

‡ Local providers require the Vite dev server for the CORS proxy.
See [Local provider on GitHub Pages](#local-provider-on-github-pages) below.

---

## Cloud providers (Anthropic, OpenAI, Google)

1. Open **Settings → AI provider** and select the provider.
2. Paste your API key. The key is stored only in your browser's `localStorage`.
3. Click **Test** to verify the key works.

For Anthropic, the best model for JFR analysis is **claude-sonnet-4-5** or newer.

---

## Local OpenAI-compatible provider

Connects to any server that exposes an OpenAI-compatible `/v1/chat/completions` endpoint:
llama.cpp `llama-server`, Ollama, vLLM, LM Studio, or any OpenAI-compatible gateway.

### Settings

| Field | Description |
|---|---|
| **Base URL** | Root URL of the API server — do **not** include `/v1`. |
| **API Key** | Optional. Leave blank for unauthenticated local servers. |
| **Advanced Model** | Model name used for chat (e.g. `qwen3:9b`, `gpt-4.1`). |

### llama.cpp / llama-server (default)

```
Base URL: http://localhost:8080
API Key:  (leave blank)
Model:    qwen3:1.7b  or  qwen3:9b
```

### Ollama

```
Base URL: http://localhost:11434
API Key:  (leave blank)
Model:    qwen3:9b  or  llama3.2:3b
```

Pull the model first: `ollama pull qwen3:9b`

### SAP AI Core / Hyperspace ("Local Hai Proxy") {#sap-hai-proxy}

The [SAP AI Core proxy](https://github.com/SAP/ai-sdk-js) exposes an
OpenAI-compatible endpoint. When running locally on port 6655:

```
Base URL: http://localhost:6655/openai
API Key:  <your-proxy-api-key>
Model:    gpt-4.1   (or gpt-4.1-mini, gpt-5, gpt-5-mini)
```

> **Important:** The Base URL must end at `/openai`, not `/openai/v1`.
> The client appends `/v1/chat/completions` automatically.

**Available models via the SAP AI proxy:**

| Model ID | Notes |
|---|---|
| `gpt-4.1` | Best for complex JFR analysis |
| `gpt-4.1-mini` | Faster, good for simple queries |
| `gpt-5` | Latest, highest quality |
| `gpt-5-mini` | Fast and capable |

**Quick-start with the SAP proxy in dev mode:**

```bash
# Set env var so the Vite proxy routes /local-ai-proxy → http://localhost:6655/openai
LOCAL_AI_BASE_URL=http://localhost:6655/openai npm run dev
```

Then set **Base URL** to `http://localhost:6655/openai` and your API key in Settings.

---

## Local provider on GitHub Pages

> **Summary:** The CORS proxy that makes local AI work is part of the Vite dev server.
> It is **not** available on the GitHub Pages deployment.
>
> If you want to use a local AI provider with the live web app at
> `https://parttimenerd.github.io/jfr-query/`, you have two options:

### Option A — Run jfr-query locally (recommended)

```bash
# Clone and start the dev server with your local AI proxy URL
git clone https://github.com/parttimenerd/jfr-query
cd jfr-query/core/frontend
LOCAL_AI_BASE_URL=http://localhost:6655/openai npm run dev
# Open http://localhost:3000
```

This is also the best option for analysing real recordings — you get full JFR file access
without uploading data to a third party.

### Option B — Use a CORS-enabled endpoint

Some AI gateways and self-hosted servers support CORS. If your local server sends
`Access-Control-Allow-Origin: *` (or the specific GitHub Pages origin), you can enter
its URL directly in Settings and the browser will call it cross-origin.

To check: `curl -I -X OPTIONS http://localhost:YOUR_PORT/v1/chat/completions`
If the response includes `Access-Control-Allow-Origin`, it will work from GitHub Pages.

---

## In-browser model (Qwen2.5-0.5B)

Runs **entirely in your browser** — no server, no API key, no data leaves your machine.
Uses [Transformers.js](https://huggingface.co/docs/transformers.js) with the
`onnx-community/Qwen2.5-0.5B-Instruct` model (~483 MB, downloaded once and cached).

Enable it in the chat panel by clicking the **🧠 browser** routing button, or set
**AI provider → In-browser model** in Settings.

The first message triggers the model download. A progress bar appears in the chat header.
After the first load the model is cached in browser storage and loads instantly.

> **Note:** The 0.5B parameter model is suitable for simple questions and SQL suggestions.
> For complex multi-step analysis, use a cloud or local provider.

---

## Environment variables (dev / self-hosted)

These variables are read at build time by Vite and override the Settings defaults:

| Variable | Effect |
|---|---|
| `ANTHROPIC_API_KEY` | Pre-fill Anthropic key |
| `OPENAI_API_KEY` | Pre-fill OpenAI key |
| `GEMINI_API_KEY` | Pre-fill Google key |
| `LOCAL_AI_BASE_URL` | Enables the CORS proxy for a local AI server (dev only) |
| `ANTHROPIC_BASE_URL` | Override Anthropic base URL (for custom proxies) |

Set them in a `.env.local` file at `core/frontend/.env.local` or export before `npm run dev`.
