import { Stack } from 'expo-router';

import { colors } from '@/theme';

/**
 * Nested stack for the Inspections tab: list -> new-inspection picker ->
 * walkthrough -> final review. Same pattern as the Properties tab's stack
 * (see properties/_layout.tsx) -- headers are managed here, not by the
 * parent Tabs layout.
 */
export default function InspectionsStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.textPrimary,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Inspections' }} />
      <Stack.Screen name="new" options={{ title: 'Start Inspection', presentation: 'modal' }} />
      <Stack.Screen name="[id]/index" options={{ title: 'Inspection' }} />
      <Stack.Screen name="[id]/review" options={{ title: 'Review & Submit' }} />
      <Stack.Screen name="[id]/report" options={{ title: 'Report' }} />
      <Stack.Screen name="[id]/manage" options={{ title: 'Manage Inspection' }} />
      <Stack.Screen name="[id]/conflicts" options={{ title: 'Resolve Conflicts' }} />
    </Stack>
  );
}
