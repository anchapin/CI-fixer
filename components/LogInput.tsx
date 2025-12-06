import React, { useRef, useEffect } from 'react';
import { AlertCircle, ArrowUpToLine, ArrowDownToLine } from 'lucide-react';

interface LogInputProps {
  logs: string;
  onChange: (val: string) => void;
  readOnly?: boolean;
}

export const LogInput: React.FC<LogInputProps> = ({ logs, onChange, readOnly }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when logs update
  useEffect(() => {
    if (textareaRef.current) {
        textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
    }
  }, [logs]);

  const scrollToTop = () => {
    if (textareaRef.current) {
        textareaRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const scrollToBottom = () => {
    if (textareaRef.current) {
        textareaRef.current.scrollTo({ top: textareaRef.current.scrollHeight, behavior: 'smooth' });
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 border border-slate-700 rounded-lg overflow-hidden shadow-lg relative group">
      <div className="flex items-center px-4 py-2 bg-slate-800 border-b border-slate-700 flex-none">
        <AlertCircle className="w-4 h-4 text-rose-500 mr-2" />
        <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Traceback / Logs</span>
        <div className="ml-auto flex space-x-2">
          <div className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></div>
        </div>
      </div>
      <div className="relative flex-1 min-h-0">
        <textarea
          ref={textareaRef}
          value={logs}
          onChange={(e) => onChange(e.target.value)}
          readOnly={readOnly}
          className="w-full h-full bg-slate-950 text-rose-300 font-mono text-xs p-4 resize-none focus:outline-none focus:ring-1 focus:ring-rose-500/50 leading-relaxed custom-scrollbar"
          spellCheck={false}
        />
        <div className="absolute bottom-4 right-4 text-slate-600 text-[10px] pointer-events-none bg-slate-900/80 px-2 rounded">
          READ_ONLY_MODE={readOnly ? 'TRUE' : 'FALSE'}
        </div>
        
        {/* Jump Controls */}
        <div className="absolute right-4 bottom-12 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button 
                onClick={scrollToTop}
                className="p-1.5 bg-slate-800 border border-slate-700 rounded hover:bg-slate-700 text-slate-400 hover:text-white shadow-lg"
                title="Scroll to Top"
            >
                <ArrowUpToLine className="w-3 h-3" />
            </button>
            <button 
                onClick={scrollToBottom}
                className="p-1.5 bg-slate-800 border border-slate-700 rounded hover:bg-slate-700 text-slate-400 hover:text-white shadow-lg"
                title="Scroll to Bottom"
            >
                <ArrowDownToLine className="w-3 h-3" />
            </button>
        </div>
      </div>
    </div>
  );
};