import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

/**
 * `storagePath`/`signedUrl` are set for a photo the network knows about
 * (uploaded, in the `photos` table); `localUri` is set for a photo this
 * device captured that isn't uploaded yet, or was captured while offline
 * -- see offline-photos.ts. A photo can have either or, briefly, both
 * (immediately after an online capture, before the post-upload refresh
 * replaces the local entry with the network one).
 */
export type ItemPhoto = {
  id: string;
  storagePath: string | null;
  signedUrl: string | null;
  localUri?: string;
};

// Exported so offline-photos.ts (the actual capture path, as of Phase 5C)
// uploads to the same bucket/path convention this module reads from.
export const INSPECTION_PHOTOS_BUCKET = 'inspection-photos';
const BUCKET = INSPECTION_PHOTOS_BUCKET;
const SIGNED_URL_TTL_SECONDS = 3600;

/**
 * Loads every photo attached to any of the given inspection_snapshot_item
 * ids, plus a short-lived signed URL for each (the bucket is private --
 * see supabase/migrations/0014 -- so there's no public URL to fall back
 * to). Grouped by item id so the walkthrough screen can just index in.
 */
export async function fetchPhotosForItems(
  itemIds: string[],
): Promise<{ photosByItem: Record<string, ItemPhoto[]>; error: string | null }> {
  if (itemIds.length === 0) return { photosByItem: {}, error: null };

  const { data, error } = await supabase
    .from('photos')
    .select('id, inspection_snapshot_item_id, storage_path')
    .in('inspection_snapshot_item_id', itemIds);

  if (error) {
    logger.error('inspection-photos', 'Failed to load photos', error);
    return { photosByItem: {}, error: 'Could not load photos.' };
  }

  const rows = (data ?? []) as {
    id: string;
    inspection_snapshot_item_id: string;
    storage_path: string;
  }[];

  const signedUrlByPath: Record<string, string> = {};
  if (rows.length > 0) {
    const { data: signedData, error: signedError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls(
        rows.map((r) => r.storage_path),
        SIGNED_URL_TTL_SECONDS,
      );
    if (signedError) {
      logger.error('inspection-photos', 'Failed to create signed URLs', signedError);
    } else {
      for (const entry of signedData ?? []) {
        if (entry.path && entry.signedUrl) signedUrlByPath[entry.path] = entry.signedUrl;
      }
    }
  }

  const photosByItem: Record<string, ItemPhoto[]> = {};
  for (const row of rows) {
    const list = photosByItem[row.inspection_snapshot_item_id] ?? [];
    list.push({
      id: row.id,
      storagePath: row.storage_path,
      signedUrl: signedUrlByPath[row.storage_path] ?? null,
    });
    photosByItem[row.inspection_snapshot_item_id] = list;
  }
  return { photosByItem, error: null };
}

// Capture itself moved to offline-photos.ts's `capturePhotoOffline()` as of
// Phase 5C -- it needs to write an encrypted local copy before/instead of
// uploading, which belongs next to the rest of the local-mirror logic, not
// here. This module stays the network-read side (`fetchPhotosForItems`)
// plus the shared `INSPECTION_PHOTOS_BUCKET` constant.
