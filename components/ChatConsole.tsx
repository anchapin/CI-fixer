
import React, { useRef, useEffect } from 'react';
import { Send, Bot, User, RotateCcw, ArrowUpToLine, ArrowDownToLine } from 'lucide-react';
// import { ChatMessage } from '../types'; // Deprecated in favor of useChat types

interface ChatConsoleProps {
  messages: { id: string; role: 'user' | 'assistant' | 'system' | 'data'; content: string }[];
  input: string;
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement> | React.ChangeEvent<HTMLTextAreaElement>) => void;
  handleSubmit: (e: React.FormEvent) => void;
  onReevaluate: () => void;
  isLoading: boolean;
  hasSelectedChunks: boolean;
  selectedAgentName?: string;
}

export const ChatConsole: React.FC<ChatConsoleProps> = ({
  messages,
  input,
  handleInputChange,
  handleSubmit,
  onReevaluate,
  isLoading,
  hasSelectedChunks,
  selectedAgentName
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const scrollToTop = () => {
    if (containerRef.current) {
      containerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const scrollToBottom = () => {
    if (containerRef.current) {
      containerRef.current.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'smooth' });
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 border border-slate-700 rounded-lg overflow-hidden font-mono shadow-[0_0_20px_rgba(0,0,0,0.5)] relative group">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-700 flex-none">
        <div className="flex items-center">
          <Bot className="w-4 h-4 text-purple-400 mr-2" />
          <span className="text-xs font-bold text-purple-400 uppercase tracking-wider">
            {selectedAgentName ? `Comms: ${selectedAgentName}` : 'Command Console'}
          </span>
        </div>
        <button
          onClick={onReevaluate}
          disabled={isLoading || !hasSelectedChunks}
          className={`flex items-center text-[10px] border rounded px-2 py-1 transition-all ${hasSelectedChunks
              ? 'bg-amber-950/50 hover:bg-amber-900 text-amber-500 border-amber-800 cursor-pointer'
              : 'bg-slate-900 text-slate-600 border-slate-800 cursor-not-allowed'
            }`}
          title={hasSelectedChunks ? "Refine the selected code chunks" : "Select lines in Diff View to refine"}
        >
          <RotateCcw className={`w-3 h-3 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
          {isLoading ? 'THINKING...' : 'REFINE SELECTION'}
        </button>
      </div>

      {/* Messages Area */}
      <div ref={containerRef} className="flex-1 p-4 overflow-y-auto space-y-3 bg-slate-950 min-h-0 custom-scrollbar">
        {messages.length === 0 && (
          <div className="text-slate-600 italic text-xs text-center mt-4">
            Channel Secure.<br />
            Chat is for Q&A only. To modify code, use the Diff View.
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded p-2 text-xs border ${msg.role === 'user'
                ? 'bg-slate-800 border-slate-700 text-slate-200'
                : 'bg-purple-950/20 border-purple-900/50 text-purple-200'
              }`}>
              <div className="flex items-center gap-2 mb-1 opacity-50 text-[10px] uppercase">
                {msg.role === 'user' ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
                <span>{msg.role === 'assistant' ? 'agent' : msg.role}</span>
                {/* Timestamp not strictly available in simple message type, omitted */}
              </div>
              <div className="whitespace-pre-wrap leading-relaxed">
                {msg.content}
              </div>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {/* Jump Controls */}
      <div className="absolute right-4 bottom-16 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
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

      {/* Input Area */}
      <form onSubmit={handleSubmit} className="p-2 bg-slate-900 border-t border-slate-700 flex gap-2 flex-none">
        <input
          type="text"
          value={input}
          onChange={handleInputChange}
          disabled={isLoading}
          placeholder={hasSelectedChunks ? "Instruction for refinement..." : "Ask a question about the build..."}
          className="flex-1 bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/50 font-mono placeholder-slate-600"
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="bg-purple-600 hover:bg-purple-500 text-white px-3 py-2 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
};
