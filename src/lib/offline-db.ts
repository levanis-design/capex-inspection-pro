import * as SQLite from 'expo-sqlite';

import { decryptText, encryptText } from '@/lib/local-crypto';
import { logger } from '@/lib/logger';

/**
 * The local SQLite mirror for Phase 5C offline capture, per
 * PRODUCT_SPEC.md section 9: "Local SQLite mirrors the active
 * inspection_snapshot, its inspection_snapshot_locations (with
 * status/reason), and inspection_snapshot_items, plus any offline-created
 * photos, comments, and ad hoc items."
 *
 * Naming convention: every column that holds free-text content (an
 * observation, a status reason) is suffixed `_enc` and stores the output
 * of `encryptText()` from local-crypto.ts, never plaintext -- see that
 * module's header comment for the full rationale on what's encrypted and
 * what isn't. Structural columns (ids, statuses, titles, priorities,
 * timestamps) stay plaintext so the mirror is actually queryable.
 *
 * `dirty` marks a row with local changes not yet pushed to Supabase --
 * that's what the sync engine (offline-sync.ts) drains. `server_updated_at`
 * records the row's server-side `updated_at` as of the last successful
 * pull/push, so the sync engine can tell a genuine conflict (the server
 * row changed *and* we have a local dirty edit) apart from an ordinary
 * clean push -- see offline-sync.ts's header comment for the full
 * conflict-detection scheme. `conflict` marks a dirty row the sync engine
 * found exactly that kind of conflict on; it stays dirty (nothing is ever
 * silently overwritten either direction) but is excluded from further
 * sync attempts until someone resolves it.
 */

const DATABASE_NAME = 'capex-offline.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Adds a column to an already-existing local table if it isn't there yet.
 * `CREATE TABLE IF NOT EXISTS` (below) only helps a table that doesn't
 * exist at all -- it does nothing for a device that already created an
 * earlier version of a table in a previous app install, which is exactly
 * what happened here once (the `conflict` columns and
 * `local_photos.client_uuid` were added after this schema first shipped).
 * `expo-sqlite` has no built-in versioned-migration system, so this is a
 * small hand-rolled equivalent: safe to call unconditionally on every
 * app start, a no-op once the column already exists.
 */
