import React, { useState, useEffect } from 'react';
import { useDisplaySettings } from '../context/DisplaySettingsContext';
import { parseDuration } from '../utils/durationParser';
import { formatTimestamp } from '../utils/timeFormatter';

interface TimeInputProps {
  value: number; // timestamp in ms
  recordingStart: number;
  onChange: (newValue: number) => void;
}

const TimeInput: React.FC<TimeInputProps> = ({ value, recordingStart, onChange }) => {
  const { timeFormat } = useDisplaySettings();
  const [inputValue, setInputValue] = useState('');
  const [isValid, setIsValid] = useState(true);

  useEffect(() => {
    setInputValue(formatTimestamp(value, timeFormat));
    setIsValid(true);
  }, [value, timeFormat]);

  const handleBlur = () => {
    const trimmedValue = inputValue.trim();
    const durationMs = parseDuration(trimmedValue);
    if (durationMs !== null) {
      onChange(recordingStart + durationMs);
      return;
    }
    const date = new Date(trimmedValue);
    if (!isNaN(date.getTime()) && trimmedValue.length > 4) {
      onChange(date.getTime());
      return;
    }
    setIsValid(false);
    setTimeout(() => {
      setInputValue(formatTimestamp(value, timeFormat));
      setIsValid(true);
    }, 1500);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
    else if (e.key === 'Escape') {
      setInputValue(formatTimestamp(value, timeFormat));
      setIsValid(true);
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <input
      type="text"
      value={inputValue}
      onChange={(e) => setInputValue(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      title="Enter absolute time (HH:mm:ss.SS) or duration from start (e.g., 5m 30s)"
      className={`bg-gray-800 border ${isValid ? 'border-gray-600 focus:border-cyan-500' : 'border-red-500'} rounded-md py-1 px-2 text-sm font-mono w-40 transition-colors focus:outline-none focus:ring-1 focus:ring-cyan-500`}
    />
  );
};

export default TimeInput;
