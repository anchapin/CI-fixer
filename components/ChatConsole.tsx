import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, RotateCcw, Zap, ArrowUpToLine, ArrowDownToLine } from 'lucide-react';
import { ChatMessage } from '../types';

interface ChatConsoleProps {
  messages: ChatMessage[];
  onSendMessage: (msg: string) => void;
  onReevaluate: () => void;
  isProcessing: boolean;
  canReevaluate: boolean;
}

export const ChatConsole: React.FC<ChatConsoleProps> = ({ messages, onSendMessage, onReevaluate, isProcessing, canReevaluate }) => {
  const [input, setInput] = useState('');
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;
    onSendMessage(input);
    setInput('');
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 border border-slate-700 rounded-lg overflow-hidden font-mono shadow-[0_0_20px_rgba(0,0,0,0.5)] relative group">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-700 flex-none">
        <div className="flex items-center">
            <Bot className="w-4 h-4 text-purple-400 mr-2" />
            <span className="text-xs font-bold text-purple-400 uppercase tracking-wider">Operator Comms</span>
        </div>
        {canReevaluate && (
            <button 
                onClick={onReevaluate}
                disabled={isProcessing}
                className="flex items-center text-[10px] bg-amber-950/50 hover:bg-amber-900 text-amber-500 border border-amber-800 rounded px-2 py-1 transition-all disabled:opacity-50"
                title="Force Agent to try a different solution"
            >
                <RotateCcw className={`w-3 h-3 mr-1 ${isProcessing ? 'animate-spin' : ''}`} />
                {isProcessing ? 'THINKING...' : 'RE-EVALUATE FIX'}
            </button>
        )}
      </div>

      {/* Messages Area */}
      <div ref={containerRef} className="flex-1 p-4 overflow-y-auto space-y-3 bg-slate-950 min-h-0 custom-scrollbar">
        {messages.length === 0 && (
            <div className="text-slate-600 italic text-xs text-center mt-4">
                Secure channel established.<br/>
                Type to guide the agent or request changes.
            </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded p-2 text-xs border ${
                msg.sender === 'user' 
                ? 'bg-slate-800 border-slate-700 text-slate-200' 
                : 'bg-purple-950/20 border-purple-900/50 text-purple-200'
            }`}>
               <div className="flex items-center gap-2 mb-1 opacity-50 text-[10px] uppercase">
                   {msg.sender === 'user' ? <User className="w-3 h-3"/> : <Bot className="w-3 h-3"/>}
                   <span>{msg.sender}</span>
                   <span className="ml-auto">{msg.timestamp.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
               </div>
               <div className="whitespace-pre-wrap leading-relaxed">
                   {msg.text}
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
            onChange={(e) => setInput(e.target.value)}
            disabled={isProcessing}
            placeholder={canReevaluate ? "Feedback / Instructions..." : "Enter command..."}
            className="flex-1 bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/50 font-mono placeholder-slate-600"
        />
        <button 
            type="submit" 
            disabled={isProcessing || !input.trim()}
            className="bg-purple-600 hover:bg-purple-500 text-white px-3 py-2 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
            <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
};