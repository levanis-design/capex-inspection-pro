import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { isCurrentlyOnline, useConnectivity } from '@/lib/connectivity';
import { getCachedOrganizationId } from '@/lib/current-organization-cache';
import { INSPECTION_STATUS_LABELS, inspectionTypeLabel } from '@/lib/inspection-types';
import { logger } from '@/lib/logger';
import { getAllLocalInspectionHeaders, getSyncOverview, SyncOverview } from '@/lib/offline-db';
import { syncAllInspections } from '@/lib/offline-sync';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, touchTarget, typography } from '@/theme';

const EMPTY_SYNC_OVERVIEW: SyncOverview = {
  pendingLocations: 0,
  pendingItems: 0,
  pendingPhotos: 0,
  conflicts: 0,
};

type InspectionRow = {
  id: string;
  inspection_type: string;
  status: string;
  scheduled_date: string | null;
  created_at: string;
  propertyName: string;
};

type RawInspectionRow = {
  id: string;
  inspection_type: string;
  status: string;
  scheduled_date: string | null;
  created_at: string;
  properties: { name: string } | { name: string }[] | null;
};

// Status colors always ship with a text label alongside them (see
// styles.statusDot's accessibilityElementsHidden below) -- PRODUCT_SPEC.md's
// UX requirements say status is never conveyed by color alone.
const STATUS_COLORS: Record<string, string> = {
  scheduled: colors.statusScheduled,
  in_progress: colors.statusInProgress,
  completed: colors.statusSatisfactory,
  postponed: colors.statusNeutral,
  voided: colors.statusNeutral,
};

/**
 * Inspections list (Phase 5B, extended in Phase 5C for offline resume).
 * Tapping a scheduled/in-progress inspection opens the walkthrough;
 * tapping a completed one opens the same screen read-only (see
 * [id]/index.tsx). "Start inspection" begins the property/type picker in
 * new.tsx.
 *
 * Network-first, local-mirror fallback (same pattern as the walkthrough
 * screen -- see [id]/index.tsx's `load()`): a cold app start with no
 * signal used to render an empty list even when the local SQLite mirror
 * (offline-db.ts) already had an in-progress inspection on this device --
 * this is what actually makes "resume an inspection you already started"
 * possible with no connection at all, not just within an inspection
 * that's already open.
 */
