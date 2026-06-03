import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads';

export interface StoredFile {
  storagePath: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function saveFile(
  buffer: Buffer,
  originalName: string,
  mimeType: string
): Promise<StoredFile> {
  await ensureDir(UPLOAD_DIR);
  const ext = path.extname(originalName);
  const storageName = `${uuidv4()}${ext}`;
  const storagePath = path.join(UPLOAD_DIR, storageName);
  await fs.writeFile(storagePath, buffer);
  return {
    storagePath,
    fileName: originalName,
    fileSize: buffer.length,
    mimeType,
  };
}

export async function getFilePath(storagePath: string): Promise<string> {
  await fs.access(storagePath);
  return storagePath;
}

export async function deleteFile(storagePath: string): Promise<void> {
  try {
    await fs.unlink(storagePath);
  } catch {
    // file may already be gone
  }
}

export async function readFile(storagePath: string): Promise<Buffer> {
  return fs.readFile(storagePath);
}
