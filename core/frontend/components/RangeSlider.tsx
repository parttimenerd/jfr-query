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

  const getPercent = useCallback((value: number) => Math.round(((value - min) / (max - min)) * 100), [min, max]);

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
      range.current.style.width = `${maxPercent - minPercent}%`;
    }
  }, [maxVal, getPercent]);

  const handleMinChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = Math.min(Number(event.target.value), maxVal - step);
    setMinVal(newValue);
    minValRef.current = newValue;
    onChange({ min: newValue, max: maxVal });
  };

  const handleMaxChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = Math.max(Number(event.target.value), minVal + step);
    setMaxVal(newValue);
    maxValRef.current = newValue;
    onChange({ min: minVal, max: newValue });
  };

  return (
    <div className="relative w-full py-4 h-12">
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
        value={minVal}
        onChange={handleMinChange}
        className="thumb thumb--left"
        style={{ zIndex: minVal > max - 100 ? 5 : undefined }}
      />
      <input
        type="range"
        min={min}
        max={max}
        value={maxVal}
        onChange={handleMaxChange}
        className="thumb thumb--right"
      />

      <div className="relative w-full top-1/2 -translate-y-1/2">
        <div className="absolute w-full h-1 rounded bg-gray-600 z-0" />
        <div ref={range} className="absolute h-1 rounded bg-cyan-500 z-1" />
        <div className="absolute text-xs text-gray-400 top-4" style={{ left: `${getPercent(minVal)}%`, transform: 'translateX(-50%)' }}>
          {formatter ? formatter(minVal) : minVal}
        </div>
        <div className="absolute text-xs text-gray-400 top-4" style={{ left: `${getPercent(maxVal)}%`, transform: 'translateX(-50%)' }}>
           {formatter ? formatter(maxVal) : maxVal}
        </div>
      </div>
    </div>
  );
};

export default RangeSlider;
