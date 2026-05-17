import { existsSync, mkdirSync } from 'fs';
import { readFile, writeFile, unlink } from 'fs/promises';
import path from 'path';

const RESULTS_DIR = process.env.RESULTS_DIR ?? 'results';

mkdirSync(RESULTS_DIR, { recursive: true });

export function getMindFilePath(jobId: string): string {
  return path.join(RESULTS_DIR, `${jobId}.mind`);
}

export async function saveMindFile(jobId: string, buffer: Buffer): Promise<string> {
  const filePath = getMindFilePath(jobId);
  await writeFile(filePath, buffer);
  return filePath;
}

export async function readMindFile(jobId: string): Promise<Buffer> {
  return readFile(getMindFilePath(jobId));
}

export async function deleteMindFile(jobId: string): Promise<void> {
  try {
    await unlink(getMindFilePath(jobId));
  } catch {
    // already removed
  }
}

export function mindFileExists(jobId: string): boolean {
  return existsSync(getMindFilePath(jobId));
}
