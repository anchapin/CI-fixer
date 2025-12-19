
import fs from 'fs';
import path from 'path';
import { GymObservation, GymAction, GymStepResult } from './environment';
import { AgentState } from '../../types';

export interface TrajectoryStep {
    step: number;
    observation: GymObservation;
    action: GymAction;
    reward: number;
    done: boolean;
    info: Record<string, any>;
    timestamp: number;
}

export interface Trajectory {
    id: string;
    repoUrl: string;
    startTime: string;
    steps: TrajectoryStep[];
    totalReward: number;
    success: boolean;
}

export class GymRecorder {
    private trajectory: Trajectory;
    private logDir: string;

    constructor(runId: string, repoUrl: string, baseLogDir?: string) {
        this.logDir = baseLogDir || path.resolve(process.cwd(), 'logs', 'gym');
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }

        this.trajectory = {
            id: runId,
            repoUrl,
            startTime: new Date().toISOString(),
            steps: [],
            totalReward: 0,
            success: false
        };
    }

    recordStep(step: number, action: GymAction, result: GymStepResult) {
        this.trajectory.steps.push({
            step,
            observation: result.observation,
            action,
            reward: result.reward,
            done: result.done,
            info: result.info,
            timestamp: Date.now()
        });
        this.trajectory.totalReward += result.reward;
    }

    finalize(success: boolean) {
        this.trajectory.success = success;
        const filename = `traj_${this.trajectory.id}_${Date.now()}.json`;
        const filepath = path.resolve(this.logDir, filename);

        fs.writeFileSync(filepath, JSON.stringify(this.trajectory, null, 2));
        console.log(`[GymRecorder] Trajectory saved to ${filepath}`);
    }
}
