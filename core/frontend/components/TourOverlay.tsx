import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';

interface TourStep {
    targetSelector: string;
    title: string;
    body: string;
    placement: 'top' | 'bottom' | 'left' | 'right';
}

const TOUR_STEPS: TourStep[] = [
    {
        targetSelector: '[data-tour="schema-explorer"]',
        title: 'Schema Explorer',
        body: 'Browse JFR events as tables. Click a table to expand its columns. Double-click a name to copy it into your clipboard — then paste straight into a query.',
        placement: 'right',
    },
    {
        targetSelector: '[data-tour="run-query"]',
        title: 'Run Your Query',
        body: 'Write SQL and press ▶ or ⌘+Enter to run. Results appear below. Separate multiple queries with a blank line — each one gets its own result set and can drive its own plot.',
        placement: 'bottom',
    },
    {
        targetSelector: '[data-tour="plot-block"]',
        title: 'Plot Block',
        body: 'Visualise your query with TABLE(), BAR_CHART(), LINE_CHART(), and more. Click the ✦ sparkle button to generate a plot config with AI. Hit the ? button in the plot toolbar to open the full Plot Guide.',
        placement: 'top',
    },
    {
        targetSelector: '[data-tour="cmd-palette"]',
        title: 'Command Palette',
        body: 'Press ⇧⇧ or ⌘K to open the command palette. Type ! to preview SQL, !! to add it as a cell, + to let AI create a cell from a description, or :N to jump to cell N.',
        placement: 'bottom',
    },
    {
        targetSelector: '[data-tour="ai-chat"]',
        title: 'AI Chat Panel',
        body: 'Open the AI panel from the sidebar to ask questions in plain English. The AI can write SQL, create plot configs, and edit existing cells. Use the SEE dropdown to control which data the AI can see.',
        placement: 'left',
    },
    {
        targetSelector: '[data-tour="template-gallery"]',
        title: 'Template Gallery',
        body: 'Not sure where to start? Open the template gallery to load a pre-built notebook for common JFR analysis patterns — GC pauses, CPU profiling, thread contention, and more.',
        placement: 'bottom',
    },
    {
        targetSelector: '[data-tour="shortcuts-btn"]',
        title: 'Keyboard Shortcuts & Tips',
        body: 'Hit ? or click this button any time to see all keyboard shortcuts and hidden features — including how to zoom charts, rename cells, and use the $variable system.',
        placement: 'bottom',
    },
];

const GAP = 8; // px padding around the spotlight target
const CARD_WIDTH = 280;

interface Rect { top: number; left: number; width: number; height: number; }

