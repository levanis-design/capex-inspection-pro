import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { MarkLocationModal } from '@/components/mark-location-modal';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { isCurrentlyOnline, useConnectivity } from '@/lib/connectivity';
import { fetchPhotosForItems, ItemPhoto } from '@/lib/inspection-photos';
import {
  inspectionTypeLabel,
  ITEM_STATUS_LABELS,
  LOCATION_STATUS_LABELS,
} from '@/lib/inspection-types';
import { logger } from '@/lib/logger';
import {
  getConflictCountForInspection,
  getItemsForLocation,
  getLocalInspectionHeader,
  getLocationsForInspection,
  getPhotosForItem,
  markItemSynced,
  markLocationSynced,
  seedItemIfAbsent,
  seedLocationIfAbsent,
  updateInspectionStatusLocal,
  updateItemObservationLocal,
  updateItemStatusLocal,
  updateLocationStatusLocal,
  upsertInspectionHeader,
} from '@/lib/offline-db';
import { capturePhotoOffline, resolveLocalPhotoDisplayUri } from '@/lib/offline-photos';
import { syncInspection } from '@/lib/offline-sync';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, touchTarget, typography } from '@/theme';

type InspectionHeader = {
  id: string;
  status: string;
  inspection_type: string;
  organizationId: string;
  propertyName: string;
};

type SnapshotLocation = {
  id: string;
  sequence_order: number;
  status: string;
  status_reason: string | null;
  name: string;
};

type SnapshotItem = {
  id: string;
  inspection_snapshot_location_id: string;
  title: string;
  instructions: string | null;
  status: string;
  observation: string | null;
  priority: string | null;
  photoRequired: boolean;
};

type WalkthroughData = {
  inspection: InspectionHeader;
  locations: SnapshotLocation[];
  itemsByLocation: Record<string, SnapshotItem[]>;
  photosByItem: Record<string, ItemPhoto[]>;
};

type MarkTarget = 'skipped' | 'inaccessible' | 'not_applicable';

const ITEM_STATUS_CHOICES: { value: string; label: string; color: string }[] = [
  { value: 'satisfactory', label: 'Satisfactory', color: colors.statusSatisfactory },
  { value: 'deficiency', label: 'Deficiency', color: colors.danger },
  { value: 'not_applicable', label: 'N/A', color: colors.statusNeutral },
];

// Pure fetch, no setState -- same pattern used throughout Phase 4 (see
// properties/[id]/setup.tsx). Two round trips (locations, then items
// filtered to those location ids) rather than one deep nested select,
// which keeps each query easy to reason about.
async function fetchWalkthrough(
  inspectionId: string,
): Promise<{ data: WalkthroughData | null; error: string | null }> {
  const { data: snapshotRow, error: snapshotError } = await supabase
    .from('inspection_snapshots')
    .select('id, inspections(id, status, inspection_type, organization_id, properties(name))')
    .eq('inspection_id', inspectionId)
    .single();

  if (snapshotError || !snapshotRow) {
    logger.error('inspection-walkthrough', 'Failed to load inspection', snapshotError);
    return { data: null, error: 'Could not load this inspection.' };
  }

  const row = snapshotRow as unknown as {
    id: string;
    inspections:
      | {
          id: string;
          status: string;
          inspection_type: string;
          organization_id: string;
          properties: unknown;
        }
      | {
          id: string;
          status: string;
          inspection_type: string;
          organization_id: string;
          properties: unknown;
        }[]
      | null;
  };
  const inspectionRaw = Array.isArray(row.inspections) ? row.inspections[0] : row.inspections;
  if (!inspectionRaw) {
    return { data: null, error: 'Could not load this inspection.' };
  }
  const propertiesRaw = inspectionRaw.properties as { name: string } | { name: string }[] | null;
  const propertyRaw = Array.isArray(propertiesRaw) ? propertiesRaw[0] : propertiesRaw;

  const { data: locationRows, error: locationsError } = await supabase
    .from('inspection_snapshot_locations')
    .select('id, sequence_order, status, status_reason, property_locations(name)')
    .eq('inspection_snapshot_id', row.id)
    .order('sequence_order');

  if (locationsError) {
    logger.error('inspection-walkthrough', 'Failed to load areas', locationsError);
    return { data: null, error: 'Could not load this inspection’s areas.' };
  }

  const locations: SnapshotLocation[] = (
    (locationRows ?? []) as {
      id: string;
      sequence_order: number;
      status: string;
      status_reason: string | null;
      property_locations: { name: string } | { name: string }[] | null;
    }[]
  ).map((locationRow) => {
    const propertyLocation = Array.isArray(locationRow.property_locations)
      ? locationRow.property_locations[0]
      : locationRow.property_locations;
    return {
      id: locationRow.id,
      sequence_order: locationRow.sequence_order,
      status: locationRow.status,
      status_reason: locationRow.status_reason,
      name: propertyLocation?.name ?? 'Unknown area',
    };
  });

  const locationIds = locations.map((l) => l.id);
  const itemsByLocation: Record<string, SnapshotItem[]> = {};
  let photosByItem: Record<string, ItemPhoto[]> = {};

  if (locationIds.length > 0) {
    const { data: itemRows, error: itemsError } = await supabase
      .from('inspection_snapshot_items')
      .select(
        'id, inspection_snapshot_location_id, title, instructions, status, observation, priority, inspection_check_library(photo_required)',
      )
      .in('inspection_snapshot_location_id', locationIds)
      .order('title');

    if (itemsError) {
      logger.error('inspection-walkthrough', 'Failed to load checklist items', itemsError);
      return { data: null, error: 'Could not load this inspection’s checklist items.' };
    }

    const rawItems = (itemRows ?? []) as (Omit<SnapshotItem, 'photoRequired'> & {
      inspection_check_library: { photo_required: boolean } | { photo_required: boolean }[] | null;
    })[];

    for (const rawItem of rawItems) {
      const check = Array.isArray(rawItem.inspection_check_library)
        ? rawItem.inspection_check_library[0]
        : rawItem.inspection_check_library;
      const item: SnapshotItem = {
        id: rawItem.id,
        inspection_snapshot_location_id: rawItem.inspection_snapshot_location_id,
        title: rawItem.title,
        instructions: rawItem.instructions,
        status: rawItem.status,
        observation: rawItem.observation,
        priority: rawItem.priority,
        photoRequired: check?.photo_required ?? false,
      };
      const list = itemsByLocation[item.inspection_snapshot_location_id] ?? [];
      list.push(item);
      itemsByLocation[item.inspection_snapshot_location_id] = list;
    }

    const itemIds = rawItems.map((i) => i.id);
    const photosResult = await fetchPhotosForItems(itemIds);
    photosByItem = photosResult.photosByItem;
  }

  return {
    data: {
      inspection: {
        id: inspectionRaw.id,
        status: inspectionRaw.status,
        inspection_type: inspectionRaw.inspection_type,
        organizationId: inspectionRaw.organization_id,
        propertyName: propertyRaw?.name ?? 'Unknown property',
      },
      locations,
      itemsByLocation,
      photosByItem,
    },
    error: null,
  };
}

