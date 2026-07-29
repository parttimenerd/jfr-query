import React, { useCallback, useEffect, useState, useRef } from 'react';

interface RangeSliderProps {
  min: number;
  max: number;
  value: { min: number; max: number };
  onChange: (value: { min: number; max: number }) => void;
  step?: number;
  formatter?: (value: number) => string;
}

const RangeSlider: React.FC<RangeSliderProps> = ({ min, max, value, onChange, step = 1, formatter }) => {
  const [minVal, setMinVal] = useState(value.min);
  const [maxVal, setMaxVal] = useState(value.max);
  const minValRef = useRef(value.min);
  const maxValRef = useRef(value.max);
  const range = useRef<HTMLDivElement>(null);

  // B-200: guard against min===max (zero-range dataset) — dividing by 0 yields NaN
  // which propagates into the style calculations and breaks the slider visually.
  const rangeSpan = max - min;
  const getPercent = useCallback(
    (v: number) => rangeSpan === 0 ? 0 : Math.round(((v - min) / rangeSpan) * 100),
    [min, rangeSpan],
  );

  useEffect(() => {
    setMinVal(value.min);
    setMaxVal(value.max);
    minValRef.current = value.min;
    maxValRef.current = value.max;
  }, [value]);

  useEffect(() => {
    const minPercent = getPercent(minVal);
    const maxPercent = getPercent(maxValRef.current);
    if (range.current) {
      range.current.style.left = `${minPercent}%`;
      range.current.style.width = `${maxPercent - minPercent}%`;
    }
  }, [minVal, getPercent]);

  useEffect(() => {
    const minPercent = getPercent(minValRef.current);
    const maxPercent = getPercent(maxVal);
    if (range.current) {
      range.current.style.left = `${minPercent}%`;
      range.current.style.width = `${maxPercent - minPercent}%`;
    }
  }, [maxVal, getPercent]);

  const handleMinChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    // B-200: when min===max the slider is zero-range; clamp to min itself so the
    // thumb can't push below the range floor.
    const newValue = rangeSpan === 0 ? min : Math.min(Number(event.target.value), maxVal - step);
    setMinVal(newValue);
    minValRef.current = newValue;
    onChange({ min: newValue, max: maxValRef.current });
  };

  const handleMaxChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = rangeSpan === 0 ? max : Math.max(Number(event.target.value), minVal + step);
    setMaxVal(newValue);
    maxValRef.current = newValue;
    onChange({ min: minValRef.current, max: newValue });
  };

  // B-093: keyboard text inputs for precise value entry
  const [minText, setMinText] = useState('');
  const [maxText, setMaxText] = useState('');
  const [editingMin, setEditingMin] = useState(false);
  const [editingMax, setEditingMax] = useState(false);

  const commitMinText = () => {
    const parsed = Number(minText);
    if (!isNaN(parsed)) {
      const clamped = rangeSpan === 0 ? min : Math.max(min, Math.min(parsed, maxVal - step));
      setMinVal(clamped);
      minValRef.current = clamped;
      onChange({ min: clamped, max: maxVal });
    }
    setEditingMin(false);
  };

  const commitMaxText = () => {
    const parsed = Number(maxText);
    if (!isNaN(parsed)) {
      const clamped = rangeSpan === 0 ? max : Math.max(minVal + step, Math.min(parsed, max));
      setMaxVal(clamped);
      maxValRef.current = clamped;
      onChange({ min: minVal, max: clamped });
    }
    setEditingMax(false);
  };

  // B-094: when thumbs are very close (within 5% of range), stack labels vertically
  const minPercent = getPercent(minVal);
  const maxPercent = getPercent(maxVal);
  const tooClose = Math.abs(maxPercent - minPercent) < 5;

  const labelStyle = (isMin: boolean): React.CSSProperties => ({
    left: `${isMin ? minPercent : maxPercent}%`,
    transform: 'translateX(-50%)',
    top: tooClose ? (isMin ? '4px' : '16px') : '4px',
  });

  const displayMin = formatter ? formatter(minVal) : String(minVal);
  const displayMax = formatter ? formatter(maxVal) : String(maxVal);

  return (
    <div className="relative w-full py-4">
      <style>{`
        .thumb {
          pointer-events: none;
          position: absolute;
          height: 0;
          width: 100%;
          outline: none;
          -webkit-appearance: none;
          background-color: transparent;
        }
        .thumb::-webkit-slider-thumb {
          pointer-events: all;
          -webkit-appearance: none;
          width: 1.25rem;
          height: 1.25rem;
          background-color: #0891b2;
          border-radius: 50%;
          border: 2px solid white;
          cursor: pointer;
          margin-top: -0.5rem;
        }
        .thumb::-moz-range-thumb {
            pointer-events: all;
            width: 1.25rem;
            height: 1.25rem;
            background-color: #0891b2;
            border-radius: 50%;
            border: 2px solid white;
            cursor: pointer;
        }
      `}</style>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={minVal}
        onChange={handleMinChange}
        className="thumb thumb--left"
        style={{ zIndex: minPercent > 90 ? 5 : undefined }}
      />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={maxVal}
        onChange={handleMaxChange}
        className="thumb thumb--right"
      />

      <div className="relative w-full" style={{ height: tooClose ? '36px' : '24px' }}>
        <div className="absolute top-1/2 -translate-y-1/2 w-full h-1 rounded bg-gray-600 z-0" />
        <div ref={range} className="absolute top-1/2 -translate-y-1/2 h-1 rounded bg-cyan-500 z-1" />
        {/* Min label — click to edit (B-093) */}
        {editingMin ? (
          <input
            autoFocus
            type="number"
            className="absolute text-xs bg-gray-700 border border-cyan-500 rounded px-1 w-20 text-center"
            style={labelStyle(true)}
            value={minText}
            onChange={e => setMinText(e.target.value)}
            onBlur={commitMinText}
            onKeyDown={e => { if (e.key === 'Enter') commitMinText(); if (e.key === 'Escape') setEditingMin(false); }}
          />
        ) : (
          <div
            className="absolute text-xs text-gray-400 cursor-text hover:text-cyan-400 select-none"
            style={labelStyle(true)}
            onClick={() => { setMinText(String(minVal)); setEditingMin(true); }}
            title="Click to type a value"
          >
            {displayMin}
          </div>
        )}
        {/* Max label — click to edit (B-093) */}
        {editingMax ? (
          <input
            autoFocus
            type="number"
            className="absolute text-xs bg-gray-700 border border-cyan-500 rounded px-1 w-20 text-center"
            style={labelStyle(false)}
            value={maxText}
            onChange={e => setMaxText(e.target.value)}
            onBlur={commitMaxText}
            onKeyDown={e => { if (e.key === 'Enter') commitMaxText(); if (e.key === 'Escape') setEditingMax(false); }}
          />
        ) : (
          <div
            className="absolute text-xs text-gray-400 cursor-text hover:text-cyan-400 select-none"
            style={labelStyle(false)}
            onClick={() => { setMaxText(String(maxVal)); setEditingMax(true); }}
            title="Click to type a value"
          >
            {displayMax}
          </div>
        )}
      </div>
    </div>
  );
};

export default RangeSlider;
