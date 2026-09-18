import { File } from 'expo-file-system';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { useAuth } from '@/lib/auth-context';
import { useConnectivity } from '@/lib/connectivity';
import { logger } from '@/lib/logger';
import {
  discardPendingPhoto,
  getAllDirtyItemsWithContext,
  getAllDirtyLocationsWithContext,
  getAllPendingPhotosWithContext,
  getSyncOverview,
  PendingItemSummary,
  PendingLocationSummary,
  PendingPhotoSummary,
  SyncOverview,
} from '@/lib/offline-db';
import { syncAllInspections } from '@/lib/offline-sync';
import { colors, radius, spacing, typography } from '@/theme';

const EMPTY_OVERVIEW: SyncOverview = {
  pendingLocations: 0,
  pendingItems: 0,
  pendingPhotos: 0,
  conflicts: 0,
};

/**
 * Diagnostics + control screen for the offline sync engine
 * (offline-sync.ts), linked from Settings. `(app)/_layout.tsx`'s
 * "Offline, N changes pending" strip and tab badge already say *how
 * much* is waiting; this screen is for someone who wants to see *which*
 * rows specifically, why a stuck one has been failing (`last_sync_error`
 * -- see offline-db.ts), and to manually trigger a retry rather than
 * waiting for the next opportunistic sync.
 *
 * Photos get a real "Discard" action -- deleting a stuck local photo
 * capture can't misrepresent an inspection finding the way abandoning a
 * dirty location/item status edit could (the checklist item's actual
 * observation/status is untouched), and a discarded photo can always be
 * recaptured. Dirty locations/items are deliberately read-only here: per
 * PRODUCT_SPEC.md section 9's conflict philosophy, a local edit is never
 * silently discarded -- if one is permanently stuck (e.g. its inspection
 * was voided server-side, see `pushDirtyLocation`'s `!serverRow` case),
 * that's visible here as an explanation, but resolving it is deliberately
 * out of scope for this screen.
 */
