
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { LogInput } from './components/LogInput';
import { AgentStatus } from './components/AgentStatus';
import { TerminalOutput } from './components/TerminalOutput';
import { DiffView } from './components/DiffView';
import { SettingsModal } from './components/SettingsModal';
import { ChatConsole } from './components/ChatConsole';
import { ColumnWrapper } from './components/ColumnWrapper';
import { Resizer } from './components/Resizer';
import { AgentPhase, LogLine, CodeFile, AppConfig, ChatMessage, FileChange, RunGroup, AgentState } from './types';
import { INITIAL_ERROR_LOG, BROKEN_CODE, SCENARIO_FAILURE_LOOP } from './constants';
import { Play, RotateCcw, ShieldCheck, Zap, Wifi, Settings, Loader2, RefreshCw, FileText, Terminal, Activity } from 'lucide-react';
import { 
    getWorkflowLogs, getFileContent, diagnoseError, generateFix, 
    pushMultipleFilesToGitHub, getAgentChatResponse, groupFailedRuns,
    judgeFix, runSandboxTest, searchRepoFile, findClosestFile, generateRepoSummary, generatePostMortem,
    toolCodeSearch, toolLintCheck, toolScanDependencies, toolWebSearch, toolFindReferences,
} from './services';
import { runIndependentAgentLoop } from './agent';

