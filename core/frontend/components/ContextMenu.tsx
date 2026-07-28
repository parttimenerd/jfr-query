import React from 'react';
import ReactDOM from 'react-dom';

export interface ContextMenuItem {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    isSeparator?: boolean;
}

interface ContextMenuProps {
    items: ContextMenuItem[];
    x: number;
    y: number;
    onClose: () => void;
}

const ContextMenu: React.FC<ContextMenuProps> = ({ items, x, y, onClose }) => {
    
    return ReactDOM.createPortal(
        <>
            <div className="fixed inset-0 z-50" onClick={onClose} />
            <div
                className="fixed bg-gray-700 border border-gray-600 rounded-md shadow-lg py-1 z-50 animate-fade-in text-sm"
                style={{ top: y, left: x }}
            >
                <ul>
                    {items.map((item, index) => (
                        item.isSeparator ? (
                           <li key={`sep-${index}`} className="h-px bg-gray-600 my-1" />
                        ) : (
                            <li key={index} onClick={() => { if (item.disabled) onClose(); }}>
                                <button
                                    onClick={() => {
                                        item.onClick();
                                        onClose();
                                    }}
                                    disabled={item.disabled}
                                    className="w-full text-left px-4 py-1.5 text-gray-200 hover:bg-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-transparent"
                                >
                                    {item.label}
                                </button>
                            </li>
                        )
                    ))}
                </ul>
            </div>
        </>,
        document.body
    );
};

export default ContextMenu;
