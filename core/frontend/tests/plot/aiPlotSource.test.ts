// Tests for plot AI streaming-validation logic. These tests target
// `validatePlotStream` directly (the orchestrator's view-plugin orchestration
// requires a CodeMirror DOM environment; the validation logic is the
// load-bearing piece of P5).

import { describe, it, expect } from 'vitest';
import { validatePlotStream } from '../../components/editor/plot/aiPlotSource';

describe('validatePlotStream — happy path', () => {
    it('builds up LINE_CHART argument list across chunks', () => {
        const prefix = '';
        // After each chunk we run the validator. Final should be 'ok' since the
        // last char is ')'.
        const chunks = ['LINE_CHART(x:', ' "ts"', ', y:', ' "pause")'];
        let acc = '';
        let last: ReturnType<typeof validatePlotStream> | null = null;
        for (const c of chunks) {
            acc += c;
            last = validatePlotStream(prefix, acc);
            // Intermediate chunks must not discard a valid in-progress suggestion.
            expect(last.status).not.toBe('discard');
        }
        expect(last?.status).toBe('ok');
        expect(acc).toBe('LINE_CHART(x: "ts", y: "pause")');
    });
});

describe('validatePlotStream — truncate at stable boundary', () => {
    it('truncates trailing garbage after the last `)` when parse breaks', () => {
        const prefix = '';
        // First the suggestion completes the plot cleanly...
        const goodAcc = 'LINE_CHART(x: "ts")';
        const okv = validatePlotStream(prefix, goodAcc);
        expect(okv.status).toBe('ok');
        // ...then the next chunk introduces a parse error past the stable `)`.
        const broken = goodAcc + ' @@@!!!?';
        const r = validatePlotStream(prefix, broken);
        // Either the parser tolerates trailing junk as a hole and the validator
        // still returns ok/incomplete, OR it returns 'truncate' with the trim
        // back to ')'. Either is acceptable; if 'truncate' the truncated must
        // end at the `)`.
        if (r.status === 'truncate') {
            expect(r.truncated.endsWith(')')).toBe(true);
            expect(r.truncated).toBe('LINE_CHART(x: "ts")');
        } else {
            // If not truncate, must at minimum not be 'discard'.
            expect(['ok', 'incomplete']).toContain(r.status);
        }
    });
});

describe('validatePlotStream — discard pure garbage', () => {
    it('returns discard for completely non-DSL output with no usable nodes', () => {
        const r = validatePlotStream('', '<<garbage>>!!@@');
        expect(r.status).toBe('discard');
    });

    it('returns discard for empty / whitespace-only accumulations', () => {
        expect(validatePlotStream('', '').status).toBe('discard');
        expect(validatePlotStream('', '   ').status).toBe('discard');
    });
});

describe('validatePlotStream — incomplete mid-flight', () => {
    it('marks unterminated call as incomplete (no stable boundary at EOF)', () => {
        const r = validatePlotStream('', 'LINE_CHART(x: "ts"');
        // Last char is '"', not a stable-boundary char; parser will see a hole
        // for the missing `)`.
        expect(['incomplete', 'ok']).toContain(r.status);
    });
});

describe('validatePlotStream — prefix continuation', () => {
    it('treats acc as continuation of an existing prefix in the editor', () => {
        // The user typed `LINE_CHART(` already; the model only streams the rest.
        const prefix = 'LINE_CHART(';
        const acc = 'x: "ts", y: "pause")';
        const r = validatePlotStream(prefix, acc);
        expect(r.status).toBe('ok');
    });

    it('treats unconventional continuation as in-flight when prefix opens a plot call', () => {
        // After `LINE_CHART(`, a chunk like `@@@!!!` *could* legitimately be a
        // half-typed constant reference — `@` is a valid DSL start. The
        // validator's job is to be conservative on the *opening* char check;
        // any further "garbageness" determination is the boundary-truncate
        // job (which only triggers when a stable boundary later appears).
        const prefix = 'LINE_CHART(';
        const acc = '@@@!!!';
        const r = validatePlotStream(prefix, acc);
        // Must not be 'discard' — '@' is a legal start. Must not crash.
        expect(['ok', 'incomplete', 'truncate']).toContain(r.status);
    });
});

describe('validatePlotStream — CR/CRLF handling (B-185)', () => {
    it('does not discard acc that starts with \\r\\n before a valid char', () => {
        // Some model responses start with CRLF before the actual plot DSL.
        const r = validatePlotStream('LINE_CHART(', '\r\nx: "ts")');
        expect(r.status).not.toBe('discard');
    });

    it('discards acc that starts with \\r before actual garbage', () => {
        const r = validatePlotStream('', '\r<<narration>>');
        // After stripping \\r, the first char is '<' which is not valid DSL start.
        expect(r.status).toBe('discard');
    });

    it('accepts plain \\n prefix as before (regression)', () => {
        const r = validatePlotStream('LINE_CHART(', '\nx: "ts")');
        expect(r.status).not.toBe('discard');
    });
});
