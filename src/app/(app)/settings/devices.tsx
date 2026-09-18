import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { useAuth } from '@/lib/auth-context';
import {
  DeviceRecord,
  fetchDevices,
  fetchSecurityEvents,
  revokeDevice,
  SecurityEventRecord,
} from '@/lib/devices';
import { useCurrentOrganization } from '@/lib/use-current-organization';
import { colors, radius, spacing, typography } from '@/theme';

const EVENT_TYPE_LABELS: Record<string, string> = {
  signup: 'Account created',
  email_verified: 'Email verified',
  login_success: 'Signed in',
  login_failed: 'Sign-in failed',
  mfa_enrolled: 'Two-factor enabled',
  mfa_challenge_failed: 'Two-factor code rejected',
  device_registered: 'Device registered',
  device_replaced: 'Device replaced',
  device_revoked: 'Device revoked',
  password_reset_requested: 'Password reset requested',
  rate_limit_triggered: 'Rate limit triggered',
  captcha_failed: 'CAPTCHA failed',
  play_integrity_rejected: 'Device failed integrity check',
  property_slot_denied: 'Property limit reached',
  device_slot_denied: 'Device limit reached',
};

function formatFingerprint(hash: string): string {
  return `${hash.slice(0, 12)}…`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

/**
 * Devices & Security (Phase 10, PRODUCT_SPEC.md section 6). Everyone
 * sees their own device and its replace history; an org_admin
 * additionally sees every device in the organization (with a revoke
 * action) and the recent security events log -- both already gated
 * server-side by RLS (migration 0022), this screen just doesn't bother
 * rendering sections a non-admin's queries would come back empty for.
 */
export default function DevicesScreen() {
  const { session } = useAuth();
  const { data: organization } = useCurrentOrganization();
  const isAdmin = organization?.role === 'org_admin';
  const currentUserId = session?.user.id;

  const [devices, setDevices] = useState<DeviceRecord[] | null>(null);
  const [events, setEvents] = useState<SecurityEventRecord[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmingRevokeId, setConfirmingRevokeId] = useState<string | null>(null);
  const [isRevokingId, setIsRevokingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const devicesResult = await fetchDevices();
    if (devicesResult.error) {
      setLoadError(devicesResult.error);
      return;
    }
    setLoadError(null);
    setDevices(devicesResult.devices);

    if (isAdmin) {
      const eventsResult = await fetchSecurityEvents();
      setEvents(eventsResult.events);
    }
  }, [isAdmin]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function handleRevoke(device: DeviceRecord) {
    setIsRevokingId(device.id);
    setActionError(null);
    const { error } = await revokeDevice(device.id, 'Revoked from Devices & Security screen');
    setIsRevokingId(null);
    setConfirmingRevokeId(null);
    if (error) {
      setActionError(error);
      return;
    }
    await load();
  }

  if (devices === null) {
    return (
      <Screen>
        <View style={styles.centered}>
          {loadError ? (
            <Text style={[typography.body, styles.errorText]}>{loadError}</Text>
          ) : (
            <ActivityIndicator color={colors.slate} />
          )}
        </View>
      </Screen>
    );
  }

  const myDevices = devices.filter((device) => device.userId === currentUserId);
  const otherDevices = devices.filter((device) => device.userId !== currentUserId);

  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <Screen>
        <Text style={typography.screenTitle}>Devices & Security</Text>

        {loadError ? <Text style={[typography.body, styles.errorText]}>{loadError}</Text> : null}
        {actionError ? (
          <Text style={[typography.body, styles.errorText]}>{actionError}</Text>
        ) : null}

        <Section title="Your device">
          {myDevices.length === 0 ? (
            <Text style={typography.caption}>No device registered yet.</Text>
          ) : (
            myDevices.map((device) => <DeviceCard key={device.id} device={device} isOwnDevice />)
          )}
        </Section>

        {isAdmin ? (
          <Section title="Every device in your organization">
            {otherDevices.length === 0 ? (
              <Text style={typography.caption}>No other devices registered.</Text>
            ) : (
              otherDevices.map((device) => (
                <DeviceCard
                  key={device.id}
                  device={device}
                  isOwnDevice={false}
                  isConfirmingRevoke={confirmingRevokeId === device.id}
                  isRevoking={isRevokingId === device.id}
                  onRequestRevoke={() => setConfirmingRevokeId(device.id)}
                  onCancelRevoke={() => setConfirmingRevokeId(null)}
                  onConfirmRevoke={() => handleRevoke(device)}
                />
              ))
            )}
          </Section>
        ) : null}

        {isAdmin ? (
          <Section title="Recent security events">
            {events.length === 0 ? (
              <Text style={typography.caption}>No security events recorded yet.</Text>
            ) : (
              events.map((event) => (
                <View key={event.id} style={styles.eventRow}>
                  <Text style={typography.body}>
                    {EVENT_TYPE_LABELS[event.eventType] ?? event.eventType}
                  </Text>
                  <Text style={typography.caption}>
                    {event.userEmail ?? 'Unknown user'} · {formatDate(event.createdAt)}
                  </Text>
                </View>
              ))
            )}
          </Section>
        ) : null}
      </Screen>
    </ScrollView>
  );
}

