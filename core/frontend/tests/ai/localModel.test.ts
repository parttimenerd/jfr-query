import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { LocalAiProvider } from '../../services/ai/LocalAiProvider';
import { splitCellFences, parseCellFence } from '../../components/chat/ChatEmbeddedCell';

// ── Mock OpenAI-compatible SSE server ─────────────────────────────────────────

function sseChunk(delta: string, done = false): string {
    if (done) return 'data: [DONE]\n\n';
    const payload = JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion.chunk',
        choices: [{ delta: { content: delta }, finish_reason: null, index: 0 }],
    });
    return `data: ${payload}\n\n`;
}

function startMockServer(responseChunks: string[], statusCode = 200): Promise<{ server: http.Server; port: number }> {
    return new Promise(resolve => {
        const server = http.createServer((req, res) => {
            res.writeHead(statusCode, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
            });
            if (statusCode !== 200) { res.end(); return; }
            for (const chunk of responseChunks) res.write(chunk);
            res.write(sseChunk('', true)); // [DONE]
            res.end();
        });
        server.listen(0, '127.0.0.1', () => {
            const port = (server.address() as any).port;
            resolve({ server, port });
        });
    });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('LocalAiProvider streaming', () => {
    let server: http.Server;
    let port: number;

    beforeAll(async () => {
        ({ server, port } = await startMockServer([
            sseChunk('Hello '),
            sseChunk('world'),
            sseChunk('!'),
        ]));
    });

    afterAll(() => server.close());

    it('streams text chunks and assembles full response', async () => {
        const provider = new LocalAiProvider('', `http://127.0.0.1:${port}`, 2048);
        const chunks: string[] = [];
        for await (const chunk of provider.streamChatWithTools!(
            [{ role: 'user', content: 'hi' }],
            [],
            { systemInstruction: 'You are helpful.' },
        )) {
            if (chunk.kind === 'text') chunks.push(chunk.delta);
        }
        expect(chunks.join('')).toBe('Hello world!');
    });
});

describe('LocalAiProvider streaming — cell fence detection', () => {
    let server: http.Server;
    let port: number;

    const cellResponse = [
        sseChunk('Here is the data:\n'),
        sseChunk(':::cell type=table\n'),
        sseChunk('sql: SELECT 1 AS n\n'),
        sseChunk(':::\n'),
        sseChunk('Done.'),
    ];

    beforeAll(async () => {
        ({ server, port } = await startMockServer(cellResponse));
    });
    afterAll(() => server.close());

    it('full streamed response contains the cell fence', async () => {
        const provider = new LocalAiProvider('', `http://127.0.0.1:${port}`, 2048);
        let full = '';
        for await (const chunk of provider.streamChatWithTools!(
            [{ role: 'user', content: 'show me' }],
            [],
        )) {
            if (chunk.kind === 'text') full += chunk.delta;
        }
        expect(full).toContain(':::cell type=table');
        expect(full).toContain('sql: SELECT 1 AS n');
    });

    it('splitCellFences correctly parses the assembled response', () => {
        const text = 'Here is the data:\n:::cell type=table\nsql: SELECT 1 AS n\n:::\nDone.';
        const parts = splitCellFences(text);
        expect(parts.filter(p => p.kind === 'cell')).toHaveLength(1);
        const cell = parts.find(p => p.kind === 'cell')!;
        const parsed = parseCellFence(cell.content);
        expect(parsed?.type).toBe('table');
        expect(parsed?.sql).toBe('SELECT 1 AS n');
    });

    it('parseCellFence handles multi-line sql via indented block', () => {
        const inner = 'type=chart\nplot: LINE_CHART(x: "t", y: ["v"])\nsql:\n  SELECT t, v\n  FROM foo\n  ORDER BY t';
        const parsed = parseCellFence(inner);
        expect(parsed?.type).toBe('chart');
        expect(parsed?.sql).toContain('SELECT t, v');
        expect(parsed?.sql).toContain('FROM foo');
        expect(parsed?.plotConfig).toBe('LINE_CHART(x: "t", y: ["v"])');
    });

    it('parseCellFence handles ```sql fence inside cell', () => {
        const inner = 'type=table\nsql:\n```sql\nSELECT * FROM bar\n```';
        const parsed = parseCellFence(inner);
        expect(parsed?.type).toBe('table');
        expect(parsed?.sql).toBe('SELECT * FROM bar');
    });

    it('splitCellFences matches :::cell with no space (newline only)', () => {
        const text = 'text\n:::cell\ntype=table\nsql: SELECT 1\n:::\nend';
        const parts = splitCellFences(text);
        expect(parts.filter(p => p.kind === 'cell')).toHaveLength(1);
    });
});

describe('LocalAiProvider — 503 fallback detection', () => {
    let server: http.Server;
    let port: number;

    beforeAll(async () => {
        ({ server, port } = await startMockServer([], 503));
    });
    afterAll(() => server.close());

    it('throws when server returns 503', async () => {
        const provider = new LocalAiProvider('', `http://127.0.0.1:${port}`, 2048);
        await expect(async () => {
            for await (const _ of provider.streamChatWithTools!(
                [{ role: 'user', content: 'hi' }],
                [],
            )) { /* consume */ }
        }).rejects.toThrow();
    });
});

describe(':::cell fence round-trip', () => {
    it('parses multiple fences interleaved with text', () => {
        const text = [
            'First chart:',
            ':::cell type=chart',
            'sql: SELECT bucket, avg(pause_ms) AS p FROM gc GROUP BY bucket ORDER BY bucket',
            'plot: LINE_CHART(x: "bucket", y: ["p"])',
            ':::',
            'And a table:',
            ':::cell type=table',
            'sql: SELECT * FROM gc LIMIT 10',
            ':::',
            'Done.',
        ].join('\n');

        const parts = splitCellFences(text);
        const cells = parts.filter(p => p.kind === 'cell');
        expect(cells).toHaveLength(2);

        const chart = parseCellFence(cells[0].content);
        expect(chart?.type).toBe('chart');
        expect(chart?.plotConfig).toBe('LINE_CHART(x: "bucket", y: ["p"])');

        const table = parseCellFence(cells[1].content);
        expect(table?.type).toBe('table');
        expect(table?.sql).toContain('SELECT * FROM gc');
    });

    it('text parts preserve surrounding content', () => {
        const text = 'Before\n:::cell type=table\nsql: SELECT 1\n:::\nAfter';
        const parts = splitCellFences(text);
        const texts = parts.filter(p => p.kind === 'text').map(p => p.content);
        expect(texts[0]).toContain('Before');
        expect(texts[1]).toContain('After');
    });
});

describe('routing + system prompt integration', () => {
    it('buildLocalSystemPrompt + routeMessage are consistent — local route uses local prompt', async () => {
        const { buildLocalSystemPrompt } = await import('../../services/ai/chatModes');
        const { routeMessage } = await import('../../services/ai/routing');

        const route = routeMessage('show gc pauses', [], 'no-data', 'auto');
        expect(route).toBe('local');

        const prompt = buildLocalSystemPrompt(
            [{ name: 'GarbageCollection', columns: [{ name: 'duration' }] }],
            { threshold: 20 },
        );
        expect(prompt).toContain('GarbageCollection');
        expect(prompt).toContain('threshold');
    });
});
