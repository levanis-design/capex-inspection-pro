import { isCurrentlyOnline } from '@/lib/connectivity';
import { checkThisDeviceRevoked } from '@/lib/device-registration';
import { INSPECTION_PHOTOS_BUCKET } from '@/lib/inspection-photos';
import { logger } from '@/lib/logger';
import {
  clearItemConflictKeepLocal,
  clearLocationConflictKeepLocal,
  getAllLocalInspectionHeadersForSync,
  getDirtyItemsForInspection,
  getDirtyLocations,
  getPendingPhotosForInspection,
  LocalItem,
  LocalLocation,
  LocalPhoto,
  markItemConflict,
  markItemSynced,
  markLocationConflict,
  markLocationSynced,
  markPhotoUploaded,
  overwriteItemFromServer,
  overwriteLocationFromServer,
  recordItemSyncFailure,
  recordLocationSyncFailure,
  recordPhotoSyncFailure,
} from '@/lib/offline-db';
import { readLocalPhotoBytes } from '@/lib/offline-photos';
import { supabase } from '@/lib/supabase';

/**
 * The Phase 5C sync engine: drains everything the local SQLite mirror
 * (offline-db.ts) has recorded as not-yet-synced for one inspection --
 * dirty locations, dirty items, pending photos -- once the device is
 * back online. Per PRODUCT_SPEC.md section 9 this must be idempotent
 * (a retried/duplicated sync of the same offline change can never create
 * a duplicate) and must flag a genuine conflict rather than silently
 * overwrite in either direction.
 *
 * Idempotency: locations/items are pushed as plain `UPDATE ... WHERE
 * id = ...` -- naturally idempotent, since re-running the same update
 * again just sets the same values again. Photos have two separate write
 * steps that both have to be retry-safe on their own, since either one
 * can be the one a retry lands on: the Storage upload uses
 * `{ upsert: true }` against a deterministic path keyed on the UUID
 * generated once at capture time (offline-photos.ts) -- a retried upload
 * of the exact same bytes to the exact same path is a genuine no-op
 * rather than Storage's default "the resource already exists" rejection
 * on a second plain `.upload()`. The `photos` table row then goes through
 * `.upsert(..., { onConflict: 'client_uuid', ignoreDuplicates: true })`,
 * same key -- a retried insert after this function itself gets
 * interrupted mid-run can never create a second `photos` row for the
 * same capture. See migration 0016 for the `photos.client_uuid` unique
 * index this depends on.
 *
 * Conflict detection: every dirty location/item's local copy remembers
 * `serverUpdatedAt`, the server's `updated_at` as of the last successful
 * pull or push. Before pushing a local edit, this re-reads the server's
 * *current* `updated_at` (bumped unconditionally by migration 0016's
 * `set_updated_at()` trigger on every update, so it can't be spoofed by
 * any client). If that current value is newer than what we last saw, the
 * row was edited elsewhere while we were offline too -- a genuine
 * conflict, not just an ordinary clean push -- and the local edit is left
 * dirty and flagged `conflict` (see `markLocationConflict`/
 * `markItemConflict` in offline-db.ts) rather than pushed, so a conflict
 * is never silently lost in either direction. Detection and resolution
 * are deliberately separate: this section only ever flags one; the
 * "Conflict resolution" section further down (`resolveLocationConflict`/
 * `resolveItemConflict`, used by `[id]/conflicts.tsx`) is what actually
 * lets a person pick a side.
 *
 * This module intentionally does NOT touch the `sync_queue` table that's
 * been sitting unused in the schema since offline-db.ts's first version
 * -- the per-row `dirty`/`conflict` flags that emerged as the actual
 * dirty-tracking mechanism turned out to be sufficient on their own, and
 * simpler than maintaining a parallel queue table in sync with them.
 */

