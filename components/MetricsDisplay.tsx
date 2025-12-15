import React from 'react';
import { DollarSign, Clock, Zap, Award, TrendingUp, TrendingDown } from 'lucide-react';

export interface ToolOrchestraMetrics {
    totalCost?: number;
    totalLatency?: number;
    selectedTools?: string[];
    selectedModel?: string;
    rewardHistory?: number[];
    budgetRemaining?: number;
}

interface MetricsDisplayProps {
    metrics: ToolOrchestraMetrics;
    compact?: boolean;
}

export const MetricsDisplay: React.FC<MetricsDisplayProps> = ({ metrics, compact = false }) => {
    const {
        totalCost = 0,
        totalLatency = 0,
        selectedTools = [],
        selectedModel,
        rewardHistory = [],
        budgetRemaining
    } = metrics;

    const latestReward = rewardHistory.length > 0 ? rewardHistory[rewardHistory.length - 1] : null;
    const rewardTrend = rewardHistory.length > 1
        ? rewardHistory[rewardHistory.length - 1] - rewardHistory[rewardHistory.length - 2]
        : 0;

    if (compact) {
        return (
            <div className="flex items-center gap-3 text-xs">
                {totalCost > 0 && (
                    <div className="flex items-center gap-1 text-emerald-400">
                        <DollarSign className="w-3 h-3" />
                        <span>${totalCost.toFixed(4)}</span>
                    </div>
                )}
                {latestReward !== null && (
                    <div className={`flex items-center gap-1 ${latestReward > 80 ? 'text-emerald-400' : latestReward > 50 ? 'text-amber-400' : 'text-red-400'}`}>
                        <Award className="w-3 h-3" />
                        <span>{latestReward.toFixed(1)}</span>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                    <Zap className="w-4 h-4 text-cyan-400" />
                    ToolOrchestra Metrics
                </h3>
                {budgetRemaining !== undefined && (
                    <span className="text-xs text-slate-400">
                        Budget: ${budgetRemaining.toFixed(3)}
                    </span>
                )}
            </div>

            <div className="grid grid-cols-2 gap-3">
                {/* Cost */}
                <div className="bg-slate-800/50 rounded p-2">
                    <div className="flex items-center gap-1.5 text-emerald-400 mb-1">
                        <DollarSign className="w-3.5 h-3.5" />
                        <span className="text-xs font-medium">Cost</span>
                    </div>
                    <div className="text-lg font-bold text-white">
                        ${totalCost.toFixed(4)}
                    </div>
                </div>

                {/* Latency */}
                <div className="bg-slate-800/50 rounded p-2">
                    <div className="flex items-center gap-1.5 text-cyan-400 mb-1">
                        <Clock className="w-3.5 h-3.5" />
                        <span className="text-xs font-medium">Latency</span>
                    </div>
                    <div className="text-lg font-bold text-white">
                        {(totalLatency / 1000).toFixed(1)}s
                    </div>
                </div>

                {/* Reward */}
                {latestReward !== null && (
                    <div className="bg-slate-800/50 rounded p-2 col-span-2">
                        <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-1.5 text-purple-400">
                                <Award className="w-3.5 h-3.5" />
                                <span className="text-xs font-medium">Reward Score</span>
                            </div>
                            {rewardTrend !== 0 && (
                                <div className={`flex items-center gap-1 text-xs ${rewardTrend > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {rewardTrend > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                                    {Math.abs(rewardTrend).toFixed(1)}
                                </div>
                            )}
                        </div>
                        <div className="flex items-baseline gap-2">
                            <div className={`text-2xl font-bold ${latestReward > 80 ? 'text-emerald-400' : latestReward > 50 ? 'text-amber-400' : 'text-red-400'}`}>
                                {latestReward.toFixed(1)}
                            </div>
                            <div className="text-xs text-slate-400">/ 100</div>
                        </div>
                        {/* Reward bar */}
                        <div className="mt-2 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                            <div
                                className={`h-full transition-all duration-500 ${latestReward > 80 ? 'bg-emerald-400' : latestReward > 50 ? 'bg-amber-400' : 'bg-red-400'}`}
                                style={{ width: `${Math.max(0, Math.min(100, latestReward))}%` }}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Selected Tools */}
            {selectedTools.length > 0 && (
                <div>
                    <div className="text-xs font-medium text-slate-400 mb-1.5">Tools Used</div>
                    <div className="flex flex-wrap gap-1.5">
                        {selectedTools.map((tool, idx) => (
                            <span
                                key={idx}
                                className="text-xs px-2 py-0.5 bg-cyan-950/50 text-cyan-300 border border-cyan-900 rounded"
                            >
                                {tool.replace(/_/g, ' ')}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Selected Model */}
            {selectedModel && (
                <div>
                    <div className="text-xs font-medium text-slate-400 mb-1">Model</div>
                    <div className="text-sm font-mono text-purple-300 bg-purple-950/30 border border-purple-900 rounded px-2 py-1 inline-block">
                        {selectedModel}
                    </div>
                </div>
            )}

            {/* Reward History Sparkline */}
            {rewardHistory.length > 1 && (
                <div>
                    <div className="text-xs font-medium text-slate-400 mb-1.5">Reward Trend</div>
                    <div className="h-12 flex items-end gap-0.5">
                        {rewardHistory.map((reward, idx) => {
                            const height = Math.max(5, (reward / 100) * 100);
                            const color = reward > 80 ? 'bg-emerald-400' : reward > 50 ? 'bg-amber-400' : 'bg-red-400';
                            return (
                                <div
                                    key={idx}
                                    className={`flex-1 ${color} rounded-t transition-all duration-300`}
                                    style={{ height: `${height}%` }}
                                    title={`Iteration ${idx + 1}: ${reward.toFixed(1)}`}
                                />
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};
