import { describe, it, expect } from 'vitest';
import { cleanPlotConfig } from '../../services/ml/candidates';

describe('cleanPlotConfig — passthrough cases', () => {
    it('returns a clean plot config unchanged', () => {
        expect(cleanPlotConfig('LINE_CHART(x: "time", y: "cpu")')).toBe('LINE_CHART(x: "time", y: "cpu")');
    });

    it('returns TABLE() for empty string', () => {
        expect(cleanPlotConfig('')).toBe('TABLE()');
    });

    it('returns TABLE() for null/undefined-like falsy input', () => {
        expect(cleanPlotConfig(null as any)).toBe('TABLE()');
    });

    it('returns TABLE() when no plot name found', () => {
        expect(cleanPlotConfig('The model had an error')).toBe('TABLE()');
    });

    it('preserves whitespace in params', () => {
        const cfg = 'BAR_CHART(x: "phase", y: "dur", color: "thread")';
        expect(cleanPlotConfig(cfg)).toBe(cfg);
    });
});

describe('cleanPlotConfig — CoT block removal', () => {
    it('strips <think> … </think> blocks', () => {
        const raw = '<think>Let me think about this. The columns are time and cpu.</think>LINE_CHART(x: "time", y: "cpu")';
        expect(cleanPlotConfig(raw)).toBe('LINE_CHART(x: "time", y: "cpu")');
    });

    it('strips <thinking> … </thinking> blocks', () => {
        const raw = '<thinking>Analyzing columns…</thinking>\nBAR_CHART(x: "phase", y: "dur")';
        expect(cleanPlotConfig(raw)).toBe('BAR_CHART(x: "phase", y: "dur")');
    });

    it('strips unclosed <think> to end of string', () => {
        const raw = '<think>Partial reasoning...LINE_CHART(x: "t", y: "v")';
        expect(cleanPlotConfig(raw)).toBe('TABLE()');
    });

    it('strips CoT before extracting the config', () => {
        const raw = '<think>I should use a bar chart for categories.</think>\nBAR_CHART(x: "cat", y: "count")';
        expect(cleanPlotConfig(raw)).toBe('BAR_CHART(x: "cat", y: "count")');
    });

    it('handles multiline CoT with newlines inside', () => {
        const raw = '<think>\nLine 1\nLine 2\nLine 3\n</think>PIE_CHART(label: "type", value: "n")';
        expect(cleanPlotConfig(raw)).toBe('PIE_CHART(label: "type", value: "n")');
    });
});

describe('cleanPlotConfig — HF special token removal', () => {
    it('strips <pad> tokens', () => {
        expect(cleanPlotConfig('<pad>LINE_CHART(x: "t", y: "v")')).toBe('LINE_CHART(x: "t", y: "v")');
    });

    it('strips </s> end-of-sequence tokens', () => {
        expect(cleanPlotConfig('BAR_CHART(x: "a", y: "b")</s>')).toBe('BAR_CHART(x: "a", y: "b")');
    });

    it('strips <s> start tokens', () => {
        expect(cleanPlotConfig('<s>HISTOGRAM(x: "dur")')).toBe('HISTOGRAM(x: "dur")');
    });

    it('strips <|endoftext|>', () => {
        expect(cleanPlotConfig('BAR_CHART(x: "p", y: "c")<|endoftext|>')).toBe('BAR_CHART(x: "p", y: "c")');
    });

    it('strips <|im_end|>', () => {
        expect(cleanPlotConfig('SCATTER_PLOT(x: "x", y: "y")<|im_end|>')).toBe('SCATTER_PLOT(x: "x", y: "y")');
    });

    it('strips <extra_id_0> tokens (T5 sentinel)', () => {
        expect(cleanPlotConfig('<extra_id_0>TABLE()')).toBe('TABLE()');
    });

    it('strips multiple special tokens', () => {
        expect(cleanPlotConfig('<pad><s>LINE_CHART(x: "t", y: "v")</s>')).toBe('LINE_CHART(x: "t", y: "v")');
    });
});

