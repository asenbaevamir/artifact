import { Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import path from 'path';
import { QUEUE_NAME, type ARTargetJobData } from './queue.js';
import { compileARTargetFromFile, CompileTargetError } from './services/compileTarget.js';
import { saveMindFile } from './services/jobResults.js';
import type { JobResultMeta } from './types/job.js';
import { logger } from './utils/logger.js';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

const workerRedis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
});

async function processJob(job: Job<ARTargetJobData>): Promise<JobResultMeta> {
  const { jobId, filePath, originalName, fileSizeBytes, store } = job.data;

  logger.info('Processing job', { jobId, attempt: job.attemptsMade + 1 });

  await job.updateProgress(10);

  const result = await compileARTargetFromFile(filePath, originalName, fileSizeBytes, { store });

  await job.updateProgress(90);

  const filename = safeMindFilename(originalName);
  await saveMindFile(jobId, result.mindBuffer);

  await job.updateProgress(100);

  const meta: JobResultMeta = {
    originalName: result.originalName,
    filename,
    sizeBytes: result.sizeBytes,
    compiledAt: result.compiledAt,
    durationMs: result.durationMs,
  };

  logger.info('Job completed', { jobId, mindBytes: result.sizeBytes, durationMs: result.durationMs });

  return meta;
}

function safeMindFilename(originalName: string): string {
  const base = path.basename(originalName, path.extname(originalName));
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, '_') || 'target';
  return `${safe}.mind`;
}

const worker = new Worker<ARTargetJobData, JobResultMeta>(
  QUEUE_NAME,
  async (job) => {
    try {
      return await processJob(job);
    } catch (err) {
      if (err instanceof CompileTargetError) {
        throw new Error(err.message);
      }
      throw err;
    }
  },
  {
    connection: workerRedis,
    concurrency: parseInt(process.env.WORKER_CONCURRENCY ?? '3', 10),
  }
);

worker.on('completed', (job) => {
  logger.info('Worker: job completed', { jobId: job.data.jobId });
});

worker.on('failed', (job, err) => {
  logger.error('Worker: job failed', {
    jobId: job?.data?.jobId,
    error: err.message,
  });
});

worker.on('error', (err) => {
  logger.error('Worker error', { error: err.message });
});

logger.info('AR target worker started', {
  queue: QUEUE_NAME,
  concurrency: worker.opts.concurrency,
});

async function shutdown(signal: string): Promise<void> {
  logger.info(`Worker received ${signal}, shutting down…`);
  await worker.close();
  await workerRedis.quit();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
