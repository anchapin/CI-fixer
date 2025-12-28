import { glob } from 'tinyglobby';
import path from 'path';
import fs from 'fs/promises';

export class PathAwareSearchEngine {
  private rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  async findCandidates(inputPath: string): Promise<string[]> {
    const fullPath = path.resolve(this.rootDir, inputPath);
    
    // 1. Check if it exists exactly
    try {
      await fs.access(fullPath);
      // It exists, return normalized relative path
      return [path.relative(this.rootDir, fullPath).replace(/\\/g, '/')];
    } catch {
      // 2. Search by filename
      const filename = path.basename(inputPath);
      const patterns = [`**/${filename}`];
      
      const results = await glob(patterns, {
        cwd: this.rootDir,
        absolute: false,
        onlyFiles: true
      });
      
      const normalizedResults = results.map(p => p.replace(/\\/g, '/'));

      if (normalizedResults.length <= 1) {
        return normalizedResults;
      }

      // 3. Rank results based on path segment overlap
      const normalizedInput = inputPath.replace(/\\/g, '/');
      
      normalizedResults.sort((a, b) => {
        const scoreA = this.calculateScore(normalizedInput, a);
        const scoreB = this.calculateScore(normalizedInput, b);
        return scoreB - scoreA; // Descending
      });

      return normalizedResults;
    }
  }

  private calculateScore(target: string, candidate: string): number {
    const targetParts = target.split('/');
    const candidateParts = candidate.split('/');
    
    const targetSet = new Set(targetParts);
    let matches = 0;
    
    for (const part of candidateParts) {
      if (targetSet.has(part)) {
        matches++;
      }
    }
    
    return matches;
  }
}