function measureTarget(selector: string): Rect | null {
    const el = document.querySelector(selector);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function cardPosition(rect: Rect, placement: TourStep['placement']): React.CSSProperties {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 12;

    if (placement === 'right') {
        const left = Math.min(rect.left + rect.width + GAP + margin, vw - CARD_WIDTH - margin);
        const top = Math.max(margin, Math.min(rect.top, vh - 200));
        return { left, top };
    }
    if (placement === 'left') {
        const left = Math.max(margin, rect.left - GAP - CARD_WIDTH - margin);
        const top = Math.max(margin, Math.min(rect.top, vh - 200));
        return { left, top };
    }
    if (placement === 'top') {
        const top = Math.max(margin, rect.top - GAP - 170);
        const left = Math.max(margin, Math.min(rect.left, vw - CARD_WIDTH - margin));
        return { top, left };
    }
    // bottom (default)
    const top = Math.min(rect.top + rect.height + GAP + margin, vh - 180);
    const left = Math.max(margin, Math.min(rect.left, vw - CARD_WIDTH - margin));
    return { top, left };
}

interface TourOverlayProps {
    isOpen: boolean;
    onClose: () => void;
}

const TourOverlay: React.FC<TourOverlayProps> = ({ isOpen, onClose }) => {
    const [stepIndex, setStepIndex] = useState(0);
    const [rect, setRect] = useState<Rect | null>(null);
    const [visibleStepNumbers, setVisibleStepNumbers] = useState<number[]>([]);
    const animFrame = useRef<number | null>(null);
    const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Refs so keydown handler always calls the latest handleNext/handleBack
    // without needing them in the dependency array (avoids stale closure).
    const handleNextRef = useRef<() => void>(() => {});
    const handleBackRef = useRef<() => void>(() => {});

    // Find next valid step starting from `from`
    const findStep = (from: number, direction: 1 | -1): number | null => {
        let i = from;
        while (i >= 0 && i < TOUR_STEPS.length) {
            if (measureTarget(TOUR_STEPS[i].targetSelector)) return i;
            i += direction;
        }
        return null;
    };

    const measureStep = useCallback((index: number) => {
        if (!isOpen) return;
        const step = TOUR_STEPS[index];
        const el = document.querySelector(step.targetSelector);
        if (el) {
            el.scrollIntoView({ block: 'center', behavior: 'smooth' });
            // Wait for scroll to settle before measuring
            if (animFrame.current) cancelAnimationFrame(animFrame.current);
            if (scrollTimer.current) clearTimeout(scrollTimer.current);
            let cancelled = false;
            let settled = 0;
            const poll = () => {
                if (cancelled) return;
                settled++;
                const r = measureTarget(step.targetSelector);
                if (r) {
                    setRect(r);
                } else if (settled < 20) {
                    animFrame.current = requestAnimationFrame(poll);
                }
            };
            scrollTimer.current = setTimeout(() => { animFrame.current = requestAnimationFrame(poll); }, 350);
            return () => { cancelled = true; };
        } else {
            if (animFrame.current) { cancelAnimationFrame(animFrame.current); animFrame.current = null; }
            if (scrollTimer.current) { clearTimeout(scrollTimer.current); scrollTimer.current = null; }
            setRect(null);
        }
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) {
            setStepIndex(0);
            setRect(null);
            setVisibleStepNumbers([]);
            return;
        }
        const visible = TOUR_STEPS.map((_, i) => i).filter(i => measureTarget(TOUR_STEPS[i].targetSelector) !== null);
        setVisibleStepNumbers(visible);
        const valid = findStep(0, 1);
        if (valid === null) { onClose(); return; }
        setStepIndex(valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const cancelPoll = measureStep(stepIndex);
        return () => {
            cancelPoll?.();
            if (animFrame.current) cancelAnimationFrame(animFrame.current);
            if (scrollTimer.current) clearTimeout(scrollTimer.current);
        };
    }, [isOpen, stepIndex, measureStep]);

    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') handleNextRef.current();
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') handleBackRef.current();
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const step = TOUR_STEPS[stepIndex];
    const isLast = findStep(stepIndex + 1, 1) === null;
    const isFirst = findStep(stepIndex - 1, -1) === null;

    const handleNext = () => {
        const next = findStep(stepIndex + 1, 1);
        if (next !== null) setStepIndex(next);
        else onClose();
    };

    const handleBack = () => {
        const prev = findStep(stepIndex - 1, -1);
        if (prev !== null) setStepIndex(prev);
    };

    // Keep refs current so the keydown handler always calls the latest version.
    handleNextRef.current = handleNext;
    handleBackRef.current = handleBack;

    const displayIndex = visibleStepNumbers.indexOf(stepIndex);
    const displayTotal = visibleStepNumbers.length;
    const stepLabel = displayIndex >= 0 && displayTotal > 0 ? `${displayIndex + 1} / ${displayTotal}` : '';

    return ReactDOM.createPortal(
        <div className="fixed inset-0 z-[200]" style={{ pointerEvents: 'none' }}>
            {/* Dark overlay */}
            <div
                className="fixed inset-0"
                style={{ backgroundColor: 'rgba(0,0,0,0.55)', pointerEvents: 'auto' }}
                onClick={onClose}
            />

            {/* Spotlight cut-out */}
            {rect && (
                <div
                    style={{
                        position: 'fixed',
                        top: rect.top - GAP,
                        left: rect.left - GAP,
                        width: rect.width + GAP * 2,
                        height: rect.height + GAP * 2,
                        borderRadius: 8,
                        boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
                        pointerEvents: 'none',
                        zIndex: 201,
                        transition: 'top 0.25s ease, left 0.25s ease, width 0.25s ease, height 0.25s ease',
                    }}
                />
            )}

            {/* Tour card */}
            <div
                style={{
                    position: 'fixed',
                    width: CARD_WIDTH,
                    zIndex: 202,
                    pointerEvents: 'auto',
                    ...(rect
                        ? cardPosition(rect, step.placement)
                        : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }),
                }}
                className="bg-gray-900 border border-gray-600 rounded-xl shadow-2xl p-4 flex flex-col gap-3"
            >
                {/* Step indicator */}
                <div className="flex items-center justify-between">
                    <span className="text-[11px] text-gray-500 font-medium tracking-wide uppercase">
                        {stepLabel}
                    </span>
                    <button
                        onClick={onClose}
                        className="text-gray-500 hover:text-gray-300 text-xs"
                        aria-label="Skip tour"
                    >
                        Skip
                    </button>
                </div>

                {/* Content */}
                <div>
                    <div className="text-sm font-semibold text-gray-100 mb-1">{step.title}</div>
                    <div className="text-sm text-gray-400 leading-snug">{step.body}</div>
                </div>

                {/* Navigation */}
                <div className="flex items-center gap-2 mt-1">
                    {!isFirst && (
                        <button
                            onClick={handleBack}
                            className="px-3 py-1.5 rounded-md text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-700/60 transition-colors"
                        >
                            ← Back
                        </button>
                    )}
                    <div className="flex-1" />
                    {isLast ? (
                        <button
                            onClick={onClose}
                            className="px-3 py-1.5 rounded-md bg-cyan-700 hover:bg-cyan-600 text-white text-xs font-medium transition-colors"
                        >
                            Done ✓
                        </button>
                    ) : (
                        <button
                            onClick={handleNext}
                            className="px-3 py-1.5 rounded-md bg-cyan-700 hover:bg-cyan-600 text-white text-xs font-medium transition-colors"
                        >
                            Next →
                        </button>
                    )}
                </div>
            </div>
        </div>,
        document.body,
    );
};

export default TourOverlay;