async function ensureColumn(
  db: SQLite.SQLiteDatabase,
  table: string,
  column: string,
  definition: string,
): Promise<void> {
  const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  if (!columns.some((c) => c.name === column)) {
    await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function initSchema(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS local_inspection_headers (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL,
      inspection_type TEXT NOT NULL,
      status TEXT NOT NULL,
      property_name TEXT NOT NULL,
      dirty INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS local_locations (
      id TEXT PRIMARY KEY NOT NULL,
      inspection_id TEXT NOT NULL,
      sequence_order INTEGER NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      status_reason_enc TEXT,
      started_at TEXT,
      completed_at TEXT,
      dirty INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      server_updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS local_locations_inspection_idx
      ON local_locations(inspection_id);

    CREATE TABLE IF NOT EXISTS local_items (
      id TEXT PRIMARY KEY NOT NULL,
      location_id TEXT NOT NULL,
      title TEXT NOT NULL,
      instructions TEXT,
      status TEXT NOT NULL,
      observation_enc TEXT,
      priority TEXT,
      photo_required INTEGER NOT NULL DEFAULT 0,
      inspected_at TEXT,
      is_ad_hoc INTEGER NOT NULL DEFAULT 0,
      dirty INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      server_updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS local_items_location_idx
      ON local_items(location_id);

    CREATE TABLE IF NOT EXISTS local_photos (
      id TEXT PRIMARY KEY NOT NULL,
      item_id TEXT NOT NULL,
      local_file_uri TEXT NOT NULL,
      designation TEXT NOT NULL DEFAULT 'general',
      caption_enc TEXT,
      taken_at TEXT NOT NULL,
      uploaded INTEGER NOT NULL DEFAULT 0,
      storage_path TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS local_photos_item_idx
      ON local_photos(item_id);

    CREATE TABLE IF NOT EXISTS sync_queue (
      id TEXT PRIMARY KEY NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      op TEXT NOT NULL,
      created_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    );
  `);

  // Added for the sync engine (offline-sync.ts): `conflict` flags a
  // dirty row the sync engine found the server had *also* changed since
  // our last known `server_updated_at` -- it's left dirty (never
  // silently overwritten either direction) for a person to resolve,
  // rather than synced. `client_uuid` is the offline idempotent sync key
  // for photos, mirroring `inspection_snapshot_items.client_uuid`
  // (0011) -- generated once at capture time (offline-photos.ts) so a
  // retried upload after a dropped connection can never create a
  // duplicate `photos` row (see migration 0016).
  await ensureColumn(db, 'local_locations', 'conflict', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn(db, 'local_items', 'conflict', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn(db, 'local_photos', 'client_uuid', 'TEXT');

  // Added for the Sync Status screen (settings/sync-status.tsx): a running
  // count of failed push attempts and the most recent error, per row, so
  // a person can actually see *why* something is stuck instead of it just
  // silently retrying forever in the background -- and, for photos,
  // discard it (delete the local capture) if it's never going to make it
  // through on its own (e.g. captured by an older build with no
  // `client_uuid` -- see `pushPendingPhoto`'s `skipped` case). Deliberately
  // separate columns per-row rather than reviving the unused `sync_queue`
  // table above -- same reasoning as `dirty`/`conflict` already being
  // per-row flags instead of a queue.
  await ensureColumn(db, 'local_locations', 'sync_attempts', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn(db, 'local_locations', 'last_sync_error', 'TEXT');
  await ensureColumn(db, 'local_items', 'sync_attempts', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn(db, 'local_items', 'last_sync_error', 'TEXT');
  await ensureColumn(db, 'local_photos', 'sync_attempts', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn(db, 'local_photos', 'last_sync_error', 'TEXT');
}

/** Singleton database handle -- every caller in the app shares one connection. */
export function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DATABASE_NAME).then(async (db) => {
      await initSchema(db);
      return db;
    });
  }
  return dbPromise;
}

// ---------------------------------------------------------------------
// Inspection header (status/property name/type -- not sensitive, no
// encryption needed; this is the small bit of context the walkthrough
// screen needs to render at all when opened with no signal)
// ---------------------------------------------------------------------

export type LocalInspectionHeader = {
  id: string;
  organizationId: string;
  inspectionType: string;
  status: string;
  propertyName: string;
};

type LocalInspectionHeaderRow = {
  id: string;
  organization_id: string;
  inspection_type: string;
  status: string;
  property_name: string;
};

function decodeHeaderRow(row: LocalInspectionHeaderRow): LocalInspectionHeader {
  return {
    id: row.id,
    organizationId: row.organization_id,
    inspectionType: row.inspection_type,
    status: row.status,
    propertyName: row.property_name,
  };
}

/**
 * Mirrors an inspection's header the same "don't clobber a local change"
 * way as `seedLocationIfAbsent` -- except status legitimately does need
 * refreshing from the network on every successful online load (unlike a
 * location/item, the header has no per-field dirty tracking, and its only
 * local mutation today is the scheduled -> in_progress promotion below),
 * so this is a plain upsert rather than INSERT OR IGNORE.
 */
export async function upsertInspectionHeader(header: {
  id: string;
  organizationId: string;
  inspectionType: string;
  status: string;
  propertyName: string;
}): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO local_inspection_headers
       (id, organization_id, inspection_type, status, property_name, dirty, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)
     ON CONFLICT(id) DO UPDATE SET
       organization_id = excluded.organization_id,
       inspection_type = excluded.inspection_type,
       status = excluded.status,
       property_name = excluded.property_name,
       updated_at = excluded.updated_at
     WHERE local_inspection_headers.dirty = 0`,
    [
      header.id,
      header.organizationId,
      header.inspectionType,
      header.status,
      header.propertyName,
      new Date().toISOString(),
    ],
  );
}

export async function getLocalInspectionHeader(
  inspectionId: string,
): Promise<LocalInspectionHeader | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<LocalInspectionHeaderRow>(
    `SELECT * FROM local_inspection_headers WHERE id = ?`,
    [inspectionId],
  );
  return row ? decodeHeaderRow(row) : null;
}

/**
 * Every inspection this device has mirrored locally *for the given
 * organization*, most recently touched first -- what the Inspections list
 * (inspections/index.tsx) falls back to on a cold start with no signal, so
 * a user can still open (and resume) an in-progress inspection they'd
 * already started even before the network call that would normally
 * populate that screen ever succeeds.
 *
 * Phase 23 fix: this used to be a plain `SELECT *` with no
 * `organization_id` filter at all, even though the column has always been
 * on this table -- on a device previously signed in as a different
 * organization's user (shared/reissued device), the offline fallback list
 * could show that other organization's mirrored inspections. `signOut()`
 * (auth-context.tsx) now also clears the whole local mirror on sign-out,
 * but this filter is a second, independent guard against the same leak --
 * e.g. a session that ends without an explicit sign-out (app killed,
 * token expiry) still leaves old rows on disk. Callers that don't yet know
 * the current organization id (see current-organization-cache.ts) should
 * treat that as "show nothing" rather than falling back to unfiltered.
 */
export async function getAllLocalInspectionHeaders(
  organizationId: string,
): Promise<LocalInspectionHeader[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<LocalInspectionHeaderRow>(
    `SELECT * FROM local_inspection_headers WHERE organization_id = ? ORDER BY updated_at DESC`,
    [organizationId],
  );
  return rows.map(decodeHeaderRow);
}

/**
 * Every inspection header mirrored locally, regardless of organization --
 * used only by the sync engine (offline-sync.ts's `syncAllInspections`) to
 * find every dirty row that might need draining, never by any screen.
 *
 * Unlike `getAllLocalInspectionHeaders` above, this is deliberately *not*
 * organization-scoped: attempting to sync a stray row left over from a
 * previous sign-in on this device is still safe even though this function
 * doesn't filter it out, because the actual write it attempts is still
 * subject to Supabase RLS (`organization_id = current_organization_id()`)
 * -- a stray other-org row's push is simply rejected as a sync error, the
 * same as any other permission failure, not a path that leaks or corrupts
 * data. And as of Phase 23, sign-out clears the whole mirror (see
 * resetLocalMirror), so a stray row like this should now only occur on a
 * device that still had unsynced changes at the last sign-out.
 */
export async function getAllLocalInspectionHeadersForSync(): Promise<LocalInspectionHeader[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<LocalInspectionHeaderRow>(
    `SELECT * FROM local_inspection_headers ORDER BY updated_at DESC`,
  );
  return rows.map(decodeHeaderRow);
}

/** Local-only status change (e.g. the scheduled -> in_progress promotion on first open). */
export async function updateInspectionStatusLocal(
  inspectionId: string,
  status: string,
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE local_inspection_headers SET status = ?, dirty = 1, updated_at = ? WHERE id = ?`,
    [status, new Date().toISOString(), inspectionId],
  );
}

// ---------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------

export type LocalLocation = {
  id: string;
  inspectionId: string;
  sequenceOrder: number;
  name: string;
  status: string;
  statusReason: string | null;
  startedAt: string | null;
  completedAt: string | null;
  dirty: boolean;
  conflict: boolean;
  // The server's `updated_at` as of our last successful pull/push -- what
  // offline-sync.ts compares the *current* server `updated_at` against to
  // tell a genuine conflict apart from an ordinary clean push. Null for a
  // location seeded before it was ever synced back (its very first push
  // is never a conflict, since there's nothing to compare against).
  serverUpdatedAt: string | null;
};

type LocalLocationRow = {
  id: string;
  inspection_id: string;
  sequence_order: number;
  name: string;
  status: string;
  status_reason_enc: string | null;
  started_at: string | null;
  completed_at: string | null;
  dirty: number;
  conflict: number;
  server_updated_at: string | null;
};

async function decodeLocationRow(row: LocalLocationRow): Promise<LocalLocation> {
  return {
    id: row.id,
    inspectionId: row.inspection_id,
    sequenceOrder: row.sequence_order,
    name: row.name,
    status: row.status,
    statusReason: row.status_reason_enc ? await decryptText(row.status_reason_enc) : null,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    dirty: row.dirty === 1,
    conflict: row.conflict === 1,
    serverUpdatedAt: row.server_updated_at,
  };
}

/**
 * Mirrors a freshly-fetched snapshot location into the local DB, but only
 * if there's no local copy yet (`INSERT OR IGNORE`) -- a location the
 * inspector already edited offline (dirty = 1) must never be clobbered by
 * a re-fetch of stale server data. Refreshing a location's server-side
 * truth after a successful sync is a separate, explicit operation
 * (`markLocationSynced`), not this one.
 */
export async function seedLocationIfAbsent(location: {
  id: string;
  inspectionId: string;
  sequenceOrder: number;
  name: string;
  status: string;
  statusReason: string | null;
  startedAt: string | null;
  completedAt: string | null;
}): Promise<void> {
  const db = await getDatabase();
  const statusReasonEnc = location.statusReason ? await encryptText(location.statusReason) : null;
  await db.runAsync(
    `INSERT OR IGNORE INTO local_locations
       (id, inspection_id, sequence_order, name, status, status_reason_enc, started_at, completed_at, dirty, updated_at, server_updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [
      location.id,
      location.inspectionId,
      location.sequenceOrder,
      location.name,
      location.status,
      statusReasonEnc,
      location.startedAt,
      location.completedAt,
      new Date().toISOString(),
      new Date().toISOString(),
    ],
  );
}

export async function getLocationsForInspection(inspectionId: string): Promise<LocalLocation[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<LocalLocationRow>(
    `SELECT * FROM local_locations WHERE inspection_id = ? ORDER BY sequence_order`,
    [inspectionId],
  );
  return Promise.all(rows.map(decodeLocationRow));
}

export async function hasLocalMirror(inspectionId: string): Promise<boolean> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM local_locations WHERE inspection_id = ? LIMIT 1`,
    [inspectionId],
  );
  return row !== null;
}

/** Local-only status update (e.g. mark in_progress/complete/skipped/...). Marks the row dirty for sync. */
export async function updateLocationStatusLocal(
  locationId: string,
  patch: { status: string; statusReason?: string | null; startedAt?: string; completedAt?: string },
): Promise<void> {
  const db = await getDatabase();
  const statusReasonEnc =
    patch.statusReason !== undefined && patch.statusReason !== null
      ? await encryptText(patch.statusReason)
      : null;

  const sets: string[] = ['status = ?', 'dirty = 1', 'updated_at = ?'];
  const values: (string | null)[] = [patch.status, new Date().toISOString()];

  if (patch.statusReason !== undefined) {
    sets.push('status_reason_enc = ?');
    values.push(statusReasonEnc);
  }
  if (patch.startedAt !== undefined) {
    sets.push('started_at = ?');
    values.push(patch.startedAt);
  }
  if (patch.completedAt !== undefined) {
    sets.push('completed_at = ?');
    values.push(patch.completedAt);
  }

  await db.runAsync(`UPDATE local_locations SET ${sets.join(', ')} WHERE id = ?`, [
    ...values,
    locationId,
  ]);
}

export async function markLocationSynced(
  locationId: string,
  serverUpdatedAt: string,
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE local_locations
       SET dirty = 0, conflict = 0, server_updated_at = ?, sync_attempts = 0, last_sync_error = NULL
       WHERE id = ?`,
    [serverUpdatedAt, locationId],
  );
}

/**
 * Records a failed push attempt for the Sync Status screen
 * (settings/sync-status.tsx) -- increments the attempt count and
 * remembers the most recent error so a person can see *why* something
 * has been stuck instead of just that it has, without this module having
 * to guess at retry/backoff policy itself (the sync engine still retries
 * on every ordinary `syncInspection()`/`syncAllInspections()` call,
 * exactly as before; this is purely a visibility layer on top of that).
 */
export async function recordLocationSyncFailure(
  locationId: string,
  errorMessage: string,
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE local_locations SET sync_attempts = sync_attempts + 1, last_sync_error = ? WHERE id = ?`,
    [errorMessage, locationId],
  );
}

/**
 * Flags a dirty location the sync engine found the server had *also*
 * changed since our last known `server_updated_at` -- left dirty (so it's
 * never silently discarded) but excluded from `getDirtyLocations` below,
 * so the sync engine doesn't keep re-detecting and re-logging the same
 * conflict on every run. Resolving it (a future step, not built yet) is
 * what would clear the flag.
 */
export async function markLocationConflict(locationId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`UPDATE local_locations SET conflict = 1 WHERE id = ?`, [locationId]);
}

/** Dirty locations still eligible for the sync engine to push -- excludes ones already flagged `conflict`. */
export async function getDirtyLocations(inspectionId: string): Promise<LocalLocation[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<LocalLocationRow>(
    `SELECT * FROM local_locations WHERE inspection_id = ? AND dirty = 1 AND conflict = 0`,
    [inspectionId],
  );
  return Promise.all(rows.map(decodeLocationRow));
}

/** Locations flagged `conflict` for one inspection -- what the resolution UI (conflicts.tsx) lists. */
export async function getConflictedLocationsForInspection(
  inspectionId: string,
): Promise<LocalLocation[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<LocalLocationRow>(
    `SELECT * FROM local_locations WHERE inspection_id = ? AND conflict = 1`,
    [inspectionId],
  );
  return Promise.all(rows.map(decodeLocationRow));
}

/**
 * "Keep the server version" resolution: overwrites the local row with
 * whatever offline-sync.ts just fetched from Supabase, and clears both
 * `dirty` and `conflict` -- there's nothing left to push, the local
 * edit that caused the conflict is discarded in favor of the server's.
 */
export async function overwriteLocationFromServer(
  locationId: string,
  patch: {
    status: string;
    statusReason: string | null;
    startedAt: string | null;
    completedAt: string | null;
    serverUpdatedAt: string;
  },
): Promise<void> {
  const db = await getDatabase();
  const statusReasonEnc = patch.statusReason ? await encryptText(patch.statusReason) : null;
  await db.runAsync(
    `UPDATE local_locations
       SET status = ?, status_reason_enc = ?, started_at = ?, completed_at = ?,
           dirty = 0, conflict = 0, server_updated_at = ?
       WHERE id = ?`,
    [
      patch.status,
      statusReasonEnc,
      patch.startedAt,
      patch.completedAt,
      patch.serverUpdatedAt,
      locationId,
    ],
  );
}

/**
 * "Keep my version" resolution: the local edit itself is untouched (still
 * `dirty = 1`, exactly what the inspector entered) -- only the conflict
 * flag clears and `server_updated_at` is refreshed to the value
 * offline-sync.ts just fetched, so the *next* ordinary sync pass pushes it
 * as a clean update instead of detecting the same conflict again.
 */
export async function clearLocationConflictKeepLocal(
  locationId: string,
  serverUpdatedAt: string,
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`UPDATE local_locations SET conflict = 0, server_updated_at = ? WHERE id = ?`, [
    serverUpdatedAt,
    locationId,
  ]);
}

// ---------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------

export type LocalItem = {
  id: string;
  locationId: string;
  title: string;
  instructions: string | null;
  status: string;
  observation: string | null;
  priority: string | null;
  photoRequired: boolean;
  inspectedAt: string | null;
  isAdHoc: boolean;
  dirty: boolean;
  conflict: boolean;
  // See LocalLocation.serverUpdatedAt above -- same meaning, same role in
  // offline-sync.ts's conflict check.
  serverUpdatedAt: string | null;
};

type LocalItemRow = {
  id: string;
  location_id: string;
  title: string;
  instructions: string | null;
  status: string;
  observation_enc: string | null;
  priority: string | null;
  photo_required: number;
  inspected_at: string | null;
  is_ad_hoc: number;
  dirty: number;
  conflict: number;
  server_updated_at: string | null;
};

async function decodeItemRow(row: LocalItemRow): Promise<LocalItem> {
  return {
    id: row.id,
    locationId: row.location_id,
    title: row.title,
    instructions: row.instructions,
    status: row.status,
    observation: row.observation_enc ? await decryptText(row.observation_enc) : null,
    priority: row.priority,
    photoRequired: row.photo_required === 1,
    inspectedAt: row.inspected_at,
    isAdHoc: row.is_ad_hoc === 1,
    dirty: row.dirty === 1,
    conflict: row.conflict === 1,
    serverUpdatedAt: row.server_updated_at,
  };
}

export async function seedItemIfAbsent(item: {
  id: string;
  locationId: string;
  title: string;
  instructions: string | null;
  status: string;
  observation: string | null;
  priority: string | null;
  photoRequired: boolean;
}): Promise<void> {
  const db = await getDatabase();
  const observationEnc = item.observation ? await encryptText(item.observation) : null;
  await db.runAsync(
    `INSERT OR IGNORE INTO local_items
       (id, location_id, title, instructions, status, observation_enc, priority, photo_required, inspected_at, is_ad_hoc, dirty, updated_at, server_updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, 0, ?, ?)`,
    [
      item.id,
      item.locationId,
      item.title,
      item.instructions,
      item.status,
      observationEnc,
      item.priority,
      item.photoRequired ? 1 : 0,
      new Date().toISOString(),
      new Date().toISOString(),
    ],
  );
}

export async function getItemsForLocation(locationId: string): Promise<LocalItem[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<LocalItemRow>(
    `SELECT * FROM local_items WHERE location_id = ? ORDER BY title`,
    [locationId],
  );
  return Promise.all(rows.map(decodeItemRow));
}

export async function updateItemStatusLocal(itemId: string, status: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE local_items SET status = ?, inspected_at = ?, dirty = 1, updated_at = ? WHERE id = ?`,
    [status, new Date().toISOString(), new Date().toISOString(), itemId],
  );
}

export async function updateItemObservationLocal(
  itemId: string,
  observation: string,
): Promise<void> {
  const db = await getDatabase();
  const observationEnc = await encryptText(observation);
  await db.runAsync(
    `UPDATE local_items SET observation_enc = ?, dirty = 1, updated_at = ? WHERE id = ?`,
    [observationEnc, new Date().toISOString(), itemId],
  );
}

export async function markItemSynced(itemId: string, serverUpdatedAt: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE local_items
       SET dirty = 0, conflict = 0, server_updated_at = ?, sync_attempts = 0, last_sync_error = NULL
       WHERE id = ?`,
    [serverUpdatedAt, itemId],
  );
}

/** Same idea as `recordLocationSyncFailure` -- see its comment. */
export async function recordItemSyncFailure(itemId: string, errorMessage: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE local_items SET sync_attempts = sync_attempts + 1, last_sync_error = ? WHERE id = ?`,
    [errorMessage, itemId],
  );
}

