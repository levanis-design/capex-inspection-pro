import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { ITEM_STATUS_LABELS, LOCATION_STATUS_LABELS } from '@/lib/inspection-types';
import { logger } from '@/lib/logger';
import {
  getConflictedItemsForInspection,
  getConflictedLocationsForInspection,
  getLocalInspectionHeader,
  getLocationsForInspection,
  LocalItem,
  LocalLocation,
} from '@/lib/offline-db';
import {
  ConflictResolution,
  fetchServerItemSnapshot,
  fetchServerLocationSnapshot,
  resolveItemConflict,
  resolveLocationConflict,
  ServerItemSnapshot,
  ServerLocationSnapshot,
  syncInspection,
} from '@/lib/offline-sync';
import { colors, radius, spacing, typography } from '@/theme';

type LocationConflictRow = {
  kind: 'location';
  id: string;
  title: string;
  local: LocalLocation;
  server: ServerLocationSnapshot | null;
};

type ItemConflictRow = {
  kind: 'item';
  id: string;
  title: string;
  local: LocalItem;
  server: ServerItemSnapshot | null;
};

type ConflictRow = LocationConflictRow | ItemConflictRow;

type ConflictDisplay = {
  kindLabel: string;
  localStatusLabel: string;
  localDetail: string | null;
  serverStatusLabel: string | null;
  serverDetail: string | null;
};

// Discriminated on `row.kind` so TypeScript narrows `row.local`/`row.server`
// to the right shape in each branch, rather than fighting the union at
// every call site that needs to render one.
function describeConflictRow(row: ConflictRow): ConflictDisplay {
  if (row.kind === 'location') {
    return {
      kindLabel: 'Area',
      localStatusLabel: LOCATION_STATUS_LABELS[row.local.status] ?? row.local.status,
      localDetail: row.local.statusReason,
      serverStatusLabel: row.server
        ? (LOCATION_STATUS_LABELS[row.server.status] ?? row.server.status)
        : null,
      serverDetail: row.server ? row.server.statusReason : null,
    };
  }
  return {
    kindLabel: 'Item',
    localStatusLabel: ITEM_STATUS_LABELS[row.local.status] ?? row.local.status,
    localDetail: row.local.observation,
    serverStatusLabel: row.server
      ? (ITEM_STATUS_LABELS[row.server.status] ?? row.server.status)
      : null,
    serverDetail: row.server ? row.server.observation : null,
  };
}

/**
 * Conflict resolution (Phase 5C, final slice): every row offline-sync.ts
 * has flagged `conflict` for this inspection -- a location/item edited on
 * this device while offline *and* changed by someone else server-side in
 * the meantime -- shown side by side with the server's current content so
 * a person can pick a side, rather than the conflict just sitting flagged
 * forever (which is all the app could do before this screen existed).
 *
 * Reached from the walkthrough screen's conflict banner. Read-only rows
 * disappear from this list as soon as they're resolved; "Keep mine" pushes
 * the local edit on the next sync pass (triggered here right away, best
 * effort), "Keep server's" discards the local edit and pulls the server's
 * content into the local mirror immediately.
 */
