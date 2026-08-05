import React, { useRef, useState, useCallback } from 'react';

const MIN_HEIGHT = 160;
const DEFAULT_HEIGHT = 320;

interface Props {
    id?: string;
    className?: string;
    children: React.ReactNode;
}

export const ResizablePlotContainer: React.FC<Props> = ({ id, className = '', children }) => {
    const [height, setHeight] = useState(DEFAULT_HEIGHT);
    const startY = useRef<number | null>(null);
    const startH = useRef<number>(DEFAULT_HEIGHT);

    const onMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        startY.current = e.clientY;
        startH.current = height;

        const onMove = (me: MouseEvent) => {
            if (startY.current === null) return;
            const delta = me.clientY - startY.current;
            setHeight(Math.max(MIN_HEIGHT, startH.current + delta));
        };
        const onUp = () => {
            startY.current = null;
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }, [height]);

    return (
        <div
            id={id}
            className={`relative overflow-hidden shrink-0 ${className}`}
            style={{ height, minHeight: MIN_HEIGHT }}>
            {children}
            <div
                data-resize-handle
                onMouseDown={onMouseDown}
                className="absolute bottom-0 left-0 right-0 h-2 flex items-end justify-center pb-0.5 cursor-ns-resize group"
                title="Drag to resize"
                aria-label="Resize plot">
                <div className="w-8 h-0.5 bg-gray-700 group-hover:bg-cyan-500 rounded-full transition-colors" />
            </div>
        </div>
    );
};
