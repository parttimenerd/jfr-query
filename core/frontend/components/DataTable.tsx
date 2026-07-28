import React, { useState, useMemo, useContext, useCallback, useRef, useEffect } from 'react';
import { ChevronDownIcon } from './icons/ChevronDownIcon';
import { ChevronUpIcon } from './icons/ChevronUpIcon';
import { SearchIcon } from './icons/SearchIcon';
import { useDisplaySettings } from '../context/DisplaySettingsContext';
import { formatTimestamp as formatTimestampUtil } from '../utils/timeFormatter';
import { formatNumber } from '../utils/numberFormatter';
import {
    isDurationLike,
    isByteLike,
    formatBytes,
    parseIntervalToSeconds,
    compareValues,
    csvValue,
} from '../utils/dataTableUtils';

// ─── Duration formatting ─────────────────────────────────────────────────────

const formatDuration = (seconds: number): string => {
    if (seconds === 0) return '0 ms';
    const absS = Math.abs(seconds);
    const sign = seconds < 0 ? '-' : '';
    if (absS < 0.001) return `${sign}${(absS * 1_000_000).toFixed(1)} µs`;
    if (absS < 1)     return `${sign}${(absS * 1_000).toFixed(2).replace(/\.?0+$/, '')} ms`;
    if (absS < 60)    return `${sign}${absS.toFixed(3).replace(/\.?0+$/, '')} s`;
    const m = Math.floor(absS / 60);
    const s = absS - m * 60;
    const sStr = s.toFixed(1).replace(/\.0$/, '');
    if (absS < 3600)  return `${sign}${m}m ${sStr}s`;
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return `${sign}${h}h ${rem}m`;
};

// ─── Timestamp detection ─────────────────────────────────────────────────────

const isTimestampLike = (key: string, sample: any): boolean => {
    if (!sample || typeof sample[key] === 'undefined' || sample[key] === null) {
        return false;
    }

    const value = sample[key];
    const keyLower = key.toLowerCase();

    const negativeKeywords = ['duration', 'pause', 'length', 'period', 'age', 'count'];
    if (negativeKeywords.some(keyword => keyLower.includes(keyword))) {
        return false;
    }

    if (typeof value === 'string' && value.match(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/)) {
        return true;
    }

    if (typeof value === 'number' || typeof value === 'bigint' || (typeof value === 'string' && /^\d+$/.test(value))) {
        const numValue = Number(value);
        const MIN_EPOCH_MS = 1_000_000_000_000;
        if (numValue > MIN_EPOCH_MS) {
            const positiveKeywords = ['time', 'date', 'timestamp', 'start', 'end', 'begin', 'finish', 'at', 'since', 'bucket', 'when', 'ts'];
            return positiveKeywords.some(keyword => keyLower.includes(keyword));
        }
    }

    return false;
};

const isNumericLike = (key: string, sample: any, isTimestamp: boolean): boolean => {
    if (isTimestamp) return false;
    if (!sample || typeof sample[key] === 'undefined') return false;
    const value = sample[key];
    return typeof value === 'number' || typeof value === 'bigint';
};

// ─── CSV export ──────────────────────────────────────────────────────────────

const exportToCsv = (headers: string[], rows: any[], filename: string) => {
    const escape = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const lines = [
        headers.map(escape).join(','),
        ...rows.map(r => headers.map(h => escape(csvValue(r[h]))).join(',')),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 100);
};

// ─── Component ───────────────────────────────────────────────────────────────

interface DataTableProps {
    data: any[];
    showSearch?: boolean;
    headers?: string[];
    columnWidths?: (string | number | undefined)[];
    csvFilename?: string;
}

