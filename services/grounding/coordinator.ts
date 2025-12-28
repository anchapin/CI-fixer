import { PathAwareSearchEngine } from './search';
import { GroundingRequest, GroundingResult, GroundingAction } from './types';
import path from 'path';

export class GroundingCoordinator {
  private searchEngine: PathAwareSearchEngine;
  private rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.searchEngine = new PathAwareSearchEngine(rootDir);
  }

  async ground(request: GroundingRequest): Promise<GroundingResult> {
    const inputPath = request.path;
    
    const candidates = await this.searchEngine.findCandidates(inputPath);
    
    if (candidates.length === 0) {
      return {
        originalPath: inputPath,
        groundedPath: null,
        success: false,
        confidence: 0,
        error: `File not found: ${inputPath} (and no similar files found)`
      };
    }
    
    // Normalize inputPath to relative for comparison
    const normalizedInput = path.relative(this.rootDir, path.resolve(this.rootDir, inputPath)).replace(/\\/g, '/');
    
    if (candidates.includes(normalizedInput)) {
      // It exists exactly
      return {
        originalPath: inputPath,
        groundedPath: normalizedInput,
        success: true,
        confidence: 1.0
      };
    }
    
    // Auto-Correction logic
    if (candidates.length === 1) {
      // Unique match
      return {
        originalPath: inputPath,
        groundedPath: candidates[0],
        success: true,
        confidence: 0.9 // High confidence
      };
    }
    
    // Multiple matches
    // Spec: "If multiple matches... fail"
    return {
      originalPath: inputPath,
      groundedPath: null,
      success: false,
      confidence: 0, 
      error: `Ambiguous path: ${inputPath}. Found multiple candidates: ${candidates.join(', ')}`
    };
  }
}