export type SyncSummary = {
  /** False only when the sync was skipped outright because the device is offline. */
  attempted: boolean;
  /**
   * Phase 17 addition: true when the sync was skipped because this
   * device has been revoked by an org admin (checkThisDeviceRevoked()),
   * rather than because it's offline -- callers should distinguish the
   * two (see sync-status.tsx) and sign the user out rather than just
   * suggesting "try again once you're back online."
   */
  deviceRevoked: boolean;
  syncedLocations: number;
  syncedItems: number;
  syncedPhotos: number;
  conflicts: number;
  errors: number;
};

function emptySummary(attempted: boolean, deviceRevoked = false): SyncSummary {
  return {
    attempted,
    deviceRevoked,
    syncedLocations: 0,
    syncedItems: 0,
    syncedPhotos: 0,
    conflicts: 0,
    errors: 0,
  };
}

async function pushDirtyLocation(
  location: LocalLocation,
): Promise<'synced' | 'conflict' | 'error'> {
  const { data: serverRow, error: fetchError } = await supabase
    .from('inspection_snapshot_locations')
    .select('updated_at')
    .eq('id', location.id)
    .maybeSingle();

  if (fetchError) {
    logger.error('offline-sync', 'Failed to read server location before push', fetchError, {
      locationId: location.id,
    });
    await recordLocationSyncFailure(location.id, fetchError.message);
    return 'error';
  }
  if (!serverRow) {
    // The row is gone server-side (inspection voided/deleted since we
    // last saw it) -- not a content conflict, just nothing left to push
    // to. Left dirty; there's nothing more productive to do with it here.
    // This is also the one case where the sync engine will never make
    // forward progress on its own no matter how many times it retries --
    // the Sync Status screen surfaces the message below so a person can
    // at least understand why it's permanently stuck.
    logger.error('offline-sync', 'Server location no longer exists, skipping push', undefined, {
      locationId: location.id,
    });
    await recordLocationSyncFailure(
      location.id,
      'The corresponding record no longer exists on the server (the inspection may have been voided or deleted).',
    );
    return 'error';
  }

  if (
    location.serverUpdatedAt &&
    new Date(serverRow.updated_at).getTime() > new Date(location.serverUpdatedAt).getTime()
  ) {
    await markLocationConflict(location.id);
    return 'conflict';
  }

  // Always the full current local state for every editable column, not a
  // delta -- the sync engine doesn't track which specific field changed,
  // only that the row is dirty, so it pushes what the local mirror
  // currently believes is true end to end.
  const { data: updated, error: updateError } = await supabase
    .from('inspection_snapshot_locations')
    .update({
      status: location.status,
      status_reason: location.statusReason,
      started_at: location.startedAt,
      completed_at: location.completedAt,
    })
    .eq('id', location.id)
    .select('updated_at')
    .single();

  if (updateError || !updated) {
    logger.error('offline-sync', 'Failed to push location', updateError, {
      locationId: location.id,
    });
    await recordLocationSyncFailure(
      location.id,
      updateError?.message ?? 'Unknown error updating the server record.',
    );
    return 'error';
  }

  await markLocationSynced(location.id, updated.updated_at);
  return 'synced';
}

async function pushDirtyItem(item: LocalItem): Promise<'synced' | 'conflict' | 'error'> {
  const { data: serverRow, error: fetchError } = await supabase
    .from('inspection_snapshot_items')
    .select('updated_at')
    .eq('id', item.id)
    .maybeSingle();

  if (fetchError) {
    logger.error('offline-sync', 'Failed to read server item before push', fetchError, {
      itemId: item.id,
    });
    await recordItemSyncFailure(item.id, fetchError.message);
    return 'error';
  }
  if (!serverRow) {
    logger.error('offline-sync', 'Server item no longer exists, skipping push', undefined, {
      itemId: item.id,
    });
    await recordItemSyncFailure(
      item.id,
      'The corresponding record no longer exists on the server (the inspection may have been voided or deleted).',
    );
    return 'error';
  }

  if (
    item.serverUpdatedAt &&
    new Date(serverRow.updated_at).getTime() > new Date(item.serverUpdatedAt).getTime()
  ) {
    await markItemConflict(item.id);
    return 'conflict';
  }

  const { data: updated, error: updateError } = await supabase
    .from('inspection_snapshot_items')
    .update({
      status: item.status,
      observation: item.observation,
      inspected_at: item.inspectedAt,
    })
    .eq('id', item.id)
    .select('updated_at')
    .single();

  if (updateError || !updated) {
    logger.error('offline-sync', 'Failed to push item', updateError, { itemId: item.id });
    await recordItemSyncFailure(
      item.id,
      updateError?.message ?? 'Unknown error updating the server record.',
    );
    return 'error';
  }

  await markItemSynced(item.id, updated.updated_at);
  return 'synced';
}

