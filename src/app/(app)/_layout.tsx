import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/lib/auth-context';
import { useConnectivity } from '@/lib/connectivity';
import { checkThisDeviceRevoked } from '@/lib/device-registration';
import { getSyncOverview, SyncOverview } from '@/lib/offline-db';
import { colors, spacing, typography } from '@/theme';

const EMPTY_SYNC_OVERVIEW: SyncOverview = {
  pendingLocations: 0,
  pendingItems: 0,
  pendingPhotos: 0,
  conflicts: 0,
};

// There's no cross-screen event bus in this app for "the local mirror
// (offline-db.ts) just changed" -- every screen that writes to it does so
// independently, and this layout sits above all of them. A short poll is
// the simplest way to keep this app-wide strip/badge from going stale
// while some other tab/screen is busy capturing or syncing.
const SYNC_OVERVIEW_POLL_MS = 15000;

// Phase 17: how often this device asks "am I still active?" while the
// app is open, independent of whether anything is actually being synced
// right now (a revoked device with nothing pending would otherwise never
// trigger the check offline-sync.ts already does at the top of every
// sync attempt). Not as tight as the sync-overview poll above -- this
// isn't powering a live UI indicator, just making sure a revoked device
// doesn't stay usable for long after an admin revokes it.
const DEVICE_STATUS_POLL_MS = 45000;

/**
 * Main authenticated tab navigator. This is the MVP tab set from
 * PRODUCT_SPEC.md section 6; each tab is a placeholder screen until its
 * phase (3: properties, 5: inspections) is built out.
 *
 * Phase 5C addition: a persistent "Offline" strip and a pending-sync badge
 * on the Inspections tab, so a user can tell at a glance -- from anywhere
 * in the app, not just while looking at one already-open inspection --
 * that they're offline and/or that something is still waiting to sync.
 * Per-inspection detail (which specific rows, any conflicts) still lives
 * on the inspection's own screens (see inspections/index.tsx and
 * [id]/index.tsx); this is just the ambient, always-visible signal.
 *
 * Phase 17 addition: a periodic check (independent of the sync-overview
 * poll above) for whether an org admin has revoked this device, signing
 * out immediately if so -- see checkThisDeviceRevoked()'s own comment.
 */
export default function AppTabsLayout() {
  const { isOnline } = useConnectivity();
  const { signOut } = useAuth();
  const [syncOverview, setSyncOverview] = useState<SyncOverview>(EMPTY_SYNC_OVERVIEW);
  const hasHandledRevocationRef = useRef(false);

  useEffect(() => {
    let isMounted = true;
    const refresh = () => {
      getSyncOverview()
        .then((overview) => {
          if (isMounted) setSyncOverview(overview);
        })
        .catch(() => {
          // Best-effort ambient indicator -- a failed read just leaves
          // the last-known counts on screen until the next poll succeeds.
        });
    };

    refresh();
    const interval = setInterval(refresh, SYNC_OVERVIEW_POLL_MS);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
    // Also refreshes right away whenever connectivity flips -- e.g. right
    // after coming back online, when a sync run elsewhere is most likely
    // to have just changed these counts.
  }, [isOnline]);

  // Phase 17: periodic "has an admin revoked this device?" check -- see
  // checkThisDeviceRevoked()'s own comment and migration 0027's header
  // comment for why this is a client-side belt rather than the actual
  // security boundary. Skipped while offline (nothing to check against,
  // and no point generating a doomed network call every 45s). The ref
  // guard is just to make sure a slow signOut() in flight doesn't trigger
  // a second Alert from the next tick before this component unmounts.
  useEffect(() => {
    if (!isOnline) return;
    let isMounted = true;
    const checkRevocation = () => {
      checkThisDeviceRevoked()
        .then((revoked) => {
          if (!isMounted || !revoked || hasHandledRevocationRef.current) return;
          hasHandledRevocationRef.current = true;
          Alert.alert(
            'Device revoked',
            'This device has been revoked by your organization admin. You will be signed out.',
            [{ text: 'OK', onPress: () => signOut({ force: true }) }],
          );
        })
        .catch(() => {
          // Fails open -- see checkThisDeviceRevoked()'s own comment.
        });
    };

    const interval = setInterval(checkRevocation, DEVICE_STATUS_POLL_MS);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [isOnline, signOut]);

  const pendingSyncCount =
    syncOverview.pendingLocations + syncOverview.pendingItems + syncOverview.pendingPhotos;
  const badgeCount = pendingSyncCount + syncOverview.conflicts;

  return (
    <View style={styles.container}>
      {!isOnline ? (
        <View style={styles.offlineStrip}>
          <Text style={[typography.caption, styles.offlineStripText]}>
            Offline
            {pendingSyncCount > 0
              ? ` — ${pendingSyncCount} change${pendingSyncCount === 1 ? '' : 's'} waiting to sync`
              : ''}
          </Text>
        </View>
      ) : null}
      <Tabs
        screenOptions={{
          headerShown: true,
          tabBarActiveTintColor: colors.slate,
          tabBarInactiveTintColor: colors.textDisabled,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Dashboard',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="grid-outline" color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="properties"
          options={{
            title: 'Properties',
            // The nested Stack under properties/ (list -> new-property form)
            // renders its own headers per screen; showing this tab's header
            // too would stack a second header underneath it.
            headerShown: false,
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="business-outline" color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="inspections"
          options={{
            title: 'Inspections',
            // The nested Stack under inspections/ (list -> new -> walkthrough
            // -> review) renders its own headers per screen -- see the
            // `properties` tab above for the identical reason.
            headerShown: false,
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="clipboard-outline" color={color} size={size} />
            ),
            // Global pending-sync + conflict count, across every locally
            // mirrored inspection -- not scoped to whichever one a person
            // last opened. See getSyncOverview in offline-db.ts.
            tabBarBadge: badgeCount > 0 ? badgeCount : undefined,
          }}
        />
        <Tabs.Screen
          name="corrective-actions"
          options={{
            title: 'Corrective Actions',
            // Nested Stack (board -> deficiency detail) renders its own
            // headers per screen -- same reasoning as the `properties`/
            // `inspections` tabs above.
            headerShown: false,
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="build-outline" color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: 'Settings',
            // Nested Stack under settings/ (index -> sync-status) renders
            // its own headers per screen -- same reasoning as the
            // `properties`/`inspections`/`corrective-actions` tabs above.
            headerShown: false,
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="settings-outline" color={color} size={size} />
            ),
          }}
        />
      </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  offlineStrip: {
    backgroundColor: colors.warning,
    paddingVertical: spacing.xs,
    alignItems: 'center',
  },
  offlineStripText: {
    color: colors.textInverse,
  },
});
