import React from 'react';

interface ResizerProps {
  onMouseDown: (e: React.MouseEvent) => void;
  isVisible: boolean;
}

export const Resizer: React.FC<ResizerProps> = ({ onMouseDown, isVisible }) => {
    if (!isVisible) return <div className="w-0" />;
    
    return (
        <div 
            className="w-1 hover:w-2 transition-all hover:bg-cyan-500/50 cursor-col-resize z-50 flex items-center justify-center group h-full mx-0.5 rounded-full select-none"
            onMouseDown={onMouseDown}
        >
            <div className="h-8 w-0.5 bg-slate-800 group-hover:bg-cyan-400 rounded-full transition-colors" />
        </div>
    );
};