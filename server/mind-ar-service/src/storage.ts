import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream } from 'fs';
import { logger } from './utils/logger.js';

const S3_ENDPOINT = process.env.S3_ENDPOINT ?? 'http://localhost:9000';
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY ?? 'minioadmin';
const S3_SECRET_KEY = process.env.S3_SECRET_KEY ?? 'minioadmin';
const S3_BUCKET = process.env.S3_BUCKET ?? 'ar-targets';
const S3_REGION = process.env.S3_REGION ?? 'us-east-1';
const PRESIGNED_URL_EXPIRES = parseInt(process.env.PRESIGNED_URL_EXPIRES ?? '86400', 10); // 24h

// S3/MinIO client — force path-style for MinIO compatibility
const s3Client = new S3Client({
  endpoint: S3_ENDPOINT,
  region: S3_REGION,
  credentials: {
    accessKeyId: S3_ACCESS_KEY,
    secretAccessKey: S3_SECRET_KEY,
  },
  forcePathStyle: true, // Required for MinIO
});

export interface UploadResult {
  key: string;
  bucket: string;
  publicUrl: string;
  presignedUrl: string;
  expiresAt: string;
}

/**
 * Uploads a .mind file buffer to S3/MinIO.
 * Returns the storage key and a pre-signed URL valid for 24 hours.
 */
export async function uploadMindFile(
  jobId: string,
  buffer: Buffer,
  originalName: string
): Promise<UploadResult> {
  const timestamp = Date.now();
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `mind-files/${jobId}/${timestamp}-${safeName}.mind`;

  const putCommand = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: 'application/octet-stream',
    Metadata: {
      jobId,
      originalName,
      createdAt: new Date().toISOString(),
    },
  });

  await s3Client.send(putCommand);
  logger.info('Uploaded .mind file to S3', { key, bucket: S3_BUCKET, jobId, bytes: buffer.length });

  // Generate pre-signed URL for download
  const getCommand = new GetObjectCommand({ Bucket: S3_BUCKET, Key: key });
  const presignedUrl = await getSignedUrl(s3Client, getCommand, {
    expiresIn: PRESIGNED_URL_EXPIRES,
  });

  const publicUrl = `${S3_ENDPOINT}/${S3_BUCKET}/${key}`;
  const expiresAt = new Date(Date.now() + PRESIGNED_URL_EXPIRES * 1000).toISOString();

  return { key, bucket: S3_BUCKET, publicUrl, presignedUrl, expiresAt };
}

