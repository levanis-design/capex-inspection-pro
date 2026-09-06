import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { useAuth } from '@/lib/auth-context';
import { colors, spacing, typography } from '@/theme';

export default function SettingsScreen() {
  const { session, signOut } = useAuth();

  return (
    <Screen>
      <Text style={typography.screenTitle}>Settings</Text>

      <View style={styles.section}>
        <Text style={typography.label}>Signed in as</Text>
        <Text style={typography.body}>{session?.user.email ?? 'Unknown'}</Text>
      </View>

      <Text style={[typography.caption, styles.note]}>
        Organization/plan info, teammate invites, and device management (PRODUCT_SPEC.md section 3)
        arrive in later phases.
      </Text>

      <View style={styles.signOut}>
        <Button label="Sign out" onPress={signOut} variant="secondary" />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: spacing.xl,
    gap: spacing.xs,
  },
  note: {
    marginTop: spacing.lg,
    color: colors.textSecondary,
  },
  signOut: {
    marginTop: spacing.xxl,
  },
});
