/**
 * File storage — Supabase Storage when configured, local disk otherwise.
 *
 * Render's free-tier filesystem is ephemeral: files written to disk are lost on
 * every deploy, restart, or idle spin-down. Production must set SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY so files persist in a Supabase Storage bucket.
 * Local development needs neither — it falls back to the ./uploads directory.
 *
 * Supabase-stored paths are prefixed "sb:" in the database so legacy
 * local-disk paths keep resolving through the disk branch.
 */

import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads';
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? 'records';
const SB_PREFIX = 'sb:';

let client: SupabaseClient | null = null;
let bucketReady = false;

function getSupabase(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  if (!client) client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

async function ensureBucket(sb: SupabaseClient): Promise<void> {
  if (bucketReady) return;
  const { error } = await sb.storage.createBucket(BUCKET, { public: false });
  if (error && !/already exists/i.test(error.message)) {
    throw new Error(`Failed to create storage bucket "${BUCKET}": ${error.message}`);
  }
  bucketReady = true;
}

export interface StoredFile {
  storagePath: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

export async function saveFile(
  buffer: Buffer,
  originalName: string,
  mimeType: string
): Promise<StoredFile> {
  const ext = path.extname(originalName);
  const storageName = `${uuidv4()}${ext}`;

  const sb = getSupabase();
  if (sb) {
    await ensureBucket(sb);
    const { error } = await sb.storage.from(BUCKET).upload(storageName, buffer, {
      contentType: mimeType,
    });
    if (error) throw new Error(`Failed to upload file to storage: ${error.message}`);
    return {
      storagePath: `${SB_PREFIX}${storageName}`,
      fileName: originalName,
      fileSize: buffer.length,
      mimeType,
    };
  }

  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const storagePath = path.join(UPLOAD_DIR, storageName);
  await fs.writeFile(storagePath, buffer);
  return {
    storagePath,
    fileName: originalName,
    fileSize: buffer.length,
    mimeType,
  };
}

export async function readFile(storagePath: string): Promise<Buffer> {
  if (storagePath.startsWith(SB_PREFIX)) {
    const sb = getSupabase();
    if (!sb) throw new Error('Supabase storage is not configured');
    const { data, error } = await sb.storage
      .from(BUCKET)
      .download(storagePath.slice(SB_PREFIX.length));
    if (error || !data) {
      throw new Error(`Failed to download file from storage: ${error?.message ?? 'no data'}`);
    }
    return Buffer.from(await data.arrayBuffer());
  }
  return fs.readFile(storagePath);
}

export async function deleteFile(storagePath: string): Promise<void> {
  if (storagePath.startsWith(SB_PREFIX)) {
    const sb = getSupabase();
    if (!sb) return;
    await sb.storage.from(BUCKET).remove([storagePath.slice(SB_PREFIX.length)]);
    return;
  }
  try {
    await fs.unlink(storagePath);
  } catch {
    // file may already be gone
  }
}
