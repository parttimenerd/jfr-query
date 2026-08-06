export type GCCollector = 'G1' | 'ZGC' | 'Shenandoah' | 'SerialParallel' | 'unknown';

/**
 * Detect which GC collector generated the loaded JFR data by checking which
 * collector-specific event tables exist in DuckDB.
 */
export async function detectGCCollector(
    query: (sql: string) => Promise<any[]>
): Promise<GCCollector> {
    try {
        const rows = await query(
            `SELECT table_name FROM information_schema.tables
             WHERE table_schema = 'main'
               AND table_name IN (
                 'G1GarbageCollection',
                 'G1EvacuationOldStatistics',
                 'G1EvacuationYoungStatistics',
                 'ZGCGarbageCollection',
                 'ZGCPhaseStatistics',
                 'ShenandoahHeapRegionInformation',
                 'GarbageCollection'
               )`
        );
        const names = new Set(rows.map((r: any) => r.table_name as string));
        if (names.has('ZGCGarbageCollection') || names.has('ZGCPhaseStatistics')) return 'ZGC';
        if (names.has('ShenandoahHeapRegionInformation')) return 'Shenandoah';
        if (names.has('G1GarbageCollection') || names.has('G1EvacuationOldStatistics') || names.has('G1EvacuationYoungStatistics')) return 'G1';
        if (names.has('GarbageCollection')) return 'SerialParallel';
        return 'unknown';
    } catch {
        return 'unknown';
    }
}

export function collectorToTemplate(collector: GCCollector): { templateName: string; label: string } | null {
    switch (collector) {
        case 'ZGC':          return { templateName: 'zgc-analysis',  label: 'ZGC Analysis' };
        case 'G1':           return { templateName: 'gc-analysis',   label: 'GC Analysis' };
        case 'Shenandoah':   return { templateName: 'gc-analysis',   label: 'GC Analysis' };
        case 'SerialParallel': return { templateName: 'gc-analysis', label: 'GC Analysis' };
        default:             return null;
    }
}

export function collectorLabel(collector: GCCollector): string {
    switch (collector) {
        case 'G1':           return 'G1GC';
        case 'ZGC':          return 'ZGC';
        case 'Shenandoah':   return 'Shenandoah GC';
        case 'SerialParallel': return 'Serial/Parallel GC';
        default:             return 'Unknown GC';
    }
}
