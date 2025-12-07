
import React, { useState, useEffect } from 'react';
import { AppConfig, WorkflowRun } from '../types';
import { Shield, GitPullRequest, X, Check, Server, AlertCircle, RefreshCw, Layers, Cpu, Globe, Key, CloudLightning, Timer, Sliders } from 'lucide-react';
import { getPRFailedRuns } from '../services';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: AppConfig) => void;
  currentConfig: AppConfig | null;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, onSave, currentConfig }) => {
  const [formData, setFormData] = useState<Partial<AppConfig>>(currentConfig || {
    githubToken: '',
    repoUrl: '',
    prUrl: '',
    selectedRuns: [],
    excludeWorkflowPatterns: [], // Default to empty to show all runs initially
    llmProvider: 'gemini',
    llmBaseUrl: '',
    llmModel: 'gemini-3-pro-preview', // Default to Reasoning Model
    customApiKey: '',
    searchProvider: 'gemini_grounding',
    tavilyApiKey: '',
    sandboxMode: 'simulation',
    sandboxTimeoutMinutes: 15,
    logLevel: 'info'
  });

  const [isLoadingRuns, setIsLoadingRuns] = useState(false);
  const [foundRuns, setFoundRuns] = useState<WorkflowRun[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && currentConfig) {
      setFormData({
          ...currentConfig,
          excludeWorkflowPatterns: currentConfig.excludeWorkflowPatterns || [],
          llmProvider: currentConfig.llmProvider || 'gemini',
          llmModel: currentConfig.llmModel || 'gemini-3-pro-preview',
          llmBaseUrl: currentConfig.llmBaseUrl || '',
          customApiKey: currentConfig.customApiKey || '',
          searchProvider: currentConfig.searchProvider || 'gemini_grounding',
          tavilyApiKey: currentConfig.tavilyApiKey || '',
          sandboxMode: currentConfig.sandboxMode || 'simulation',
          sandboxTimeoutMinutes: currentConfig.sandboxTimeoutMinutes || 15,
          logLevel: currentConfig.logLevel || 'info',
          // Ensure string fields are never undefined to keep inputs controlled
          prUrl: currentConfig.prUrl || '',
          githubToken: currentConfig.githubToken || '',
          repoUrl: currentConfig.repoUrl || ''
      });
      if (currentConfig.selectedRuns) {
          setFoundRuns(currentConfig.selectedRuns);
      }
    }
  }, [isOpen, currentConfig]);

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
      const provider = e.target.value;
      let updates: Partial<AppConfig> = { llmProvider: provider };
      
      // Auto-configure defaults based on provider documentation
      if (provider === 'zai') {
          updates.llmBaseUrl = 'https://api.z.ai/api/coding/paas/v4';
          updates.llmModel = 'GLM-4.6';
      } else if (provider === 'gemini') {
          updates.llmBaseUrl = '';
          updates.llmModel = 'gemini-3-pro-preview';
      }
      
      setFormData(prev => ({ ...prev, ...updates }));
  };

  const handlePrUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newUrl = e.target.value;
      // If URL changes, clear runs to force re-fetch and ensure repoUrl consistency
      if (newUrl !== formData.prUrl) {
          setFormData(prev => ({ 
              ...prev, 
              prUrl: newUrl, 
              selectedRuns: [], 
              repoUrl: '' // Clear repoUrl so it must be regenerated
          }));
          setFoundRuns([]);
      }
  };

  const handleFetchRuns = async () => {
      if (!formData.githubToken || !formData.prUrl) {
          setValidationError("GitHub Token and PR URL are required to load runs.");
          return;
      }
      
      // Parse PR URL
      // Expected: https://github.com/OWNER/REPO/pull/NUMBER
      const match = formData.prUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/);
      if (!match) {
          setValidationError("Invalid PR URL format. Use https://github.com/owner/repo/pull/123");
          return;
      }

      const [_, owner, repo, prNumber] = match;
      const derivedRepoUrl = `${owner}/${repo}`;
      setFormData(prev => ({ ...prev, repoUrl: derivedRepoUrl }));

      setIsLoadingRuns(true);
      setValidationError(null);
      try {
          const runs = await getPRFailedRuns(
              formData.githubToken, 
              owner, 
              repo, 
              prNumber, 
              formData.excludeWorkflowPatterns || []
          );
          
          if (runs.length === 0) {
              setValidationError("No failed workflow runs found for this PR.");
          }
          
          setFoundRuns(runs);
          // Default select all
          setFormData(prev => ({ ...prev, selectedRuns: runs }));
      } catch (e: any) {
          console.error("Fetch Runs Error:", e);
          setValidationError(`Failed to fetch runs: ${e.message}`);
      } finally {
          setIsLoadingRuns(false);
      }
  };

  const toggleRun = (run: WorkflowRun) => {
      const current = formData.selectedRuns || [];
      const exists = current.find(r => r.id === run.id);
      
      let newSelection;
      if (exists) {
          newSelection = current.filter(r => r.id !== run.id);
      } else {
          newSelection = [...current, run];
      }
      setFormData(prev => ({ ...prev, selectedRuns: newSelection }));
  };

  const toggleSelectAll = () => {
      if (formData.selectedRuns?.length === foundRuns.length) {
          setFormData(prev => ({ ...prev, selectedRuns: [] }));
      } else {
          setFormData(prev => ({ ...prev, selectedRuns: [...foundRuns] }));
      }
  };

  const handleSave = () => {
    if (!formData.githubToken?.trim()) { setValidationError("GitHub Token required."); return; }
    // API Key validation removed - handled by process.env.API_KEY check at runtime/compile time
    if (!formData.selectedRuns || formData.selectedRuns.length === 0) { setValidationError("Please select at least one failed run to fix."); return; }
    
    // Safety check: ensure repoUrl is set (should be set by handleFetchRuns, but if runs were manually manipulated...)
    if (!formData.repoUrl && formData.prUrl) {
        const match = formData.prUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/);
        if (match) {
            const [_, owner, repo] = match;
            formData.repoUrl = `${owner}/${repo}`;
        }
    }

    onSave(formData as AppConfig);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-[fadeIn_0.2s_ease-out]">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-lg shadow-[0_0_30px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-800 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <Server className="w-5 h-5 text-cyan-400" />
            <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider">Pipeline Uplink Config</h2>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar">
            
          {validationError && (
              <div className="bg-rose-950/50 border border-rose-900 text-rose-300 px-4 py-3 rounded text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {validationError}
              </div>
          )}

          {/* Credentials */}
          <div className="grid grid-cols-1 gap-4">
            <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1">
                    <Shield className="w-3 h-3" /> GitHub Token (Repo/Workflow Scope)
                </label>
                <input 
                   type="password" 
                   value={formData.githubToken || ''}
                   onChange={e => setFormData({...formData, githubToken: e.target.value})}
                   className="w-full bg-slate-900 border border-slate-800 rounded px-3 py-2 text-sm text-cyan-300 focus:border-cyan-500/50 font-mono"
                   placeholder="ghp_..."
                   autoComplete="off"
                 />
            </div>
          </div>
          
          {/* Settings Group */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              
            {/* LLM Configuration */}
            <div className="border border-slate-800 rounded bg-slate-950/50 p-3">
                <h3 className="text-xs font-bold text-slate-300 uppercase mb-3 flex items-center gap-2">
                    <Cpu className="w-3 h-3 text-purple-400" /> Intelligence
                </h3>
                <div className="space-y-3">
                    <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-500 uppercase">Provider</label>
                        <select 
                            value={formData.llmProvider || 'gemini'}
                            onChange={handleProviderChange}
                            className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200 focus:border-purple-500/50"
                        >
                            <option value="gemini">Google Gemini</option>
                            <option value="zai">Z.AI (GLM-4)</option>
                            <option value="openai">OpenAI Compatible</option>
                        </select>
                    </div>

                    {/* NEW: Model Selection */}
                    <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-500 uppercase">Model Tier</label>
                        <select 
                            value={formData.llmModel || 'gemini-3-pro-preview'}
                            onChange={e => setFormData({...formData, llmModel: e.target.value})}
                            className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200 focus:border-purple-500/50"
                        >
                            {formData.llmProvider === 'gemini' ? (
                                <>
                                    <option value="gemini-3-pro-preview">Gemini 3.0 Pro (Reasoning)</option>
                                    <option value="gemini-2.5-flash">Gemini 2.5 Flash (Fast)</option>
                                </>
                            ) : formData.llmProvider === 'zai' ? (
                                <option value="GLM-4.6">GLM-4.6</option>
                            ) : (
                                <option value="gpt-4o">GPT-4o</option>
                            )}
                        </select>
                    </div>

                    {formData.llmProvider !== 'gemini' && (
                        <div className="space-y-1">
                            <label className="text-[10px] font-bold text-emerald-500 uppercase">Custom API Key</label>
                            <input 
                                type="password" 
                                value={formData.customApiKey || ''}
                                onChange={e => setFormData({...formData, customApiKey: e.target.value})}
                                className="w-full bg-slate-900 border border-emerald-900/50 rounded px-2 py-1.5 text-xs text-emerald-100 focus:border-emerald-500/50"
                                placeholder="sk-..."
                            />
                        </div>
                    )}
                </div>
            </div>

            {/* Sandbox Configuration */}
            <div className="border border-slate-800 rounded bg-slate-950/50 p-3">
                <h3 className="text-xs font-bold text-slate-300 uppercase mb-3 flex items-center gap-2">
                    <CloudLightning className="w-3 h-3 text-amber-400" /> Sandbox Execution
                </h3>
                <div className="space-y-3">
                    <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-500 uppercase">Verification Strategy</label>
                        <select 
                            value={formData.sandboxMode || 'simulation'}
                            onChange={e => setFormData({...formData, sandboxMode: e.target.value as any})}
                            className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200 focus:border-amber-500/50"
                        >
                            <option value="simulation">Virtual Simulator (Fast / LLM)</option>
                            <option value="github_actions">GitHub Actions (Real / Cloud)</option>
                        </select>
                    </div>
                    
                    {formData.sandboxMode === 'github_actions' && (
                        <div className="space-y-1 animate-[fadeIn_0.2s_ease-out]">
                            <label className="text-[10px] font-bold text-amber-500 uppercase flex items-center gap-1">
                                <Timer className="w-3 h-3" /> Max Wait Time (Minutes)
                            </label>
                            <input 
                                type="number" 
                                min="1"
                                max="30"
                                value={formData.sandboxTimeoutMinutes || 15}
                                onChange={e => setFormData({...formData, sandboxTimeoutMinutes: parseInt(e.target.value) || 15})}
                                className="w-full bg-slate-900 border border-amber-900/50 rounded px-2 py-1.5 text-xs text-amber-100 focus:border-amber-500/50"
                            />
                            <p className="text-[9px] text-slate-500 leading-tight pt-1">
                                Agent will create a branch, push the fix, trigger a workflow, and poll for results.
                            </p>
                        </div>
                    )}
                </div>
            </div>

          </div>

          {/* Web Search Config */}
          <div className="border border-slate-800 rounded bg-slate-950/50 p-3">
              <h3 className="text-xs font-bold text-slate-300 uppercase mb-3 flex items-center gap-2">
                  <Globe className="w-3 h-3 text-cyan-400" /> Web Search Uplink
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase">Search Provider</label>
                      <select 
                          value={formData.searchProvider || 'gemini_grounding'}
                          onChange={e => setFormData({...formData, searchProvider: e.target.value as any})}
                          className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200 focus:border-cyan-500/50"
                      >
                          <option value="gemini_grounding">Gemini Grounding (Google Search)</option>
                          <option value="tavily">Tavily AI (Recommended)</option>
                      </select>
                  </div>
                  {formData.searchProvider === 'tavily' && (
                      <div className="space-y-1">
                          <label className="text-[10px] font-bold text-cyan-500 uppercase">Tavily API Key</label>
                          <input 
                              type="password" 
                              value={formData.tavilyApiKey || ''}
                              onChange={e => setFormData({...formData, tavilyApiKey: e.target.value})}
                              className="w-full bg-slate-900 border border-cyan-900/50 rounded px-2 py-1.5 text-xs text-cyan-100 focus:border-cyan-500/50"
                              placeholder="tvly-..."
                          />
                      </div>
                  )}
                  {formData.searchProvider === 'gemini_grounding' && (
                       <div className="flex items-center md:col-span-2">
                           <p className="text-[9px] text-slate-500 italic">
                               Uses the integrated Google Search Grounding. Requires Gemini API Key.
                           </p>
                       </div>
                  )}
              </div>
          </div>

          {/* System Control (Filters & Logging) */}
          <div className="border border-slate-800 rounded bg-slate-950/50 p-3">
              <h3 className="text-xs font-bold text-slate-300 uppercase mb-3 flex items-center gap-2">
                  <Sliders className="w-3 h-3 text-slate-400" /> System Control
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Workflow Exclusion Filter */}
                  <div className="space-y-2">
                      <label className="text-[10px] font-bold text-slate-500 uppercase">
                          Excluded Workflow Patterns
                      </label>
                      <input
                          type="text"
                          value={formData.excludeWorkflowPatterns?.join(', ') || ''}
                          onChange={(e) => setFormData({
                              ...formData,
                              excludeWorkflowPatterns: e.target.value.split(',').map(s => s.trim()).filter(s => s)
                          })}
                          placeholder="e.g. ci act, ci simple, local-tests"
                          className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200 focus:border-slate-500/50 font-mono"
                      />
                      <p className="text-[9px] text-slate-600">
                          Hide runs matching these terms.
                      </p>
                  </div>

                  {/* Log Verbosity Selector */}
                  <div className="space-y-2">
                        <label className="text-[10px] font-bold text-slate-500 uppercase">Log Verbosity</label>
                        <select 
                            value={formData.logLevel || 'info'}
                            onChange={e => setFormData({...formData, logLevel: e.target.value as any})}
                            className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200 focus:border-slate-500/50"
                        >
                            <option value="info">Info (Standard)</option>
                            <option value="debug">Debug (Detailed)</option>
                            <option value="verbose">Verbose (All)</option>
                        </select>
                        <p className="text-[9px] text-slate-600">
                          Controls detail level of terminal output.
                      </p>
                  </div>
              </div>
          </div>

          {/* PR URL Input */}
          <div className="space-y-2">
             <label className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1">
                <GitPullRequest className="w-3 h-3" /> Pull Request URL
             </label>
             <div className="flex gap-2">
                 <input 
                   type="text" 
                   value={formData.prUrl || ''}
                   onChange={handlePrUrlChange}
                   placeholder="https://github.com/owner/repo/pull/123"
                   className="flex-1 bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm text-slate-300 focus:border-cyan-500/50 font-mono"
                 />
                 <button 
                    type="button"
                    onClick={handleFetchRuns}
                    disabled={isLoadingRuns}
                    className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2 rounded text-xs font-bold uppercase border border-slate-700 flex items-center gap-2 transition-all disabled:opacity-50"
                 >
                    {isLoadingRuns ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Layers className="w-3 h-3" />}
                    Load Failed Runs
                 </button>
             </div>
          </div>

          {/* Runs Selection */}
          {foundRuns.length > 0 && (
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 animate-[fadeIn_0.3s_ease-out]">
                  <div className="flex items-center justify-between mb-3 border-b border-slate-800 pb-2">
                      <span className="text-xs font-bold text-slate-400 uppercase">
                          Failed Workflows ({formData.selectedRuns?.length}/{foundRuns.length})
                      </span>
                      <button 
                        onClick={toggleSelectAll}
                        className="text-[10px] text-cyan-500 hover:underline cursor-pointer"
                      >
                          {formData.selectedRuns?.length === foundRuns.length ? 'Deselect All' : 'Select All'}
                      </button>
                  </div>
                  <div className="space-y-2 max-h-[150px] overflow-y-auto">
                      {foundRuns.map(run => (
                          <div key={run.id} 
                               onClick={() => toggleRun(run)}
                               className={`flex items-center p-2 rounded cursor-pointer border transition-colors ${
                                   formData.selectedRuns?.find(r => r.id === run.id) 
                                   ? 'bg-rose-950/20 border-rose-900/50' 
                                   : 'bg-slate-900/50 border-transparent hover:bg-slate-900'
                               }`}
                          >
                              <div className={`w-4 h-4 rounded border flex items-center justify-center mr-3 ${
                                   formData.selectedRuns?.find(r => r.id === run.id) 
                                   ? 'bg-rose-500 border-rose-500' 
                                   : 'border-slate-600'
                              }`}>
                                  {formData.selectedRuns?.find(r => r.id === run.id) && <Check className="w-3 h-3 text-white" />}
                              </div>
                              <div className="flex-1">
                                  <div className="text-xs font-mono text-slate-300">{run.name}</div>
                                  <div className="text-[10px] text-slate-500">ID: {run.id} • SHA: {run.head_sha.substring(0,7)}</div>
                              </div>
                              <div className="text-[10px] text-rose-500 font-bold uppercase">{run.conclusion}</div>
                          </div>
                      ))}
                  </div>
              </div>
          )}
          
          {foundRuns.length === 0 && !isLoadingRuns && formData.prUrl && !validationError && (
              <div className="text-center text-slate-600 text-xs italic py-4">
                  No failed runs loaded. Click "Load Failed Runs" to fetch.
              </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-950/50 border-t border-slate-800 flex justify-end gap-3">
            <button 
                onClick={onClose}
                className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-300 transition-colors uppercase"
            >
                Cancel
            </button>
            <button 
                onClick={handleSave}
                disabled={!formData.selectedRuns?.length}
                className="bg-cyan-600 hover:bg-cyan-500 text-white px-6 py-2 rounded text-xs font-bold uppercase tracking-wider shadow-[0_0_15px_rgba(6,182,212,0.3)] flex items-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
                <Check className="w-4 h-4" />
                Initialize Link
            </button>
        </div>
      </div>
    </div>
  );
};
