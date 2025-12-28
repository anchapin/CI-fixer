import { PrismaClient } from '@prisma/client';
import { createPatch } from 'diff';
import { PipInstallReport, PackageMetadata } from '../types';

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
     * Analyzes a pip dry-run report for dependency conflicts.
     * @param pipReportJson The JSON string output from `pip install --dry-run --report`.
     * @param originalRequirementsContent The original content of the requirements.txt file.
     * @returns An array of strings, each describing a detected conflict.
     */
    public analyzePipReportForConflicts(
        pipReportJson: string,
        originalRequirementsContent: string
    ): string[] {
        const conflicts: string[] = [];
        let report: PipInstallReport;

        try {
            report = JSON.parse(pipReportJson);
        } catch (e) {
            console.error("Failed to parse pip report JSON:", e);
            return ["Error: Failed to parse pip dry-run report."];
        }

        // Parse original requirements to get requested versions
        const requestedPackages = new Map<string, string>(); // packageName -> versionSpec
        originalRequirementsContent.split('\n').forEach(line => {
            const trimmedLine = line.trim();
            if (trimmedLine && !trimmedLine.startsWith('#')) {
                const match = trimmedLine.match(/^([a-zA-Z0-9_-]+)(.*)$/);
                if (match) {
                    requestedPackages.set(match[1], match[2].trim());
                } else {
                    // Handle cases where a package name might not have a version spec
                    requestedPackages.set(trimmedLine, '');
                }
            }
        });

        // Analyze installed packages from the report
        const installedPackages = new Map<string, PackageMetadata>(); // packageName -> metadata
        report.install.forEach(item => {
            installedPackages.set(item.metadata.name, item.metadata);
        });

        // Check for direct conflicts (requested vs. installed)
        requestedPackages.forEach((requestedSpec, packageName) => {
            const installed = installedPackages.get(packageName);
            if (installed) {
                // Simplified check: If requested has a strict '==' and installed is different
                const requestedVersionMatch = requestedSpec.match(/==(.*)$/);
                if (requestedVersionMatch && installed.version !== requestedVersionMatch[1]) {
                    conflicts.push(
                        `Conflict: Requested ${packageName}${requestedSpec} but resolved to ${packageName}==${installed.version}.`
                    );
                }
                // More complex checks for ranges would be needed here for full robustness
                // For now, focus on direct contradictions
            } else {
                // If a requested package is not even in the installed list, it might be a deeper issue
                conflicts.push(`Warning: Requested package "${packageName}" not found in pip dry-run report results. This might indicate a deeper conflict or that the package is simply not installable.`);
            }
        });

        // Check for transitive dependency conflicts (requires_dist)
        report.install.forEach(item => {
            item.metadata.requires_dist.forEach(req => {
                const reqMatch = req.match(/^([a-zA-Z0-9_-]+)(.*)$/);
                if (reqMatch) {
                    const depName = reqMatch[1];
                    const depSpec = reqMatch[2].trim();
                    
                    const installedDep = installedPackages.get(depName);
                    if (installedDep && !this.checkVersionCompatibility(installedDep.version, depSpec)) {
                         conflicts.push(
                            `Transitive Conflict: Package ${item.metadata.name} requires ${depName}${depSpec}, but ${depName}==${installedDep.version} was resolved, which is incompatible.`
                        );
                    }
                }
            });
        });

        return conflicts;
    }

    private checkVersionCompatibility(installedVersion: string, requiredSpec: string): boolean {
        // A simple version comparison function. For a production system, a robust semver library is recommended.
        // This handles '==' and '>=' and some basic '<' and '<=' for integers.
        // It does NOT handle complex specifiers like '~=' or multiple conditions.
        if (!requiredSpec) return true; // No specific requirement, assume compatible

        const parts = requiredSpec.split(/(==|>=|<=|<|>)/).map(s => s.trim()).filter(s => s);
        if (parts.length < 2) {
            // E.g., just "package", assume compatible
            return true;
        }

        const operator = parts[0];
        const requiredVersion = parts[1];

        // Basic integer-based comparison for simplicity, won't handle semver properly
        // For example, '1.10.0' > '1.9.0' but string comparison '1.10.0' < '1.9.0'
        // This needs to be improved for robust version comparison.
        // For now, focus on exact matches and simple greater/less than.
        try {
            const instV = this.parseVersionToComparable(installedVersion);
            const reqV = this.parseVersionToComparable(requiredVersion);

            switch (operator) {
                case '==': return installedVersion === requiredVersion;
                case '>=': return instV >= reqV;
                case '<=': return instV <= reqV;
                case '>': return instV > reqV;
                case '<': return instV < reqV;
                default: return true; // Unknown operator, assume compatible
            }
        } catch (e) {
            console.warn(`Failed to parse versions for compatibility check: ${installedVersion} vs ${requiredSpec}`, e);
            return false; // Cannot reliably compare
        }
    }

    private parseVersionToComparable(version: string): number {
        // Simple conversion for basic comparison. Real semver comparison is complex.
        // This just takes the major.minor.patch and converts to a single number
        // e.g., 1.2.3 -> 1002003
        const parts = version.split('.').map(Number);
        return parts[0] * 1_000_000 + (parts[1] || 0) * 1_000 + (parts[2] || 0);
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
