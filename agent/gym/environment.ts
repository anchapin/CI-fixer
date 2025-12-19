
import { SandboxEnvironment } from '../../sandbox';
import { AgentState, AgentPhase } from '../../types';
import { GymRecorder } from './recorder';

export interface GymObservation {
    state: AgentState;
    lastLog: string;
}

export interface GymStepResult {
    observation: GymObservation;
    reward: number;
    done: boolean;
    info: Record<string, any>;
}

export type GymAction =
    | { type: 'run_command'; command: string }
    | { type: 'write_file'; path: string; content: string }
    | { type: 'submit_fix' };

export class CIFixerEnv {
    private sandbox: SandboxEnvironment | undefined;
    private currentStep: number = 0;
    private maxSteps: number = 50;
    private recorder?: GymRecorder;

    constructor(
        private sandboxFactory: () => Promise<SandboxEnvironment>,
        recorder?: GymRecorder
    ) {
        this.recorder = recorder;
    }

    async reset(): Promise<GymObservation> {
        this.currentStep = 0;
        this.sandbox = await this.sandboxFactory();

        // Return initial observation (empty state for now)
        return {
            state: this.getEmptyState(),
            lastLog: "Environment reset."
        };
    }

    async step(action: GymAction): Promise<GymStepResult> {
        if (!this.sandbox) throw new Error("Environment not initialized. Call reset() first.");

        this.currentStep++;
        let reward = -0.1; // Step cost
        let done = false;
        let info: Record<string, any> = {};
        let lastLog = "";

        // Execute Action
        try {
            if (action.type === 'run_command') {
                const result = await this.sandbox.exec(action.command);
                lastLog = `STDOUT: ${result.stdout}\nSTDERR: ${result.stderr}`;
                if (result.exitCode !== 0) {
                    reward -= 0.5; // Penalty for failing command
                }
            } else if (action.type === 'write_file') {
                await this.sandbox.writeFile(action.path, action.content);
                lastLog = `Wrote file ${action.path}`;
            } else if (action.type === 'submit_fix') {
                done = true;
                reward += 10.0; // Assume success for mock/gym logic until verification is integrated
            }
        } catch (e: any) {
            lastLog = `Error executing action: ${e.message}`;
            reward -= 1.0;
        }

        if (this.currentStep >= this.maxSteps) {
            done = true;
        }

        const result: GymStepResult = {
            observation: {
                state: this.getEmptyState(),
                lastLog
            },
            reward,
            done,
            info
        };

        if (this.recorder) {
            this.recorder.recordStep(this.currentStep, action, result);
        }

        return result;
    }

    private getEmptyState(): AgentState {
        return {
            groupId: 'gym-group',
            name: 'gym-agent',
            phase: AgentPhase.IDLE,
            iteration: 0,
            status: 'idle',
            files: {},
            activeLog: undefined,
            fileReservations: [],
            budgetRemaining: undefined
        };
    }

    async close() {
        if (this.sandbox) {
            await this.sandbox.teardown();
        }
    }
}
