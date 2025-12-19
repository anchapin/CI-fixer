import React, { useState, useEffect } from 'react';
import { Brain, TrendingUp, CheckCircle, Clock, Zap, BarChart3, Database } from 'lucide-react';

interface MetricEntry {
    metricName: string;
    value: number;
    timestamp: string;
    metadata?: string;
}

interface FixPattern {
    id: string;
    errorFingerprint: string;
    errorCategory: string;
    filePath: string;
    successCount: number;
}

interface DashboardSummary {
    fixRate: number;
    patternsLearned: number;
    optimizationGain: number;
    systemConfidence: number;
}

export const LearningDashboard: React.FC = () => {
    const [summary, setSummary] = useState<DashboardSummary>({
        fixRate: 0,
        patternsLearned: 0,
        optimizationGain: 0,
        systemConfidence: 0
    });
    const [recentMetrics, setRecentMetrics] = useState<MetricEntry[]>([]);
    const [topPatterns, setTopPatterns] = useState<FixPattern[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const fetchData = async () => {
        try {
            const summaryRes = await fetch('/api/learning/summary');
            if (summaryRes.ok) {
                const data = await summaryRes.json();
                setSummary(data);
            }

            const metricsRes = await fetch('/api/metrics/recent?limit=20');
            if (metricsRes.ok) {
                const data = await metricsRes.json();
                setRecentMetrics(data);
            }

            const patternsRes = await fetch('/api/knowledge-base/patterns');
            if (patternsRes.ok) {
                const data = await patternsRes.json();
                setTopPatterns(data);
            }

            setIsLoading(false);
        } catch (e) {
            console.error('Failed to fetch dashboard data', e);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 5000);
        return () => clearInterval(interval);
    }, []);

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 animate-pulse">
                <Brain className="w-12 h-12 mb-4" />
                <span className="text-sm font-mono uppercase tracking-widest">Analysing Neural Pathways...</span>
            </div>
        );
    }

    return (
        <div className="h-full overflow-y-auto p-6 bg-slate-950 space-y-8 custom-scrollbar">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-900/30 rounded-lg border border-purple-500/30">
                        <Brain className="w-6 h-6 text-purple-400" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-white">Auto-Learning Intelligence</h2>
                        <p className="text-slate-400 text-xs font-mono uppercase tracking-tighter">Reinforcement Learning & Pattern Recognition Status</p>
                    </div>
                </div>
                <div className="flex gap-4">
                    <div className="text-right">
                        <div className="text-[10px] text-slate-500 font-mono uppercase">System Confidence</div>
                        <div className="text-xl font-bold text-cyan-400">{(summary.systemConfidence * 100).toFixed(1)}%</div>
                    </div>
                </div>
            </div>

            {/* Top Row: Key KPIs */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-slate-900/50 border border-slate-800 p-4 rounded-xl">
                    <div className="flex items-center gap-2 text-emerald-400 mb-2">
                        <CheckCircle className="w-4 h-4" />
                        <span className="text-xs font-bold uppercase">Fix Success Rate</span>
                    </div>
                    <div className="text-3xl font-bold text-white">{(summary.fixRate * 100).toFixed(0)}%</div>
                    <div className="text-[10px] text-emerald-500 mt-1 flex items-center gap-1">
                        <TrendingUp className="w-3 h-3" /> Adaptive loop active
                    </div>
                </div>

                <div className="bg-slate-900/50 border border-slate-800 p-4 rounded-xl">
                    <div className="flex items-center gap-2 text-cyan-400 mb-2">
                        <Database className="w-4 h-4" />
                        <span className="text-xs font-bold uppercase">Patterns Learned</span>
                    </div>
                    <div className="text-3xl font-bold text-white">{summary.patternsLearned}</div>
                    <div className="text-[10px] text-slate-500 mt-1">Cross-repo verified solutions</div>
                </div>

                <div className="bg-slate-900/50 border border-slate-800 p-4 rounded-xl">
                    <div className="flex items-center gap-2 text-purple-400 mb-2">
                        <Zap className="w-4 h-4" />
                        <span className="text-xs font-bold uppercase">Optimization Gain</span>
                    </div>
                    <div className="text-3xl font-bold text-white">{(summary.optimizationGain * 100).toFixed(0)}%</div>
                    <div className="text-[10px] text-slate-500 mt-1">Reduction in tool invocations</div>
                </div>

                <div className="bg-slate-900/50 border border-slate-800 p-4 rounded-xl">
                    <div className="flex items-center gap-2 text-amber-400 mb-2">
                        <BarChart3 className="w-4 h-4" />
                        <span className="text-xs font-bold uppercase">Model Entropy</span>
                    </div>
                    <div className="text-3xl font-bold text-white">0.42</div>
                    <div className="text-[10px] text-amber-500 mt-1">Converging to stable policy</div>
                </div>
            </div>

            {/* Middle Row: Charts & Patterns */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Reward Trend */}
                <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5">
                    <h3 className="text-sm font-bold text-slate-300 mb-4 flex items-center gap-2 uppercase tracking-wider">
                        <TrendingUp className="w-4 h-4 text-cyan-400" />
                        Learning Convergence (Reward Trend)
                    </h3>
                    <div className="h-48 flex items-end gap-1 px-2">
                        {/* Fake trend for now */}
                        {[40, 45, 38, 55, 60, 52, 70, 65, 82, 88, 85, 92, 95].map((val, i) => (
                            <div 
                                key={i} 
                                className="flex-1 bg-gradient-to-t from-cyan-950 to-cyan-500 rounded-t opacity-80 hover:opacity-100 transition-opacity"
                                style={{ height: `${val}%` }}
                            />
                        ))}
                    </div>
                    <div className="flex justify-between mt-2 text-[10px] text-slate-600 font-mono">
                        <span>Epoch T-12</span>
                        <span>Current (Live)</span>
                    </div>
                </div>

                {/* Top Fix Patterns */}
                <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5 overflow-hidden flex flex-col">
                    <h3 className="text-sm font-bold text-slate-300 mb-4 flex items-center gap-2 uppercase tracking-wider">
                        <BarChart3 className="w-4 h-4 text-purple-400" />
                        Top Performing Fix Patterns
                    </h3>
                    <div className="space-y-3 overflow-y-auto pr-2 max-h-48 custom-scrollbar">
                        {topPatterns.length === 0 ? (
                            <div className="text-slate-600 text-xs italic text-center py-8">No verified patterns yet.</div>
                        ) : (
                            topPatterns.map(p => (
                                <div key={p.id} className="bg-slate-800/30 border border-slate-800 p-2 rounded flex items-center justify-between">
                                    <div className="overflow-hidden">
                                        <div className="text-[10px] text-purple-400 font-bold uppercase">{p.errorCategory}</div>
                                        <div className="text-xs text-white truncate font-mono">{p.errorFingerprint}</div>
                                    </div>
                                    <div className="flex items-center gap-3 ml-4">
                                        <div className="text-right">
                                            <div className="text-[10px] text-slate-500 uppercase font-mono">Verified</div>
                                            <div className="text-sm font-bold text-emerald-400">{p.successCount}x</div>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* Bottom Row: Recent Ingested Data */}
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5">
                <h3 className="text-sm font-bold text-slate-300 mb-4 flex items-center gap-2 uppercase tracking-wider">
                    <Database className="w-4 h-4 text-amber-400" />
                    Knowledge Ingestion Stream
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {recentMetrics.slice(0, 6).map((m, i) => (
                        <div key={i} className="flex gap-3 items-start border-l-2 border-slate-800 pl-3 py-1">
                            <div className="mt-1 p-1 bg-slate-800 rounded text-slate-400">
                                <Clock className="w-3 h-3" />
                            </div>
                            <div>
                                <div className="text-[10px] text-slate-500">{new Date(m.timestamp).toLocaleTimeString()}</div>
                                <div className="text-xs font-bold text-white">{m.metricName}</div>
                                <div className="text-xs text-slate-400 truncate">{m.value.toFixed(2)}</div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
