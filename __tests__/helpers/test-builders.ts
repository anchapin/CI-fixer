import { GraphState } from '../../agent/graph/state.js';
import { AppConfig, RunGroup, FileChange } from '../../types.js';
import { DiagnosisResult } from '../../services/analysis/LogAnalysisService.js';
import { ClassifiedError } from '../../errorClassification.js';
import { createMockConfig, createMockRunGroup, createMockDiagnosis, createMockClassification, createMockFileChange } from './test-fixtures.js';

/**
 * Builder pattern for creating GraphState in tests
 * Provides a fluent API for constructing test states
 */
export class GraphStateBuilder {
    private state: Partial<GraphState> = {};

    constructor() {
        // Start with sensible defaults
        this.state = {
            config: createMockConfig(),
            group: createMockRunGroup(),
            activeLog: 'test-log',
            currentNode: 'analysis',
            iteration: 0,
            maxIterations: 3,
            status: 'working',
            initialRepoContext: 'Mock repo context',
            initialLogText: '',
            currentLogText: '',
            files: {},
            fileReservations: [],
            history: [],
            feedback: []
        };
    }

    withConfig(config: Partial<AppConfig>): this {
        this.state.config = { ...this.state.config!, ...config };
        return this;
    }

    withGroup(group: Partial<RunGroup>): this {
        this.state.group = { ...this.state.group!, ...group };
        return this;
    }

    withLogText(logText: string): this {
        this.state.currentLogText = logText;
        if (!this.state.initialLogText) {
            this.state.initialLogText = logText;
        }
        return this;
    }

    withInitialLogText(logText: string): this {
        this.state.initialLogText = logText;
        return this;
    }

    withDiagnosis(diagnosis: Partial<DiagnosisResult>): this {
        this.state.diagnosis = { ...createMockDiagnosis(), ...diagnosis };
        return this;
    }

    withClassification(classification: Partial<ClassifiedError>): this {
        this.state.classification = { ...createMockClassification(), ...classification };
        return this;
    }

    withPlan(plan: string): this {
        this.state.plan = plan;
        return this;
    }

    atNode(nodeName: string): this {
        this.state.currentNode = nodeName;
        return this;
    }

    atIteration(iteration: number): this {
        this.state.iteration = iteration;
        return this;
    }

    withMaxIterations(maxIterations: number): this {
        this.state.maxIterations = maxIterations;
        return this;
    }

    withStatus(status: 'working' | 'success' | 'failed' | 'stopped'): this {
        this.state.status = status;
        return this;
    }

    withFailureReason(reason: string): this {
        this.state.failureReason = reason;
        return this;
    }

    withFileReservations(files: string[]): this {
        this.state.fileReservations = files;
        return this;
    }

    withFile(path: string, change: Partial<FileChange> = {}): this {
        this.state.files = {
            ...this.state.files,
            [path]: createMockFileChange(path, change)
        };
        return this;
    }

    withFiles(files: Record<string, FileChange>): this {
        this.state.files = files;
        return this;
    }

    withFeedback(feedback: string[]): this {
        this.state.feedback = feedback;
        return this;
    }

    addFeedback(feedback: string): this {
        this.state.feedback = [...(this.state.feedback || []), feedback];
        return this;
    }

    withHistory(history: GraphState['history']): this {
        this.state.history = history;
        return this;
    }

    addHistoryEntry(node: string, action: string, result: string): this {
        this.state.history = [
            ...(this.state.history || []),
            { node, action, result, timestamp: Date.now() }
        ];
        return this;
    }

    withRepoContext(context: string): this {
        this.state.initialRepoContext = context;
        return this;
    }

    withCurrentErrorFactId(id: string): this {
        this.state.currentErrorFactId = id;
        return this;
    }

    /**
     * Build the final GraphState
     */
    build(): GraphState {
        return this.state as GraphState;
    }

    /**
     * Reset to default state
     */
    reset(): this {
        this.state = {
            config: createMockConfig(),
            group: createMockRunGroup(),
            activeLog: 'test-log',
            currentNode: 'analysis',
            iteration: 0,
            maxIterations: 3,
            status: 'working',
            initialRepoContext: 'Mock repo context',
            initialLogText: '',
            currentLogText: '',
            files: {},
            fileReservations: [],
            history: [],
            feedback: []
        };
        return this;
    }
}

/**
 * Convenience function to create a builder
 */
export const buildGraphState = () => new GraphStateBuilder();
