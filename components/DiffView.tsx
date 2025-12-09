
import React, { useState, useRef, useEffect } from 'react';
import { FileChange } from '../types';
import { GitCommit, ChevronDown, ChevronRight, FileCode, MessageSquare, AlertCircle, X, ArrowUpToLine, ArrowDownToLine, GitBranch } from 'lucide-react';
import * as Diff from 'diff';
import { getStats, getContextualDiff } from '../utils/diffHelpers';

interface DiffViewProps {
  files: FileChange[];
  selectedChunkIds: Set<string>; 
  onToggleChunkSelection: (id: string | string[], file: string) => void;
  onRevertChunk: (file: FileChange, newContent: string) => void;
  viewContext: string; // "Consolidated" or Agent Name
}

export const DiffView: React.FC<DiffViewProps> = ({ files, selectedChunkIds, onToggleChunkSelection, onRevertChunk, viewContext }) => {
  const [openFiles, setOpenFiles] = useState<Record<string, boolean>>({});
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const filesSignatureRef = useRef<string>('');

  // Auto-scroll logic...
  useEffect(() => {
    const newSignature = files.map(f => `${f.path}:${f.modified.content.length}`).join(',');
    if (filesSignatureRef.current !== newSignature) {
        if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTo({ top: scrollContainerRef.current.scrollHeight, behavior: 'smooth' });
        }
        filesSignatureRef.current = newSignature;
    }
  }, [files]);

  const scrollToTop = () => {
    if (scrollContainerRef.current) scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const scrollToBottom = () => {
    if (scrollContainerRef.current) scrollContainerRef.current.scrollTo({ top: scrollContainerRef.current.scrollHeight, behavior: 'smooth' });
  };

  const toggleFile = (path: string) => setOpenFiles(prev => ({ ...prev, [path]: !prev[path] }));
  const toggleAll = (open: boolean) => {
    const newState: Record<string, boolean> = {};
    files.forEach(f => newState[f.path] = open);
    setOpenFiles(newState);
  };

  const handleRevertClick = (file: FileChange, diff: Diff.Change[], indicesToRevert: number[]) => {
      let newContent = "";
      diff.forEach((part, index) => {
          if (indicesToRevert.includes(index)) {
              if (part.removed) newContent += part.value;
          } else {
              if (!part.removed) newContent += part.value;
          }
      });
      onRevertChunk(file, newContent);
  };

  const renderInlineDiff = (file: FileChange) => {
    const { diffFull, diffRender } = getContextualDiff(file.original.content, file.modified.content);
    const groupedParts: { parts: typeof diffRender }[] = [];
    
    for (let i = 0; i < diffRender.length; i++) {
        const current = diffRender[i];
        const next = diffRender[i + 1];
        if (current.removed && next?.added) {
            groupedParts.push({ parts: [current, next] });
            i++; 
        } else {
            groupedParts.push({ parts: [current] });
        }
    }

    return groupedParts.map((group, groupIndex) => {
      if (group.parts[0].isSpacer) {
          return (
              <div key={`spacer-${groupIndex}`} className="bg-slate-900/50 text-slate-600 text-[10px] italic py-1 px-2 border-y border-slate-800 text-center select-none">
                  {group.parts[0].value}
              </div>
          );
      }

      const isChange = group.parts.some(p => p.added || p.removed);
      const chunkIds = group.parts.map(p => `${file.path}-${p.originalIndex}`);
      const isSelected = chunkIds.every(id => selectedChunkIds.has(id));
      
      const handleToggle = () => {
           if (isSelected) onToggleChunkSelection(chunkIds, file.path);
           else {
               const idsToSelect = chunkIds.filter(id => !selectedChunkIds.has(id));
               onToggleChunkSelection(idsToSelect, file.path);
           }
      };

      const handleRevert = () => handleRevertClick(file, diffFull, group.parts.map(p => p.originalIndex));

      return (
        <div key={`group-${groupIndex}`} className={`flex items-stretch group/line border-b border-transparent ${isChange ? 'hover:bg-slate-900/80' : ''}`}>
            {isChange ? (
                 <div className="w-8 flex flex-col items-center justify-center gap-3 border-r border-slate-800 bg-slate-900/50 px-1 shrink-0 py-2">
                     <input 
                        type="checkbox" 
                        checked={isSelected}
                        onChange={handleToggle}
                        className="w-3 h-3 rounded border-slate-600 bg-slate-950 checked:bg-amber-500 checked:border-amber-500 cursor-pointer accent-amber-500"
                     />
                     <button onClick={handleRevert} className="text-slate-600 hover:text-rose-500 transition-colors">
                         <X className="w-3 h-3" />
                     </button>
                 </div>
            ) : (
                <div className="w-8 border-r border-slate-800 bg-slate-900/30 shrink-0"></div>
            )}
            
            <div className="w-full">
                {group.parts.map((part, pIdx) => {
                    const color = part.added ? 'bg-emerald-950/40 text-emerald-100' :
                                  part.removed ? 'bg-rose-950/40 text-rose-100 line-through decoration-rose-500/30' : 
                                  'text-slate-400';
                    return (
                        <span key={pIdx} className={`${color} block whitespace-pre-wrap break-all w-full px-2 py-0.5`}>
                            {part.value}
                        </span>
                    );
                })}
            </div>
        </div>
      );
    });
  };

  if (files.length === 0) {
      return (
          <div className="flex flex-col h-full bg-slate-900 border border-slate-700 rounded-lg shadow-lg items-center justify-center text-slate-600 relative group">
              <div className="w-16 h-16 border-2 border-slate-800 rounded-full flex items-center justify-center mb-4">
                  <FileCode className="w-8 h-8 opacity-50" />
              </div>
              <p className="text-xs uppercase tracking-widest text-center px-4">
                  No active changes for:<br/>
                  <span className="text-cyan-500 font-bold">{viewContext}</span>
              </p>
          </div>
      );
  }

  return (
    <div className="flex flex-col h-full bg-slate-900 border border-slate-700 rounded-lg overflow-hidden shadow-lg relative group">
      <div className="flex items-center justify-between px-4 py-2 bg-slate-800 border-b border-slate-700 flex-none">
        <div className="flex items-center">
            <GitCommit className="w-4 h-4 text-cyan-500 mr-2" />
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Worktree: <span className="text-cyan-400">{viewContext}</span>
            </span>
        </div>
        <div className="flex gap-2 text-[10px] font-mono">
             <button onClick={() => toggleAll(true)} className="text-slate-400 hover:text-white">Expand All</button>
             <span className="text-slate-600">|</span>
             <button onClick={() => toggleAll(false)} className="text-slate-400 hover:text-white">Collapse All</button>
        </div>
      </div>
      
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto bg-slate-950 p-4 space-y-4 custom-scrollbar min-h-0">
          {files.map((file) => {
              const isOpen = openFiles[file.path] !== false;
              const stats = getStats(file.original.content, file.modified.content);
              const hasSelection = Array.from(selectedChunkIds).some((id: string) => id.startsWith(file.path + '-'));

              return (
                  <div key={file.path} className={`border rounded-lg overflow-hidden transition-all ${hasSelection ? 'border-amber-500/50 shadow-[0_0_10px_rgba(245,158,11,0.1)]' : 'border-slate-800'}`}>
                      <div 
                        onClick={() => toggleFile(file.path)}
                        className={`flex items-center justify-between px-3 py-2 cursor-pointer transition-colors ${
                            hasSelection ? 'bg-amber-950/20' : 'bg-slate-900 hover:bg-slate-800'
                        }`}
                      >
                          <div className="flex items-center gap-3">
                              <div className="flex items-center gap-2 select-none">
                                {isOpen ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronRight className="w-3 h-3 text-slate-500" />}
                                <FileCode className={`w-4 h-4 ${hasSelection ? 'text-amber-500' : 'text-cyan-500/70'}`} />
                                <span className={`text-xs font-mono ${hasSelection ? 'text-amber-100' : 'text-slate-200'}`}>{file.path}</span>
                              </div>
                          </div>
                          <div className="flex items-center gap-3 text-[10px] font-mono">
                              {file.agentReasoning && (
                                  <div className="group relative">
                                      <MessageSquare className="w-3.5 h-3.5 text-cyan-400" />
                                  </div>
                              )}
                              <span className="text-emerald-500">+{stats.added}</span>
                              <span className="text-rose-500">-{stats.removed}</span>
                          </div>
                      </div>
                      
                      {isOpen && (
                          <div className="p-0 overflow-x-auto bg-slate-950 font-mono text-[10px] leading-relaxed border-t border-slate-800">
                               {renderInlineDiff(file)}
                          </div>
                      )}
                  </div>
              );
          })}
      </div>
      
      <div className="absolute right-4 bottom-16 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
            <button onClick={scrollToTop} className="p-1.5 bg-slate-800 border border-slate-700 rounded hover:bg-slate-700 text-slate-400 hover:text-white shadow-lg">
                <ArrowUpToLine className="w-3 h-3" />
            </button>
            <button onClick={scrollToBottom} className="p-1.5 bg-slate-800 border border-slate-700 rounded hover:bg-slate-700 text-slate-400 hover:text-white shadow-lg">
                <ArrowDownToLine className="w-3 h-3" />
            </button>
      </div>
    </div>
  );
};
