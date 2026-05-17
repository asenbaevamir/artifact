import sharp from 'sharp';
import path from 'path';
import { logger } from './logger.js';

export interface ImageValidationResult {
  valid: boolean;
  error?: string;
  width?: number;
  height?: number;
  format?: string;
}

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/tiff',
]);

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_DIMENSION = 2000; // px

/**
 * Validates an uploaded image file.
 * Checks MIME type via magic bytes (sharp metadata), file size
 * and that dimensions do not exceed 2000×2000 px.
 */
export async function validateImage(
  filePath: string,
  fileSizeBytes: number
): Promise<ImageValidationResult> {
  // 1. File-size gate (fast, no I/O beyond multer)
  if (fileSizeBytes > MAX_BYTES) {
    return {
      valid: false,
      error: `File size ${fileSizeBytes} bytes exceeds the 10 MB limit.`,
    };
  }

  try {
    const meta = await sharp(filePath).metadata();

    // 2. Format / MIME guard
    const detectedMime = `image/${meta.format}`;
    if (!ALLOWED_MIME_TYPES.has(detectedMime)) {
      return {
        valid: false,
        error: `Unsupported image format: ${meta.format}. Allowed: jpeg, png, webp, gif, bmp, tiff.`,
      };
    }

    // 3. Dimension guard
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;

    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      return {
        valid: false,
        error: `Image dimensions ${width}×${height} exceed the ${MAX_DIMENSION}×${MAX_DIMENSION} px limit.`,
      };
    }

    logger.debug('Image validation passed', {
      filePath: path.basename(filePath),
      width,
      height,
      format: meta.format,
      sizeBytes: fileSizeBytes,
    });

    return { valid: true, width, height, format: meta.format };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('Image validation error', { error: message, filePath: path.basename(filePath) });
    return { valid: false, error: `Cannot read image metadata: ${message}` };
  }
}

