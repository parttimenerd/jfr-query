import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
    root: 'scripts/bench',
    base: './',
    resolve: {
        alias: {
            '@': path.resolve(__dirname, '.'),
        },
    },
    define: {
        'process.env': '{}',
        'process.platform': '"browser"',
        'process.version': '"v0.0.0"',
    },
    build: {
        outDir: '../../dist-bench',
        emptyOutDir: true,
    },
    server: {
        port: 3100,
        open: false,
        headers: {
            // Required for SharedArrayBuffer used by ONNX Runtime WASM
            'Cross-Origin-Embedder-Policy': 'require-corp',
            'Cross-Origin-Opener-Policy': 'same-origin',
        },
    },
    optimizeDeps: {
        include: ['@huggingface/transformers'],
        exclude: ['@duckdb/duckdb-wasm'],
    },
});
