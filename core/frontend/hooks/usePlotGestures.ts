import { useCallback } from 'react';

export interface PlotGestureConfig {
  name?: string;
  onVariableChange?: (vars: Record<string, unknown>) => void;
}

export interface PlotGestureHandlers {
  onBrushChange: (range: { startIndex?: number; endIndex?: number } | null, data: unknown[], xKey?: string) => void;
  onMouseMove: (point: unknown) => void;
  onMouseLeave: () => void;
  onZoomChange: (range: { lo: unknown; hi: unknown }) => void;
  onClick: (point: unknown) => void;
}

function debounce<T extends (...args: any[]) => any>(fn: T, ms: number): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return function (this: any, ...args: Parameters<T>) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

export function usePlotGestures(config: PlotGestureConfig): PlotGestureHandlers {
  const { name, onVariableChange } = config;

  const write = useCallback(
    (key: string, value: unknown) => {
      if (!name || !onVariableChange) return;
      onVariableChange({ [`${name}.${key}`]: value });
    },
    [name, onVariableChange]
  );

  // Debounced hover writer — recreated only when `write` changes.
  const debouncedHover = useCallback(
    debounce((point: unknown) => {
      const payload = (point as any)?.activePayload?.[0]?.payload;
      write('hover', payload ?? undefined);
    }, 50),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [write]
  );

  const onBrushChange = useCallback(
    (range: { startIndex?: number; endIndex?: number } | null, data: unknown[], xKey?: string) => {
      if (!name || !onVariableChange) return;
      if (!range || !data || data.length === 0) {
        write('brush', undefined);
        return;
      }
      const { startIndex, endIndex } = range;
      const getX = (item: unknown) => {
        if (!item || typeof item !== 'object') return undefined;
        // If xKey is provided, use it; otherwise fall back to 'x'
        if (xKey) return (item as Record<string, unknown>)[xKey];
        return (item as any).x;
      };
      const lo = startIndex != null ? getX(data[startIndex]) : undefined;
      const hi = endIndex != null ? getX(data[endIndex]) : undefined;
      write('brush', { lo, hi });
    },
    [name, onVariableChange, write]
  );

  const onMouseMove = useCallback(
    (point: unknown) => {
      if (!name || !onVariableChange) return;
      debouncedHover(point);
    },
    [name, onVariableChange, debouncedHover]
  );

  const onMouseLeave = useCallback(() => {
    write('hover', undefined);
  }, [write]);

  const onZoomChange = useCallback(
    (range: { lo: unknown; hi: unknown }) => {
      write('zoom', range);
    },
    [write]
  );

  const onClick = useCallback(
    (point: unknown) => {
      if (!name || !onVariableChange) return;
      const payload = (point as any)?.activePayload?.[0]?.payload;
      write('selection', payload ?? undefined);
    },
    [name, onVariableChange, write]
  );

  return { onBrushChange, onMouseMove, onMouseLeave, onZoomChange, onClick };
}