/** Same idea as `markLocationConflict` -- see its comment. */
export async function markItemConflict(itemId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`UPDATE local_items SET conflict = 1 WHERE id = ?`, [itemId]);
}

/** Dirty items still eligible for the sync engine to push -- excludes ones already flagged `conflict`. */
export async function getDirtyItemsForInspection(inspectionId: string): Promise<LocalItem[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<LocalItemRow>(
    `SELECT local_items.* FROM local_items
       JOIN local_locations ON local_locations.id = local_items.location_id
       WHERE local_locations.inspection_id = ? AND local_items.dirty = 1 AND local_items.conflict = 0`,
    [inspectionId],
  );
  return Promise.all(rows.map(decodeItemRow));
}

/** Items flagged `conflict` for one inspection -- what the resolution UI (conflicts.tsx) lists. */
export async function getConflictedItemsForInspection(inspectionId: string): Promise<LocalItem[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<LocalItemRow>(
    `SELECT local_items.* FROM local_items
       JOIN local_locations ON local_locations.id = local_items.location_id
       WHERE local_locations.inspection_id = ? AND local_items.conflict = 1`,
    [inspectionId],
  );
  return Promise.all(rows.map(decodeItemRow));
}

/** Same idea as `overwriteLocationFromServer` -- see its comment. */
export async function overwriteItemFromServer(
  itemId: string,
  patch: {
    status: string;
    observation: string | null;
    inspectedAt: string | null;
    serverUpdatedAt: string;
  },
): Promise<void> {
  const db = await getDatabase();
  const observationEnc = patch.observation ? await encryptText(patch.observation) : null;
  await db.runAsync(
    `UPDATE local_items
       SET status = ?, observation_enc = ?, inspected_at = ?,
           dirty = 0, conflict = 0, server_updated_at = ?
       WHERE id = ?`,
    [patch.status, observationEnc, patch.inspectedAt, patch.serverUpdatedAt, itemId],
  );
}