/**
 * Merges any locally-captured-but-not-yet-uploaded photos (from
 * `local_photos` -- see offline-db.ts/offline-photos.ts) into a
 * freshly-fetched network `WalkthroughData`, so a photo taken while
 * previously offline keeps showing after the network fetch succeeds
 * again -- until the sync engine (a later Phase 5C step, not yet built)
 * actually uploads it and it starts coming back from the network fetch
 * itself instead, at which point this stops adding a duplicate entry
 * (only `uploaded = 0` rows are merged in).
 */
async function mergeLocalPendingPhotos(data: WalkthroughData): Promise<WalkthroughData> {
  const photosByItem: Record<string, ItemPhoto[]> = { ...data.photosByItem };
  try {
    for (const items of Object.values(data.itemsByLocation)) {
      for (const item of items) {
        const localPhotos = await getPhotosForItem(item.id);
        const pending = localPhotos.filter((photo) => !photo.uploaded);
        if (pending.length === 0) continue;
        const pendingItemPhotos = await Promise.all(
          pending.map(async (photo) => ({
            id: photo.id,
            storagePath: null,
            signedUrl: null,
            localUri: (await resolveLocalPhotoDisplayUri(photo)) ?? undefined,
          })),
        );
        photosByItem[item.id] = [...(photosByItem[item.id] ?? []), ...pendingItemPhotos];
      }
    }
  } catch (error) {
    logger.error('inspection-walkthrough', 'Failed to merge local pending photos', error);
  }
  return { ...data, photosByItem };
}

/**
 * First slice of Phase 5C (offline capture): every time the walkthrough
 * loads successfully online, mirror what it fetched into the local SQLite
 * mirror (offline-db.ts), so the data is there the next time this
 * inspection opens with no signal. `seedLocationIfAbsent`/
 * `seedItemIfAbsent` are `INSERT OR IGNORE` -- a location/item the
 * inspector already edited offline (and hasn't synced yet) is never
 * clobbered by this.
 *
 * Deliberately fire-and-forget: this is a best-effort cache warm, not
 * something the screen should ever block on or fail loudly over. Reading
 * from this mirror instead of always hitting the network -- the part that
 * actually makes the walkthrough usable with no signal -- is the next
 * Phase 5C step, not this one.
 */
