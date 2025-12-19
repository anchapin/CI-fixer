import { PrismaClient } from '@prisma/client';
import { createPatch } from 'diff';

export class FixPatternService {
    constructor(private prisma: PrismaClient) {}

    /**
     * Extracts a diff pattern between original and modified content and saves it.
     * If a pattern with the same fingerprint already exists, it increments the success count.
     */
    async extractAndSavePattern(
        original: string,
        modified: string,
        errorFingerprint: string,
        errorCategory: string,
        filePath: string
    ) {
        // Generate a unified diff as the pattern
        const diff = createPatch(filePath, original, modified);

        // Check if pattern already exists
        const existing = await this.prisma.fixPattern.findFirst({
            where: { errorFingerprint, errorCategory, filePath }
        });

        if (existing) {
            return await this.prisma.fixPattern.update({
                where: { id: existing.id },
                data: {
                    successCount: existing.successCount + 1,
                    lastUsed: new Date(),
                    fixTemplate: JSON.stringify({ diff }) // Update template too in case it improved
                }
            });
        }

        return await this.prisma.fixPattern.create({
            data: {
                errorFingerprint,
                errorCategory,
                filePath,
                fixTemplate: JSON.stringify({ diff }),
                successCount: 1
            }
        });
    }
}