/** Same idea as `clearLocationConflictKeepLocal` -- see its comment. */
export async function clearItemConflictKeepLocal(
  itemId: string,
  serverUpdatedAt: string,
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`UPDATE local_items SET conflict = 0, server_updated_at = ? WHERE id = ?`, [
    serverUpdatedAt,
    itemId,
  ]);
}

/**
 * Count of locations + items flagged `conflict` for one inspection --
 * what the walkthrough screen and the Inspections list show a lightweight
 * "N changes need review" note for after a sync run. The actual
 * resolution UI is `[id]/conflicts.tsx`, backed by
 * `getConflictedLocationsForInspection`/`getConflictedItemsForInspection`
 * above -- this count just makes sure a conflict is never invisible
 * before someone opens it.
 */
export async function getConflictCountForInspection(inspectionId: string): Promise<number> {
  const db = await getDatabase();
  const locationRow = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM local_locations WHERE inspection_id = ? AND conflict = 1`,
    [inspectionId],
  );
  const itemRow = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM local_items
       JOIN local_locations ON local_locations.id = local_items.location_id
       WHERE local_locations.inspection_id = ? AND local_items.conflict = 1`,
    [inspectionId],
  );
  return (locationRow?.count ?? 0) + (itemRow?.count ?? 0);
}

