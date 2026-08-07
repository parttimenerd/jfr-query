/**
 * Parser for OpenJDK Xlog gc+ergo log files.
 *
 * Log line format (all variants):
 *   [<uptime>s][<level>][<tag>] [GC(<id>)] <message>
 *   [<uptime>s][<level>][<tag>] <message>        (no GC ID — pre-GC events)
 *
 * Levels: debug, info, warning
 * Tags:   gc,ergo  /  gc,ergo,heap  /  gc,ergo,ihop  /  gc,ergo,cset  /  gc,ergo,refine
 */
export interface GCErgoRow {
  uptime_s: number;
  level: string;
  tag: string;
  gc_id: number | null;
  message: string;
}

// Matches:  [0.325s][debug][gc,ergo,heap  ] GC(1) Heap expansion: ...
// or:       [0.325s][debug][gc,ergo,heap] Heap expansion: ...
// Level bracket may contain trailing whitespace: [info ]
const LINE_RE =
  /^\[(\d+\.\d+)s\]\[([^\]]+)\]\[([^\]]+)\]\s*(?:GC\((\d+)\)\s+)?(.*)/;

export function parseGcErgoLog(text: string): GCErgoRow[] {
  const rows: GCErgoRow[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = LINE_RE.exec(line);
    if (!m) continue;
    const tag = m[3].trim();
    // Only include gc,ergo* lines
    if (!tag.startsWith('gc,ergo')) continue;
    rows.push({
      uptime_s: parseFloat(m[1]),
      level: m[2].trim(),
      tag,
      gc_id: m[4] != null ? parseInt(m[4], 10) : null,
      message: m[5].trim(),
    });
  }
  return rows;
}
