// Person 2: private photo storage. Photos are re-encoded by sharp, which drops all metadata (EXIF incl. GPS).
import 'server-only';
import sharp from 'sharp';
import { supabaseAdmin } from '@/lib/supabase/server';
import { blurThumbnail } from '@/lib/db';

const BUCKET = 'photos';

export class BadImageError extends Error {}

async function toJpeg(file: File, maxEdge: number, quality?: number): Promise<Buffer> {
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    return await sharp(buf)
      .rotate()
      .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality })
      .toBuffer();
  } catch {
    throw new BadImageError(`Could not read image ${file.name || ''}`.trim());
  }
}

export async function savePhotos(
  itemId: string,
  files: File[],
): Promise<{ photo_paths: string[]; blurred_thumb_path: string }> {
  if (!files.length) throw new BadImageError('No photos');
  // Decode everything before any upload, so a bad file leaves nothing behind.
  const jpegs = await Promise.all(files.map((f) => toJpeg(f, 2000, 82)));
  let thumb: Buffer;
  try {
    thumb = await blurThumbnail(jpegs[0]);
  } catch {
    throw new BadImageError('Could not make thumbnail');
  }

  const photo_paths = jpegs.map((_, i) => `found/${itemId}/${i + 1}.jpg`);
  const blurred_thumb_path = `found/${itemId}/thumb.jpg`;
  const uploads: [string, Buffer][] = [...photo_paths.map((p, i) => [p, jpegs[i]] as [string, Buffer]), [blurred_thumb_path, thumb]];

  const bucket = supabaseAdmin().storage.from(BUCKET);
  const done: string[] = [];
  for (const [path, body] of uploads) {
    const { error } = await bucket.upload(path, body, { contentType: 'image/jpeg', upsert: false });
    if (error) {
      await deletePhotos(done);
      throw new Error(`Photo upload failed: ${error.message}`);
    }
    done.push(path);
  }
  return { photo_paths, blurred_thumb_path };
}

export async function deletePhotos(paths: string[]): Promise<void> {
  if (!paths.length) return;
  try {
    await supabaseAdmin().storage.from(BUCKET).remove(paths);
  } catch {
    // best effort: orphaned files are harmless in a private bucket
  }
}

export async function signedUrl(path: string, seconds: number): Promise<string> {
  try {
    const { data, error } = await supabaseAdmin().storage.from(BUCKET).createSignedUrl(path, seconds);
    return error || !data ? '' : data.signedUrl;
  } catch {
    return '';
  }
}

export async function forClaude(file: File): Promise<{ base64: string; mediaType: 'image/jpeg' }> {
  const buf = await toJpeg(file, 1568);
  return { base64: buf.toString('base64'), mediaType: 'image/jpeg' };
}
