
import React, { useRef } from 'react';
import type { NotebookCellData, NotebookMetadata } from '../types';
import NotebookCell from './NotebookCell';
import SettingsPanel from './SettingsPanel';
import { PlusIcon } from './icons/PlusIcon';
import SQLEditor from './SQLEditor';

interface NotebookProps {
    notebookMarkdown: string;
    setNotebookMarkdown: (markdown: string) => void;
    isMarkdownMode: boolean;
    isAutoRunEnabled: boolean;
    cells: NotebookCellData[];
    metadata: NotebookMetadata;
    results: Record<string, (any[] | null)[]>;
    collapseTrigger: number;
    allCollapsed: boolean;
    isAiFeatureActive: boolean;
    onRunQuery: (cellId: string, sql: string, queryIndex: number, allVariables: Record<string, string>) => void;
    onUpdateCell: (cellId: string, updatedContent: string) => void;
    onDeleteCell: (cellId: string) => void;
    onDeleteQueryBlock: (cellId: string, index: number) => void;
    onAddCell: () => void;
    onMoveCell: (draggedId: string, targetId: string, position: 'before' | 'after') => void;
    onSuggestPlot: (sql: string, customPromptOverride?: string) => Promise<string | null>;
    onFormatCode: (code: string, type: 'sql' | 'plot') => Promise<string | null>;
    onRunPreviewQuery: (queryToRun: string) => Promise<any[]>;
    onMetadataChange: (newMetadata: NotebookMetadata) => Promise<void>;
}

const Notebook: React.FC<NotebookProps> = (props) => {
    const {
        notebookMarkdown, setNotebookMarkdown, isMarkdownMode, isAutoRunEnabled, cells, metadata, results,
        collapseTrigger, allCollapsed, isAiFeatureActive, onRunQuery, onUpdateCell, onDeleteCell, onDeleteQueryBlock, 
        onAddCell, onMoveCell, onSuggestPlot, onFormatCode, onRunPreviewQuery, onMetadataChange
    } = props;

    const settingsPanelRef = useRef<{ focusVariable: (name: string) => void }>(null);

    const handleGlobalVariableClick = (variableName: string) => {
        settingsPanelRef.current?.focusVariable(variableName);
    };

    if (isMarkdownMode) {
        return (
            <div className="p-4 md:p-6 lg:p-8 h-full">
                <div className="h-full border border-gray-700 rounded-lg overflow-hidden">
                   <SQLEditor 
                        value={notebookMarkdown} 
                        onChange={setNotebookMarkdown} 
                        mode="markdown"
                        fullHeight
                    />
                </div>
            </div>
        );
    }
    
    return (
        <div className="p-4 md:p-6 space-y-4">
            <SettingsPanel 
                ref={settingsPanelRef}
                metadata={metadata}
                onMetadataChange={onMetadataChange}
                onRunPreviewQuery={onRunPreviewQuery}
                isAiFeatureActive={isAiFeatureActive}
            />
            {cells.map(cell => (
                <NotebookCell
                    key={cell.id}
                    cell={cell}
                    allCells={cells}
                    metadata={metadata}
                    results={results[cell.id] || []}
                    isAutoRunEnabled={isAutoRunEnabled}
                    collapseTrigger={collapseTrigger}
                    allCollapsed={allCollapsed}
                    isAiFeatureActive={isAiFeatureActive}
                    onRunQuery={onRunQuery}
                    onUpdate={(updatedContent) => onUpdateCell(cell.id, updatedContent)}
                    onDelete={() => onDeleteCell(cell.id)}
                    onDeleteQueryBlock={(index) => onDeleteQueryBlock(cell.id, index)}
                    onMoveCell={onMoveCell}
                    onSuggestPlot={onSuggestPlot}
                    onFormatCode={onFormatCode}
                    onRunPreviewQuery={onRunPreviewQuery}
                    onGlobalVariableClick={handleGlobalVariableClick}
                    onMetadataChange={onMetadataChange}
                />
            ))}
            <div className="flex justify-center py-4">
                <button
                    onClick={onAddCell}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-cyan-600/50 text-gray-300 hover:text-cyan-300 rounded-lg transition-colors font-semibold"
                >
                    <PlusIcon className="w-5 h-5" /> Add Cell
                </button>
            </div>
        </div>
    );
};

export default Notebook;
