import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDoubleLeftIcon } from './icons/ChevronDoubleLeftIcon';
import { ChevronDoubleRightIcon } from './icons/ChevronDoubleRightIcon';

interface ResizablePanelProps {
  children: React.ReactNode;
  side: 'left' | 'right';
  initialWidth: number;
  minWidth: number;
  isCollapsed: boolean;
  onCollapseToggle: () => void;
}

const ResizablePanel: React.FC<ResizablePanelProps> = ({
  children,
  side,
  initialWidth,
  minWidth,
  isCollapsed,
  onCollapseToggle
}) => {
  const [width, setWidth] = useState(initialWidth);
  const isResizing = useRef(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
  };

  const handleMouseUp = useCallback(() => {
    isResizing.current = false;
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isResizing.current) {
      let newWidth;
      if (side === 'left') {
        newWidth = e.clientX;
      } else {
        newWidth = window.innerWidth - e.clientX;
      }

      if (newWidth > minWidth) {
        setWidth(newWidth);
      } else {
        setWidth(minWidth);
      }
    }
  }, [minWidth, side]);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);
  
  const handleToggleCollapse = (e: React.MouseEvent) => {
      e.stopPropagation();
      onCollapseToggle();
  }

  const resizerClasses = `
    absolute top-0 w-1.5 h-full bg-gray-700 cursor-col-resize z-10
    flex items-center justify-center
    ${side === 'left' ? '-right-0.5' : '-left-0.5'}
  `;

  return (
    <div
      className="relative flex-shrink-0 h-full"
      style={{ 
        width: isCollapsed ? 0 : width, 
        transition: 'width 0.2s ease-in-out',
        overflow: 'hidden' // This is key: it clips the oversized child during animation.
      }}
    >
        {/* This inner div maintains its width, preventing children from unmounting.
            It will be clipped by its parent's `overflow: hidden`. */}
        <div 
          className="h-full border-gray-700" 
          style={{
            width: width, // Always use the state `width`, not `w-full`
            borderRight: side === 'left' && !isCollapsed ? '1px solid' : '0',
            borderLeft: side === 'right' && !isCollapsed ? '1px solid' : '0',
            opacity: isCollapsed ? 0 : 1,
            transition: 'opacity 0.1s linear',
            pointerEvents: isCollapsed ? 'none' : 'auto', // Prevent interaction when hidden
          }}
        >
            {children}
        </div>
        {!isCollapsed && (
            <div
                className={resizerClasses}
                onMouseDown={handleMouseDown}
            >
                <div className="absolute w-6 h-8 bg-gray-700 hover:bg-cyan-600 rounded-full flex items-center justify-center transition-colors -translate-x-1/2 -translate-y-1/2 top-1/2" style={{left: '50%'}}>
                    <button onClick={handleToggleCollapse} className="text-gray-300" title={side === 'left' ? 'Collapse sidebar' : 'Collapse assistant'}>
                    {side === 'left' ? <ChevronDoubleLeftIcon className="w-4 h-4" /> : <ChevronDoubleRightIcon className="w-4 h-4" />}
                    </button>
                </div>
            </div>
        )}
    </div>
  );
};

export default ResizablePanel;