async function pushPendingPhoto(
  photo: LocalPhoto,
  organizationId: string,
): Promise<'synced' | 'error' | 'skipped'> {
  if (!photo.clientUuid) {
    // Shouldn't happen for anything captured going forward, but a photo
    // taken by an earlier build (before client_uuid existed) could still
    // be sitting here -- there's no idempotent key to upload it safely
    // with, so it's skipped rather than risking a duplicate `photos` row.
    logger.error(
      'offline-sync',
      'Pending photo has no client_uuid, skipping (captured by an older build)',
      undefined,
      { photoId: photo.id },
    );
    // Recorded even though this returns 'skipped' rather than 'error' --
    // this photo will never sync on its own (there's no safe idempotent
    // key to upload it with), so it needs to show up in the Sync Status
    // screen as something to discard and recapture, not just silently
    // sit there forever with no explanation.
    await recordPhotoSyncFailure(
      photo.id,
      'This photo was captured by an older version of the app and cannot be uploaded automatically. Discard and recapture it.',
    );
    return 'skipped';
  }

  const plainBytes = await readLocalPhotoBytes(photo);
  if (!plainBytes) {
    logger.error('offline-sync', 'Could not read/decrypt pending photo', undefined, {
      photoId: photo.id,
    });
    await recordPhotoSyncFailure(
      photo.id,
      'Could not read the photo file from local storage — it may be missing or corrupted.',
    );
    return 'error';
  }

  const storagePath = `${organizationId}/${photo.itemId}/${photo.clientUuid}.jpg`;
  // `upsert: true` is what actually makes this retry-safe: the path is
  // deterministic (keyed on `clientUuid`, generated once at capture time),
  // so a retried sync run always re-uploads the exact same bytes to the
  // exact same path. Without `upsert`, Supabase Storage's plain `.upload()`
  // rejects a second write to a path that already exists with
  // "The resource already exists" -- which is exactly what happened here:
  // an earlier sync run got the file into Storage but was interrupted
  // before the `photos` upsert/`markPhotoUploaded` below ran, so the row
  // stayed `uploaded = 0` and every later retry hit that same rejection
  // forever, never able to make forward progress. `upsert: true` makes a
  // retry to identical content a genuine no-op instead of a permanent error.
  const { error: uploadError } = await supabase.storage
    .from(INSPECTION_PHOTOS_BUCKET)
    .upload(storagePath, plainBytes, { contentType: 'image/jpeg', upsert: true });

  if (uploadError) {
    logger.error('offline-sync', 'Failed to upload pending photo', uploadError, {
      photoId: photo.id,
    });
    await recordPhotoSyncFailure(photo.id, uploadError.message);
    return 'error';
  }

  const { data: userData } = await supabase.auth.getUser();
  // upsert + ignoreDuplicates: if a previous sync run uploaded the file
  // and got interrupted before recording the `photos` row (or before
  // this run learned it succeeded), this just no-ops instead of creating
  // a second row for the same capture -- see migration 0016.
  const { error: insertError } = await supabase.from('photos').upsert(
    {
      organization_id: organizationId,
      inspection_snapshot_item_id: photo.itemId,
      storage_path: storagePath,
      client_uuid: photo.clientUuid,
      designation: photo.designation,
      caption: photo.caption,
      taken_at: photo.takenAt,
      taken_by: userData.user?.id ?? null,
    },
    { onConflict: 'client_uuid', ignoreDuplicates: true },
  );

  if (insertError) {
    logger.error('offline-sync', 'Failed to record synced photo', insertError, {
      photoId: photo.id,
    });
    await recordPhotoSyncFailure(photo.id, insertError.message);
    return 'error';
  }

  await markPhotoUploaded(photo.id, storagePath);
  return 'synced';
}

