
import React, { useEffect, useRef, useState, useMemo } from 'react';
import { LogLine, RunGroup } from '../types';
import { Terminal as TerminalIcon, ArrowUpToLine, ArrowDownToLine, Users, Gavel, Cpu, Layers, Copy, Check } from 'lucide-react';

interface TerminalOutputProps {
  lines: LogLine[];
  activeGroups: RunGroup[];
  logLevel: 'info' | 'debug' | 'verbose';
}

export const TerminalOutput: React.FC<TerminalOutputProps> = ({ lines, activeGroups, logLevel }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<string>('ALL'); // 'ALL', 'JUDGE', or group ID
  const [copied, setCopied] = useState(false);
  const shouldAutoScrollRef = useRef(true);

  // Detect user scroll to pause auto-scroll
  const handleScroll = () => {
    if (containerRef.current) {
        const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
        // If user is within 50px of bottom, enable auto-scroll. Otherwise disable.
        const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
        shouldAutoScrollRef.current = isNearBottom;
    }
  };

  // Auto-scroll when new lines appear IN THE ACTIVE TAB
  useEffect(() => {
    if (shouldAutoScrollRef.current) {
        endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [lines, activeTab]);

  const scrollToTop = () => {
    if (containerRef.current) {
        containerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const scrollToBottom = () => {
    if (containerRef.current) {
        containerRef.current.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'smooth' });
        shouldAutoScrollRef.current = true; // Re-enable auto-scroll
    }
  };

  const filteredLines = useMemo(() => {
      let result = lines;
      
      // Filter by Level
      if (logLevel === 'info') {
          // Hide DEBUG and VERBOSE
          result = result.filter(l => l.level !== 'DEBUG' && l.level !== 'VERBOSE');
      } else if (logLevel === 'debug') {
          // Hide VERBOSE only
          result = result.filter(l => l.level !== 'VERBOSE');
      }
      // verbose shows everything

      // Filter by Tab
      if (activeTab !== 'ALL') {
          result = result.filter(l => l.agentId === activeTab);
      }
      
      return result;
  }, [lines, activeTab, logLevel]);

  const handleCopyLogs = async () => {
      const text = filteredLines.map(l => {
          const time = l.timestamp.split('T')[1].substring(0, 8);
          const agent = l.agentName || l.agentId || 'SYSTEM';
          return `[${time}] [${l.level}] [${agent}] ${l.content}`;
      }).join('\n');

      try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
      } catch (err) {
          console.error('Failed to copy logs:', err);
      }
  };

  const getAgentBadge = (line: LogLine) => {
      if (!line.agentId || line.agentId === 'SYSTEM') return null;
      
      let badgeColor = "bg-slate-800 text-slate-400 border-slate-700";
      if (line.agentId === 'JUDGE') badgeColor = "bg-fuchsia-950/40 text-fuchsia-400 border-fuchsia-800";
      else if (line.agentId.startsWith('GROUP')) badgeColor = "bg-cyan-950/40 text-cyan-400 border-cyan-800";

      return (
          <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded border mr-2 select-none whitespace-nowrap ${badgeColor}`}>
              {line.agentName || line.agentId}
          </span>
      );
  };

  return (
    <div className="terminal-output flex flex-col h-full bg-slate-950 border border-slate-700 rounded-lg overflow-hidden font-mono shadow-[0_0_20px_rgba(0,0,0,0.5)] relative group">
      
      {/* Header & Tabs */}
      <div className="flex flex-col bg-slate-900 border-b border-slate-700 flex-none">
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800">
            <div className="flex items-center">
                <TerminalIcon className="w-4 h-4 text-emerald-500 mr-2" />
                <span className="text-xs font-bold text-emerald-500 uppercase tracking-wider">Agent.stdout</span>
            </div>
            <button 
                onClick={handleCopyLogs}
                disabled={filteredLines.length === 0}
                className="flex items-center gap-1.5 text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white px-2 py-1 rounded border border-slate-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                title="Copy visible logs to clipboard"
            >
                {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                {copied ? "COPIED" : "COPY LOGS"}
            </button>
          </div>
          
          {/* Tab Bar */}
          <div className="flex items-center gap-1 px-2 pt-2 overflow-x-auto custom-scrollbar no-scrollbar">
              {/* ALL Tab */}
              <button
                onClick={() => setActiveTab('ALL')}
                className={`px-3 py-1.5 text-[10px] font-bold uppercase rounded-t border-t border-x transition-colors flex items-center gap-2 ${
                    activeTab === 'ALL' 
                    ? 'bg-slate-950 border-slate-700 text-slate-200 border-b-slate-950 mb-[-1px] z-10' 
                    : 'bg-slate-900 border-transparent text-slate-500 hover:text-slate-300 hover:bg-slate-800'
                }`}
              >
                 <Layers className="w-3 h-3" /> ALL
              </button>

              {/* Group Tabs */}
              {activeGroups.map(group => (
                  <button
                    key={group.id}
                    onClick={() => setActiveTab(group.id)}
                    className={`px-3 py-1.5 text-[10px] font-bold uppercase rounded-t border-t border-x transition-colors flex items-center gap-2 whitespace-nowrap ${
                        activeTab === group.id 
                        ? 'bg-slate-950 border-slate-700 text-cyan-400 border-b-slate-950 mb-[-1px] z-10' 
                        : 'bg-slate-900 border-transparent text-slate-500 hover:text-cyan-300 hover:bg-slate-800'
                    }`}
                  >
                     <Cpu className="w-3 h-3" /> {group.name}
                  </button>
              ))}

              {/* Judge Tab (Only show if there are judge logs) */}
              {lines.some(l => l.agentId === 'JUDGE') && (
                  <button
                    onClick={() => setActiveTab('JUDGE')}
                    className={`px-3 py-1.5 text-[10px] font-bold uppercase rounded-t border-t border-x transition-colors flex items-center gap-2 ${
                        activeTab === 'JUDGE' 
                        ? 'bg-slate-950 border-slate-700 text-fuchsia-400 border-b-slate-950 mb-[-1px] z-10' 
                        : 'bg-slate-900 border-transparent text-slate-500 hover:text-fuchsia-300 hover:bg-slate-800'
                    }`}
                  >
                     <Gavel className="w-3 h-3" /> JUDGE
                  </button>
              )}
          </div>
      </div>

      {/* Content Area */}
      <div 
          ref={containerRef} 
          onScroll={handleScroll}
          className="flex-1 p-4 overflow-y-auto space-y-2 custom-scrollbar min-h-0 relative z-0 bg-slate-950"
      >
        {lines.length === 0 && (
            <div className="text-slate-600 italic text-xs">Waiting for agent initialization...</div>
        )}
        
        {filteredLines.map((line) => (
          <div key={line.id} className="flex items-start text-xs animate-[slideIn_0.1s_ease-out] hover:bg-white/5 py-0.5 -mx-2 px-2 rounded">
            <span className="text-slate-600 mr-2 min-w-[60px] font-mono text-[10px] pt-0.5">{line.timestamp.split('T')[1].substring(0, 8)}</span>
            
            {/* Show badge only in ALL view */}
            {activeTab === 'ALL' && getAgentBadge(line)}

            <div className="flex-1 break-all">
                <span className={`mr-2 font-bold ${
                line.level === 'INFO' ? 'text-cyan-600' :
                line.level === 'WARN' ? 'text-amber-600' :
                line.level === 'ERROR' ? 'text-rose-600' :
                line.level === 'SUCCESS' ? 'text-emerald-500' : 
                line.level === 'VERBOSE' ? 'text-slate-500' :
                line.level === 'DEBUG' ? 'text-slate-600' : 'text-slate-500'
                }`}>
                [{line.level}]
                </span>
                <span className={line.level === 'VERBOSE' ? 'text-slate-400 font-normal' : 'text-slate-300'}>
                    {line.content}
                </span>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

       {/* Jump Controls */}
       <div className="absolute right-4 bottom-4 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-20">
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
  );
};