async function mirrorWalkthroughLocally(data: WalkthroughData): Promise<void> {
  try {
    await upsertInspectionHeader({
      id: data.inspection.id,
      organizationId: data.inspection.organizationId,
      inspectionType: data.inspection.inspection_type,
      status: data.inspection.status,
      propertyName: data.inspection.propertyName,
    });
    for (const location of data.locations) {
      await seedLocationIfAbsent({
        id: location.id,
        inspectionId: data.inspection.id,
        sequenceOrder: location.sequence_order,
        name: location.name,
        status: location.status,
        statusReason: location.status_reason,
        startedAt: null,
        completedAt: null,
      });
      for (const item of data.itemsByLocation[location.id] ?? []) {
        await seedItemIfAbsent({
          id: item.id,
          locationId: location.id,
          title: item.title,
          instructions: item.instructions,
          status: item.status,
          observation: item.observation,
          priority: item.priority,
          photoRequired: item.photoRequired,
        });
      }
    }
  } catch (error) {
    // Never let a local-mirror hiccup break the online walkthrough --
    // this is a cache warm, not the source of truth yet.
    logger.error('inspection-walkthrough', 'Failed to mirror snapshot locally', error);
  }
}

/**
 * Reads a previously-mirrored inspection entirely from the local SQLite
 * mirror -- no network involved. Returns `null` if this inspection was
 * never opened while online (there's nothing to fall back to), which the
 * caller treats as a real load failure, same as a network error with no
 * cache to fall back on.
 *
 * Photos come from `local_photos` (offline-db.ts), decrypted to a
 * throwaway cache file per photo via `resolveLocalPhotoDisplayUri` (see
 * offline-photos.ts) -- there's no network here to fetch a signed URL
 * from, so every photo shown offline is necessarily one this device
 * itself captured (or previously synced and cached locally).
 */
async function loadWalkthroughFromLocalMirror(
  inspectionId: string,
): Promise<WalkthroughData | null> {
  const header = await getLocalInspectionHeader(inspectionId);
  if (!header) return null;

  const localLocations = await getLocationsForInspection(inspectionId);
  const locations: SnapshotLocation[] = localLocations.map((location) => ({
    id: location.id,
    sequence_order: location.sequenceOrder,
    status: location.status,
    status_reason: location.statusReason,
    name: location.name,
  }));

  const itemsByLocation: Record<string, SnapshotItem[]> = {};
  const photosByItem: Record<string, ItemPhoto[]> = {};
  for (const location of localLocations) {
    const localItems = await getItemsForLocation(location.id);
    itemsByLocation[location.id] = localItems.map((item) => ({
      id: item.id,
      inspection_snapshot_location_id: item.locationId,
      title: item.title,
      instructions: item.instructions,
      status: item.status,
      observation: item.observation,
      priority: item.priority,
      photoRequired: item.photoRequired,
    }));

    for (const item of localItems) {
      const localPhotos = await getPhotosForItem(item.id);
      photosByItem[item.id] = await Promise.all(
        localPhotos.map(async (photo) => ({
          id: photo.id,
          storagePath: photo.storagePath,
          signedUrl: null,
          localUri: (await resolveLocalPhotoDisplayUri(photo)) ?? undefined,
        })),
      );
    }
  }

  return {
    inspection: {
      id: header.id,
      status: header.status,
      inspection_type: header.inspectionType,
      organizationId: header.organizationId,
      propertyName: header.propertyName,
    },
    locations,
    itemsByLocation,
    photosByItem,
  };
}

/**
 * The inspection walkthrough (Phase 5B, basic online-only). Per
 * PRODUCT_SPEC.md section 8, the inspector only ever sees one area's
 * checklist at a time, not the whole property at once -- Prev/Next below
 * moves between snapshot locations in their frozen route order.
 *
 * This screen only ever writes status/observation on the snapshot rows
 * created by start_inspection() -- see supabase/migrations/0011's RLS
 * (update allowed for the assigned inspector or an admin/PM/supervisor,
 * insert never allowed). There's no per-location or per-item hard gate
 * here; the final review screen ([id]/review.tsx) is where incomplete
 * areas/items actually get surfaced before submission, per spec.
 */