describe('cleanPlotConfig — markdown code fence stripping', () => {
    it('strips plain triple-backtick fence', () => {
        const raw = '```\nLINE_CHART(x: "t", y: "v")\n```';
        expect(cleanPlotConfig(raw)).toBe('LINE_CHART(x: "t", y: "v")');
    });

    it('strips ```plot language hint', () => {
        const raw = '```plot\nBAR_CHART(x: "a", y: "b")\n```';
        expect(cleanPlotConfig(raw)).toBe('BAR_CHART(x: "a", y: "b")');
    });

    it('strips ```sql language hint', () => {
        const raw = '```sql\nHISTOGRAM(x: "dur")\n```';
        expect(cleanPlotConfig(raw)).toBe('HISTOGRAM(x: "dur")');
    });
});

describe('cleanPlotConfig — quote stripping', () => {
    it('strips wrapping double quotes (when inner content uses single quotes)', () => {
        expect(cleanPlotConfig('"BAR_CHART(x: \'a\', y: \'b\')"')).toBe("BAR_CHART(x: 'a', y: 'b')")
    });

    it('strips wrapping single quotes', () => {
        expect(cleanPlotConfig("'HISTOGRAM(x: \"dur\")'")).toBe('HISTOGRAM(x: "dur")');
    });

    it('strips wrapping backticks', () => {
        expect(cleanPlotConfig('`PIE_CHART(label: "t", value: "n")`')).toBe('PIE_CHART(label: "t", value: "n")');
    });
});

describe('cleanPlotConfig — prose stripping before config', () => {
    it('strips leading prose sentence', () => {
        const raw = 'Sure, here is the config: BAR_CHART(x: "phase", y: "dur")';
        expect(cleanPlotConfig(raw)).toBe('BAR_CHART(x: "phase", y: "dur")');
    });

    it('strips multi-word prefix up to the plot name', () => {
        const raw = 'The best plot for this data is LINE_CHART(x: "time", y: "cpu")';
        expect(cleanPlotConfig(raw)).toBe('LINE_CHART(x: "time", y: "cpu")');
    });

    it('strips newline-separated prose', () => {
        const raw = 'I recommend a histogram.\nHISTOGRAM(x: "dur", bins: 20)';
        expect(cleanPlotConfig(raw)).toBe('HISTOGRAM(x: "dur", bins: 20)');
    });
});

describe('cleanPlotConfig — balanced paren extraction', () => {
    it('truncates trailing prose after balanced close paren', () => {
        const raw = 'BAR_CHART(x: "a", y: "b") This is a chart showing allocation patterns';
        expect(cleanPlotConfig(raw)).toBe('BAR_CHART(x: "a", y: "b")');
    });

    it('handles nested parens in string params correctly', () => {
        const raw = 'LINE_CHART(x: "time(ms)", y: "cpu")';
        expect(cleanPlotConfig(raw)).toBe('LINE_CHART(x: "time(ms)", y: "cpu")');
    });

    it('handles escaped quotes inside string params', () => {
        const raw = 'BAR_CHART(x: "phase \\"A\\"", y: "dur") extra stuff';
        expect(cleanPlotConfig(raw)).toBe('BAR_CHART(x: "phase \\"A\\"", y: "dur")');
    });

    it('returns TABLE() when paren is unclosed', () => {
        // No closing paren at all — extract what's findable, or TABLE()
        const result = cleanPlotConfig('LINE_CHART(x: "time", y: "cpu"');
        // Unclosed — falls back to TABLE()
        expect(result).toBe('TABLE()');
    });
});

describe('cleanPlotConfig — trailing modifier preservation', () => {
    it('preserves TITLE modifier', () => {
        const raw = 'LINE_CHART(x: "t", y: "v") TITLE "CPU over time"';
        expect(cleanPlotConfig(raw)).toBe('LINE_CHART(x: "t", y: "v") TITLE "CPU over time"');
    });

    it('preserves ZOOM modifier', () => {
        const raw = 'BAR_CHART(x: "a", y: "b") ZOOM';
        expect(cleanPlotConfig(raw)).toBe('BAR_CHART(x: "a", y: "b") ZOOM');
    });

    it('preserves AXIS_X modifier', () => {
        const raw = 'LINE_CHART(x: "t", y: "v") AXIS_X FORMAT "%H:%M"';
        expect(cleanPlotConfig(raw)).toBe('LINE_CHART(x: "t", y: "v") AXIS_X FORMAT "%H:%M"');
    });

    it('preserves LEGEND modifier', () => {
        const raw = 'BAR_CHART(x: "a", y: "b") LEGEND TOP';
        expect(cleanPlotConfig(raw)).toBe('BAR_CHART(x: "a", y: "b") LEGEND TOP');
    });

    it('strips trailing prose on newline after closing paren', () => {
        // Only the first line of remainder is checked for modifiers.
        const raw = 'BAR_CHART(x: "a", y: "b")\nThis is a comment about the chart.';
        expect(cleanPlotConfig(raw)).toBe('BAR_CHART(x: "a", y: "b")');
    });
});

