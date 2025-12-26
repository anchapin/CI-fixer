export interface BunDiagnosis {
    isBunError: boolean;
    description?: string;
}

export class BunErrorPattern {
    private static patterns = [
        {
            regex: /Cannot bundle built-in module "bun:[^"]+"/i,
            description: 'Bun-specific module "bun:test" detected in non-Bun environment'
        },
        {
            regex: /bun: command not found/i,
            description: 'Bun CLI not found'
        },
        {
            regex: /bun: not found/i,
            description: 'Bun CLI not found'
        },
        {
            regex: /ReferenceError: Bun is not defined/i,
            description: 'Global "Bun" object accessed in non-Bun environment'
        }
    ];

    static diagnose(output: string): BunDiagnosis {
        for (const pattern of this.patterns) {
            if (pattern.regex.test(output)) {
                return {
                    isBunError: true,
                    description: pattern.description
                };
            }
        }

        return { isBunError: false };
    }
}
