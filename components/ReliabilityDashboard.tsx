import React, { useState, useEffect } from 'react';
import {
    Shield,
    AlertTriangle,
    TrendingUp,
    Activity,
    Settings,
    RefreshCw,
    CheckCircle,
    XCircle,
    BarChart3,
    Zap,
    Clock
} from 'lucide-react';

interface LayerMetrics {
    totalEvents: number;
    triggeredEvents: number;
    triggerRate: number;
    recoveryAttempts: number;
    recoverySuccesses: number;
    recoverySuccessRate: number;
}

interface StrategyStats {
    availableStrategies: string[];
    topStrategies: Array<{
        strategy: string;
        successRate: number;
        attempts: number;
    }>;
}

interface ThresholdConfig {
    enabled: boolean;
    phase2ReproductionThreshold: { min: number; max: number; current: number; learningRate: number };
    phase3ComplexityThreshold: { min: number; max: number; current: number; learningRate: number };
    phase3IterationThreshold: { min: number; max: number; current: number; learningRate: number };
}

interface DashboardData {
    phase2: LayerMetrics | null;
    phase3: LayerMetrics | null;
    overall: {
        totalEvents: number;
        totalTriggered: number;
        totalRecovered: number;
    };
    phase2CurrentThreshold: number;
    phase3ComplexityThreshold: number;
    phase3IterationThreshold: number;
}

interface ThresholdData {
    thresholds: ThresholdConfig;
    phase2Metrics: LayerMetrics | null;
    phase3Metrics: LayerMetrics | null;
    phase2Strategies: StrategyStats;
    phase3Strategies: StrategyStats;
}

