import { Stack } from 'expo-router';

import { colors } from '@/theme';

/**
 * Nested stack for the Settings tab: the settings screen itself -> the
 * Sync Status screen. Same pattern as properties/_layout.tsx,
 * inspections/_layout.tsx, and corrective-actions/_layout.tsx -- headers
 * are managed here (not by the parent Tabs layout, see the `settings`
 * tab's `headerShown: false` in `(app)/_layout.tsx`).
 */
export default function SettingsStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.textPrimary,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Settings' }} />
      <Stack.Screen name="sync-status" options={{ title: 'Sync Status' }} />
      <Stack.Screen name="devices" options={{ title: 'Devices & Security' }} />
    </Stack>
  );
}