export default function InspectionsListScreen() {
  const router = useRouter();
  const [inspections, setInspections] = useState<InspectionRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isOfflineList, setIsOfflineList] = useState(false);
  const [syncOverview, setSyncOverview] = useState<SyncOverview>(EMPTY_SYNC_OVERVIEW);

  // Same self-reference workaround as [id]/index.tsx's `loadRef`: the
  // sync-then-reload callback inside load() below can't call `load()`
  // directly from within its own definition without tripping the
  // react-hooks/immutability rule, even though it's runtime-safe (the
  // callback only runs later, once `load` is assigned).
  const loadRef = useRef<() => void>(() => {});

  const load = useCallback(async () => {
    // Runs on every load regardless of which branch below is taken, so
    // the app-wide pending-sync/conflict counts are never stale just
    // because this particular load happened to come from the local
    // mirror -- see getSyncOverview's comment in offline-db.ts.
    getSyncOverview()
      .then(setSyncOverview)
      .catch((error) => logger.error('inspections', 'Failed to load sync overview', error));

    const online = await isCurrentlyOnline();
    if (online) {
      const { data, error } = await supabase
        .from('inspections')
        .select('id, inspection_type, status, scheduled_date, created_at, properties(name)')
        .order('created_at', { ascending: false });

      if (!error) {
        setLoadError(null);
        setIsOfflineList(false);
        const rows = ((data as RawInspectionRow[] | null) ?? []).map((row) => {
          const property = Array.isArray(row.properties) ? row.properties[0] : row.properties;
          return {
            id: row.id,
            inspection_type: row.inspection_type,
            status: row.status,
            scheduled_date: row.scheduled_date,
            created_at: row.created_at,
            propertyName: property?.name ?? 'Unknown property',
          };
        });
        setInspections(rows);

        // Opportunistic drain: now that we know we're online, push
        // anything any locally-mirrored inspection has queued -- see
        // offline-sync.ts. Fire-and-forget, same as the walkthrough
        // screen's per-inspection drain; reload afterwards only if it
        // actually changed anything, so the sync-overview banner below
        // reflects the post-sync truth.
        syncAllInspections()
          .then((summary) => {
            if (!summary.attempted) return;
            if (summary.errors > 0) {
              logger.error('inspections', 'Sync finished with errors', undefined, { ...summary });
            }
            const changed =
              summary.syncedLocations +
              summary.syncedItems +
              summary.syncedPhotos +
              summary.conflicts;
            if (changed > 0) loadRef.current();
          })
          .catch((syncError) => logger.error('inspections', 'Sync failed', syncError));
        return;
      }
      logger.error('inspections', 'Failed to load inspections', error);
      // Online but the fetch itself still failed -- fall through and try
      // the local mirror rather than showing an empty list.
    }

    // Phase 23: the local mirror can (deliberately, for offline resume)
    // hold inspections from more than one sign-in on this device -- see
    // getAllLocalInspectionHeaders' comment in offline-db.ts. Without a
    // known current organization id there's no safe way to tell which of
    // those rows belong to whoever is signed in right now, so this shows
    // an empty, explicit "reconnect" state rather than risking another
    // organization's data -- that's a strictly rarer path than before
    // (only hit if this is the very first fully-offline app open right
    // after a fresh sign-in, before the post-auth cache write in
    // auth-context.tsx has had a chance to run).
    const organizationId = await getCachedOrganizationId();
    const headers = organizationId ? await getAllLocalInspectionHeaders(organizationId) : [];
    setIsOfflineList(true);
    setInspections(
      headers.map((header) => ({
        id: header.id,
        inspection_type: header.inspectionType,
        status: header.status,
        scheduled_date: null,
        created_at: '',
        propertyName: header.propertyName,
      })),
    );
    setLoadError(
      headers.length > 0
        ? null
        : online
          ? 'Could not load inspections. Pull down to try again.'
          : organizationId
            ? 'No offline copy of your inspections yet. Open one while online to make it available offline.'
            : "Couldn't confirm your organization while offline. Reconnect once to enable the offline copy of your inspections.",
    );
  }, []);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Catches connectivity coming back while this screen is already open,
  // same as the walkthrough screen -- see [id]/index.tsx for why a plain
  // useFocusEffect alone can't.
  const { isOnline } = useConnectivity();
  const wasOnlineRef = useRef(isOnline);
  useEffect(() => {
    if (isOnline && !wasOnlineRef.current) {
      load();
    }
    wasOnlineRef.current = isOnline;
  }, [isOnline, load]);

  async function handleRefresh() {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  }

  const pendingSyncCount =
    syncOverview.pendingLocations + syncOverview.pendingItems + syncOverview.pendingPhotos;

  if (inspections === null) {
    return (
      <Screen>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.slate} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen noPadding>
      <FlatList
        data={inspections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshing={isRefreshing}
        onRefresh={handleRefresh}
        ListHeaderComponent={
          loadError || isOfflineList || pendingSyncCount > 0 || syncOverview.conflicts > 0 ? (
            <View style={styles.banner}>
              {loadError ? (
                <Text style={[typography.body, styles.errorText]}>{loadError}</Text>
              ) : isOfflineList ? (
                <Text style={[typography.body, styles.offlineBanner]}>
                  Offline — showing inspections saved to this device. Pull down to try again once
                  you&rsquo;re back online.
                </Text>
              ) : null}
              {pendingSyncCount > 0 ? (
                <Text style={[typography.body, styles.offlineBanner]}>
                  {pendingSyncCount} change{pendingSyncCount === 1 ? '' : 's'} waiting to sync.
                </Text>
              ) : null}
              {syncOverview.conflicts > 0 ? (
                <Text style={[typography.body, styles.conflictBanner]}>
                  {syncOverview.conflicts} change{syncOverview.conflicts === 1 ? '' : 's'}{' '}
                  couldn&rsquo;t sync automatically because{' '}
                  {syncOverview.conflicts === 1 ? 'it was' : 'they were'} also edited elsewhere.
                  Open the affected inspection to review and choose which version to keep.
                </Text>
              ) : null}
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={typography.body}>
              No inspections yet. Start one to walk through a property&apos;s checklist.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Pressable
              onPress={() => router.push(`/(app)/inspections/${item.id}`)}
              style={({ pressed }) => [styles.rowMain, pressed && styles.rowPressed]}
              accessibilityRole="button"
              accessibilityLabel={`Open ${item.propertyName} ${inspectionTypeLabel(item.inspection_type)} inspection`}
            >
              <View style={styles.rowText}>
                <Text style={typography.bodyStrong}>{item.propertyName}</Text>
                <Text style={[typography.caption, styles.rowSubtitle]}>
                  {inspectionTypeLabel(item.inspection_type)}
                  {item.scheduled_date ? ` · ${item.scheduled_date}` : ''}
                </Text>
              </View>
              <View style={styles.statusBadge}>
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: STATUS_COLORS[item.status] ?? colors.statusNeutral },
                  ]}
                />
                <Text style={typography.caption}>
                  {INSPECTION_STATUS_LABELS[item.status] ?? item.status}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textDisabled} />
            </Pressable>
            {isOfflineList ? null : (
              <Pressable
                onPress={() => router.push(`/(app)/inspections/${item.id}/manage`)}
                style={({ pressed }) => [styles.manageButton, pressed && styles.rowPressed]}
                accessibilityRole="button"
                accessibilityLabel={`Manage ${item.propertyName} ${inspectionTypeLabel(item.inspection_type)} inspection`}
                hitSlop={8}
              >
                <Ionicons name="ellipsis-vertical" size={20} color={colors.textSecondary} />
              </Pressable>
            )}
          </View>
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
      <View style={styles.footer}>
        <Button label="Start inspection" onPress={() => router.push('/(app)/inspections/new')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  banner: {
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  errorText: {
    color: colors.danger,
  },
  offlineBanner: {
    color: colors.warning,
  },
  conflictBanner: {
    color: colors.danger,
  },
  empty: {
    flex: 1,
    paddingTop: spacing.xxl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    minHeight: touchTarget.minHeight,
  },
  manageButton: {
    minWidth: touchTarget.minHeight,
    minHeight: touchTarget.minHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowPressed: {
    opacity: 0.6,
  },
  rowText: {
    flex: 1,
    gap: spacing.xs,
  },
  rowSubtitle: {
    color: colors.textSecondary,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
  },
  footer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
});