// ---------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------

export type LocalPhoto = {
  id: string;
  itemId: string;
  localFileUri: string;
  designation: string;
  caption: string | null;
  takenAt: string;
  uploaded: boolean;
  storagePath: string | null;
  clientUuid: string | null;
  createdAt: string;
};

type LocalPhotoRow = {
  id: string;
  item_id: string;
  local_file_uri: string;
  designation: string;
  caption_enc: string | null;
  taken_at: string;
  uploaded: number;
  storage_path: string | null;
  client_uuid: string | null;
  created_at: string;
};

async function decodePhotoRow(row: LocalPhotoRow): Promise<LocalPhoto> {
  return {
    id: row.id,
    itemId: row.item_id,
    localFileUri: row.local_file_uri,
    designation: row.designation,
    caption: row.caption_enc ? await decryptText(row.caption_enc) : null,
    takenAt: row.taken_at,
    uploaded: row.uploaded === 1,
    storagePath: row.storage_path,
    clientUuid: row.client_uuid,
    createdAt: row.created_at,
  };
}

/**
 * Records a photo this device has captured -- online or offline, doesn't
 * matter, this is the durable local record and is what "the photo was
 * taken" actually means from here on (see offline-photos.ts). The
 * encrypted image bytes already live at `localFileUri` by the time this
 * is called; this just indexes it. `clientUuid` (a real RFC4122 UUID,
 * distinct from this table's own `id`) is the offline idempotent sync
 * key -- see migration 0016's `photos.client_uuid` -- generated once at
 * capture time so a retried upload after a dropped connection can never
 * create a duplicate `photos` row. `uploaded`/`storagePath` start out
 * false/null and are filled in later by `markPhotoUploaded` once (if) the
 * upload to Supabase Storage succeeds -- immediately, when captured
 * online, or later by the sync engine (offline-sync.ts) when it was
 * captured offline.
 */
