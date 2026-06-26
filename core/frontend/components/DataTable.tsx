import React, { useState, useMemo, useContext, useCallback, useRef, useEffect } from 'react';
import { ChevronDownIcon } from './icons/ChevronDownIcon';
import { ChevronUpIcon } from './icons/ChevronUpIcon';
import { SearchIcon } from './icons/SearchIcon';
import { useDisplaySettings } from '../context/DisplaySettingsContext';
import { formatTimestamp as formatTimestampUtil } from '../utils/timeFormatter';
import { formatNumber } from '../utils/numberFormatter';

// ─── Duration detection + formatting ────────────────────────────────────────

const DURATION_KEYWORDS = ['duration', 'pause', 'latency', 'elapsed', 'time', 'period', 'age', 'length', 'wait', 'delay'];

// DuckDB interval arrays: [microseconds, days, months, ?] — first element is µs.
const INTERVAL_RE = /^(-?\d+),(-?\d+),(-?\d+)(?:,(-?\d+))?$/;

const parseIntervalToSeconds = (value: any): number | null => {
    if (Array.isArray(value)) {
        const µs = Number(value[0]);
        return isNaN(µs) ? null : µs / 1_000_000;
    }
    if (typeof value === 'string') {
        const m = INTERVAL_RE.exec(value);
        if (!m) return null;
        return Number(m[1]) / 1_000_000;
    }
    return null;
};

const isIntervalLike = (value: any): boolean => {
    if (Array.isArray(value) && value.length >= 3) return true;
    if (typeof value === 'string' && INTERVAL_RE.test(value)) return true;
    return false;
};

const isDurationLike = (key: string, sample: any): boolean => {
    if (!sample || sample[key] === undefined || sample[key] === null) return false;
    const value = sample[key];
    const lc = key.toLowerCase();
    if (!DURATION_KEYWORDS.some(kw => lc.includes(kw))) return false;
    if (isIntervalLike(value)) return true;
    if (typeof value !== 'number' && typeof value !== 'bigint') return false;
    const num = Number(value);
    // Exclude timestamps (large epoch values) and negative values.
    if (num < 0 || num > 1e9) return false;
    return true;
};

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
            const positiveKeywords = ['time', 'date', 'timestamp', 'start', 'end', 'begin', 'finish', 'at', 'since'];
            return positiveKeywords.some(keyword => keyLower.includes(keyword));
        }
    }

    return false;
};

const isNumericLike = (key: string, sample: any, isTimestamp: boolean): boolean => {
    if (isTimestamp) return true;
    if (!sample || typeof sample[key] === 'undefined') return false;
    const value = sample[key];
    return typeof value === 'number' || typeof value === 'bigint';
};

// ─── CSV export ──────────────────────────────────────────────────────────────