function DeviceCard({
  device,
  isOwnDevice,
  isConfirmingRevoke,
  isRevoking,
  onRequestRevoke = () => {},
  onCancelRevoke = () => {},
  onConfirmRevoke = () => {},
}: {
  device: DeviceRecord;
  isOwnDevice: boolean;
  isConfirmingRevoke?: boolean;
  isRevoking?: boolean;
  onRequestRevoke?: () => void;
  onCancelRevoke?: () => void;
  onConfirmRevoke?: () => void;
}) {
  return (
    <View style={styles.card}>
      {!isOwnDevice ? (
        <Text style={typography.bodyStrong}>
          {device.userEmail ?? device.userFullName ?? 'Unknown user'}
        </Text>
      ) : null}
      <Text style={typography.body}>
        {device.status === 'active' ? 'Active' : 'Revoked'} ·{' '}
        {formatFingerprint(device.fingerprintHash)}
      </Text>
      <Text style={typography.caption}>Registered {formatDate(device.registeredAt)}</Text>
      {device.status === 'revoked' && device.revokedAt ? (
        <Text style={typography.caption}>
          Revoked {formatDate(device.revokedAt)}
          {device.revokedReason ? ` — ${device.revokedReason}` : ''}
        </Text>
      ) : null}
      {device.playIntegrityVerdict?.bypassed ? (
        <Text style={[typography.caption, styles.bypassNote]}>
          Integrity check bypassed (Play Integrity not yet linked — see PRODUCT_SPEC.md section 3.2)
        </Text>
      ) : null}

      {!isOwnDevice && device.status === 'active' ? (
        isConfirmingRevoke ? (
          <View style={styles.confirmRow}>
            <Text style={[typography.caption, styles.confirmText]}>
              Revoke this device? The user will need to sign in again to re-register.
            </Text>
            <View style={styles.confirmActions}>
              <View style={styles.confirmActionButton}>
                <Button label="Cancel" variant="secondary" onPress={onCancelRevoke} />
              </View>
              <View style={styles.confirmActionButton}>
                <Button
                  label="Revoke"
                  variant="danger"
                  onPress={onConfirmRevoke}
                  loading={isRevoking}
                />
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.revokeButton}>
            <Button label="Revoke" variant="secondary" onPress={onRequestRevoke} />
          </View>
        )
      ) : null}
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
  errorText: {
    color: colors.danger,
    marginTop: spacing.md,
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
  bypassNote: {
    color: colors.warning,
  },
  revokeButton: {
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
  eventRow: {
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
});