export async function insertLocalPhoto(photo: {
  id: string;
  itemId: string;
  localFileUri: string;
  designation: string;
  caption: string | null;
  takenAt: string;
  clientUuid: string;
}): Promise<void> {
  const db = await getDatabase();
  const captionEnc = photo.caption ? await encryptText(photo.caption) : null;
  await db.runAsync(
    `INSERT INTO local_photos
       (id, item_id, local_file_uri, designation, caption_enc, taken_at, uploaded, storage_path, client_uuid, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
    [
      photo.id,
      photo.itemId,
      photo.localFileUri,
      photo.designation,
      captionEnc,
      photo.takenAt,
      photo.clientUuid,
      new Date().toISOString(),
    ],
  );
}

export async function getPhotosForItem(itemId: string): Promise<LocalPhoto[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<LocalPhotoRow>(
    `SELECT * FROM local_photos WHERE item_id = ? ORDER BY taken_at`,
    [itemId],
  );
  return Promise.all(rows.map(decodePhotoRow));
}

export async function markPhotoUploaded(photoId: string, storagePath: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE local_photos
       SET uploaded = 1, storage_path = ?, sync_attempts = 0, last_sync_error = NULL
       WHERE id = ?`,
    [storagePath, photoId],
  );
}

/** Same idea as `recordLocationSyncFailure` -- see its comment. */
export async function recordPhotoSyncFailure(photoId: string, errorMessage: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE local_photos SET sync_attempts = sync_attempts + 1, last_sync_error = ? WHERE id = ?`,
    [errorMessage, photoId],
  );
}

/**
 * Every locally-captured photo not yet uploaded, across a whole
 * inspection -- what the sync engine (offline-sync.ts) drains.
 */
export async function getPendingPhotosForInspection(inspectionId: string): Promise<LocalPhoto[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<LocalPhotoRow>(
    `SELECT local_photos.* FROM local_photos
       JOIN local_items ON local_items.id = local_photos.item_id
       JOIN local_locations ON local_locations.id = local_items.location_id
       WHERE local_locations.inspection_id = ? AND local_photos.uploaded = 0`,
    [inspectionId],
  );
  return Promise.all(rows.map(decodePhotoRow));
}

export type SyncOverview = {
  pendingLocations: number;
  pendingItems: number;
  pendingPhotos: number;
  conflicts: number;
};

/**
 * Global pending-sync counts across *every* locally-mirrored inspection on
 * this device, not just one -- what powers the app-wide "Offline, N
 * changes pending" strip and tab badge (see (app)/_layout.tsx), as opposed
 * to `getConflictCountForInspection` above which is scoped to the one
 * inspection currently open in the walkthrough screen. `pendingLocations`/
 * `pendingItems` intentionally exclude rows already flagged `conflict`
 * (mirroring `getDirtyLocations`/`getDirtyItemsForInspection` -- those are
 * stuck, not "about to sync"), and are counted separately from `conflicts`.
 */
export async function getSyncOverview(): Promise<SyncOverview> {
  const db = await getDatabase();
  const locationRow = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM local_locations WHERE dirty = 1 AND conflict = 0`,
  );
  const itemRow = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM local_items WHERE dirty = 1 AND conflict = 0`,
  );
  const photoRow = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM local_photos WHERE uploaded = 0`,
  );
  const conflictRow = await db.getFirstAsync<{ count: number }>(
    `SELECT
       (SELECT COUNT(*) FROM local_locations WHERE conflict = 1) +
       (SELECT COUNT(*) FROM local_items WHERE conflict = 1) as count`,
  );
  return {
    pendingLocations: locationRow?.count ?? 0,
    pendingItems: itemRow?.count ?? 0,
    pendingPhotos: photoRow?.count ?? 0,
    conflicts: conflictRow?.count ?? 0,
  };
}

