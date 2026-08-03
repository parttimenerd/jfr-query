import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../context/SettingsContext', () => ({
    SettingsContext: { Consumer: ({ children }: any) => children({}), Provider: ({ children }: any) => children },
    useContext: () => ({}),
}));
vi.mock('../../../services/AiService', () => ({ providerMetadataRegistry: {} }));

import { ganttChartPlot } from '../../../components/plots/GanttChartPlot';

// ── registration ──────────────────────────────────────────────────────────────
describe('ganttChartPlot registration', () => {
    it('has name GANTT', () => expect(ganttChartPlot.name).toBe('GANTT'));

    it('start param is required', () => {
        expect(ganttChartPlot.params.find(p => p.name === 'start')?.required).toBe(true);
    });

    it('end param is required', () => {
        expect(ganttChartPlot.params.find(p => p.name === 'end')?.required).toBe(true);
    });

    it('lane param is required', () => {
        expect(ganttChartPlot.params.find(p => p.name === 'lane')?.required).toBe(true);
    });

    it('color param is optional', () => {
        const p = ganttChartPlot.params.find(p => p.name === 'color');
        expect(p).toBeDefined();
        expect(p?.required).toBeFalsy();
    });

    it('task param is optional', () => {
        const p = ganttChartPlot.params.find(p => p.name === 'task');
        expect(p).toBeDefined();
        expect(p?.required).toBeFalsy();
    });

    it('row is a deprecated alias for lane', () => {
        const p = ganttChartPlot.params.find(p => p.name === 'row');
        expect(p?.aliasFor).toBe('lane');
        expect(p?.deprecated).toBe(true);
    });

    it('label is a deprecated alias for task', () => {
        const p = ganttChartPlot.params.find(p => p.name === 'label');
        expect(p?.aliasFor).toBe('task');
        expect(p?.deprecated).toBe(true);
    });

    it('template covers all required params', () => {
        expect(ganttChartPlot.template).toContain('start:');
        expect(ganttChartPlot.template).toContain('end:');
        expect(ganttChartPlot.template).toContain('lane:');
    });

    it('has at least two examples', () => {
        expect(ganttChartPlot.examples.length).toBeGreaterThanOrEqual(2);
    });
});

// ── parseConfig ───────────────────────────────────────────────────────────────
describe('ganttChartPlot parseConfig', () => {
    it('parses required start, end, lane', () => {
        const cfg = ganttChartPlot.parseConfig(
            'GANTT(start: "startTime", end: "endTime", lane: "phase")', []);
        expect(cfg.start).toBe('startTime');
        expect(cfg.end).toBe('endTime');
        expect(cfg.lane).toBe('phase');
    });

    it('parses optional color column', () => {
        const cfg = ganttChartPlot.parseConfig(
            'GANTT(start: "s", end: "e", lane: "l", color: "state")', []);
        expect(cfg.color).toBe('state');
    });

    it('parses optional task column', () => {
        const cfg = ganttChartPlot.parseConfig(
            'GANTT(start: "s", end: "e", lane: "l", task: "phase")', []);
        expect(cfg.task).toBe('phase');
    });

    it('deprecated row alias resolves to lane', () => {
        const cfg = ganttChartPlot.parseConfig(
            'GANTT(start: "s", end: "e", row: "thread")', []);
        expect(cfg.lane).toBe('thread');
    });

    it('deprecated label alias resolves to task', () => {
        const cfg = ganttChartPlot.parseConfig(
            'GANTT(start: "s", end: "e", lane: "l", label: "desc")', []);
        expect(cfg.task).toBe('desc');
    });

    it('full config round-trip', () => {
        const cfg = ganttChartPlot.parseConfig(
            'GANTT(start: "startTime", end: "endTime", lane: "thread", task: "phase", color: "state")', []);
        expect(cfg).toMatchObject({
            start: 'startTime',
            end: 'endTime',
            lane: 'thread',
            task: 'phase',
            color: 'state',
        });
    });
});