const App: React.FC = () => {
  // Layout State
  const [colWidths, setColWidths] = useState([3.5, 5.5, 3]); // Initial FR units summing to 12
  const [collapsedCols, setCollapsedCols] = useState([false, false, false]);
  const [isResizing, setIsResizing] = useState<number | null>(null); // Index of the resizer being dragged
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Ref to store drag start state for smooth resizing
  const dragStartRef = useRef<{ x: number, initialWidths: number[] } | null>(null);

  // App State
  const [logs, setLogs] = useState(INITIAL_ERROR_LOG);
  const [globalPhase, setGlobalPhase] = useState<AgentPhase>(AgentPhase.IDLE); // Only used for init/success summarization
  const [agentStates, setAgentStates] = useState<Record<string, AgentState>>({});
  
  const [terminalLines, setTerminalLines] = useState<LogLine[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  
  // State for multi-file changes (CONSOLIDATED MASTER)
  const [consolidatedFileChanges, setConsolidatedFileChanges] = useState<Record<string, FileChange>>({});
  const [selectedChunkIds, setSelectedChunkIds] = useState<Set<string>>(new Set());
  const [activeGroups, setActiveGroups] = useState<RunGroup[]>([]);

  // UI View State
  const [selectedAgentId, setSelectedAgentId] = useState<string | 'CONSOLIDATED' | null>('CONSOLIDATED');

  // Repo Context Caching
  const [repoSummary, setRepoSummary] = useState<string | null>(null);
  const lastRepoUrlRef = useRef<string>("");

  const [isSimulating, setIsSimulating] = useState(false);
  const [simStepIndex, setSimStepIndex] = useState(0);
  
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [isRealMode, setIsRealMode] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const consolidatedRef = useRef<Record<string, FileChange>>({}); // Track consolidated state to prevent overwrites

  // --- Layout Logic ---

  const toggleCollapse = (index: number) => {
    setCollapsedCols(prev => {
        const newCols = [...prev];
        newCols[index] = !newCols[index];
        return newCols;
    });
  };

  const startResizing = (index: number) => (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(index);
      dragStartRef.current = {
          x: e.clientX,
          initialWidths: [...colWidths]
      };
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
        if (isResizing === null || !dragStartRef.current || !containerRef.current) return;

        const containerWidth = containerRef.current.clientWidth;
        const { x, initialWidths } = dragStartRef.current;
        const pixelDelta = e.clientX - x;
        const totalFr = initialWidths.reduce((a, b) => a + b, 0);
        const frDelta = (pixelDelta / containerWidth) * totalFr;

        const newWidths = [...initialWidths];
        const leftColIdx = isResizing;
        const rightColIdx = isResizing + 1;

        // Apply constraints (min width 0.5fr)
        if (newWidths[leftColIdx] + frDelta < 0.5 || newWidths[rightColIdx] - frDelta < 0.5) {
            return;
        }

        newWidths[leftColIdx] += frDelta;
        newWidths[rightColIdx] -= frDelta;
        setColWidths(newWidths);
    };

    const handleMouseUp = () => {
        setIsResizing(null);
        dragStartRef.current = null;
    };

    if (isResizing !== null) {
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = 'col-resize';
    } else {
        document.body.style.cursor = '';
    }

    return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
    };
  }, [isResizing]);

  // Dynamic Grid Template
  const getGridTemplate = () => {
      const tracks: string[] = [];
      tracks.push(collapsedCols[0] ? '48px' : `${colWidths[0]}fr`);
      tracks.push((!collapsedCols[0] && !collapsedCols[1]) ? '4px' : '0px');
      tracks.push(collapsedCols[1] ? '48px' : `${colWidths[1]}fr`);
      tracks.push((!collapsedCols[1] && !collapsedCols[2]) ? '4px' : '0px');
      tracks.push(collapsedCols[2] ? '48px' : `${colWidths[2]}fr`);
      return tracks.join(' ');
  };

  // --- App Logic ---

  const addLog = useCallback((level: LogLine['level'], content: string, agentId: string = 'SYSTEM', agentName: string = 'System') => {
    const newLine: LogLine = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toISOString(),
      level,
      content,
      agentId,
      agentName
    };
    setTerminalLines(prev => [...prev, newLine]);
  }, []);

  const addChatMessage = useCallback((sender: 'user' | 'agent', text: string) => {
    const msg: ChatMessage = {
        id: Math.random().toString(36).substr(2, 9),
        sender,
        text,
        timestamp: new Date()
    };
    setChatMessages(prev => [...prev, msg]);
  }, []);

  // Helper to update a single agent's state
  const updateAgentState = useCallback((groupId: string, updates: Partial<AgentState>) => {
      setAgentStates(prev => {
          const current = prev[groupId] || {};
          return {
              ...prev,
              [groupId]: { ...current, ...updates }
          };
      });
  }, []);

  const runSimulationStep = useCallback(() => {
    if (simStepIndex >= SCENARIO_FAILURE_LOOP.length) {
      setIsSimulating(false);
      return;
    }

    const step = SCENARIO_FAILURE_LOOP[simStepIndex];
    setGlobalPhase(step.phase);
    // For sim, we update a mock agent
    const mockAgentId = 'GROUP-SIM';
    // MOCK SIMULATION STATE UPDATE
    updateAgentState(mockAgentId, { 
        phase: step.phase, 
        name: "NeonArchitect",  // Updated name to fit style
        status: 'working', 
        iteration: 0,
        // In sim mode, we fake the file change appearing in the specific agent's state
        files: step.codeSnapshot ? { 
            'main.py': { 
                path: 'main.py', 
                original: BROKEN_CODE, 
                modified: step.codeSnapshot, 
                status: 'modified' 
            } 
        } : {}
    });
    
    // Also auto-select this agent so we see the change
    if (simStepIndex === 4) setSelectedAgentId(mockAgentId); // Switch view when code changes

    addLog('INFO', step.message);
    
    if (step.logAppend) {
        setTerminalLines(prev => [...prev, { ...step.logAppend!, id: Math.random().toString() }]);
    }

    timeoutRef.current = setTimeout(() => {
      setSimStepIndex(prev => prev + 1);
    }, step.delay);

  }, [simStepIndex, addLog, updateAgentState]);

  useEffect(() => {
    if (isSimulating && !isRealMode) {
      runSimulationStep();
    }
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [isSimulating, isRealMode, simStepIndex, runSimulationStep]);

  // Sync Left Log Panel with Selected Agent
  useEffect(() => {
    if (selectedAgentId && selectedAgentId !== 'CONSOLIDATED') {
        const agent = agentStates[selectedAgentId];
        // Only update if the agent has explicitly fetched logs, otherwise keep previous view (or initial)
        if (agent?.activeLog) {
            setLogs(agent.activeLog);
        }
    }
  }, [selectedAgentId, agentStates]);

  const generateCoolAgentName = (idx: number) => {
      const adjectives = ["Crimson", "Neon", "Zero", "Cyber", "Void", "Quantum", "Spectral", "Iron", "Obsidian"];
      const nouns = ["Architect", "Weaver", "Operator", "Sentinel", "Runner", "Engineer", "Daemon", "Vanguard"];
      
      const adj = adjectives[idx % adjectives.length];
      const noun = nouns[(idx + Math.floor(idx / adjectives.length)) % nouns.length];
      return `${adj}${noun}`;
  };

  const runMultiAgentPipeline = async () => {
    if (!appConfig) return;
    const cleanConfig = { ...appConfig, githubToken: appConfig.githubToken.trim() };

    try {
        setIsSimulating(true);
        setTerminalLines([]);
        setConsolidatedFileChanges({});
        consolidatedRef.current = {}; // Reset ref
        setChatMessages([]);
        setSelectedChunkIds(new Set());
        setActiveGroups([]);
        setAgentStates({});
        setGlobalPhase(AgentPhase.INIT_REPO);
        
        addChatMessage('agent', `Pipeline initialized. Target: ${cleanConfig.repoUrl}`);

        // --- PHASE 1: REPO CONTEXT SUMMARIZATION (Shared) ---
        let currentRepoSummary = repoSummary;
        if (cleanConfig.repoUrl !== lastRepoUrlRef.current || !currentRepoSummary) {
            addLog('INFO', 'Initializing Repository Analysis Agent...');
            try {
                currentRepoSummary = await generateRepoSummary(cleanConfig);
                setRepoSummary(currentRepoSummary);
                lastRepoUrlRef.current = cleanConfig.repoUrl;
                addLog('SUCCESS', 'Repository Context Summarized.');
            } catch (e: any) {
                addLog('WARN', `Context generation failed. Proceeding without.`);
                currentRepoSummary = "";
            }
        }

        // --- PHASE 2: SPAWN INDEPENDENT AGENTS ---
        setGlobalPhase(AgentPhase.UNDERSTAND);
        addLog('INFO', `Scanning ${cleanConfig.selectedRuns.length} failed workflows...`);
        
        // Enhance groups with cool names
        const rawGroups = await groupFailedRuns(cleanConfig, cleanConfig.selectedRuns);
        const initialGroups = rawGroups.map((g, idx) => ({
            ...g,
            name: generateCoolAgentName(idx)
        }));
        
        setActiveGroups(initialGroups);

        // Initialize UI states
        const initialStates: Record<string, AgentState> = {};
        initialGroups.forEach(g => {
            initialStates[g.id] = { 
                groupId: g.id, 
                name: g.name, 
                phase: AgentPhase.IDLE, 
                iteration: 0, 
                status: 'waiting',
                files: {}, // Worktree start empty
                fileReservations: []
            };
        });
        setAgentStates(initialStates);
        // Default to Consolidated view, which is empty initially
        setSelectedAgentId('CONSOLIDATED');

        addLog('INFO', `Deploying ${initialGroups.length} autonomous agents (Protocol: Concurrent)...`);

        // FIRE AND FORGET
        const finalResults = await Promise.all(initialGroups.map(group => 
            runIndependentAgentLoop(
                cleanConfig, 
                group, 
                currentRepoSummary || "",
                updateAgentState, // Call back to update React State
                addLog // Call back to log events
            )
        ));

        // --- PHASE 3: CONSOLIDATION & ANALYSIS ---
        const successes = finalResults.filter(r => r.status === 'success');
        const failures = finalResults.filter(r => r.status === 'failed');

        if (successes.length === 0) {
            setGlobalPhase(AgentPhase.FAILURE);
            addChatMessage('agent', "Mission Failed. No agents were able to verify a fix.");
        } else if (failures.length === 0) {
            setGlobalPhase(AgentPhase.SUCCESS); // All Good
            addChatMessage('agent', "Mission Complete. All issues verified. Click 'View Merged Master' to deploy.");
        } else {
            setGlobalPhase(AgentPhase.PARTIAL_SUCCESS);
            addLog('WARN', `Partial Success: ${successes.length} fixed, ${failures.length} failed.`);
            addChatMessage('agent', `Mission Result: Mixed. ${successes.length} agents succeeded, ${failures.length} agents failed.`);
            
            // Generate Post Mortem for failures
            addLog('INFO', 'Generating Post-Mortem Recommendations for failed agents...');
            const postMortem = await generatePostMortem(cleanConfig, failures);
            addChatMessage('agent', `RECOMMENDATION REPORT:\n\n${postMortem}`);
            addChatMessage('agent', "You can push the successful fixes now and address the remaining issues manually.");
        }
        
        addLog('INFO', 'Pipeline execution finished.');

    } catch (error: any) {
        setGlobalPhase(AgentPhase.FAILURE);
        addLog('ERROR', error.message || "Pipeline Error");
        console.error(error);
        setIsSimulating(false);
    }
  };

  // Smart Consolidation Effect
  useEffect(() => {
      // Only run consolidation when entering these phases
      if (globalPhase === AgentPhase.CONSOLIDATE || globalPhase === AgentPhase.SUCCESS || globalPhase === AgentPhase.PARTIAL_SUCCESS) {
          
          const newMerged = { ...consolidatedRef.current };
          let hasUpdates = false;

          Object.values(agentStates).forEach((agent: AgentState) => {
              // Only merge SUCCESSFUL agents
              if (agent.status === 'success') {
                  Object.values(agent.files).forEach((file: FileChange) => {
                      // Only add if not already present to preserve user manual edits
                      // If the user modified 'main.py' in the consolidated view, we don't want to overwrite it 
                      // just because an agent finished or a re-render happened.
                      // However, on first pass, we want to populate it.
                      if (!newMerged[file.path]) {
                          newMerged[file.path] = file;
                          hasUpdates = true;
                      }
                  });
              }
          });

          if (hasUpdates) {
              consolidatedRef.current = newMerged;
              setConsolidatedFileChanges(newMerged);
          }
      }
  }, [globalPhase, agentStates]);

  const handleUpdateFileContent = (file: FileChange, newContent: string) => {
      // If we are in consolidated view, update consolidated
      if (selectedAgentId === 'CONSOLIDATED') {
          const updated = {
            ...file,
            modified: { ...file.modified, content: newContent },
            agentReasoning: undefined 
          };
          
          setConsolidatedFileChanges(prev => {
              const next = { ...prev, [file.path]: updated };
              consolidatedRef.current = next; // Update ref to persist manual changes
              return next;
          });

      } else if (selectedAgentId) {
          // Update specific agent's state
          updateAgentState(selectedAgentId, {
              files: {
                  ...agentStates[selectedAgentId].files,
                  [file.path]: {
                      ...file,
                      modified: { ...file.modified, content: newContent },
                      agentReasoning: undefined
                  }
              }
          });
      }
      
      const newSelections = new Set(selectedChunkIds);
      Array.from(newSelections).forEach((id: string) => {
          if (id.startsWith(file.path + '-')) newSelections.delete(id);
      });
      setSelectedChunkIds(newSelections);
  };

  const handleToggleChunkSelection = (chunkId: string | string[], filePath: string) => {
    setSelectedChunkIds(prev => {
        const newSet = new Set(prev);
        const ids = Array.isArray(chunkId) ? chunkId : [chunkId];
        ids.forEach(id => {
            if (newSet.has(id)) newSet.delete(id);
            else newSet.add(id);
        });
        return newSet;
    });
};

  const handleReevaluateSelected = async () => {
      if (!appConfig || selectedChunkIds.size === 0) return;
      setIsProcessing(true);
      addLog('WARN', 'Re-evaluation triggered. (Feature restricted to specific agents in Async Mode).');
      setIsProcessing(false);
  };

  const handleDeployFix = async () => {
      if (!isRealMode || !appConfig) return;
      
      const filesToPush = Object.values(consolidatedFileChanges).map((fc: FileChange) => ({
          path: fc.path,
          content: fc.modified.content
      }));

      if (filesToPush.length === 0) {
          addLog('WARN', 'No consolidated changes to deploy. Check if agents succeeded.');
          return;
      }

      setIsDeploying(true);
      addLog('INFO', `Packing ${filesToPush.length} changes into atomic commit...`);
      try {
          const baseSha = appConfig.selectedRuns[0].head_sha;
          const commitUrl = await pushMultipleFilesToGitHub(
              { ...appConfig, githubToken: appConfig.githubToken.trim() },
              filesToPush,
              baseSha
          );
          addLog('SUCCESS', `Deployed ${filesToPush.length} file(s) successfully.`);
          addChatMessage('agent', `Fixes deployed. Pull Request updated.`);
          window.open(commitUrl, '_blank');
      } catch (e: any) {
          addLog('ERROR', `Deployment Failed: ${e.message}`);
      } finally {
          setIsDeploying(false);
      }
  };
  
  const handleUserChat = async (msg: string) => {
      addChatMessage('user', msg);
      setIsProcessing(true);
      try {
         let context = "Global Command View.";
         if (selectedAgentId && selectedAgentId !== 'CONSOLIDATED') {
             const agent = agentStates[selectedAgentId];
             if (agent) {
                 context = `Agent: ${agent.name}\nStatus: ${agent.status}\nPhase: ${agent.phase}\nLog Summary: ${agent.activeLog?.slice(-500) || 'None'}`;
             }
         } else {
             context = "Consolidated View. Managing all agents.";
         }
         
         const resp = await getAgentChatResponse(appConfig, msg, context);
         addChatMessage('agent', resp);
      } catch (e) {
         addChatMessage('agent', "Comms Link Unstable. (LLM Error)");
      } finally {
         setIsProcessing(false);
      }
  };

  const reset = () => {
      setIsSimulating(false);
      setGlobalPhase(AgentPhase.IDLE);
      setTerminalLines([]);
      setConsolidatedFileChanges({});
      consolidatedRef.current = {};
      setLogs(INITIAL_ERROR_LOG);
      setChatMessages([]);
      setSelectedChunkIds(new Set());
      setActiveGroups([]);
      setAgentStates({});
  };

  const handleConfigSave = (config: AppConfig) => {
    const finalConfig = {
        ...config,
        llmProvider: config.llmProvider || 'gemini',
        llmModel: config.llmModel || 'gemini-2.5-flash',
        devEnv: config.devEnv || 'simulation',
        checkEnv: config.checkEnv || 'simulation'
    };
    setAppConfig(finalConfig);
    setIsSettingsOpen(false);
    setIsRealMode(true);
    addLog('SUCCESS', `Uplink Configured. Target: ${config.prUrl}`);
    addLog('INFO', `LLM Initialized: ${finalConfig.llmProvider} / ${finalConfig.llmModel}`);
    
    if (finalConfig.checkEnv === 'github_actions') {
        addLog('WARN', 'CHECK ENV: GitHub Actions Enabled. Commits will be pushed.');
    } else {
        addLog('INFO', 'CHECK ENV: Simulation');
    }

    if (finalConfig.devEnv === 'e2b') {
        addLog('INFO', 'DEV ENV: E2B Cloud Sandbox Active.');
    } else {
         addLog('INFO', 'DEV ENV: Simulation');
    }
    
    addLog('INFO', 'Ready to engage Multi-Agent Pipeline.');
  };

  const startPipeline = () => {
      if (isRealMode) {
          runMultiAgentPipeline();
      } else {
          setTerminalLines([]);
          setSimStepIndex(0);
          setConsolidatedFileChanges({});
          setIsSimulating(true);
          setActiveGroups([{id: 'GROUP-SIM', name: 'NeonArchitect', runIds: [1], mainRun: {} as any}]);
          setAgentStates({});
          addLog('INFO', 'Initializing Simulation...');
      }
  };

  const handleExportLogs = () => {
      const exportData = {
          timestamp: new Date().toISOString(),
          // Sanitize secrets before exporting
          config: appConfig ? {
              ...appConfig,
              githubToken: appConfig.githubToken ? '***REDACTED***' : '',
              customApiKey: appConfig.customApiKey ? '***REDACTED***' : '',
              e2bApiKey: appConfig.e2bApiKey ? '***REDACTED***' : '',
              tavilyApiKey: appConfig.tavilyApiKey ? '***REDACTED***' : '',
          } : null,
          traceback: logs,
          terminal: terminalLines,
          agents: agentStates,
          chat: chatMessages,
          consolidatedFiles: consolidatedFileChanges
      };
      
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ci_fixer_debug_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      addLog('INFO', 'Diagnostics data exported successfully.');
  };

  // Helper to determine what files to show in DiffView
  const getActiveFiles = (): FileChange[] => {
      if (selectedAgentId === 'CONSOLIDATED' || !selectedAgentId) {
          return Object.values(consolidatedFileChanges);
      }
      const agent = agentStates[selectedAgentId];
      if (agent && agent.files) {
          return Object.values(agent.files);
      }
      return [];
  };

  const getActiveViewContext = () => {
      if (selectedAgentId === 'CONSOLIDATED' || !selectedAgentId) {
          if (globalPhase === AgentPhase.PARTIAL_SUCCESS) return "PARTIAL MERGE (Successes Only)";
          return "CONSOLIDATED MASTER";
      }
      return agentStates[selectedAgentId]?.name || "Unknown Agent";
  };

  const getPushLabel = () => {
      if (isDeploying) return "PUSHING TO PR...";
      const count = Object.keys(consolidatedFileChanges).length;
      if (globalPhase === AgentPhase.PARTIAL_SUCCESS) return `PUSH ${count} VERIFIED FIXES`;
      return "PUSH ALL FIXES";
  };

  return (
    <div className="h-screen w-full bg-slate-950 text-slate-200 flex flex-col overflow-hidden font-sans selection:bg-cyan-500/30">
      <SettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
        onSave={handleConfigSave}
        currentConfig={appConfig}
        onExportLogs={handleExportLogs}
      />

      {/* Header */}
      <header className="flex-none flex flex-col md:flex-row items-start md:items-center justify-between p-4 md:p-6 border-b border-slate-800 bg-slate-950 z-20">
        <div>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-purple-500 flex items-center gap-3">
             <ShieldCheck className="w-8 h-8 text-cyan-400" />
             Recursive DevOps Agent
          </h1>
          <div className="flex items-center gap-2 mt-2">
            {isRealMode ? (
                <span className="flex items-center text-[10px] font-bold text-emerald-400 bg-emerald-950/50 px-2 py-0.5 rounded border border-emerald-900">
                    <Wifi className="w-3 h-3 mr-1" /> LIVE UPLINK ACTIVE
                </span>
            ) : (
                <span className="flex items-center text-[10px] font-bold text-amber-500 bg-amber-950/50 px-2 py-0.5 rounded border border-amber-900">
                    <Zap className="w-3 h-3 mr-1" /> SIMULATION MODE
                </span>
            )}
            <p className="text-slate-500 font-mono text-sm">v6.1 (Stable)</p>
          </div>
        </div>
        <div className="mt-4 md:mt-0 flex gap-4">
          <button 
            onClick={() => setIsSettingsOpen(true)}
            className="px-3 py-2 rounded border border-slate-700 hover:bg-slate-900 text-slate-400 hover:text-white transition-all"
          >
            <Settings className="w-4 h-4" />
          </button>
          <button 
            onClick={reset}
            className="px-4 py-2 rounded border border-slate-700 hover:bg-slate-900 text-slate-400 text-sm font-mono flex items-center transition-all"
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            RESET
          </button>
          <button 
            onClick={startPipeline}
            disabled={isSimulating && !isRealMode}
            className={`px-6 py-2 rounded font-bold text-sm font-mono flex items-center transition-all ${
                isRealMode 
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.4)]' 
                : 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-[0_0_15px_rgba(6,182,212,0.4)]'
            } ${isSimulating ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {isSimulating 
                ? <Zap className="w-4 h-4 mr-2 animate-spin" /> 
                : (isRealMode ? <Wifi className="w-4 h-4 mr-2" /> : <Play className="w-4 h-4 mr-2" />)
            }
            {isRealMode ? "ENGAGE SWARM" : "SIMULATE SWARM"}
          </button>
        </div>
      </header>

      {/* Dynamic Grid Layout */}
      <div 
        ref={containerRef}
        className="flex-1 min-h-0 p-4 md:p-6 grid overflow-hidden" 
        style={{ gridTemplateColumns: getGridTemplate(), gridTemplateRows: '100%' }}
      >
        {/* Column 0: Logs */}
        <ColumnWrapper 
            title="System Logs" 
            icon={<FileText className="w-5 h-5" />}
            collapsed={collapsedCols[0]} 
            onToggle={() => toggleCollapse(0)}
        >
            <LogInput logs={logs} onChange={setLogs} readOnly={isSimulating} />
        </ColumnWrapper>

        {/* Resizer 0 */}
        <Resizer isVisible={!collapsedCols[0] && !collapsedCols[1]} onMouseDown={startResizing(0)} />

        {/* Column 1: Agent & Diff */}
        <ColumnWrapper 
            title="Agent Operations" 
            icon={<Activity className="w-5 h-5" />}
            collapsed={collapsedCols[1]} 
            onToggle={() => toggleCollapse(1)}
        >
             <div className="flex flex-col h-full min-h-0 gap-4">
                <div className="flex-none pt-2">
                    {/* Pass the dynamic map of agent states */}
                    <AgentStatus 
                        agentStates={agentStates} 
                        globalPhase={globalPhase} 
                        selectedAgentId={selectedAgentId}
                        onSelectAgent={setSelectedAgentId}
                    />
                </div>
                <div className="flex-1 min-h-0 relative flex flex-col overflow-hidden">
                    <DiffView 
                        files={getActiveFiles()} 
                        selectedChunkIds={selectedChunkIds}
                        onToggleChunkSelection={handleToggleChunkSelection}
                        onRevertChunk={handleUpdateFileContent}
                        viewContext={getActiveViewContext()}
                    />
                    
                    {/* Only show deploy button if we are in CONSOLIDATED view and there are changes */}
                    {selectedAgentId === 'CONSOLIDATED' && Object.keys(consolidatedFileChanges).length > 0 && (
                      <div className="absolute bottom-6 right-6 flex gap-3 animate-[fadeIn_0.5s_ease-out] z-50">
                        {selectedChunkIds.size > 0 && (
                             <button 
                                onClick={handleReevaluateSelected}
                                disabled={isProcessing}
                                className="bg-amber-600 hover:bg-amber-500 text-white px-4 py-3 rounded shadow-lg font-bold flex items-center gap-2 transition-all disabled:opacity-50"
                             >
                                <RefreshCw className={`w-4 h-4 ${isProcessing ? 'animate-spin' : ''}`} />
                                Reevaluate ({selectedChunkIds.size})
                             </button>
                        )}
                        <button 
                            onClick={handleDeployFix}
                            disabled={isDeploying || isProcessing}
                            className={`px-6 py-3 rounded shadow-lg font-bold flex items-center gap-2 group transition-all disabled:opacity-50 disabled:cursor-wait ${
                                globalPhase === AgentPhase.PARTIAL_SUCCESS 
                                ? 'bg-amber-600 hover:bg-amber-500 text-white' 
                                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                            }`}
                        >
                          {isDeploying ? <Loader2 className="w-4 h-4 animate-spin" /> : <span className="w-2 h-2 bg-white rounded-full animate-pulse"></span>}
                          {getPushLabel()}
                          {!isDeploying && <Play className="w-4 h-4 group-hover:translate-x-1 transition-transform" />}
                        </button>
                      </div>
                    )}
                </div>
             </div>
        </ColumnWrapper>

        {/* Resizer 1 */}
        <Resizer isVisible={!collapsedCols[1] && !collapsedCols[2]} onMouseDown={startResizing(1)} />

        {/* Column 2: Terminal & Chat */}
        <ColumnWrapper 
            title="Terminal & Comms" 
            icon={<Terminal className="w-5 h-5" />}
            collapsed={collapsedCols[2]} 
            onToggle={() => toggleCollapse(2)}
        >
            <div className="flex flex-col h-full gap-4">
                <div className="flex-1 min-h-0 flex flex-col">
                    <TerminalOutput 
                        lines={terminalLines} 
                        activeGroups={activeGroups}
                        logLevel={appConfig?.logLevel || 'info'} 
                    />
                </div>
                <div className="flex-1 min-h-0 flex flex-col">
                    <ChatConsole 
                        messages={chatMessages}
                        onSendMessage={handleUserChat}
                        onReevaluate={handleReevaluateSelected}
                        isProcessing={isProcessing}
                        hasSelectedChunks={selectedChunkIds.size > 0}
                        selectedAgentName={selectedAgentId === 'CONSOLIDATED' ? 'Swarm Overseer' : agentStates[selectedAgentId]?.name}
                    />
                </div>
            </div>
        </ColumnWrapper>

      </div>
    </div>
  );
};

export default App;