describe('cleanPlotConfig — short aliases', () => {
    it('recognises "line" short alias', () => {
        expect(cleanPlotConfig('line(x: "t", y: "v")')).toBe('line(x: "t", y: "v")');
    });

    it('recognises "bar" short alias', () => {
        expect(cleanPlotConfig('bar(x: "a", y: "b")')).toBe('bar(x: "a", y: "b")');
    });

    it('recognises "hist" short alias', () => {
        expect(cleanPlotConfig('hist(x: "dur")')).toBe('hist(x: "dur")');
    });

    it('recognises "tree" short alias (TREEMAP)', () => {
        expect(cleanPlotConfig('tree(label: "cls", value: "n")')).toBe('tree(label: "cls", value: "n")');
    });

    it('recognises "fall" short alias (WATERFALL)', () => {
        expect(cleanPlotConfig('fall(category: "step", value: "delta")')).toBe('fall(category: "step", value: "delta")');
    });

    it('does NOT match "linear" as "line" short alias', () => {
        // word boundary check: "linear" should not trigger "line" match
        expect(cleanPlotConfig('linear regression results')).toBe('TABLE()');
    });

    it('does NOT match "exchange rate" prose as a plot name', () => {
        expect(cleanPlotConfig('exchange rate table')).toBe('TABLE()');
    });
});

describe('cleanPlotConfig — new plot types', () => {
    it('handles TREEMAP config', () => {
        const cfg = 'TREEMAP(label: "objectClass", value: "weight")';
        expect(cleanPlotConfig(cfg)).toBe(cfg);
    });

    it('handles WATERFALL config with optional params', () => {
        const cfg = 'WATERFALL(category: "phase", value: "delta", showValues: true)';
        expect(cleanPlotConfig(cfg)).toBe(cfg);
    });

    it('strips CoT before TREEMAP', () => {
        const raw = '<think>Treemap for object allocation.</think>TREEMAP(label: "cls", value: "n")';
        expect(cleanPlotConfig(raw)).toBe('TREEMAP(label: "cls", value: "n")');
    });
});

describe('cleanPlotConfig — combined/realistic model output scenarios', () => {
    it('handles T5 output: pad + config + eos', () => {
        expect(cleanPlotConfig('<pad>BAR_CHART(x: "phase", y: "dur")</s>')).toBe('BAR_CHART(x: "phase", y: "dur")');
    });

    it('handles Qwen instruct model verbose output', () => {
        const raw = `<|im_start|>assistant
Here is the plot configuration for this data:
\`\`\`
LINE_CHART(x: "startTime", y: "duration", color: "thread")
\`\`\`
<|im_end|>`;
        expect(cleanPlotConfig(raw)).toBe('LINE_CHART(x: "startTime", y: "duration", color: "thread")');
    });

    it('handles DeepSeek-R1 CoT + config', () => {
        const raw = `<think>
The SQL selects gcName and pauseMs from GarbageCollection.
gcName is a category, pauseMs is a numeric value.
A BAR_CHART makes sense here.
</think>
BAR_CHART(x: "gcName", y: "pauseMs")`;
        expect(cleanPlotConfig(raw)).toBe('BAR_CHART(x: "gcName", y: "pauseMs")');
    });

    it('handles flan-t5 plain output with extra whitespace', () => {
        expect(cleanPlotConfig('  HISTOGRAM(x: "dur")  ')).toBe('HISTOGRAM(x: "dur")');
    });

    it('handles FLAMEGRAPH config', () => {
        const cfg = 'FLAMEGRAPH(frame: "method", value: "samples")';
        expect(cleanPlotConfig(cfg)).toBe(cfg);
    });

    it('handles GANTT config', () => {
        const cfg = 'GANTT(label: "thread", start: "startTime", end: "endTime")';
        expect(cleanPlotConfig(cfg)).toBe(cfg);
    });
});
