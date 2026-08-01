import { describe, it, expect } from 'vitest';
import { getTool, validateToolArgs, TOOLS } from '../../../../services/ai/tools/index';
import type { Tool } from '../../../../services/ai/tools/index';

// ─── getTool ──────────────────────────────────────────────────────────────────

describe('getTool', () => {
    it('returns the tool with the matching name', () => {
        const tool = getTool('runQuery');
        expect(tool).toBeDefined();
        expect(tool!.name).toBe('runQuery');
    });

    it('returns undefined for an unknown tool name', () => {
        expect(getTool('nonExistentTool')).toBeUndefined();
    });

    it('is case-sensitive', () => {
        expect(getTool('RUNQUERY')).toBeUndefined();
    });

    it('can find every tool in TOOLS by name', () => {
        for (const t of TOOLS) {
            expect(getTool(t.name)?.name).toBe(t.name);
        }
    });
});

// ─── validateToolArgs ─────────────────────────────────────────────────────────

const runQueryTool: Tool = {
    name: 'runQuery',
    kind: 'read',
    description: 'Run SQL.',
    inputSchema: {
        type: 'object',
        properties: {
            sql: { type: 'string', description: 'SQL query.' },
            limit: { type: 'integer', minimum: 1, maximum: 500 },
            offset: { type: 'integer', minimum: 0 },
        },
        required: ['sql'],
    },
};

describe('validateToolArgs', () => {
    it('returns null for valid args', () => {
        expect(validateToolArgs(runQueryTool, { sql: 'SELECT 1' })).toBeNull();
    });

    it('returns null when optional fields are present with correct types', () => {
        expect(validateToolArgs(runQueryTool, { sql: 'SELECT 1', limit: 50 })).toBeNull();
    });

    it('returns error when required field is missing', () => {
        const err = validateToolArgs(runQueryTool, { limit: 10 });
        expect(err).toContain('missing required field: sql');
    });

    it('returns error for non-object args', () => {
        expect(validateToolArgs(runQueryTool, null)).toContain('must be an object');
        expect(validateToolArgs(runQueryTool, 'string')).toContain('must be an object');
    });

    it('returns error when string field is not a string', () => {
        const err = validateToolArgs(runQueryTool, { sql: 123 });
        expect(err).toContain('sql must be a string');
    });

    it('returns error when integer field is not an integer', () => {
        const err = validateToolArgs(runQueryTool, { sql: 'SELECT 1', limit: 1.5 });
        expect(err).toContain('limit must be an integer');
    });

    it('returns error when value exceeds maximum', () => {
        const err = validateToolArgs(runQueryTool, { sql: 'SELECT 1', limit: 501 });
        expect(err).toContain('exceeds maximum 500');
    });

    it('returns error when value is below minimum', () => {
        const err = validateToolArgs(runQueryTool, { sql: 'SELECT 1', limit: 0 });
        expect(err).toContain('is below minimum 1');
    });

    it('allows extra unknown keys', () => {
        expect(validateToolArgs(runQueryTool, { sql: 'SELECT 1', extraKey: 'ok' })).toBeNull();
    });

    it('validates enum membership', () => {
        const enumTool: Tool = {
            name: 'test',
            kind: 'read',
            description: '',
            inputSchema: {
                type: 'object',
                properties: { mode: { type: 'string', enum: ['a', 'b'] } },
                required: ['mode'],
            },
        };
        expect(validateToolArgs(enumTool, { mode: 'a' })).toBeNull();
        const err = validateToolArgs(enumTool, { mode: 'c' });
        expect(err).toContain('must be one of');
    });

    it('validates object type field', () => {
        const objTool: Tool = {
            name: 'test',
            kind: 'read',
            description: '',
            inputSchema: {
                type: 'object',
                properties: { data: { type: 'object' } },
                required: ['data'],
            },
        };
        expect(validateToolArgs(objTool, { data: { x: 1 } })).toBeNull();
        expect(validateToolArgs(objTool, { data: 'string' })).toContain('must be an object');
    });

    it('validates array type field', () => {
        const arrTool: Tool = {
            name: 'test',
            kind: 'read',
            description: '',
            inputSchema: {
                type: 'object',
                properties: { items: { type: 'array' } },
                required: ['items'],
            },
        };
        expect(validateToolArgs(arrTool, { items: [1, 2] })).toBeNull();
        expect(validateToolArgs(arrTool, { items: 'notarray' })).toContain('must be an array');
    });
});
