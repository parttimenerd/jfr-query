// SQL DDL that creates all tables the demo notebook needs.
// Runs entirely in-browser via DuckDB-WASM — no JFR file required.
export const DEMO_SETUP_SQL = `
CREATE OR REPLACE TABLE GarbageCollection AS
SELECT
  gcId, name,
  strptime(startTime, '%Y-%m-%d %H:%M:%S.%g')::TIMESTAMPTZ AS startTime,
  duration, sumOfPauses, longestPause, cause
FROM (VALUES
  (1,  'G1GC', '2024-03-15 10:00:01.200', 0.0120, 0.0120, 0.0118, 'G1 Evacuation Pause'),
  (2,  'G1GC', '2024-03-15 10:00:03.450', 0.0085, 0.0085, 0.0083, 'G1 Evacuation Pause'),
  (3,  'G1GC', '2024-03-15 10:00:05.800', 0.0214, 0.0214, 0.0211, 'G1 Humongous Allocation'),
  (4,  'G1GC', '2024-03-15 10:00:08.100', 0.0092, 0.0092, 0.0090, 'G1 Evacuation Pause'),
  (5,  'G1GC', '2024-03-15 10:00:12.600', 0.0156, 0.0156, 0.0154, 'G1 Evacuation Pause'),
  (6,  'G1GC', '2024-03-15 10:00:16.300', 0.1420, 0.1420, 0.1415, 'G1 Concurrent GC'),
  (7,  'G1GC', '2024-03-15 10:00:19.700', 0.0075, 0.0075, 0.0073, 'G1 Evacuation Pause'),
  (8,  'G1GC', '2024-03-15 10:00:23.400', 0.0098, 0.0098, 0.0096, 'G1 Evacuation Pause'),
  (9,  'G1GC', '2024-03-15 10:00:27.800', 0.0183, 0.0183, 0.0180, 'G1 Evacuation Pause'),
  (10, 'G1GC', '2024-03-15 10:00:30.100', 0.0067, 0.0067, 0.0065, 'G1 Evacuation Pause'),
  (11, 'G1GC', '2024-03-15 10:00:34.500', 0.0243, 0.0243, 0.0239, 'G1 Humongous Allocation'),
  (12, 'G1GC', '2024-03-15 10:00:39.200', 0.0089, 0.0089, 0.0087, 'G1 Evacuation Pause'),
  (13, 'G1GC', '2024-03-15 10:00:43.700', 0.1890, 0.1890, 0.1885, 'G1 Concurrent GC'),
  (14, 'G1GC', '2024-03-15 10:00:47.100', 0.0115, 0.0115, 0.0113, 'G1 Evacuation Pause'),
  (15, 'G1GC', '2024-03-15 10:00:51.600', 0.0077, 0.0077, 0.0075, 'G1 Evacuation Pause'),
  (16, 'G1GC', '2024-03-15 10:00:54.300', 0.0201, 0.0201, 0.0198, 'G1 Evacuation Pause'),
  (17, 'G1GC', '2024-03-15 10:00:58.800', 0.0134, 0.0134, 0.0132, 'G1 Evacuation Pause'),
  (18, 'G1GC', '2024-03-15 10:01:02.400', 0.0088, 0.0088, 0.0086, 'G1 Evacuation Pause'),
  (19, 'G1GC', '2024-03-15 10:01:06.900', 0.0311, 0.0311, 0.0307, 'G1 Humongous Allocation'),
  (20, 'G1GC', '2024-03-15 10:01:11.200', 0.2250, 0.2250, 0.2244, 'G1 Concurrent GC')
) t(gcId, name, startTime, duration, sumOfPauses, longestPause, cause);

CREATE OR REPLACE TABLE GCHeapSummary AS
SELECT gcId, "when", heapUsed, heapCommitted FROM (VALUES
  (1,  'Before GC', 524288000,  786432000),
  (1,  'After GC',  314572800,  786432000),
  (2,  'Before GC', 471859200,  786432000),
  (2,  'After GC',  283115520,  786432000),
  (3,  'Before GC', 704643072, 1073741824),
  (3,  'After GC',  335544320, 1073741824),
  (4,  'Before GC', 503316480,  786432000),
  (4,  'After GC',  293601280,  786432000),
  (5,  'Before GC', 565182464,  786432000),
  (5,  'After GC',  304087040,  786432000),
  (6,  'Before GC', 629145600,  786432000),
  (6,  'After GC',  209715200,  786432000),
  (7,  'Before GC', 419430400,  786432000),
  (7,  'After GC',  251658240,  786432000),
  (8,  'Before GC', 482344960,  786432000),
  (8,  'After GC',  272629760,  786432000),
  (9,  'Before GC', 545259520,  786432000),
  (9,  'After GC',  293601280,  786432000),
  (10, 'Before GC', 440401920,  786432000),
  (10, 'After GC',  262144000,  786432000),
  (11, 'Before GC', 713031680, 1073741824),
  (11, 'After GC',  348127232, 1073741824),
  (12, 'Before GC', 503316480,  786432000),
  (12, 'After GC',  283115520,  786432000),
  (13, 'Before GC', 650117120,  786432000),
  (13, 'After GC',  209715200,  786432000),
  (14, 'Before GC', 440401920,  786432000),
  (14, 'After GC',  272629760,  786432000),
  (15, 'Before GC', 482344960,  786432000),
  (15, 'After GC',  262144000,  786432000),
  (16, 'Before GC', 534773760,  786432000),
  (16, 'After GC',  293601280,  786432000),
  (17, 'Before GC', 503316480,  786432000),
  (17, 'After GC',  272629760,  786432000),
  (18, 'Before GC', 471859200,  786432000),
  (18, 'After GC',  251658240,  786432000),
  (19, 'Before GC', 721420288, 1073741824),
  (19, 'After GC',  357564416, 1073741824),
  (20, 'Before GC', 670040064,  786432000),
  (20, 'After GC',  209715200,  786432000)
) t(gcId, "when", heapUsed, heapCommitted);

CREATE OR REPLACE TABLE GCPhasePause AS
SELECT p.gcId, p.name, p.duration, g.startTime FROM (VALUES
  (1,  'Pre Evacuate Collection Set',  0.000180),
  (1,  'Merge Heap Roots',             0.000340),
  (1,  'Evacuate Collection Set',      0.009120),
  (1,  'Post Evacuate Collection Set', 0.001850),
  (1,  'Other',                        0.000710),
  (2,  'Pre Evacuate Collection Set',  0.000150),
  (2,  'Merge Heap Roots',             0.000280),
  (2,  'Evacuate Collection Set',      0.006420),
  (2,  'Post Evacuate Collection Set', 0.001310),
  (2,  'Other',                        0.000540),
  (3,  'Pre Evacuate Collection Set',  0.000620),
  (3,  'Merge Heap Roots',             0.000890),
  (3,  'Evacuate Collection Set',      0.017240),
  (3,  'Post Evacuate Collection Set', 0.002210),
  (3,  'Other',                        0.000940),
  (5,  'Pre Evacuate Collection Set',  0.000210),
  (5,  'Merge Heap Roots',             0.000390),
  (5,  'Evacuate Collection Set',      0.012480),
  (5,  'Post Evacuate Collection Set', 0.001920),
  (5,  'Other',                        0.000800),
  (9,  'Pre Evacuate Collection Set',  0.000280),
  (9,  'Merge Heap Roots',             0.000510),
  (9,  'Evacuate Collection Set',      0.014620),
  (9,  'Post Evacuate Collection Set', 0.002140),
  (9,  'Other',                        0.000850),
  (11, 'Pre Evacuate Collection Set',  0.000710),
  (11, 'Merge Heap Roots',             0.001020),
  (11, 'Evacuate Collection Set',      0.019840),
  (11, 'Post Evacuate Collection Set', 0.002490),
  (11, 'Other',                        0.001140),
  (16, 'Pre Evacuate Collection Set',  0.000350),
  (16, 'Merge Heap Roots',             0.000590),
  (16, 'Evacuate Collection Set',      0.016210),
  (16, 'Post Evacuate Collection Set', 0.002180),
  (16, 'Other',                        0.000870),
  (19, 'Pre Evacuate Collection Set',  0.000820),
  (19, 'Merge Heap Roots',             0.001180),
  (19, 'Evacuate Collection Set',      0.025640),
  (19, 'Post Evacuate Collection Set', 0.002840),
  (19, 'Other',                        0.001330)
) p(gcId, name, duration)
JOIN GarbageCollection g ON p.gcId = g.gcId;

CREATE OR REPLACE TABLE ObjectAllocationSample AS
SELECT
  objectClass,
  weight,
  epoch_ms(1710497200000 + offset_s * 1000)::TIMESTAMPTZ AS startTime,
  thread AS eventThread
FROM (VALUES
  ('byte[]',                           8192,   0, 'main'),
  ('byte[]',                          16384,  30, 'main'),
  ('byte[]',                           4096,  60, 'worker-1'),
  ('char[]',                           2048,  90, 'worker-1'),
  ('char[]',                           4096, 120, 'main'),
  ('java.lang.String',                 1024, 150, 'main'),
  ('java.lang.String',                 2048, 180, 'worker-2'),
  ('java.lang.String',                  512, 210, 'worker-2'),
  ('java.util.HashMap$Node[]',        32768, 240, 'main'),
  ('java.util.HashMap$Node[]',        65536, 270, 'main'),
  ('java.util.HashMap$Node',            256, 300, 'worker-1'),
  ('java.util.ArrayList',               128, 330, 'worker-1'),
  ('java.util.concurrent.ConcurrentHashMap$Node', 512, 360, 'worker-2'),
  ('int[]',                            8192, 390, 'main'),
  ('int[]',                            4096, 420, 'main'),
  ('java.lang.Object[]',               2048, 450, 'worker-1'),
  ('com.example.MyService',             128, 480, 'worker-2'),
  ('com.example.RequestContext',        256, 510, 'main'),
  ('java.nio.HeapByteBuffer',          8192, 540, 'main'),
  ('java.nio.HeapByteBuffer',         16384, 570, 'worker-1'),
  ('sun.nio.cs.UTF_8$Encoder',           64, 600, 'worker-2'),
  ('java.lang.StringBuilder',           256, 630, 'main'),
  ('java.lang.StringBuilder',           128, 660, 'main'),
  ('java.util.LinkedList$Node',          64, 690, 'worker-1'),
  ('com.example.CacheEntry',            512, 720, 'worker-2')
) t(objectClass, weight, offset_s, thread);

CREATE OR REPLACE TABLE HeapSnapshot AS
SELECT
  epoch_ms(1710497200000 + i * 5000)::TIMESTAMPTZ AS startTime,
  CAST(200*1024*1024 + (i % 18)*25*1024*1024 + sin(i*0.4)*10*1024*1024 AS BIGINT) AS heapUsed,
  786432000 AS heapCommitted
FROM range(0, 150) tbl(i);

CREATE OR REPLACE MACRO recording_start() AS (epoch_ms(1710497200000)::TIMESTAMPTZ);
CREATE OR REPLACE MACRO recording_end()   AS (epoch_ms(1710497200000 + 750000)::TIMESTAMPTZ);

CREATE OR REPLACE VIEW "gc-top-pauses" AS
SELECT
  g.gcId                                    AS "GC ID",
  g.cause                                   AS "Cause",
  g.startTime                               AS "Time",
  round(g.longestPause * 1000, 2)           AS "Pause (ms)",
  round(g.sumOfPauses * 1000, 2)            AS "Sum of Pauses (ms)",
  round(before.heapUsed / 1048576.0, 1)    AS "Heap Before (MB)",
  round(after.heapUsed  / 1048576.0, 1)    AS "Heap After (MB)",
  round((before.heapUsed - after.heapUsed) / 1048576.0, 1) AS "Reclaimed (MB)"
FROM GarbageCollection g
LEFT JOIN GCHeapSummary before ON g.gcId = before.gcId AND before."when" = 'Before GC'
LEFT JOIN GCHeapSummary after  ON g.gcId = after.gcId  AND after."when"  = 'After GC'
ORDER BY g.longestPause DESC;

CREATE OR REPLACE VIEW "heap-committed-vs-used" AS
SELECT
  startTime  AS "Time",
  round(heapUsed / 1048576.0, 1)      AS "Used MB",
  round(heapCommitted / 1048576.0, 1) AS "Committed MB"
FROM HeapSnapshot
ORDER BY startTime;

CREATE OR REPLACE VIEW "allocation-rate" AS
SELECT
  epoch_ms(CAST((epoch_ms(startTime) / 30000) AS BIGINT) * 30000)::TIMESTAMPTZ AS "Bucket",
  round(SUM(CAST(weight AS DOUBLE)) / (30.0 * 1024 * 1024), 2) AS "Sample MB/s"
FROM ObjectAllocationSample
GROUP BY 1
ORDER BY 1;

CREATE OR REPLACE VIEW "gc-concurrent-phases-detail" AS
SELECT
  g.gcId     AS "GC ID",
  g.cause    AS "Cause",
  g.startTime AS "Start",
  round(g.duration * 1000, 1) AS "Duration (ms)"
FROM GarbageCollection g
WHERE g.cause LIKE '%Concurrent%'
ORDER BY g.startTime;

CREATE OR REPLACE VIEW "gc-phase-breakdown" AS
SELECT
  p.gcId      AS "GC ID",
  p.name      AS "Phase",
  round(p.duration * 1000, 3) AS "Duration",
  g.startTime AS "Start"
FROM GCPhasePause p
JOIN GarbageCollection g ON p.gcId = g.gcId;
`;
