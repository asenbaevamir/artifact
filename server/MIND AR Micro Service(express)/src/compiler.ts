/**
 * compiler.ts
 *
 * Wraps the MindAR OfflineCompiler (server-side variant that uses `canvas`
 * instead of browser DOM) to compile preprocessed image buffers into .mind files.
 */

import sharp from 'sharp';
import { createCanvas, loadImage } from 'canvas';
import { logger } from './utils/logger.js';

// We use the pure JS version of TensorFlow to ensure 100% compatibility 
// with MindAR's custom kernels (like BinomialFilter).
import * as tf from '@tensorflow/tfjs';

// ─── Types for the MindAR OfflineCompiler (no public @types) ─────────────────

interface MindARCompiler {
  compileImageTargets(
    images: CanvasLikeImage[],
    progressCallback: (progress: number) => void
  ): Promise<unknown>;
  exportData(): Uint8Array;
}

type CanvasLikeImage = Awaited<ReturnType<typeof loadImage>>;

// ─── Lazy-load OfflineCompiler once ──────────────────────────────────────────

let CompilerClass: new () => MindARCompiler;

async function getCompilerClass(): Promise<new () => MindARCompiler> {
  if (CompilerClass) return CompilerClass;

  try {
    // Ensure we are using the 'cpu' backend (standard for the JS-only tfjs package)
    await tf.setBackend('cpu');
    await tf.ready();
    logger.info('TensorFlow initialized with CPU backend');

    // mind-ar ships ESM source; import it directly from its src path.
    const mod = await import('mind-ar/src/image-target/offline-compiler.js');
    CompilerClass = mod.OfflineCompiler as new () => MindARCompiler;

    logger.info('MindAR OfflineCompiler loaded successfully');
    return CompilerClass;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Failed to load MindAR OfflineCompiler', { error: msg });
    throw new Error(`Cannot load MindAR OfflineCompiler: ${msg}`);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface CompilationResult {
  buffer: Buffer;
  compiledAt: string;
  durationMs: number;
}

export async function preprocessImage(inputPath: string): Promise<Buffer> {
  logger.debug('Preprocessing image with sharp', { inputPath });

  const processed = await sharp(inputPath)
    .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
    .png({ quality: 100 })
    .toBuffer();

  logger.debug('Sharp preprocessing complete', { outputBytes: processed.length });
  return processed;
}

export async function compileMindTarget(pngBuffer: Buffer): Promise<CompilationResult> {
  const startMs = Date.now();
  logger.info('Starting MindAR compilation', { inputBytes: pngBuffer.length });

  const Compiler = await getCompilerClass();
  const compiler = new Compiler();

  const image = await loadImage(pngBuffer);
  logger.debug('Image loaded into canvas', { width: image.width, height: image.height });

  try {
    let lastProgress = 0;
    await compiler.compileImageTargets([image], (progress: number) => {
      const pct = Math.round(progress);
      if (pct >= lastProgress + 10) {
        lastProgress = pct;
        logger.debug(`MindAR compile progress: ${pct}%`);
      }
    });

    const mindUint8 = compiler.exportData();
    const buffer = Buffer.from(mindUint8);

    const durationMs = Date.now() - startMs;
    logger.info('MindAR compilation succeeded', { durationMs, outputBytes: buffer.length });

    return {
      buffer,
      compiledAt: new Date().toISOString(),
      durationMs,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    logger.error('MindAR compilation failed', { error: msg, stack });
    throw new Error(`MindAR compilation error: ${msg}`);
  }
}
