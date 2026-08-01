export interface StarterPrompt { label: string; prompt: string; }

const ALL_STARTERS: Array<{ match: (t: Set<string>) => boolean } & StarterPrompt> = [
    { match: (t) => t.has('garbagecollection') || t.has('gcphasepause'), label: '📈 GC pauses', prompt: 'Show me GC pause time by cause, the longest pauses, and heap usage before and after each collection.' },
    { match: (t) => t.has('executionsample') || t.has('cpuload'), label: '🔥 CPU hotspots', prompt: 'Which methods are consuming the most CPU? Show a top-methods breakdown.' },
    { match: (t) => t.has('objectallocationinnewtlab') || t.has('objectallocationoutsidetlab') || t.has('objectallocationsample'), label: '💾 Allocation hotspots', prompt: 'Show the top allocation sites by class — which code paths are allocating the most heap?' },
    { match: (t) => t.has('javamonitorenter') || t.has('threadpark') || t.has('javasynchronizedmonitorenter'), label: '🔒 Thread contention', prompt: 'Show me the top monitor contention hotspots — which locks are blocking threads the most?' },
    { match: (t) => t.has('fileread') || t.has('filewrite') || t.has('socketread') || t.has('socketwrite'), label: '🌐 I/O latency', prompt: 'Show file and socket I/O latency, the slowest operations, and total blocking time.' },
    { match: (t) => t.has('oldobjectsample'), label: '🔍 Memory leaks', prompt: 'Show long-lived objects by class and which allocation sites created them.' },
    { match: () => true, label: '🔍 What\'s in this recording?', prompt: 'What JFR event types are present? Give me a summary of what analysis is possible.' },
];

/**
 * Data-aware starter prompts — pick up to `limit` based on which JFR tables
 * are present in the schema. Pure helper; exported for tests.
 */
export function getDataAwareStarters(tableNames: Iterable<string>, limit = 4): StarterPrompt[] {
    const names = new Set([...tableNames].map(n => n.toLowerCase()));
    return ALL_STARTERS.filter(s => s.match(names)).slice(0, limit).map(({ label, prompt }) => ({ label, prompt }));
}
