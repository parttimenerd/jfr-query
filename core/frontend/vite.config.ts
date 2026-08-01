import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      base: env.VITE_BASE_PATH || '/',
      server: {
        port: 3000,
        host: '0.0.0.0',
        headers: {
          'Cross-Origin-Embedder-Policy': 'require-corp',
          'Cross-Origin-Opener-Policy': 'same-origin',
        },
        proxy: {
          '/api': {
            target: `http://localhost:${env.JFR_SERVER_PORT || '4244'}`,
            changeOrigin: true,
          },
          // Forward /local-ai-proxy/* to a local AI server (avoids CORS on localhost endpoints)
          ...(env.LOCAL_AI_BASE_URL ? {
            '/local-ai-proxy': {
              target: env.LOCAL_AI_BASE_URL.replace(/\/$/, ''),
              changeOrigin: true,
              rewrite: (path: string) => path.replace(/^\/local-ai-proxy/, ''),
            },
          } : {}),
          // Forward /anthropic-proxy/* to the local Anthropic proxy (avoids COEP/CORS)
          ...(env.ANTHROPIC_BASE_URL ? {
            '/anthropic-proxy': {
              target: env.ANTHROPIC_BASE_URL.replace(/\/$/, ''),
              changeOrigin: true,
              rewrite: (path: string) => path.replace(/^\/anthropic-proxy/, ''),
            },
          } : {}),
        },
      },
      worker: {
        format: 'es',
      },
      optimizeDeps: {
        exclude: ['@duckdb/duckdb-wasm'],
      },
      plugins: [react(), tailwindcss()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.OPENAI_API_KEY': JSON.stringify(env.OPENAI_API_KEY),
        'process.env.GARDENER_API_KEY': JSON.stringify(env.GARDENER_API_KEY),
        'process.env.ANTHROPIC_API_KEY': JSON.stringify(env.ANTHROPIC_API_KEY),
        'process.env.ANTHROPIC_AUTH_TOKEN': JSON.stringify(env.ANTHROPIC_AUTH_TOKEN),
        // When a local proxy is configured, rewrite to /anthropic-proxy so the browser
        // fetches same-origin (no CORS/COEP issue). The Vite dev proxy forwards it.
        'process.env.ANTHROPIC_BASE_URL': JSON.stringify(
          env.ANTHROPIC_BASE_URL ? '/anthropic-proxy' : ''
        ),
        // When LOCAL_AI_BASE_URL is set, rewrite to /local-ai-proxy so the browser
        // fetches same-origin (no CORS issue). The Vite dev proxy forwards it.
        'process.env.LOCAL_AI_BASE_URL': JSON.stringify(
          env.LOCAL_AI_BASE_URL ? '/local-ai-proxy' : ''
        ),
        // Default to enabling local ML in dev mode; set VITE_USE_LOCAL_ML=false to opt out
        'import.meta.env.VITE_USE_LOCAL_ML': JSON.stringify(
          env.VITE_USE_LOCAL_ML ?? (mode === 'production' ? 'false' : 'true')
        ),
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
