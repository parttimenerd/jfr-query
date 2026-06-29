import React, { useEffect } from 'react';
import ReactDOM from 'react-dom';
import { ExclamationTriangleIcon } from './icons/ExclamationTriangleIcon';
import { XMarkIcon } from './icons/XMarkIcon';

interface ToastNotificationProps {
  message: string;
  onClose: () => void;
  title?: string;
  duration?: number;
  action?: { label: string; onClick: () => void };
}

const ToastNotification: React.FC<ToastNotificationProps> = ({ message, onClose, title = 'Alert', duration = 5000, action }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, duration);

    return () => {
      clearTimeout(timer);
    };
  }, [onClose, duration]);

  return ReactDOM.createPortal(
    <div className="fixed top-5 right-5 z-[200] w-full max-w-sm animate-fade-in-down">
      <div className="bg-yellow-600/90 backdrop-blur-sm border border-yellow-400 text-white p-4 rounded-lg shadow-2xl flex items-start gap-3">
        <div className="flex-shrink-0">
          <ExclamationTriangleIcon className="w-6 h-6 text-yellow-200" />
        </div>
        <div className="flex-grow">
          <p className="font-semibold">{title}</p>
          <p className="text-sm text-yellow-100">{message}</p>
          {action && (
            <button
              onClick={() => { action.onClick(); onClose(); }}
              className="mt-2 text-xs font-semibold underline text-yellow-100 hover:text-white"
            >
              {action.label}
            </button>
          )}
        </div>
        <button onClick={onClose} className="p-1 -mt-1 -mr-1 text-yellow-200 hover:text-white rounded-full">
          <XMarkIcon className="w-5 h-5" />
        </button>
      </div>
    </div>,
    document.body
  );
};

export default ToastNotification;
