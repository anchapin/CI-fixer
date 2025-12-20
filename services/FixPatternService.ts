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

    /**
     * Analyzes Python code to determine if it uses Pydantic V1 or V2 features.
     * Returns 1 for V1, 2 for V2, or null if undetermined.
     */
    public analyzePydanticVersionRequirement(content: string): number | null {
        const v2Indicators = [
            /\.model_dump\(/,
            /\.model_validate\(/,
            /\.model_dump_json\(/,
            /@field_validator/,
            /@model_validator/,
            /from pydantic import.*RootModel/
        ];

        const v1Indicators = [
            /\.dict\(/,
            /\.json\(/,
            /@validator/,
            /@root_validator/,
            /from pydantic import.*BaseSettings/, // BaseSettings moved to pydantic-settings in V2
            /orm_mode\s*=\s*True/
        ];

        // Count matches
        let v2Count = 0;
        for (const indicator of v2Indicators) {
            if (indicator.test(content)) v2Count++;
        }

        let v1Count = 0;
        for (const indicator of v1Indicators) {
            if (indicator.test(content)) v1Count++;
        }

        if (v2Count > v1Count) return 2;
        if (v1Count > v2Count) return 1;

        return null;
    }

    /**
     * Generates a fix for a dependency conflict by proposing a specific version pin.
     */
    public generateDependencyFix(
        packageName: string,
        versionSpec: string,
        configFiles: { name: string; content: string }[]
    ) {
        for (const file of configFiles) {
            if (file.name === 'requirements.txt') {
                const lines = file.content.split('\n');
                let found = false;
                const newLines = lines.map(line => {
                    if (line.trim().startsWith(packageName) && (line.includes('==') || line.includes('>=') || line.includes('<='))) {
                        found = true;
                        return `${packageName}${versionSpec}`;
                    }
                    return line;
                });

                if (!found) {
                    newLines.push(`${packageName}${versionSpec}`);
                }

                return {
                    filePath: file.name,
                    newContent: newLines.join('\n'),
                    action: `Pin ${packageName} to ${versionSpec} in requirements.txt`
                };
            }
            
            if (file.name === 'pyproject.toml') {
                // Simplified TOML editing
                const lines = file.content.split('\n');
                let inDependencies = false;
                let found = false;
                const newLines = lines.map(line => {
                    if (line.trim().startsWith('[tool.poetry.dependencies]') || line.trim().startsWith('dependencies = [')) {
                        inDependencies = true;
                    } else if (line.trim().startsWith('[') && line.trim() !== '[tool.poetry.dependencies]') {
                        inDependencies = false;
                    }

                    if (inDependencies && line.includes(`${packageName} =`)) {
                        found = true;
                        return line.replace(/=.*/, `= "${versionSpec}"`);
                    }
                    return line;
                });

                if (!found && file.content.includes('[tool.poetry.dependencies]')) {
                    // Find where to insert
                    const index = newLines.findIndex(l => l.trim() === '[tool.poetry.dependencies]');
                    newLines.splice(index + 1, 0, `${packageName} = "${versionSpec}"`);
                }

                return {
                    filePath: file.name,
                    newContent: newLines.join('\n'),
                    action: `Pin ${packageName} to ${versionSpec} in pyproject.toml`
                };
            }
        }

        return {
            action: `pip install "${packageName}${versionSpec}"`,
            command: `pip install "${packageName}${versionSpec}"`
        };
    }
}