export const ReliabilityDashboard: React.FC = () => {
    const [dashboard, setDashboard] = useState<DashboardData | null>(null);
    const [thresholdData, setThresholdData] = useState<ThresholdData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
    const [isAnalyzing, setIsAnalyzing] = useState(false);

    const fetchData = async () => {
        try {
            const [dashRes, threshRes] = await Promise.all([
                fetch('/api/reliability/dashboard'),
                fetch('/api/reliability/thresholds')
            ]);

            if (dashRes.ok) {
                const data = await dashRes.json();
                setDashboard(data);
            }

            if (threshRes.ok) {
                const data = await threshRes.json();
                setThresholdData(data);
            }

            setLastUpdate(new Date());
            setIsLoading(false);
        } catch (e) {
            console.error('Failed to fetch reliability data', e);
            setIsLoading(false);
        }
    };

    const analyzeThresholds = async () => {
        setIsAnalyzing(true);
        try {
            const res = await fetch('/api/reliability/thresholds/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ minDataPoints: 30 })
            });

            if (res.ok) {
                const data = await res.json();
                // Refresh data after analysis
                await fetchData();
            }
        } catch (e) {
            console.error('Failed to analyze thresholds', e);
        } finally {
            setIsAnalyzing(false);
        }
    };

    const resetThresholds = async () => {
        if (!confirm('Are you sure you want to reset all thresholds to default values?')) return;

        try {
            const res = await fetch('/api/reliability/thresholds/reset', {
                method: 'POST'
            });

            if (res.ok) {
                await fetchData();
            }
        } catch (e) {
            console.error('Failed to reset thresholds', e);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 10000); // Refresh every 10s
        return () => clearInterval(interval);
    }, []);

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 animate-pulse">
                <Shield className="w-12 h-12 mb-4" />
                <span className="text-sm font-mono uppercase tracking-widest">Loading Reliability Data...</span>
            </div>
        );
    }

    const formatRate = (rate: number) => (rate * 100).toFixed(1);
    const formatNumber = (num: number) => num.toLocaleString();

    return (
        <div className="h-full overflow-y-auto p-6 bg-slate-950 space-y-6 custom-scrollbar">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-emerald-900/30 rounded-lg border border-emerald-500/30">
                        <Shield className="w-6 h-6 text-emerald-400" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-white">Reliability Dashboard</h2>
                        <p className="text-slate-400 text-xs font-mono uppercase tracking-tighter">
                            Multi-Layer Agent Reliability Monitoring
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <div className="text-right">
                        <div className="text-[10px] text-slate-500 font-mono uppercase">Last Update</div>
                        <div className="text-xs text-slate-400 font-mono">
                            {lastUpdate.toLocaleTimeString()}
                        </div>
                    </div>
                    <button
                        onClick={fetchData}
                        className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition-colors"
                        title="Refresh"
                    >
                        <RefreshCw className="w-4 h-4 text-slate-400" />
                    </button>
                </div>
            </div>

            {/* Top Row: Key Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {/* Total Events */}
                <div className="bg-slate-900/50 rounded-lg border border-slate-800 p-4">
                    <div className="flex items-center justify-between mb-2">
                        <Activity className="w-5 h-5 text-blue-400" />
                        <span className="text-[10px] text-slate-500 font-mono uppercase">Total Events</span>
                    </div>
                    <div className="text-2xl font-bold text-white">
                        {dashboard ? formatNumber(dashboard.overall.totalEvents) : '0'}
                    </div>
                </div>

                {/* Triggers */}
                <div className="bg-slate-900/50 rounded-lg border border-slate-800 p-4">
                    <div className="flex items-center justify-between mb-2">
                        <AlertTriangle className="w-5 h-5 text-orange-400" />
                        <span className="text-[10px] text-slate-500 font-mono uppercase">Triggers</span>
                    </div>
                    <div className="text-2xl font-bold text-white">
                        {dashboard ? formatNumber(dashboard.overall.totalTriggered) : '0'}
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                        {dashboard ? `${formatRate(dashboard.overall.totalTriggered / dashboard.overall.totalEvents)}% rate` : '-'}
                    </div>
                </div>

                {/* Recoveries */}
                <div className="bg-slate-900/50 rounded-lg border border-slate-800 p-4">
                    <div className="flex items-center justify-between mb-2">
                        <CheckCircle className="w-5 h-5 text-emerald-400" />
                        <span className="text-[10px] text-slate-500 font-mono uppercase">Recovered</span>
                    </div>
                    <div className="text-2xl font-bold text-white">
                        {dashboard ? formatNumber(dashboard.overall.totalRecovered) : '0'}
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                        {dashboard && dashboard.overall.totalTriggered > 0
                            ? `${formatRate(dashboard.overall.totalRecovered / dashboard.overall.totalTriggered)}% success`
                            : '-'}
                    </div>
                </div>

                {/* Recovery Rate */}
                <div className="bg-slate-900/50 rounded-lg border border-slate-800 p-4">
                    <div className="flex items-center justify-between mb-2">
                        <Zap className="w-5 h-5 text-purple-400" />
                        <span className="text-[10px] text-slate-500 font-mono uppercase">Recovery Rate</span>
                    </div>
                    <div className="text-2xl font-bold text-white">
                        {dashboard && dashboard.phase2
                            ? `${formatRate(dashboard.phase2.recoverySuccessRate)}%`
                            : '-'}
                    </div>
                    <div className="text-xs text-slate-400 mt-1">Phase 2</div>
                </div>
            </div>

            {/* Phase 2 & Phase 3 Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Phase 2: Reproduction-First */}
                <div className="bg-slate-900/30 rounded-lg border border-slate-800 p-4">
                    <div className="flex items-center gap-2 mb-4">
                        <div className="p-1.5 bg-blue-900/30 rounded border border-blue-500/30">
                            <AlertTriangle className="w-4 h-4 text-blue-400" />
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-white">Phase 2: Reproduction-First</h3>
                            <p className="text-[10px] text-slate-500 font-mono uppercase">Reproduction Command Validation</p>
                        </div>
                    </div>

                    {dashboard?.phase2 ? (
                        <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <div className="text-[10px] text-slate-500 uppercase">Trigger Rate</div>
                                    <div className="text-lg font-bold text-orange-400">
                                        {formatRate(dashboard.phase2.triggerRate)}%
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[10px] text-slate-500 uppercase">Current Threshold</div>
                                    <div className="text-lg font-bold text-cyan-400">
                                        {dashboard.phase2CurrentThreshold}
                                    </div>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <div className="text-[10px] text-slate-500 uppercase">Recovery Attempts</div>
                                    <div className="text-lg font-bold text-purple-400">
                                        {dashboard.phase2.recoveryAttempts}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[10px] text-slate-500 uppercase">Success Rate</div>
                                    <div className="text-lg font-bold text-emerald-400">
                                        {formatRate(dashboard.phase2.recoverySuccessRate)}%
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="text-slate-500 text-sm">No data available</div>
                    )}
                </div>

                {/* Phase 3: Strategy Loop Detection */}
                <div className="bg-slate-900/30 rounded-lg border border-slate-800 p-4">
                    <div className="flex items-center gap-2 mb-4">
                        <div className="p-1.5 bg-red-900/30 rounded border border-red-500/30">
                            <Activity className="w-4 h-4 text-red-400" />
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-white">Phase 3: Strategy Loop Detection</h3>
                            <p className="text-[10px] text-slate-500 font-mono uppercase">Complexity-Based Loop Prevention</p>
                        </div>
                    </div>

                    {dashboard?.phase3 ? (
                        <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <div className="text-[10px] text-slate-500 uppercase">Trigger Rate</div>
                                    <div className="text-lg font-bold text-orange-400">
                                        {formatRate(dashboard.phase3.triggerRate)}%
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[10px] text-slate-500 uppercase">Complexity Threshold</div>
                                    <div className="text-lg font-bold text-cyan-400">
                                        {dashboard.phase3ComplexityThreshold}
                                    </div>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <div className="text-[10px] text-slate-500 uppercase">Iteration Threshold</div>
                                    <div className="text-lg font-bold text-cyan-400">
                                        {dashboard.phase3IterationThreshold}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[10px] text-slate-500 uppercase">Total Events</div>
                                    <div className="text-lg font-bold text-slate-300">
                                        {dashboard.phase3.totalEvents}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="text-slate-500 text-sm">No data available</div>
                    )}
                </div>
            </div>

            {/* Threshold Management */}
            <div className="bg-slate-900/30 rounded-lg border border-slate-800 p-4">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <Settings className="w-5 h-5 text-slate-400" />
                        <div>
                            <h3 className="text-sm font-bold text-white">Adaptive Thresholds</h3>
                            <p className="text-[10px] text-slate-500 font-mono uppercase">Automatic Threshold Optimization</p>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={analyzeThresholds}
                            disabled={isAnalyzing || !thresholdData?.thresholds.enabled}
                            className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-800 disabled:text-slate-600 rounded text-xs font-medium text-white transition-colors"
                        >
                            <RefreshCw className={`w-3 h-3 ${isAnalyzing ? 'animate-spin' : ''}`} />
                            Analyze & Adjust
                        </button>
                        <button
                            onClick={resetThresholds}
                            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-xs font-medium text-white transition-colors"
                        >
                            Reset to Defaults
                        </button>
                    </div>
                </div>

                {thresholdData?.thresholds ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* Phase 2 Threshold */}
                        <div className="bg-slate-800/50 rounded p-3 border border-slate-700">
                            <div className="text-[10px] text-slate-500 uppercase mb-2">Phase 2 Reproduction</div>
                            <div className="text-sm font-mono text-white">
                                Min: {thresholdData.thresholds.phase2ReproductionThreshold.min} |
                                Current: <span className="text-cyan-400 font-bold">{thresholdData.thresholds.phase2ReproductionThreshold.current}</span> |
                                Max: {thresholdData.thresholds.phase2ReproductionThreshold.max}
                            </div>
                            <div className="text-[10px] text-slate-500 mt-2">
                                Learning Rate: {thresholdData.thresholds.phase2ReproductionThreshold.learningRate}
                            </div>
                        </div>

                        {/* Phase 3 Complexity Threshold */}
                        <div className="bg-slate-800/50 rounded p-3 border border-slate-700">
                            <div className="text-[10px] text-slate-500 uppercase mb-2">Phase 3 Complexity</div>
                            <div className="text-sm font-mono text-white">
                                Min: {thresholdData.thresholds.phase3ComplexityThreshold.min} |
                                Current: <span className="text-cyan-400 font-bold">{thresholdData.thresholds.phase3ComplexityThreshold.current}</span> |
                                Max: {thresholdData.thresholds.phase3ComplexityThreshold.max}
                            </div>
                            <div className="text-[10px] text-slate-500 mt-2">
                                Learning Rate: {thresholdData.thresholds.phase3ComplexityThreshold.learningRate}
                            </div>
                        </div>

                        {/* Phase 3 Iteration Threshold */}
                        <div className="bg-slate-800/50 rounded p-3 border border-slate-700">
                            <div className="text-[10px] text-slate-500 uppercase mb-2">Phase 3 Iteration</div>
                            <div className="text-sm font-mono text-white">
                                Min: {thresholdData.thresholds.phase3IterationThreshold.min} |
                                Current: <span className="text-cyan-400 font-bold">{thresholdData.thresholds.phase3IterationThreshold.current}</span> |
                                Max: {thresholdData.thresholds.phase3IterationThreshold.max}
                            </div>
                            <div className="text-[10px] text-slate-500 mt-2">
                                Learning Rate: {thresholdData.thresholds.phase3IterationThreshold.learningRate}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="text-slate-500 text-sm">No threshold data available</div>
                )}
            </div>

            {/* Recovery Strategies */}
            {thresholdData && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Phase 2 Strategies */}
                    <div className="bg-slate-900/30 rounded-lg border border-slate-800 p-4">
                        <div className="flex items-center gap-2 mb-4">
                            <BarChart3 className="w-4 h-4 text-blue-400" />
                            <h3 className="text-sm font-bold text-white">Phase 2 Recovery Strategies</h3>
                        </div>

                        <div className="space-y-2">
                            {thresholdData.phase2Strategies.topStrategies.map((strategy, idx) => (
                                <div key={idx} className="flex items-center justify-between bg-slate-800/50 rounded px-3 py-2">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-mono text-white">
                                            {strategy.strategy}
                                        </span>
                                        <span className="text-[10px] text-slate-500">
                                            {strategy.attempts} attempts
                                        </span>
                                    </div>
                                    <div className="text-sm font-bold text-emerald-400">
                                        {formatRate(strategy.successRate)}%
                                    </div>
                                </div>
                            ))}
                            {thresholdData.phase2Strategies.topStrategies.length === 0 && (
                                <div className="text-slate-500 text-sm text-center py-4">No recovery data yet</div>
                            )}
                        </div>
                    </div>

                    {/* Phase 3 Strategies */}
                    <div className="bg-slate-900/30 rounded-lg border border-slate-800 p-4">
                        <div className="flex items-center gap-2 mb-4">
                            <BarChart3 className="w-4 h-4 text-red-400" />
                            <h3 className="text-sm font-bold text-white">Phase 3 Recovery Strategies</h3>
                        </div>

                        <div className="space-y-2">
                            {thresholdData.phase3Strategies.topStrategies.map((strategy, idx) => (
                                <div key={idx} className="flex items-center justify-between bg-slate-800/50 rounded px-3 py-2">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-mono text-white">
                                            {strategy.strategy}
                                        </span>
                                        <span className="text-[10px] text-slate-500">
                                            {strategy.attempts} attempts
                                        </span>
                                    </div>
                                    <div className="text-sm font-bold text-emerald-400">
                                        {formatRate(strategy.successRate)}%
                                    </div>
                                </div>
                            ))}
                            {thresholdData.phase3Strategies.topStrategies.length === 0 && (
                                <div className="text-slate-500 text-sm text-center py-4">No recovery data yet</div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
