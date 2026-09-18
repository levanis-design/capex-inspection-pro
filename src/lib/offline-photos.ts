import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';

import { isCurrentlyOnline } from '@/lib/connectivity';
import { INSPECTION_PHOTOS_BUCKET } from '@/lib/inspection-photos';
import { decryptBytesFromStorage, encryptBytesForStorage } from '@/lib/local-crypto';
import { logger } from '@/lib/logger';
import { insertLocalPhoto, LocalPhoto, markPhotoUploaded } from '@/lib/offline-db';
import { supabase } from '@/lib/supabase';

/**
 * Offline photo capture, per PRODUCT_SPEC.md section 9 ("Local SQLite
 * mirrors ... any offline-created photos"). The camera capture itself
 * doesn't touch the network at all -- an encrypted copy is written to
 * this device's persistent storage and indexed in the local mirror
 * (offline-db.ts's `local_photos` table) immediately, which always
 * succeeds regardless of connectivity. Only *afterward*, and only if
 * currently online, is the real upload to Supabase Storage + the
 * `photos` table attempted -- best-effort, same "local-write-first,
 * network-best-effort" pattern as the rest of Phase 5C
 * ([id]/index.tsx's write handlers). A photo captured offline, or whose
 * immediate upload attempt fails, is simply left `uploaded = 0` for the
 * sync engine (offline-sync.ts) to drain later -- that's not a capture
 * failure, it's the expected offline path.
 *
 * The persistent copy is stored *encrypted* (via local-crypto.ts's
 * `encryptBytesForStorage`, the same tweetnacl secretbox scheme used for
 * free-text fields) because, unlike the app's Supabase Storage bucket
 * (private, RLS-gated), the plain app sandbox directory on the device
 * itself has no comparable access control -- see PRODUCT_SPEC.md's Open
 * Decisions Log (2026-09-07) for the full rationale on what's encrypted
 * and why.
 */

const OFFLINE_PHOTOS_DIR = 'offline-photos';
const DISPLAY_CACHE_DIR = 'offline-photos-display';

