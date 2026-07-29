import React, { useEffect } from 'react';
import ReactDOM from 'react-dom';
import { XMarkIcon } from './icons/XMarkIcon';

interface KeyboardShortcutsModalProps {
    isOpen: boolean;
    onClose: () => void;
    onStartTour?: () => void;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl';
const shift = '⇧';
const alt = isMac ? '⌥' : 'Alt';

function Kbd({ children }: { children: React.ReactNode }) {
    return (
        <kbd className="inline-flex items-center gap-0.5 font-mono text-[11px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-300 border border-gray-600 leading-none whitespace-nowrap">
            {children}
        </kbd>
    );
}

function ShortcutRow({ keys, label }: { keys: React.ReactNode[]; label: string }) {
    return (
        <tr>
            <td className="py-1.5 pr-4 text-right whitespace-nowrap">
                <span className="flex items-center justify-end gap-1">
                    {keys.map((k, i) => <React.Fragment key={i}>{k}</React.Fragment>)}
                </span>
            </td>
            <td className="py-1.5 text-gray-300 text-sm">{label}</td>
        </tr>
    );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
    return (
        <tr>
            <td colSpan={2} className="pt-5 pb-1">
                <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold border-b border-gray-700/60 pb-1">{children}</div>
            </td>
        </tr>
    );
}

const TIPS = [
    { icon: '🗂', text: 'Double-click a schema item to copy its name to the clipboard.' },
    { icon: '🏷', text: 'Click a column chip (above the plot editor) to copy the column name.' },
    { icon: '🔍', text: 'Shift+scroll or Shift+drag on a chart to zoom in.' },
    { icon: '↕', text: 'Drag the cell handle to reorder cells, or use Alt+↑/↓.' },
    { icon: '✏️', text: 'Click a cell title or query title to rename it in place.' },
    { icon: '📥', text: 'Hover over a chart to reveal the "Download as PNG" button.' },
    { icon: '</>', text: 'The raw-markdown toggle in the toolbar gives a split editor + preview.' },
    { icon: '$', text: 'Add a variables block to parameterise queries with $name.' },
    { icon: '✦', text: 'The sparkle button on a plot block generates a plot config with AI.' },
    { icon: '👁', text: 'The SEE dropdown in the AI chat controls which query data the AI can see.' },
    { icon: '🔗', text: 'Use LET @x = $start in a plot config to bind a local variable; LINK_X($min, $max) links chart zoom across plots.' },
];

const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({ isOpen, onClose, onStartTour }) => {
    const onCloseRef = React.useRef(onClose);
    useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [isOpen]);

    if (!isOpen) return null;

    return ReactDOM.createPortal(
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            onClick={onClose}
        >
            <div
                className="relative bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
                role="dialog" aria-modal="true" aria-label="Keyboard shortcuts and tips"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700/60 flex-shrink-0">
                    <h2 className="text-base font-semibold text-gray-100">Keyboard Shortcuts &amp; Tips</h2>
                    <button onClick={onClose} className="p-1 rounded-md text-gray-500 hover:text-gray-300 hover:bg-gray-700/50" aria-label="Close">
                        <XMarkIcon className="w-4 h-4" />
                    </button>
                </div>

                {/* Body */}
                <div className="overflow-y-auto flex-1 px-6 py-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10">
                        {/* Left column: shortcuts */}
                        <div>
                            <table className="w-full border-collapse">
                                <tbody>
                                    <SectionHeading>Global</SectionHeading>
                                    <ShortcutRow keys={[<Kbd>{shift}{shift}</Kbd>, <span className="text-gray-600 text-xs">or</span>, <Kbd>{mod}K</Kbd>]} label="Open command palette" />
                                    <ShortcutRow keys={[<Kbd>?</Kbd>]} label="Keyboard shortcuts & tips" />
                                    <ShortcutRow keys={[<Kbd>{mod}S</Kbd>]} label="Save notebook" />
                                    <ShortcutRow keys={[<Kbd>{mod}Z</Kbd>]} label="Undo" />
                                    <ShortcutRow keys={[<Kbd>{shift}{mod}Z</Kbd>, <span className="text-gray-600 text-xs">or</span>, <Kbd>{mod}Y</Kbd>]} label="Redo" />

                                    <SectionHeading>Queries</SectionHeading>
                                    <ShortcutRow keys={[<Kbd>{mod}↵</Kbd>]} label="Run query" />
                                    <ShortcutRow keys={[<Kbd>{alt}↑</Kbd>]} label="Move cell up" />
                                    <ShortcutRow keys={[<Kbd>{alt}↓</Kbd>]} label="Move cell down" />

                                    <SectionHeading>Tabs</SectionHeading>
                                    <ShortcutRow keys={[<Kbd>{mod}T</Kbd>]} label="New tab" />
                                    <ShortcutRow keys={[<Kbd>{mod}W</Kbd>]} label="Close current tab" />
                                    <ShortcutRow keys={[<Kbd>{mod}1</Kbd>, <span className="text-gray-600 text-xs">–</span>, <Kbd>{mod}9</Kbd>]} label="Switch to tab N" />

                                    <SectionHeading>Command palette prefixes</SectionHeading>
                                    <ShortcutRow keys={[<Kbd>!</Kbd>]} label="Run SQL — preview result" />
                                    <ShortcutRow keys={[<Kbd>!!</Kbd>]} label="Run SQL — add as cell" />
                                    <ShortcutRow keys={[<Kbd>+</Kbd>]} label="AI: create cell from description" />
                                    <ShortcutRow keys={[<Kbd>&gt;</Kbd>]} label="Commands only" />
                                    <ShortcutRow keys={[<Kbd>:N</Kbd>]} label="Jump to cell N (e.g. :3)" />
                                </tbody>
                            </table>
                        </div>

                        {/* Right column: tips */}
                        <div>
                            <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold border-b border-gray-700/60 pb-1 mb-2 mt-0 md:mt-0">
                                Hidden features
                            </div>
                            <ul className="space-y-2.5">
                                {TIPS.map((tip, i) => (
                                    <li key={i} className="flex gap-2.5 text-sm text-gray-400 leading-snug">
                                        <span className="flex-shrink-0 w-5 text-center">{tip.icon}</span>
                                        <span>{tip.text}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                {onStartTour && (
                    <div className="flex items-center justify-between px-6 py-3 border-t border-gray-700/60 flex-shrink-0 bg-gray-900/80">
                        <span className="text-xs text-gray-500">New here? Let us show you around.</span>
                        <button
                            onClick={() => { onClose(); onStartTour(); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-cyan-700 hover:bg-cyan-600 text-white text-xs font-medium transition-colors"
                        >
                            ▶ Take the guided tour
                        </button>
                    </div>
                )}
            </div>
        </div>,
        document.body,
    );
};

export default KeyboardShortcutsModal;
