/**
 * Integration layer for RepairAgent fault localization
 * Enhances existing diagnosis with precise fault location information
 */

import { AppConfig } from '../../types.js';
import { DiagnosisResult } from '../analysis/LogAnalysisService.js';
import { localizeFault, parseStackTrace, FaultLocalizationResult } from './fault-localization.js';

export interface EnhancedDiagnosis extends DiagnosisResult {
    faultLocalization?: FaultLocalizationResult;
    preciseLocation?: {
        file: string;
        line: number;
        confidence: number;
    };
}

/**
 * Enhance diagnosis with fault localization
 * This is an optional enhancement layer that can be toggled on/off
 */
export async function enhanceDiagnosisWithFaultLocalization(
    config: AppConfig,
    diagnosis: DiagnosisResult,
    errorLog: string,
    repoContext?: string
): Promise<EnhancedDiagnosis> {

    // Check if fault localization is enabled
    const enabled = process.env.ENABLE_FAULT_LOCALIZATION === 'true';
    if (!enabled) {
        return diagnosis;
    }

    try {
        // Parse stack trace from error log
        const stackTrace = parseStackTrace(errorLog);

        if (stackTrace.length === 0) {
            // No stack trace found, return original diagnosis
            return diagnosis;
        }

        // Perform LLM-based fault localization
        const faultLocalization = await localizeFault(
            config,
            errorLog,
            stackTrace,
            repoContext
        );

        // Enhance diagnosis with precise location
        const enhanced: EnhancedDiagnosis = {
            ...diagnosis,
            faultLocalization,
            preciseLocation: {
                file: faultLocalization.primaryLocation.file,
                line: faultLocalization.primaryLocation.line,
                confidence: faultLocalization.primaryLocation.confidence
            }
        };

        // Override file path if confidence is high
        if (faultLocalization.primaryLocation.confidence > 0.7) {
            enhanced.filePath = faultLocalization.primaryLocation.file;
        }

        return enhanced;

    } catch (error) {
        console.error('[FaultLocalization] Enhancement failed:', error);
        // Fallback to original diagnosis on error
        return diagnosis;
    }
}
