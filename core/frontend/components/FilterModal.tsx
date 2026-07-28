import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { XMarkIcon } from './icons/XMarkIcon';
import RangeSlider from './RangeSlider';
import { useDisplaySettings } from '../context/DisplaySettingsContext';
import { formatTimestamp as formatTimestampUtil } from '../utils/timeFormatter';

interface FilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (filters: { timeRange: { min: number, max: number } }) => void;
  recordingStart: number;
  recordingEnd: number;
  initialValue: { min: number; max: number };
}

const FilterModal: React.FC<FilterModalProps> = ({ isOpen, onClose, onApply, recordingStart, recordingEnd, initialValue }) => {
  const [timeRange, setTimeRange] = useState(initialValue);
  const { timeFormat } = useDisplaySettings();

  useEffect(() => {
    if (isOpen) setTimeRange(initialValue);
  }, [isOpen, initialValue]);

  if (!isOpen) return null;

  const handleApply = () => {
    onApply({ timeRange });
    onClose();
  };
  
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) {
          onClose();
      }
  };

  const formatTimestamp = (ts: number) => formatTimestampUtil(ts, timeFormat);

  return ReactDOM.createPortal(
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={handleBackdropClick}
    >
      <div
        className="bg-gray-800 border border-gray-700 rounded-lg shadow-2xl w-full max-w-lg flex flex-col animate-fade-in"
      >
        <header className="flex-shrink-0 p-4 border-b border-gray-700 flex justify-between items-center">
          <h2 className="text-xl font-semibold">Filters</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-700 rounded-full">
            <XMarkIcon className="w-6 h-6" />
          </button>
        </header>
        <main className="flex-grow p-6 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Time Range</h3>
            <div className="px-4 pt-2">
                 <RangeSlider
                    min={recordingStart}
                    max={recordingEnd}
                    value={timeRange}
                    onChange={setTimeRange}
                    formatter={formatTimestamp}
                 />
            </div>
          </div>
        </main>
        <footer className="flex-shrink-0 p-4 border-t border-gray-700 flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm bg-gray-600 hover:bg-gray-500 rounded-md">Cancel</button>
            <button onClick={handleApply} className="px-4 py-2 text-sm bg-cyan-600 hover:bg-cyan-700 rounded-md font-semibold">Apply Filters</button>
        </footer>
      </div>
    </div>,
    document.body
  );
};

export default FilterModal;