/**
 * Drains every dirty location/item and pending photo for one inspection.
 * A no-op (returns `attempted: false`) if the device is currently
 * offline -- callers are expected to call this opportunistically
 * (on load while online, and again whenever connectivity comes back;
 * see [id]/index.tsx) rather than block anything on it.
 */
export async function syncInspection(
  inspectionId: string,
  organizationId: string,
): Promise<SyncSummary> {
  if (!(await isCurrentlyOnline())) return emptySummary(false);
  // Phase 17: checked on every sync attempt, not just the periodic
  // foreground poll in (app)/_layout.tsx -- this is the belt-and-braces
  // check that catches a revoked device the moment it tries to actually
  // push something, even if the poll hasn't run yet (e.g. right after
  // app launch).
  if (await checkThisDeviceRevoked()) return emptySummary(false, true);

  const summary = emptySummary(true);

  const dirtyLocations = await getDirtyLocations(inspectionId);
  for (const location of dirtyLocations) {
    const result = await pushDirtyLocation(location);
    if (result === 'synced') summary.syncedLocations += 1;
    else if (result === 'conflict') summary.conflicts += 1;
    else summary.errors += 1;
  }

  const dirtyItems = await getDirtyItemsForInspection(inspectionId);
  for (const item of dirtyItems) {
    const result = await pushDirtyItem(item);
    if (result === 'synced') summary.syncedItems += 1;
    else if (result === 'conflict') summary.conflicts += 1;
    else summary.errors += 1;
  }

  const pendingPhotos = await getPendingPhotosForInspection(inspectionId);
  for (const photo of pendingPhotos) {
    const result = await pushPendingPhoto(photo, organizationId);
    if (result === 'synced') summary.syncedPhotos += 1;
    else if (result === 'error') summary.errors += 1;
    // 'skipped' isn't counted as an error -- see pushPendingPhoto's comment.
  }

  return summary;
}

/**
 * Drains every locally-mirrored inspection on this device, one after
 * another, rather than just the one currently open in the walkthrough
 * screen -- what powers the app-wide "Offline, N changes pending" strip
 * (see (app)/_layout.tsx), which has no single inspection in scope. A
 * no-op (returns `attempted: false`) if the device is currently offline,
 * same as `syncInspection`; otherwise aggregates every inspection's
 * `SyncSummary` into one.
 */
export async function syncAllInspections(): Promise<SyncSummary> {
  if (!(await isCurrentlyOnline())) return emptySummary(false);
  // Same Phase 17 check as syncInspection(), checked once up front here
  // rather than relying solely on syncInspection()'s own per-call check --
  // avoids one redundant network round trip per locally-mirrored
  // inspection when this device has already been revoked.
  if (await checkThisDeviceRevoked()) return emptySummary(false, true);

  const headers = await getAllLocalInspectionHeadersForSync();
  const total = emptySummary(true);

  for (const header of headers) {
    const summary = await syncInspection(header.id, header.organizationId);
    if (summary.deviceRevoked) return emptySummary(false, true);
    total.syncedLocations += summary.syncedLocations;
    total.syncedItems += summary.syncedItems;
    total.syncedPhotos += summary.syncedPhotos;
    total.conflicts += summary.conflicts;
    total.errors += summary.errors;
  }

  return total;
}

// ---------------------------------------------------------------------
// Conflict resolution
// ---------------------------------------------------------------------
//
// Everything above this line only ever *detects* a conflict and leaves it
// flagged -- nothing in `syncInspection`/`syncAllInspections` resolves
// one. This section is what the resolution screen ([id]/conflicts.tsx)
// actually calls: it reads the server's current content for one flagged
// row (a plain read, not part of the push path above) and either
// discards the local edit in favor of it, or clears the flag so the
// local edit gets pushed normally on the next sync pass.