function randomLocalId(): string {
  // Same style as the id this project has always minted client-side for
  // storage filenames (see the now-removed captureAndUploadPhoto). This
  // is purely a local SQLite primary key/filename -- it's `clientUuid`
  // below (a real RFC4122 UUID, via expo-crypto) that actually has to be
  // a `uuid`-typed column server-side, so it's the one generated with
  // Crypto.randomUUID() instead.
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function offlinePhotosDirectory(): Directory {
  const dir = new Directory(Paths.document, OFFLINE_PHOTOS_DIR);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function displayCacheDirectory(): Directory {
  const dir = new Directory(Paths.cache, DISPLAY_CACHE_DIR);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/**
 * Opens the camera, saves an encrypted copy locally, records it in the
 * local mirror, and -- only if currently online -- also attempts the
 * real upload right away so an online inspector still sees it land in
 * Supabase without waiting on a separate sync step.
 *
 * Never throws on a denied permission or a cancelled capture -- both are
 * normal outcomes (see TEST_PLAN.md's "Android permission denial does
 * not crash the app"). A network/upload failure is likewise never
 * surfaced as an error here -- the local save already succeeded, which
 * is what "the photo was taken" means now.
 */
export async function capturePhotoOffline(
  organizationId: string,
  itemId: string,
): Promise<{ error: string | null; canceled: boolean; localId: string | null }> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    return {
      error: 'Camera access is needed to take a photo. You can enable it in your device settings.',
      canceled: false,
      localId: null,
    };
  }

  const result = await ImagePicker.launchCameraAsync({ quality: 0.6, allowsEditing: false });
  if (result.canceled || !result.assets || result.assets.length === 0) {
    return { error: null, canceled: true, localId: null };
  }

  try {
    const asset = result.assets[0];
    // Read via fetch()/arrayBuffer(), not the new File API, for this one
    // read: `asset.uri` comes from expo-image-picker, not from a uri this
    // app created itself, and fetch is the documented-safe way to read an
    // arbitrary picker result on SDK 57. The File API below is only ever
    // used against `file://` uris this module creates itself under
    // Paths.document/Paths.cache, which is its fully-supported case.
    const response = await fetch(asset.uri);
    const plainBytes = new Uint8Array(await response.arrayBuffer());

    const localId = randomLocalId();
    // A real RFC4122 UUID, distinct from `localId` above -- this is the
    // idempotent sync key `photos.client_uuid` (migration 0016) checks,
    // so a retried upload (immediately below, or later via the sync
    // engine) can never create a duplicate `photos` row. `Crypto.randomUUID()`
    // is a genuine native-backed export of the installed expo-crypto
    // version (verified from its own type declarations), not assumed.
    const clientUuid = Crypto.randomUUID();
    const encryptedBytes = await encryptBytesForStorage(plainBytes);
    const localFile = new File(offlinePhotosDirectory(), `${localId}.enc`);
    localFile.create();
    localFile.write(encryptedBytes);

    const takenAt = new Date().toISOString();
    await insertLocalPhoto({
      id: localId,
      itemId,
      localFileUri: localFile.uri,
      designation: 'general',
      caption: null,
      takenAt,
      clientUuid,
    });

    if (await isCurrentlyOnline()) {
      const storagePath = `${organizationId}/${itemId}/${clientUuid}.jpg`;

      // `upsert: true` -- same reasoning as offline-sync.ts's
      // `pushPendingPhoto`: the path is deterministic (keyed on
      // `clientUuid`), so if this exact upload already landed once (e.g.
      // a slow response that looked like a failure and this got retried,
      // or the sync engine picks up this same row later because
      // `markPhotoUploaded` below never ran) re-uploading identical bytes
      // to the identical path must be a no-op, not Storage's default
      // "the resource already exists" rejection on a second plain
      // `.upload()` -- which would otherwise wedge this photo permanently.
      const { error: uploadError } = await supabase.storage
        .from(INSPECTION_PHOTOS_BUCKET)
        .upload(storagePath, plainBytes, { contentType: 'image/jpeg', upsert: true });

      if (uploadError) {
        logger.error('offline-photos', 'Failed to sync photo upload', uploadError);
        // Left uploaded = 0 -- the sync engine drains this later. Not an
        // error surfaced to the inspector: the local save already
        // succeeded.
      } else {
        const { data: userData } = await supabase.auth.getUser();
        // upsert + ignoreDuplicates rather than insert: if this same
        // capture's upload succeeded once already (e.g. a slow response
        // that looked like a failure and got retried), the duplicate
        // insert this would otherwise be is silently ignored instead of
        // creating a second row -- see migration 0016's unique index on
        // `client_uuid`.
        const { error: insertError } = await supabase.from('photos').upsert(
          {
            organization_id: organizationId,
            inspection_snapshot_item_id: itemId,
            storage_path: storagePath,
            client_uuid: clientUuid,
            taken_by: userData.user?.id ?? null,
          },
          { onConflict: 'client_uuid', ignoreDuplicates: true },
        );

        if (insertError) {
          logger.error('offline-photos', 'Failed to record synced photo', insertError);
        } else {
          markPhotoUploaded(localId, storagePath).catch((syncError) =>
            logger.error('offline-photos', 'Failed to mark photo uploaded locally', syncError),
          );
        }
      }
    }

    return { error: null, canceled: false, localId };
  } catch (err) {
    logger.error('offline-photos', 'Unexpected error capturing photo', err);
    return {
      error: 'Something went wrong capturing the photo. Please try again.',
      canceled: false,
      localId: null,
    };
  }
}

/**
 * Decrypts a locally-stored photo's encrypted file back into plaintext
 * bytes. Shared by `resolveLocalPhotoDisplayUri` below (for showing a
 * thumbnail) and offline-sync.ts (for uploading a pending photo) -- both
 * need the same encrypted-file-on-disk -> plaintext-bytes step, just for
 * different destinations. Returns null (logging) if the encrypted
 * original is missing or fails to decrypt.
 */
export async function readLocalPhotoBytes(
  photo: Pick<LocalPhoto, 'localFileUri'>,
): Promise<Uint8Array | null> {
  try {
    const encryptedFile = new File(photo.localFileUri);
    if (!encryptedFile.exists) return null;
    const encryptedBytes = encryptedFile.bytesSync();
    return await decryptBytesFromStorage(encryptedBytes);
  } catch (err) {
    logger.error('offline-photos', 'Failed to decrypt photo bytes', err);
    return null;
  }
}

/**
 * Decrypts a locally-stored photo into a throwaway cache file and
 * returns its `file://` uri so <Image> can display it, without ever
 * holding decrypted photo bytes on disk longer than necessary -- the
 * cache copy lives under Paths.cache, which the OS is free to reclaim
 * under storage pressure, and gets regenerated from the encrypted
 * original (Paths.document) the next time this is called. Returns null
 * if there's nothing to show -- the caller shows a placeholder rather
 * than a broken image.
 */
export async function resolveLocalPhotoDisplayUri(
  photo: Pick<LocalPhoto, 'id' | 'localFileUri'>,
): Promise<string | null> {
  const displayFile = new File(displayCacheDirectory(), `${photo.id}.jpg`);
  if (displayFile.exists) return displayFile.uri;

  const plainBytes = await readLocalPhotoBytes(photo);
  if (!plainBytes) return null;

  try {
    displayFile.create();
    displayFile.write(plainBytes);
    return displayFile.uri;
  } catch (err) {
    logger.error('offline-photos', 'Failed to write photo display cache', err);
    return null;
  }
}
