
import React, { useState } from 'react';
import { AgentPhase, AgentState } from '../types';
import { Code, CheckCircle, Search, Beaker, Library, GitBranch, Wrench, ShieldAlert, Lock, Unlock, Terminal, Brain, Repeat, ChevronDown, ChevronUp } from 'lucide-react';
import { MetricsDisplay } from './MetricsDisplay';

interface AgentStatusProps {
    agentStates: Record<string, AgentState>;
    globalPhase?: AgentPhase;
    selectedAgentId: string | 'CONSOLIDATED' | null;
    onSelectAgent: (id: string | 'CONSOLIDATED') => void;
}

export const AgentStatus: React.FC<AgentStatusProps> = ({ agentStates, globalPhase, selectedAgentId, onSelectAgent }) => {
    const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());

    const steps = [
        { id: AgentPhase.UNDERSTAND, label: 'Scan', icon: Search },
        { id: AgentPhase.REPRODUCE, label: 'Repro', icon: Repeat },
        { id: AgentPhase.EXPLORE, label: 'Shell', icon: Terminal },
        { id: AgentPhase.PLAN, label: 'Plan', icon: Brain },
        { id: AgentPhase.PLAN_APPROVAL, label: 'Auth', icon: ShieldAlert },
        { id: AgentPhase.ACQUIRE_LOCK, label: 'Lock', icon: Lock },
        { id: AgentPhase.IMPLEMENT, label: 'Fix', icon: Code },
        { id: AgentPhase.VERIFY, label: 'Judge', icon: CheckCircle },
        { id: AgentPhase.TESTING, label: 'Box', icon: Beaker },
    ];

    const activeAgentKeys = Object.keys(agentStates);

    if (activeAgentKeys.length === 0) {
        if (globalPhase === AgentPhase.IDLE) return <div className="text-slate-600 text-[10px] text-center uppercase tracking-widest py-2">System Idle</div>;

        return (
            <div className="flex flex-col items-center justify-center py-2 animate-pulse">
                <Library className="w-5 h-5 text-cyan-500 mb-2" />
                <span className="text-cyan-400 text-xs font-mono uppercase">Initializing Context...</span>
            </div>
        );
    }

    const toggleExpand = (agentId: string) => {
        setExpandedAgents(prev => {
            const next = new Set(prev);
            if (next.has(agentId)) {
                next.delete(agentId);
            } else {
                next.add(agentId);
            }
            return next;
        });
    };

    return (
        <div className="w-full space-y-3 px-2">
            {/* Header Row */}
            <div key="header-row" className="grid grid-cols-[80px_1fr_40px] gap-2 items-center text-[9px] font-mono text-slate-500 uppercase border-b border-slate-800 pb-1">
                <div>Agent</div>
                <div className="flex justify-between px-2">
                    {steps.map(s => <span key={`step-label-${s.id}`}>{s.label}</span>)}
                </div>
                <div className="text-center">Iter</div>
            </div>

            {/* Agent Rows */}
            {Object.values(agentStates).map((agent: AgentState) => {
                const isSuccess = agent.status === 'success';
                const isFailed = agent.status === 'failed';
                const isSelected = selectedAgentId === agent.groupId;
                const hasLocks = agent.fileReservations && agent.fileReservations.length > 0;

                return (
                    <React.Fragment key={`agent-fragment-${agent.groupId}`}>
                        <div
                            key={`agent-row-${agent.groupId}`}
                            onClick={() => onSelectAgent(agent.groupId)}
                            className={`grid grid-cols-[80px_1fr_40px] gap-2 items-center group cursor-pointer rounded p-1 transition-all ${isSelected ? 'bg-slate-800 ring-1 ring-cyan-500/50' : 'hover:bg-slate-900'
                                }`}
                        >
                            {/* Agent Name Badge */}
                            <div className="flex flex-col justify-center overflow-hidden">
                                <div className="flex items-center gap-2">
                                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 transition-shadow ${isSuccess ? 'bg-emerald-500 shadow-[0_0_5px_#10b981]' :
                                        isFailed ? 'bg-rose-500 shadow-[0_0_5px_#f43f5e]' :
                                            'bg-cyan-500 animate-pulse'
                                        }`} />
                                    <span className={`text-[10px] font-bold truncate ${isSelected ? 'text-cyan-300' : 'text-slate-300'}`} title={agent.name}>
                                        {agent.name}
                                    </span>
                                </div>
                                {/* File Lock Indicator */}
                                {hasLocks && (
                                    <div className="flex items-center gap-1 mt-0.5 animate-[fadeIn_0.3s_ease-out]">
                                        <Lock className="w-2 h-2 text-amber-500" />
                                        <span className="text-[8px] font-mono text-amber-500 truncate max-w-[70px]">
                                            {agent.fileReservations![0].split('/').pop()}
                                        </span>
                                    </div>
                                )}
                            </div>

                            {/* Progress Track */}
                            <div className="relative h-6 bg-slate-900/50 rounded-full border border-slate-800 flex items-center px-1">
                                <div className="absolute left-2 right-2 top-1/2 h-0.5 bg-slate-800 -z-0" />

                                <div className="w-full flex justify-between z-10 relative">
                                    {steps.map((step) => {
                                        const stepIndex = steps.findIndex(s => s.id === step.id);
                                        const currentIndex = steps.findIndex(s => s.id === agent.phase);

                                        let isPassed = false;
                                        if (isSuccess) isPassed = true;
                                        else if (isFailed && agent.phase === AgentPhase.FAILURE) {
                                            isPassed = false;
                                        }
                                        else if (currentIndex > stepIndex) isPassed = true;

                                        if (step.id === AgentPhase.PLAN_APPROVAL && (
                                            agent.phase === AgentPhase.ACQUIRE_LOCK ||
                                            agent.phase === AgentPhase.IMPLEMENT ||
                                            currentIndex > stepIndex
                                        )) isPassed = true;

                                        const isCurrent = agent.phase === step.id;

                                        return (
                                            <div key={`agent-${agent.groupId}-step-${step.id}`} className="flex flex-col items-center justify-center w-6 relative">
                                                <div className={`w-2 h-2 rounded-full transition-all duration-300 ${isCurrent
                                                    ? (isFailed ? 'bg-rose-500 scale-125' : 'bg-cyan-400 scale-125 shadow-[0_0_8px_#22d3ee]')
                                                    : isPassed
                                                        ? 'bg-slate-600'
                                                        : 'bg-slate-800 border border-slate-700'
                                                    }`} />
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Iteration Count */}
                            <div className="flex items-center justify-center gap-1">
                                <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded flex items-center gap-1 ${agent.iteration > 0
                                    ? 'bg-purple-950/40 text-purple-400 border border-purple-900/50 shadow-[0_0_5px_rgba(168,85,247,0.2)]'
                                    : 'text-slate-600'
                                    }`}>
                                    {agent.iteration > 0 && <Repeat className="w-2 h-2" />}
                                    v{agent.iteration + 1}
                                </span>
                                {/* Expand/Collapse Button */}
                                {(agent.totalCost || agent.rewardHistory?.length) && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            toggleExpand(agent.groupId);
                                        }}
                                        className="p-0.5 hover:bg-slate-700 rounded transition-colors"
                                    >
                                        {expandedAgents.has(agent.groupId) ? (
                                            <ChevronUp className="w-3 h-3 text-slate-400" />
                                        ) : (
                                            <ChevronDown className="w-3 h-3 text-slate-400" />
                                        )}
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Expanded Metrics Panel */}
                        {
                            expandedAgents.has(agent.groupId) && (
                                <div key={`metrics-${agent.groupId}`} className="col-span-3 mt-2 animate-[fadeIn_0.3s_ease-out]">
                                    <MetricsDisplay
                                        metrics={{
                                            totalCost: agent.totalCost,
                                            totalLatency: agent.totalLatency,
                                            selectedTools: agent.selectedTools,
                                            selectedModel: agent.selectedModel,
                                            rewardHistory: agent.rewardHistory,
                                            budgetRemaining: agent.budgetRemaining
                                        }}
                                    />
                                </div>
                            )
                        }
                    </React.Fragment>
                );
            })}

            {/* Merged View Button (Only appears if we have agents) */}
            {activeAgentKeys.length > 0 && (
                <div
                    key="merged-view-button"
                    onClick={() => onSelectAgent('CONSOLIDATED')}
                    className={`flex items-center justify-center gap-2 p-2 mt-4 rounded border border-dashed cursor-pointer transition-all ${selectedAgentId === 'CONSOLIDATED'
                        ? 'bg-purple-900/20 border-purple-500/50 text-purple-300'
                        : 'border-slate-800 text-slate-500 hover:text-slate-300 hover:border-slate-600'
                        }`}
                >
                    <GitBranch className="w-3 h-3" />
                    <span className="text-[10px] font-bold uppercase tracking-wider">
                        {globalPhase === AgentPhase.CONSOLIDATE || globalPhase === AgentPhase.SUCCESS
                            ? "View Merged Master"
                            : "Wait for Consolidation..."}
                    </span>
                </div>
            )}
        </div>
    );
};
