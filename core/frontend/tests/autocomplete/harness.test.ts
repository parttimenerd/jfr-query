// I0 — autocomplete eval harness driver. Reports tier pass-rates; fails
// when total pass-rate falls below the documented baseline. Update the
// baseline as iterations land.

import { describe, it, expect } from 'vitest';
import { runHarness, formatReport } from './harness';
import { sqlCases } from './cases/sql.cases';
import { plotCases } from './cases/plot.cases';

// Baseline is bumped as each iteration completes.
const TOTAL_PASS_RATE_FLOOR = 1.0;
const TIER_FLOORS: Record<string, number> = {
    'sql-basic': 1.0,
    'sql-subquery': 1.0,
    'sql-context': 1.0,
    'sql-edge': 1.0,
    'sql-view': 1.0,
    'sql-macro': 1.0,
    'sql-window': 1.0,
    'sql-complex': 1.0,
    'sql-views': 1.0,
    'sql-value-pos': 1.0,
    'plot-toplevel': 1.0,
    'plot-body': 1.0,
    'plot-clause': 1.0,
    'plot-composite': 1.0,
    'plot-fuzzy': 1.0,
    'plot-link': 1.0,
    'plot-onarg': 1.0,
    'plot-variables': 1.0,
    'plot-edge': 1.0,
    'plot-options': 1.0,
    'plot-tail-complex': 1.0,
    'plot-scope-workflow': 1.0,
};

describe('I0 — autocomplete harness', () => {
    it('SQL case set has at least 50 cases across 7+ tiers', () => {
        expect(sqlCases.length).toBeGreaterThanOrEqual(50);
        const tiers = new Set(sqlCases.map(c => c.tier));
        expect(tiers.size).toBeGreaterThanOrEqual(7);
    });

    it('Plot case set has at least 55 cases across 10+ tiers', () => {
        expect(plotCases.length).toBeGreaterThanOrEqual(55);
        const tiers = new Set(plotCases.map(c => c.tier));
        expect(tiers.size).toBeGreaterThanOrEqual(10);
    });

    it('runs the full harness and reports a tier breakdown', () => {
        const cases = [...sqlCases, ...plotCases];
        const report = runHarness(cases);

        const out = formatReport(report);
        // Print breakdown so vitest captures it in --reporter=verbose.
        // eslint-disable-next-line no-console
        console.log(out);

        expect(report.total).toBe(cases.length);
        expect(report.passRate).toBeGreaterThanOrEqual(TOTAL_PASS_RATE_FLOOR);

        for (const [tier, floor] of Object.entries(TIER_FLOORS)) {
            const t = report.byTier[tier];
            if (!t) continue;
            expect(t.passRate, `${tier} below floor`).toBeGreaterThanOrEqual(floor);
        }
    });

    it('harness runs in under 10 seconds', () => {
        const start = Date.now();
        runHarness([...sqlCases, ...plotCases]);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(10000);
    });
});