export default function InspectionWalkthroughScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [walkthrough, setWalkthrough] = useState<WalkthroughData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isOfflineMirror, setIsOfflineMirror] = useState(false);
  const [conflictCount, setConflictCount] = useState(0);
  const [locationIndex, setLocationIndex] = useState(0);
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const [observationDrafts, setObservationDrafts] = useState<Record<string, string>>({});

  const [markTarget, setMarkTarget] = useState<MarkTarget | null>(null);
  const [markReason, setMarkReason] = useState('');
  const [markError, setMarkError] = useState<string | null>(null);
  const [isMarking, setIsMarking] = useState(false);

  const [capturingItemId, setCapturingItemId] = useState<string | null>(null);
  const [photoErrorByItem, setPhotoErrorByItem] = useState<Record<string, string>>({});

  // A "call the latest load()" ref, so the sync-drain callback inside
  // load() itself (below) can trigger a reload without directly
  // referencing `load` from within its own definition -- a real
  // self-reference there would be safe at runtime (the callback only
  // actually runs later, once `load` is assigned) but the
  // react-hooks/immutability rule flags it, since it can't tell a
  // then()-deferred call apart from an immediate one.
  const loadRef = useRef<() => void>(() => {});

  const load = useCallback(async () => {
    if (!id) return;

    // Runs on every load regardless of which branch below is taken, so a
    // conflict flagged by a previous sync run (offline-sync.ts) is never
    // invisible, even while looking at the offline mirror -- see
    // getConflictCountForInspection's comment in offline-db.ts.
    getConflictCountForInspection(id)
      .then(setConflictCount)
      .catch((error) =>
        logger.error('inspection-walkthrough', 'Failed to load conflict count', error),
      );

    // Network-first, local-mirror fallback: this keeps the existing
    // online behavior (fresher data, live photos) completely unchanged
    // whenever there's a connection, and only falls back to the local
    // SQLite mirror -- see offline-db.ts -- when the network genuinely
    // isn't available, which is what actually makes an already-opened
    // inspection usable with no signal (PRODUCT_SPEC.md section 9).
    const online = await isCurrentlyOnline();
    if (online) {
      const result = await fetchWalkthrough(id);
      if (result.data) {
        // Extracted into its own const rather than referencing
        // `result.data` again below: TypeScript's narrowing of an object
        // *property* (established by the `if` above) isn't guaranteed to
        // survive into the nested `.then()`/`.catch()` closures below the
        // way narrowing a plain local variable would.
        const data = result.data;
        setLoadError(null);
        setIsOfflineMirror(false);
        setWalkthrough(await mergeLocalPendingPhotos(data));
        mirrorWalkthroughLocally(data);

        // Opportunistic drain: now that we know we're online, push
        // anything the local mirror has queued for this inspection --
        // see offline-sync.ts. Fire-and-forget, same as the cache-warm
        // above; if it actually drained (or newly flagged conflicts on)
        // anything, reload so the screen reflects the post-sync truth
        // (fresher `server_updated_at`, cleared `dirty` flags, an
        // updated conflict count).
        syncInspection(data.inspection.id, data.inspection.organizationId)
          .then((summary) => {
            if (!summary.attempted) return;
            if (summary.errors > 0) {
              logger.error('inspection-walkthrough', 'Sync finished with errors', undefined, {
                ...summary,
              });
            }
            const changed =
              summary.syncedLocations +
              summary.syncedItems +
              summary.syncedPhotos +
              summary.conflicts;
            if (changed > 0) loadRef.current();
          })
          .catch((syncError) => logger.error('inspection-walkthrough', 'Sync failed', syncError));

        // First visit: promote a still-'scheduled' inspection to
        // 'in_progress'. Fire-and-forget -- a real but low-risk side
        // effect of opening the walkthrough, not worth blocking render on.
        if (data.inspection.status === 'scheduled') {
          supabase
            .from('inspections')
            .update({ status: 'in_progress' })
            .eq('id', data.inspection.id)
            .then(({ error }) => {
              if (error) {
                logger.error('inspection-walkthrough', 'Failed to mark in_progress', error);
              } else {
                updateInspectionStatusLocal(data.inspection.id, 'in_progress').catch((localError) =>
                  logger.error(
                    'inspection-walkthrough',
                    'Failed to mirror in_progress locally',
                    localError,
                  ),
                );
              }
            });
        }

        const firstOpenIndex = data.locations.findIndex((l) =>
          ['pending', 'in_progress'].includes(l.status),
        );
        setLocationIndex(
          firstOpenIndex === -1 ? Math.max(data.locations.length - 1, 0) : firstOpenIndex,
        );
        return;
      }
      // Online but the fetch itself still failed (a transient error, or
      // a genuine problem) -- fall through and try the local mirror
      // rather than giving up immediately.
    }

    const localData = await loadWalkthroughFromLocalMirror(id);
    if (!localData) {
      setLoadError(
        online
          ? 'Could not load this inspection.'
          : 'No offline copy of this inspection yet. Open it once while online to make it available offline.',
      );
      return;
    }

    setLoadError(null);
    setIsOfflineMirror(true);
    setWalkthrough(localData);
    const firstOpenIndex = localData.locations.findIndex((l) =>
      ['pending', 'in_progress'].includes(l.status),
    );
    setLocationIndex(
      firstOpenIndex === -1 ? Math.max(localData.locations.length - 1, 0) : firstOpenIndex,
    );
  }, [id]);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Catches the case load()'s own online branch can't: connectivity
  // coming back *while this screen is already open* (the inspector walks
  // back into signal range mid-walkthrough). Reloading re-enters load()'s
  // online path, which drains the sync engine as a side effect -- see
  // above -- so there's nothing more to do here than notice the
  // false -> true transition and ask for a reload.
  const { isOnline } = useConnectivity();
  const wasOnlineRef = useRef(isOnline);
  useEffect(() => {
    if (isOnline && !wasOnlineRef.current) {
      load();
    }
    wasOnlineRef.current = isOnline;
  }, [isOnline, load]);

  // "Manage" (reschedule/reassign, or void/delete -- see 0015 and
  // manage.tsx) is one tap away from the header, not buried back on the
  // list screen, so it's actually discoverable while looking at the
  // inspection itself.
  const headerRight = useCallback(
    () => (
      <Pressable
        onPress={() => id && router.push(`/(app)/inspections/${id}/manage`)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Manage inspection"
        style={styles.headerButton}
      >
        <Ionicons name="ellipsis-vertical" size={22} color={colors.textPrimary} />
      </Pressable>
    ),
    [id, router],
  );

  if (!walkthrough) {
    return (
      <>
        <Stack.Screen options={{ headerRight }} />
        <Screen>
          <View style={styles.centered}>
            {loadError ? (
              <Text style={[typography.body, styles.errorText]}>{loadError}</Text>
            ) : (
              <ActivityIndicator color={colors.slate} />
            )}
          </View>
        </Screen>
      </>
    );
  }

  const isReadOnly = walkthrough.inspection.status === 'completed';
  const location = walkthrough.locations[locationIndex] as SnapshotLocation | undefined;
  const items = location ? (walkthrough.itemsByLocation[location.id] ?? []) : [];

  function updateLocationLocal(locationId: string, patch: Partial<SnapshotLocation>) {
    setWalkthrough((prev) =>
      prev
        ? {
            ...prev,
            locations: prev.locations.map((l) => (l.id === locationId ? { ...l, ...patch } : l)),
          }
        : prev,
    );
  }

  function updateItemLocal(locationId: string, itemId: string, patch: Partial<SnapshotItem>) {
    setWalkthrough((prev) => {
      if (!prev) return prev;
      const list = prev.itemsByLocation[locationId] ?? [];
      return {
        ...prev,
        itemsByLocation: {
          ...prev.itemsByLocation,
          [locationId]: list.map((i) => (i.id === itemId ? { ...i, ...patch } : i)),
        },
      };
    });
  }

  // Local-write-first, network-best-effort (PRODUCT_SPEC.md section 9): the
  // local SQLite mirror (offline-db.ts) is written unconditionally and is
  // what "did this action happen" actually means from here on -- it always
  // succeeds regardless of connectivity. The Supabase write is attempted
  // only when currently online, and is best-effort: on success the local
  // row is marked synced, on failure (or while offline) it's simply left
  // dirty for the sync engine (a later Phase 5C step) to drain later. The
  // UI is never reverted on a network failure anymore, since the local
  // write already succeeded.
  async function handleItemStatus(item: SnapshotItem, locationId: string, newStatus: string) {
    setPendingItemId(item.id);
    updateItemLocal(locationId, item.id, { status: newStatus });
    try {
      await updateItemStatusLocal(item.id, newStatus);
    } catch (localError) {
      logger.error('inspection-walkthrough', 'Failed to save item status locally', localError);
    }

    const shouldPromoteLocation = location?.status === 'pending';
    if (shouldPromoteLocation) {
      updateLocationLocal(locationId, { status: 'in_progress' });
      try {
        await updateLocationStatusLocal(locationId, {
          status: 'in_progress',
          startedAt: new Date().toISOString(),
        });
      } catch (localError) {
        logger.error(
          'inspection-walkthrough',
          'Failed to save area in-progress locally',
          localError,
        );
      }
    }

    if (await isCurrentlyOnline()) {
      const inspectedAt = new Date().toISOString();
      const { error } = await supabase
        .from('inspection_snapshot_items')
        .update({ status: newStatus, inspected_at: inspectedAt })
        .eq('id', item.id);

      if (error) {
        logger.error('inspection-walkthrough', 'Failed to sync item status', error);
      } else {
        markItemSynced(item.id, inspectedAt).catch((syncError) =>
          logger.error('inspection-walkthrough', 'Failed to mark item synced', syncError),
        );
      }

      if (shouldPromoteLocation) {
        const startedAt = new Date().toISOString();
        const { error: locationError } = await supabase
          .from('inspection_snapshot_locations')
          .update({ status: 'in_progress', started_at: startedAt })
          .eq('id', locationId);
        if (locationError) {
          logger.error('inspection-walkthrough', 'Failed to sync area in progress', locationError);
        } else {
          markLocationSynced(locationId, startedAt).catch((syncError) =>
            logger.error('inspection-walkthrough', 'Failed to mark location synced', syncError),
          );
        }
      }
    }
    setPendingItemId(null);
  }

  async function handleSaveObservation(item: SnapshotItem, locationId: string) {
    const draft = observationDrafts[item.id];
    if (draft === undefined || draft === item.observation) return;

    setPendingItemId(item.id);
    updateItemLocal(locationId, item.id, { observation: draft });
    try {
      await updateItemObservationLocal(item.id, draft);
    } catch (localError) {
      logger.error('inspection-walkthrough', 'Failed to save observation locally', localError);
    }

    if (await isCurrentlyOnline()) {
      const { error } = await supabase
        .from('inspection_snapshot_items')
        .update({ observation: draft })
        .eq('id', item.id);

      if (error) {
        logger.error('inspection-walkthrough', 'Failed to sync observation', error);
      } else {
        markItemSynced(item.id, new Date().toISOString()).catch((syncError) =>
          logger.error('inspection-walkthrough', 'Failed to mark item synced', syncError),
        );
      }
    }
    setPendingItemId(null);
  }

  // Merges whatever the network knows about this item's photos (when
  // online) with any locally-captured photos still awaiting upload (from
  // `local_photos` -- see offline-db.ts/offline-photos.ts), so a photo
  // taken offline shows up immediately and a photo that's since finished
  // uploading stops being shown as its own separate local-only entry.
  async function refreshItemPhotos(itemId: string) {
    let networkPhotos: ItemPhoto[] | null = null;
    if (await isCurrentlyOnline()) {
      const { photosByItem, error } = await fetchPhotosForItems([itemId]);
      if (error) {
        logger.error('inspection-walkthrough', 'Failed to refresh photos', error);
      } else {
        networkPhotos = photosByItem[itemId] ?? [];
      }
    }

    let pendingLocalPhotos: ItemPhoto[] = [];
    try {
      const localPhotos = await getPhotosForItem(itemId);
      pendingLocalPhotos = await Promise.all(
        localPhotos
          .filter((photo) => !photo.uploaded)
          .map(async (photo) => ({
            id: photo.id,
            storagePath: null,
            signedUrl: null,
            localUri: (await resolveLocalPhotoDisplayUri(photo)) ?? undefined,
          })),
      );
    } catch (localError) {
      logger.error('inspection-walkthrough', 'Failed to load local photos', localError);
    }

    setWalkthrough((prev) => {
      if (!prev) return prev;
      const base = networkPhotos ?? prev.photosByItem[itemId] ?? [];
      return {
        ...prev,
        photosByItem: { ...prev.photosByItem, [itemId]: [...base, ...pendingLocalPhotos] },
      };
    });
  }

  async function handleAddPhoto(item: SnapshotItem) {
    if (!walkthrough) return;
    setCapturingItemId(item.id);
    setPhotoErrorByItem((prev) => ({ ...prev, [item.id]: '' }));

    const result = await capturePhotoOffline(walkthrough.inspection.organizationId, item.id);
    setCapturingItemId(null);

    if (result.error) {
      setPhotoErrorByItem((prev) => ({ ...prev, [item.id]: result.error as string }));
      return;
    }
    if (result.canceled) return;

    await refreshItemPhotos(item.id);
  }

  async function handleMarkComplete() {
    if (!location || !walkthrough) return;
    setPendingItemId(null);
    const completedAt = new Date().toISOString();

    updateLocationLocal(location.id, { status: 'complete' });
    try {
      await updateLocationStatusLocal(location.id, { status: 'complete', completedAt });
    } catch (localError) {
      logger.error('inspection-walkthrough', 'Failed to save area complete locally', localError);
    }

    if (await isCurrentlyOnline()) {
      const { error } = await supabase
        .from('inspection_snapshot_locations')
        .update({ status: 'complete', completed_at: completedAt })
        .eq('id', location.id);

      if (error) {
        logger.error('inspection-walkthrough', 'Failed to sync area complete', error);
      } else {
        markLocationSynced(location.id, completedAt).catch((syncError) =>
          logger.error('inspection-walkthrough', 'Failed to mark location synced', syncError),
        );
      }
    }

    if (locationIndex < walkthrough.locations.length - 1) {
      setLocationIndex(locationIndex + 1);
    }
  }

  async function handleConfirmMark() {
    if (!location || !markTarget || !walkthrough) return;
    if (!markReason.trim()) {
      setMarkError('A reason is required.');
      return;
    }

    setIsMarking(true);
    const reason = markReason.trim();

    updateLocationLocal(location.id, { status: markTarget, status_reason: reason });
    try {
      await updateLocationStatusLocal(location.id, { status: markTarget, statusReason: reason });
    } catch (localError) {
      logger.error('inspection-walkthrough', 'Failed to save area status locally', localError);
    }

    if (await isCurrentlyOnline()) {
      const { error } = await supabase
        .from('inspection_snapshot_locations')
        .update({ status: markTarget, status_reason: reason })
        .eq('id', location.id);

      if (error) {
        logger.error('inspection-walkthrough', 'Failed to sync area status', error);
      } else {
        markLocationSynced(location.id, new Date().toISOString()).catch((syncError) =>
          logger.error('inspection-walkthrough', 'Failed to mark location synced', syncError),
        );
      }
    }

    setIsMarking(false);
    setMarkTarget(null);
    setMarkReason('');
    setMarkError(null);
    if (locationIndex < walkthrough.locations.length - 1) {
      setLocationIndex(locationIndex + 1);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerRight }} />
      <Screen noPadding>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <Text style={typography.caption}>
              {walkthrough.inspection.propertyName} ·{' '}
              {inspectionTypeLabel(walkthrough.inspection.inspection_type)}
            </Text>
            {isReadOnly ? (
              <Text style={[typography.body, styles.readOnlyBanner]}>
                This inspection has already been submitted — shown here read-only.
              </Text>
            ) : null}
            {isOfflineMirror ? (
              <Text style={[typography.body, styles.offlineBanner]}>
                Offline — showing the last copy saved to this device. Changes are saved here and
                will sync once you&rsquo;re back online.
              </Text>
            ) : null}
            {conflictCount > 0 ? (
              <Pressable
                onPress={() => id && router.push(`/(app)/inspections/${id}/conflicts`)}
                accessibilityRole="button"
                accessibilityLabel={`Resolve ${conflictCount} sync conflict${conflictCount === 1 ? '' : 's'}`}
              >
                <Text style={[typography.body, styles.conflictBanner]}>
                  {conflictCount} change{conflictCount === 1 ? '' : 's'} couldn&rsquo;t sync
                  automatically because {conflictCount === 1 ? 'it was' : 'they were'} also edited
                  elsewhere. Tap to review and choose which version to keep.
                </Text>
              </Pressable>
            ) : null}
          </View>

          {location ? (
            <>
              <View style={styles.locationNav}>
                <Button
                  label="Previous"
                  variant="secondary"
                  onPress={() => setLocationIndex(Math.max(locationIndex - 1, 0))}
                  disabled={locationIndex === 0}
                />
                <View style={styles.locationTitleBlock}>
                  <Text style={typography.screenTitle}>{location.name}</Text>
                  <Text style={typography.caption}>
                    Area {locationIndex + 1} of {walkthrough.locations.length} ·{' '}
                    {LOCATION_STATUS_LABELS[location.status] ?? location.status}
                  </Text>
                </View>
                <Button
                  label="Next"
                  variant="secondary"
                  onPress={() =>
                    setLocationIndex(Math.min(locationIndex + 1, walkthrough.locations.length - 1))
                  }
                  disabled={locationIndex === walkthrough.locations.length - 1}
                />
              </View>

              {location.status_reason ? (
                <Text style={[typography.caption, styles.reasonNote]}>
                  Reason: {location.status_reason}
                </Text>
              ) : null}

              {items.length === 0 ? (
                <Text style={typography.body}>No checklist items in this area.</Text>
              ) : (
                items.map((item) => {
                  const itemPhotos = walkthrough.photosByItem[item.id] ?? [];
                  const missingRequiredPhoto = item.photoRequired && itemPhotos.length === 0;
                  const photoError = photoErrorByItem[item.id];

                  return (
                    <View key={item.id} style={styles.itemCard}>
                      <View style={styles.itemHeaderRow}>
                        <Text style={[typography.bodyStrong, styles.itemTitle]}>{item.title}</Text>
                        {item.priority ? (
                          <View style={styles.priorityBadge}>
                            <Text style={styles.priorityText}>{item.priority}</Text>
                          </View>
                        ) : null}
                      </View>
                      {item.instructions ? (
                        <Text style={[typography.caption, styles.itemInstructions]}>
                          {item.instructions}
                        </Text>
                      ) : null}

                      <View style={styles.photoRow}>
                        {itemPhotos.map((photo) => {
                          // A synced photo's signed URL always wins when
                          // present; `localUri` (a decrypted local cache
                          // copy -- see offline-photos.ts) is the fallback
                          // for a photo this device captured that isn't
                          // uploaded yet, or that's only available offline.
                          const uri = photo.signedUrl ?? photo.localUri;
                          return uri ? (
                            <Image
                              key={photo.id}
                              source={{ uri }}
                              style={styles.thumbnail}
                              contentFit="cover"
                            />
                          ) : (
                            <View
                              key={photo.id}
                              style={[styles.thumbnail, styles.thumbnailPlaceholder]}
                            />
                          );
                        })}
                        {!isReadOnly ? (
                          <Pressable
                            onPress={() => handleAddPhoto(item)}
                            disabled={capturingItemId === item.id}
                            style={({ pressed }) => [
                              styles.addPhotoButton,
                              pressed && styles.rowPressed,
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel="Add photo"
                          >
                            {capturingItemId === item.id ? (
                              <ActivityIndicator color={colors.slate} size="small" />
                            ) : (
                              <Text style={typography.caption}>+ Photo</Text>
                            )}
                          </Pressable>
                        ) : null}
                      </View>
                      {photoError ? <Text style={styles.error}>{photoError}</Text> : null}
                      {missingRequiredPhoto ? (
                        <Text style={[typography.caption, styles.photoRequiredNote]}>
                          A photo is required before this item can be marked satisfactory or
                          deficient.
                        </Text>
                      ) : null}

                      <View style={styles.statusRow}>
                        {ITEM_STATUS_CHOICES.map((choice) => {
                          const isSelected = item.status === choice.value;
                          const isBlockedByPhoto =
                            missingRequiredPhoto && choice.value !== 'not_applicable';
                          return (
                            <Pressable
                              key={choice.value}
                              disabled={isReadOnly || pendingItemId === item.id || isBlockedByPhoto}
                              onPress={() => handleItemStatus(item, location.id, choice.value)}
                              style={({ pressed }) => [
                                styles.statusPill,
                                { borderColor: choice.color },
                                isSelected && { backgroundColor: choice.color },
                                isBlockedByPhoto && styles.statusPillBlocked,
                                pressed && styles.rowPressed,
                              ]}
                              accessibilityRole="radio"
                              accessibilityState={{
                                selected: isSelected,
                                disabled: isBlockedByPhoto,
                              }}
                            >
                              <Text
                                style={[
                                  typography.caption,
                                  styles.statusPillText,
                                  { color: isSelected ? colors.textInverse : choice.color },
                                ]}
                              >
                                {choice.label}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                      {item.status === 'not_inspected' ? (
                        <Text style={[typography.caption, styles.notInspectedNote]}>
                          {ITEM_STATUS_LABELS.not_inspected}
                        </Text>
                      ) : null}

                      {item.status === 'deficiency' || item.observation ? (
                        <TextField
                          label={
                            item.status === 'deficiency' ? 'Observation (required)' : 'Observation'
                          }
                          value={observationDrafts[item.id] ?? item.observation ?? ''}
                          onChangeText={(text) =>
                            setObservationDrafts((prev) => ({ ...prev, [item.id]: text }))
                          }
                          onBlur={() => handleSaveObservation(item, location.id)}
                          editable={!isReadOnly}
                          multiline
                          numberOfLines={2}
                          style={styles.observationInput}
                        />
                      ) : null}
                    </View>
                  );
                })
              )}

              {!isReadOnly ? (
                <View style={styles.locationActions}>
                  <Button label="Mark area complete" onPress={handleMarkComplete} />
                  <View style={styles.markButtonsRow}>
                    <View style={styles.markButton}>
                      <Button
                        label="Skip"
                        variant="secondary"
                        onPress={() => setMarkTarget('skipped')}
                      />
                    </View>
                    <View style={styles.markButton}>
                      <Button
                        label="Inaccessible"
                        variant="secondary"
                        onPress={() => setMarkTarget('inaccessible')}
                      />
                    </View>
                    <View style={styles.markButton}>
                      <Button
                        label="N/A"
                        variant="secondary"
                        onPress={() => setMarkTarget('not_applicable')}
                      />
                    </View>
                  </View>
                </View>
              ) : null}
            </>
          ) : (
            <Text style={typography.body}>This inspection has no areas in scope.</Text>
          )}
        </ScrollView>

        <View style={styles.footer}>
          <Button
            label={isReadOnly ? 'View report' : 'Review & submit'}
            onPress={() => router.push(`/(app)/inspections/${walkthrough.inspection.id}/review`)}
          />
        </View>

        <MarkLocationModal
          visible={markTarget !== null}
          locationName={location?.name ?? ''}
          targetStatus={markTarget}
          reason={markReason}
          isSubmitting={isMarking}
          error={markError}
          onChangeReason={setMarkReason}
          onCancel={() => {
            setMarkTarget(null);
            setMarkReason('');
            setMarkError(null);
          }}
          onConfirm={handleConfirmMark}
        />
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  headerButton: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    color: colors.danger,
  },
  content: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  header: {
    gap: spacing.xs,
  },
  readOnlyBanner: {
    color: colors.textSecondary,
  },
  offlineBanner: {
    color: colors.warning,
  },
  conflictBanner: {
    color: colors.danger,
  },
  locationNav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  locationTitleBlock: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
  },
  reasonNote: {
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  itemCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  itemHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  itemTitle: {
    flex: 1,
  },
  itemInstructions: {
    color: colors.textSecondary,
  },
  priorityBadge: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  priorityText: {
    ...typography.caption,
    fontWeight: '700',
  },
  statusRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statusPill: {
    flex: 1,
    minHeight: touchTarget.minHeight,
    borderRadius: radius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusPillText: {
    fontWeight: '700',
  },
  statusPillBlocked: {
    opacity: 0.4,
  },
  notInspectedNote: {
    color: colors.textDisabled,
  },
  photoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    alignItems: 'center',
  },
  thumbnail: {
    width: 56,
    height: 56,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
  },
  thumbnailPlaceholder: {
    borderWidth: 1,
    borderColor: colors.border,
  },
  addPhotoButton: {
    width: 56,
    height: 56,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoRequiredNote: {
    color: colors.warning,
  },
  error: {
    ...typography.body,
    color: colors.danger,
  },
  observationInput: {
    minHeight: 60,
    textAlignVertical: 'top',
  },
  rowPressed: {
    opacity: 0.7,
  },
  locationActions: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  markButtonsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  markButton: {
    flex: 1,
  },
  footer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
});
