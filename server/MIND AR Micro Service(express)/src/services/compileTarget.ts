import { unlink } from 'fs/promises';
import { validateImage } from '../utils/validation.js';
import { preprocessImage, compileMindTarget } from '../compiler.js';
import { uploadMindFile, type UploadResult } from '../storage.js';
import { logger } from '../utils/logger.js';

export interface CompileTargetOptions {
  /** Upload compiled .mind to S3/MinIO and include URLs in the result */
  store?: boolean;
}

export interface CompileTargetResult {
  mindBuffer: Buffer;
  originalName: string;
  compiledAt: string;
  durationMs: number;
  sizeBytes: number;
  storage?: UploadResult;
}

async function safeDelete(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {
    // already removed
  }
}

/**
 * Validates, preprocesses and compiles an uploaded image into a .mind buffer.
 */
export async function compileARTargetFromFile(
  filePath: string,
  originalName: string,
  fileSizeBytes: number,
  options: CompileTargetOptions = {}
): Promise<CompileTargetResult> {
  const { store = false } = options;

  try {
    const validation = await validateImage(filePath, fileSizeBytes);
    if (!validation.valid) {
      throw new CompileTargetError(validation.error ?? 'Image validation failed', 400);
    }

    const pngBuffer = await preprocessImage(filePath);
    const { buffer: mindBuffer, compiledAt, durationMs } = await compileMindTarget(pngBuffer);

    let storage: UploadResult | undefined;
    if (store) {
      const jobId = crypto.randomUUID();
      storage = await uploadMindFile(jobId, mindBuffer, originalName);
    }

    logger.info('AR target compiled', {
      originalName,
      durationMs,
      mindBytes: mindBuffer.length,
      stored: !!storage,
    });

    return {
      mindBuffer,
      originalName,
      compiledAt,
      durationMs,
      sizeBytes: mindBuffer.length,
      storage,
    };
  } finally {
    await safeDelete(filePath);
  }
}

export class CompileTargetError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    this.name = 'CompileTargetError';
  }
}
