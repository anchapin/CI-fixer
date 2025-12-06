import React from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

interface ColumnWrapperProps {
    children: React.ReactNode;
    title: string;
    icon?: React.ReactNode;
    collapsed: boolean;
    onToggle: () => void;
    className?: string;
}

export const ColumnWrapper: React.FC<ColumnWrapperProps> = ({ children, title, icon, collapsed, onToggle, className = "" }) => {
    if (collapsed) {
        return (
            <div className={`h-full bg-slate-900 border border-slate-700 rounded-lg flex flex-col items-center py-4 gap-6 transition-all w-[48px] ${className}`}>
                <button 
                    onClick={onToggle}
                    className="p-2 hover:bg-slate-800 rounded text-slate-400 hover:text-cyan-400 transition-colors"
                    title={`Expand ${title}`}
                >
                    <PanelLeftOpen className="w-5 h-5" />
                </button>
                <div className="flex-1 flex items-center justify-center overflow-hidden">
                    <span 
                        className="text-slate-500 font-mono text-xs font-bold uppercase tracking-widest whitespace-nowrap select-none flex items-center gap-2"
                        style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                    >
                        {title}
                    </span>
                </div>
                {icon && <div className="opacity-30 mb-2">{icon}</div>}
            </div>
        );
    }

    return (
        <div className={`h-full min-w-0 relative group/col ${className}`}>
             {/* Collapse Trigger - Floats top right */}
             <div className="absolute top-3 right-3 z-20 opacity-0 group-hover/col:opacity-100 transition-opacity">
                <button 
                    onClick={onToggle}
                    className="p-1.5 bg-slate-900/90 border border-slate-700 backdrop-blur rounded text-slate-500 hover:text-white hover:border-slate-500 shadow-lg transition-all transform hover:scale-105"
                    title="Collapse Column"
                >
                    <PanelLeftClose className="w-3 h-3" />
                </button>
             </div>
             {children}
        </div>
    );
};