export default function SyncStatusScreen() {
  const { isOnline } = useConnectivity();
  const { signOut } = useAuth();
  const [overview, setOverview] = useState<SyncOverview>(EMPTY_OVERVIEW);
  const [locations, setLocations] = useState<PendingLocationSummary[]>([]);
  const [items, setItems] = useState<PendingItemSummary[]>([]);
  const [photos, setPhotos] = useState<PendingPhotoSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [confirmingDiscardId, setConfirmingDiscardId] = useState<string | null>(null);
  const [isDiscardingId, setIsDiscardingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [overviewResult, locationsResult, itemsResult, photosResult] = await Promise.all([
        getSyncOverview(),
        getAllDirtyLocationsWithContext(),
        getAllDirtyItemsWithContext(),
        getAllPendingPhotosWithContext(),
      ]);
      setOverview(overviewResult);
      setLocations(locationsResult);
      setItems(itemsResult);
      setPhotos(photosResult);
    } catch (error) {
      logger.error('sync-status', 'Failed to load sync status', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function handleSyncNow() {
    setIsSyncing(true);
    setSyncMessage(null);
    try {
      const summary = await syncAllInspections();
      if (summary.deviceRevoked) {
        // Phase 17: this device has been revoked by an org admin --
        // matches the same "sign out immediately" response as the
        // periodic foreground check in (app)/_layout.tsx, just reached
        // via a manual sync attempt instead of the background poll.
        setSyncMessage('This device has been revoked by your organization admin. Signing out…');
        await signOut({ force: true });
        return;
      }
      if (!summary.attempted) {
        setSyncMessage("Can't sync while offline.");
      } else {
        const synced = summary.syncedLocations + summary.syncedItems + summary.syncedPhotos;
        setSyncMessage(
          summary.errors > 0
            ? `Synced ${synced}, but ${summary.errors} still failed — see below.`
            : synced > 0
              ? `Synced ${synced} change${synced === 1 ? '' : 's'}.`
              : 'Nothing new to sync.',
        );
      }
    } catch (error) {
      logger.error('sync-status', 'Manual sync failed', error);
      setSyncMessage('Sync failed unexpectedly. Please try again.');
    } finally {
      await load();
      setIsSyncing(false);
    }
  }

  async function handleDiscardPhoto(photo: PendingPhotoSummary) {
    setIsDiscardingId(photo.id);
    try {
      const localFileUri = await discardPendingPhoto(photo.id);
      if (localFileUri) {
        try {
          const file = new File(localFileUri);
          if (file.exists) file.delete();
        } catch (fileError) {
          // The database row is already gone at this point -- the sync
          // engine will never retry it either way. A leftover encrypted
          // file with nothing pointing to it is orphaned disk space, not
          // a correctness problem, so this is logged and not surfaced.
          logger.error('sync-status', 'Failed to delete discarded photo file', fileError, {
            photoId: photo.id,
          });
        }
      }
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
    } catch (error) {
      logger.error('sync-status', 'Failed to discard photo', error, { photoId: photo.id });
    } finally {
      setIsDiscardingId(null);
      setConfirmingDiscardId(null);
    }
  }

  if (isLoading) {
    return (
      <Screen>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.slate} />
        </View>
      </Screen>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <Screen>
        <Text style={[typography.caption, isOnline ? styles.onlineText : styles.offlineText]}>
          {isOnline ? 'Online' : 'Offline — sync will resume automatically once reconnected'}
        </Text>

        <View style={styles.summaryRow}>
          <SummaryStat label="Areas" count={overview.pendingLocations} />
          <SummaryStat label="Items" count={overview.pendingItems} />
          <SummaryStat label="Photos" count={overview.pendingPhotos} />
          <SummaryStat label="Conflicts" count={overview.conflicts} isWarning />
        </View>

        <View style={styles.syncNowButton}>
          <Button
            label="Sync now"
            onPress={handleSyncNow}
            loading={isSyncing}
            disabled={!isOnline}
          />
          {syncMessage ? <Text style={typography.caption}>{syncMessage}</Text> : null}
        </View>

        {overview.conflicts > 0 ? (
          <Text style={[typography.caption, styles.conflictNote]}>
            {overview.conflicts} change{overview.conflicts === 1 ? '' : 's'} need manual resolution
            — open the affected inspection&apos;s &quot;Resolve Conflicts&quot; screen.
          </Text>
        ) : null}

        <Section title="Pending photos">
          {photos.length === 0 ? (
            <Text style={typography.caption}>Nothing waiting to upload.</Text>
          ) : (
            photos.map((photo) => (
              <View key={photo.id} style={styles.card}>
                <Text style={typography.bodyStrong}>{photo.itemTitle}</Text>
                <Text style={typography.caption}>
                  {photo.locationName} · {photo.propertyName}
                </Text>
                {photo.syncAttempts > 0 ? (
                  <Text style={[typography.caption, styles.errorText]}>
                    Failed {photo.syncAttempts} time{photo.syncAttempts === 1 ? '' : 's'}
                    {photo.lastSyncError ? `: ${photo.lastSyncError}` : ''}
                  </Text>
                ) : null}
                {confirmingDiscardId === photo.id ? (
                  <View style={styles.confirmRow}>
                    <Text style={[typography.caption, styles.confirmText]}>
                      Discard this photo permanently? It can&apos;t be undone.
                    </Text>
                    <View style={styles.confirmActions}>
                      <View style={styles.confirmActionButton}>
                        <Button
                          label="Cancel"
                          variant="secondary"
                          onPress={() => setConfirmingDiscardId(null)}
                        />
                      </View>
                      <View style={styles.confirmActionButton}>
                        <Button
                          label="Discard"
                          variant="danger"
                          onPress={() => handleDiscardPhoto(photo)}
                          loading={isDiscardingId === photo.id}
                        />
                      </View>
                    </View>
                  </View>
                ) : (
                  <View style={styles.discardButton}>
                    <Button
                      label="Discard"
                      variant="secondary"
                      onPress={() => setConfirmingDiscardId(photo.id)}
                    />
                  </View>
                )}
              </View>
            ))
          )}
        </Section>

        <Section title="Pending checklist changes">
          {locations.length === 0 && items.length === 0 ? (
            <Text style={typography.caption}>Nothing waiting to sync.</Text>
          ) : (
            <>
              {locations.map((location) => (
                <View key={location.id} style={styles.card}>
                  <Text style={typography.bodyStrong}>{location.name}</Text>
                  <Text style={typography.caption}>{location.propertyName}</Text>
                  {location.syncAttempts > 0 ? (
                    <Text style={[typography.caption, styles.errorText]}>
                      Failed {location.syncAttempts} time{location.syncAttempts === 1 ? '' : 's'}
                      {location.lastSyncError ? `: ${location.lastSyncError}` : ''}
                    </Text>
                  ) : null}
                </View>
              ))}
              {items.map((item) => (
                <View key={item.id} style={styles.card}>
                  <Text style={typography.bodyStrong}>{item.title}</Text>
                  <Text style={typography.caption}>
                    {item.locationName} · {item.propertyName}
                  </Text>
                  {item.syncAttempts > 0 ? (
                    <Text style={[typography.caption, styles.errorText]}>
                      Failed {item.syncAttempts} time{item.syncAttempts === 1 ? '' : 's'}
                      {item.lastSyncError ? `: ${item.lastSyncError}` : ''}
                    </Text>
                  ) : null}
                </View>
              ))}
              <Text style={[typography.caption, styles.note]}>
                These sync automatically once you&apos;re online — there&apos;s no discard action
                here, since abandoning a checklist edit could silently lose an inspection finding.
              </Text>
            </>
          )}
        </Section>
      </Screen>
    </ScrollView>
  );
}

function SummaryStat({
  label,
  count,
  isWarning,
}: {
  label: string;
  count: number;
  isWarning?: boolean;
}) {
  return (
    <View style={styles.summaryStat}>
      <Text
        style={[typography.screenTitle, isWarning && count > 0 ? styles.warningText : undefined]}
      >
        {count}
      </Text>
      <Text style={typography.caption}>{label}</Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={typography.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  onlineText: {
    color: colors.success,
  },
  offlineText: {
    color: colors.warning,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
  },
  summaryStat: {
    alignItems: 'center',
    flex: 1,
  },
  warningText: {
    color: colors.warning,
  },
  syncNowButton: {
    marginTop: spacing.xl,
    gap: spacing.xs,
  },
  conflictNote: {
    marginTop: spacing.md,
    color: colors.warning,
  },
  section: {
    marginTop: spacing.xxl,
    gap: spacing.sm,
  },
  sectionBody: {
    gap: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  errorText: {
    color: colors.danger,
  },
  discardButton: {
    marginTop: spacing.xs,
    alignSelf: 'flex-start',
  },
  confirmRow: {
    marginTop: spacing.xs,
    gap: spacing.sm,
  },
  confirmText: {
    color: colors.danger,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  confirmActionButton: {
    flex: 1,
  },
  note: {
    marginTop: spacing.xs,
  },
});