const DataTable: React.FC<DataTableProps> = ({ data, showSearch = true, headers, columnWidths, csvFilename = 'data.csv' }) => {
  const displaySettings = useDisplaySettings();
  const [sortConfig, setSortConfig] = useState<{ key: string | null; direction: 'ascending' | 'descending' }>({ key: null, direction: 'ascending' });
  const [filterTerm, setFilterTerm] = useState('');
  const [debouncedFilter, setDebouncedFilter] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedFilter(filterTerm), 150);
    return () => clearTimeout(t);
  }, [filterTerm]);
  const [widths, setWidths] = useState<(string | number | undefined)[]>([]);
  const resizingColumn = useRef<{index: number; startX: number; startWidth: number} | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const globalMoveListenerRef = useRef<((e: MouseEvent) => void) | null>(null);
  const globalUpListenerRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      if (globalMoveListenerRef.current) window.removeEventListener('mousemove', globalMoveListenerRef.current);
      if (globalUpListenerRef.current) window.removeEventListener('mouseup', globalUpListenerRef.current);
    };
  }, []);

  const dataHeaders = useMemo(() => (headers || (data[0] ? Object.keys(data[0]) : [])), [data, headers]);
  const sample = data[0];
  const timestampColumns = useMemo(() => new Set(dataHeaders.filter(h => isTimestampLike(h, sample))), [dataHeaders, sample]);
  const durationColumns  = useMemo(() => new Set(dataHeaders.filter(h => !timestampColumns.has(h) && isDurationLike(h, sample))), [dataHeaders, sample, timestampColumns]);
  const byteColumns      = useMemo(() => new Set(dataHeaders.filter(h => !timestampColumns.has(h) && !durationColumns.has(h) && isByteLike(h, sample))), [dataHeaders, sample, timestampColumns, durationColumns]);
  const numericColumns   = useMemo(() => new Set(dataHeaders.filter(h => isNumericLike(h, sample, timestampColumns.has(h)))), [dataHeaders, sample, timestampColumns]);

  const finalHeaders = dataHeaders;

  useEffect(() => {
    setWidths(columnWidths || []);
  }, [columnWidths]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (resizingColumn.current !== null) {
      const { index, startX, startWidth } = resizingColumn.current;
      const newWidth = startWidth + (e.clientX - startX);
      setWidths(prev => {
          const newWidths = [...prev];
          newWidths[index] = Math.max(newWidth, 50);
          return newWidths;
      });
    }
  }, []);

  const handleMouseUp = useCallback(() => { resizingColumn.current = null; }, []);

  const handleMouseDown = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault();
    // Remove any stale listeners from a previous drag that ended without mouseup
    if (globalMoveListenerRef.current) {
      window.removeEventListener('mousemove', globalMoveListenerRef.current);
      globalMoveListenerRef.current = null;
    }
    if (globalUpListenerRef.current) {
      window.removeEventListener('mouseup', globalUpListenerRef.current);
      globalUpListenerRef.current = null;
    }
    const ths = tableRef.current?.querySelectorAll('thead th');
    if (!ths) return;
    const currentPixelWidths = Array.from(ths).map(th => (th as HTMLElement).offsetWidth);
    setWidths(currentPixelWidths);
    if (index < 0 || index >= currentPixelWidths.length) return;
    resizingColumn.current = { index, startX: e.clientX, startWidth: currentPixelWidths[index] };
    const handleGlobalMouseMove = (event: MouseEvent) => handleMouseMove(event);
    const handleGlobalMouseUp = () => {
      handleMouseUp();
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      globalMoveListenerRef.current = null;
      globalUpListenerRef.current = null;
    };
    globalMoveListenerRef.current = handleGlobalMouseMove;
    globalUpListenerRef.current = handleGlobalMouseUp;
    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
  }, [handleMouseMove, handleMouseUp]);

  const requestSort = (key: string) => setSortConfig(c => c.key === key ? { key, direction: c.direction === 'ascending' ? 'descending' : 'ascending' } : { key, direction: 'ascending' });

  const formatCell = useCallback((value: any, header: string): string => {
    if (value === null || value === undefined) return '';
    if (timestampColumns.has(header)) return formatTimestampUtil(value, displaySettings.timeFormat);
    if (durationColumns.has(header)) {
        const secs = parseIntervalToSeconds(value);
        if (secs !== null) return formatDuration(secs);
        // Numeric duration — infer unit from column name suffix.
        if (typeof value === 'number' || typeof value === 'bigint') {
            const lc = header.toLowerCase();
            // Match trailing unit: bare suffix (_ms), parenthesised (ms), or bracketed [ms]
            const unitMatch = lc.match(/[\s_([](ns|µs|us|ms|sec(?:onds?)?|s)\s*[)\]]?\s*$/);
            const unit = unitMatch ? unitMatch[1] : '';
            let divisor: number;
            if (unit === 'ns') divisor = 1_000_000_000;
            else if (unit === 'ms') divisor = 1_000;
            else if (unit === 's' || unit === 'sec' || unit === 'secs' || unit === 'second' || unit === 'seconds') divisor = 1;
            else {
                // No explicit unit suffix. Values < 1000 are almost certainly already in
                // seconds (e.g. JFR stores duration/sumOfPauses/longestPause as seconds).
                // Larger integers are assumed to be microseconds (profiler convention).
                divisor = Number(value) < 1000 ? 1 : 1_000_000;
            }
            return formatDuration(Number(value) / divisor);
        }
    }
    if (byteColumns.has(header))      return formatBytes(Number(value));
    if (numericColumns.has(header))   return formatNumber(value, displaySettings.decimalPlaces);
    return String(value);
  }, [timestampColumns, durationColumns, byteColumns, numericColumns, displaySettings]);

  // Pre-compute a single lowercase search string per row. Computed once per data
  // change; filter memo below just does an indexOf per row instead of N string coercions.
  const searchStrings = useMemo(
    () => data.map(r => Object.values(r).join('\0').toLowerCase()),
    [data],
  );

  const processedData = useMemo(() => {
    const needle = debouncedFilter.toLowerCase();
    let filtered = needle ? data.filter((_, i) => searchStrings[i].includes(needle)) : data;
    if (sortConfig.key) {
      const { key, direction } = sortConfig;
      const asc = direction === 'ascending';
      filtered = filtered.slice().sort((a, b) => compareValues(a[key], b[key], asc));
    }
    return filtered;
  }, [data, searchStrings, debouncedFilter, sortConfig]);

  // B-051: cap rendered rows to avoid rendering 100k+ DOM nodes.
  const DISPLAY_CAP = 2000;
  const PAGE_SIZE = 5000;
  const [displayLimit, setDisplayLimit] = useState(DISPLAY_CAP);
  const displayData = processedData.slice(0, displayLimit);
  const isCapped = displayLimit < processedData.length;
  // Reset display limit when underlying data or filter changes.
  useEffect(() => { setDisplayLimit(DISPLAY_CAP); }, [data, debouncedFilter]);

  if (!data || data.length === 0) return <div className="text-center text-gray-500 p-8">No data to display.</div>;

  const totalRows = data.length;
  const shownRows = processedData.length;
  const rowCountLabel = debouncedFilter && shownRows !== totalRows
    ? `${shownRows.toLocaleString()} of ${totalRows.toLocaleString()} rows`
    : `${totalRows.toLocaleString()} ${totalRows === 1 ? 'row' : 'rows'}`;
  // Hint when the result looks like it was auto-truncated at the safety cap.
  const looksAutoTruncated = totalRows === 50_000;

  return (
    <div className="flex flex-col h-full bg-gray-800">
      {showSearch && (
        <div className="px-4 py-2 flex-shrink-0 flex items-center gap-2">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500"/>
            <input type="text" placeholder="Search..." value={filterTerm} onChange={e=>setFilterTerm(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); setFilterTerm(''); } }}
              className="w-full bg-gray-900/50 border border-gray-700 rounded-md py-1.5 pl-9 pr-3 text-sm"/>
          </div>
          <span
            className="text-xs text-gray-500 whitespace-nowrap"
            title={looksAutoTruncated ? 'Result capped at 50,000 rows to prevent browser OOM. Add LIMIT to your query or append -- no-limit to bypass.' : undefined}
          >{rowCountLabel}{looksAutoTruncated ? ' ⚠' : ''}</span>
          <button
            onClick={() => exportToCsv(finalHeaders, processedData, csvFilename)}
            title="Export to CSV"
            className="flex-shrink-0 px-2 py-1.5 text-xs rounded-md bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white transition-colors"
          >
            CSV ↓
          </button>
        </div>
      )}
      <div className="overflow-auto flex-grow">
        <table ref={tableRef} className="w-full text-sm" style={{tableLayout:widths.length>0?'fixed':'auto'}}>
          <thead className="sticky top-0 bg-gray-700 z-10">
            <tr>
              {finalHeaders.map((h,i) => {
                const isNumeric = numericColumns.has(h);
                return (
                  <th key={h} className={`p-2 font-medium whitespace-nowrap overflow-hidden text-ellipsis relative ${isNumeric ?'text-right':'text-left'}`} style={{width: widths[i]}}>
                    <>
                      <button onClick={()=>requestSort(h)} className="inline-flex items-center gap-1.5">
                        {h}
                        {durationColumns.has(h) && <span className="text-[10px] text-gray-500 font-normal">⏱</span>}
                        {byteColumns.has(h) && <span className="text-[10px] text-gray-500 font-normal">💾</span>}
                        {sortConfig.key===h&&(sortConfig.direction==='ascending'?<ChevronUpIcon className="w-3 h-3"/>:<ChevronDownIcon className="w-3 h-3"/>)}
                      </button>
                      <div onMouseDown={e=>handleMouseDown(i,e)} className="resize-handle"/>
                    </>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {displayData.map((row,i) => {
              const key = finalHeaders.length > 0 ? `${i}-${String(row[finalHeaders[0]])}` : i;
              return (
              <tr key={key} className="hover:bg-gray-700/50">
                {finalHeaders.map((h,j) => (
                  <td key={h} className={`p-2 font-mono whitespace-nowrap overflow-hidden text-ellipsis ${numericColumns.has(h)?'text-right':'text-left'}`} style={{width: widths[j]}} title={String(row[h])}>{formatCell(row[h],h)}</td>
                ))}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {isCapped && (
        <div className="flex-shrink-0 px-4 py-2 border-t border-gray-700 flex items-center justify-between text-xs text-gray-400">
          <span>Showing {displayLimit.toLocaleString()} of {processedData.length.toLocaleString()} rows</span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setDisplayLimit(l => Math.min(l + PAGE_SIZE, processedData.length))}
              className="text-cyan-400 hover:text-cyan-300 underline"
            >
              Show {Math.min(PAGE_SIZE, processedData.length - displayLimit).toLocaleString()} more
            </button>
            {processedData.length - displayLimit > PAGE_SIZE && (
              <button
                onClick={() => setDisplayLimit(processedData.length)}
                className="text-gray-500 hover:text-gray-300 underline"
              >
                Show all {processedData.length.toLocaleString()}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default React.memo(DataTable);
