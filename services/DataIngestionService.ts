import { PrismaClient } from '@prisma/client';
import fs from 'fs';

export class DataIngestionService {
    constructor(private prisma: PrismaClient) {}

    /**
     * Ingests a file from the local filesystem and stores it in the database.
     * @param filePath Path to the file to ingest
     * @param category Source category (e.g., 'benchmark', 'live', 'external')
     * @param metadata Optional metadata to store with the data
     */
    async ingestFile(filePath: string, category: string, metadata?: any) {
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }

        const content = fs.readFileSync(filePath, 'utf-8');
        const type = this.inferType(filePath);

        return await this.prisma.ingestedData.create({
            data: {
                source: filePath,
                type: type,
                content: content,
                metadata: metadata ? JSON.stringify(metadata) : null
            }
        });
    }

    /**
     * Ingests raw text data and stores it in the database.
     * @param content Raw text content
     * @param source Source name or identifier
     * @param type Data type (e.g., 'log', 'diff', 'external')
     * @param metadata Optional metadata
     */
    async ingestRawData(content: string, source: string, type: string, metadata?: any) {
        return await this.prisma.ingestedData.create({
            data: {
                source: source,
                type: type,
                content: content,
                metadata: metadata ? JSON.stringify(metadata) : null
            }
        });
    }

    /**
     * Infers the data type based on the file extension
     */
    private inferType(filePath: string): string {
        const ext = filePath.split('.').pop()?.toLowerCase();
        if (ext === 'log' || ext === 'txt') return 'log';
        if (ext === 'diff' || ext === 'patch') return 'diff';
        return 'external';
    }
}
