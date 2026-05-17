import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { logger } from './utils/logger.js';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

export const redisConnection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
});

redisConnection.on('connect', () => logger.info('Redis connected'));
redisConnection.on('error', (err: Error) =>
  logger.error('Redis connection error', { error: err.message })
);

export const QUEUE_NAME = 'ar-target-compilation';

export const arTargetQueue = new Queue(QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: { age: 86400 },
    removeOnFail: { count: 200 },
  },
});

export interface ARTargetJobData {
  jobId: string;
  filePath: string;
  originalName: string;
  fileSizeBytes: number;
  store?: boolean;
}

export async function enqueueARTargetJob(data: ARTargetJobData): Promise<string> {
  const job = await arTargetQueue.add('compile', data, { jobId: data.jobId });
  logger.info('Job enqueued', { jobId: data.jobId, queue: QUEUE_NAME });
  return job.id ?? data.jobId;
}

export async function closeQueue(): Promise<void> {
  await arTargetQueue.close();
  await redisConnection.quit();
  logger.info('Queue connections closed');
}
