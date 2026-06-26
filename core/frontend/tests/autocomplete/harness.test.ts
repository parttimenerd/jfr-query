// I0 — autocomplete eval harness driver. Reports tier pass-rates; fails
// when total pass-rate falls below the documented baseline. Update the
// baseline as iterations land.

import { describe, it, expect } from 'vitest';
import { runHarness, formatReport } from './harness';
import { sqlCases } from './cases/sql.cases';
import { plotCases } from './cases/plot.cases';

// Baseline is bumped as each iteration completes. I0: harness exists, but
// the SQL-subquery and plot-composite tiers are mostly red — that's I1+I2.
// The baseline is intentionally low so we can iterate.
const TOTAL_PASS_RATE_FLOOR = 1.0;
const TIER_FLOORS: Record<string, number> = {
    'sql-basic': 1.0,
    'sql-subquery': 1.0,
    'sql-context': 1.0,
    'plot-toplevel': 1.0,
    'plot-body': 1.0,
    'plot-clause': 1.0,
    'plot-composite': 1.0,
    'plot-fuzzy': 1.0,
    'plot-link': 1.0,
    'plot-onarg': 1.0,
    'plot-variables': 1.0,
};

describe('I0 — autocomplete harness', () => {
    it('SQL case set has at least 30 cases across multiple tiers', () => {
        expect(sqlCases.length).toBeGreaterThanOrEqual(28);
        const tiers = new Set(sqlCases.map(c => c.tier));
        expect(tiers.size).toBeGreaterThanOrEqual(3);
    });

    it('Plot case set has at least 28 cases across multiple tiers', () => {
        expect(plotCases.length).toBeGreaterThanOrEqual(28);
        const tiers = new Set(plotCases.map(c => c.tier));
        expect(tiers.size).toBeGreaterThanOrEqual(5);
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
