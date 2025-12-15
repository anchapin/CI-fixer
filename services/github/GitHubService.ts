
import { AppConfig, WorkflowRun, CodeFile, RunGroup } from '../../types.js';
import { retryWithBackoff } from '../llm/LLMService.js';

export type LogStrategy = 'standard' | 'extended' | 'any_error' | 'force_latest';

// GitHub API Helpers
export async function getPRFailedRuns(token: string, owner: string, repo: string, prNumber: string, excludePatterns: string[] = []): Promise<WorkflowRun[]> {
    const prRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (!prRes.ok) throw new Error("GitHub Authentication Failed or PR not found");
    const prData = await prRes.json();
    const headSha = prData.head.sha;

    const runsRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/runs?head_sha=${headSha}`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    const runsData = await runsRes.json();

    let runs = runsData.workflow_runs as WorkflowRun[];

    if (runs) {
        runs = runs.filter(r => r.conclusion === 'failure');
        if (excludePatterns && excludePatterns.length > 0) {
            runs = runs.filter(r => !excludePatterns.some(p => r.name.toLowerCase().includes(p.toLowerCase())));
        }
        runs = runs.map(r => ({
            ...r,
            path: r.path || `.github/workflows/${r.name}.yml`
        }));
    } else {
        runs = [];
    }

    return runs;
}

export async function getWorkflowLogs(repoUrl: string, runId: number, token: string, strategy: LogStrategy = 'standard'): Promise<{ logText: string, jobName: string, headSha: string }> {
    const [owner, repo] = repoUrl.split('/');

    const runRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    const runData = await runRes.json();
    const headSha = runData.head_sha || "unknown_sha";

    // Strategy Logic construction
    let jobsUrl = `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/jobs`;
    if (strategy === 'extended' || strategy === 'any_error') {
        jobsUrl += '?per_page=100';
    }

    const jobsRes = await fetch(jobsUrl, {
        headers: { Authorization: `Bearer ${token}` }
    });
    const jobsData = await jobsRes.json();

    let failedJob;

    if (strategy === 'any_error') {
        // Look for anything that isn't success or skipped
        failedJob = jobsData.jobs?.find((j: any) => j.conclusion && j.conclusion !== 'success' && j.conclusion !== 'skipped' && j.conclusion !== 'neutral');
    } else {
        // Standard: strictly looks for 'failure'
        failedJob = jobsData.jobs?.find((j: any) => j.conclusion === 'failure');
    }

    if (!failedJob) {
        // Fallback: If the run failed but no specific job failed
        if (runData.conclusion === 'failure' || runData.conclusion === 'timed_out') {
            const checkSuiteUrl = runData.check_suite_url;
            let failureDetails = `Workflow Run Failed (${runData.conclusion}) but no individual job failed.\n`;

            try {
                if (checkSuiteUrl) {
                    const checkRunsRes = await fetch(`${checkSuiteUrl}/check-runs`, { headers: { Authorization: `Bearer ${token}` } });
                    const checkRunsData = await checkRunsRes.json();
                    const failedCheck = checkRunsData.check_runs?.find((c: any) => c.conclusion === 'failure');

                    if (failedCheck) {
                        failureDetails += `Check Run '${failedCheck.name}' failed.\nOutput: ${failedCheck.output?.summary || "No summary"}\n${failedCheck.output?.text || ""}`;
                    } else {
                        failureDetails += "Could not locate specific check run failure. Possible invalid YAML or secrets.";
                    }
                }
            } catch (e: any) {
                failureDetails += `Failed to fetch failure annotations: ${e.message}`;
            }

            return {
                logText: failureDetails,
                jobName: "Workflow Setup",
                headSha
            };
        }

        return {
            logText: `No failed job found in this run (Strategy: ${strategy}). Status: ${runData.status}, Conclusion: ${runData.conclusion}`,
            jobName: "unknown",
            headSha
        };
    }

    const logRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/jobs/${failedJob.id}/logs`, {
        headers: { Authorization: `Bearer ${token}` }
    });

    const logText = await logRes.text();
    return { logText, jobName: failedJob.name, headSha };
}

export async function getFileContent(config: AppConfig, path: string): Promise<CodeFile> {
    const [owner, repo] = config.repoUrl.split('/');
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${config.githubToken}` }
    });

    if (!res.ok) {
        if (res.status === 404) throw new Error(`404 File Not Found: ${path}`);
        throw new Error(`Failed to fetch file: ${path}`);
    }

    const data = await res.json();
    if (Array.isArray(data)) throw new Error(`Path '${path}' is a directory`);

    const content = atob(data.content);
    const extension = path.split('.').pop() || 'txt';

    let language = 'text';
    if (['js', 'jsx', 'ts', 'tsx'].includes(extension)) language = 'javascript';
    else if (['py'].includes(extension)) language = 'python';
    else if (extension === 'dockerfile' || path.includes('Dockerfile')) language = 'dockerfile';
    else if (['yml', 'yaml'].includes(extension)) language = 'yaml';
    else if (['json'].includes(extension)) language = 'json';

    return {
        name: data.name,
        language,
        content,
        sha: data.sha
    };
}

export async function findClosestFile(config: AppConfig, filePath: string): Promise<{ file: CodeFile, path: string } | null> {
    if (!filePath) return null;
    try {
        const file = await getFileContent(config, filePath);
        return { file, path: filePath };
    } catch (e) {
        return null;
    }
}

export async function pushMultipleFilesToGitHub(config: AppConfig, files: { path: string, content: string }[], branchName: string): Promise<string> {
    const [owner, repo] = config.repoUrl.split('/');
    const headers = {
        'Authorization': `Bearer ${config.githubToken}`,
        'Content-Type': 'application/json'
    };

    const attemptPush = async () => {
        const refRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${branchName}`, { headers });
        if (!refRes.ok) {
            if (refRes.status === 404) throw new Error(`Branch '${branchName}' not found`);
            const err = new Error(`Failed to get ref for branch ${branchName}: ${refRes.statusText}`);
            (err as any).noRetry = refRes.status === 401 || refRes.status === 403;
            throw err;
        }
        const refData = await refRes.json();
        const latestCommitSha = refData.object.sha;

        const commitRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/commits/${latestCommitSha}`, { headers });
        if (!commitRes.ok) throw new Error("Failed to get latest commit");
        const commitData = await commitRes.json();
        const baseTreeSha = commitData.tree.sha;

        const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                base_tree: baseTreeSha,
                tree: files.map(f => ({
                    path: f.path,
                    mode: '100644',
                    type: 'blob',
                    content: f.content
                }))
            })
        });
        if (!treeRes.ok) throw new Error("Failed to create git tree");
        const treeData = await treeRes.json();
        const newTreeSha = treeData.sha;

        const newCommitRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/commits`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                message: `Auto-fix via CI Fixer Agent: Updated ${files.length} files`,
                tree: newTreeSha,
                parents: [latestCommitSha]
            })
        });
        if (!newCommitRes.ok) throw new Error("Failed to create commit");
        const newCommitData = await newCommitRes.json();
        const newCommitSha = newCommitData.sha;

        const updateRefRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branchName}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({
                sha: newCommitSha
            })
        });

        if (!updateRefRes.ok) {
            const errorText = await updateRefRes.text();
            throw new Error(`Failed to update branch ref (${updateRefRes.status}): ${errorText}`);
        }

        return newCommitData.html_url || `https://github.com/${owner}/${repo}/commit/${newCommitSha}`;
    };

    try {
        return await retryWithBackoff(attemptPush, 5, 1000);
    } catch (e: any) {
        throw new Error(`Push failed after retries: ${e.message}`);
    }
}
