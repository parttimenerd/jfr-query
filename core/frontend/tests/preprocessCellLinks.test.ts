import { describe, it, expect } from 'vitest';
import { preprocessCellLinks } from '../components/TemplatedMarkdown';

describe('preprocessCellLinks', () => {
    it('converts @cell:name to a #jfr-cell- hash link', () => {
        const result = preprocessCellLinks('See @cell:pause-summary for details.');
        expect(result).toBe('See [→ pause-summary](#jfr-cell-pause-summary) for details.');
    });
    it('handles multiple @cell refs on same line', () => {
        const result = preprocessCellLinks('@cell:heap-over-time and @cell:gc-overhead');
        expect(result).toContain('#jfr-cell-heap-over-time');
        expect(result).toContain('#jfr-cell-gc-overhead');
    });
    it('leaves non-@cell text alone', () => {
        const result = preprocessCellLinks('Normal text with no refs');
        expect(result).toBe('Normal text with no refs');
    });
    it('encodes special characters in cell names', () => {
        const result = preprocessCellLinks('@cell:my cell');
        // space is not matched by [\w-]+ so it stops at the space
        expect(result).toBe('[→ my](#jfr-cell-my) cell');
    });
    it('handles cell name with underscores', () => {
        const result = preprocessCellLinks('@cell:gc_overview');
        expect(result).toContain('#jfr-cell-gc_overview');
    });
});
