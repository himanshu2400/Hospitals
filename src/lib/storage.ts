import { supabase } from './supabase';

/**
 * Upload an image file to a Supabase Storage bucket and return the
 * public URL. Throws on error.
 *
 * @param bucket - 'logos' or 'photos'
 * @param file - the File to upload
 * @param pathPrefix - e.g. the clinic id or doctor id
 * @returns the public URL of the uploaded file
 */
export async function uploadImage(
  bucket: 'logos' | 'photos',
  file: File,
  pathPrefix: string,
): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
  const path = `${pathPrefix}/${Date.now()}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from(bucket)
    .upload(path, file, { upsert: true, contentType: file.type });
  if (upErr) throw upErr;

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}
