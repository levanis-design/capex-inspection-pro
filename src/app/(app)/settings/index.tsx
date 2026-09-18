import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { useAuth } from '@/lib/auth-context';
import { useCurrentOrganization } from '@/lib/use-current-organization';
import { colors, spacing, typography } from '@/theme';

const PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  individual: 'Individual',
  professional: 'Professional',
  team: 'Team',
  enterprise: 'Enterprise',
};

// app.json's "version" field, plus a platform build number -- both read
// from the same manifest so there's nothing new to keep in sync at
// runtime. The build number is manually bumped in app.json per release
// (see its own comment there); this just displays whatever's currently
// baked into the running binary, which is the whole point -- it has to
// come from the manifest, not a hand-maintained constant here, or it
// would drift from what's actually installed.
const APP_VERSION = Constants.expoConfig?.version ?? 'unknown';
const BUILD_NUMBER =
  Constants.expoConfig?.android?.versionCode?.toString() ??
  Constants.expoConfig?.ios?.buildNumber ??
  'unknown';

export default function SettingsScreen() {
  const router = useRouter();
  const { session, signOut } = useAuth();
  const { data: organization, isLoading, error } = useCurrentOrganization();

  // Phase 23: signOut() now refuses to actually sign out (returning
  // `blocked: true`) if this device has unsynced offline changes, rather
  // than silently discarding them along with the local mirror it clears on
  // a real sign-out -- see auth-context.tsx's signOut() comment. This is
  // the one sign-out entry point that surfaces that choice to the person;
  // every other "Sign out" button in the app (device-registration-error
  // screen, device-revoked auto sign-out, MFA abandon) passes
  // `{ force: true }` instead, since those are security/error flows where
  // blocking on a confirmation would be more confusing than helpful.
  async function handleSignOut() {
    const result = await signOut();
    if (!result.blocked) return;

    const count = result.pendingCount;
    Alert.alert(
      'Unsynced changes',
      `This device has ${count} change${count === 1 ? '' : 's'} that ${
        count === 1 ? "hasn't" : "haven't"
      } been synced yet. Signing out now will lose ${
        count === 1 ? 'it' : 'them'
      } from this device. Reconnect and use Sync Status to sync first, or sign out anyway.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out anyway',
          style: 'destructive',
          onPress: () => signOut({ force: true }),
        },
      ],
    );
  }

  return (
    <Screen>
      <Text style={typography.screenTitle}>Settings</Text>

      <View style={styles.section}>
        <Text style={typography.label}>Signed in as</Text>
        <Text style={typography.body}>{session?.user.email ?? 'Unknown'}</Text>
      </View>

      <View style={styles.section}>
        <Text style={typography.label}>Organization</Text>
        {isLoading ? (
          <Text style={typography.body}>Loading…</Text>
        ) : error || !organization ? (
          <Text style={[typography.body, styles.errorText]}>
            {error ?? 'Could not load organization details.'}
          </Text>
        ) : (
          <>
            <Text style={typography.body}>{organization.organizationName}</Text>
            <Text style={typography.caption}>
              {PLAN_LABELS[organization.planTier] ?? organization.planTier} plan · up to{' '}
              {organization.propertySlotLimit}{' '}
              {organization.propertySlotLimit === 1 ? 'property' : 'properties'}
            </Text>
          </>
        )}
      </View>

      <View style={styles.section}>
        <Text style={typography.label}>Sync</Text>
        <Text style={typography.caption}>
          See what&apos;s still waiting to sync, why something might be stuck, and discard a photo
          upload that will never go through on its own.
        </Text>
        <View style={styles.syncStatusButton}>
          <Button
            label="Sync Status"
            variant="secondary"
            onPress={() => router.push('/(app)/settings/sync-status')}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={typography.label}>Devices & Security</Text>
        <Text style={typography.caption}>
          View your registered device, and (for org admins) every device in the organization plus
          recent security events.
        </Text>
        <View style={styles.syncStatusButton}>
          <Button
            label="Devices & Security"
            variant="secondary"
            onPress={() => router.push('/(app)/settings/devices')}
          />
        </View>
      </View>

      <Text style={[typography.caption, styles.note]}>
        Teammate invites (PRODUCT_SPEC.md section 3) arrive in a later phase.
      </Text>

      <View style={styles.signOut}>
        <Button label="Sign out" onPress={handleSignOut} variant="secondary" />
      </View>

      <Text style={[typography.caption, styles.version]}>
        Version {APP_VERSION} (build {BUILD_NUMBER})
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: spacing.xl,
    gap: spacing.xs,
  },
  errorText: {
    color: colors.danger,
  },
  syncStatusButton: {
    marginTop: spacing.xs,
    alignSelf: 'flex-start',
  },
  note: {
    marginTop: spacing.lg,
    color: colors.textSecondary,
  },
  signOut: {
    marginTop: spacing.xxl,
  },
  version: {
    marginTop: spacing.xl,
    textAlign: 'center',
    color: colors.textDisabled,
  },
});