export type ServerLocationSnapshot = {
  status: string;
  statusReason: string | null;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

export type ServerItemSnapshot = {
  status: string;
  observation: string | null;
  inspectedAt: string | null;
  updatedAt: string;
};

/**
 * Reads a location's *current* server content for the resolution screen
 * to show side by side with the local copy. Returns null on a network
 * error or if the row is gone server-side (same case `pushDirtyLocation`
 * already treats as nothing left to push to).
 */
export async function fetchServerLocationSnapshot(
  locationId: string,
): Promise<ServerLocationSnapshot | null> {
  const { data, error } = await supabase
    .from('inspection_snapshot_locations')
    .select('status, status_reason, started_at, completed_at, updated_at')
    .eq('id', locationId)
    .maybeSingle();

  if (error || !data) {
    if (error) {
      logger.error('offline-sync', 'Failed to read server location snapshot', error, {
        locationId,
      });
    }
    return null;
  }
  return {
    status: data.status,
    statusReason: data.status_reason,
    startedAt: data.started_at,
    completedAt: data.completed_at,
    updatedAt: data.updated_at,
  };
}

/** Same idea as `fetchServerLocationSnapshot` -- see its comment. */
export async function fetchServerItemSnapshot(itemId: string): Promise<ServerItemSnapshot | null> {
  const { data, error } = await supabase
    .from('inspection_snapshot_items')
    .select('status, observation, inspected_at, updated_at')
    .eq('id', itemId)
    .maybeSingle();

  if (error || !data) {
    if (error) {
      logger.error('offline-sync', 'Failed to read server item snapshot', error, { itemId });
    }
    return null;
  }
  return {
    status: data.status,
    observation: data.observation,
    inspectedAt: data.inspected_at,
    updatedAt: data.updated_at,
  };
}

export type ConflictResolution = 'keep_local' | 'keep_server';

/**
 * Resolves one flagged location conflict. `keep_server` overwrites the
 * local mirror with the server's current content and clears both
 * `dirty`/`conflict` -- the local edit that caused the conflict is
 * discarded. `keep_local` leaves the local edit itself untouched (still
 * `dirty = 1`) and only refreshes `server_updated_at`/clears `conflict`,
 * so the *next* ordinary `syncInspection()` push sends it as a clean
 * update instead of re-detecting the same conflict. Returns false if the
 * server row couldn't be read (network error, or the row is gone
 * server-side) -- the conflict is left exactly as it was, for a retry.
 */
export async function resolveLocationConflict(
  locationId: string,
  resolution: ConflictResolution,
): Promise<boolean> {
  const snapshot = await fetchServerLocationSnapshot(locationId);
  if (!snapshot) return false;

  if (resolution === 'keep_server') {
    await overwriteLocationFromServer(locationId, {
      status: snapshot.status,
      statusReason: snapshot.statusReason,
      startedAt: snapshot.startedAt,
      completedAt: snapshot.completedAt,
      serverUpdatedAt: snapshot.updatedAt,
    });
  } else {
    await clearLocationConflictKeepLocal(locationId, snapshot.updatedAt);
  }
  return true;
}

/** Same idea as `resolveLocationConflict` -- see its comment. */
export async function resolveItemConflict(
  itemId: string,
  resolution: ConflictResolution,
): Promise<boolean> {
  const snapshot = await fetchServerItemSnapshot(itemId);
  if (!snapshot) return false;

  if (resolution === 'keep_server') {
    await overwriteItemFromServer(itemId, {
      status: snapshot.status,
      observation: snapshot.observation,
      inspectedAt: snapshot.inspectedAt,
      serverUpdatedAt: snapshot.updatedAt,
    });
  } else {
    await clearItemConflictKeepLocal(itemId, snapshot.updatedAt);
  }
  return true;
}
