import { PrismaClient } from '@prisma/client';
import fs from 'fs';

export class SWEBenchIngestionService {
    constructor(private prisma: PrismaClient) {}

    /**
     * Ingests SWE-bench cases from a JSON file.
     * Each case is stored as external data, and patches are stored as separate diffs.
     */
    async ingestFromJSON(filePath: string) {
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }

        const cases = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const results = [];

        for (const sweCase of cases) {
            // Ingest main case data
            const mainData = await this.prisma.ingestedData.create({
                data: {
                    source: sweCase.id,
                    type: 'external',
                    content: sweCase.initialContext || sweCase.description,
                    metadata: JSON.stringify({
                        repoUrl: sweCase.repoUrl,
                        commitSha: sweCase.commitSha,
                        expectedOutcome: sweCase.expectedOutcome
                    })
                }
            });
            results.push(mainData);

            // Ingest patch if available
            if (sweCase.patch) {
                await this.prisma.ingestedData.create({
                    data: {
                        source: `${sweCase.id}-patch`,
                        type: 'diff',
                        content: sweCase.patch,
                        metadata: JSON.stringify({
                            parentId: sweCase.id
                        })
                    }
                });
            }
        }

        return results;
    }
}