// ---------------------------------------------------------------------
// Sync Status screen (settings/sync-status.tsx)
// ---------------------------------------------------------------------
//
// `getSyncOverview` above answers "how much is pending" for the ambient
// app-wide strip/badge; the three functions below answer "which rows,
// specifically" for a person who wants to actually look at what's stuck
// and, for photos, do something about it. Global across every
// locally-mirrored inspection, same scope as `getSyncOverview`.

export type PendingLocationSummary = {
  id: string;
  inspectionId: string;
  name: string;
  propertyName: string;
  conflict: boolean;
  syncAttempts: number;
  lastSyncError: string | null;
};

/** Every dirty location, with enough context to show a useful label -- read-only, no discard action (see the module header comment on why). */
export async function getAllDirtyLocationsWithContext(): Promise<PendingLocationSummary[]> {
  const db = await getDatabase();
  return db.getAllAsync<PendingLocationSummary>(
    `SELECT
       local_locations.id as id,
       local_locations.inspection_id as inspectionId,
       local_locations.name as name,
       local_inspection_headers.property_name as propertyName,
       local_locations.conflict as conflict,
       local_locations.sync_attempts as syncAttempts,
       local_locations.last_sync_error as lastSyncError
     FROM local_locations
     JOIN local_inspection_headers ON local_inspection_headers.id = local_locations.inspection_id
     WHERE local_locations.dirty = 1
     ORDER BY local_locations.sync_attempts DESC, local_locations.updated_at DESC`,
  );
}

