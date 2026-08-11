import React, { useEffect, useCallback } from 'react';

export interface Tab {
    id: string;
    filePath: string | null;
    displayName: string;
    isDirty: boolean;
}

interface NotebookTabsProps {
    tabs: Tab[];
    activeTabId: string;
    onSelectTab: (id: string) => void;
    onCloseTab: (id: string) => void;
    onNewTab: () => void;
}

const NotebookTabs: React.FC<NotebookTabsProps> = ({
    tabs,
    activeTabId,
    onSelectTab,
    onCloseTab,
    onNewTab,
}) => {
    const handleCloseTab = useCallback((e: React.MouseEvent, tab: Tab) => {
        e.stopPropagation();
        if (tab.isDirty) {
            const confirmed = window.confirm(`"${tab.displayName}" has unsaved changes. Close anyway?`);
            if (!confirmed) return;
        }
        onCloseTab(tab.id);
    }, [onCloseTab]);

    // Keyboard shortcuts: Ctrl+T (new tab), Ctrl+W (close current), Ctrl+1..9 (switch)
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const meta = e.metaKey || e.ctrlKey;
            if (!meta) return;

            if (e.key === 't' || e.key === 'T') {
                e.preventDefault();
                onNewTab();
                return;
            }

            if (e.key === 'w' || e.key === 'W') {
                // Only close tab if not inside a CodeMirror editor, to avoid
                // intercepting editor shortcuts.
                const inEditor = e.target instanceof HTMLElement &&
                    (e.target.closest('.CodeMirror') ||
                     e.target.closest('.cm-editor') ||
                     e.target.closest('[data-codeeditor]') ||
                     e.target.isContentEditable);
                if (inEditor) return;
                e.preventDefault();
                const currentTab = tabs.find(t => t.id === activeTabId);
                if (currentTab) {
                    if (currentTab.isDirty) {
                        const confirmed = window.confirm(`"${currentTab.displayName}" has unsaved changes. Close anyway?`);
                        if (!confirmed) return;
                    }
                    onCloseTab(activeTabId);
                }
                return;
            }

            const digit = parseInt(e.key, 10);
            if (digit >= 1 && digit <= 9) {
                const targetTab = tabs[digit - 1];
                if (targetTab) {
                    e.preventDefault();
                    onSelectTab(targetTab.id);
                }
            }
        };

        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
    }, [tabs, activeTabId, onNewTab, onCloseTab, onSelectTab]);

    return (
        <div className="flex-shrink-0 flex items-center bg-gray-900/60 border-b border-gray-700/80 overflow-x-auto z-20"
            data-testid="notebook-tab-bar"
            style={{ minHeight: '34px' }}
        >
            <div className="flex items-stretch min-w-0 flex-1">
                {tabs.map((tab, index) => {
                    const isActive = tab.id === activeTabId;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => onSelectTab(tab.id)}
                            title={tab.filePath ?? tab.displayName}
                            aria-label={`${tab.displayName}${tab.isDirty ? ' (unsaved changes)' : ''}`}
                            aria-selected={isActive}
                            className={[
                                'flex items-center gap-1.5 px-3 h-[34px] text-xs font-medium border-r border-gray-700/60 whitespace-nowrap flex-shrink-0 group transition-colors',
                                isActive
                                    ? 'bg-gray-800 text-gray-100 border-t-2 border-t-cyan-500'
                                    : 'bg-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-700/40 border-t-2 border-t-transparent',
                            ].join(' ')}
                        >
                            {/* Dirty indicator dot */}
                            {tab.isDirty && (
                                <span
                                    className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0"
                                    title="Unsaved changes"
                                />
                            )}
                            <span className="max-w-[140px] truncate">{tab.displayName}</span>
                            {/* Close button — always visible on active tab, visible on hover for others */}
                            {tabs.length > 1 && (
                                <span
                                    role="button"
                                    tabIndex={0}
                                    aria-label="Close tab"
                                    onClick={(e) => handleCloseTab(e, tab)}
                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCloseTab(e as any, tab); } }}
                                    className={[
                                        'ml-0.5 w-4 h-4 flex items-center justify-center rounded hover:bg-gray-600/70 text-gray-500 hover:text-gray-200 transition-colors flex-shrink-0',
                                        isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                                    ].join(' ')}
                                    title="Close tab (Ctrl+W)"
                                >
                                    <svg viewBox="0 0 16 16" fill="currentColor" className="w-2.5 h-2.5">
                                        <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.06 1.06L9.06 8l3.22 3.22a.749.749 0 0 1-1.06 1.06L8 9.06l-3.22 3.22a.749.749 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/>
                                    </svg>
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* New tab button */}
            <button
                onClick={onNewTab}
                title="New tab (Ctrl+T)"
                aria-label="New tab"
                className="flex-shrink-0 px-2 h-[34px] text-gray-500 hover:text-gray-200 hover:bg-gray-700/40 transition-colors"
            >
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                    <path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z"/>
                </svg>
            </button>
        </div>
    );
};

export default React.memo(NotebookTabs);
