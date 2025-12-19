import { PrismaClient } from '@prisma/client';

export class LearningMetricService {
    constructor(private prisma: PrismaClient) {}

    /**
     * Records a new learning metric.
     */
    async recordMetric(metricName: string, value: number, metadata?: any) {
        return await this.prisma.learningMetric.create({
            data: {
                metricName,
                value,
                metadata: metadata ? JSON.stringify(metadata) : null
            }
        });
    }

    /**
     * Retrieves historical values for a specific metric.
     */
    async getMetrics(metricName: string, limit: number = 100) {
        return await this.prisma.learningMetric.findMany({
            where: { metricName },
            orderBy: { timestamp: 'desc' },
            take: limit
        });
    }

    /**
     * Calculates the average value of the most recent N recordings of a metric.
     */
    async getAverageMetricValue(metricName: string, lastN: number = 10): Promise<number> {
        const recent = await this.getMetrics(metricName, lastN);
        if (recent.length === 0) return 0;

        const sum = recent.reduce((acc, m) => acc + m.value, 0);
        return sum / recent.length;
    }
}
