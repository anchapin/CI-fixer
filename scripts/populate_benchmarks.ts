
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse command line arguments for limit (default 10)
const args = process.argv.slice(2);
const limit = args[0] ? parseInt(args[0], 10) : 10;

const TARGET_FILE = path.resolve(__dirname, '../benchmarks/cases.json');

interface SweBenchRow {
    row: {
        instance_id: string;
        repo: string;
        base_commit: string;
        problem_statement: string;
        // other fields...
    }
}

interface DatasetResponse {
    rows: SweBenchRow[];
}

interface BenchmarkCase {
    id: string;
    description: string;
    repoUrl: string;
    commitSha: string | null;
    initialContext: string;
    expectedOutcome: 'success' | 'failure';
    timeoutSeconds: number;
}

const BATCH_SIZE = 100; // HF API often limits to ~100 rows per request

async function fetchBatch(offset: number, length: number): Promise<SweBenchRow[]> {
    const url = `https://datasets-server.huggingface.co/rows?dataset=SWE-bench%2FSWE-bench_Lite&config=default&split=test&offset=${offset}&length=${length}`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch dataset batch (offset ${offset}): ${response.statusText} (${response.status})`);
    }
    const data = await response.json() as DatasetResponse;
    if (!data.rows || !Array.isArray(data.rows)) {
        throw new Error("Invalid API response format: 'rows' array missing");
    }
    return data.rows;
}

async function main() {
    console.log(`Configured to fetch up to ${limit} cases...`);

    try {
        let sweCases: any[] = [];
        let offset = 0;

        while (sweCases.length < limit) {
            const remaining = limit - sweCases.length;
            const fetchLength = Math.min(remaining, BATCH_SIZE);

            console.log(`Fetching batch: offset=${offset}, length=${fetchLength}...`);
            const batchRows = await fetchBatch(offset, fetchLength);

            if (batchRows.length === 0) {
                console.log("No more rows returned from API.");
                break;
            }

            sweCases = sweCases.concat(batchRows.map(r => r.row));
            offset += batchRows.length;
        }

        console.log(`Total fetched: ${sweCases.length} cases.`);

        const newCases: BenchmarkCase[] = sweCases.map(c => ({
            id: c.instance_id,
            description: `SWE-bench Lite: ${c.repo} issue`,
            repoUrl: `https://github.com/${c.repo}`,
            commitSha: c.base_commit,
            initialContext: c.problem_statement, // Use full context
            expectedOutcome: 'success',
            timeoutSeconds: 600,
            metadata: {
                fail_to_pass: c.fail_to_pass,
                pass_to_pass: c.pass_to_pass,
                hints_text: c.hints_text,
                environment_setup_commit: c.environment_setup_commit
            }
        }));

        // Read existing cases
        let existingCases: BenchmarkCase[] = [];
        if (fs.existsSync(TARGET_FILE)) {
            existingCases = JSON.parse(fs.readFileSync(TARGET_FILE, 'utf-8'));
        }

        // Merge: avoid duplicates by ID
        const finalCases = [...existingCases];
        let addedCount = 0;

        for (const nc of newCases) {
            if (!finalCases.find(ec => ec.id === nc.id)) {
                finalCases.push(nc);
                addedCount++;
            }
        }

        fs.writeFileSync(TARGET_FILE, JSON.stringify(finalCases, null, 4));
        console.log(`Successfully added ${addedCount} new cases to ${TARGET_FILE}`);

    } catch (error) {
        console.error("Error populating benchmarks:", error);
    }
}

main();