const exportToCsv = (headers: string[], rows: any[], formatCell: (v: any, h: string) => string) => {
    const escape = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const lines = [
        headers.map(escape).join(','),
        ...rows.map(r => headers.map(h => escape(String(formatCell(r[h], h)))).join(',')),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'data.csv';
    a.click();
    URL.revokeObjectURL(url);
};

// ─── Component ───────────────────────────────────────────────────────────────

interface DataTableProps {
    data: any[];
    showSearch?: boolean;
    headers?: string[];
    columnWidths?: (string | number | undefined)[];
}

const DataTable: React.FC<DataTableProps> = ({ data, showSearch = true, headers, columnWidths }) => {
  const displaySettings = useDisplaySettings();
  const [sortConfig, setSortConfig] = useState<{ key: string | null; direction: 'ascending' | 'descending' }>({ key: null, direction: 'ascending' });
  const [filterTerm, setFilterTerm] = useState('');
  const [widths, setWidths] = useState<(string | number | undefined)[]>([]);
  const resizingColumn = useRef<{index: number; startX: number; startWidth: number} | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  const dataHeaders = useMemo(() => (headers || (data[0] ? Object.keys(data[0]) : [])), [data, headers]);
  const sample = data[0];
  const timestampColumns = useMemo(() => new Set(dataHeaders.filter(h => isTimestampLike(h, sample))), [dataHeaders, sample]);
  const durationColumns  = useMemo(() => new Set(dataHeaders.filter(h => !timestampColumns.has(h) && isDurationLike(h, sample))), [dataHeaders, sample, timestampColumns]);
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
    const ths = tableRef.current?.querySelectorAll('thead th');
    if (!ths) return;
    const currentPixelWidths = Array.from(ths).map(th => (th as HTMLElement).offsetWidth);
    setWidths(currentPixelWidths);
    resizingColumn.current = { index, startX: e.clientX, startWidth: currentPixelWidths[index] };
    const handleGlobalMouseMove = (event: MouseEvent) => handleMouseMove(event);
    const handleGlobalMouseUp = () => {
      handleMouseUp();
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
  }, [handleMouseMove, handleMouseUp]);

  const requestSort = (key: string) => setSortConfig(c => c.key===key ? (c.direction==='ascending' ? {key,direction:'descending'} : {key:null,direction:'ascending'}) : {key,direction:'ascending'});

  const formatCell = useCallback((value: any, header: string): string => {
    if (value === null || value === undefined) return '';
    if (timestampColumns.has(header)) return formatTimestampUtil(value, displaySettings.timeFormat);
    if (durationColumns.has(header)) {
        const secs = isIntervalLike(value) ? parseIntervalToSeconds(value) : Number(value);
        return formatDuration(secs ?? Number(value));
    }
    if (numericColumns.has(header))   return formatNumber(value, displaySettings.decimalPlaces);
    return String(value);
  }, [timestampColumns, durationColumns, numericColumns, displaySettings]);

  const processedData = useMemo(() => {
    let filtered = filterTerm ? data.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(filterTerm.toLowerCase()))) : [...data];
    if (sortConfig.key) {
      const { key, direction } = sortConfig;
      filtered.sort((a, b) => {
        const asc = direction === 'ascending' ? 1 : -1;
        if(a[key]==null && b[key]==null) return 0;
        if(a[key]==null) return 1; if(b[key]==null) return -1;
        if (typeof a[key] === 'number' && typeof b[key] === 'number') return (a[key]-b[key])*asc;
        return String(a[key]).localeCompare(String(b[key]))*asc;
      });
    }
    return filtered;
  }, [data, filterTerm, sortConfig]);

  if (!data || data.length === 0) return <div className="text-center text-gray-500 p-8">No data to display.</div>;

  const totalRows = data.length;
  const shownRows = processedData.length;
  const rowCountLabel = filterTerm && shownRows !== totalRows
    ? `${shownRows.toLocaleString()} of ${totalRows.toLocaleString()} rows`
    : `${totalRows.toLocaleString()} ${totalRows === 1 ? 'row' : 'rows'}`;

  return (
    <div className="flex flex-col h-full bg-gray-800">
      {showSearch && (
        <div className="px-4 py-2 flex-shrink-0 flex items-center gap-2">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500"/>
            <input type="text" placeholder="Search..." value={filterTerm} onChange={e=>setFilterTerm(e.target.value)} className="w-full bg-gray-900/50 border border-gray-700 rounded-md py-1.5 pl-9 pr-3 text-sm"/>
          </div>
          <span className="text-xs text-gray-500 whitespace-nowrap">{rowCountLabel}</span>
          <button
            onClick={() => exportToCsv(finalHeaders, processedData, formatCell)}
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
            {processedData.map((row,i) => (
              <tr key={i} className="hover:bg-gray-700/50">
                {finalHeaders.map((h,j) => (
                  <td key={h} className={`p-2 font-mono whitespace-nowrap overflow-hidden text-ellipsis ${numericColumns.has(h)?'text-right':'text-left'}`} style={{width: widths[j]}} title={String(row[h])}>{formatCell(row[h],h)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default DataTable;