export type PendingItemSummary = {
  id: string;
  inspectionId: string;
  title: string;
  locationName: string;
  propertyName: string;
  conflict: boolean;
  syncAttempts: number;
  lastSyncError: string | null;
};

/** Same idea as `getAllDirtyLocationsWithContext` -- see its comment. */
export async function getAllDirtyItemsWithContext(): Promise<PendingItemSummary[]> {
  const db = await getDatabase();
  return db.getAllAsync<PendingItemSummary>(
    `SELECT
       local_items.id as id,
       local_locations.inspection_id as inspectionId,
       local_items.title as title,
       local_locations.name as locationName,
       local_inspection_headers.property_name as propertyName,
       local_items.conflict as conflict,
       local_items.sync_attempts as syncAttempts,
       local_items.last_sync_error as lastSyncError
     FROM local_items
     JOIN local_locations ON local_locations.id = local_items.location_id
     JOIN local_inspection_headers ON local_inspection_headers.id = local_locations.inspection_id
     WHERE local_items.dirty = 1
     ORDER BY local_items.sync_attempts DESC, local_items.updated_at DESC`,
  );
}

export type PendingPhotoSummary = {
  id: string;
  itemTitle: string;
  locationName: string;
  propertyName: string;
  takenAt: string;
  localFileUri: string;
  syncAttempts: number;
  lastSyncError: string | null;
};

/**
 * Every not-yet-uploaded photo, with enough context to show a useful
 * label. Unlike locations/items, photos get a real discard action
 * (`discardPendingPhoto` below) -- deleting a stuck photo capture can't
 * silently misrepresent an inspection finding the way abandoning a dirty
 * location/item status edit could, and it can always be recaptured.
 */
export async function getAllPendingPhotosWithContext(): Promise<PendingPhotoSummary[]> {
  const db = await getDatabase();
  return db.getAllAsync<PendingPhotoSummary>(
    `SELECT
       local_photos.id as id,
       local_items.title as itemTitle,
       local_locations.name as locationName,
       local_inspection_headers.property_name as propertyName,
       local_photos.taken_at as takenAt,
       local_photos.local_file_uri as localFileUri,
       local_photos.sync_attempts as syncAttempts,
       local_photos.last_sync_error as lastSyncError
     FROM local_photos
     JOIN local_items ON local_items.id = local_photos.item_id
     JOIN local_locations ON local_locations.id = local_items.location_id
     JOIN local_inspection_headers ON local_inspection_headers.id = local_locations.inspection_id
     WHERE local_photos.uploaded = 0
     ORDER BY local_photos.sync_attempts DESC, local_photos.taken_at ASC`,
  );
}

/**
 * Permanently abandons a not-yet-uploaded photo: removes its row from the
 * local mirror so the sync engine stops retrying it. Returns the
 * `local_file_uri` so the caller (sync-status.tsx) can also delete the
 * encrypted file itself off local storage -- this function only touches
 * the database, since offline-db.ts has no dependency on expo-file-system
 * anywhere else and this keeps that boundary. Returns null if the photo
 * is already gone (e.g. a duplicate tap).
 */
export async function discardPendingPhoto(photoId: string): Promise<string | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ local_file_uri: string }>(
    `SELECT local_file_uri FROM local_photos WHERE id = ?`,
    [photoId],
  );
  if (!row) return null;
  await db.runAsync(`DELETE FROM local_photos WHERE id = ?`, [photoId]);
  return row.local_file_uri;
}

// ---------------------------------------------------------------------
// Diagnostics / test support
// ---------------------------------------------------------------------

/**
 * Drops and recreates every table. Originally used only by TEST_PLAN.md's
 * manual device-reset steps -- as of Phase 23 it's also called from real
 * app code, by auth-context.tsx's `signOut()`, so that a device's local
 * mirror never outlives the session it belongs to (see
 * getAllLocalInspectionHeaders' comment above for the tenant-isolation
 * reasoning this closes).
 *
 * Phase 23 bug fix: this previously dropped `local_locations`,
 * `local_items`, `local_photos`, and `sync_queue`, but not
 * `local_inspection_headers` itself -- so even a manual "reset" left every
 * inspection header behind. Now drops all five.
 */
export async function resetLocalMirror(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync(`
    DROP TABLE IF EXISTS local_inspection_headers;
    DROP TABLE IF EXISTS local_locations;
    DROP TABLE IF EXISTS local_items;
    DROP TABLE IF EXISTS local_photos;
    DROP TABLE IF EXISTS sync_queue;
  `);
  await initSchema(db);
  logger.info('offline-db', 'Local mirror reset');
}
