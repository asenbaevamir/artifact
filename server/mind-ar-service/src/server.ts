import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import multer from 'multer';
import path from 'path';
import { mkdirSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { enqueueARTargetJob, arTargetQueue, closeQueue } from './queue.js';
import { readMindFile, deleteMindFile, mindFileExists } from './services/jobResults.js';
import type { JobResultMeta } from './types/job.js';
import { logger } from './utils/logger.js';

// ─── Bootstrap ────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? 'uploads';

mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();

app.use(helmet());
app.disable('x-powered-by');

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX ?? '60', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again after a minute.' },
});

app.use(limiter);

app.use(
  morgan('combined', {
    stream: { write: (message: string) => logger.http(message.trim()) },
  })
);

app.use(express.json());

// ─── Multer ───────────────────────────────────────────────────────────────────

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, _file, cb) => {
    cb(null, `${uuidv4()}-${Date.now()}${path.extname(_file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff'];
    allowed.includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error(`Unsupported MIME type: ${file.mimetype}`));
  },
});

// ─── Job status helpers ───────────────────────────────────────────────────────

type PublicJobStatus = 'queued' | 'processing' | 'completed' | 'failed';

function mapBullState(state: string | undefined): PublicJobStatus {
  switch (state) {
    case 'active':
      return 'processing';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    default:
      return 'queued';
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * POST /api/v1/ar-target
 * Backend-to-backend: submit image, get jobId immediately.
 * Poll GET /api/v1/ar-target/:jobId to download .mind when ready.
 */
app.post(
  '/api/v1/ar-target',
  upload.single('image'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.file) {
        res.status(400).json({
          error: 'No image file provided. Use multipart/form-data with field name "image".',
        });
        return;
      }

      const jobId = uuidv4();
      const store = req.query.store === 'true' || req.query.store === '1';

      await enqueueARTargetJob({
        jobId,
        filePath: req.file.path,
        originalName: req.file.originalname,
        fileSizeBytes: req.file.size,
        store,
      });

      logger.info('Job accepted', {
        jobId,
        originalName: req.file.originalname,
        sizeBytes: req.file.size,
      });

      res.status(202).json({
        jobId,
        status: 'queued',
        message: 'Compilation started. Poll GET /api/v1/ar-target/:jobId for the .mind file.',
        statusUrl: `/api/v1/ar-target/${jobId}`,
        downloadUrl: `/api/v1/ar-target/${jobId}`,
        queuedAt: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/ar-target/:jobId
 * - status=queued|processing → 202 JSON
 * - status=failed → 422 JSON
 * - status=completed → 200 binary .mind file
 */
app.get('/api/v1/ar-target/:jobId', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { jobId } = req.params;
    const statusOnly = req.query.status === 'true' || req.query.status === '1';

    const job = await arTargetQueue.getJob(jobId);

    if (!job) {
      res.status(404).json({ error: 'Job not found.', jobId });
      return;
    }

    const state = await job.getState();
    const publicStatus = mapBullState(state);
    const progress = typeof job.progress === 'number' ? job.progress : 0;

    if (publicStatus === 'failed') {
      const reason = job.failedReason ?? 'Compilation failed';
      res.status(422).json({ jobId, status: 'failed', error: reason });
      return;
    }

    if (publicStatus !== 'completed') {
      res.status(202).json({
        jobId,
        status: publicStatus,
        progress,
        message:
          publicStatus === 'processing'
            ? 'Compilation in progress.'
            : 'Job is queued, waiting for a worker.',
        retryAfterSeconds: 3,
      });
      return;
    }

    // Completed
    const meta = job.returnvalue as JobResultMeta | undefined;

    if (statusOnly) {
      res.status(200).json({
        jobId,
        status: 'completed',
        progress: 100,
        originalName: meta?.originalName,
        filename: meta?.filename,
        sizeBytes: meta?.sizeBytes,
        compiledAt: meta?.compiledAt,
        durationMs: meta?.durationMs,
      });
      return;
    }

    if (!mindFileExists(jobId)) {
      res.status(500).json({
        error: 'Compiled file not found. The job completed but the result file is missing.',
        jobId,
      });
      return;
    }

    const mindBuffer = await readMindFile(jobId);
    const filename = meta?.filename ?? `${jobId}.mind`;

    res
      .status(200)
      .set({
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(mindBuffer.length),
        'X-Job-Id': jobId,
        'X-Compile-Duration-Ms': String(meta?.durationMs ?? ''),
      })
      .send(mindBuffer);

    // Cleanup result after successful download
    if (req.query.keep !== 'true') {
      await deleteMindFile(jobId);
    }

    logger.info('Mind file delivered', { jobId, bytes: mindBuffer.length });
  } catch (err) {
    next(err);
  }
});

// ─── Error handlers ───────────────────────────────────────────────────────────

app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: 'File too large. Maximum allowed size is 10 MB.' });
      return;
    }
    res.status(400).json({ error: `Upload error: ${err.message}` });
    return;
  }

  if (err instanceof Error) {
    logger.error('Unhandled error', { error: err.message, path: req.path });
    res.status(500).json({ error: 'An internal error occurred.' });
    return;
  }

  res.status(500).json({ error: 'Unknown error.' });
});

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found.' });
});

// ─── Server ───────────────────────────────────────────────────────────────────

const server = app.listen(PORT, () => {
  logger.info('API server started', { port: PORT });
});

async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, shutting down…`);
  server.close(async () => {
    await closeQueue();
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