export default function InspectionConflictsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [rows, setRows] = useState<ConflictRow[] | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!id) return;

    const header = await getLocalInspectionHeader(id);
    setOrganizationId(header?.organizationId ?? null);

    const [conflictedLocations, conflictedItems, allLocations] = await Promise.all([
      getConflictedLocationsForInspection(id),
      getConflictedItemsForInspection(id),
      getLocationsForInspection(id),
    ]);
    const locationNameById = new Map(allLocations.map((location) => [location.id, location.name]));

    const locationRows = await Promise.all(
      conflictedLocations.map(async (local): Promise<ConflictRow> => ({
        kind: 'location',
        id: local.id,
        title: local.name,
        local,
        server: await fetchServerLocationSnapshot(local.id),
      })),
    );
    const itemRows = await Promise.all(
      conflictedItems.map(async (local): Promise<ConflictRow> => ({
        kind: 'item',
        id: local.id,
        title: `${locationNameById.get(local.locationId) ?? 'Unknown area'} — ${local.title}`,
        local,
        server: await fetchServerItemSnapshot(local.id),
      })),
    );

    setRows([...locationRows, ...itemRows]);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function handleResolve(row: ConflictRow, resolution: ConflictResolution) {
    setResolvingId(row.id);
    setRowErrors((prev) => ({ ...prev, [row.id]: '' }));

    const success =
      row.kind === 'location'
        ? await resolveLocationConflict(row.id, resolution)
        : await resolveItemConflict(row.id, resolution);

    setResolvingId(null);

    if (!success) {
      setRowErrors((prev) => ({
        ...prev,
        [row.id]:
          'Could not reach the server to resolve this. Check your connection and try again.',
      }));
      return;
    }

    setRows((prev) => (prev ? prev.filter((r) => r.id !== row.id) : prev));

    if (resolution === 'keep_local' && id && organizationId) {
      // Best-effort immediate push -- the row is an ordinary dirty row
      // again now that its conflict flag is cleared, so it would get
      // picked up by the next sync run regardless; this just avoids
      // leaving it visibly "pending" until that happens on its own.
      syncInspection(id, organizationId).catch((error) =>
        logger.error('inspection-conflicts', 'Failed to push resolved conflict', error),
      );
    }
  }

  if (rows === null) {
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
      <ScrollView contentContainerStyle={styles.content}>
        {rows.length === 0 ? (
          <View style={styles.empty}>
            <Text style={typography.body}>Nothing to resolve right now.</Text>
          </View>
        ) : (
          rows.map((row) => {
            const display = describeConflictRow(row);
            const isResolving = resolvingId === row.id;
            const isBusy = resolvingId !== null;

            return (
              <View key={row.id} style={styles.card}>
                <Text style={typography.bodyStrong}>{row.title}</Text>
                <Text style={[typography.caption, styles.kindLabel]}>{display.kindLabel}</Text>

                <View style={styles.versionBlock}>
                  <Text style={typography.label}>Your version (on this device)</Text>
                  <Text style={typography.body}>{display.localStatusLabel}</Text>
                  {display.localDetail ? (
                    <Text style={[typography.caption, styles.detailText]}>
                      {display.localDetail}
                    </Text>
                  ) : null}
                  <Button
                    label="Keep mine"
                    variant="secondary"
                    onPress={() => handleResolve(row, 'keep_local')}
                    loading={isResolving}
                    disabled={isBusy && !isResolving}
                  />
                </View>

                <View style={styles.versionBlock}>
                  <Text style={typography.label}>Server version</Text>
                  {row.server ? (
                    <>
                      <Text style={typography.body}>{display.serverStatusLabel}</Text>
                      {display.serverDetail ? (
                        <Text style={[typography.caption, styles.detailText]}>
                          {display.serverDetail}
                        </Text>
                      ) : null}
                      <Button
                        label="Keep server's"
                        variant="secondary"
                        onPress={() => handleResolve(row, 'keep_server')}
                        loading={isResolving}
                        disabled={isBusy && !isResolving}
                      />
                    </>
                  ) : (
                    <Text style={[typography.caption, styles.errorText]}>
                      Could not load the current server version. Check your connection and try
                      again.
                    </Text>
                  )}
                </View>

                {rowErrors[row.id] ? (
                  <Text style={[typography.caption, styles.errorText]}>{rowErrors[row.id]}</Text>
                ) : null}
              </View>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  empty: {
    flex: 1,
    paddingTop: spacing.xxl,
    alignItems: 'center',
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  kindLabel: {
    color: colors.textSecondary,
  },
  versionBlock: {
    gap: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  detailText: {
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  errorText: {
    color: colors.danger,
  },
});
